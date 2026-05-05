import { state } from "../core/state.js";
import { elements, openMovementModal, closeMovementModal } from "../core/dom.js";
import { saveMovements, saveSharedEntries } from "../core/storage.js";
import { createId, formatDate, formatMoney, formatMonthLabel, optionMarkup } from "../core/utils.js";
import { SHARED_MODES } from "../core/constants.js";
import {
  applySharedEntryToForm,
  buildSharedExpenseEntry,
  computeSharedShares,
  entryAsMyPerspective,
  getMovementSharedLabel,
  renderSharedView,
  syncSharedFields,
  parseSharedTarget,
  readSharedGroupShares,
} from "./shared.js";
import { buildSplits, getMyMemberInGroup } from "./groups.js";
import { getUserIdSync } from "../core/supabase.js";
import { recordSharedEntryEdit } from "./edit-log.js";
import { renderAnalysis } from "./analysis.js";
import { openConvertFromMovement, openConvertFromSharedEntry } from "./recurring.js";
import { setMovementDate } from "../ui/datepicker.js";
import { showConfirm } from "../ui/confirm.js";

export function getCategory(value) {
  return state.settings.categories.find((category) => category.value === value);
}

export function getCategoryLabel(value) {
  return getCategory(value)?.label ?? value;
}

export function getConcept(value) {
  return state.settings.concepts.find((concept) => concept.label === value);
}

export function getSignedAmount(movement) {
  return movement.type === "income" ? movement.amount : -movement.amount;
}

// Concepts that should appear in BOTH the expense and income dropdowns,
// even though they have a single stored category. Currently just "Renta"
// (you can pay it as a tenant or receive it as a landlord).
const DUAL_TYPE_CONCEPTS = new Set(["Renta"]);

export function getConceptsForType(type) {
  const filtered = type === "income"
    ? state.settings.concepts.filter(
        (concept) => concept.category === "ingreso" || DUAL_TYPE_CONCEPTS.has(concept.label)
      )
    : state.settings.concepts.filter((concept) => concept.category !== "ingreso");
  return filtered.slice().sort((a, b) =>
    a.label.localeCompare(b.label, "es", { sensitivity: "base" })
  );
}

// Per-type default concept so toggling Gasto/Ingreso lands on a sensible
// pick instead of the alphabetical first.
const DEFAULT_CONCEPT_BY_TYPE = {
  expense: "Compra",
  income: "Salario",
};

export function syncMovementSelects() {
  const currentConcept = elements.concept.value;
  const concepts = getConceptsForType(elements.type.value);
  let selectedConcept;
  if (concepts.some((concept) => concept.label === currentConcept)) {
    selectedConcept = currentConcept;
  } else {
    const preferred = DEFAULT_CONCEPT_BY_TYPE[elements.type.value];
    selectedConcept = concepts.find((c) => c.label === preferred)?.label ?? concepts[0]?.label;
  }

  elements.concept.innerHTML = optionMarkup(concepts, selectedConcept);
  elements.category.innerHTML = optionMarkup(state.settings.categories, getConcept(selectedConcept)?.category);
  // Filter dropdown for category (desktop): preserve the current selection
  // so a re-render mid-filter doesn't reset to "all" silently.
  const previousCategoryFilter = elements.categoryFilter.value || "all";
  elements.categoryFilter.innerHTML =
    '<option value="all">Cualquier categoría</option>' + optionMarkup(state.settings.categories);
  elements.categoryFilter.value = state.settings.categories.some((c) => c.value === previousCategoryFilter)
    ? previousCategoryFilter
    : "all";
  elements.newConceptCategory.innerHTML = optionMarkup(state.settings.categories);
  // Filter dropdown for concept (desktop): every concept, sorted alphabetically.
  const conceptOptions = state.settings.concepts
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }))
    .map((concept) => ({ value: concept.label, label: concept.label }));
  const previousFilterConcept = elements.filterConcept.value || "all";
  elements.filterConcept.innerHTML =
    '<option value="all">Cualquier concepto</option>' + optionMarkup(conceptOptions);
  elements.filterConcept.value = state.settings.concepts.some((c) => c.label === previousFilterConcept)
    ? previousFilterConcept
    : "all";
  syncCategoryFromConcept();
  syncPartySuggestions();
}

// Datalist nativo para autocompletar el campo "Emisor / receptor".
// Recoge cada party único que el usuario haya tecleado en cualquier
// movimiento o plantilla periódica, normaliza espacios y duplicados
// (case-insensitive), y los pinta como options. Se llama desde
// syncMovementSelects, así que se mantiene fresco tras crear, editar
// o eliminar movimientos. El mismo datalist alimenta el form de
// movimiento y el de plantilla periódica (comparten id en el HTML).
export function syncPartySuggestions() {
  if (!elements.partySuggestions) return;
  const seen = new Map(); // lower → display original
  const collect = (value) => {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return;
    const key = trimmed.toLocaleLowerCase("es");
    if (!seen.has(key)) seen.set(key, trimmed);
  };
  for (const m of state.movements) collect(m.party);
  for (const t of state.recurringTemplates) collect(t.party);
  const sorted = [...seen.values()].sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );
  elements.partySuggestions.innerHTML = sorted
    .map((label) => `<option value="${label.replace(/"/g, "&quot;")}"></option>`)
    .join("");
}

export function syncCategoryFromConcept() {
  const concept = getConcept(elements.concept.value);

  if (!concept) return;

  // For income movements the category is always "ingreso" regardless of the
  // concept's stored category. This handles dual-type concepts like "Renta"
  // whose stored category is the expense flavor.
  const isIncome = elements.type.value === "income";
  elements.category.value = isIncome ? "ingreso" : concept.category;
}

