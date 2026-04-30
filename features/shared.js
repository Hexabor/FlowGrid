import { state } from "../core/state.js";
import { elements, openMovementModal } from "../core/dom.js";
import { saveMovements, saveSharedEntries, saveContacts } from "../core/storage.js";
import { SHARED_MODES } from "../core/constants.js";
import { createId, formatDate, formatMoney, formatMonthLabel } from "../core/utils.js";
import { getContactName, getSharedBalance, contactHasEntries, renderContacts } from "./contacts.js";
import { renderMovements, syncMovementSelects, fillMovementForm } from "./movements.js";
import { setMovementDate, setPaymentDate } from "../ui/datepicker.js";

export function entryBalanceImpact(entry) {
  if (entry.type === "expense") {
    return entry.paidBy === "me" ? entry.theirShare : -entry.myShare;
  }
  return entry.paidBy === "me" ? entry.total : -entry.total;
}

export function entryDescription(entry) {
  const contactName = getContactName(entry.contactId);
  if (entry.type === "payment") {
    return entry.paidBy === "me"
      ? `Pago a ${contactName}`
      : `${contactName} te paga`;
  }
  const mode = entry.splitMode === "full"
    ? entry.paidBy === "me" ? `Prestado a ${contactName}` : `Cubierto por ${contactName}`
    : entry.paidBy === "me" ? `Pagaste tu` : `Pago ${contactName}`;
  return `${entry.concept} — ${mode}`;
}

export function getMovementSharedLabel(movement) {
  if (!movement.sharedEntryId) {
    return "";
  }
  const entry = state.sharedEntries.find((candidate) => candidate.id === movement.sharedEntryId);
  if (!entry) {
    return "";
  }
  return getContactName(entry.contactId);
}

export function inferSharedModeKey(entry) {
  for (const [key, mode] of Object.entries(SHARED_MODES)) {
    if (mode.paidBy === entry.paidBy && mode.split === entry.splitMode) {
      return key;
    }
  }
  return "me-equal";
}

export function buildSharedExpenseEntry({ contactId, total, modeKey, myShare, theirShare, date, concept, note, sourceMovementId }) {
  const mode = SHARED_MODES[modeKey];

  return {
    id: createId(),
    type: "expense",
    contactId,
    date,
    concept,
    note: note || "",
    total,
    paidBy: mode.paidBy,
    splitMode: mode.split,
    myShare,
    theirShare,
    sourceMovementId: sourceMovementId || null,
    createdAt: new Date().toISOString(),
  };
}

export function buildSharedPaymentEntry({ contactId, total, paidBy, date, note }) {
  return {
    id: createId(),
    type: "payment",
    contactId,
    date,
    concept: "Liquidacion",
    note: note || "",
    total,
    paidBy,
    splitMode: "payment",
    myShare: 0,
    theirShare: 0,
    sourceMovementId: null,
    createdAt: new Date().toISOString(),
  };
}

export function computeSharedShares(total, modeKey, rawMyShare, rawTheirShare) {
  const mode = SHARED_MODES[modeKey];

  if (!mode) {
    throw new Error("Modo compartido invalido");
  }

  if (mode.split === "equal") {
    const half = Math.round((total / 2) * 100) / 100;
    return { myShare: half, theirShare: total - half };
  }

  if (mode.split === "full") {
    if (mode.paidBy === "me") {
      return { myShare: 0, theirShare: total };
    }
    return { myShare: total, theirShare: 0 };
  }

  const myShare = Math.round((Number(rawMyShare) || 0) * 100) / 100;
  const theirShare = Math.round((Number(rawTheirShare) || 0) * 100) / 100;
  return { myShare, theirShare };
}

