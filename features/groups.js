// Grupos de gastos compartidos (3+ personas).
//
// Capa de modelo: CRUD sobre groups y group_members + helpers de cálculo
// de balance pairwise. La UI vive en otro módulo y consume estas
// funciones — aquí no hay event listeners.
//
// Modelo de splits: cada shared_entry de grupo lleva un JSONB
// `splits` con la forma { member_id: { paid: numeric, owes: numeric } }.
// Convención v1: UN pagador por entrada (un único miembro con paid > 0;
// el resto a 0). Cualquiera puede ser ese pagador. La parte `owes` se
// reparte entre todos los participantes según el modo del grupo (igual,
// porcentaje) o según el override de la entrada.
//
// Balance pairwise: por cada entrada, los miembros con owes > 0 deben
// su parte al pagador. Acumulando sobre todas las entradas activas (no
// settled, no en categoría payment) se obtiene "cuánto debe A a B".

import { state } from "../core/state.js";
import {
  saveGroups,
  saveGroupMembers,
  saveSharedEntries,
} from "../core/storage.js";
import { createId } from "../core/utils.js";
import { getUserIdSync } from "../core/supabase.js";

// ---- queries básicas --------------------------------------------------

export function getGroupById(id) {
  return state.groups.find((g) => g.id === id) ?? null;
}

export function getGroupMembers(groupId, { includeInactive = false } = {}) {
  return state.groupMembers.filter(
    (m) => m.groupId === groupId && (includeInactive || !m.leftAt)
  );
}

export function getMemberById(memberId) {
  return state.groupMembers.find((m) => m.id === memberId) ?? null;
}

export function getMyMemberInGroup(groupId) {
  const myUid = getUserIdSync();
  if (!myUid) return null;
  return state.groupMembers.find(
    (m) => m.groupId === groupId && m.authUserId === myUid && !m.leftAt
  ) ?? null;
}

// Grupos visibles al usuario actual: aquellos donde es admin (ownerId)
// o miembro activo (existe un group_member.authUserId === my_uid sin
// left_at). El cloudHydrate ya filtra esto vía RLS, pero filtramos en
// cliente también por si el state local incluye huérfanos.
export function getMyGroups() {
  const myUid = getUserIdSync();
  if (!myUid) return [];
  const myMemberGroupIds = new Set(
    state.groupMembers
      .filter((m) => m.authUserId === myUid && !m.leftAt)
      .map((m) => m.groupId)
  );
  return state.groups.filter(
    (g) => g.ownerId === myUid || myMemberGroupIds.has(g.id)
  );
}

// ---- perspectiva (cómo ve este miembro el viewer actual) -------------

// Dado un member del grupo, devuelve cómo debe pintarse para el viewer:
//   { label, isMe, isLinked, contactId? }
// - isMe: este member soy yo (auth_user_id === mi uid).
// - isLinked: el member tiene cuenta FlowGrid (vs. offline puro).
// - contactId: si tengo un contacto en mi lista que apunta a este
//   auth_user_id, devuelvo ese id por si la UI lo usa para abrir su
//   página, etc. Sin contacto explícito (caso típico cuando soy
//   miembro pero no admin), el label cae al display_name del member.
export function resolveMemberView(member) {
  const myUid = getUserIdSync();
  if (member.authUserId && myUid && member.authUserId === myUid) {
    return { label: "Tú", isMe: true, isLinked: true, contactId: null };
  }
  if (member.authUserId) {
    const myContact = state.contacts.find(
      (c) => c.authUserId === member.authUserId
    );
    return {
      label: myContact?.name ?? member.displayName,
      isMe: false,
      isLinked: true,
      contactId: myContact?.id ?? null,
    };
  }
  return {
    label: member.displayName,
    isMe: false,
    isLinked: false,
    contactId: member.inviterContactId ?? null,
  };
}

// ---- CRUD: groups -----------------------------------------------------