export function paintTag(tag, categoryValue) {
  const category = getCategory(categoryValue);

  tag.textContent = getCategoryLabel(categoryValue);
  tag.style.background = category?.color ?? "#d8e0e4";
  tag.style.color = category?.text ?? "#172026";
}

function compareMovements(a, b, key) {
  switch (key) {
    case "date":
      return a.date.localeCompare(b.date) || (a.id || "").localeCompare(b.id || "");
    case "concept":
      return a.concept.localeCompare(b.concept, "es", { sensitivity: "base" });
    case "amount":
      return getSignedAmount(a) - getSignedAmount(b);
    case "note":
      return (a.note || "").localeCompare(b.note || "", "es", { sensitivity: "base" });
    case "party":
      return (a.party || "").localeCompare(b.party || "", "es", { sensitivity: "base" });
    case "category":
      return getCategoryLabel(a.category).localeCompare(getCategoryLabel(b.category), "es", { sensitivity: "base" });
    case "recurrence":
      return (a.recurrence || "").localeCompare(b.recurrence || "", "es", { sensitivity: "base" });
    case "shared":
      return (a.sharedEntryId ? 1 : 0) - (b.sharedEntryId ? 1 : 0);
    default:
      return 0;
  }
}

// Filter model:
// - filterText is a single text query. On mobile the user picks the
//   target field via filterFieldMobile (default "all" = search every
//   text-typed property at once: concept, note, party, category label,
//   type label, recurrence label and shared contact name). On desktop
//   we always use "all" mode, since the field selector is hidden there.
// - filterConcept, categoryFilter and typeFilter are dropdowns that on
//   desktop sit alongside the text input. On mobile they're hidden and
//   stay at their default ("all"), so they don't constrain anything.
const isMobileViewport = () => window.matchMedia("(max-width: 719px)").matches;

const TYPE_LABELS = { expense: "gasto", income: "ingreso" };

function matchesTextField(movement, text, field) {
  if (!text) return true;
  const concept = (movement.concept || "").toLowerCase();
  const note = (movement.note || "").toLowerCase();
  const party = (movement.party || "").toLowerCase();
  if (field === "concept") return concept.includes(text);
  if (field === "note") return note.includes(text);
  if (field === "party") return party.includes(text);
  // "all" mode: any text-typed property of the movement.
  if (concept.includes(text) || note.includes(text) || party.includes(text)) return true;
  if (getCategoryLabel(movement.category).toLowerCase().includes(text)) return true;
  const recurrence = (movement.recurrence || "puntual").toLowerCase();
  if (recurrence.includes(text)) return true;
  if ((TYPE_LABELS[movement.type] || "").includes(text)) return true;
  const sharedName = getMovementSharedLabel(movement).toLowerCase();
  if (sharedName && sharedName.includes(text)) return true;
  return false;
}

// Virtual movements: when the user is a linked partner of a shared
// expense, the obligation is rendered as a movement on their side too,
// regardless of who actually paid. This keeps both sides visually
// symmetric ("you owe me €5" appears as a -€5 movement for the debtor)
// without writing anything to the cloud — these rows are derived from
// shared_entries at render time and do not exist in state.movements.
// Settling a shared entry doesn't add or remove movements; it just
// closes the obligation in Compartidos.
function getVirtualMovementsFromShared() {
  const myUid = getUserIdSync();
  if (!myUid) return [];
  return state.sharedEntries
    .filter((e) => e.ownerId && e.ownerId !== myUid && e.type === "expense")
    .map((entry) => {
      const flipped = entryAsMyPerspective(entry);
      const reciprocal = state.contacts.find((c) => c.authUserId === entry.ownerId);
      const conceptDef = state.settings.concepts.find((c) => c.label === entry.concept);
      return {
        id: `virtual-${entry.id}`,
        type: "expense",
        date: entry.date,
        concept: entry.concept,
        amount: flipped.myShare,
        category: conceptDef?.category ?? "perdido",
        party: reciprocal?.name ?? "Vinculado",
        recurrence: "",
        note: entry.note ?? "",
        sharedEntryId: entry.id,
        isVirtual: true,
      };
    });
}

export function getAllMovements() {
  return [...state.movements, ...getVirtualMovementsFromShared()];
}

export function getFilteredMovements() {
  const text = elements.filterText.value.trim().toLowerCase();
  // On desktop the mobile field selector is hidden, but its DOM value
  // could still be a stale "concept"/"note"/"party" if the user touched
  // it on mobile and resized. Force "all" so the desktop text input
  // always behaves as the multi-field search the user expects.
  const field = isMobileViewport() ? elements.filterFieldMobile.value : "all";
  const selectedConcept = elements.filterConcept.value;
  const selectedCategory = elements.categoryFilter.value;
  const selectedType = elements.typeFilter.value;
  const { key, dir } = state.movementSort;

  return getAllMovements()
    .filter((movement) => selectedType === "all" || movement.type === selectedType)
    .filter((movement) => selectedCategory === "all" || movement.category === selectedCategory)
    .filter((movement) => selectedConcept === "all" || movement.concept === selectedConcept)
    .filter((movement) => matchesTextField(movement, text, field))
    .sort((a, b) => {
      const cmp = compareMovements(a, b, key);
      // Tie-break by date desc + id so equal-key rows have a stable order.
      const fallback = b.date.localeCompare(a.date) || (b.id || "").localeCompare(a.id || "");
      return (dir === "asc" ? cmp : -cmp) || fallback;
    });
}

export function isSearchActive() {
  return Boolean(
    elements.filterText.value.trim() ||
      elements.filterConcept.value !== "all" ||
      elements.categoryFilter.value !== "all" ||
      elements.typeFilter.value !== "all"
  );
}

