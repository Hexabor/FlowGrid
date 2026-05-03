// Vista de grupos en Configuración → Grupos. Render de la lista, modal
// de edición (renombrar, gestionar miembros, ceder admin, salir, eliminar)
// y todo el wiring de eventos. Las primitivas viven en features/groups.js;
// esta capa es solo presentación.

import { state } from "../core/state.js";
import { elements, setContactsMode } from "../core/dom.js";
import { saveContacts } from "../core/storage.js";
import { createId } from "../core/utils.js";
import {
  getMyGroups,
  getGroupById,
  getGroupMembers,
  getMyMemberInGroup,
  resolveMemberView,
  createGroup,
  renameGroup,
  addMember,
  removeMember,
  transferGroupAdmin,
  leaveGroup,
  deleteGroup,
} from "./groups.js";
import { getUserIdSync } from "../core/supabase.js";
import { showConfirm } from "../ui/confirm.js";

let editingGroupId = null;

function memberCountLabel(n) {
  return `${n} miembro${n === 1 ? "" : "s"}`;
}

function isAdminOf(group) {
  const myUid = getUserIdSync();
  return !!myUid && group.ownerId === myUid;
}

// ---- list render -----------------------------------------------------

export function renderGroupsList() {
  const list = elements.groupsList;
  const empty = elements.groupsEmpty;
  const count = elements.groupsCount;
  if (!list) return;

  const groups = getMyGroups().slice().sort((a, b) =>
    a.name.localeCompare(b.name, "es", { sensitivity: "base" })
  );

  if (count) count.textContent = `${groups.length} grupo${groups.length === 1 ? "" : "s"}`;
  list.innerHTML = "";

  if (!groups.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    fragment.append(createGroupCard(group));
  }
  list.append(fragment);
}

function createGroupCard(group) {
  const card = document.createElement("article");
  card.className = "group-card";
  card.dataset.id = group.id;

  // Bloque izquierdo: nombre + cuenta de miembros en una sola línea
  // (apilados solo cuando el ancho los obligue a partirse).
  const info = document.createElement("div");
  info.className = "group-card-info";
  const name = document.createElement("strong");
  name.className = "group-card-name";
  name.textContent = group.name;
  const meta = document.createElement("span");
  meta.className = "group-card-meta";
  const members = getGroupMembers(group.id);
  meta.textContent = memberCountLabel(members.length);
  info.append(name, meta);

  // Bloque central: tag de rol — solo aparece si soy admin (los
  // miembros normales no necesitan ver "Miembro" como etiqueta;
  // la ausencia ya lo dice).
  const role = document.createElement("span");
  role.className = "group-card-role";
  if (isAdminOf(group)) {
    role.textContent = "Admin";
    role.classList.add("is-admin");
  } else {
    role.hidden = true;
  }

  // Bloque derecho: botón Gestionar.
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "ghost-action group-card-edit";
  editBtn.dataset.action = "edit";
  editBtn.textContent = "Gestionar";

  card.append(info, role, editBtn);
  return card;
}

// ---- modal render ----------------------------------------------------

function openGroupModal(groupId) {
  const group = getGroupById(groupId);
  if (!group) return;
  editingGroupId = groupId;

  elements.groupModalTitle.textContent = `Gestionar "${group.name}"`;
  elements.groupRenameInput.value = group.name;

  const admin = isAdminOf(group);
  elements.groupAdminBadge.textContent = admin ? "Eres admin" : "Eres miembro";
  elements.groupAdminBadge.classList.toggle("is-admin", admin);

  elements.groupRoleHint.textContent = admin
    ? "Como admin puedes añadir y quitar miembros, renombrar el grupo y eliminarlo. Cualquier miembro puede salir cuando quiera."
    : "Como miembro puedes ver el grupo y participar en sus gastos. Solo el admin gestiona la composición del grupo.";

  // Rename form: solo visible / activo para admin.
  elements.groupRenameForm.hidden = !admin;
  // Add-member forms (existente + nuevo) y el divider: solo admin.
  elements.groupAddMemberForm.hidden = !admin;
  if (elements.groupNewContactForm) elements.groupNewContactForm.hidden = !admin;
  const divider = elements.groupModal?.querySelector(".group-add-member-divider");
  if (divider) divider.hidden = !admin;

  // Botones de salir / eliminar.
  // - Salir: visible si soy miembro vinculado activo.
  // - Eliminar: visible solo si soy admin.
  const myMember = getMyMemberInGroup(groupId);
  elements.groupLeaveButton.hidden = !myMember;
  elements.groupDeleteButton.hidden = !admin;

  renderMembersList(group);
  renderAddMemberOptions(group);

  elements.groupModal.hidden = false;
}

export function closeGroupModal() {
  elements.groupModal.hidden = true;
  editingGroupId = null;
}

