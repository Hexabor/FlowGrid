// Bandeja de entrada: propuestas de movimientos preparadas por una IA.
//
// Flujo: el chat (ChatGPT, Claude…) genera un JSON "flowgrid": 1 con una
// lista de items. Llegan a la tabla `inbox_items` (pegando el JSON aquí o,
// más adelante, vía conector). Nada se escribe en los datos reales hasta
// que el usuario acepta cada propuesta.
//
// Aceptar reutiliza los formularios existentes en vez de duplicar su
// lógica: rellenamos el modal de movimiento (o el de plantilla periódica)
// con la propuesta y lo enviamos por detrás con requestSubmit(). Si el
// submit rechaza algo (validación), abrimos el modal visible con el
// mensaje de error para que el usuario lo corrija. Las liquidaciones y
// adelantos se construyen directamente con buildSharedPaymentEntry, igual
// que el submit del modal de pago.
//
// Formato de un item (ver también features/inbox-prompt.js, que genera
// las instrucciones para la IA):
//   { kind: "movement" | "payment",
//     type: "expense" | "income", date: "YYYY-MM-DD", amount: 12.5,
//     concept, party?, note?, comment?,
//     shared?: { with, mode? | payer?+split?, my_share?, their_share?, shares? },
//     recurring?: { periodicity: "monthly" | "yearly", end_date? },
//     // solo payment:
//     with, paid_by: "me" | "them", advance?: bool }

import { state } from "../core/state.js";
import { elements, openMovementModal, setView } from "../core/dom.js";
import { saveSharedEntries } from "../core/storage.js";
import { SHARED_MODES } from "../core/constants.js";
import { createId, formatDate, formatMoney, toIsoDate } from "../core/utils.js";
import { cloudFetchInbox, cloudInsertInbox, cloudResolveInboxItem } from "../core/cloud.js";
import {
  getAllMovements,
  getConceptsForType,
  renderMovements,
  resetMovementForm,
  syncMovementSelects,
  syncTypeToggle,
} from "./movements.js";
import {
  buildSharedPaymentEntry,
  computeSharedShares,
  renderSharedView,
  syncSharedFields,
  syncSharedGroupSharesGrid,
  syncSharedGroupTotalHint,
  syncSharedModeLabels,
  syncSharedTargetKind,
  syncSharedTotalHint,
  syncSharedUnevenVisibility,
} from "./shared.js";
import { getContactName } from "./contacts.js";
import { getGroupById, getGroupMembers, getMyMemberInGroup, resolveMemberView } from "./groups.js";
import { generatePendingRecurrences, prefillRecurringForm, renderRecurringView } from "./recurring.js";
import { renderAnalysis } from "./analysis.js";
import { buildAiInstructions } from "./inbox-prompt.js";
import { setMovementDate } from "../ui/datepicker.js";
import { showToast } from "../ui/toast.js";
import { showConfirm } from "../ui/confirm.js";

// Correcciones hechas por el usuario desde la propia tarjeta (concepto o
// destinatario que la IA escribió mal). Solo en memoria: se aplican al
// aceptar. id del item → { concept?, target? }.
const overrides = new Map();

// Item cuyo formulario está abierto de forma visible ("Revisar"). Si el
// usuario guarda, lo marcamos como aceptado; si cierra, se olvida.
let reviewingItemId = null;
let busy = false;

// ---- normalización ----------------------------------------------------

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const ME_WORDS = new Set(["me", "yo", "tu", "mi", "i", "self"]);

function isMeWord(value) {
  return ME_WORDS.has(normalizeText(value));
}

function parseAmount(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;
  let text = value.replace(/[\s€]/g, "");
  // "1.234,56" → "1234.56"; "12,5" → "12.5"; "12.50" se respeta.
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  return Number(text);
}

function parseDate(value) {
  const text = String(value ?? "").trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y, m, d;
  if (match) {
    [, y, m, d] = match.map(Number);
  } else {
    match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;
    [, d, m, y] = match.map(Number);
  }
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return toIsoDate(date);
}