function getSharedModeLabel(entry, contactName) {
  for (const [, mode] of Object.entries(SHARED_MODES)) {
    if (mode.paidBy === entry.paidBy && mode.split === entry.splitMode) {
      return mode.label.replace("{name}", contactName || "el contacto");
    }
  }
  return "";
}

export function createMovementCard(movement, compact = false) {
  const card = elements.template.content.firstElementChild.cloneNode(true);
  const signedAmount = getSignedAmount(movement);
  const recurrenceRaw = movement.recurrence || "puntual";
  const recurrenceLabel = recurrenceRaw[0].toUpperCase() + recurrenceRaw.slice(1);
  // 🔁 marks rows generated automatically by a Periódicos template (vs.
  // hand-entered movements that may also have a `recurrence` label).
  const autoBadge = movement.recurringTemplateId ? "🔁 " : "";
  const recurrenceDisplay = autoBadge + recurrenceLabel;
  const sharedLabel = getMovementSharedLabel(movement);

  card.dataset.id = movement.id;
  // Drives the mobile CSS that hides the meta row when there is nothing
  // to show — so cards with neither a real recurrence nor a shared partner
  // collapse to a single row.
  card.dataset.recurrence = recurrenceRaw.toLowerCase();
  card.dataset.shared = sharedLabel ? "true" : "false";
  if (movement.isVirtual) {
    card.dataset.virtual = "true";
  }
  card.classList.toggle("is-compact", compact);
  if (movement.id === state.expandedMovementId) {
    card.classList.add("is-expanded");
  }
  paintTag(card.querySelector(".tag"), movement.category);
  card.querySelector("h3").textContent = movement.concept;
  card.querySelector(".movement-note").textContent = movement.note || "";
  card.querySelector(".amount").textContent = formatMoney(signedAmount);
  card.querySelector(".amount").classList.add(movement.type);
  card.querySelector(".date").textContent = formatDate(movement.date);
  card.querySelector(".party").textContent = movement.party || "";
  card.querySelector(".recurrence").textContent = recurrenceDisplay;
  card.querySelector(".shared-cell").textContent = sharedLabel;

  // Expanded section (mobile only). All rows that would be empty are
  // hidden via the `hidden` attribute so the dl collapses naturally.
  card.querySelector(".exp-date").textContent = formatDate(movement.date);
  card.querySelector(".exp-category").textContent = getCategoryLabel(movement.category);
  card.querySelector(".exp-recurrence").textContent = recurrenceDisplay;

  const partyRow = card.querySelector('[data-row="party"]');
  if (movement.party) {
    card.querySelector(".exp-party").textContent = movement.party;
    partyRow.hidden = false;
  } else {
    partyRow.hidden = true;
  }

  const noteRow = card.querySelector('[data-row="note"]');
  if (movement.note) {
    card.querySelector(".exp-note").textContent = movement.note;
    noteRow.hidden = false;
  } else {
    noteRow.hidden = true;
  }

  const sharedSection = card.querySelector(".movement-expanded-shared");
  const linkedEntryRaw = movement.sharedEntryId
    ? state.sharedEntries.find((entry) => entry.id === movement.sharedEntryId)
    : null;
  // Flip to MY perspective so the expanded labels (modo de reparto,
  // partes) read correctly when the linked entry is owned by a partner.
  const linkedEntry = linkedEntryRaw ? entryAsMyPerspective(linkedEntryRaw) : null;

  if (linkedEntry) {
    const contactName = sharedLabel || "—";
    card.querySelector(".exp-shared-contact").textContent = contactName;
    card.querySelector(".exp-shared-mode").textContent = getSharedModeLabel(linkedEntry, contactName);
    const sharesRow = card.querySelector('[data-row="shared-shares"]');
    if (linkedEntry.groupId && linkedEntry.splits) {
      // Group entry: el reparto real vive en `splits` (no en
      // myShare/theirShare, que para grupos quedan como 0). Mostramos
      // mi parte y la suma del resto del grupo, igual que la fila de
      // Movimientos compartidos.
      const myMember = getMyMemberInGroup(linkedEntry.groupId);
      const myOwes = myMember
        ? Number(linkedEntry.splits[myMember.id]?.owes) || 0
        : 0;
      const others = Math.max(
        0,
        Math.round((Number(linkedEntry.total) - myOwes) * 100) / 100
      );
      card.querySelector(".exp-shared-shares").textContent =
        `Tu parte ${formatMoney(myOwes)} · resto del grupo ${formatMoney(others)}`;
      sharesRow.hidden = false;
    } else if (linkedEntry.splitMode === "uneven") {
      card.querySelector(".exp-shared-shares").textContent =
        `Tu parte ${formatMoney(linkedEntry.myShare)} · Su parte ${formatMoney(linkedEntry.theirShare)}`;
      sharesRow.hidden = false;
    } else {
      sharesRow.hidden = true;
    }
    sharedSection.hidden = false;
  } else {
    sharedSection.hidden = true;
  }

  if (compact) {
    card.querySelector(".delete-action").remove();
  }

  // Virtual movements: replace the edit/duplicate/delete row in the
  // expanded section with a hint pointing to Compartidos, where the
  // underlying shared_entry actually lives.
  if (movement.isVirtual) {
    const actions = card.querySelector(".movement-expanded-actions");
    if (actions) {
      actions.innerHTML = "";
      const hint = document.createElement("p");
      hint.className = "movement-expanded-virtual-hint";
      hint.textContent =
        "Esta entrada refleja un gasto compartido. Para editarla o liquidarla, ve a Compartidos.";
      actions.append(hint);
    }
  }

  return card;
}