export function syncSharedFields() {
  const isExpense = elements.type.value === "expense";
  elements.isShared.disabled = !isExpense;
  if (!isExpense) {
    elements.isShared.checked = false;
  }

  const enabled = elements.isShared.checked && isExpense;
  elements.sharedFields.hidden = !enabled;
  elements.sharedContact.required = enabled;
  elements.sharedMode.required = enabled;

  if (!enabled) {
    elements.sharedUneven.hidden = true;
    elements.sharedMyShare.required = false;
    elements.sharedTheirShare.required = false;
    return;
  }

  syncSharedContactOptions();
  syncSharedModeLabels();
  syncSharedUnevenVisibility();
  syncSharedTotalHint();
}

export function syncSharedContactOptions() {
  const selected = elements.sharedContact.value;
  elements.sharedContact.innerHTML = state.contacts.length
    ? state.contacts.map((contact) => `<option value="${contact.id}">${contact.name}</option>`).join("")
    : '<option value="">Sin contactos creados</option>';

  if (selected && state.contacts.some((contact) => contact.id === selected)) {
    elements.sharedContact.value = selected;
  }
}

export function syncSharedModeLabels() {
  const name = getContactName(elements.sharedContact.value) || "Contacto";
  Object.entries(SHARED_MODES).forEach(([key, mode]) => {
    const option = elements.sharedMode.querySelector(`option[value="${key}"]`);
    if (option) {
      option.textContent = mode.label.replace("{name}", name);
    }
  });
}

export function syncSharedUnevenVisibility() {
  const mode = SHARED_MODES[elements.sharedMode.value];
  const isUneven = mode?.split === "uneven";
  elements.sharedUneven.hidden = !isUneven;
  elements.sharedMyShare.required = isUneven;
  elements.sharedTheirShare.required = isUneven;
  elements.sharedTheirShareLabel.textContent = `Parte de ${getContactName(elements.sharedContact.value) || "el otro contacto"}`;
}

export function syncSharedTotalHint() {
  const total = Number(elements.amount.value) || 0;
  const mode = SHARED_MODES[elements.sharedMode.value];

  if (!mode || mode.split !== "uneven") {
    elements.sharedUnevenFeedback.textContent = "";
    return;
  }

  const my = Number(elements.sharedMyShare.value) || 0;
  const their = Number(elements.sharedTheirShare.value) || 0;
  const sum = my + their;
  const diff = Math.round((total - sum) * 100) / 100;

  if (!total) {
    elements.sharedUnevenFeedback.textContent = "Introduce primero el importe total.";
    elements.sharedUnevenFeedback.dataset.state = "warn";
  } else if (Math.abs(diff) < 0.005) {
    elements.sharedUnevenFeedback.textContent = `Total ${formatMoney(total)} — coincide.`;
    elements.sharedUnevenFeedback.dataset.state = "ok";
  } else if (diff > 0) {
    elements.sharedUnevenFeedback.textContent = `Total ${formatMoney(total)} — faltan ${formatMoney(diff)}.`;
    elements.sharedUnevenFeedback.dataset.state = "warn";
  } else {
    elements.sharedUnevenFeedback.textContent = `Total ${formatMoney(total)} — sobran ${formatMoney(-diff)}.`;
    elements.sharedUnevenFeedback.dataset.state = "warn";
  }
}

export function applySharedEntryToForm(entry) {
  elements.amount.value = entry.total;
  elements.isShared.checked = true;
  syncSharedFields();
  elements.sharedContact.value = entry.contactId;
  syncSharedModeLabels();
  elements.sharedMode.value = inferSharedModeKey(entry);
  syncSharedUnevenVisibility();
  if (entry.splitMode === "uneven") {
    elements.sharedMyShare.value = entry.myShare;
    elements.sharedTheirShare.value = entry.theirShare;
  }
  syncSharedTotalHint();
}

