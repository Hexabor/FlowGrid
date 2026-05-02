import { state } from "../core/state.js";
import { elements } from "../core/dom.js";
import { saveContacts } from "../core/storage.js";
import { createId } from "../core/utils.js";
import { entryBalanceImpact, entryAsMyPerspective, renderSharedView, syncSharedContactOptions, syncSharedModeLabels } from "./shared.js";
import { sendInvitation } from "./invitations.js";

export function getContact(id) {
  return state.contacts.find((contact) => contact.id === id);
}

export function getContactName(id) {
  return getContact(id)?.name ?? "Contacto";
}

export function contactHasEntries(id) {
  // Flip to my perspective so partner-owned entries (which live under the
  // inviter's contact_id in the cloud row) get attributed to my reciprocal
  // contact for that inviter — that's the contact the user sees in their
  // own list, and it's what callers ask about.
  return state.sharedEntries.some(
    (entry) => entryAsMyPerspective(entry).contactId === id
  );
}

export function getSharedBalance(contactId) {
  return state.sharedEntries
    .map(entryAsMyPerspective)
    .filter((entry) => entry.contactId === contactId)
    // Settled entries are excluded from the live balance: that's the whole
    // point of marking one as liquidado. They still show in the entries
    // list with a visual cue, just don't contribute to the running total.
    .filter((entry) => !entry.settledAt)
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
    const inviteButton = document.createElement("button");
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

    // Invite slot: shows nothing for contacts without email; "Vinculado"
    // (read-only) once the contact has accepted; "Invitar" or "Reinvitar"
    // otherwise. The flow itself (sendInvitation) is in invitations.js.
    inviteButton.type = "button";
    inviteButton.dataset.action = "invite-contact";
    inviteButton.className = "ghost-action contact-invite-button";
    if (contact.authUserId) {
      inviteButton.textContent = "Vinculado";
      inviteButton.disabled = true;
      inviteButton.title = "El contacto ya aceptó la invitación";
      inviteButton.classList.add("is-linked");
    } else if (!contact.email) {
      inviteButton.textContent = "Invitar";
      inviteButton.disabled = true;
      inviteButton.title = "Necesitas el email del contacto para poder invitarlo";
    } else if (contact.invitedAt) {
      inviteButton.textContent = "Reinvitar";
      inviteButton.title = `Última invitación: ${new Date(contact.invitedAt).toLocaleDateString("es-ES")}`;
    } else {
      inviteButton.textContent = "Invitar";
      inviteButton.title = "Enviar invitación por email";
    }

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

    item.append(name, email, inviteButton, saveButton, deleteButton);
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
    return;
  }

  if (button.dataset.action === "invite-contact") {
    if (!contact.email) {
      alert(`Añade primero un email a ${contact.name} para poder invitarle.`);
      return;
    }
    if (contact.authUserId) {
      // Defensive: button should be disabled when linked, but never trust UI.
      return;
    }
    button.disabled = true;
    const previousText = button.textContent;
    button.textContent = "Enviando…";
    sendInvitation(contact)
      .then(() => {
        // sendInvitation re-renders contacts, so we don't restore manually.
      })
      .catch((error) => {
        console.error("[contacts] invite failed:", error);
        alert(`No se pudo enviar la invitación: ${error.message ?? error}`);
        button.textContent = previousText;
        button.disabled = false;
      });
  }
});
