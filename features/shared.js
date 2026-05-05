import { state } from "../core/state.js";
import { elements, openMovementModal } from "../core/dom.js";
import { saveMovements, saveSharedEntries, saveContacts } from "../core/storage.js";
import { SHARED_MODES } from "../core/constants.js";
import { createId, formatDate, formatMoney, formatMonthLabel } from "../core/utils.js";
import { getContact, getContactName, getSharedBalance, contactHasEntries, renderContacts } from "./contacts.js";
import { renderMovements, syncMovementSelects, fillMovementForm } from "./movements.js";
import { setMovementDate, setPaymentDate } from "../ui/datepicker.js";
import { getUserIdSync } from "../core/supabase.js";
import { openHistoryModal, recordSharedEntryEdit } from "./edit-log.js";
import {
  getMyGroups,
  getGroupById,
  getGroupMembers,
  getMyMemberInGroup,
  resolveMemberView,
  buildSplits,
  findGroupMemberForContact,
  memberSettledAt,
} from "./groups.js";

// Filtro de la lista de movimientos compartidos. Histórico: el state
// guardaba un id de contacto pelado o "all". Ahora aceptamos también
// prefijos "contact:<id>" y "group:<id>". Los ids antiguos sin prefijo
// se siguen interpretando como contactos para no romper compat.
function parseSharedFilter(value) {
  if (!value || value === "all") return { kind: "all", id: null };
  if (value.startsWith("group:")) return { kind: "group", id: value.slice(6) };
  if (value.startsWith("contact:")) return { kind: "contact", id: value.slice(8) };
  return { kind: "contact", id: value };
}

// Helper para parsear el value del select #shared-contact, que ahora
// mezcla contactos y grupos con prefijos "contact:" / "group:".
// Backward-compat con valores legacy (sin prefijo) los trata como
// contactos por id directo.
export function parseSharedTarget(value) {
  if (!value) return { kind: "none", id: null };
  if (value.startsWith("group:")) return { kind: "group", id: value.slice(6) };
  if (value.startsWith("contact:")) return { kind: "contact", id: value.slice(8) };
  return { kind: "contact", id: value };
}

export function formatSharedTarget(kind, id) {
  if (!id) return "";
  return `${kind}:${id}`;
}

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
  // Entradas de grupo no necesitan el flip: los splits ya identifican
  // a cada miembro por id, y el cálculo pairwise vive en groups.js.
  // Devolverlas tal cual.
  if (entry.groupId) {
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
  // Group entries: usar el modelo de splits. Si soy pagador (mi paid >
  // 0), los demás me deben sus owes — sumo solo los splits NO
  // liquidados individualmente. Si soy participante no-pagador, debo
  // mi propia parte salvo que esté ya liquidada.
  if (entry.groupId && entry.splits) {
    const myMember = getMyMemberInGroup(entry.groupId);
    if (!myMember) return 0;
    const mySplit = entry.splits[myMember.id];
    if (!mySplit) return 0;
    const myPaid = Number(mySplit.paid) || 0;
    const myOwes = Number(mySplit.owes) || 0;
    const settled = entry.settledMembers || {};
    if (myPaid > 0) {
      let owedToMe = 0;
      for (const [memberId, split] of Object.entries(entry.splits)) {
        if (memberId === myMember.id) continue;
        if (settled[memberId]) continue;
        owedToMe += Number(split.owes) || 0;
      }
      return Math.round(owedToMe * 100) / 100;
    }
    if (settled[myMember.id]) return 0;
    return -myOwes;
  }
  if (entry.type === "expense") {
    return entry.paidBy === "me" ? entry.theirShare : -entry.myShare;
  }
  return entry.paidBy === "me" ? entry.total : -entry.total;
}

