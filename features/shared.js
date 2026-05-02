import { state } from "../core/state.js";
import { elements, openMovementModal } from "../core/dom.js";
import { saveMovements, saveSharedEntries, saveContacts } from "../core/storage.js";
import { SHARED_MODES } from "../core/constants.js";
import { createId, formatDate, formatMoney, formatMonthLabel } from "../core/utils.js";
import { getContactName, getSharedBalance, contactHasEntries, renderContacts } from "./contacts.js";
import { renderMovements, syncMovementSelects, fillMovementForm } from "./movements.js";
import { setMovementDate, setPaymentDate } from "../ui/datepicker.js";
import { getUserIdSync } from "../core/supabase.js";
import { openHistoryModal, recordSharedEntryEdit } from "./edit-log.js";

// When the visiting user is a linked partner (the entry's ownerId is
// not theirs), the row's paid_by / my_share / their_share are stored
// in the OWNER's perspective. Flip everything to my point of view for
// display and balance arithmetic. Also remap contactId to my reciprocal
// contact for that owner so the entry shows up under "Juan" in my list
// instead of under the inviter's contact id (which doesn't exist locally
// for me). The flip is its own inverse, so the cloud row stays raw and
// only the consumed-for-render copy is flipped.
export function entryAsMyPerspective(entry) {
  const myUid = getUserIdSync();
  if (!entry.ownerId || !myUid || entry.ownerId === myUid) {
    return entry;
  }
  const myReciprocal = state.contacts.find((c) => c.authUserId === entry.ownerId);
  return {
    ...entry,
    contactId: myReciprocal?.id ?? entry.contactId,
    paidBy: entry.paidBy === "me" ? "them" : "me",
    myShare: entry.theirShare,
    theirShare: entry.myShare,
  };
}

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
    : entry.paidBy === "me" ? `Pagaste tú` : `Pagó ${contactName}`;
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
  // Movements always live in the same account as their linked entry, so
  // flipping is normally a no-op here, but call it through anyway in
  // case a partner-owned entry sneaks in via cross-account UI.
  return getContactName(entryAsMyPerspective(entry).contactId);
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

  const myUid = getUserIdSync();
  const isPartnerEntry = entry.ownerId && myUid && entry.ownerId !== myUid;

  if (entry.sourceMovementId && !isPartnerEntry) {
    // Original flow: my own entry → edit via the linked movement.
    const movement = state.movements.find((candidate) => candidate.id === entry.sourceMovementId);
    if (!movement) {
      alert("Movimiento asociado no encontrado.");
      return;
    }
    state.editingMovementId = movement.id;
    state.editingSharedEntryId = null;
    state.editingPartnerEntry = false;
    fillMovementForm(movement);
  } else {
    // Either my own entry without a linked movement, OR a partner-owned
    // entry being edited via the symmetric-edit shortcut. For partner
    // entries we flip to my POV so the form prefills with the values
    // the user actually sees on screen — the un-flip happens in the
    // submit handler before saving.
    state.editingMovementId = null;
    state.editingSharedEntryId = entry.id;
    state.editingPartnerEntry = isPartnerEntry;
    const formEntry = isPartnerEntry ? entryAsMyPerspective(entry) : entry;
    elements.type.value = "expense";
    syncMovementSelects();
    const concept = state.settings.concepts.find((c) => c.label === formEntry.concept);
    elements.concept.value = formEntry.concept;
    elements.category.value = concept?.category ?? state.settings.categories[0]?.value ?? "extra";
    setMovementDate(new Date(`${formEntry.date}T00:00:00`));
    elements.party.value = "";
    elements.recurrence.value = "";
    elements.note.value = formEntry.note || "";
    applySharedEntryToForm(formEntry);
    // Lock the contact selector when editing a partner entry: changing
    // the contact would require updating a contact_id row that lives in
    // the partner's account (which RLS doesn't let us touch).
    elements.sharedContact.disabled = isPartnerEntry;
  }

  // Editing any shared entry (own or partner) surfaces the optional
  // "comentario sobre el cambio" field. Cleared on each open.
  elements.editCommentField.hidden = false;
  elements.editComment.value = "";

  elements.submitLabel.textContent = "Guardar cambios";
  elements.feedback.textContent = isPartnerEntry
    ? "Editando entrada compartida del otro usuario. Los cambios quedan registrados."
    : "Editando entrada compartida.";
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
      '<p class="empty-state">Sin actividad. Añade un gasto compartido desde Movimientos.</p>';
    return;
  }

  // En móvil, mostramos solo la tarjeta del contacto seleccionado para
  // que el panel no se coma la pantalla. Si el filtro está en "Todos",
  // mostramos un mensaje guía. En desktop renderizamos la rejilla
  // entera como hasta ahora.
  const onMobile = window.matchMedia("(max-width: 719px)").matches;
  const selectedId = state.sharedFilterContactId;
  let toRender = contactsWithActivity;

  if (onMobile) {
    if (selectedId === "all") {
      elements.sharedBalances.innerHTML =
        '<p class="empty-state empty-state--inline">Elige un contacto arriba para ver su saldo.</p>';
      return;
    }
    toRender = contactsWithActivity.filter((c) => c.id === selectedId);
    if (!toRender.length) {
      elements.sharedBalances.innerHTML =
        '<p class="empty-state empty-state--inline">Sin actividad con este contacto.</p>';
      return;
    }
  }

  const fragment = document.createDocumentFragment();

  toRender
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
  const optionsMarkup = ['<option value="all">Todos</option>']
    .concat(state.contacts.map((contact) => `<option value="${contact.id}">${contact.name}</option>`))
    .join("");
  elements.sharedContactFilter.innerHTML = optionsMarkup;
  elements.sharedMobileContactPicker.innerHTML = optionsMarkup;

  const validSelected = state.contacts.some((contact) => contact.id === selected) ? selected : "all";
  elements.sharedContactFilter.value = validSelected;
  elements.sharedMobileContactPicker.value = validSelected;
  state.sharedFilterContactId = validSelected;
}

