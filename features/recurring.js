// Recurring templates (Periódicos versión B). Owner-side definitions of
// repeating movements (alquileres, suscripciones, nóminas) that the app
// materialises into real movements at boot time.
//
// Idempotency: every template tracks its lastGeneratedDate. On boot we
// walk from (lastGeneratedDate ?? startDate-1day) up to today, emitting
// one movement per occurrence. If a template targets a shared contact,
// each occurrence also spawns a paired shared_entries row, exactly as if
// the user had hand-entered the gasto compartido through the movement
// modal.
//
// Edits to the importe of a template only affect future generations: rows
// already produced are immutable fotos del pasado. Pausing keeps the
// template but stops generation; deleting removes the template (existing
// generated movements stay in place).

import { state } from "../core/state.js";
import { elements } from "../core/dom.js";
import {
  saveMovements,
  saveSharedEntries,
  saveRecurringTemplates,
} from "../core/storage.js";
import {
  createId,
  formatMoney,
  toIsoDate,
  optionMarkup,
  APP_LOCALE,
} from "../core/utils.js";
import { SHARED_MODES } from "../core/constants.js";
import {
  buildSharedExpenseEntry,
  computeSharedShares,
  parseSharedTarget,
} from "./shared.js";
import { getContactName } from "./contacts.js";
import {
  getMyGroups,
  getGroupById,
  getGroupMembers,
  getMyMemberInGroup,
  buildSplits,
  resolveMemberView,
} from "./groups.js";
import { setRecurringStartDate, setRecurringEndDate } from "../ui/datepicker.js";
import { showConfirm } from "../ui/confirm.js";
import { syncPartySuggestions } from "./movements.js";

// When the user clicks "Convertir en plantilla periódica" in the movement
// modal, we stash the source movement's id here so the recurring form's
// submit handler can link the existing movement to the freshly created
// template (set its recurringTemplateId so 🔁 shows up immediately).
let convertingFromMovementId = null;
// Mismo patrón que convertingFromMovementId, pero para el caso en el
// que se convierte un shared_entry directamente sin movement asociado
// (típico en modo "Te debe la cantidad total" / "Le debes la cantidad
// total", donde no se crea movement personal). El submit usa la fecha
// del entry para sembrar lastGeneratedDate.
let convertingFromSharedEntryId = null;
// Cuando una plantilla se crea convirtiendo un gasto desigual de
// grupo, propagamos el reparto custom (porcentajes por miembro) en
// esta variable. createTemplateFromForm la lee al construir la
// plantilla. Sin UI propia todavía: si el usuario cambia el grupo en
// el dropdown, el split custom queda invalidado (el grupo nuevo no
// conoce esos member_ids).
let pendingGroupSplit = null;

// ---- date helpers -----------------------------------------------------