const SORTABLE_HEADERS = [
  { label: "Fecha", key: "date" },
  { label: "Concepto", key: "concept" },
  { label: "Importe", key: "amount" },
  { label: "Nota", key: "note" },
  { label: "Emisor / receptor", key: "party" },
  { label: "Categoria", key: "category" },
  { label: "Recurrencia", key: "recurrence" },
  { label: "Compartido", key: "shared" },
];

export function renderMovementList(container, items, compact = false) {
  container.innerHTML = "";

  if (!items.length && compact) {
    container.innerHTML = '<p class="empty-state">No hay movimientos con estos filtros.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  const { key: sortKey, dir: sortDir } = state.movementSort;

  if (!compact) {
    const header = document.createElement("div");
    header.className = "movement-header";
    SORTABLE_HEADERS.forEach(({ label, key }) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "movement-header-cell";
      cell.dataset.sortKey = key;
      if (key === sortKey) {
        cell.classList.add("is-active");
        cell.dataset.sortDir = sortDir;
      }
      const arrow = key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "";
      cell.textContent = `${label}${arrow}`;
      header.append(cell);
    });
    // Three empty cells holding column space for the action buttons; not sortable.
    for (let i = 0; i < 3; i += 1) {
      const filler = document.createElement("span");
      filler.className = "movement-header-cell movement-header-cell-static";
      header.append(filler);
    }
    fragment.append(header);
  }

  if (!items.length) {
    container.append(fragment);
    container.insertAdjacentHTML(
      "beforeend",
      '<p class="empty-state">No hay movimientos con estos filtros.</p>'
    );
    return;
  }

  // Month/date dividers only make sense when the list is sorted by date,
  // since otherwise items jump between months freely.
  const showDateGroups = sortKey === "date";

  let lastDate = null;
  let lastMonthKey = null;
  let monthSection = null; // wrapper for the current month's cards so the
                           // sticky month-group header is scoped to its
                           // own section on desktop (lets it un-stick when
                           // scrolling into the next month).

  items.forEach((movement) => {
    if (!compact && showDateGroups) {
      const monthKey = movement.date.slice(0, 7);
      if (monthKey !== lastMonthKey) {
        monthSection = document.createElement("section");
        monthSection.className = "month-section";
        const monthHeader = document.createElement("div");
        monthHeader.className = "month-group";
        monthHeader.textContent = formatMonthLabel(movement.date);
        monthSection.append(monthHeader);
        fragment.append(monthSection);
        lastMonthKey = monthKey;
        lastDate = null;
      }
      if (movement.date !== lastDate) {
        const groupHeader = document.createElement("div");
        groupHeader.className = "date-group";
        groupHeader.textContent = formatDate(movement.date);
        monthSection.append(groupHeader);
        lastDate = movement.date;
      }
      monthSection.append(createMovementCard(movement, compact));
    } else {
      fragment.append(createMovementCard(movement, compact));
    }
  });
  container.append(fragment);
}

export function renderMovements() {
  const filteredMovements = getFilteredMovements();
  elements.movementCount.textContent = `${filteredMovements.length} movimientos`;
  renderMovementList(elements.list, filteredMovements);
}

export function createMovement(formData) {
  return {
    id: createId(),
    type: formData.get("type"),
    date: formData.get("date"),
    concept: formData.get("concept"),
    amount: Number(formData.get("amount")),
    category: formData.get("category"),
    party: formData.get("party").trim(),
    recurrence: formData.get("recurrence"),
    note: formData.get("note").trim(),
  };
}

export function fillMovementForm(movement) {
  elements.type.value = movement.type;
  syncTypeToggle();
  syncMovementSelects();
  elements.concept.value = movement.concept;
  elements.category.value = movement.category;
  setMovementDate(new Date(`${movement.date}T00:00:00`));
  elements.amount.value = movement.amount;
  elements.party.value = movement.party;
  elements.recurrence.value = movement.recurrence;
  elements.note.value = movement.note;

  const linkedEntry = movement.sharedEntryId
    ? state.sharedEntries.find((entry) => entry.id === movement.sharedEntryId)
    : null;

  if (linkedEntry) {
    applySharedEntryToForm(linkedEntry);
    // Editing a movement whose linked shared entry exists: show the
    // optional "comentario sobre el cambio" so any tweak the user makes
    // can be annotated for the audit trail.
    elements.editCommentField.hidden = false;
    elements.editComment.value = "";
  } else {
    elements.isShared.checked = false;
    syncSharedFields();
    elements.editCommentField.hidden = true;
    elements.editComment.value = "";
  }
}

export function resetMovementForm(movement) {
  elements.form.reset();
  elements.type.value = movement?.type ?? "expense";
  setMovementDate(movement ? new Date(`${movement.date}T00:00:00`) : new Date());
  elements.isShared.checked = false;
  elements.sharedFields.hidden = true;
  elements.sharedUneven.hidden = true;
  elements.sharedMyShare.value = "";
  elements.sharedTheirShare.value = "";
  elements.sharedUnevenFeedback.textContent = "";
  elements.sharedContact.disabled = false;
  elements.editCommentField.hidden = true;
  elements.editComment.value = "";
  if (elements.convertToRecurring) elements.convertToRecurring.hidden = true;
  elements.submitLabel.textContent = "Anadir movimiento";
  state.editingMovementId = null;
  state.editingSharedEntryId = null;
  state.editingPartnerEntry = false;
  syncMovementSelects();
  syncTypeToggle();
}

export function syncTypeToggle() {
  const value = elements.type.value;
  elements.typeToggleButtons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.typeTarget === value);
  });
}

elements.typeToggleButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (elements.type.value === btn.dataset.typeTarget) return;
    elements.type.value = btn.dataset.typeTarget;
    elements.type.dispatchEvent(new Event("change", { bubbles: true }));
    syncTypeToggle();
  });
});

elements.type.addEventListener("change", syncTypeToggle);
syncTypeToggle();