function renderSharedEntries() {
  const contactId = state.sharedFilterContactId;

  // Flip every entry to my perspective up front so the contactId filter
  // and the row builder both see entries as "from my point of view".
  // The original raw entries stay in state.sharedEntries untouched.
  let entries = state.sharedEntries.map(entryAsMyPerspective);

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
  const myUid = getUserIdSync();
  const isMine = !entry.ownerId || entry.ownerId === myUid;
  const isSettled = Boolean(entry.settledAt);

  const row = document.createElement("article");
  row.className = "shared-entry";
  row.dataset.id = entry.id;
  row.dataset.type = entry.type;
  if (isSettled) row.classList.add("is-settled");
  if (!isMine) row.classList.add("is-partner");

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

  if (isSettled) {
    const settledTag = document.createElement("span");
    settledTag.className = "shared-entry-settled-tag";
    settledTag.textContent = `Liquidado el ${formatDate(entry.settledAt.slice(0, 10))}`;
    main.append(settledTag);
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

  // Per-entry liquidate toggle. Available on expenses (settling a
  // payment row makes no sense — payments already cancel a balance).
  // Both sides can toggle, last-write-wins via RLS WITH CHECK.
  if (entry.type === "expense") {
    const settleButton = document.createElement("button");
    settleButton.type = "button";
    settleButton.className = "ghost-action shared-entry-settle";
    settleButton.dataset.action = "toggle-settle";
    settleButton.textContent = isSettled ? "Reabrir" : "Marcar liquidado";
    settleButton.title = isSettled
      ? "Volver a sumar al saldo"
      : "Quitar este gasto del saldo total";
    row.append(settleButton);
  }

  // History button on every expense row — opens a modal listing every
  // change anyone has made to this entry. Both sides can read the log.
  if (entry.type === "expense") {
    const historyButton = document.createElement("button");
    historyButton.type = "button";
    historyButton.className = "icon-button shared-entry-history";
    historyButton.dataset.action = "show-history";
    historyButton.title = "Ver historial de cambios";
    historyButton.setAttribute("aria-label", "Ver historial de cambios");
    historyButton.innerHTML =
      '<svg class="action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="9"></circle>' +
        '<path d="M12 7v5l3 2"></path>' +
      '</svg>';
    row.append(historyButton);
  }

  // Edit is allowed on both sides (symmetric editing): the form un-flips
  // values back to the owner's perspective on save. Delete stays scoped
  // to my own entries — removing the partner's row is destructive enough
  // that we keep it on the owner's side only for now.
  if (entry.type === "expense") {
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "edit-action";
    editButton.dataset.action = "edit-shared";
    editButton.title = "Editar";
    editButton.setAttribute("aria-label", "Editar entrada compartida");
    editButton.innerHTML =
      '<svg class="action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 20h9"></path>' +
        '<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>' +
      '</svg>';
    row.append(editButton);
  }

  if (isMine) {
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-action";
    deleteButton.dataset.action = "delete-shared";
    deleteButton.title = "Eliminar";
    deleteButton.textContent = "x";
    row.append(deleteButton);
  }

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

elements.sharedEntries.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const row = event.target.closest("[data-id]");
  if (!row) return;

  const entry = state.sharedEntries.find((candidate) => candidate.id === row.dataset.id);
  if (!entry) return;

  const action = button.dataset.action;

  if (action === "edit-shared") {
    openSharedEntryEdit(entry);
    return;
  }

  if (action === "toggle-settle") {
    // Capture the pre-toggle state so the audit log diff can pick up
    // the settledAt transition.
    const before = { ...entry };
    entry.settledAt = entry.settledAt ? null : new Date().toISOString();
    saveSharedEntries();
    // Awaited so opening the history modal right after toggling shows
    // the new row instead of racing with the in-flight insert.
    await recordSharedEntryEdit(before, entry, "");
    renderSharedView();
    return;
  }

  if (action === "show-history") {
    openHistoryModal(entry.id);
    return;
  }

  if (action === "delete-shared") {
    // Display name uses the perspective-flipped contactId so the prompt
    // matches what the user sees on screen.
    const displayContactId = entryAsMyPerspective(entry).contactId;
    if (!confirm(`Eliminar entrada "${entry.concept}" con ${getContactName(displayContactId)}?`)) {
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
  }
});

elements.sharedContactFilter.addEventListener("change", () => {
  state.sharedFilterContactId = elements.sharedContactFilter.value;
  // Keep the mobile picker in sync with the desktop filter so they
  // never drift even if the user resizes between viewports.
  elements.sharedMobileContactPicker.value = state.sharedFilterContactId;
  renderSharedBalances();
  renderSharedEntries();
});

// Mobile-only picker at the top of the Saldos panel: drives both the
// balance card visibility and the entries filter below. Same state
// field as the desktop dropdown.
elements.sharedMobileContactPicker.addEventListener("change", () => {
  state.sharedFilterContactId = elements.sharedMobileContactPicker.value;
  elements.sharedContactFilter.value = state.sharedFilterContactId;
  renderSharedBalances();
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
