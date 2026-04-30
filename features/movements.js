import { state } from "../core/state.js";
import { elements, openMovementModal, closeMovementModal } from "../core/dom.js";
import { saveMovements, saveSharedEntries } from "../core/storage.js";
import { createId, formatDate, formatMoney, formatMonthLabel, optionMarkup } from "../core/utils.js";
import { SHARED_MODES } from "../core/constants.js";
import {
  applySharedEntryToForm,
  buildSharedExpenseEntry,
  computeSharedShares,
  getMovementSharedLabel,
  renderSharedView,
  syncSharedFields,
} from "./shared.js";
import { renderAnalysis } from "./analysis.js";
import { setMovementDate } from "../ui/datepicker.js";

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
  elements.categoryFilter.innerHTML = '<option value="all">Todas</option>' + optionMarkup(state.settings.categories);
  elements.newConceptCategory.innerHTML = optionMarkup(state.settings.categories);
  syncCategoryFromConcept();
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

export function getFilteredMovements() {
  const conceptQuery = elements.searchConcept.value.trim().toLowerCase();
  const noteQuery = elements.searchNote.value.trim().toLowerCase();
  const partyQuery = elements.searchParty.value.trim().toLowerCase();
  const selectedCategory = elements.categoryFilter.value;
  const selectedType = elements.typeFilter.value;
  const { key, dir } = state.movementSort;

  return state.movements
    .filter((movement) => selectedType === "all" || movement.type === selectedType)
    .filter((movement) => selectedCategory === "all" || movement.category === selectedCategory)
    .filter((movement) => !conceptQuery || (movement.concept || "").toLowerCase().includes(conceptQuery))
    .filter((movement) => !noteQuery || (movement.note || "").toLowerCase().includes(noteQuery))
    .filter((movement) => !partyQuery || (movement.party || "").toLowerCase().includes(partyQuery))
    .sort((a, b) => {
      const cmp = compareMovements(a, b, key);
      // Tie-break by date desc + id so equal-key rows have a stable order.
      const fallback = b.date.localeCompare(a.date) || (b.id || "").localeCompare(a.id || "");
      return (dir === "asc" ? cmp : -cmp) || fallback;
    });
}

export function isSearchActive() {
  return Boolean(
    elements.searchConcept.value.trim() ||
      elements.searchNote.value.trim() ||
      elements.searchParty.value.trim() ||
      elements.categoryFilter.value !== "all" ||
      elements.typeFilter.value !== "all"
  );
}