export function entryDescription(entry) {
  // Entrada de grupo: el "con quién" es el grupo y el pagador es uno
  // de sus miembros. Resolvemos vía getGroupById + splits.
  if (entry.groupId) {
    const group = getGroupById(entry.groupId);
    const groupName = group?.name ?? "Grupo";
    if (entry.type === "payment") return `Pago en ${groupName}`;
    const myMember = getMyMemberInGroup(entry.groupId);
    const myUid = getUserIdSync();
    let payerLabel = "";
    if (entry.splits) {
      const payerEntry = Object.entries(entry.splits).find(
        ([, val]) => Number(val.paid) > 0
      );
      if (payerEntry) {
        const payerMember = getGroupMembers(entry.groupId, { includeInactive: true })
          .find((m) => m.id === payerEntry[0]);
        if (payerMember) {
          const view = resolveMemberView(payerMember);
          payerLabel = view.isMe ? "Pagaste tú" : `Pagó ${view.label}`;
        }
      }
    }
    return `${entry.concept} — Grupo ${groupName}${payerLabel ? ` · ${payerLabel}` : ""}`;
  }

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
  // Si la entrada pertenece a un grupo, el "con quién" es el nombre del
  // grupo, no un contacto individual.
  if (entry.groupId) {
    const group = getGroupById(entry.groupId);
    return group ? `Grupo: ${group.name}` : "Grupo";
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
  syncSharedTargetKind();
  syncSharedModeLabels();
  syncSharedUnevenVisibility();
  syncSharedTotalHint();
}

export function syncSharedContactOptions() {
  const selected = elements.sharedContact.value;
  const contacts = state.contacts.slice().sort((a, b) =>
    a.name.localeCompare(b.name, "es", { sensitivity: "base" })
  );
  // Usamos state.groups directamente: la RLS ya filtra al hidratar a
  // los grupos visibles para el usuario (owner o miembro activo).
  // getMyGroups() añadía un filtro local extra basado en
  // groupMembers.authUserId que en algunos dispositivos puede ir
  // desfasado tras un refresh — usar state.groups es más robusto.
  const groups = state.groups.slice().sort((a, b) =>
    a.name.localeCompare(b.name, "es", { sensitivity: "base" })
  );

  let html = "";
  if (!contacts.length && !groups.length) {
    html = '<option value="">Sin contactos ni grupos creados</option>';
  } else {
    if (contacts.length) {
      html += '<optgroup label="Contactos">';
      html += contacts.map((c) => `<option value="contact:${c.id}">${c.name}</option>`).join("");
      html += "</optgroup>";
    }
    if (groups.length) {
      html += '<optgroup label="Grupos">';
      html += groups
        .map((g) => `<option value="group:${g.id}">${g.name}</option>`)
        .join("");
      html += "</optgroup>";
    }
  }
  elements.sharedContact.innerHTML = html;

  // Restaurar la selección previa si sigue siendo válida.
  if (selected) {
    const stillValid = elements.sharedContact.querySelector(`option[value="${CSS.escape(selected)}"]`);
    if (stillValid) elements.sharedContact.value = selected;
  }
}

// Visibilidad del bloque "compartir con un grupo" vs el de "1↔1 con
// contacto", según el prefijo del value en #shared-contact. Llamado
// cada vez que cambia la selección, el modo, o se abre el modal.
export function syncSharedTargetKind() {
  const target = parseSharedTarget(elements.sharedContact.value);

  // Marca el form para que el CSS pueda esconder/mostrar bloques
  // según el atributo. También directamente toggleamos los hidden
  // por si en algún navegador el selector CSS por atributo falla.
  if (elements.sharedFields) {
    elements.sharedFields.dataset.targetKind = target.kind;
  }

  const isGroup = target.kind === "group";
  // Bloque 1↔1
  if (elements.sharedMode?.parentElement) {
    elements.sharedMode.parentElement.hidden = isGroup;
  }
  if (elements.sharedUneven) {
    if (isGroup) {
      elements.sharedUneven.hidden = true;
    } else {
      // Su visibilidad la determina syncSharedUnevenVisibility según el modo.
    }
  }
  // Bloque grupo
  if (elements.sharedGroupFields) {
    elements.sharedGroupFields.hidden = !isGroup;
  }

  if (isGroup) {
    syncSharedGroupFields(target.id);
  }
}

// Repuebla el selector de pagador y el grid de partes por miembro
// cuando se elige (o cambia) un grupo. Defaults: pagador "yo" si soy
// miembro vinculado, modo iguales.
export function syncSharedGroupFields(groupId) {
  if (!elements.sharedGroupPayer) return;
  const group = getGroupById(groupId);
  if (!group) return;
  const members = getGroupMembers(groupId);
  if (!members.length) {
    elements.sharedGroupPayer.innerHTML = '<option value="">Grupo sin miembros</option>';
    if (elements.sharedGroupShares) elements.sharedGroupShares.innerHTML = "";
    return;
  }

  // Selector de pagador: cada miembro activo. Default = yo si soy
  // miembro vinculado del grupo; si no, el primero.
  const myMember = getMyMemberInGroup(groupId);
  const previous = elements.sharedGroupPayer.value;
  elements.sharedGroupPayer.innerHTML = members
    .map((m) => {
      const view = resolveMemberView(m);
      const label = view.isMe ? "Yo" : view.label;
      return `<option value="${m.id}">${label}</option>`;
    })
    .join("");
  // Restore previous payer if still valid
  if (previous && members.some((m) => m.id === previous)) {
    elements.sharedGroupPayer.value = previous;
  } else if (myMember) {
    elements.sharedGroupPayer.value = myMember.id;
  }

  syncSharedGroupSharesGrid(groupId);
  syncSharedGroupTotalHint();
}

// Pinta o esconde la rejilla de partes desiguales según el modo del
// grupo. Si el modo es "uneven", crea un input numérico por cada
// miembro activo del grupo. Si es "equal", oculta la rejilla y el
// motor reparte automáticamente al guardar.
export function syncSharedGroupSharesGrid(groupId) {
  if (!elements.sharedGroupShares || !elements.sharedGroupMode) return;
  const isUneven = elements.sharedGroupMode.value === "uneven";
  if (!isUneven) {
    elements.sharedGroupShares.hidden = true;
    elements.sharedGroupShares.innerHTML = "";
    return;
  }
  const members = getGroupMembers(groupId);
  elements.sharedGroupShares.hidden = false;
  elements.sharedGroupShares.innerHTML = members
    .map((m) => {
      const view = resolveMemberView(m);
      const label = view.isMe ? "Yo" : view.label;
      return `
        <label class="shared-group-share">
          <span>${label}</span>
          <input type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00" data-member-id="${m.id}" data-share-input>
        </label>
      `;
    })
    .join("");
}

// Feedback en vivo de cuánto suman las partes vs el total del gasto.
// Solo aplica en modo desigual.
export function syncSharedGroupTotalHint() {
  if (!elements.sharedGroupFeedback) return;
  if (elements.sharedGroupMode?.value !== "uneven") {
    elements.sharedGroupFeedback.textContent = "";
    return;
  }
  const total = Number(elements.amount?.value) || 0;
  const inputs = elements.sharedGroupShares?.querySelectorAll("[data-share-input]") ?? [];
  let sum = 0;
  inputs.forEach((inp) => { sum += Number(inp.value) || 0; });
  sum = Math.round(sum * 100) / 100;
  const diff = Math.round((total - sum) * 100) / 100;
  if (!total) {
    elements.sharedGroupFeedback.textContent = "Introduce primero el importe total.";
    elements.sharedGroupFeedback.dataset.state = "warn";
  } else if (Math.abs(diff) < 0.005) {
    elements.sharedGroupFeedback.textContent = `Total ${formatMoney(total)} — coincide.`;
    elements.sharedGroupFeedback.dataset.state = "ok";
  } else if (diff > 0) {
    elements.sharedGroupFeedback.textContent = `Total ${formatMoney(total)} — faltan ${formatMoney(diff)}.`;
    elements.sharedGroupFeedback.dataset.state = "warn";
  } else {
    elements.sharedGroupFeedback.textContent = `Total ${formatMoney(total)} — sobran ${formatMoney(-diff)}.`;
    elements.sharedGroupFeedback.dataset.state = "warn";
  }
}

// Recoge los inputs del grid de partes desiguales y devuelve un mapa
// member_id → cantidad. Cero para miembros sin valor introducido.
export function readSharedGroupShares() {
  const out = {};
  const inputs = elements.sharedGroupShares?.querySelectorAll("[data-share-input]") ?? [];
  inputs.forEach((inp) => {
    out[inp.dataset.memberId] = Number(inp.value) || 0;
  });
  return out;
}

export function syncSharedModeLabels() {
  const target = parseSharedTarget(elements.sharedContact.value);
  // Solo etiquetamos los modos cuando el target es un contacto 1↔1.
  // Para grupos, los modos del select están ocultos y no se usan.
  const name = target.kind === "contact" && target.id
    ? (getContactName(target.id) || "Contacto")
    : "Contacto";
  Object.entries(SHARED_MODES).forEach(([key, mode]) => {
    const option = elements.sharedMode.querySelector(`option[value="${key}"]`);
    if (option) {
      option.textContent = mode.label.replace("{name}", name);
    }
  });
}

export function syncSharedUnevenVisibility() {
  // Solo aplica al caso 1↔1; en grupos este bloque está oculto.
  const target = parseSharedTarget(elements.sharedContact.value);
  if (target.kind !== "contact") {
    elements.sharedUneven.hidden = true;
    elements.sharedMyShare.required = false;
    elements.sharedTheirShare.required = false;
    return;
  }
  const mode = SHARED_MODES[elements.sharedMode.value];
  const isUneven = mode?.split === "uneven";
  elements.sharedUneven.hidden = !isUneven;
  elements.sharedMyShare.required = isUneven;
  elements.sharedTheirShare.required = isUneven;
  const otherName = target.id ? (getContactName(target.id) || "el otro contacto") : "el otro contacto";
  elements.sharedTheirShareLabel.textContent = `Parte de ${otherName}`;
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

  if (entry.groupId) {
    // Entrada de grupo: pre-seleccionar grupo + pagador + modo + partes.
    elements.sharedContact.value = `group:${entry.groupId}`;
    syncSharedTargetKind();
    if (elements.sharedGroupMode) {
      elements.sharedGroupMode.value = entry.splitMode === "uneven" ? "uneven" : "equal";
    }
    syncSharedGroupSharesGrid(entry.groupId);
    // Determinar el pagador por la estructura splits: el miembro con paid > 0.
    if (entry.splits && elements.sharedGroupPayer) {
      const payerEntry = Object.entries(entry.splits).find(
        ([, val]) => Number(val.paid) > 0
      );
      if (payerEntry) elements.sharedGroupPayer.value = payerEntry[0];
    }
    if (entry.splitMode === "uneven" && entry.splits) {
      const inputs = elements.sharedGroupShares?.querySelectorAll("[data-share-input]") ?? [];
      inputs.forEach((inp) => {
        const id = inp.dataset.memberId;
        inp.value = Number(entry.splits[id]?.owes) || 0;
      });
    }
    syncSharedGroupTotalHint();
    return;
  }

  // Entrada legacy 1↔1.
  elements.sharedContact.value = `contact:${entry.contactId}`;
  syncSharedTargetKind();
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
    // "Convertir en plantilla periódica": hacemos visible el botón
    // cuando estamos editando un shared_entry mío sin movement
    // asociado (típico en modo `me-full` / `them-full`, donde no hay
    // movement personal y por tanto el flujo habitual del modal de
    // movimiento no aplica). Solo para el owner — un partner no puede
    // crear plantillas en mi cuenta.
    if (elements.convertToRecurring) {
      elements.convertToRecurring.hidden = isPartnerEntry;
    }
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

function renderMobileBalanceSummary(contactsWithActivity) {
  elements.sharedBalances.innerHTML = "";
  if (!contactsWithActivity.length) return;

  const wrapper = document.createElement("div");
  wrapper.className = "balance-summary";

  // Cabecera: título a la izquierda + leyenda en chip a la derecha.
  // La leyenda explica los puntos verde/rojo de cada card sin tener
  // que repetir "TE DEBE / LE DEBES" en cada fila.
  const header = document.createElement("div");
  header.className = "balance-summary-header";

  const title = document.createElement("p");
  title.className = "balance-summary-title";
  title.textContent = "Toca un contacto para ver detalle y liquidar:";

  const legend = document.createElement("p");
  legend.className = "balance-summary-legend";
  legend.innerHTML =
    '<span class="balance-summary-legend-item">' +
      '<span class="balance-summary-legend-dot is-positive"></span> te debe' +
    '</span>' +
    '<span class="balance-summary-legend-item">' +
      '<span class="balance-summary-legend-dot is-negative"></span> le debes' +
    '</span>';

  header.append(legend, title);
  wrapper.append(header);

  const list = document.createElement("ul");
  list.className = "balance-summary-list";

  contactsWithActivity
    .map((contact) => ({ contact, balance: getSharedBalance(contact.id) }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    .forEach(({ contact, balance }) => {
      const row = document.createElement("li");
      row.className = "balance-summary-row";
      row.dataset.contactId = contact.id;
      if (balance > 0.005) row.classList.add("is-positive");
      else if (balance < -0.005) row.classList.add("is-negative");
      else row.classList.add("is-zero");

      const name = document.createElement("strong");
      name.className = "balance-summary-name";
      name.textContent = contact.name;

      const direction = document.createElement("span");
      direction.className = "balance-summary-direction";
      if (Math.abs(balance) < 0.005) direction.textContent = "Saldado";
      else if (balance > 0) direction.textContent = "te debe";
      else direction.textContent = "le debes";

      const amount = document.createElement("span");
      amount.className = "balance-summary-amount";
      amount.textContent = formatMoney(Math.abs(balance));

      row.append(name, direction, amount);
      list.append(row);
    });

  wrapper.append(list);
  elements.sharedBalances.append(wrapper);
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
  const filter = parseSharedFilter(state.sharedFilterContactId);
  let toRender = contactsWithActivity;

  if (onMobile) {
    if (filter.kind === "all") {
      // Resumen tappable: un listado plano de todos los contactos con
      // saldo actual. Clicar uno equivale a seleccionarlo en el
      // dropdown — abre la card detallada y filtra los movimientos.
      renderMobileBalanceSummary(contactsWithActivity);
      return;
    }
    if (filter.kind === "group") {
      // Estamos filtrando por un grupo: el panel de Saldos por contacto
      // no aplica — el saldo del grupo se ve en el panel "Mis grupos"
      // de abajo. Limpiamos para no mostrar info redundante o errónea.
      elements.sharedBalances.innerHTML = "";
      return;
    }
    toRender = contactsWithActivity.filter((c) => c.id === filter.id);
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
  const contacts = state.contacts.slice().sort((a, b) =>
    a.name.localeCompare(b.name, "es", { sensitivity: "base" })
  );
  const groups = state.groups.slice().sort((a, b) =>
    a.name.localeCompare(b.name, "es", { sensitivity: "base" })
  );

  let optionsMarkup = '<option value="all">Todos</option>';
  if (contacts.length) {
    optionsMarkup += '<optgroup label="Contactos">';
    optionsMarkup += contacts
      .map((c) => `<option value="contact:${c.id}">${c.name}</option>`)
      .join("");
    optionsMarkup += "</optgroup>";
  }
  if (groups.length) {
    optionsMarkup += '<optgroup label="Grupos">';
    optionsMarkup += groups
      .map((g) => `<option value="group:${g.id}">${g.name}</option>`)
      .join("");
    optionsMarkup += "</optgroup>";
  }

  elements.sharedContactFilter.innerHTML = optionsMarkup;
  elements.sharedMobileContactPicker.innerHTML = optionsMarkup;

  // Validar el filtro actual contra las opciones disponibles. Si el
  // valor anterior era un id pelado (legacy), lo normalizamos a
  // "contact:<id>" si aún existe; si ya no existe, caemos a "all".
  let normalised = selected;
  if (selected && selected !== "all" && !selected.startsWith("contact:") && !selected.startsWith("group:")) {
    normalised = `contact:${selected}`;
  }
  const parsed = parseSharedFilter(normalised);
  let validSelected = "all";
  if (parsed.kind === "contact" && contacts.some((c) => c.id === parsed.id)) {
    validSelected = `contact:${parsed.id}`;
  } else if (parsed.kind === "group" && groups.some((g) => g.id === parsed.id)) {
    validSelected = `group:${parsed.id}`;
  }
  elements.sharedContactFilter.value = validSelected;
  elements.sharedMobileContactPicker.value = validSelected;
  state.sharedFilterContactId = validSelected;
  syncMobileBackToAllVisibility();
}

// Controles del filtro móvil del panel Saldos. Dos estados:
//   - vista "Todos": no se ve nada (ni dropdown ni back-button); las
//     cards del resumen son la nav.
//   - vista contacto/grupo: solo se ve el botón "Volver a Todos";
//     el dropdown se mantiene oculto porque para cambiar de detalle
//     basta con volver y pinchar otra card.
function syncMobileBackToAllVisibility() {
  if (!elements.sharedMobileBackToAll) return;
  const isAll = !state.sharedFilterContactId || state.sharedFilterContactId === "all";
  // Picker label oculto siempre en móvil — nunca aporta vs. tocar la card.
  if (elements.sharedMobilePickerLabel) {
    elements.sharedMobilePickerLabel.hidden = true;
  }
  // Row entera oculta cuando estamos en Todos (para no dejar margen
  // vertical de un contenedor sin contenido).
  if (elements.sharedMobilePickerRow) {
    elements.sharedMobilePickerRow.hidden = isAll;
  }
  elements.sharedMobileBackToAll.hidden = isAll;
}

function renderSharedEntries() {
  const filter = parseSharedFilter(state.sharedFilterContactId);
  // Focus contact: cuando filtramos por un contacto, las group entries
  // se renderizan con la perspectiva pairwise yo↔ese contacto (no la
  // agregada). buildSharedEntryRow lo recibe como argumento.
  const focusContact = filter.kind === "contact" ? getContact(filter.id) : null;

  // Flip every entry to my perspective up front so the contactId filter
  // and the row builder both see entries as "from my point of view".
  // The original raw entries stay in state.sharedEntries untouched.
  let entries = state.sharedEntries.map(entryAsMyPerspective);

  if (filter.kind === "contact") {
    // Un contacto puede tener actividad por dos vías: entradas 1↔1
    // (entry.contactId === él) o entradas de grupo donde ese contacto
    // es miembro. Incluimos ambas para que el filtro refleje TODO lo
    // que ese contacto te debe (y ya está agregado en su saldo).
    const contact = getContact(filter.id);
    entries = entries.filter((entry) => {
      if (entry.contactId === filter.id) return true;
      if (entry.groupId && contact) {
        const member = findGroupMemberForContact(entry.groupId, contact);
        if (!member) return false;
        const split = entry.splits?.[member.id];
        return Boolean(split) && (Number(split.paid) > 0 || Number(split.owes) > 0);
      }
      return false;
    });
  } else if (filter.kind === "group") {
    entries = entries.filter((entry) => entry.groupId === filter.id);
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
    fragment.append(buildSharedEntryRow(entry, focusContact));
  });

  elements.sharedEntries.append(fragment);
}

function buildSharedEntryRow(entry, focusContact = null) {
  const myUid = getUserIdSync();
  const isMine = !entry.ownerId || entry.ownerId === myUid;
  const isSettled = Boolean(entry.settledAt);

  // Cuando filtramos por contacto y la entry es de grupo, ajustamos la
  // fila a la perspectiva pairwise yo↔ese contacto: el desglose pasa a
  // mostrar solo su parte y la cifra de la derecha es lo que ese
  // contacto te debe (o tú a él) en este gasto concreto. El botón
  // "Marcar liquidado" pasa a liquidar la parte de ese contacto en
  // settledMembers, no la entrada entera.
  let pairwise = null;
  if (focusContact && entry.groupId && entry.splits) {
    const myMember = getMyMemberInGroup(entry.groupId);
    const otherMember = findGroupMemberForContact(entry.groupId, focusContact);
    if (myMember && otherMember && myMember.id !== otherMember.id) {
      const mySplit = entry.splits[myMember.id] || { paid: 0, owes: 0 };
      const otherSplit = entry.splits[otherMember.id] || { paid: 0, owes: 0 };
      const myPaid = Number(mySplit.paid) || 0;
      const myOwes = Number(mySplit.owes) || 0;
      const otherPaid = Number(otherSplit.paid) || 0;
      const otherOwes = Number(otherSplit.owes) || 0;
      let direction = "none"; // 'theyOwe' | 'iOwe' | 'none'
      let pairAmount = 0;
      let debtorMemberId = null;
      let settledTimestamp = null;
      if (myPaid > 0 && otherOwes > 0) {
        direction = "theyOwe";
        pairAmount = otherOwes;
        debtorMemberId = otherMember.id;
      } else if (otherPaid > 0 && myOwes > 0) {
        direction = "iOwe";
        pairAmount = myOwes;
        debtorMemberId = myMember.id;
      }
      if (debtorMemberId) {
        settledTimestamp = memberSettledAt(entry, debtorMemberId);
      }
      pairwise = {
        myMember,
        otherMember,
        myPaid,
        myOwes,
        otherPaid,
        otherOwes,
        direction,
        pairAmount,
        debtorMemberId,
        settledTimestamp,
        otherName: focusContact.name,
      };
    }
  }

  const isPairSettled = Boolean(pairwise?.settledTimestamp);
  const showAsSettled = isSettled || isPairSettled;

  const row = document.createElement("article");
  row.className = "shared-entry";
  row.dataset.id = entry.id;
  row.dataset.type = entry.type;
  if (showAsSettled) row.classList.add("is-settled");
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
    if (entry.groupId && entry.splits) {
      const myMember = getMyMemberInGroup(entry.groupId);
      const myOwes = myMember ? (Number(entry.splits[myMember.id]?.owes) || 0) : 0;
      if (pairwise) {
        // Perspectiva pairwise: tu parte + parte del contacto + resto.
        const otherOwes = pairwise.otherOwes;
        const rest = Math.max(
          0,
          Math.round((Number(entry.total) - myOwes - otherOwes) * 100) / 100
        );
        breakdown.textContent =
          `Total ${formatMoney(entry.total)} — tu parte ${formatMoney(myOwes)}` +
          ` · ${pairwise.otherName} ${formatMoney(otherOwes)}` +
          (rest > 0 ? ` · resto del grupo ${formatMoney(rest)}` : "");
      } else {
        const others = Math.max(0, Math.round((Number(entry.total) - myOwes) * 100) / 100);
        breakdown.textContent = `Total ${formatMoney(entry.total)} — tu parte ${formatMoney(myOwes)} · resto del grupo ${formatMoney(others)}`;
      }
    } else {
      const contactName = getContactName(entry.contactId);
      breakdown.textContent = `Total ${formatMoney(entry.total)} — tu ${formatMoney(entry.myShare)} · ${contactName} ${formatMoney(entry.theirShare)}`;
    }
    main.append(breakdown);
  }

  if (isSettled) {
    const settledTag = document.createElement("span");
    settledTag.className = "shared-entry-settled-tag";
    settledTag.textContent = `Liquidado el ${formatDate(entry.settledAt.slice(0, 10))}`;
    main.append(settledTag);
  } else if (isPairSettled) {
    const settledTag = document.createElement("span");
    settledTag.className = "shared-entry-settled-tag";
    settledTag.textContent =
      `Parte de ${pairwise.otherName} liquidada el ` +
      `${formatDate(pairwise.settledTimestamp.slice(0, 10))}`;
    main.append(settledTag);
  }

  // Cifra a la derecha. Sin foco: el impact agregado de la entry. Con
  // foco: solo la parte yo↔contacto (positiva si me debe, negativa si
  // le debo, 0 si liquidada o sin deuda directa).
  let impact;
  if (pairwise) {
    if (isPairSettled || pairwise.direction === "none") {
      impact = 0;
    } else if (pairwise.direction === "theyOwe") {
      impact = pairwise.pairAmount;
    } else {
      impact = -pairwise.pairAmount;
    }
  } else {
    impact = entryBalanceImpact(entry);
  }
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

  // Per-entry liquidate toggle. Sin foco pairwise: liquida la entrada
  // entera (settledAt). Con foco pairwise en una group entry con deuda
  // entre nosotros: liquida solo la parte de ese par (settledMembers).
  // Tipo "payment" no se liquida.
  if (entry.type === "expense") {
    if (pairwise && pairwise.debtorMemberId) {
      const settleButton = document.createElement("button");
      settleButton.type = "button";
      settleButton.className = "ghost-action shared-entry-settle";
      settleButton.dataset.action = "toggle-settle-member";
      settleButton.dataset.memberId = pairwise.debtorMemberId;
      settleButton.textContent = isPairSettled ? "Reabrir parte" : "Marcar liquidado";
      settleButton.title = isPairSettled
        ? `Volver a contar la parte de ${pairwise.otherName} en el saldo`
        : `Cerrar la parte de ${pairwise.otherName} en este gasto sin tocar las de los demás miembros`;
      row.append(settleButton);
    } else if (!pairwise) {
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
  syncSharedTargetKind();
  syncSharedModeLabels();
  syncSharedUnevenVisibility();
});

elements.sharedMode.addEventListener("change", () => {
  syncSharedUnevenVisibility();
  syncSharedTotalHint();
});

elements.sharedMyShare.addEventListener("input", syncSharedTotalHint);
elements.sharedTheirShare.addEventListener("input", syncSharedTotalHint);
elements.amount.addEventListener("input", () => {
  syncSharedTotalHint();
  syncSharedGroupTotalHint();
});

elements.sharedGroupMode?.addEventListener("change", () => {
  const target = parseSharedTarget(elements.sharedContact.value);
  if (target.kind === "group") {
    syncSharedGroupSharesGrid(target.id);
    syncSharedGroupTotalHint();
  }
});

// Inputs del grid de partes desiguales: feedback en vivo del total.
elements.sharedGroupShares?.addEventListener("input", (event) => {
  if (event.target.matches("[data-share-input]")) {
    syncSharedGroupTotalHint();
  }
});

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
  elements.sharedContact.value = `contact:${contactId}`;
  syncSharedTargetKind();
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

  if (action === "toggle-settle-member") {
    // Liquidación granular en una entry de grupo: marca solo la parte
    // de un miembro (el deudor del par yo↔contacto) en settledMembers.
    // El campo es un mapa { member_id: timestamp }; ausencia = abierto.
    const memberId = button.dataset.memberId;
    if (!memberId) return;
    const before = { ...entry, settledMembers: { ...(entry.settledMembers || {}) } };
    const next = { ...(entry.settledMembers || {}) };
    if (next[memberId]) {
      delete next[memberId];
    } else {
      next[memberId] = new Date().toISOString();
    }
    entry.settledMembers = Object.keys(next).length ? next : null;
    saveSharedEntries();
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
  syncMobileBackToAllVisibility();
});

// Mobile-only picker at the top of the Saldos panel: drives both the
// balance card visibility and the entries filter below. Same state
// field as the desktop dropdown.
elements.sharedMobileContactPicker.addEventListener("change", () => {
  state.sharedFilterContactId = elements.sharedMobileContactPicker.value;
  elements.sharedContactFilter.value = state.sharedFilterContactId;
  renderSharedBalances();
  renderSharedEntries();
  syncMobileBackToAllVisibility();
});

// Botón "Volver a Todos": atajo a la izquierda del dropdown que
// resetea el filtro sin tener que abrir el desplegable.
elements.sharedMobileBackToAll?.addEventListener("click", () => {
  state.sharedFilterContactId = "all";
  elements.sharedMobileContactPicker.value = "all";
  elements.sharedContactFilter.value = "all";
  renderSharedBalances();
  renderSharedEntries();
  syncMobileBackToAllVisibility();
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

  state.sharedFilterContactId = `contact:${contactId}`;
  elements.sharedContactFilter.value = state.sharedFilterContactId;
  elements.sharedMobileContactPicker.value = state.sharedFilterContactId;
  // Re-render balances too (in móvil cambia el resumen a la card
  // detallada del contacto recién seleccionado).
  renderSharedBalances();
  renderSharedEntries();
  syncMobileBackToAllVisibility();
  // Scroll al panel de movimientos solo en desktop. En móvil la card
  // detallada aparece en el sitio del resumen, no necesita salto.
  if (!window.matchMedia("(max-width: 719px)").matches) {
    document.querySelector("#shared-entries")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
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