function renderMembersList(group) {
  const container = elements.groupMembersList;
  container.innerHTML = "";
  const members = getGroupMembers(group.id);
  if (!members.length) {
    container.innerHTML = '<p class="empty-state">Sin miembros activos.</p>';
    return;
  }

  const admin = isAdminOf(group);
  const myUid = getUserIdSync();
  const fragment = document.createDocumentFragment();

  for (const member of members) {
    const row = document.createElement("div");
    row.className = "group-member-row";
    row.dataset.id = member.id;

    const view = resolveMemberView(member);
    const left = document.createElement("div");
    left.className = "group-member-info";
    const label = document.createElement("strong");
    label.textContent = view.label;
    if (view.isMe) label.classList.add("is-me");
    left.append(label);
    if (member.email) {
      const small = document.createElement("small");
      small.textContent = member.email;
      left.append(small);
    }
    if (group.ownerId === member.authUserId) {
      const adminTag = document.createElement("span");
      adminTag.className = "group-member-tag";
      adminTag.textContent = "Admin";
      left.append(adminTag);
    } else if (!member.authUserId) {
      const offlineTag = document.createElement("span");
      offlineTag.className = "group-member-tag is-offline";
      offlineTag.textContent = "Offline";
      left.append(offlineTag);
    }

    row.append(left);

    const right = document.createElement("div");
    right.className = "group-member-actions";

    // Cesión de admin: solo admin actual, sobre miembros vinculados
    // distintos al admin actual.
    if (admin && member.authUserId && member.authUserId !== myUid) {
      const cedeBtn = document.createElement("button");
      cedeBtn.type = "button";
      cedeBtn.className = "ghost-action";
      cedeBtn.dataset.action = "cede-admin";
      cedeBtn.textContent = "Hacer admin";
      right.append(cedeBtn);
    }

    // Quitar miembro: solo admin, no sobre sí mismo (para eso se usa
    // "Salir del grupo", que cede admin antes si hace falta).
    if (admin && member.authUserId !== myUid) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "ghost-action";
      removeBtn.dataset.action = "remove-member";
      removeBtn.textContent = "Quitar";
      right.append(removeBtn);
    }

    row.append(right);
    fragment.append(row);
  }

  container.append(fragment);
}

function renderAddMemberOptions(group) {
  const select = elements.groupAddMemberSelect;
  if (!select) return;
  const current = new Set(
    getGroupMembers(group.id).map((m) => m.inviterContactId).filter(Boolean)
  );
  const candidates = state.contacts
    .filter((c) => !current.has(c.id))
    .sort((a, b) =>
      a.name.localeCompare(b.name, "es", { sensitivity: "base" })
    );

  select.innerHTML =
    '<option value="">Selecciona un contacto…</option>' +
    candidates
      .map((c) => `<option value="${c.id}">${c.name}${c.email ? ` (${c.email})` : ""}</option>`)
      .join("");
}

// ---- handlers --------------------------------------------------------

elements.groupCreateForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = (elements.newGroupName.value || "").trim();
  if (!name) return;
  createGroup({ name });
  elements.newGroupName.value = "";
  renderGroupsList();
});

elements.groupsList?.addEventListener("click", (event) => {
  const card = event.target.closest(".group-card");
  if (!card) return;
  const id = card.dataset.id;
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "edit") openGroupModal(id);
});

elements.closeGroupModal?.addEventListener("click", closeGroupModal);
elements.groupModal?.addEventListener("click", (event) => {
  if (event.target === elements.groupModal) closeGroupModal();
});

elements.groupRenameForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!editingGroupId) return;
  const newName = (elements.groupRenameInput.value || "").trim();
  if (!newName) return;
  renameGroup(editingGroupId, newName);
  // Re-abrir para refrescar el título y todo lo demás.
  renderGroupsList();
  openGroupModal(editingGroupId);
});

elements.groupAddMemberForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!editingGroupId) return;
  const contactId = elements.groupAddMemberSelect.value;
  if (!contactId) return;
  const contact = state.contacts.find((c) => c.id === contactId);
  if (!contact) return;
  addMember(editingGroupId, {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    authUserId: contact.authUserId,
  });
  renderGroupsList();
  openGroupModal(editingGroupId);
});