// Crea un grupo y auto-añade al creador como primer miembro vinculado.
// El default_split solo aplica si el modo es 'uneven'. Para v1 los
// nuevos grupos arrancan en 'equal' por defecto y la edición del modo
// se hará desde la vista de gestión.
export function createGroup({ name, defaultSplitMode = "equal", defaultSplit = null, creatorDisplayName }) {
  const myUid = getUserIdSync();
  if (!myUid) throw new Error("No hay sesión para crear el grupo.");

  const groupId = createId();
  const group = {
    id: groupId,
    ownerId: myUid,
    name: (name || "").trim() || "Grupo",
    defaultSplitMode,
    defaultSplit: defaultSplitMode === "uneven" ? defaultSplit : null,
    createdAt: new Date().toISOString(),
  };
  const creatorMember = {
    id: createId(),
    groupId,
    authUserId: myUid,
    displayName: creatorDisplayName || "Yo",
    email: null,
    inviterContactId: null,
    joinedAt: new Date().toISOString(),
    leftAt: null,
  };

  state.groups = [group, ...state.groups];
  state.groupMembers = [creatorMember, ...state.groupMembers];
  saveGroups();
  saveGroupMembers();
  return group;
}

export function renameGroup(groupId, newName) {
  const group = getGroupById(groupId);
  if (!group) return;
  const trimmed = (newName || "").trim();
  if (!trimmed || trimmed === group.name) return;
  group.name = trimmed;
  saveGroups();
}

export function updateGroupDefaultSplit(groupId, { mode, split }) {
  const group = getGroupById(groupId);
  if (!group) return;
  group.defaultSplitMode = mode === "uneven" ? "uneven" : "equal";
  group.defaultSplit = group.defaultSplitMode === "uneven" ? split : null;
  saveGroups();
}

// Cesión de admin: el owner_id pasa a otro miembro vinculado y activo.
// Pre-condición: newOwnerUid debe corresponder a un member del grupo
// con left_at == null. La RLS del UPDATE valida que solo el owner
// actual puede ejecutarla. Tras el UPDATE el cedente sigue siendo
// miembro pero pierde el rol de admin.
export function transferGroupAdmin(groupId, newOwnerUid) {
  const group = getGroupById(groupId);
  if (!group) return;
  const newOwnerMember = state.groupMembers.find(
    (m) => m.groupId === groupId && m.authUserId === newOwnerUid && !m.leftAt
  );
  if (!newOwnerMember) {
    throw new Error("El nuevo admin debe ser un miembro vinculado y activo.");
  }
  group.ownerId = newOwnerUid;
  saveGroups();
}

// Salir del grupo. Si soy el admin actual, primero cedo a otro miembro
// (el más antiguo después de mí); si no hay candidato vinculado, NO
// permitimos salir — el grupo se quedaría sin admin. La UI debe avisar.
export function leaveGroup(groupId) {
  const myUid = getUserIdSync();
  if (!myUid) throw new Error("No hay sesión.");
  const myMember = getMyMemberInGroup(groupId);
  if (!myMember) return;

  const group = getGroupById(groupId);
  if (!group) return;

  if (group.ownerId === myUid) {
    const candidate = state.groupMembers
      .filter(
        (m) =>
          m.groupId === groupId &&
          !m.leftAt &&
          m.authUserId &&
          m.authUserId !== myUid
      )
      .sort((a, b) => (a.joinedAt < b.joinedAt ? -1 : 1))[0];
    if (!candidate) {
      throw new Error(
        "No hay otro miembro vinculado al que ceder el rol de admin. Invita primero o elimina el grupo."
      );
    }
    transferGroupAdmin(groupId, candidate.authUserId);
  }

  myMember.leftAt = new Date().toISOString();
  saveGroupMembers();
}

export function deleteGroup(groupId) {
  state.groups = state.groups.filter((g) => g.id !== groupId);
  state.groupMembers = state.groupMembers.filter((m) => m.groupId !== groupId);
  // Las shared_entries con este group_id se borran en cascada vía la
  // FK del schema cuando se eliminan en cloud. Localmente las quitamos
  // a mano para mantener coherencia inmediata.
  state.sharedEntries = state.sharedEntries.filter((e) => e.groupId !== groupId);
  saveGroups();
  saveGroupMembers();
  saveSharedEntries();
}

// ---- CRUD: group members ---------------------------------------------