function roundCents(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// ---- resolución de nombres --------------------------------------------

function findConcept(label, type) {
  const wanted = normalizeText(label);
  if (!wanted) return null;
  return getConceptsForType(type).find((c) => normalizeText(c.label) === wanted) ?? null;
}

// Busca por nombre exacto (sin tildes ni mayúsculas) y, si no hay, por
// coincidencia única de prefijo ("Ana" → "Ana María").
function findByName(list, name, getName) {
  const wanted = normalizeText(name);
  if (!wanted) return null;
  const exact = list.filter((x) => normalizeText(getName(x)) === wanted);
  if (exact.length === 1) return exact[0];
  const prefix = list.filter((x) => normalizeText(getName(x)).startsWith(wanted));
  if (prefix.length === 1) return prefix[0];
  return null;
}

// Destino de un compartido o pago: { kind: "contact" | "group", id } o null.
function findTarget(name, { allowGroups = true } = {}) {
  const contact = findByName(state.contacts, name, (c) => c.name);
  if (contact) return { kind: "contact", id: contact.id };
  if (!allowGroups) return null;
  const group = findByName(state.groups, name, (g) => g.name);
  if (group) return { kind: "group", id: group.id };
  return null;
}

function findGroupMember(groupId, name) {
  if (isMeWord(name)) return getMyMemberInGroup(groupId);
  return findByName(getGroupMembers(groupId), name, (m) => resolveMemberView(m).label)
    ?? findByName(getGroupMembers(groupId), name, (m) => m.displayName);
}

// Modo 1↔1 a partir de "mode" o del par payer/split.
function resolveContactMode(shared) {
  if (shared.mode && SHARED_MODES[shared.mode]) return shared.mode;
  const payer = shared.payer ?? shared.paid_by;
  const split = normalizeText(shared.split);
  if (!payer || !split) return null;
  const who = isMeWord(payer) ? "me" : "them";
  const kind = { equal: "equal", iguales: "equal", uneven: "uneven", desigual: "uneven", full: "full", total: "full" }[split];
  return kind ? `${who}-${kind}` : null;
}

// ---- interpretación de una propuesta ----------------------------------
//
// Devuelve todo lo que la tarjeta y el aceptar necesitan:
//   { kind, draft, target, issues: [{text, blocking}], lines: [], duplicates: [] }
// `blocking` impide aceptar directamente (queda "Revisar" o descartar).

export function interpretItem(item) {
  const raw = item.payload ?? {};
  const fix = overrides.get(item.id) ?? {};
  const issues = [];
  const block = (text) => issues.push({ text, blocking: true });
  const warn = (text) => issues.push({ text, blocking: false });

  const kind = raw.kind === "payment" ? "payment" : "movement";
  const type = raw.type === "income" ? "income" : "expense";
  const date = parseDate(raw.date);
  const amount = roundCents(parseAmount(raw.amount));

  if (!date) block(`Fecha no válida: «${raw.date ?? ""}».`);
  if (!Number.isFinite(amount) || amount <= 0) block(`Importe no válido: «${raw.amount ?? ""}».`);

  const result = { kind, type, date, amount, issues, raw, target: null, draft: null };

  if (kind === "payment") {
    const name = raw.with ?? raw.contact;
    const target = fix.target ?? findTarget(name, { allowGroups: false });
    if (!target) block(name ? `No encuentro el contacto «${name}».` : "Falta con quién es el pago.");
    const paidBy = isMeWord(raw.paid_by) ? "me" : raw.paid_by === "them" || raw.paid_by ? "them" : null;
    if (!paidBy) block("Falta quién pagó (paid_by: me / them).");
    result.target = target;
    result.draft = {
      contactId: target?.id ?? null,
      total: amount,
      paidBy,
      date,
      note: String(raw.note ?? "").trim(),
      advance: Boolean(raw.advance),
      concept: String(raw.concept ?? "").trim(),
    };
    return result;
  }

  // Movimiento (con o sin compartido / periódico).
  const conceptLabel = fix.concept ?? raw.concept;
  const concept = findConcept(conceptLabel, type);
  if (!concept) {
    block(conceptLabel
      ? `El concepto «${conceptLabel}» no existe para ${type === "income" ? "ingresos" : "gastos"}.`
      : "Falta el concepto.");
  }
  const category = type === "income" ? "ingreso" : concept?.category ?? null;

  const draft = {
    type,
    date,
    amount,
    concept: concept?.label ?? null,
    category,
    party: String(raw.party ?? "").trim(),
    note: String(raw.note ?? "").trim(),
    shared: null,
    recurring: null,
  };
  result.draft = draft;

  const shared = raw.shared && typeof raw.shared === "object" ? raw.shared : null;
  if (shared) {
    if (type !== "expense") block("Solo los gastos pueden ser compartidos.");
    const name = shared.with ?? shared.group ?? shared.contact;
    const target = fix.target ?? (shared.group
      ? (() => { const g = findByName(state.groups, shared.group, (x) => x.name); return g ? { kind: "group", id: g.id } : null; })()
      : findTarget(name));
    result.target = target;
    if (!target) {
      block(name ? `No encuentro el contacto o grupo «${name}».` : "Falta con quién se comparte.");
    } else if (target.kind === "contact") {
      const modeKey = resolveContactMode(shared);
      if (!modeKey) block("Falta quién pagó y cómo se reparte.");
      let myShare = null;
      let theirShare = null;
      if (modeKey && Number.isFinite(amount)) {
        const computed = computeSharedShares(
          amount,
          modeKey,
          parseAmount(shared.my_share),
          parseAmount(shared.their_share)
        );
        myShare = computed.myShare;
        theirShare = computed.theirShare;
        if (SHARED_MODES[modeKey].split === "uneven"
          && Math.abs(roundCents(myShare + theirShare) - amount) >= 0.005) {
          block(`Las partes (${formatMoney(myShare + theirShare)}) no suman el total.`);
        }
      }
      draft.shared = { kind: "contact", contactId: target.id, modeKey, myShare, theirShare };
    } else {
      const groupId = target.id;
      const payerName = shared.payer ?? shared.paid_by ?? "me";
      const payer = findGroupMember(groupId, payerName);
      if (!payer) block(`No encuentro a «${payerName}» en el grupo.`);
      const split = normalizeText(shared.split) === "uneven" ? "uneven" : "equal";
      let perMember = null;
      if (split === "uneven") {
        perMember = {};
        let sum = 0;
        for (const [who, value] of Object.entries(shared.shares ?? {})) {
          const member = findGroupMember(groupId, who);
          if (!member) {
            block(`No encuentro a «${who}» en el grupo.`);
            continue;
          }
          perMember[member.id] = roundCents(parseAmount(value));
          sum += perMember[member.id];
        }
        if (Math.abs(roundCents(sum) - amount) >= 0.005) {
          block(`Las partes del grupo (${formatMoney(sum)}) no suman el total.`);
        }
      }
      const me = getMyMemberInGroup(groupId);
      let myShare;
      if (split === "equal") {
        const count = getGroupMembers(groupId).length || 1;
        myShare = roundCents(amount / count);
      } else {
        myShare = me ? perMember?.[me.id] ?? 0 : 0;
      }
      draft.shared = { kind: "group", groupId, payerMemberId: payer?.id ?? null, split, perMember, myShare, payerIsMe: payer?.id === me?.id };
    }
  }

  const recurring = raw.recurring && typeof raw.recurring === "object" ? raw.recurring : null;
  if (recurring) {
    const p = normalizeText(recurring.periodicity);
    const periodicity = ["monthly", "mensual"].includes(p) ? "monthly" : ["yearly", "anual"].includes(p) ? "yearly" : null;
    if (!periodicity) block(`Periodicidad «${recurring.periodicity ?? ""}» no admitida (solo mensual o anual).`);
    const endDate = recurring.end_date ? parseDate(recurring.end_date) : null;
    if (recurring.end_date && !endDate) block(`Fecha de fin no válida: «${recurring.end_date}».`);
    if (draft.shared?.kind === "group" && draft.shared.payerMemberId && !draft.shared.payerIsMe) {
      block("Los periódicos de grupo solo admiten que pagues tú.");
    }
    draft.recurring = { periodicity, endDate };
  }

  const cleanRecurring = draft.recurring && !issues.some((i) => i.blocking);
  if (cleanRecurring && date && date < toIsoDate(new Date())) {
    warn(`Al crear la plantilla se generarán solas todas las ocurrencias desde ${formatDate(date)} hasta hoy.`);
  }

  return result;
}

// ---- duplicados --------------------------------------------------------

function daysBetween(a, b) {
  return Math.abs((new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / 86400000);
}

function sameMoney(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.01;
}

// Posibles coincidencias ya registradas. Criterio: fecha a ±3 días y
// mismo importe (total o tu parte), o mismo concepto con importe
// parecido. Devuelve hasta 3, las más cercanas primero.
export function findDuplicates(info, item) {
  if (!info.date || !Number.isFinite(info.amount)) return [];
  const amounts = [info.amount];
  if (info.draft?.shared?.myShare != null) amounts.push(info.draft.shared.myShare);
  const conceptKey = normalizeText(info.draft?.concept ?? info.raw.concept);
  const hits = [];

  if (info.kind === "movement") {
    for (const m of getAllMovements()) {
      if (m.type !== info.type) continue;
      const days = daysBetween(m.date, info.date);
      if (days > 3) continue;
      const exactAmount = amounts.some((a) => sameMoney(a, m.amount));
      const sameConcept = conceptKey && normalizeText(m.concept) === conceptKey;
      const closeAmount = amounts.some((a) => Math.abs(a - m.amount) <= Math.max(1, a * 0.1));
      if (exactAmount || (sameConcept && closeAmount)) {
        hits.push({ days, label: `${formatDate(m.date)} · ${m.concept} · ${formatMoney(m.amount)}${m.party ? ` · ${m.party}` : ""}` });
      }
    }
  }

  // Entradas compartidas sin movimiento propio (préstamos, pagos).
  if (info.kind === "payment" || info.draft?.shared) {
    for (const e of state.sharedEntries) {
      if (e.sourceMovementId && info.kind === "movement") continue;
      const days = daysBetween(e.date, info.date);
      if (days > 3 || !sameMoney(e.total, info.amount)) continue;
      if ((info.kind === "payment") !== (e.type === "payment")) continue;
      hits.push({ days, label: `${formatDate(e.date)} · ${e.concept} · ${formatMoney(e.total)} (compartido)` });
    }
  }

  // La misma propuesta repetida en la bandeja (p. ej. pegada dos veces).
  const index = state.inboxItems.findIndex((x) => x.id === item.id);
  for (const other of state.inboxItems.slice(0, Math.max(index, 0))) {
    const p = other.payload ?? {};
    if (parseDate(p.date) === info.date && sameMoney(parseAmount(p.amount), info.amount)
      && normalizeText(p.concept) === normalizeText(info.raw.concept)) {
      hits.push({ days: 0, label: "Esta misma propuesta ya está más arriba en la bandeja." });
    }
  }

  // Plantilla periódica parecida (solo si la propuesta es periódica).
  if (info.draft?.recurring) {
    for (const t of state.recurringTemplates) {
      if (normalizeText(t.concept) !== conceptKey || !t.isActive) continue;
      if (Math.abs(t.amount - info.amount) > Math.max(1, info.amount * 0.2)) continue;
      hits.push({ days: 0, label: `Ya tienes una plantilla periódica: ${t.concept} · ${formatMoney(t.amount)}` });
    }
  }

  return hits.sort((a, b) => a.days - b.days).slice(0, 3);
}

// ---- descripción legible ------------------------------------------------

function describe(info) {
  const lines = [];
  const d = info.draft;
  if (info.kind === "payment") {
    const name = info.target ? getContactName(info.target.id) : "?";
    const what = d.advance ? `Adelanto${d.concept ? ` para «${d.concept}»` : ""}` : "Liquidación";
    lines.push(d.paidBy === "me" ? `${what}: tú pagas a ${name}.` : `${what}: ${name} te paga.`);
    return lines;
  }
  const s = d.shared;
  if (s?.kind === "contact" && s.modeKey) {
    const name = getContactName(s.contactId);
    lines.push(`${SHARED_MODES[s.modeKey].label.replace("{name}", name)} con ${name}.`);
    if (s.myShare != null) {
      lines.push(s.myShare > 0 ? `Tu gasto: ${formatMoney(s.myShare)}.` : "No es gasto tuyo: solo queda la deuda en Compartidos.");
    }
  } else if (s?.kind === "group") {
    const group = getGroupById(s.groupId);
    const payer = s.payerMemberId ? resolveMemberView(state.groupMembers.find((m) => m.id === s.payerMemberId) ?? {}) : null;
    lines.push(`Grupo «${group?.name ?? "?"}», pagó ${payer?.isMe ? "tú" : payer?.label ?? "?"}, ${s.split === "uneven" ? "partes desiguales" : "a partes iguales"}.`);
    lines.push(`Tu parte: ${formatMoney(s.myShare)}.`);
  }
  if (d.recurring?.periodicity) {
    lines.push(`Periódico ${d.recurring.periodicity === "monthly" ? "mensual" : "anual"}${d.recurring.endDate ? ` hasta ${formatDate(d.recurring.endDate)}` : ""}.`);
  }
  return lines;
}

// ---- carga y render -----------------------------------------------------

export async function loadInbox() {
  try {
    state.inboxItems = await cloudFetchInbox();
  } catch (error) {
    // Sin la migración 14 la tabla no existe: bandeja vacía, sin ruido.
    console.warn("[inbox] no se pudo cargar", error);
    state.inboxItems = [];
  }
  renderInbox();
}

function pendingCount() {
  return state.inboxItems.length;
}

function renderBadges() {
  const count = pendingCount();
  if (elements.inboxOpenCount) {
    elements.inboxOpenCount.textContent = count ? String(count) : "";
    elements.inboxOpenCount.hidden = !count;
  }
  if (elements.homeInboxBanner) {
    elements.homeInboxBanner.hidden = !count;
    if (elements.homeInboxBannerText) {
      elements.homeInboxBannerText.textContent = count === 1
        ? "Tienes 1 propuesta esperando en la bandeja."
        : `Tienes ${count} propuestas esperando en la bandeja.`;
    }
  }
}

export function renderInbox() {
  renderBadges();
  const list = elements.inboxList;
  if (!list) return;
  list.innerHTML = "";

  const infos = state.inboxItems.map((item) => {
    const info = interpretItem(item);
    info.duplicates = findDuplicates(info, item);
    return { item, info };
  });

  const ready = infos.filter(({ info }) => isReady(info));
  elements.inboxCount.textContent = infos.length === 1 ? "1 propuesta" : `${infos.length} propuestas`;
  elements.inboxEmpty.hidden = infos.length > 0;
  elements.inboxBulk.hidden = infos.length === 0;
  elements.inboxAcceptReady.disabled = !ready.length || busy;
  elements.inboxAcceptReady.textContent = ready.length
    ? `Aceptar las ${ready.length} listas`
    : "Aceptar las listas";
  if (ready.length === 1) elements.inboxAcceptReady.textContent = "Aceptar la lista";

  for (const { item, info } of infos) {
    list.append(buildCard(item, info));
  }
}

function isReady(info) {
  return !info.issues.some((i) => i.blocking) && !info.duplicates.length;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buildCard(item, info) {
  const card = el("article", "inbox-card");
  card.dataset.itemId = item.id;
  const blocking = info.issues.some((i) => i.blocking);
  card.dataset.state = blocking ? "blocked" : info.duplicates.length ? "duplicate" : "ready";

  const head = el("div", "inbox-card-head");
  const title = el("div", "inbox-card-title");
  const conceptText = info.kind === "payment"
    ? (info.draft.advance ? "Adelanto" : "Liquidación")
    : info.draft.concept ?? info.raw.concept ?? "Sin concepto";
  title.append(el("strong", null, conceptText));
  const meta = [info.date ? formatDate(info.date) : "¿fecha?"];
  if (info.draft?.party) meta.push(info.draft.party);
  title.append(el("span", "inbox-card-meta", meta.join(" · ")));
  head.append(title);
  const sign = info.kind === "movement" && info.type === "income" ? "+" : "";
  const amount = el("span", `inbox-card-amount${info.type === "income" && info.kind === "movement" ? " is-income" : ""}`,
    Number.isFinite(info.amount) ? `${sign}${formatMoney(info.amount)}` : "¿importe?");
  head.append(amount);
  card.append(head);

  const lines = describe(info);
  if (info.draft?.note) lines.push(`Nota: ${info.draft.note}`);
  for (const line of lines) card.append(el("p", "inbox-card-line", line));

  if (info.raw.comment) {
    card.append(el("p", "inbox-card-comment", `La IA comenta: ${info.raw.comment}`));
  }

  for (const issue of info.issues) {
    card.append(el("p", `inbox-card-issue${issue.blocking ? " is-blocking" : ""}`, issue.text));
  }

  // Correcciones rápidas en la propia tarjeta.
  const needsConcept = info.kind === "movement" && !info.draft.concept;
  if (needsConcept) card.append(buildConceptFix(item, info));
  const needsTarget = (info.kind === "payment" || info.raw.shared) && !info.target;
  if (needsTarget) card.append(buildTargetFix(item, info));

  if (info.duplicates.length) {
    const box = el("div", "inbox-card-dupes");
    box.append(el("p", "inbox-card-dupes-title", "¿Ya lo tienes? Se parece a:"));
    const ul = el("ul");
    for (const d of info.duplicates) ul.append(el("li", null, d.label));
    box.append(ul);
    card.append(box);
  }

  const actions = el("div", "inbox-card-actions");
  const accept = el("button", "primary-action", info.duplicates.length ? "Aceptar igualmente" : "Aceptar");
  accept.type = "button";
  accept.dataset.inboxAction = "accept";
  accept.disabled = blocking || busy;
  actions.append(accept);
  if (info.kind === "movement") {
    const review = el("button", "ghost-action", "Revisar");
    review.type = "button";
    review.dataset.inboxAction = "review";
    review.disabled = busy;
    actions.append(review);
  }
  const discard = el("button", "ghost-action inbox-discard", "Descartar");
  discard.type = "button";
  discard.dataset.inboxAction = "discard";
  discard.disabled = busy;
  actions.append(discard);
  card.append(actions);
  return card;
}

function buildConceptFix(item, info) {
  const label = el("label", "inbox-card-fix");
  label.append(el("span", null, "Elegir concepto"));
  const select = document.createElement("select");
  select.dataset.inboxFix = "concept";
  select.append(new Option("—", ""));
  for (const c of getConceptsForType(info.type)) select.append(new Option(c.label, c.label));
  label.append(select);
  return label;
}

function buildTargetFix(item, info) {
  const label = el("label", "inbox-card-fix");
  label.append(el("span", null, info.kind === "payment" ? "Elegir contacto" : "Elegir contacto o grupo"));
  const select = document.createElement("select");
  select.dataset.inboxFix = "target";
  select.append(new Option("—", ""));
  const contacts = state.contacts.slice().sort((a, b) => a.name.localeCompare(b.name, "es"));
  for (const c of contacts) select.append(new Option(c.name, `contact:${c.id}`));
  if (info.kind !== "payment") {
    for (const g of state.groups) select.append(new Option(`Grupo: ${g.name}`, `group:${g.id}`));
  }
  label.append(select);
  return label;
}

// ---- aceptar ------------------------------------------------------------

// Rellena el modal de movimiento con la propuesta (sin abrirlo).
function fillMovementForm(draft) {
  resetMovementForm();
  elements.type.value = draft.type;
  syncTypeToggle();
  syncMovementSelects();
  elements.concept.value = draft.concept;
  elements.category.value = draft.category;
  setMovementDate(new Date(`${draft.date}T00:00:00`));
  elements.amount.value = draft.amount;
  elements.party.value = draft.party;
  elements.note.value = draft.note;

  const s = draft.shared;
  elements.isShared.checked = Boolean(s);
  syncSharedFields();
  if (!s) return;
  if (s.kind === "contact") {
    elements.sharedContact.value = `contact:${s.contactId}`;
    syncSharedTargetKind();
    syncSharedModeLabels();
    elements.sharedMode.value = s.modeKey;
    syncSharedUnevenVisibility();
    if (SHARED_MODES[s.modeKey]?.split === "uneven") {
      elements.sharedMyShare.value = s.myShare;
      elements.sharedTheirShare.value = s.theirShare;
    }
    syncSharedTotalHint();
  } else {
    elements.sharedContact.value = `group:${s.groupId}`;
    syncSharedTargetKind();
    if (s.payerMemberId) elements.sharedGroupPayer.value = s.payerMemberId;
    elements.sharedGroupMode.value = s.split;
    syncSharedGroupSharesGrid(s.groupId);
    if (s.split === "uneven") {
      elements.sharedGroupShares.querySelectorAll("[data-share-input]").forEach((input) => {
        input.value = s.perMember?.[input.dataset.memberId] ?? 0;
      });
    }
    syncSharedGroupTotalHint();
  }
}

function recurringSeed(draft) {
  const [y, m, d] = draft.date.split("-").map(Number);
  const s = draft.shared;
  let groupSplit = null;
  if (s?.kind === "group" && s.split === "uneven" && s.perMember) {
    groupSplit = {};
    for (const [id, owes] of Object.entries(s.perMember)) groupSplit[id] = (owes / draft.amount) * 100;
  }
  const mode = s?.kind === "contact" ? SHARED_MODES[s.modeKey] : null;
  return {
    type: draft.type,
    concept: draft.concept,
    amount: draft.amount,
    category: draft.category,
    party: draft.party,
    note: draft.note,
    periodicity: draft.recurring.periodicity,
    dayOfMonth: d,
    monthOfYear: m,
    startDate: draft.date,
    endDate: draft.recurring.endDate,
    groupId: s?.kind === "group" ? s.groupId : null,
    groupSplit,
    sharedContactId: s?.kind === "contact" ? s.contactId : null,
    sharedPaidBy: mode?.paidBy ?? null,
    sharedSplitMode: mode?.split ?? null,
    sharedMyShare: mode?.split === "uneven" ? s.myShare : null,
    sharedTheirShare: mode?.split === "uneven" ? s.theirShare : null,
  };
}

// Envía el modal de movimiento por detrás. Devuelve el detalle del
// guardado o null si el submit lo rechazó (el modal queda abierto).
async function submitMovementForm() {
  if (!elements.form.checkValidity()) {
    openMovementModal();
    elements.form.reportValidity();
    return null;
  }
  let saved = null;
  const onSaved = (event) => { saved = event.detail; };
  const settled = new Promise((resolve) => {
    document.addEventListener("fg:movement-form-settled", resolve, { once: true });
  });
  document.addEventListener("fg:movement-form-saved", onSaved, { once: true });
  elements.form.requestSubmit();
  document.removeEventListener("fg:movement-form-saved", onSaved);
  if (!saved) {
    // El submit validó y devolvió un error en el feedback del modal.
    openMovementModal();
    return null;
  }
  await settled;
  return saved;
}

function submitRecurringForm() {
  let saved = null;
  const onSaved = (event) => { saved = event.detail; };
  document.addEventListener("fg:recurring-form-saved", onSaved, { once: true });
  if (elements.recurringForm.checkValidity()) elements.recurringForm.requestSubmit();
  document.removeEventListener("fg:recurring-form-saved", onSaved);
  return saved;
}

// Crea los datos reales de una propuesta. Devuelve el `result` a guardar
// en la fila de la bandeja, o null si quedó pendiente de corregir en un
// formulario visible.
async function commitItem(item, info) {
  const draft = info.draft;
  if (info.kind === "payment") {
    const entry = buildSharedPaymentEntry({
      contactId: draft.contactId,
      total: draft.total,
      paidBy: draft.paidBy,
      date: draft.date,
      note: draft.note,
      advance: draft.advance,
      concept: draft.concept,
    });
    state.sharedEntries = [entry, ...state.sharedEntries];
    saveSharedEntries();
    renderSharedView();
    return { sharedEntryId: entry.id };
  }

  if (draft.recurring) {
    prefillRecurringForm(recurringSeed(draft), { show: false });
    const saved = submitRecurringForm();
    if (!saved) {
      reviewingItemId = item.id;
      prefillRecurringForm(recurringSeed(draft), { show: true });
      return null;
    }
    const generated = generatePendingRecurrences();
    renderMovements();
    renderAnalysis();
    renderSharedView();
    renderRecurringView();
    return { templateId: saved.templateId, generated };
  }

  fillMovementForm(draft);
  const saved = await submitMovementForm();
  if (!saved) {
    reviewingItemId = item.id;
    return null;
  }
  return saved;
}

async function markResolved(itemId, status, result) {
  state.inboxItems = state.inboxItems.filter((x) => x.id !== itemId);
  overrides.delete(itemId);
  try {
    await cloudResolveInboxItem(itemId, status, result);
  } catch (error) {
    console.error("[inbox] resolve", error);
    showToast("No se pudo actualizar la bandeja en la nube; si vuelve a aparecer, descártala.", "error", 6000);
  }
}

async function acceptItems(items) {
  if (busy) return;
  busy = true;
  renderInbox();
  let accepted = 0;
  try {
    for (const item of items) {
      const info = interpretItem(item);
      if (info.issues.some((i) => i.blocking)) continue;
      const result = await commitItem(item, info);
      if (!result) break; // quedó abierto un formulario para corregir
      await markResolved(item.id, "accepted", result);
      accepted += 1;
    }
  } finally {
    busy = false;
    renderInbox();
  }
  if (accepted) {
    showToast(accepted === 1 ? "Propuesta añadida." : `${accepted} propuestas añadidas.`, "success");
  }
}

function openReview(item) {
  const info = interpretItem(item);
  if (info.kind !== "movement") return;
  reviewingItemId = item.id;
  if (info.draft.recurring) {
    prefillRecurringForm(recurringSeed(info.draft), { show: true });
    return;
  }
  // Con datos incompletos rellenamos lo que haya; el usuario completa.
  const draft = { ...info.draft };
  if (!draft.date) draft.date = toIsoDate(new Date());
  if (!Number.isFinite(draft.amount)) draft.amount = "";
  if (draft.shared && (!info.target || draft.shared.kind === "contact" && !draft.shared.modeKey)) {
    draft.shared = null;
  }
  fillMovementForm(draft);
  if (info.raw.shared && !draft.shared) {
    elements.isShared.checked = true;
    syncSharedFields();
  }
  elements.feedback.textContent = "Propuesta de la bandeja: revisa y guarda.";
  openMovementModal();
}

// Guardado desde un formulario abierto en modo "Revisar".
async function onReviewSaved(result) {
  const itemId = reviewingItemId;
  reviewingItemId = null;
  if (!itemId || busy) return;
  if (!state.inboxItems.some((x) => x.id === itemId)) return;
  await markResolved(itemId, "accepted", result);
  if (result.templateId) {
    generatePendingRecurrences();
    renderMovements();
    renderAnalysis();
    renderSharedView();
    renderRecurringView();
  }
  renderInbox();
  showToast("Propuesta añadida.", "success");
}

document.addEventListener("fg:movement-form-saved", (event) => {
  if (reviewingItemId && !busy) onReviewSaved(event.detail);
});
document.addEventListener("fg:recurring-form-saved", (event) => {
  if (reviewingItemId && !busy) onReviewSaved(event.detail);
});

// Si el usuario cierra el formulario sin guardar, la propuesta sigue en
// la bandeja y el siguiente alta manual no debe asociarse a ella.
function forgetReviewOnClose(modal) {
  if (!modal) return;
  new MutationObserver(() => {
    if (modal.hidden && !busy) {
      // El aviso de guardado llega antes que el cierre; si seguimos con
      // un id aquí, es que se cerró sin guardar.
      setTimeout(() => { if (modal.hidden) reviewingItemId = null; }, 0);
    }
  }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
}
forgetReviewOnClose(elements.movementModal);
forgetReviewOnClose(elements.recurringModal);

// ---- pegar JSON ------------------------------------------------------------

// Extrae el JSON aunque venga rodeado de texto o dentro de ```json … ```.
export function parseProposalText(text) {
  const source = String(text ?? "").trim();
  if (!source) throw new Error("Pega primero el texto que te ha dado la IA.");
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fenced ? fenced[1] : source;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("No encuentro ningún bloque JSON en el texto.");
  const open = candidate[start];
  const end = candidate.lastIndexOf(open === "{" ? "}" : "]");
  candidate = candidate.slice(start, end + 1);
  let data;
  try {
    data = JSON.parse(candidate);
  } catch {
    throw new Error("El JSON no es válido. Pide a la IA que lo repita en un solo bloque.");
  }
  const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [data];
  const valid = items.filter((x) => x && typeof x === "object" && (x.amount != null || x.date));
  if (!valid.length) throw new Error("El JSON no contiene ningún movimiento.");
  return valid;
}

async function addPastedProposals() {
  const status = elements.inboxPasteStatus;
  let items;
  try {
    items = parseProposalText(elements.inboxPasteText.value);
  } catch (error) {
    status.textContent = error.message;
    status.dataset.state = "error";
    return;
  }
  const batchId = createId();
  const rows = items.map((payload) => ({ id: createId(), batchId, source: "paste", payload }));
  elements.inboxPasteSubmit.disabled = true;
  status.textContent = "Guardando…";
  status.dataset.state = "";
  try {
    await cloudInsertInbox(rows);
  } catch (error) {
    console.error("[inbox] insert", error);
    status.textContent = "No se pudo guardar en la nube. ¿Está aplicada la migración 14?";
    status.dataset.state = "error";
    elements.inboxPasteSubmit.disabled = false;
    return;
  }
  elements.inboxPasteSubmit.disabled = false;
  elements.inboxPasteText.value = "";
  status.textContent = rows.length === 1 ? "1 propuesta añadida." : `${rows.length} propuestas añadidas.`;
  status.dataset.state = "ok";
  state.inboxItems = [
    ...state.inboxItems,
    ...rows.map((r) => ({ ...r, status: "pending", createdAt: new Date().toISOString() })),
  ];
  elements.inboxPastePanel.open = false;
  renderInbox();
}

async function copyInstructions() {
  const text = buildAiInstructions();
  try {
    await navigator.clipboard.writeText(text);
    showToast("Instrucciones copiadas. Pégalas en el chat o en las instrucciones del proyecto.", "success", 5000);
  } catch {
    // Sin permiso de portapapeles: mostramos el texto para copiarlo a mano.
    elements.inboxInstructionsText.value = text;
    elements.inboxInstructionsBox.hidden = false;
    elements.inboxInstructionsText.select();
  }
}

// ---- eventos -----------------------------------------------------------------

elements.inboxList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-inbox-action]");
  if (!button || busy) return;
  const id = button.closest("[data-item-id]")?.dataset.itemId;
  const item = state.inboxItems.find((x) => x.id === id);
  if (!item) return;
  const action = button.dataset.inboxAction;
  if (action === "accept") acceptItems([item]);
  if (action === "review") openReview(item);
  if (action === "discard") {
    markResolved(item.id, "discarded", null).then(renderInbox);
  }
});

elements.inboxList?.addEventListener("change", (event) => {
  const select = event.target.closest("[data-inbox-fix]");
  if (!select || !select.value) return;
  const id = select.closest("[data-item-id]")?.dataset.itemId;
  const fix = { ...(overrides.get(id) ?? {}) };
  if (select.dataset.inboxFix === "concept") fix.concept = select.value;
  if (select.dataset.inboxFix === "target") {
    const [kind, ...rest] = select.value.split(":");
    fix.target = { kind, id: rest.join(":") };
  }
  overrides.set(id, fix);
  renderInbox();
});

elements.inboxAcceptReady?.addEventListener("click", () => {
  const ready = state.inboxItems.filter((item) => {
    const info = interpretItem(item);
    info.duplicates = findDuplicates(info, item);
    return isReady(info);
  });
  acceptItems(ready);
});

elements.inboxDiscardAll?.addEventListener("click", () => {
  const count = pendingCount();
  if (!count) return;
  showConfirm({
    title: "Vaciar la bandeja",
    message: count === 1 ? "Se descartará 1 propuesta." : `Se descartarán ${count} propuestas.`,
    extra: "No se borra nada de tus movimientos: solo las propuestas pendientes.",
    actions: [
      {
        label: "Descartar todas",
        kind: "danger",
        onClick: async () => {
          const ids = state.inboxItems.map((x) => x.id);
          for (const id of ids) await markResolved(id, "discarded", null);
          renderInbox();
        },
      },
    ],
  });
});

elements.inboxPasteSubmit?.addEventListener("click", addPastedProposals);
elements.inboxCopyInstructions?.addEventListener("click", copyInstructions);
elements.homeInboxBanner?.addEventListener("click", () => setView("inbox"));

// Al volver a la pestaña (p. ej. tras hablar con la IA en el móvil),
// recogemos lo que haya llegado por el conector.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !busy && !reviewingItemId) loadInbox();
});