// Header click → toggle sort. Delegated on the list container so the
// dynamically rendered header buttons get caught regardless of when they
// were created.
elements.list.addEventListener("click", (event) => {
  const header = event.target.closest(".movement-header-cell:not(.movement-header-cell-static)");
  if (!header) return;
  const key = header.dataset.sortKey;
  if (!key) return;
  if (state.movementSort.key === key) {
    state.movementSort.dir = state.movementSort.dir === "asc" ? "desc" : "asc";
  } else {
    state.movementSort.key = key;
    state.movementSort.dir = key === "date" ? "desc" : "asc";
  }
  renderMovements();
});

function editMovementById(id) {
  const movement = state.movements.find((candidate) => candidate.id === id);
  if (!movement) return;
  state.editingMovementId = movement.id;
  fillMovementForm(movement);
  elements.submitLabel.textContent = "Guardar cambios";
  elements.feedback.textContent = "Editando movimiento.";
  // The "Convertir en plantilla periódica" button is only meaningful for
  // hand-entered movements that aren't already auto-generated. Hide it
  // for virtual rows (partner shared expenses) and for rows already
  // linked to a template (would be a no-op anyway).
  if (elements.convertToRecurring) {
    elements.convertToRecurring.hidden = !!movement.isVirtual || !!movement.recurringTemplateId;
  }
  openMovementModal();
  elements.concept.focus();
}

function duplicateMovementById(id) {
  const movement = state.movements.find((candidate) => candidate.id === id);
  if (!movement) return;
  state.editingMovementId = null;
  fillMovementForm(movement);
  // El botón "Convertir en plantilla periódica" solo opera sobre un
  // movimiento persistido (lee state.editingMovementId). Aquí estamos
  // creando uno nuevo a partir de una copia: aún no hay nada que
  // convertir, así que lo escondemos. Si el modal venía de un edit
  // previo, fillMovementForm no toca este atributo y se quedaba
  // visible — pulsarlo no hacía nada.
  if (elements.convertToRecurring) elements.convertToRecurring.hidden = true;
  elements.submitLabel.textContent = "Anadir movimiento";
  elements.feedback.textContent = "Copia preparada. Ajusta lo que cambie.";
  openMovementModal();
  elements.concept.focus();
}

function actuallyDeleteMovement(movement) {
  const linkedEntry = movement.sharedEntryId
    ? state.sharedEntries.find((entry) => entry.id === movement.sharedEntryId)
    : null;

  state.movements = state.movements.filter((candidate) => candidate.id !== movement.id);
  if (linkedEntry) {
    state.sharedEntries = state.sharedEntries.filter((entry) => entry.id !== linkedEntry.id);
    saveSharedEntries();
  }
  saveMovements();
  renderMovements();
  renderAnalysis();
  if (linkedEntry) {
    renderSharedView();
  }
}

// Wipe the source template + every movement it produced + paired shared
// entries. Imported lazily to avoid a static cycle with recurring.js.
async function deleteTemplateAndAllOccurrences(templateId) {
  const generated = state.movements.filter((m) => m.recurringTemplateId === templateId);
  const linkedEntryIds = new Set(
    generated.map((m) => m.sharedEntryId).filter(Boolean)
  );
  state.movements = state.movements.filter((m) => m.recurringTemplateId !== templateId);
  if (linkedEntryIds.size) {
    state.sharedEntries = state.sharedEntries.filter((e) => !linkedEntryIds.has(e.id));
    saveSharedEntries();
  }
  state.recurringTemplates = state.recurringTemplates.filter((t) => t.id !== templateId);
  saveMovements();
  // saveRecurringTemplates is exported from storage.js but not imported
  // here; reach in via dynamic import to avoid expanding the static
  // import surface for a single call.
  const storage = await import("../core/storage.js");
  storage.saveRecurringTemplates();
  renderMovements();
  renderAnalysis();
  if (linkedEntryIds.size) renderSharedView();
  // Re-render recurring view so the now-deleted template disappears.
  const recurring = await import("./recurring.js");
  recurring.renderRecurringView?.();
}

function deleteMovementById(id) {
  const movement = state.movements.find((candidate) => candidate.id === id);
  if (!movement) return;

  const template = movement.recurringTemplateId
    ? state.recurringTemplates.find((t) => t.id === movement.recurringTemplateId)
    : null;

  // Recurrent movement: robust modal with explicit warning that the row
  // won't regenerate, plus an option to wipe the template + every
  // occurrence (with double-confirm on the destructive button).
  if (template) {
    showConfirm({
      title: "Borrar movimiento recurrente",
      message: `Este movimiento fue generado por la plantilla "${template.concept}" del ${formatDate(movement.date)}. Si lo borras, NO se regenerará automáticamente — tendrás que crearlo a mano si lo quieres recuperar.`,
      extra: "¿Qué quieres hacer?",
      actions: [
        {
          label: "Cancelar",
          kind: "secondary",
          onClick: () => {},
        },
        {
          label: "Borrar solo este",
          kind: "secondary",
          onClick: () => actuallyDeleteMovement(movement),
        },
        {
          label: "Borrar este, todos los demás generados y la plantilla",
          kind: "danger",
          requireDoubleConfirm: true,
          onClick: () => deleteTemplateAndAllOccurrences(template.id),
        },
      ],
    });
    return;
  }

  // Plain hand-entered movement: simple confirm is enough.
  if (!confirm(`Eliminar "${movement.concept}" del ${formatDate(movement.date)}?`)) {
    return;
  }
  actuallyDeleteMovement(movement);
}