// Añade un miembro al grupo a partir de un contacto del admin. Si el
// contacto está vinculado, se enlaza por authUserId (y el linked
// partner verá el grupo automáticamente vía RLS). Si es offline, queda
// como display_name + email (la UI ofrece invitarlo).
//
// Si ya existe una row para el mismo (groupId, authUserId) con left_at
// poblado, la reactivamos en lugar de crear una nueva — respeta el
// índice único parcial.
export function addMember(groupId, contact) {
  const group = getGroupById(groupId);
  if (!group) return null;

  if (contact.authUserId) {
    const existing = state.groupMembers.find(
      (m) => m.groupId === groupId && m.authUserId === contact.authUserId
    );
    if (existing) {
      existing.leftAt = null;
      existing.displayName = contact.name ?? existing.displayName;
      existing.email = contact.email ?? existing.email;
      existing.inviterContactId = contact.id ?? existing.inviterContactId;
      saveGroupMembers();
      return existing;
    }
  }

  const member = {
    id: createId(),
    groupId,
    authUserId: contact.authUserId ?? null,
    displayName: contact.name,
    email: contact.email ?? null,
    inviterContactId: contact.id ?? null,
    joinedAt: new Date().toISOString(),
    leftAt: null,
  };
  state.groupMembers = [...state.groupMembers, member];
  saveGroupMembers();
  return member;
}

// Marca al miembro como ido. Se preserva la row para que las entradas
// pasadas en las que participó sigan resolviendo su display_name.
export function removeMember(groupId, memberId) {
  const member = state.groupMembers.find(
    (m) => m.id === memberId && m.groupId === groupId
  );
  if (!member) return;
  member.leftAt = new Date().toISOString();
  saveGroupMembers();
}

// ---- balances pairwise -----------------------------------------------

// Convierte un splits JSONB en una lista de transacciones implícitas
// {from, to, amount}. Si nadie pagó (todos paid=0) o todo cuadra ya
// (paid==owes para todos), no devuelve ninguna. Modelo v1: asume UN
// pagador por entrada — el participante con el mayor paid > 0.
function transactionsFromSplits(splits) {
  if (!splits) return [];
  const entries = Object.entries(splits).map(([memberId, { paid, owes }]) => ({
    memberId,
    paid: Number(paid) || 0,
    owes: Number(owes) || 0,
  }));
  const payer = entries.find((e) => e.paid > 0);
  if (!payer) return [];
  return entries
    .filter((e) => e.memberId !== payer.memberId && e.owes > 0)
    .map((e) => ({
      from: e.memberId,
      to: payer.memberId,
      amount: e.owes,
    }));
}

// Saldo neto entre dos miembros del mismo grupo. Positivo = `b` debe a
// `a`; negativo = `a` debe a `b`. Suma sobre todas las entradas no
// liquidadas (settledAt nulo) y excluye entries de tipo "payment".
//
// Granularidad: una entrada puede tener `settledMembers` con liquidación
// individual por miembro. Si la deuda corresponde a un par (from→to)
// donde el deudor (from) está marcado como liquidado en esa entrada,
// se ignora esa transacción concreta — el resto del grupo sigue contando.
export function pairwiseBalance(groupId, memberAId, memberBId) {
  let net = 0; // a's perspective: positive = b owes a
  for (const entry of state.sharedEntries) {
    if (entry.groupId !== groupId) continue;
    if (entry.settledAt) continue;
    if (entry.type === "payment") continue;
    const txs = transactionsFromSplits(entry.splits);
    for (const tx of txs) {
      if (entry.settledMembers?.[tx.from]) continue;
      if (tx.from === memberBId && tx.to === memberAId) net += tx.amount;
      else if (tx.from === memberAId && tx.to === memberBId) net -= tx.amount;
    }
  }
  return Math.round(net * 100) / 100;
}

// Estado liquidado de un miembro en una entrada concreta. Útil para la
// UI cuando filtras por contacto y quieres saber si su parte está
// cerrada en este gasto. Devuelve el timestamp ISO o null.
export function memberSettledAt(entry, memberId) {
  if (!entry || !memberId) return null;
  return entry.settledMembers?.[memberId] ?? null;
}