export function openSharedEntryEdit(entry) {
  if (entry.type !== "expense") {
    return;
  }

  if (entry.sourceMovementId) {
    const movement = state.movements.find((candidate) => candidate.id === entry.sourceMovementId);
    if (!movement) {
      alert("Movimiento asociado no encontrado.");
      return;
    }
    state.editingMovementId = movement.id;
    state.editingSharedEntryId = null;
    fillMovementForm(movement);
  } else {
    state.editingMovementId = null;
    state.editingSharedEntryId = entry.id;
    elements.type.value = "expense";
    syncMovementSelects();
    const concept = state.settings.concepts.find((c) => c.label === entry.concept);
    elements.concept.value = entry.concept;
    elements.category.value = concept?.category ?? state.settings.categories[0]?.value ?? "extra";
    setMovementDate(new Date(`${entry.date}T00:00:00`));
    elements.party.value = "";
    elements.recurrence.value = "";
    elements.note.value = entry.note || "";
    applySharedEntryToForm(entry);
  }

  elements.submitLabel.textContent = "Guardar cambios";
  elements.feedback.textContent = "Editando entrada compartida.";
  openMovementModal();
}

export function openLiquidateModal(contactId) {
  const balance = getSharedBalance(contactId);
  if (Math.abs(balance) < 0.005) {
    return;
  }

  elements.paymentModal.hidden = false;
  elements.paymentForm.reset();
  elements.paymentFeedback.textContent = "";
  elements.paymentContact.innerHTML = state.contacts
    .map((contact) => `<option value="${contact.id}">${contact.name}</option>`)
    .join("");
  elements.paymentContact.value = contactId;
  elements.paymentAmount.value = Math.abs(balance).toFixed(2);
  setPaymentDate(new Date());

  const contactName = getContactName(contactId);
  const direction = balance > 0 ? `${contactName} te paga` : `tu pagas a ${contactName}`;
  elements.paymentTitle.textContent = `Liquidar saldo con ${contactName}`;
  elements.paymentFeedback.textContent = `Saldo actual: ${formatMoney(Math.abs(balance))} (${direction})`;
  elements.paymentAmount.focus();
  elements.paymentAmount.select();
}

export function closePaymentModal() {
  elements.paymentModal.hidden = true;
}

export function renderSharedView() {
  renderSharedBalances();
  renderSharedFilterOptions();
  renderSharedEntries();
}