function parseIsoDate(iso) {
  // Interpret as LOCAL date so "2026-05-03" becomes midnight in Madrid,
  // not UTC. Avoids day-shift bugs when comparing against today().
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function lastDayOfMonth(year, monthIndex) {
  // monthIndex is 0-based. Day-0 of the next month is the last day of this one.
  return new Date(year, monthIndex + 1, 0).getDate();
}

// Resolve "el día N del mes (year, monthIndex)" with fallback to the
// real last day if N exceeds the month length. monthIndex is 0-based.
function resolveDayInMonth(year, monthIndex, day) {
  const lastDay = lastDayOfMonth(year, monthIndex);
  return Math.min(day, lastDay);
}

// Given a starting date (exclusive), return the next occurrence date for
// a template. NULL when the template's end_date is past or never matches.
function nextOccurrenceAfter(template, afterDate) {
  if (template.periodicity === "monthly") {
    // Start the search from the month FOLLOWING afterDate, unless the
    // afterDate is before this month's target day — in which case the
    // current month still has a pending occurrence.
    const cursorYear = afterDate.getFullYear();
    const cursorMonth = afterDate.getMonth();
    const candidateThisMonth = new Date(
      cursorYear,
      cursorMonth,
      resolveDayInMonth(cursorYear, cursorMonth, template.dayOfMonth)
    );
    if (candidateThisMonth > afterDate) return candidateThisMonth;
    const nextYear = cursorMonth === 11 ? cursorYear + 1 : cursorYear;
    const nextMonth = cursorMonth === 11 ? 0 : cursorMonth + 1;
    return new Date(
      nextYear,
      nextMonth,
      resolveDayInMonth(nextYear, nextMonth, template.dayOfMonth)
    );
  }

  // yearly
  const monthIndex = (template.monthOfYear ?? 1) - 1;
  const candidateThisYear = new Date(
    afterDate.getFullYear(),
    monthIndex,
    resolveDayInMonth(afterDate.getFullYear(), monthIndex, template.dayOfMonth)
  );
  if (candidateThisYear > afterDate) return candidateThisYear;
  const nextYear = afterDate.getFullYear() + 1;
  return new Date(
    nextYear,
    monthIndex,
    resolveDayInMonth(nextYear, monthIndex, template.dayOfMonth)
  );
}

// Public helper for the UI: when does this template fire next? Used by
// the list card to show "Próxima generación: 1 de junio".
export function previewNextOccurrence(template) {
  const cursor = template.lastGeneratedDate
    ? parseIsoDate(template.lastGeneratedDate)
    : addDays(parseIsoDate(template.startDate), -1);
  const next = nextOccurrenceAfter(template, cursor);
  if (template.endDate && next > parseIsoDate(template.endDate)) return null;
  return next;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function todayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// ---- placeholder substitution ----------------------------------------
//
// Free-text fields (note + party) on a template can embed [tokens] that
// resolve to the occurrence date when the movement is materialised.
// "Alquiler [mes] [año]" → "Alquiler mayo 2026" on the May 2026 row,
// "Alquiler junio 2026" on the June row, and so on. The template stores
// the raw string with brackets; the engine substitutes per occurrence.

const MONTH_NAMES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function resolvePlaceholder(rawName, date) {
  const name = rawName.trim();
  const lower = name.toLowerCase();
  // Capitalisation hint: if the user typed [Mes] (or [Mes en curso]) we
  // return the month name capitalised; lowercase token → lowercase value.
  // This mirrors how the rest of the UI renders Mayo/mayo depending on
  // sentence position.
  const wantCapitalised = name.charAt(0) === name.charAt(0).toUpperCase()
    && name.charAt(0) !== name.charAt(0).toLowerCase();

  const monthName = MONTH_NAMES_ES[date.getMonth()];

  if (lower === "mes" || lower === "mes en curso") {
    return wantCapitalised ? capitalise(monthName) : monthName;
  }
  if (lower === "año" || lower === "año en curso" || lower === "ano" || lower === "ano en curso") {
    return String(date.getFullYear());
  }
  if (lower === "día" || lower === "dia") {
    return String(date.getDate());
  }
  if (lower === "fecha") {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${date.getFullYear()}`;
  }
  return null;
}

export function applyTemplatePlaceholders(text, isoDate) {
  if (!text) return text;
  const date = parseIsoDate(isoDate);
  return text.replace(/\[([^\]\n]+)\]/g, (full, name) => {
    const value = resolvePlaceholder(name, date);
    return value == null ? full : value;
  });
}

// ---- generation engine ------------------------------------------------

// Hybrid real-time scheduler. Two complementary triggers:
//
// 1. setTimeout to the next local midnight: when the day ticks over while
//    the tab is open, generation fires automatically without a reload.
//    After firing it reschedules itself for the following midnight.
//
// 2. visibilitychange listener: when the user comes back to a tab that
//    had been in the background (laptop suspended, phone screen off, tab
//    parked behind another), check if the date has changed since the
//    last generation and run if so.
//
// Polling every N minutes is intentionally avoided. The two events above
// cover the "day rolled over" case in 100% of practical scenarios while
// the tab consumes zero CPU otherwise.
let scheduledMidnightTimer = null;

function msUntilNextLocalMidnight() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  // +5s past midnight to avoid running 0.5s before midnight due to drift.
  return nextMidnight.getTime() - now.getTime();
}

function rescheduleMidnight() {
  if (scheduledMidnightTimer) clearTimeout(scheduledMidnightTimer);
  scheduledMidnightTimer = setTimeout(() => {
    runScheduledGeneration("midnight");
    rescheduleMidnight();
  }, msUntilNextLocalMidnight());
}

function runScheduledGeneration(trigger) {
  try {
    const summary = generatePendingRecurrences();
    if (summary.movements || summary.sharedEntries) {
      console.log(`[recurring] ${trigger} tick produced ${summary.movements} movement(s), ${summary.sharedEntries} shared`);
      // Lazy-import the renderers so this module doesn't statically
      // depend on movements.js / shared.js (movements.js imports us via
      // openConvertFromMovement; we'd create a hard cycle).
      import("./movements.js").then((m) => m.renderMovements?.());
      import("./analysis.js").then((m) => m.renderAnalysis?.());
      import("./shared.js").then((m) => m.renderSharedView?.());
    }
  } catch (err) {
    console.error("[recurring]", err);
  }
}

export function startRecurringScheduler() {
  rescheduleMidnight();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      runScheduledGeneration("visibility");
      // Reset the midnight timer too: the original setTimeout may have
      // fired late or not at all if the device was suspended.
      rescheduleMidnight();
    }
  });
}

// Walk every active template forward to today and emit any pending
// movements. Idempotent — re-running on a fresh boot with no time elapsed
// is a no-op. Returns a summary so callers can decide whether to renderer
// after the fact.
export function generatePendingRecurrences() {
  const today = todayLocal();
  const newMovements = [];
  const newSharedEntries = [];
  let templatesTouched = false;

  for (const template of state.recurringTemplates) {
    if (!template.isActive) continue;

    const startDate = parseIsoDate(template.startDate);
    const endDate = template.endDate ? parseIsoDate(template.endDate) : null;
    let cursor = template.lastGeneratedDate
      ? parseIsoDate(template.lastGeneratedDate)
      : addDays(startDate, -1);

    let lastGen = template.lastGeneratedDate ?? null;

    while (true) {
      const next = nextOccurrenceAfter(template, cursor);
      if (next > today) break;
      if (endDate && next > endDate) break;
      if (next < startDate) {
        // Defensive: shouldn't happen because cursor starts at startDate-1,
        // but covers the case where a user shifts startDate forward.
        cursor = next;
        continue;
      }

      const isoDate = toIsoDate(next);
      const generated = materialise(template, isoDate);
      if (generated.movement) newMovements.push(generated.movement);
      if (generated.sharedEntry) newSharedEntries.push(generated.sharedEntry);
      lastGen = isoDate;
      cursor = next;
    }

    if (lastGen !== template.lastGeneratedDate) {
      template.lastGeneratedDate = lastGen;
      templatesTouched = true;
    }
  }

  if (newMovements.length) {
    state.movements = [...newMovements, ...state.movements];
    saveMovements();
  }
  if (newSharedEntries.length) {
    state.sharedEntries = [...newSharedEntries, ...state.sharedEntries];
    saveSharedEntries();
  }
  if (templatesTouched) {
    saveRecurringTemplates();
  }

  return {
    movements: newMovements.length,
    sharedEntries: newSharedEntries.length,
  };
}

// Build the movement (and optional shared_entry) that a template's
// occurrence on `isoDate` should produce. Mirrors the form submit logic
// in features/movements.js — same skip rule for me-full préstamos, same
// shape for shared entries.
function materialise(template, isoDate) {
  const isShared1on1 = !!template.sharedContactId;
  const isSharedGroup = !!template.groupId;
  const movementId = createId();

  // Resolve [mes]/[año]/etc. placeholders against this occurrence's date.
  // Done once and reused for both the movement row and the shared_entry
  // so the two stay textually in sync.
  const renderedNote = applyTemplatePlaceholders(template.note ?? "", isoDate);
  const renderedParty = applyTemplatePlaceholders(template.party ?? "", isoDate);

  let sharedEntry = null;
  let amountForMovement = template.amount;
  let sharedEntryId = null;
  let skipMovement = false;

  if (isSharedGroup) {
    // Plantilla de grupo: el reparto sale de template.groupSplit si
    // está definido (porcentajes custom heredados del gasto desigual
    // de origen al convertir), o si no, del default del grupo. El
    // pagador es siempre yo — el motor solo corre en mi cliente.
    const group = getGroupById(template.groupId);
    const myMember = getMyMemberInGroup(template.groupId);
    if (!group || !myMember) {
      // Grupo o membresía perdida — no podemos generar. Saltar.
      return { movement: null, sharedEntry: null };
    }
    // Decidir fuente del reparto: la plantilla manda si tiene
    // groupSplit; si no, el default del grupo.
    const sourceSplit = template.groupSplit ?? group.defaultSplit;
    const sourceMode = template.groupSplit
      ? "uneven"
      : (group.defaultSplitMode || "equal");
    let perMemberShares = null;
    if (sourceMode === "uneven" && sourceSplit) {
      const totalPercent = Object.values(sourceSplit).reduce(
        (acc, p) => acc + (Number(p) || 0),
        0
      );
      if (totalPercent > 0) {
        perMemberShares = {};
        for (const [memberId, percent] of Object.entries(sourceSplit)) {
          perMemberShares[memberId] = (Number(percent) / totalPercent) * template.amount;
        }
      }
    }
    let splits;
    try {
      splits = buildSplits({
        groupId: template.groupId,
        total: template.amount,
        payerMemberId: myMember.id,
        mode: sourceMode === "uneven" && perMemberShares ? "uneven" : "equal",
        perMemberShares,
      });
    } catch (err) {
      console.error("[recurring] buildSplits failed", err);
      return { movement: null, sharedEntry: null };
    }

    const myOwes = Number(splits[myMember.id]?.owes) || 0;
    sharedEntry = {
      id: createId(),
      type: "expense",
      contactId: "",
      date: isoDate,
      concept: template.concept,
      note: renderedNote,
      total: template.amount,
      paidBy: "me",
      splitMode: sourceMode === "uneven" && perMemberShares ? "uneven" : "equal",
      myShare: myOwes,
      theirShare: 0,
      sourceMovementId: myOwes > 0 ? movementId : null,
      groupId: template.groupId,
      splits,
      settledAt: null,
      createdAt: new Date().toISOString(),
    };
    skipMovement = myOwes <= 0;
    if (!skipMovement) {
      amountForMovement = myOwes;
      sharedEntryId = sharedEntry.id;
    }
  } else if (isShared1on1) {
    const modeKey = sharedModeKeyOfTemplate(template);
    const mode = SHARED_MODES[modeKey];
    const { myShare, theirShare } = computeSharedShares(
      template.amount,
      modeKey,
      template.sharedMyShare,
      template.sharedTheirShare
    );

    sharedEntry = buildSharedExpenseEntry({
      contactId: template.sharedContactId,
      total: template.amount,
      modeKey,
      myShare,
      theirShare,
      date: isoDate,
      concept: template.concept,
      note: renderedNote,
      sourceMovementId: movementId,
    });

    skipMovement = mode.paidBy === "me" && mode.split === "full";
    if (skipMovement) {
      sharedEntry.sourceMovementId = null;
    } else {
      amountForMovement = myShare;
      sharedEntryId = sharedEntry.id;
    }
  }

  if (skipMovement) {
    return { movement: null, sharedEntry };
  }

  const movement = {
    id: movementId,
    type: template.type,
    date: isoDate,
    concept: template.concept,
    amount: amountForMovement,
    category: template.category,
    party: renderedParty,
    recurrence: template.periodicity === "yearly" ? "anual" : "mensual",
    note: renderedNote,
    sharedEntryId,
    recurringTemplateId: template.id,
  };

  return { movement, sharedEntry };
}

function sharedModeKeyOfTemplate(template) {
  // Templates store paidBy and splitMode separately; SHARED_MODES is
  // keyed by "<paidBy>-<split>". The split must be 'equal' | 'uneven' |
  // 'full' (same set used by shared.js's helpers); the migration's
  // CHECK constraint enforces it.
  return `${template.sharedPaidBy ?? "me"}-${template.sharedSplitMode ?? "equal"}`;
}

// ---- CRUD --------------------------------------------------------------

export function createTemplateFromForm(formData) {
  const periodicity = formData.get("periodicity") || "monthly";
  const rawTarget = formData.get("sharedContactId") || "";
  const target = parseSharedTarget(rawTarget);
  const baseAmount = Number(formData.get("amount"));

  let sharedSplitMode = null;
  let sharedPaidBy = null;
  let sharedMyShare = null;
  let sharedTheirShare = null;
  let sharedContactId = null;
  let groupId = null;
  let groupSplit = null;

  if (target.kind === "contact") {
    sharedContactId = target.id;
    const modeKey = formData.get("sharedMode") || "me-equal";
    const mode = SHARED_MODES[modeKey];
    sharedPaidBy = mode.paidBy;
    sharedSplitMode = mode.split;
    if (mode.split === "uneven") {
      sharedMyShare = Number(formData.get("myShare")) || 0;
      sharedTheirShare = Number(formData.get("theirShare")) || 0;
    }
  } else if (target.kind === "group") {
    groupId = target.id;
    // Si el usuario abrió el modal vía "Convertir en plantilla
    // periódica" desde un gasto desigual de grupo, propagamos los
    // porcentajes calculados en pendingGroupSplit. Si el usuario
    // cambia el grupo después, el listener limpia pendingGroupSplit.
    if (pendingGroupSplit) {
      groupSplit = pendingGroupSplit;
    }
  }

  return {
    id: createId(),
    type: formData.get("type"),
    concept: formData.get("concept"),
    amount: baseAmount,
    category: formData.get("category"),
    party: (formData.get("party") || "").trim(),
    note: (formData.get("note") || "").trim(),
    periodicity,
    dayOfMonth: Number(formData.get("dayOfMonth")) || 1,
    monthOfYear: periodicity === "yearly"
      ? Number(formData.get("monthOfYear")) || 1
      : null,
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate") || null,
    lastGeneratedDate: null,
    isActive: true,
    sharedContactId,
    sharedPaidBy,
    sharedSplitMode,
    sharedMyShare,
    sharedTheirShare,
    groupId,
    groupSplit,
    createdAt: new Date().toISOString(),
  };
}

// Delete just the template and unlink the generated rows so they keep
// living in the user's history without the 🔁 indicator pointing to a
// ghost id. Used by both "keep movements" branches of the delete modal.
function deleteTemplateOnly(templateId) {
  const generated = state.movements.filter((m) => m.recurringTemplateId === templateId);
  if (generated.length) {
    for (const m of generated) {
      m.recurringTemplateId = null;
    }
    saveMovements();
  }
  state.recurringTemplates = state.recurringTemplates.filter((x) => x.id !== templateId);
  saveRecurringTemplates();
  renderRecurringView();
  // Re-render movements so the 🔁 disappears from the orphaned rows.
  import("./movements.js").then((m) => m.renderMovements?.());
}

// Delete the template AND wipe every movement it produced (and any
// linked shared_entries). Aggressive — guarded behind double-confirm in
// the modal. Re-rendering the three views keeps everything consistent.
function deleteTemplateAndOccurrences(templateId) {
  const generated = state.movements.filter((m) => m.recurringTemplateId === templateId);
  const linkedEntryIds = new Set(
    generated.map((m) => m.sharedEntryId).filter(Boolean)
  );
  state.movements = state.movements.filter((m) => m.recurringTemplateId !== templateId);
  if (linkedEntryIds.size) {
    state.sharedEntries = state.sharedEntries.filter((e) => !linkedEntryIds.has(e.id));
    saveSharedEntries();
  }
  state.recurringTemplates = state.recurringTemplates.filter((x) => x.id !== templateId);
  saveMovements();
  saveRecurringTemplates();
  renderRecurringView();
  Promise.all([
    import("./movements.js").then((m) => m.renderMovements?.()),
    import("./analysis.js").then((m) => m.renderAnalysis?.()),
    linkedEntryIds.size
      ? import("./shared.js").then((m) => m.renderSharedView?.())
      : Promise.resolve(),
  ]);
}

export function deleteTemplate(id) {
  const t = state.recurringTemplates.find((x) => x.id === id);
  if (!t) return;
  const generated = state.movements.filter((m) => m.recurringTemplateId === id);
  const count = generated.length;
  const summary = count === 0
    ? "Esta plantilla aún no ha generado ningún movimiento."
    : count === 1
      ? "Esta plantilla ha generado 1 movimiento en tu histórico."
      : `Esta plantilla ha generado ${count} movimientos en tu histórico.`;
  showConfirm({
    title: "Eliminar plantilla periódica",
    message: `Vas a eliminar la plantilla "${t.concept}". ${summary}`,
    extra: count
      ? "Los movimientos ya generados pueden mantenerse en tu histórico (perderán el icono 🔁) o borrarse junto a la plantilla."
      : undefined,
    actions: [
      {
        label: "Cancelar",
        kind: "secondary",
        onClick: () => {},
      },
      {
        label: count
          ? "Mantener los movimientos, borrar solo la plantilla"
          : "Borrar plantilla",
        kind: "primary",
        onClick: () => deleteTemplateOnly(id),
      },
      ...(count > 0
        ? [{
          label: `Borrar plantilla y los ${count} movimiento${count === 1 ? "" : "s"} generado${count === 1 ? "" : "s"}`,
          kind: "danger",
          requireDoubleConfirm: true,
          onClick: () => deleteTemplateAndOccurrences(id),
        }]
        : []),
    ],
  });
}

export function toggleTemplateActive(id) {
  const t = state.recurringTemplates.find((x) => x.id === id);
  if (!t) return;
  const reactivating = !t.isActive;
  t.isActive = !t.isActive;
  // When reactivating after a pause, advance the lastGeneratedDate to
  // today so the engine SKIPS any occurrences that fell during the
  // pause window. The user explicitly chose this behaviour over
  // "backfill the gap": resuming a paused template is meant to mean
  // "start producing again from now", not "produce the months that
  // were missed".
  if (reactivating) {
    t.lastGeneratedDate = toIsoDate(todayLocal());
  }
  saveRecurringTemplates();
  renderRecurringView();
}

// ---- view rendering ----------------------------------------------------

const monthFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  day: "numeric",
  month: "long",
});
const yearMonthFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function summarisePeriodicity(template) {
  if (template.periodicity === "monthly") {
    return `Cada día ${template.dayOfMonth} del mes`;
  }
  const monthName = new Intl.DateTimeFormat(APP_LOCALE, { month: "long" }).format(
    new Date(2026, (template.monthOfYear ?? 1) - 1, 1)
  );
  return `Cada año el ${template.dayOfMonth} de ${monthName}`;
}

function summariseSharedTarget(template) {
  if (!template.sharedContactId) return "";
  const name = getContactName(template.sharedContactId) || "—";
  const modeKey = sharedModeKeyOfTemplate(template);
  const modeLabel = SHARED_MODES[modeKey]?.label?.replace("{name}", name) ?? "";
  // For "me-*" modes the canned label says "Tú pagaste, …" and never
  // mentions the partner's name. Always prepend "Con [name] · " so the
  // user can see at a glance who the template is tied to. The "them-*"
  // modes already weave the name into the label ("María pagó, …") so we
  // just return the label verbatim there.
  if (template.sharedPaidBy === "me") {
    return `Con ${name} · ${modeLabel}`;
  }
  return modeLabel;
}

export function renderRecurringView() {
  const list = elements.recurringList;
  const empty = elements.recurringEmpty;
  const count = elements.recurringCount;
  if (!list) return;

  const items = state.recurringTemplates.slice().sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.concept.localeCompare(b.concept, "es", { sensitivity: "base" });
  });

  if (count) {
    count.textContent = `${items.length} plantilla${items.length === 1 ? "" : "s"}`;
  }

  list.innerHTML = "";
  if (!items.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  const fragment = document.createDocumentFragment();

  // Column titles row, only visible on desktop (CSS hides on mobile).
  // Sits inside the same grid container as the items so it lines up
  // pixel-for-pixel with the rows below. Each header gets a column-
  // specific class so we can align it with its data column (Importe
  // is right-aligned to match the numeric content, Acciones idem).
  const header = document.createElement("div");
  header.className = "recurring-row recurring-row--header";
  header.innerHTML = `
    <span class="ri-col ri-col--title">Concepto</span>
    <span class="ri-col ri-col--amount">Importe</span>
    <span class="ri-col ri-col--period">Periodicidad</span>
    <span class="ri-col ri-col--next">Pr&oacute;xima</span>
    <span class="ri-col ri-col--shared">Compartido</span>
    <span class="ri-col ri-col--actions">Acciones</span>
  `;
  fragment.append(header);

  for (const template of items) {
    fragment.append(createRecurringRow(template));
  }
  list.append(fragment);
}

function createRecurringRow(template) {
  const row = document.createElement("article");
  row.className = "recurring-row recurring-row--item";
  row.dataset.id = template.id;
  if (!template.isActive) row.classList.add("is-paused");
  if (template.id === state.expandedRecurringId) row.classList.add("is-expanded");

  // ---- concept + note (concept always visible; note: subtitle on
  // desktop, hidden when collapsed on mobile, reveals on tap)
  const titleCell = document.createElement("div");
  titleCell.className = "ri-title";
  const concept = document.createElement("strong");
  concept.className = "ri-concept";
  concept.textContent = template.concept;
  titleCell.append(concept);
  if (template.note) {
    const note = document.createElement("small");
    note.className = "ri-note";
    note.textContent = template.note;
    titleCell.append(note);
  }
  if (template.party) {
    const party = document.createElement("small");
    party.className = "ri-party";
    party.textContent = template.party;
    titleCell.append(party);
  }

  // ---- amount (signed and coloured by type)
  const amount = document.createElement("strong");
  amount.className = `ri-amount ${template.type}`;
  const sign = template.type === "expense" ? -template.amount : template.amount;
  amount.textContent = formatMoney(sign);

  // ---- periodicity (Cada día N del mes / Cada año el N de Junio)
  const periodicity = document.createElement("span");
  periodicity.className = "ri-period";
  periodicity.textContent = summarisePeriodicity(template);

  // ---- next occurrence (or "Pausada" / "Sin próximas")
  const next = previewNextOccurrence(template);
  const nextEl = document.createElement("span");
  nextEl.className = "ri-next";
  if (!template.isActive) {
    nextEl.textContent = "Pausada";
    nextEl.classList.add("ri-next--paused");
  } else if (next) {
    nextEl.textContent = monthFormatter.format(next);
  } else {
    nextEl.textContent = "Sin próximas";
    nextEl.classList.add("ri-next--ended");
  }

  // ---- shared (Con [contacto] · modo de reparto). Empty when not
  // shared — the cell sits in the grid as a placeholder for alignment
  // and CSS hides empty cells on mobile so they don't add a blank row.
  const shared = document.createElement("span");
  shared.className = "ri-shared";
  shared.textContent = summariseSharedTarget(template);

  // ---- actions
  const actions = document.createElement("div");
  actions.className = "ri-actions";
  for (const a of buildActionButtons(template)) actions.append(a);

  row.append(titleCell, amount, periodicity, nextEl, shared, actions);
  return row;
}

// SVG markup for the action icons. Strokes use `currentColor` so the
// danger button (red text) automatically gets a red trash. All three
// icons are 24×24 viewBox; CSS sizes them at 16px for the table and
// hides them entirely on mobile (where text labels take over).
const EDIT_ICON_SVG = `<svg class="ri-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const PAUSE_ICON_SVG = `<svg class="ri-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const PLAY_ICON_SVG = `<svg class="ri-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
const TRASH_ICON_SVG = `<svg class="ri-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`;

function makeActionButton({ icon, label, action, kind }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `ri-action ri-action--${kind}`;
  btn.dataset.action = action;
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.innerHTML = `${icon}<span class="ri-action-label">${label}</span>`;
  return btn;
}

function buildActionButtons(template) {
  return [
    makeActionButton({
      icon: EDIT_ICON_SVG,
      label: "Editar",
      action: "edit",
      kind: "edit",
    }),
    makeActionButton({
      icon: template.isActive ? PAUSE_ICON_SVG : PLAY_ICON_SVG,
      label: template.isActive ? "Pausar" : "Reactivar",
      action: "toggle",
      kind: "toggle",
    }),
    makeActionButton({
      icon: TRASH_ICON_SVG,
      label: "Eliminar",
      action: "delete",
      kind: "delete",
    }),
  ];
}

// ---- modal: create / edit ---------------------------------------------

function openRecurringModal() {
  if (!elements.recurringModal) return;
  elements.recurringModal.hidden = false;
}

export function closeRecurringModal() {
  if (!elements.recurringModal) return;
  elements.recurringModal.hidden = true;
}

function syncModalSelects() {
  // Concept dropdown: every concept (mirrors the movement-form behaviour).
  const sel = elements.recurringConcept;
  if (!sel) return;
  const concepts = state.settings.concepts.slice().sort((a, b) =>
    a.label.localeCompare(b.label, "es", { sensitivity: "base" })
  );
  sel.innerHTML = optionMarkup(concepts);

  if (elements.recurringCategory) {
    elements.recurringCategory.innerHTML = optionMarkup(state.settings.categories);
    const matching = state.settings.concepts.find((c) => c.label === sel.value);
    if (matching) elements.recurringCategory.value = matching.category;
  }

  // Shared target picker: contactos + grupos con prefijos. Mismo
  // patrón que el modal de gasto (parseSharedTarget en shared.js).
  if (elements.recurringSharedContact) {
    const contacts = state.contacts.slice().sort((a, b) =>
      a.name.localeCompare(b.name, "es", { sensitivity: "base" })
    );
    const groups = getMyGroups().slice().sort((a, b) =>
      a.name.localeCompare(b.name, "es", { sensitivity: "base" })
    );
    let html = '<option value="">Solo personal (sin compartir)</option>';
    if (contacts.length) {
      html += '<optgroup label="Contactos">';
      html += contacts.map((c) => `<option value="contact:${c.id}">${c.name}</option>`).join("");
      html += "</optgroup>";
    }
    if (groups.length) {
      html += '<optgroup label="Grupos">';
      html += groups.map((g) => `<option value="group:${g.id}">${g.name}</option>`).join("");
      html += "</optgroup>";
    }
    elements.recurringSharedContact.innerHTML = html;
  }
}

// Visibilidad del bloque "Día del mes" + "Mes del año". Por defecto se
// derivan de la fecha de inicio y los inputs quedan ocultos para no
// añadir ruido. Si el usuario quiere desacoplar (caso edge: empezar el
// 27 pero repetir el día 1), pulsa "Personalizar día de repetición" y
// pasamos a modo manual — entonces el cambio de fecha NO machaca los
// valores.
let customizeDayMode = false;

function syncDayMonthVisibility() {
  const yearly = elements.recurringPeriodicity?.value === "yearly";
  if (elements.recurringDayOfMonthField) {
    elements.recurringDayOfMonthField.hidden = !customizeDayMode;
  }
  if (elements.recurringMonthOfYearField) {
    // Mes del año solo aplica si periodicity es anual; además requiere
    // que estemos en modo personalizado para mostrarse como input
    // editable. Si no, el valor sigue presente (lo derivamos en sync)
    // pero el input no se ve.
    elements.recurringMonthOfYearField.hidden = !customizeDayMode || !yearly;
  }
  if (elements.recurringCustomizeDayToggle) {
    elements.recurringCustomizeDayToggle.textContent = customizeDayMode
      ? "Volver a derivar de la fecha"
      : "Personalizar día de repetición";
    elements.recurringCustomizeDayToggle.setAttribute("aria-expanded", String(customizeDayMode));
  }
}

// Sincroniza día/mes a partir del input "Empieza el". Solo se aplica
// cuando NO estamos en modo personalizado — si el usuario ya tocó esos
// campos a mano, respetamos su decisión.
function syncDayMonthFromStartDate() {
  if (customizeDayMode) return;
  const iso = elements.recurringStartDate?.value;
  if (!iso) return;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return;
  if (elements.recurringDayOfMonth) elements.recurringDayOfMonth.value = d;
  if (elements.recurringMonthOfYear) elements.recurringMonthOfYear.value = m;
}

// Mantenido para compat con llamadas existentes a la antigua función:
// ahora delega en el sync conjunto.
function syncMonthOfYearVisibility() {
  syncDayMonthVisibility();
}

function syncSharedFieldsVisibility() {
  const value = elements.recurringSharedContact?.value || "";
  const target = parseSharedTarget(value);
  const isGroup = target.kind === "group";
  const isContact = target.kind === "contact";

  // Bloque 1↔1 (modo + uneven): solo cuando hay un contacto seleccionado.
  if (elements.recurringSharedFields) {
    elements.recurringSharedFields.hidden = !isContact;
  }
  // Info de grupo: cuando se selecciona un grupo, mostrar pista con
  // el reparto que aplicará el motor. Tres casos posibles:
  //   - hay groupSplit pendiente (heredado de un gasto desigual al
  //     convertir): se respetan esos porcentajes.
  //   - el grupo tiene default uneven: se usa ese.
  //   - en otro caso: partes iguales.
  if (elements.recurringSharedGroupInfo) {
    elements.recurringSharedGroupInfo.hidden = !isGroup;
    if (isGroup) {
      const group = getGroupById(target.id);
      const members = getGroupMembers(target.id);
      let modeText;
      if (pendingGroupSplit) {
        modeText = "los porcentajes que ya tenía el gasto original";
      } else if (group?.defaultSplitMode === "uneven") {
        modeText = "porcentajes definidos en el grupo";
      } else {
        modeText = "partes iguales";
      }
      const memberCount = members.length;
      if (elements.recurringGroupHint) {
        elements.recurringGroupHint.textContent =
          `Cada generación creará una entrada compartida en "${group?.name ?? "el grupo"}" repartiendo el importe entre ${memberCount} miembro${memberCount === 1 ? "" : "s"} según ${modeText}. El pagador será siempre tú.`;
      }
    }
  }

  syncSharedUnevenVisibility();
}

function syncSharedUnevenVisibility() {
  if (!elements.recurringSharedUneven) return;
  const target = parseSharedTarget(elements.recurringSharedContact?.value || "");
  if (target.kind !== "contact") {
    elements.recurringSharedUneven.hidden = true;
    return;
  }
  const modeKey = elements.recurringSharedMode?.value;
  const isUneven = modeKey && SHARED_MODES[modeKey]?.split === "uneven";
  elements.recurringSharedUneven.hidden = !isUneven;
}

function resetRecurringForm(template = null, prefill = null) {
  const form = elements.recurringForm;
  if (!form) return;
  form.reset();

  // Estado del split custom para esta apertura del modal: si el seed
  // (template editada o prefill de conversión) trae groupSplit, lo
  // arrastramos al submit.
  pendingGroupSplit = template?.groupSplit ?? prefill?.groupSplit ?? null;

  syncModalSelects();
  // Refrescar sugerencias del datalist de Emisor / receptor — el form
  // de plantilla comparte el mismo datalist (#party-suggestions) que
  // el modal de movimiento.
  syncPartySuggestions();

  const seed = template ?? prefill;
  const today = todayLocal();
  const startDate = seed?.startDate ? parseIsoDate(seed.startDate) : today;
  const endDate = seed?.endDate ? parseIsoDate(seed.endDate) : null;

  elements.recurringType.value = seed?.type ?? "expense";
  elements.recurringConcept.value = seed?.concept ?? elements.recurringConcept.options[0]?.value ?? "";
  elements.recurringAmount.value = seed?.amount ?? "";
  if (seed?.category) elements.recurringCategory.value = seed.category;
  elements.recurringParty.value = seed?.party ?? "";
  elements.recurringNote.value = seed?.note ?? "";
  elements.recurringPeriodicity.value = seed?.periodicity ?? "monthly";
  // Derivamos día y mes desde la fecha de inicio salvo que el seed
  // traiga valores explícitos que no coincidan con la fecha — en ese
  // caso entramos en modo "personalizado" y los exponemos.
  const dayFromStart = startDate.getDate();
  const monthFromStart = startDate.getMonth() + 1;
  const seedDay = seed?.dayOfMonth ?? dayFromStart;
  const seedMonth = seed?.monthOfYear ?? monthFromStart;
  elements.recurringDayOfMonth.value = seedDay;
  elements.recurringMonthOfYear.value = seedMonth;
  const yearly = (seed?.periodicity ?? "monthly") === "yearly";
  customizeDayMode =
    seedDay !== dayFromStart || (yearly && seedMonth !== monthFromStart);
  setRecurringStartDate(startDate);
  setRecurringEndDate(endDate);

  if (elements.recurringSharedContact) {
    if (seed?.groupId) {
      elements.recurringSharedContact.value = `group:${seed.groupId}`;
    } else if (seed?.sharedContactId) {
      elements.recurringSharedContact.value = `contact:${seed.sharedContactId}`;
    } else {
      elements.recurringSharedContact.value = "";
    }
  }
  if (elements.recurringSharedMode) {
    const modeKey = seed
      ? `${seed.sharedPaidBy ?? "me"}-${seed.sharedSplitMode ?? "equal"}`
      : "me-equal";
    elements.recurringSharedMode.value = modeKey;
  }
  if (elements.recurringSharedMyShare) {
    elements.recurringSharedMyShare.value = seed?.sharedMyShare ?? "";
  }
  if (elements.recurringSharedTheirShare) {
    elements.recurringSharedTheirShare.value = seed?.sharedTheirShare ?? "";
  }

  syncDayMonthVisibility();
  syncSharedFieldsVisibility();
  refreshNotePreview();

  if (elements.recurringSubmitLabel) {
    elements.recurringSubmitLabel.textContent = template
      ? "Guardar cambios"
      : "Crear plantilla";
  }
  state.editingRecurringTemplateId = template?.id ?? null;
}

function openCreateRecurringModal() {
  convertingFromMovementId = null;
  convertingFromSharedEntryId = null;
  resetRecurringForm(null);
  if (elements.recurringFeedback) elements.recurringFeedback.textContent = "";
  openRecurringModal();
  elements.recurringConcept?.focus();
}

function openEditRecurringModal(template) {
  convertingFromMovementId = null;
  convertingFromSharedEntryId = null;
  resetRecurringForm(template);
  if (elements.recurringFeedback) elements.recurringFeedback.textContent = "";
  openRecurringModal();
}

// Entry point used from the movement modal "Convertir en plantilla
// periódica" button. The source movement stays in place; we link it to
// the new template (set its recurringTemplateId so the 🔁 indicator
// appears) and seed the template with lastGeneratedDate equal to the
// movement's date, so the engine never duplicates that first occurrence.
export function openConvertFromMovement(movement) {
  if (!movement) return;
  convertingFromMovementId = movement.id;
  convertingFromSharedEntryId = null;
  const date = movement.date ? parseIsoDate(movement.date) : todayLocal();

  // Si el movimiento de origen está asociado a una shared_entry de
  // grupo, propagamos el groupId al prefill de la plantilla (también
  // el importe TOTAL del gasto, no la parte personal del usuario, que
  // es lo que muestra movement.amount). Para 1↔1 legacy y movimientos
  // sin compartido, el prefill se queda como hasta ahora.
  let totalAmount = movement.amount;
  let groupId = null;
  let groupSplit = null;
  let sharedContactId = null;
  let sharedSplitMode = null;
  let sharedPaidBy = null;
  if (movement.sharedEntryId) {
    const linkedEntry = state.sharedEntries.find(
      (e) => e.id === movement.sharedEntryId
    );
    if (linkedEntry) {
      totalAmount = Number(linkedEntry.total) || movement.amount;
      if (linkedEntry.groupId) {
        groupId = linkedEntry.groupId;
        // Si la entrada origen tiene un reparto desigual (p. ej. 50/30/20%),
        // lo persistimos en la plantilla como porcentajes para que las
        // generaciones futuras lo respeten incluso si cambia el importe.
        // Si la entrada usaba el default del grupo (modo "equal"), lo
        // dejamos null para que herede el default vivo del grupo.
        if (
          linkedEntry.splitMode === "uneven" &&
          linkedEntry.splits &&
          totalAmount > 0
        ) {
          const percents = {};
          for (const [memberId, split] of Object.entries(linkedEntry.splits)) {
            const owes = Number(split?.owes) || 0;
            percents[memberId] = (owes / totalAmount) * 100;
          }
          groupSplit = percents;
        }
      } else if (linkedEntry.contactId) {
        sharedContactId = linkedEntry.contactId;
        sharedSplitMode = linkedEntry.splitMode;
        sharedPaidBy = linkedEntry.paidBy;
      }
    }
  }

  resetRecurringForm(null, {
    type: movement.type,
    concept: movement.concept,
    amount: totalAmount,
    category: movement.category,
    party: movement.party,
    note: movement.note,
    periodicity: "monthly",
    dayOfMonth: date.getDate(),
    monthOfYear: date.getMonth() + 1,
    startDate: movement.date,
    groupId,
    groupSplit,
    sharedContactId,
    sharedSplitMode,
    sharedPaidBy,
  });
  if (elements.recurringFeedback) {
    elements.recurringFeedback.textContent =
      "El movimiento original se enlaza a la plantilla; la siguiente ocurrencia se generará automáticamente.";
  }
  if (elements.recurringSubmitLabel) {
    elements.recurringSubmitLabel.textContent = "Crear plantilla y enlazar";
  }
  openRecurringModal();
  elements.recurringConcept?.focus();
}

// Variante para gastos compartidos sin movement asociado (modos `me-full`
// y `them-full`, donde la app no crea movement personal). El botón
// "Convertir en plantilla periódica" del modal de edición de shared
// entry llama aquí. La plantilla queda con lastGeneratedDate = entry.date
// para evitar que el motor duplique esa primera ocurrencia.
//
// Nota: hoy no enlazamos hacia atrás (el shared_entry no guarda
// recurringTemplateId — añadirlo requeriría migración SQL). Si el
// usuario borra la plantilla más tarde, la entry origen sigue viva
// como gasto puntual, sin badge 🔁. Aceptable v1.
export function openConvertFromSharedEntry(entry) {
  if (!entry) return;
  convertingFromMovementId = null;
  convertingFromSharedEntryId = entry.id;
  const date = entry.date ? parseIsoDate(entry.date) : todayLocal();
  const totalAmount = Number(entry.total) || 0;

  // Las shared_entries no llevan category. La inferimos del concept
  // catalog del usuario, con fallback a la primera categoría conocida.
  const conceptDef = state.settings.concepts.find((c) => c.label === entry.concept);
  const category = conceptDef?.category ?? state.settings.categories[0]?.value ?? "extra";

  let groupId = null;
  let groupSplit = null;
  let sharedContactId = null;
  let sharedSplitMode = null;
  let sharedPaidBy = null;
  let sharedMyShare = null;
  let sharedTheirShare = null;
  if (entry.groupId) {
    groupId = entry.groupId;
    if (entry.splitMode === "uneven" && entry.splits && totalAmount > 0) {
      const percents = {};
      for (const [memberId, split] of Object.entries(entry.splits)) {
        const owes = Number(split?.owes) || 0;
        percents[memberId] = (owes / totalAmount) * 100;
      }
      groupSplit = percents;
    }
  } else if (entry.contactId) {
    sharedContactId = entry.contactId;
    sharedSplitMode = entry.splitMode;
    sharedPaidBy = entry.paidBy;
    if (entry.splitMode === "uneven") {
      sharedMyShare = entry.myShare;
      sharedTheirShare = entry.theirShare;
    }
  }

  resetRecurringForm(null, {
    type: "expense",
    concept: entry.concept,
    amount: totalAmount,
    category,
    party: "",
    note: entry.note ?? "",
    periodicity: "monthly",
    dayOfMonth: date.getDate(),
    monthOfYear: date.getMonth() + 1,
    startDate: entry.date,
    groupId,
    groupSplit,
    sharedContactId,
    sharedSplitMode,
    sharedPaidBy,
    sharedMyShare,
    sharedTheirShare,
  });
  if (elements.recurringFeedback) {
    elements.recurringFeedback.textContent =
      "El gasto compartido se enlaza a la plantilla; las próximas ocurrencias se generarán automáticamente.";
  }
  if (elements.recurringSubmitLabel) {
    elements.recurringSubmitLabel.textContent = "Crear plantilla y enlazar";
  }
  openRecurringModal();
  elements.recurringConcept?.focus();
}

// ---- DOM wiring --------------------------------------------------------

elements.openRecurringModal?.addEventListener("click", openCreateRecurringModal);
elements.closeRecurringModal?.addEventListener("click", closeRecurringModal);
elements.recurringModal?.addEventListener("click", (event) => {
  if (event.target === elements.recurringModal) closeRecurringModal();
});

elements.recurringPeriodicity?.addEventListener("change", syncDayMonthVisibility);

// Cambio de fecha "Empieza el": si NO estamos en modo personalizado,
// re-derivamos día/mes para que sigan reflejando la nueva fecha.
elements.recurringStartDate?.addEventListener("change", syncDayMonthFromStartDate);

elements.recurringCustomizeDayToggle?.addEventListener("click", () => {
  customizeDayMode = !customizeDayMode;
  if (!customizeDayMode) {
    // Al volver al modo derivado, re-sincronizamos por si el usuario
    // había puesto valores distintos a la fecha.
    syncDayMonthFromStartDate();
  }
  syncDayMonthVisibility();
});

elements.recurringConcept?.addEventListener("change", () => {
  const concept = state.settings.concepts.find(
    (c) => c.label === elements.recurringConcept.value
  );
  if (concept && elements.recurringCategory) {
    // Income templates always anchor on the "ingreso" category, mirroring
    // syncCategoryFromConcept in features/movements.js.
    elements.recurringCategory.value =
      elements.recurringType.value === "income" ? "ingreso" : concept.category;
  }
});

elements.recurringType?.addEventListener("change", () => {
  // Toggle hides the sharing block when type=income (we only support
  // shared expenses, like the rest of the app).
  if (elements.recurringType.value === "income" && elements.recurringSharedContact) {
    elements.recurringSharedContact.value = "";
  }
  syncSharedFieldsVisibility();
});

elements.recurringSharedContact?.addEventListener("change", () => {
  // Cambiar de grupo (o pasar a contacto / sin compartir) invalida el
  // split custom del seed previo: sus member_ids ya no apuntan al grupo
  // seleccionado. El motor usará el default del nuevo grupo.
  pendingGroupSplit = null;
  syncSharedFieldsVisibility();
});
elements.recurringSharedMode?.addEventListener("change", syncSharedUnevenVisibility);

// Live preview of placeholder substitution under the note input. Shown
// only when the note actually contains [token]s, so a plain note doesn't
// add visual noise. The preview uses today's date as the reference (the
// user is typing now, so "this month" reads the most natural).
function refreshNotePreview() {
  const preview = elements.recurringNotePreview;
  if (!preview) return;
  const raw = elements.recurringNote?.value ?? "";
  if (!/\[[^\]]+\]/.test(raw)) {
    preview.hidden = true;
    preview.textContent = "";
    return;
  }
  const todayIso = toIsoDate(todayLocal());
  const rendered = applyTemplatePlaceholders(raw, todayIso);
  preview.hidden = false;
  preview.textContent = `Hoy se vería: ${rendered}`;
}

elements.recurringNote?.addEventListener("input", refreshNotePreview);

const isMobileViewport = () => window.matchMedia("(max-width: 719px)").matches;

function collapseExpandedRecurring() {
  if (!state.expandedRecurringId) return;
  const previous = elements.recurringList?.querySelector(".recurring-row.is-expanded");
  previous?.classList.remove("is-expanded");
  state.expandedRecurringId = null;
}

elements.recurringList?.addEventListener("click", (event) => {
  const row = event.target.closest(".recurring-row--item");
  if (!row) return;
  const id = row.dataset.id;

  // Action buttons: handle the destructive/edit ops and bail. Don't
  // toggle expansion in this case — the user clicked a button, not the
  // card body.
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action) {
    if (action === "delete") return deleteTemplate(id);
    if (action === "toggle") return toggleTemplateActive(id);
    if (action === "edit") {
      const template = state.recurringTemplates.find((x) => x.id === id);
      if (template) openEditRecurringModal(template);
    }
    return;
  }

  // Mobile-only: tap on the body toggles the collapsed/expanded state.
  // Desktop never changes state — the row already shows everything.
  if (!isMobileViewport()) return;

  if (state.expandedRecurringId === id) {
    collapseExpandedRecurring();
  } else {
    collapseExpandedRecurring();
    row.classList.add("is-expanded");
    state.expandedRecurringId = id;
  }
});

elements.recurringForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  // Garantía: si los campos día/mes están ocultos (modo derivado), nos
  // aseguramos de que sus values están alineados con "Empieza el" antes
  // de leer el FormData. Sin esto, una secuencia como cambiar la fecha
  // tras un reset podría dejar el value vacío en algún navegador.
  syncDayMonthFromStartDate();
  const formData = new FormData(elements.recurringForm);

  const editingId = state.editingRecurringTemplateId;
  const draft = createTemplateFromForm(formData);

  // Validate uneven shares match the total when shared+uneven.
  if (draft.sharedContactId && draft.sharedSplitMode === "uneven") {
    const sum = Math.round(((draft.sharedMyShare ?? 0) + (draft.sharedTheirShare ?? 0)) * 100) / 100;
    if (Math.abs(sum - draft.amount) >= 0.005) {
      if (elements.recurringFeedback) {
        elements.recurringFeedback.textContent =
          `Las partes (${formatMoney(sum)}) no coinciden con el total (${formatMoney(draft.amount)}).`;
      }
      return;
    }
  }

  if (editingId) {
    const existing = state.recurringTemplates.find((x) => x.id === editingId);
    if (!existing) return;
    // Preserve identity-bearing fields. Editing the importe must NOT
    // rewrite past generations (already in state.movements as immutable
    // snapshots); we only change forward generation by leaving
    // lastGeneratedDate untouched.
    Object.assign(existing, draft, {
      id: existing.id,
      createdAt: existing.createdAt,
      lastGeneratedDate: existing.lastGeneratedDate,
      isActive: existing.isActive,
    });
  } else {
    // Convert mode: seed lastGeneratedDate with the source's date so
    // the engine treats that occurrence as already produced (avoids
    // generating a duplicate on next reload). Dos variantes según
    // la fuente sea un movement (típico) o un shared_entry sin
    // movement asociado (modo `me-full` / `them-full`).
    if (convertingFromMovementId) {
      const source = state.movements.find((m) => m.id === convertingFromMovementId);
      if (source) {
        draft.lastGeneratedDate = source.date;
        // Backreference so the original movement renders the 🔁 badge.
        source.recurringTemplateId = draft.id;
        saveMovements();
      }
    } else if (convertingFromSharedEntryId) {
      const sourceEntry = state.sharedEntries.find(
        (e) => e.id === convertingFromSharedEntryId
      );
      if (sourceEntry) {
        draft.lastGeneratedDate = sourceEntry.date;
        // Sin backreference (las shared_entries no tienen
        // recurringTemplateId field). El badge 🔁 solo aparece en
        // movements que vienen de plantilla; las entries originales
        // siguen como gasto puntual.
      }
    }
    state.recurringTemplates = [draft, ...state.recurringTemplates];
  }

  saveRecurringTemplates();
  renderRecurringView();
  // Reset before closing so a follow-up "Nueva plantilla" doesn't carry
  // the convert state over.
  convertingFromMovementId = null;
  convertingFromSharedEntryId = null;
  // Re-render movements so the source row immediately picks up the
  // 🔁 indicator after a convert-and-link.
  import("./movements.js").then((m) => m.renderMovements?.());
  closeRecurringModal();
});