// Encuentra el miembro de un grupo que corresponde a un contacto de mi
// lista. Dos vías: (a) el miembro fue añadido desde ese contacto del
// admin (inviterContactId apunta al contacto), o (b) el miembro tiene
// la misma cuenta vinculada que el contacto (authUserId coincide). El
// segundo caso es el que cubre al miembro que entró por invitación
// posterior, cuyo group_member.inviterContactId puede no coincidir con
// nuestro contacto local.
export function findGroupMemberForContact(groupId, contact) {
  if (!contact) return null;
  return state.groupMembers.find((m) =>
    m.groupId === groupId &&
    (m.inviterContactId === contact.id ||
      (contact.authUserId && m.authUserId === contact.authUserId))
  ) ?? null;
}

// Saldo total a través de todos los gastos de grupo en los que participa
// este contacto. Mismo signo que pairwiseBalance: positivo = me debe;
// negativo = le debo. Suma el saldo pairwise yo↔contacto en cada grupo.
export function groupBalanceForContact(contact) {
  if (!contact) return 0;
  let total = 0;
  for (const group of state.groups) {
    const myMember = getMyMemberInGroup(group.id);
    if (!myMember) continue;
    const otherMember = findGroupMemberForContact(group.id, contact);
    if (!otherMember || otherMember.id === myMember.id) continue;
    total += pairwiseBalance(group.id, myMember.id, otherMember.id);
  }
  return Math.round(total * 100) / 100;
}

// Hay alguna entrada de grupo donde este contacto figura como
// participante (con paid o owes > 0)? Usado para que contactHasEntries
// considere a un contacto "activo" aunque solo aparezca en gastos
// generados desde un grupo.
export function contactHasGroupEntries(contact) {
  if (!contact) return false;
  for (const entry of state.sharedEntries) {
    if (!entry.groupId || !entry.splits) continue;
    const otherMember = findGroupMemberForContact(entry.groupId, contact);
    if (!otherMember) continue;
    const split = entry.splits[otherMember.id];
    if (!split) continue;
    if (Number(split.paid) > 0 || Number(split.owes) > 0) return true;
  }
  return false;
}

// Saldo del viewer actual (member auth_user_id === me) frente a cada
// otro miembro activo del grupo. Devuelve [{member, balance}], donde
// balance > 0 significa "ese miembro me debe", < 0 "yo le debo".
export function getMyBalancesInGroup(groupId) {
  const me = getMyMemberInGroup(groupId);
  if (!me) return [];
  const others = getGroupMembers(groupId, { includeInactive: true })
    .filter((m) => m.id !== me.id);
  return others.map((member) => ({
    member,
    balance: pairwiseBalance(groupId, me.id, member.id),
  }));
}

// ---- splits builder --------------------------------------------------

// Construye un splits JSONB para una nueva entrada de grupo a partir
// de los inputs del modal: total, modo, pagador, miembros excluidos
// puntualmente. La UI llamará esto antes de guardar la entrada.
export function buildSplits({ groupId, total, payerMemberId, mode, perMemberShares, excludedMemberIds = [] }) {
  const allMembers = getGroupMembers(groupId);
  const participating = allMembers.filter(
    (m) => !excludedMemberIds.includes(m.id)
  );
  if (!participating.length) {
    throw new Error("No hay miembros que participen en este gasto.");
  }

  const splits = {};
  for (const member of allMembers) {
    splits[member.id] = { paid: 0, owes: 0 };
  }
  splits[payerMemberId].paid = roundCents(total);

  if (mode === "equal") {
    const share = roundCents(total / participating.length);
    let remainder = roundCents(total - share * participating.length);
    for (const member of participating) {
      // El primer miembro absorbe el redondeo a céntimos para que la
      // suma cuadre con el total exacto.
      splits[member.id].owes = roundCents(share + remainder);
      remainder = 0;
    }
    return splits;
  }

  if (mode === "uneven") {
    if (!perMemberShares) {
      throw new Error("Reparto desigual sin valores por miembro.");
    }
    let sum = 0;
    for (const member of participating) {
      const owes = roundCents(perMemberShares[member.id] ?? 0);
      splits[member.id].owes = owes;
      sum += owes;
    }
    sum = roundCents(sum);
    if (Math.abs(sum - roundCents(total)) >= 0.005) {
      throw new Error(
        `Las partes (${sum.toFixed(2)}) no cuadran con el total (${roundCents(total).toFixed(2)}).`
      );
    }
    return splits;
  }

  throw new Error(`Modo de reparto desconocido: ${mode}`);
}

function roundCents(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