// Mobile-only: tapping the card body (away from any button) toggles inline
// expansion. Only one card can be expanded at a time. Desktop keeps the
// inline edit/duplicate/delete affordances and ignores the toggle.
export function collapseExpandedCard() {
  if (!state.expandedMovementId) return;
  const previous = elements.list.querySelector(".movement-card.is-expanded");
  if (previous) previous.classList.remove("is-expanded");
  state.expandedMovementId = null;
}

function expandCard(card, movementId) {
  collapseExpandedCard();
  card.classList.add("is-expanded");
  state.expandedMovementId = movementId;
}

elements.list.addEventListener("click", (event) => {
  const card = event.target.closest(".movement-card");
  if (!card) return;

  // Inline action buttons inside the expanded section (mobile) and the
  // historical desktop row buttons share the same class names. Either
  // dispatches the same logic; the expanded card collapses on action.
  const editButton = event.target.closest(".edit-action, .exp-edit-action");
  const duplicateButton = event.target.closest(".duplicate-action, .exp-duplicate-action");
  const deleteButton = event.target.closest(".delete-action, .exp-delete-action");

  if (editButton) {
    collapseExpandedCard();
    editMovementById(card.dataset.id);
    return;
  }
  if (duplicateButton) {
    collapseExpandedCard();
    duplicateMovementById(card.dataset.id);
    return;
  }
  if (deleteButton) {
    collapseExpandedCard();
    deleteMovementById(card.dataset.id);
    return;
  }

  if (!isMobileViewport()) return;

  // Tapping inside the expanded body (note text, data values) shouldn't
  // collapse the card — the user is reading. Only the always-visible
  // top portion (concept/amount/meta badges) toggles.
  if (event.target.closest(".movement-expanded")) return;

  if (state.expandedMovementId === card.dataset.id) {
    collapseExpandedCard();
  } else {
    expandCard(card, card.dataset.id);
  }
});

function refreshSearchButtonState() {
  const active = isSearchActive();
  elements.resetSearchButtons.forEach((btn) => { btn.hidden = !active; });
}

function clearSearchFilters() {
  // Cancel any in-flight debounced render so we don't double-render
  // right after the synchronous clear.
  if (filterRenderTimer) {
    clearTimeout(filterRenderTimer);
    filterRenderTimer = null;
  }
  elements.filterText.value = "";
  elements.filterFieldMobile.value = "all";
  elements.filterConcept.value = "all";
  elements.categoryFilter.value = "all";
  elements.typeFilter.value = "all";
  renderMovements();
  refreshSearchButtonState();
}

// Live re-filter on every input/change event from any of the controls.
// Re-rendering ~1000 cards on every keystroke is heavy enough to feel
// laggy while typing fast, so debounce the text input. Dropdowns are
// single events (no rapid stream) so they re-render synchronously for
// instant feedback.
let filterRenderTimer = null;
function scheduleFilterRender(delay) {
  if (filterRenderTimer) clearTimeout(filterRenderTimer);
  filterRenderTimer = setTimeout(() => {
    filterRenderTimer = null;
    renderMovements();
    refreshSearchButtonState();
  }, delay);
}

elements.filterText.addEventListener("input", () => scheduleFilterRender(140));
elements.filterFieldMobile.addEventListener("change", () => scheduleFilterRender(0));
[
  elements.filterConcept,
  elements.categoryFilter,
  elements.typeFilter,
].forEach((control) => {
  control.addEventListener("change", () => scheduleFilterRender(0));
});

// Mobile-only: "Filtrar" toggles the inline filter row inside the sticky
// header. Class-based so the desktop CSS can keep the bar permanently
// visible without fighting the [hidden] attribute.
elements.openFilter.addEventListener("click", () => {
  const collapsed = elements.filterBar.classList.toggle("is-collapsed-mobile");
  elements.openFilter.setAttribute("aria-expanded", String(!collapsed));
  if (!collapsed) elements.filterText.focus();
});

elements.resetSearchButtons.forEach((btn) => {
  btn.addEventListener("click", clearSearchFilters);
});

refreshSearchButtonState();

elements.openMovementModal.addEventListener("click", () => {
  resetMovementForm();
  elements.feedback.textContent = "";
  openMovementModal();
});

// CTA del Home: atajo al modal de Nuevo movimiento sin tener que ir
// a la vista Movimientos primero. Mismo flujo que el botón principal.
elements.homeAddMovementCta?.addEventListener("click", () => {
  resetMovementForm();
  elements.feedback.textContent = "";
  openMovementModal();
});

// "Convertir en plantilla periódica" — visible only while editing an
// existing, non-virtual, non-already-linked movement. Closes the
// movement modal and opens the recurring modal pre-filled with the
// source data; the recurring submit handler will link the source row.
elements.convertToRecurring?.addEventListener("click", () => {
  try {
    // Dos contextos posibles: editando un movement (1↔1 con mi parte
    // > 0, y modos equal/uneven) o editando un shared_entry sin
    // movement asociado (modos `me-full` / `them-full`, donde la app
    // no crea movement personal). Capturamos el objeto fuente antes
    // de cerrar/resetear el form, que limpia el estado.
    if (state.editingMovementId) {
      const movement = state.movements.find((m) => m.id === state.editingMovementId);
      if (!movement) {
        console.warn("[convert] movement not found for id", state.editingMovementId);
        return;
      }
      const captured = movement;
      closeMovementModal();
      resetMovementForm();
      openConvertFromMovement(captured);
      return;
    }
    if (state.editingSharedEntryId) {
      const entry = state.sharedEntries.find((e) => e.id === state.editingSharedEntryId);
      if (!entry) {
        console.warn("[convert] shared entry not found for id", state.editingSharedEntryId);
        return;
      }
      const captured = entry;
      closeMovementModal();
      resetMovementForm();
      openConvertFromSharedEntry(captured);
      return;
    }
    console.warn("[convert] no editing context (neither movement nor shared entry)");
  } catch (err) {
    console.error("[convert] failed", err);
    alert("No se pudo abrir la conversión a plantilla. Mira consola.");
  }
});