function renderSharedBalances() {
  const contactsWithActivity = state.contacts.filter(
    (contact) => contactHasEntries(contact.id)
  );

  elements.sharedContactsCount.textContent = `${contactsWithActivity.length} contactos activos`;
  elements.sharedBalances.innerHTML = "";

  if (!state.contacts.length) {
    elements.sharedBalances.innerHTML =
      '<p class="empty-state">Crea contactos en Configuracion para empezar a registrar gastos compartidos.</p>';
    return;
  }

  if (!contactsWithActivity.length) {
    elements.sharedBalances.innerHTML =
      '<p class="empty-state">Sin actividad. Anade un gasto compartido desde Movimientos.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  contactsWithActivity
    .map((contact) => ({ contact, balance: getSharedBalance(contact.id) }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    .forEach(({ contact, balance }) => {
      const card = document.createElement("article");
      const header = document.createElement("div");
      const name = document.createElement("strong");
      const hint = document.createElement("span");
      const value = document.createElement("span");
      const actions = document.createElement("div");

      card.className = "balance-card";
      card.dataset.contactId = contact.id;
      card.classList.toggle("is-positive", balance > 0.005);
      card.classList.toggle("is-negative", balance < -0.005);
      card.classList.toggle("is-zero", Math.abs(balance) < 0.005);

      header.className = "balance-header";
      name.textContent = contact.name;
      hint.className = "balance-hint";

      if (Math.abs(balance) < 0.005) {
        hint.textContent = "Saldado";
      } else if (balance > 0) {
        hint.textContent = "te debe";
      } else {
        hint.textContent = "le debes";
      }

      header.append(name, hint);

      value.className = "balance-amount";
      value.textContent = formatMoney(Math.abs(balance));

      actions.className = "balance-actions";

      const viewButton = document.createElement("button");
      viewButton.type = "button";
      viewButton.className = "balance-action ghost";
      viewButton.dataset.action = "view";
      viewButton.textContent = "Ver entradas";

      const settleButton = document.createElement("button");
      settleButton.type = "button";
      settleButton.className = "balance-action settle";
      settleButton.dataset.action = "settle";
      settleButton.disabled = Math.abs(balance) < 0.005;
      const direction = balance > 0 ? `${contact.name} te paga` : `Tu pagas a ${contact.name}`;
      settleButton.innerHTML = Math.abs(balance) < 0.005
        ? `<strong>Saldo al dia</strong>`
        : `<strong>Liquidar saldo</strong><small>${direction}</small>`;

      actions.append(viewButton, settleButton);

      card.append(header, value, actions);
      fragment.append(card);
    });

  elements.sharedBalances.append(fragment);
}

function renderSharedFilterOptions() {
  const selected = state.sharedFilterContactId;
  const options = ['<option value="all">Todos</option>'].concat(
    state.contacts.map((contact) => `<option value="${contact.id}">${contact.name}</option>`)
  );
  elements.sharedContactFilter.innerHTML = options.join("");
  elements.sharedContactFilter.value = state.contacts.some((contact) => contact.id === selected) ? selected : "all";
  state.sharedFilterContactId = elements.sharedContactFilter.value;
}

function renderSharedEntries() {
  const contactId = state.sharedFilterContactId;

  let entries = [...state.sharedEntries];

  if (contactId !== "all") {
    entries = entries.filter((entry) => entry.contactId === contactId);
  }

  entries.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

  elements.sharedEntries.innerHTML = "";

  if (!entries.length) {
    elements.sharedEntries.innerHTML = '<p class="empty-state">Sin entradas con este contacto.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  let lastMonthKey = null;

  entries.forEach((entry) => {
    const monthKey = entry.date.slice(0, 7);
    if (monthKey !== lastMonthKey) {
      const monthHeader = document.createElement("div");
      monthHeader.className = "month-group";
      monthHeader.textContent = formatMonthLabel(entry.date);
      fragment.append(monthHeader);
      lastMonthKey = monthKey;
    }
    fragment.append(buildSharedEntryRow(entry));
  });

  elements.sharedEntries.append(fragment);
}

function buildSharedEntryRow(entry) {
  const row = document.createElement("article");
  row.className = "shared-entry";
  row.dataset.id = entry.id;
  row.dataset.type = entry.type;

  const date = document.createElement("span");
  date.className = "shared-entry-date";
  date.textContent = formatDate(entry.date);

  const main = document.createElement("div");
  main.className = "shared-entry-main";
  const description = document.createElement("strong");
  description.textContent = entryDescription(entry);
  main.append(description);

  if (entry.note) {
    const note = document.createElement("span");
    note.className = "shared-entry-note";
    note.textContent = entry.note;
    main.append(note);
  }

  if (entry.type === "expense" && entry.splitMode !== "full") {
    const breakdown = document.createElement("span");
    breakdown.className = "shared-entry-breakdown";
    const contactName = getContactName(entry.contactId);
    breakdown.textContent = `Total ${formatMoney(entry.total)} — tu ${formatMoney(entry.myShare)} · ${contactName} ${formatMoney(entry.theirShare)}`;
    main.append(breakdown);
  }

  const impact = entryBalanceImpact(entry);
  const amount = document.createElement("span");
  amount.className = "shared-entry-amount";
  if (impact > 0.005) {
    amount.classList.add("income");
    amount.textContent = `+${formatMoney(impact)}`;
  } else if (impact < -0.005) {
    amount.classList.add("expense");
    amount.textContent = `-${formatMoney(-impact)}`;
  } else {
    amount.textContent = formatMoney(0);
  }

  row.append(date, main, amount);

  if (entry.type === "expense") {
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "edit-action";
    editButton.dataset.action = "edit-shared";
    editButton.title = "Editar";
    editButton.textContent = "Editar";
    row.append(editButton);
  }

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-action";
  deleteButton.dataset.action = "delete-shared";
  deleteButton.title = "Eliminar";
  deleteButton.textContent = "x";
  row.append(deleteButton);

  return row;
}

elements.sharedContact.addEventListener("change", () => {
  syncSharedModeLabels();
  syncSharedUnevenVisibility();
});

elements.sharedMode.addEventListener("change", () => {
  syncSharedUnevenVisibility();
  syncSharedTotalHint();
});

elements.sharedMyShare.addEventListener("input", syncSharedTotalHint);
elements.sharedTheirShare.addEventListener("input", syncSharedTotalHint);
elements.amount.addEventListener("input", syncSharedTotalHint);

elements.sharedContactAdd.addEventListener("click", () => {
  const name = prompt("Nombre del contacto:");
  if (!name?.trim()) {
    return;
  }
  const trimmed = name.trim();
  const existing = state.contacts.find((contact) => contact.name.toLowerCase() === trimmed.toLowerCase());
  let contactId;
  if (existing) {
    contactId = existing.id;
  } else {
    const created = { id: createId(), name: trimmed, email: "", invitedAt: null, createdAt: new Date().toISOString() };
    state.contacts = [...state.contacts, created];
    saveContacts();
    contactId = created.id;
  }
  syncSharedContactOptions();
  elements.sharedContact.value = contactId;
  syncSharedModeLabels();
  syncSharedUnevenVisibility();
  renderContacts();
});

elements.sharedEntries.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='delete-shared']");

  if (!button) {
    return;
  }

  const row = event.target.closest("[data-id]");
  const entry = state.sharedEntries.find((candidate) => candidate.id === row.dataset.id);

  if (!entry) {
    return;
  }

  const action = button.dataset.action;

  if (action === "edit-shared") {
    openSharedEntryEdit(entry);
    return;
  }

  if (!confirm(`Eliminar entrada "${entry.concept}" con ${getContactName(entry.contactId)}?`)) {
    return;
  }

  state.sharedEntries = state.sharedEntries.filter((candidate) => candidate.id !== entry.id);
  if (entry.sourceMovementId) {
    state.movements = state.movements.map((movement) =>
      movement.id === entry.sourceMovementId ? { ...movement, sharedEntryId: null } : movement
    );
    saveMovements();
  }
  saveSharedEntries();
  renderSharedView();
  renderMovements();
});

elements.sharedContactFilter.addEventListener("change", () => {
  state.sharedFilterContactId = elements.sharedContactFilter.value;
  renderSharedEntries();
});

elements.sharedBalances.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  const card = event.target.closest("[data-contact-id]");
  if (!card) {
    return;
  }

  const contactId = card.dataset.contactId;
  const action = button?.dataset.action || "view";

  if (action === "settle") {
    openLiquidateModal(contactId);
    return;
  }

  state.sharedFilterContactId = contactId;
  elements.sharedContactFilter.value = state.sharedFilterContactId;
  renderSharedEntries();
  document.querySelector("#shared-entries")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

elements.closePaymentModal.addEventListener("click", closePaymentModal);

elements.paymentModal.addEventListener("click", (event) => {
  if (event.target === elements.paymentModal) {
    closePaymentModal();
  }
});

elements.paymentForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const contactId = elements.paymentContact.value;
  const amount = Number(elements.paymentAmount.value);
  const date = elements.paymentDate.value;
  const note = elements.paymentNote.value.trim();

  if (!contactId || !Number.isFinite(amount) || amount <= 0 || !date) {
    elements.paymentFeedback.textContent = "Completa contacto, importe y fecha.";
    return;
  }

  const balance = getSharedBalance(contactId);
  if (Math.abs(balance) < 0.005) {
    elements.paymentFeedback.textContent = "No hay saldo con este contacto.";
    return;
  }

  const entry = buildSharedPaymentEntry({
    contactId,
    total: amount,
    paidBy: balance > 0 ? "them" : "me",
    date,
    note,
  });

  state.sharedEntries = [entry, ...state.sharedEntries];
  saveSharedEntries();
  closePaymentModal();
  renderSharedView();
});