export function createMovementCard(movement, compact = false) {
  const card = elements.template.content.firstElementChild.cloneNode(true);
  const signedAmount = getSignedAmount(movement);
  const recurrence = movement.recurrence || "Puntual";

  card.dataset.id = movement.id;
  card.classList.toggle("is-compact", compact);
  paintTag(card.querySelector(".tag"), movement.category);
  card.querySelector("h3").textContent = movement.concept;
  card.querySelector(".movement-note").textContent = movement.note || "";
  card.querySelector(".amount").textContent = formatMoney(signedAmount);
  card.querySelector(".amount").classList.add(movement.type);
  card.querySelector(".date").textContent = formatDate(movement.date);
  card.querySelector(".party").textContent = movement.party || "";
  card.querySelector(".recurrence").textContent = recurrence[0].toUpperCase() + recurrence.slice(1);
  card.querySelector(".shared-cell").textContent = getMovementSharedLabel(movement);

  if (compact) {
    card.querySelector(".delete-action").remove();
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
  items.forEach((movement) => {
    if (!compact && showDateGroups) {
      const monthKey = movement.date.slice(0, 7);
      if (monthKey !== lastMonthKey) {
        const monthHeader = document.createElement("div");
        monthHeader.className = "month-group";
        monthHeader.textContent = formatMonthLabel(movement.date);
        fragment.append(monthHeader);
        lastMonthKey = monthKey;
        lastDate = null;
      }
      if (movement.date !== lastDate) {
        const groupHeader = document.createElement("div");
        groupHeader.className = "date-group";
        groupHeader.textContent = formatDate(movement.date);
        fragment.append(groupHeader);
        lastDate = movement.date;
      }
    }
    fragment.append(createMovementCard(movement, compact));
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
  } else {
    elements.isShared.checked = false;
    syncSharedFields();
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
  elements.submitLabel.textContent = "Anadir movimiento";
  state.editingMovementId = null;
  state.editingSharedEntryId = null;
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

elements.list.addEventListener("click", (event) => {
  const editButton = event.target.closest(".edit-action");
  const duplicateButton = event.target.closest(".duplicate-action");
  const deleteButton = event.target.closest(".delete-action");

  if (!editButton && !duplicateButton && !deleteButton) {
    return;
  }

  const card = event.target.closest(".movement-card");
  const movement = state.movements.find((candidate) => candidate.id === card.dataset.id);

  if (!movement) {
    return;
  }

  if (editButton) {
    state.editingMovementId = movement.id;
    fillMovementForm(movement);
    elements.submitLabel.textContent = "Guardar cambios";
    elements.feedback.textContent = "Editando movimiento.";
    openMovementModal();
    elements.concept.focus();
    return;
  }

  if (duplicateButton) {
    state.editingMovementId = null;
    fillMovementForm(movement);
    elements.submitLabel.textContent = "Anadir movimiento";
    elements.feedback.textContent = "Copia preparada. Ajusta lo que cambie.";
    openMovementModal();
    elements.concept.focus();
    return;
  }

  const linkedEntry = movement.sharedEntryId
    ? state.sharedEntries.find((entry) => entry.id === movement.sharedEntryId)
    : null;

  if (confirm(`Eliminar "${movement.concept}" del ${formatDate(movement.date)}?`)) {
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
});

function refreshSearchButtonState() {
  elements.resetSearchButton.hidden = !isSearchActive();
}

function clearSearchFilters() {
  elements.searchConcept.value = "";
  elements.searchNote.value = "";
  elements.searchParty.value = "";
  elements.categoryFilter.value = "all";
  elements.typeFilter.value = "all";
  renderMovements();
  refreshSearchButtonState();
}

elements.openSearchModal.addEventListener("click", () => {
  elements.searchModal.hidden = false;
  elements.searchConcept.focus();
});

function closeSearchModal() {
  elements.searchModal.hidden = true;
}

elements.closeSearchModal.addEventListener("click", closeSearchModal);

elements.searchModal.addEventListener("click", (event) => {
  if (event.target === elements.searchModal) {
    closeSearchModal();
  }
});

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  closeSearchModal();
  renderMovements();
  refreshSearchButtonState();
});

elements.searchClear.addEventListener("click", () => {
  clearSearchFilters();
});

elements.resetSearchButton.addEventListener("click", clearSearchFilters);

refreshSearchButtonState();

elements.openMovementModal.addEventListener("click", () => {
  resetMovementForm();
  elements.feedback.textContent = "";
  openMovementModal();
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

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(elements.form);
  const totalAmount = Number(formData.get("amount"));
  const wasEditing = !!state.editingMovementId || !!state.editingSharedEntryId;
  const shouldShare = elements.isShared.checked && formData.get("type") === "expense";
  const movement = createMovement(formData);

  let sharedEntry = null;
  let modeKey = null;

  if (shouldShare) {
    const contactId = elements.sharedContact.value;
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

    movement.amount = myShare;
    movement.sharedEntryId = sharedEntry.id;
  }

  const skipMovement = shouldShare && SHARED_MODES[modeKey].paidBy === "me" && SHARED_MODES[modeKey].split === "full";

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
  renderMovements();
  renderAnalysis();
  if (sharedEntry || wasEditing) {
    renderSharedView();
  }

  resetMovementForm(movement);
  closeMovementModal();
});