elements.closeMovementModal.addEventListener("click", closeMovementModal);

elements.movementModal.addEventListener("click", (event) => {
  if (event.target === elements.movementModal) {
    closeMovementModal();
  }
});

elements.type.addEventListener("change", () => {
  syncMovementSelects();
  syncSharedFields();
});

elements.concept.addEventListener("change", syncCategoryFromConcept);

elements.isShared.addEventListener("change", () => {
  syncSharedFields();
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(elements.form);
  const totalAmount = Number(formData.get("amount"));
  const wasEditing = !!state.editingMovementId || !!state.editingSharedEntryId;
  const shouldShare = elements.isShared.checked && formData.get("type") === "expense";
  const editingPartner = !!state.editingPartnerEntry;

  // Partner-entry edit path: short-circuit the regular flow. We don't
  // create a movement on this user's side (the source movement lives in
  // the partner's account). We update the existing shared_entry in
  // place — preserving id, ownerId, contactId, createdAt and the
  // partner's sourceMovementId — and un-flip the form's MY-perspective
  // values back to the OWNER's perspective so the cloud row stays
  // consistent across both sides.
  if (editingPartner && shouldShare) {
    const oldEntry = state.sharedEntries.find((e) => e.id === state.editingSharedEntryId);
    if (!oldEntry) {
      elements.feedback.textContent = "Entrada no encontrada.";
      return;
    }
    const modeKeyEdit = elements.sharedMode.value;
    const mode = SHARED_MODES[modeKeyEdit];
    if (!mode) {
      elements.feedback.textContent = "Selecciona el modo del gasto compartido.";
      return;
    }
    const { myShare, theirShare } = computeSharedShares(
      totalAmount,
      modeKeyEdit,
      elements.sharedMyShare.value,
      elements.sharedTheirShare.value
    );
    if (mode.split === "uneven") {
      const sum = Math.round((myShare + theirShare) * 100) / 100;
      if (Math.abs(sum - totalAmount) >= 0.005) {
        elements.feedback.textContent = `Las partes (${formatMoney(sum)}) no coinciden con el total (${formatMoney(totalAmount)}).`;
        return;
      }
    }

    const concept = formData.get("concept");
    const note = (formData.get("note") || "").trim();
    const date = formData.get("date");

    // Un-flip: form values are in MY perspective; the cloud row needs
    // OWNER perspective. paid_by toggles, the shares swap.
    const updatedEntry = {
      ...oldEntry,
      date,
      concept,
      note,
      total: totalAmount,
      paidBy: mode.paidBy === "me" ? "them" : "me",
      splitMode: mode.split,
      myShare: theirShare,
      theirShare: myShare,
      // settledAt, sourceMovementId, ownerId, id, contactId, createdAt
      // all preserved by the spread.
    };

    state.sharedEntries = state.sharedEntries.map((e) =>
      e.id === oldEntry.id ? updatedEntry : e
    );

    saveSharedEntries();
    // Await the audit-log POST so by the time the form closes the row
    // is in the cloud. Otherwise opening the history modal right after
    // a save races with the in-flight insert and shows N-1 entries.
    await recordSharedEntryEdit(oldEntry, updatedEntry, formData.get("editComment"));
    renderMovements();
    renderAnalysis();
    renderSharedView();
    elements.feedback.textContent = "Cambios guardados en la entrada del otro usuario.";
    resetMovementForm();
    closeMovementModal();
    return;
  }

  const movement = createMovement(formData);

  let sharedEntry = null;
  let modeKey = null;
  // Capture the pre-edit shared entry (if any) so we can preserve id +
  // createdAt + settledAt across the save and so the audit-log call has
  // both before/after to diff. Without preserving id, every edit would
  // create a new shared_entry id and break the history thread.
  let oldSharedEntry = null;
  if (wasEditing) {
    if (state.editingSharedEntryId) {
      oldSharedEntry = state.sharedEntries.find((e) => e.id === state.editingSharedEntryId);
    } else if (state.editingMovementId) {
      const oldMov = state.movements.find((m) => m.id === state.editingMovementId);
      if (oldMov?.sharedEntryId) {
        oldSharedEntry = state.sharedEntries.find((e) => e.id === oldMov.sharedEntryId);
      }
    }
  }

  // Detectar si el target del compartido es un grupo o un contacto.
  const sharedTarget = shouldShare
    ? parseSharedTarget(elements.sharedContact.value)
    : { kind: "none", id: null };
  const isGroupShare = sharedTarget.kind === "group";

  if (shouldShare && isGroupShare) {
    // Caso grupo (3+ personas): construimos splits a partir del
    // pagador + modo del grupo, y guardamos la entrada con group_id.
    const groupId = sharedTarget.id;
    const payerMemberId = elements.sharedGroupPayer?.value;
    const groupMode = elements.sharedGroupMode?.value || "equal";

    if (!groupId || !payerMemberId) {
      elements.feedback.textContent = "Selecciona grupo y pagador.";
      return;
    }

    let splits;
    try {
      splits = buildSplits({
        groupId,
        total: totalAmount,
        payerMemberId,
        mode: groupMode,
        perMemberShares: groupMode === "uneven" ? readSharedGroupShares() : null,
      });
    } catch (err) {
      elements.feedback.textContent = err.message;
      return;
    }

    // Calcular MI parte (lo que owes el miembro que soy yo). Lo
    // usamos como amount del movimiento personal; si yo no soy
    // miembro del grupo (caso raro), no creamos movimiento personal.
    const myMember = getMyMemberInGroup(groupId);
    const myOwes = myMember ? Number(splits[myMember.id]?.owes) || 0 : 0;
    const myPaid = myMember ? Number(splits[myMember.id]?.paid) || 0 : 0;

    sharedEntry = {
      id: oldSharedEntry?.id ?? createId(),
      type: "expense",
      contactId: "", // legacy 1↔1 field; vacío en entradas de grupo.
      date: movement.date,
      concept: movement.concept,
      note: movement.note ?? "",
      total: totalAmount,
      paidBy: "me", // legacy field — para entradas de grupo no se usa.
      splitMode: groupMode,
      myShare: myOwes,
      theirShare: 0,
      sourceMovementId: movement.id,
      groupId,
      splits,
      settledAt: oldSharedEntry?.settledAt ?? null,
      createdAt: oldSharedEntry?.createdAt ?? new Date().toISOString(),
      ownerId: oldSharedEntry?.ownerId ?? undefined,
    };

    // Si yo no consumo nada del gasto (myOwes === 0) Y no soy
    // pagador, no creamos movimiento personal — solo la entrada
    // de grupo. Si soy pagador o tengo parte que owes, sí creamos.
    if (myOwes > 0) {
      movement.amount = myOwes;
      movement.sharedEntryId = sharedEntry.id;
    }
    // Si soy pagador pero mi owes es 0, también creamos un movimiento
    // pequeño? No — si no consumo nada, mi gasto personal real es 0.
    // El movimiento se omite y solo queda la entrada de grupo con los
    // saldos pendientes a mi favor.
  } else if (shouldShare) {
    const contactId = sharedTarget.id;
    modeKey = elements.sharedMode.value;
    const mode = SHARED_MODES[modeKey];

    if (!contactId || !mode) {
      elements.feedback.textContent = "Selecciona contacto y modo del gasto compartido.";
      return;
    }

    const { myShare, theirShare } = computeSharedShares(
      totalAmount,
      modeKey,
      elements.sharedMyShare.value,
      elements.sharedTheirShare.value
    );

    if (mode.split === "uneven") {
      const sum = Math.round((myShare + theirShare) * 100) / 100;
      if (Math.abs(sum - totalAmount) >= 0.005) {
        elements.feedback.textContent = `Las partes (${formatMoney(sum)}) no coinciden con el total (${formatMoney(totalAmount)}).`;
        return;
      }
    }

    sharedEntry = buildSharedExpenseEntry({
      contactId,
      total: totalAmount,
      modeKey,
      myShare,
      theirShare,
      date: movement.date,
      concept: movement.concept,
      note: movement.note,
      sourceMovementId: movement.id,
    });

    // Preserve invariants when editing an existing entry: id, createdAt
    // and settledAt should not churn just because the user tweaked the
    // amount. wasEditing ensures we've already captured oldSharedEntry.
    if (oldSharedEntry) {
      sharedEntry.id = oldSharedEntry.id;
      sharedEntry.createdAt = oldSharedEntry.createdAt;
      sharedEntry.settledAt = oldSharedEntry.settledAt ?? null;
      if (oldSharedEntry.ownerId) sharedEntry.ownerId = oldSharedEntry.ownerId;
    }

    movement.amount = myShare;
    movement.sharedEntryId = sharedEntry.id;
  }

  // Skip movimiento personal: en 1↔1 cuando es "me-full" (préstamo
  // completo). En grupo, cuando mi parte (owes) es 0 — ej: pago algo
  // íntegro para los demás y no consumo nada (skipMovement permite no
  // contaminar el flujo personal con un gasto que no es mío).
  const skipMovement = shouldShare && (
    isGroupShare
      ? !movement.sharedEntryId
      : (SHARED_MODES[modeKey].paidBy === "me" && SHARED_MODES[modeKey].split === "full")
  );

  if (wasEditing) {
    if (state.editingMovementId) {
      const oldMovement = state.movements.find((m) => m.id === state.editingMovementId);
      if (oldMovement?.sharedEntryId) {
        state.sharedEntries = state.sharedEntries.filter((e) => e.id !== oldMovement.sharedEntryId);
      }
      state.movements = state.movements.filter((m) => m.id !== state.editingMovementId);
    }
    if (state.editingSharedEntryId) {
      const oldEntry = state.sharedEntries.find((e) => e.id === state.editingSharedEntryId);
      if (oldEntry?.sourceMovementId) {
        state.movements = state.movements.filter((m) => m.id !== oldEntry.sourceMovementId);
      }
      state.sharedEntries = state.sharedEntries.filter((e) => e.id !== state.editingSharedEntryId);
    }
    state.editingMovementId = null;
    state.editingSharedEntryId = null;
    elements.submitLabel.textContent = "Anadir movimiento";
    elements.feedback.textContent = "Cambios guardados.";
  } else {
    elements.feedback.textContent = skipMovement
      ? "Prestamo registrado en Compartidos."
      : "Movimiento anadido.";
  }

  if (!skipMovement) {
    state.movements = [movement, ...state.movements];
  }
  if (sharedEntry) {
    if (skipMovement) {
      sharedEntry.sourceMovementId = null;
    }
    state.sharedEntries = [sharedEntry, ...state.sharedEntries];
  }

  saveMovements();
  saveSharedEntries();

  // Audit log: every save that touches a shared entry — creation,
  // edit, or movement-with-share edit — leaves a row. Awaited so the
  // history modal opened right after a save sees the new row instead
  // of racing with the in-flight insert.
  if (sharedEntry) {
    await recordSharedEntryEdit(oldSharedEntry, sharedEntry, formData.get("editComment"));
  }

  renderMovements();
  renderAnalysis();
  if (sharedEntry || wasEditing) {
    renderSharedView();
  }

  resetMovementForm(movement);
  closeMovementModal();
});