// Crear un contacto nuevo desde el modal del grupo y añadirlo de
// inmediato como miembro. Evita la fricción de salir a Configuración
// → Contactos, crearlo, volver. Si el nombre ya existe en mis
// contactos, reusa esa fila en vez de duplicar.
elements.groupNewContactForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!editingGroupId) return;
  const name = (elements.groupNewContactName.value || "").trim();
  if (!name) return;
  const email = (elements.groupNewContactEmail.value || "").trim();

  const existing = state.contacts.find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
  let contact;
  if (existing) {
    contact = existing;
    // Si el contacto existía sin email y ahora le ponemos uno, lo
    // actualizamos en el mismo gesto.
    if (email && !existing.email) {
      existing.email = email;
      saveContacts();
    }
  } else {
    contact = {
      id: createId(),
      name,
      email,
      invitedAt: null,
      authUserId: null,
      ownerEmail: null,
      createdAt: new Date().toISOString(),
    };
    state.contacts = [...state.contacts, contact];
    saveContacts();
  }

  addMember(editingGroupId, {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    authUserId: contact.authUserId,
  });

  // Reset el form para que la próxima creación arranque limpia. Como
  // el form ya no está dentro de un <details>, no hace falta colapsar
  // nada — solo limpiar inputs.
  elements.groupNewContactForm.reset();

  renderGroupsList();
  openGroupModal(editingGroupId);
});

// Toggle Contactos/Grupos dentro del tab "Contactos y grupos".
elements.contactsModeButtons?.forEach((button) => {
  button.addEventListener("click", () => {
    setContactsMode(button.dataset.contactsMode);
  });
});

elements.groupMembersList?.addEventListener("click", (event) => {
  const row = event.target.closest(".group-member-row");
  if (!row) return;
  const memberId = row.dataset.id;
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action || !editingGroupId) return;

  if (action === "remove-member") {
    const member = state.groupMembers.find((m) => m.id === memberId);
    if (!member) return;
    const view = resolveMemberView(member);
    showConfirm({
      title: "Quitar miembro del grupo",
      message: `Vas a quitar a "${view.label}" del grupo. Su saldo pendiente con cada uno de los demás miembros se mantiene; el histórico no se modifica.`,
      extra: "Si más adelante lo vuelves a añadir, se reactiva la misma fila.",
      actions: [
        { label: "Cancelar", kind: "secondary", onClick: () => {} },
        {
          label: "Quitar miembro",
          kind: "danger",
          requireDoubleConfirm: true,
          onClick: () => {
            removeMember(editingGroupId, memberId);
            renderGroupsList();
            openGroupModal(editingGroupId);
          },
        },
      ],
    });
    return;
  }

  if (action === "cede-admin") {
    const member = state.groupMembers.find((m) => m.id === memberId);
    if (!member?.authUserId) return;
    const view = resolveMemberView(member);
    showConfirm({
      title: "Ceder rol de admin",
      message: `"${view.label}" pasará a ser el admin del grupo. Tú dejarás de poder añadir o quitar miembros, pero seguirás siendo miembro y participando en los gastos.`,
      actions: [
        { label: "Cancelar", kind: "secondary", onClick: () => {} },
        {
          label: "Ceder admin",
          kind: "primary",
          onClick: () => {
            transferGroupAdmin(editingGroupId, member.authUserId);
            renderGroupsList();
            openGroupModal(editingGroupId);
          },
        },
      ],
    });
    return;
  }
});

elements.groupLeaveButton?.addEventListener("click", () => {
  if (!editingGroupId) return;
  const group = getGroupById(editingGroupId);
  if (!group) return;
  const willTransfer = isAdminOf(group);
  const message = willTransfer
    ? "Eres el admin de este grupo. Si te vas, el rol pasa al miembro vinculado más antiguo. Tu saldo pendiente con los demás se mantiene; los gastos pasados no se modifican."
    : "Vas a salir del grupo. Tu saldo pendiente con cada miembro se mantiene; los gastos pasados no se modifican. Si te vuelven a añadir más adelante, vuelves a entrar.";
  showConfirm({
    title: "Salir del grupo",
    message,
    actions: [
      { label: "Cancelar", kind: "secondary", onClick: () => {} },
      {
        label: "Salir del grupo",
        kind: "danger",
        requireDoubleConfirm: true,
        onClick: () => {
          try {
            leaveGroup(editingGroupId);
            closeGroupModal();
            renderGroupsList();
          } catch (err) {
            alert(err.message);
          }
        },
      },
    ],
  });
});

elements.groupDeleteButton?.addEventListener("click", () => {
  if (!editingGroupId) return;
  const group = getGroupById(editingGroupId);
  if (!group) return;
  const entryCount = state.sharedEntries.filter((e) => e.groupId === group.id).length;
  showConfirm({
    title: "Eliminar grupo",
    message: `Vas a eliminar el grupo "${group.name}". ${
      entryCount === 0
        ? "El grupo no tiene gastos registrados."
        : `Se borrarán también las ${entryCount} entrada${entryCount === 1 ? "" : "s"} de gastos compartidos del grupo.`
    }`,
    extra: "Esta acción no se puede deshacer (todavía no tenemos papelera).",
    actions: [
      { label: "Cancelar", kind: "secondary", onClick: () => {} },
      {
        label: "Eliminar grupo",
        kind: "danger",
        requireDoubleConfirm: true,
        onClick: () => {
          deleteGroup(editingGroupId);
          closeGroupModal();
          renderGroupsList();
        },
      },
    ],
  });
});
