import { state } from "../core/state.js";
import { elements } from "../core/dom.js";
import { saveContacts } from "../core/storage.js";
import { createId } from "../core/utils.js";
import { entryBalanceImpact, renderSharedView, syncSharedContactOptions, syncSharedModeLabels } from "./shared.js";

export function getContact(id) {
  return state.contacts.find((contact) => contact.id === id);
}

export function getContactName(id) {
  return getContact(id)?.name ?? "Contacto";
}

export function contactHasEntries(id) {
  return state.sharedEntries.some((entry) => entry.contactId === id);
}

export function getSharedBalance(contactId) {
  return state.sharedEntries
    .filter((entry) => entry.contactId === contactId)
    .reduce((balance, entry) => balance + entryBalanceImpact(entry), 0);
}

export function renderContacts() {
  elements.contactsCount.textContent = `${state.contacts.length} contactos`;
  elements.contactsList.innerHTML = "";

  if (!state.contacts.length) {
    elements.contactsList.innerHTML = '<p class="empty-state">Aun no hay contactos. Anade el primero arriba.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  state.contacts.forEach((contact) => {
    const item = document.createElement("article");
    const name = document.createElement("input");
    const email = document.createElement("input");
    const saveButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    item.className = "config-item";
    item.dataset.contactId = contact.id;
    name.value = contact.name;
    name.setAttribute("aria-label", "Nombre del contacto");
    name.dataset.field = "name";
    email.type = "email";
    email.value = contact.email ?? "";
    email.placeholder = "email (opcional)";
    email.setAttribute("aria-label", "Email del contacto");
    email.dataset.field = "email";
    saveButton.type = "button";
    saveButton.className = "save-action";
    saveButton.dataset.action = "save-contact";
    saveButton.title = "Guardar";
    saveButton.textContent = "OK";
    deleteButton.type = "button";
    deleteButton.className = "delete-action";
    deleteButton.dataset.action = "delete-contact";
    deleteButton.title = contactHasEntries(contact.id)
      ? "No se puede eliminar (tiene entradas)"
      : "Eliminar";
    deleteButton.textContent = "x";
    deleteButton.disabled = contactHasEntries(contact.id);

    item.append(name, email, saveButton, deleteButton);
    fragment.append(item);
  });

  elements.contactsList.append(fragment);
}

elements.contactsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = elements.newContactName.value.trim();
  const email = elements.newContactEmail.value.trim();

  if (!name) {
    return;
  }

  const existing = state.contacts.find((contact) => contact.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    elements.contactsForm.reset();
    return;
  }

  state.contacts = [
    ...state.contacts,
    { id: createId(), name, email, invitedAt: null, createdAt: new Date().toISOString() },
  ];
  saveContacts();
  elements.contactsForm.reset();
  renderContacts();
  renderSharedView();
});

elements.contactsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");

  if (!button) {
    return;
  }

  const item = button.closest("[data-contact-id]");
  const contact = state.contacts.find((candidate) => candidate.id === item.dataset.contactId);

  if (!contact) {
    return;
  }

  if (button.dataset.action === "save-contact") {
    const nextName = item.querySelector('input[data-field="name"]').value.trim();
    const nextEmail = item.querySelector('input[data-field="email"]').value.trim();
    const nameChanged = nextName && nextName !== contact.name;
    const emailChanged = nextEmail !== (contact.email ?? "");
    if (!nameChanged && !emailChanged) {
      return;
    }
    if (nameChanged) contact.name = nextName;
    if (emailChanged) contact.email = nextEmail;
    saveContacts();
    renderContacts();
    renderSharedView();
    syncSharedContactOptions();
    syncSharedModeLabels();
    return;
  }

  if (button.dataset.action === "delete-contact") {
    if (contactHasEntries(contact.id)) {
      alert(`No puedes borrar a ${contact.name}: tiene entradas en Compartidos.`);
      return;
    }
    if (!confirm(`Eliminar a ${contact.name}?`)) {
      return;
    }
    state.contacts = state.contacts.filter((candidate) => candidate.id !== contact.id);
    saveContacts();
    renderContacts();
    renderSharedView();
    syncSharedContactOptions();
  }
});
