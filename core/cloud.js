// Cloud sync layer. Uses raw fetch against the Supabase REST endpoint instead
// of going through supabase-js's PostgrestClient: we hit a hang in the
// library's internal auth/lock mechanism that wasn't fixable by overriding
// `lock` or pinning the version. Auth (login, session) still uses supabase-js
// because that side worked fine; only the data plane is bypassed.

import { state } from "./state.js";
import { getUserId, getUserIdSync, getAccessToken } from "./supabase.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import {
  MOVEMENTS_KEY,
  SETTINGS_KEY,
  CONTACTS_KEY,
  SHARED_KEY,
  RECURRING_TEMPLATES_KEY,
  GROUPS_KEY,
  GROUP_MEMBERS_KEY,
  OUTBOX_KEY,
  defaultCategories,
  defaultConcepts,
  seedMovements,
} from "./constants.js";

// ---- field mapping (camelCase <-> snake_case) ----

function movementToCloud(m, ownerId) {
  return {
    id: m.id,
    owner_id: ownerId,
    type: m.type,
    date: m.date,
    concept: m.concept,
    amount: m.amount,
    category: m.category,
    party: m.party ?? "",
    recurrence: m.recurrence ?? "",
    note: m.note ?? "",
    shared_entry_id: m.sharedEntryId ?? null,
    recurring_template_id: m.recurringTemplateId ?? null,
  };
}

function movementFromCloud(row) {
  return {
    id: row.id,
    type: row.type,
    date: row.date,
    concept: row.concept,
    amount: Number(row.amount),
    category: row.category,
    party: row.party ?? "",
    recurrence: row.recurrence ?? "",
    note: row.note ?? "",
    sharedEntryId: row.shared_entry_id ?? null,
    recurringTemplateId: row.recurring_template_id ?? null,
  };
}

function recurringTemplateToCloud(t, ownerId) {
  return {
    id: t.id,
    owner_id: ownerId,
    type: t.type,
    concept: t.concept,
    amount: t.amount,
    category: t.category,
    party: t.party ?? "",
    note: t.note ?? "",
    periodicity: t.periodicity,
    day_of_month: t.dayOfMonth,
    month_of_year: t.monthOfYear ?? null,
    start_date: t.startDate,
    end_date: t.endDate ?? null,
    last_generated_date: t.lastGeneratedDate ?? null,
    is_active: t.isActive ?? true,
    shared_contact_id: t.sharedContactId ?? null,
    shared_paid_by: t.sharedPaidBy ?? null,
    shared_split_mode: t.sharedSplitMode ?? null,
    shared_my_share: t.sharedMyShare ?? null,
    shared_their_share: t.sharedTheirShare ?? null,
    // Cuando la plantilla apunta a un grupo, los campos shared_* se
    // ignoran y group_id manda. Para 1↔1 legacy va NULL.
    group_id: t.groupId ?? null,
    // Reparto custom por miembro en plantillas de grupo: {member_id: percent}.
    // NULL = usar el default_split del grupo al materializar. Cuando se
    // crea convirtiendo un movimiento desigual existente, se rellena con
    // los porcentajes calculados desde sus splits.owes.
    group_split: t.groupSplit ?? null,
    created_at: t.createdAt ?? new Date().toISOString(),
  };
}

function recurringTemplateFromCloud(row) {
  return {
    id: row.id,
    type: row.type,
    concept: row.concept,
    amount: Number(row.amount),
    category: row.category,
    party: row.party ?? "",
    note: row.note ?? "",
    periodicity: row.periodicity,
    dayOfMonth: row.day_of_month,
    monthOfYear: row.month_of_year ?? null,
    startDate: row.start_date,
    endDate: row.end_date ?? null,
    lastGeneratedDate: row.last_generated_date ?? null,
    isActive: row.is_active ?? true,
    sharedContactId: row.shared_contact_id ?? null,
    sharedPaidBy: row.shared_paid_by ?? null,
    sharedSplitMode: row.shared_split_mode ?? null,
    sharedMyShare: row.shared_my_share != null ? Number(row.shared_my_share) : null,
    sharedTheirShare: row.shared_their_share != null ? Number(row.shared_their_share) : null,
    groupId: row.group_id ?? null,
    groupSplit: row.group_split ?? null,
    createdAt: row.created_at,
  };
}

function contactToCloud(c, ownerId) {
  return {
    id: c.id,
    owner_id: ownerId,
    name: c.name,
    email: c.email ?? "",
    invited_at: c.invitedAt ?? null,
    auth_user_id: c.authUserId ?? null,
    // owner_email is normally maintained by the BEFORE-INSERT/UPDATE
    // trigger on the server (set_contacts_owner_email). We send our
    // local copy back so re-pushes keep the column populated even if
    // the trigger ever gets disabled.
    owner_email: c.ownerEmail ?? null,
    created_at: c.createdAt ?? new Date().toISOString(),
  };
}

function contactFromCloud(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? "",
    invitedAt: row.invited_at ?? null,
    authUserId: row.auth_user_id ?? null,
    ownerEmail: row.owner_email ?? null,
    createdAt: row.created_at,
  };
}

// `ownerId` here is the row's owner (inviter when partner edits a shared
// entry that belongs to the inviter). Local entries created by the user
// inherit the current user's id; entries hydrated from a linked partner
// keep the partner's id, so a re-push doesn't accidentally re-home them.
function sharedToCloud(e, ownerId) {
  return {
    id: e.id,
    owner_id: e.ownerId ?? ownerId,
    contact_id: e.contactId,
    type: e.type,
    date: e.date,
    concept: e.concept,
    note: e.note ?? "",
    total: e.total,
    paid_by: e.paidBy,
    split_mode: e.splitMode,
    my_share: e.myShare ?? 0,
    their_share: e.theirShare ?? 0,
    source_movement_id: e.sourceMovementId ?? null,
    // Adelanto: pago anticipado por un gasto que aún no ha ocurrido.
    // Solo cambia la etiqueta en la UI; el saldo lo trata como cualquier
    // otro pago. Ver migrate-12-shared-entry-advance.sql.
    advance: e.advance ?? false,
    settled_at: e.settledAt ?? null,
    // Liquidación granular por miembro en gastos de grupo: { member_id:
    // timestamp }. NULL en entradas 1↔1 o en grupos sin partes
    // liquidadas individualmente.
    settled_members: e.settledMembers ?? null,
    // Cuando la entrada pertenece a un grupo (3+ personas), group_id y
    // splits llevan el desglose canónico. Para 1↔1 legacy, ambos van NULL.
    group_id: e.groupId ?? null,
    splits: e.splits ?? null,
    created_at: e.createdAt ?? new Date().toISOString(),
  };
}

function sharedFromCloud(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    type: row.type,
    contactId: row.contact_id,
    date: row.date,
    concept: row.concept,
    note: row.note ?? "",
    total: Number(row.total),
    paidBy: row.paid_by,
    splitMode: row.split_mode,
    myShare: Number(row.my_share),
    theirShare: Number(row.their_share),
    sourceMovementId: row.source_movement_id ?? null,
    advance: row.advance ?? false,
    settledAt: row.settled_at ?? null,
    settledMembers: row.settled_members ?? null,
    groupId: row.group_id ?? null,
    splits: row.splits ?? null,
    createdAt: row.created_at,
  };
}

function groupToCloud(g, ownerId) {
  return {
    id: g.id,
    owner_id: g.ownerId ?? ownerId,
    name: g.name,
    default_split_mode: g.defaultSplitMode ?? "equal",
    default_split: g.defaultSplit ?? null,
    created_at: g.createdAt ?? new Date().toISOString(),
  };
}

function groupFromCloud(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    defaultSplitMode: row.default_split_mode,
    defaultSplit: row.default_split ?? null,
    createdAt: row.created_at,
  };
}

function groupMemberToCloud(m) {
  return {
    id: m.id,
    group_id: m.groupId,
    auth_user_id: m.authUserId ?? null,
    display_name: m.displayName,
    email: m.email ?? null,
    inviter_contact_id: m.inviterContactId ?? null,
    joined_at: m.joinedAt ?? new Date().toISOString(),
    left_at: m.leftAt ?? null,
  };
}

function groupMemberFromCloud(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    authUserId: row.auth_user_id ?? null,
    displayName: row.display_name,
    email: row.email ?? null,
    inviterContactId: row.inviter_contact_id ?? null,
    joinedAt: row.joined_at,
    leftAt: row.left_at ?? null,
  };
}

// ---- raw REST helpers ----

// Tope de espera para escrituras. Un fetch colgado (red de tren, móvil
// que se duerme) dejaría la cola bloqueada para siempre.
const WRITE_TIMEOUT_MS = 30000;

function authHeaders() {
  const token = getAccessToken();
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
  };
}

async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

// Lectura completa por páginas. PostgREST corta cada respuesta en el
// "Max rows" del proyecto (1000 por defecto en Supabase) sin avisar: un
// GET con limit=50000 devuelve solo 1000 filas. Con más de 1000
// movimientos, la app cargaba una parte y el resto quedaba invisible.
// Pedimos páginas con orden estable hasta que una llega vacía; así
// funciona con cualquier tope.
async function restGetAll(path) {
  const sep = path.includes("?") ? "&" : "?";
  const order = /(^|[?&])order=/.test(path) ? "" : "&order=id.asc";
  const rows = [];
  for (;;) {
    const chunk = await restGet(`${path}${sep}offset=${rows.length}${order}`);
    if (!chunk.length) break;
    rows.push(...chunk);
  }
  return rows;
}

// fetch de escritura con timeout. Los errores HTTP llevan `status` para
// que la cola distinga un rechazo definitivo (4xx) de un fallo pasajero.
async function restWrite(url, options, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      const error = new Error(`${label} failed: ${res.status} ${await res.text()}`);
      error.status = res.status;
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function restUpsert(table, rows, conflictColumn = "id") {
  if (!rows.length) return;
  await restWrite(
    `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictColumn}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
    `upsert ${table}`
  );
}

async function restDelete(table, ids) {
  if (!ids.length) return;
  const inList = ids.map((id) => `"${encodeURIComponent(id)}"`).join(",");
  await restWrite(
    `${SUPABASE_URL}/rest/v1/${table}?id=in.(${inList})`,
    { method: "DELETE", headers: authHeaders() },
    `delete ${table}`
  );
}

// ---- push: cola de cambios pendientes ----
//
// Antes cada guardado subía la tabla entera y borraba en la nube todo lo
// que no estuviera en la copia local. Con varias subidas en vuelo
// (aprobar propuestas seguidas, red lenta) una copia vieja llegaba tarde
// y borraba filas recién creadas; si la subida fallaba, nadie se
// enteraba, y la siguiente recarga tiraba lo local. Así se quedaron
// gastos compartidos sin su movimiento y movimientos perdidos.
//
// Ahora cada save*() compara el estado con la última versión conocida
// (baseline) y apunta en una cola, guardada en localStorage, solo lo que
// ha cambiado: filas nuevas o modificadas (upsert) y filas que han
// desaparecido (delete). La cola se sube de una vez en una, en orden,
// y si falla se reintenta. cloudHydrate vuelve a aplicar la cola encima
// de lo que llega de la nube, de modo que recargar no pierde nada.
// Una copia desactualizada de la app ya no puede borrar filas que no
// conoce: solo borra las que ella misma ha visto desaparecer.

const ROW_LIMIT = 50000;
const UPSERT_CHUNK = 500;
const DELETE_CHUNK = 100;
const REJECTED_KEY = `${OUTBOX_KEY}.rejected`;

function isMine(row) {
  const me = getUserIdSync();
  return !me || (row.ownerId ?? me) === me;
}

// Orden de las claves = orden de subida: los grupos van antes que lo que
// apunta a ellos por group_id. Los borrados se hacen en orden inverso.
const SYNC_TABLES = {
  // Solo los grupos de los que soy admin; los ajenos los gestiona su admin.
  groups: {
    stateKey: "groups",
    rows: () => state.groups.filter(isMine),
    toCloud: groupToCloud,
  },
  // Solo los miembros de mis grupos (RLS no deja tocar los demás).
  group_members: {
    stateKey: "groupMembers",
    rows: () => {
      const mine = new Set(state.groups.filter(isMine).map((g) => g.id));
      return state.groupMembers.filter((m) => mine.has(m.groupId));
    },
    toCloud: (m) => groupMemberToCloud(m),
  },
  contacts: {
    stateKey: "contacts",
    rows: () => state.contacts,
    toCloud: contactToCloud,
  },
  movements: {
    stateKey: "movements",
    rows: () => state.movements,
    toCloud: movementToCloud,
  },
  // Se suben también las entradas de un contacto vinculado que yo edito
  // (el mapper conserva su owner_id y RLS lo admite), pero solo se
  // borran las mías.
  shared_entries: {
    stateKey: "sharedEntries",
    rows: () => state.sharedEntries,
    toCloud: sharedToCloud,
    canDelete: isMine,
  },
  recurring_templates: {
    stateKey: "recurringTemplates",
    rows: () => state.recurringTemplates,
    toCloud: recurringTemplateToCloud,
  },
  // Una sola fila por usuario; se identifica por owner_id.
  settings: {
    rows: () => [{ id: "settings", ...state.settings }],
    toCloud: (s, ownerId) => ({
      owner_id: ownerId,
      categories: s.categories,
      concepts: s.concepts,
      notify_shared_email: s.notifySharedEmail ?? false,
    }),
    conflict: "owner_id",
  },
};
const TABLE_ORDER = Object.keys(SYNC_TABLES);

// tabla → Map(id → JSON de la fila tal como la conocíamos).
const baseline = new Map();
// `${tabla}:${id}` → { table, op: "upsert" | "delete", id, row, seq }.
// Un cambio posterior sobre la misma fila sustituye al anterior.
let outbox = new Map();
let outboxOwner = null;
let seq = 0;

function snapshotTable(table) {
  const map = new Map();
  for (const row of SYNC_TABLES[table].rows()) map.set(row.id, JSON.stringify(row));
  return map;
}

// Fija la versión conocida de cada tabla sin apuntar nada en la cola.
export function resetSyncBaseline() {
  for (const table of TABLE_ORDER) baseline.set(table, snapshotTable(table));
}

function ensureOutboxLoaded() {
  const me = getUserIdSync();
  if (!me || outboxOwner === me) return;
  outboxOwner = me;
  outbox = new Map();
  try {
    const stored = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "null");
    if (stored && stored.ownerId !== me) {
      console.warn("[sync] cola de otra cuenta descartada", stored.ops?.length ?? 0);
    } else if (Array.isArray(stored?.ops)) {
      for (const op of stored.ops) outbox.set(`${op.table}:${op.id}`, { ...op, seq: ++seq });
    }
  } catch (error) {
    console.error("[sync] cola ilegible", error);
  }
}

function persistOutbox() {
  try {
    localStorage.setItem(
      OUTBOX_KEY,
      JSON.stringify({ ownerId: outboxOwner, ops: [...outbox.values()] })
    );
  } catch (error) {
    console.error("[sync] no se pudo guardar la cola", error);
  }
}

// Apunta en la cola lo que ha cambiado en `table` desde la última vez.
export function trackChanges(table) {
  ensureOutboxLoaded();
  const cfg = SYNC_TABLES[table];
  const prev = baseline.get(table) ?? new Map();
  const next = snapshotTable(table);
  for (const [id, json] of next) {
    if (prev.get(id) === json) continue;
    outbox.set(`${table}:${id}`, { table, op: "upsert", id, row: JSON.parse(json), seq: ++seq });
  }
  for (const [id, json] of prev) {
    if (next.has(id)) continue;
    if (cfg.canDelete && !cfg.canDelete(JSON.parse(json))) continue;
    outbox.set(`${table}:${id}`, { table, op: "delete", id, row: null, seq: ++seq });
  }
  baseline.set(table, next);
  persistOutbox();
  emitStatus();
}

function trackAllChanges() {
  for (const table of TABLE_ORDER) trackChanges(table);
}

// Aplica la cola encima del estado recién bajado de la nube, para que lo
// que aún no ha subido siga ahí tras recargar.
function applyOutboxToState() {
  for (const op of outbox.values()) {
    if (op.table === "settings") {
      if (op.op === "upsert") {
        const { id: _id, ...settings } = op.row;
        state.settings = settings;
      }
      continue;
    }
    const key = SYNC_TABLES[op.table].stateKey;
    const rows = state[key];
    const index = rows.findIndex((r) => r.id === op.id);
    if (op.op === "delete") {
      if (index >= 0) state[key] = rows.filter((r) => r.id !== op.id);
    } else if (index >= 0) {
      state[key] = rows.map((r) => (r.id === op.id ? op.row : r));
    } else {
      state[key] = [op.row, ...rows];
    }
  }
}

// ---- subida de la cola ----

let flushPromise = null;
let retryTimer = null;
let retryDelay = 0;
let lastError = null;
let rejectedCount = 0;
const statusListeners = new Set();

export function getSyncStatus() {
  return { pending: outbox.size, error: lastError, rejected: rejectedCount };
}

export function onSyncStatus(callback) {
  statusListeners.add(callback);
  callback(getSyncStatus());
}

function emitStatus() {
  const status = getSyncStatus();
  statusListeners.forEach((callback) => callback(status));
}

// 4xx que no se arreglan reintentando: la nube rechaza esa fila
// (restricción, RLS). 401 (sesión caducada), 408 y 429 sí son pasajeros.
function isPermanent(error) {
  const status = error?.status;
  return status >= 400 && status < 500 && ![401, 408, 429].includes(status);
}

// Quita de la cola las operaciones subidas, salvo que la fila haya vuelto
// a cambiar mientras tanto (entonces queda la versión nueva pendiente).
function settle(done) {
  for (const op of done) {
    const key = `${op.table}:${op.id}`;
    if (outbox.get(key)?.seq === op.seq) outbox.delete(key);
  }
  persistOutbox();
  emitStatus();
}

// Una fila que la nube rechaza siempre no puede bloquear la cola entera
// (eso dejaría sin subir todo lo demás). La apartamos en localStorage
// para poder recuperarla a mano y seguimos.
function reject(op, error) {
  console.error("[sync] fila rechazada por la nube", op, error);
  try {
    const list = JSON.parse(localStorage.getItem(REJECTED_KEY) ?? "[]");
    list.push({ ...op, error: String(error?.message ?? error), at: new Date().toISOString() });
    localStorage.setItem(REJECTED_KEY, JSON.stringify(list));
  } catch {
    // localStorage lleno o inaccesible: queda al menos en consola.
  }
  rejectedCount += 1;
  settle([op]);
}

async function runChunk(chunk, send) {
  try {
    await send(chunk);
    settle(chunk);
  } catch (error) {
    if (!isPermanent(error)) throw error;
    if (chunk.length === 1) {
      reject(chunk[0], error);
      return;
    }
    // Buscar la fila culpable subiendo de una en una.
    for (const op of chunk) await runChunk([op], send);
  }
}

async function flushOnce() {
  const ownerId = await getUserId();
  if (!ownerId) throw new Error("Sin sesión: no se puede subir a la nube.");
  const ops = [...outbox.values()];

  for (const table of TABLE_ORDER) {
    const cfg = SYNC_TABLES[table];
    const upserts = ops.filter((op) => op.table === table && op.op === "upsert");
    for (let i = 0; i < upserts.length; i += UPSERT_CHUNK) {
      await runChunk(upserts.slice(i, i + UPSERT_CHUNK), (chunk) =>
        restUpsert(table, chunk.map((op) => cfg.toCloud(op.row, ownerId)), cfg.conflict)
      );
    }
  }
  for (const table of [...TABLE_ORDER].reverse()) {
    const deletes = ops.filter((op) => op.table === table && op.op === "delete");
    for (let i = 0; i < deletes.length; i += DELETE_CHUNK) {
      await runChunk(deletes.slice(i, i + DELETE_CHUNK), (chunk) =>
        restDelete(table, chunk.map((op) => op.id))
      );
    }
  }
}

function scheduleRetry() {
  if (retryTimer) return;
  retryDelay = Math.min(retryDelay ? retryDelay * 2 : 5000, 60000);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    flushOutbox();
  }, retryDelay);
}

// Sube la cola. Una sola subida a la vez: si ya hay una en marcha,
// devuelve esa (que sigue hasta vaciar también lo que llegue después).
// Resuelve a true cuando la cola queda vacía y a false si algo falló;
// en ese caso se reintenta sola más tarde. Nunca lanza.
export function flushOutbox() {
  if (flushPromise) return flushPromise;
  ensureOutboxLoaded();
  // El reset va en .finally() y no dentro de la función async: con la
  // cola vacía esta termina sin llegar a esperar nada, y un reset hecho
  // dentro correría antes de la asignación y dejaría flushPromise
  // apuntando para siempre a una subida ya acabada.
  flushPromise = drainOutbox().finally(() => {
    flushPromise = null;
    emitStatus();
    // Algo apuntado justo al terminar: otra vuelta.
    if (outbox.size && !lastError) flushOutbox();
  });
  return flushPromise;
}

async function drainOutbox() {
  try {
    while (outbox.size) await flushOnce();
    lastError = null;
    retryDelay = 0;
    return true;
  } catch (error) {
    console.error("[sync]", error);
    lastError = error;
    scheduleRetry();
    return false;
  }
}

export function retrySyncNow() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  return flushOutbox();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => retrySyncNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && outbox.size) retrySyncNow();
  });
}

// ---- inbox (bandeja de propuestas) ----
//
// La bandeja NO entra en el sync por foto completa: se lee aparte y cada
// fila se actualiza individualmente (aceptar / descartar). Así las filas
// que escribe un conector externo no se pierden con el push de un
// dispositivo desactualizado. Ver migrate-14-inbox.sql.

function inboxFromCloud(row) {
  return {
    id: row.id,
    batchId: row.batch_id ?? null,
    source: row.source,
    payload: row.payload ?? {},
    status: row.status,
    result: row.result ?? null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
  };
}

export async function cloudFetchInbox() {
  const ownerId = await getUserId();
  if (!ownerId) return [];
  const rows = await restGetAll(
    `inbox_items?owner_id=eq.${ownerId}&status=eq.pending&select=*&order=created_at.asc,id.asc`
  );
  return rows.map(inboxFromCloud);
}

export async function cloudInsertInbox(items) {
  const ownerId = await getUserId();
  if (!ownerId || !items.length) return;
  await restUpsert(
    "inbox_items",
    items.map((item) => ({
      id: item.id,
      owner_id: ownerId,
      batch_id: item.batchId ?? null,
      source: item.source ?? "paste",
      payload: item.payload,
      status: "pending",
    }))
  );
}

export async function cloudResolveInboxItem(id, status, result = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/inbox_items?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ status, result, resolved_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`resolve inbox ${id} failed: ${res.status} ${await res.text()}`);
}

// ---- hydrate (cloud is authoritative; first login pushes local seed up) ----

export async function cloudHydrate() {
  const ownerId = await getUserId();
  if (!ownerId) return;

  const [movementsData, settingsData, contactsData, sharedData, templatesData, groupsData, groupMembersData] = await Promise.all([
    restGetAll(`movements?owner_id=eq.${ownerId}&select=*`),
    restGet(`settings?owner_id=eq.${ownerId}&select=*&limit=${ROW_LIMIT}`),
    restGetAll(`contacts?owner_id=eq.${ownerId}&select=*`),
    // shared_entries: NO owner_id filter — RLS already returns my own
    // entries plus those owned by linked partners (contacts where the
    // partner has set me as auth_user_id). We hydrate them as a single
    // pool keyed by ownerId so the UI can display them seamlessly.
    restGetAll(`shared_entries?select=*`),
    restGetAll(`recurring_templates?owner_id=eq.${ownerId}&select=*`),
    // groups y group_members: SIN filtro de owner_id. RLS devuelve los
    // grupos donde soy admin O miembro activo, y los miembros de esos
    // grupos. La UI los rendea sin distinguir: para el usuario es lo
    // mismo "mi grupo Casa" que "el grupo Casa de Juan donde estoy".
    restGetAll(`groups?select=*`),
    restGetAll(`group_members?select=*`),
  ]);

  const settingsRow = settingsData[0] ?? null;
  // Restrict the empty-cloud check to MY data only. With the linked-partner
  // RLS, sharedData now includes entries owned by other users (the inviter
  // that linked me), so we must not let those count as "this user has data
  // already" — otherwise a brand-new invitee skips the local-to-cloud seed
  // step and ends up missing their default categories/concepts.
  const myShared = sharedData.filter((row) => row.owner_id === ownerId);
  const myGroups = groupsData.filter((row) => row.owner_id === ownerId);

  const cloudIsEmpty =
    !movementsData.length &&
    !contactsData.length &&
    !myShared.length &&
    !templatesData.length &&
    !myGroups.length &&
    !settingsRow;

  if (cloudIsEmpty) {
    // First login on this account: seed the cloud with whatever is in localStorage
    // (or with the demo defaults if localStorage is also empty).
    const localMovements = readLocalArray(MOVEMENTS_KEY) ?? seedMovements;
    const localContacts = readLocalArray(CONTACTS_KEY) ?? [];
    const localShared = readLocalArray(SHARED_KEY) ?? [];
    const localTemplates = readLocalArray(RECURRING_TEMPLATES_KEY) ?? [];
    const localGroups = readLocalArray(GROUPS_KEY) ?? [];
    const localGroupMembers = readLocalArray(GROUP_MEMBERS_KEY) ?? [];
    const localSettings = readLocalSettings();

    state.movements = localMovements;
    state.contacts = localContacts;
    state.sharedEntries = localShared;
    state.recurringTemplates = localTemplates;
    state.groups = localGroups;
    state.groupMembers = localGroupMembers;
    state.settings = localSettings;

    writeLocal(MOVEMENTS_KEY, state.movements);
    writeLocal(CONTACTS_KEY, state.contacts);
    writeLocal(SHARED_KEY, state.sharedEntries);
    writeLocal(RECURRING_TEMPLATES_KEY, state.recurringTemplates);
    writeLocal(GROUPS_KEY, state.groups);
    writeLocal(GROUP_MEMBERS_KEY, state.groupMembers);
    writeLocal(SETTINGS_KEY, state.settings);

    // Baseline vacía: todo lo local entra en la cola como fila nueva.
    ensureOutboxLoaded();
    baseline.clear();
    trackAllChanges();
    await flushOutbox();
    return;
  }

  // Cloud is authoritative: replace local snapshot with what's in the cloud.
  state.movements = movementsData.map(movementFromCloud);
  state.contacts = contactsData.map(contactFromCloud);
  state.sharedEntries = sharedData.map(sharedFromCloud);
  state.recurringTemplates = templatesData.map(recurringTemplateFromCloud);
  state.groups = groupsData.map(groupFromCloud);
  state.groupMembers = groupMembersData.map(groupMemberFromCloud);
  state.settings = settingsRow
    ? {
        categories: settingsRow.categories?.length ? settingsRow.categories : defaultCategories,
        concepts: settingsRow.concepts?.length ? settingsRow.concepts : defaultConcepts,
        notifySharedEmail: settingsRow.notify_shared_email ?? false,
      }
    : { categories: defaultCategories, concepts: defaultConcepts, notifySharedEmail: false };

  // Lo que acaba de llegar es lo que la nube ya tiene. Encima se aplica
  // la cola de cambios que aún no han subido (de esta sesión o de una
  // anterior que se cerró sin conexión), para no perderlos al recargar.
  ensureOutboxLoaded();
  resetSyncBaseline();
  applyOutboxToState();

  // One-shot migration (2026-05-01): "Recuperados" moved from category
  // "extra" to "ingreso". Idempotent; runs only on accounts that still have
  // the old mapping.
  for (const concept of state.settings.concepts) {
    if (concept.label === "Recuperados" && concept.category === "extra") {
      concept.category = "ingreso";
    }
  }

  // One-shot migration: collapse accent / case duplicates among concepts
  // (e.g. "Cafeteria/pub" + "Cafetería/pub"). The variant with the most
  // associated movements wins; the loser's movements are re-pointed to
  // the winner and the loser concept is removed from the catalogue.
  mergeAccentDuplicates(state.settings.concepts, state.movements);

  // Defensa: asegurar que soy miembro activo de todos los grupos que
  // tengo en propiedad (admin). Cubre el caso legacy de grupos creados
  // antes de que el auto-add del creador estuviera bien cableado, o
  // grupos donde mi member row se perdió en algún sync.
  ensureOwnerIsMemberOfOwnGroups(ownerId);

  // Las migraciones de arriba (y la cola reaplicada) entran en la cola
  // como cualquier otro cambio.
  trackAllChanges();

  writeLocal(MOVEMENTS_KEY, state.movements);
  writeLocal(CONTACTS_KEY, state.contacts);
  writeLocal(SHARED_KEY, state.sharedEntries);
  writeLocal(RECURRING_TEMPLATES_KEY, state.recurringTemplates);
  writeLocal(GROUPS_KEY, state.groups);
  writeLocal(GROUP_MEMBERS_KEY, state.groupMembers);
  writeLocal(SETTINGS_KEY, state.settings);

  // En segundo plano: el arranque no espera a la red para pintar.
  flushOutbox();
}

// Si soy el owner_id de un grupo pero no aparezco como group_member
// activo (auth_user_id === me, left_at IS NULL), inserto la fila. Si
// aparezco con left_at no nulo (me había salido de mi propio grupo,
// caso raro), reactivo. Idempotente.
function ensureOwnerIsMemberOfOwnGroups(myUid) {
  if (!myUid) return false;
  let touched = false;
  for (const group of state.groups) {
    if (group.ownerId !== myUid) continue;
    const myMember = state.groupMembers.find(
      (m) => m.groupId === group.id && m.authUserId === myUid
    );
    if (!myMember) {
      state.groupMembers = [
        ...state.groupMembers,
        {
          id: createIdLocal(),
          groupId: group.id,
          authUserId: myUid,
          displayName: "Yo",
          email: null,
          inviterContactId: null,
          joinedAt: group.createdAt ?? new Date().toISOString(),
          leftAt: null,
        },
      ];
      touched = true;
    } else if (myMember.leftAt) {
      myMember.leftAt = null;
      touched = true;
    }
  }
  return touched;
}

function createIdLocal() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `fg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Strip combining diacritics + lowercase + trim, so "Cafeteria/pub" and
// "Cafetería/pub" collapse to the same key.
function normalizeForMatch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function mergeAccentDuplicates(concepts, movements) {
  const buckets = new Map();
  for (const concept of concepts) {
    const key = normalizeForMatch(concept.label);
    if (!key) continue;
    const list = buckets.get(key) ?? [];
    list.push(concept);
    buckets.set(key, list);
  }

  let changed = false;
  let movementsTouched = false;
  const removeIds = new Set();

  for (const group of buckets.values()) {
    if (group.length <= 1) continue;

    // Pick the variant most movements actually use. Tie-break by longer
    // label (the accented spelling tends to be the visually richer one).
    const counts = group.map((c) =>
      movements.filter((m) => m.concept === c.label).length
    );
    const maxCount = Math.max(...counts);
    const candidates = group.filter((_, i) => counts[i] === maxCount);
    const winner = candidates.reduce((best, c) =>
      (c.label || "").length > (best.label || "").length ? c : best
    );
    const losers = group.filter((c) => c !== winner);
    if (!losers.length) continue;

    const loserLabels = new Set(losers.map((l) => l.label));
    for (const movement of movements) {
      if (loserLabels.has(movement.concept)) {
        movement.concept = winner.label;
        movementsTouched = true;
        changed = true;
      }
    }
    losers.forEach((l) => removeIds.add(l.id));
    changed = true;
  }

  if (removeIds.size) {
    for (let i = concepts.length - 1; i >= 0; i -= 1) {
      if (removeIds.has(concepts[i].id)) {
        concepts.splice(i, 1);
      }
    }
  }

  return { changed, movementsTouched };
}

function readLocalArray(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readLocalSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return { categories: defaultCategories, concepts: defaultConcepts, notifySharedEmail: false };
  try {
    const parsed = JSON.parse(raw);
    return {
      categories: parsed.categories?.length ? parsed.categories : defaultCategories,
      concepts: parsed.concepts?.length ? parsed.concepts : defaultConcepts,
      notifySharedEmail: parsed.notifySharedEmail ?? false,
    };
  } catch {
    return { categories: defaultCategories, concepts: defaultConcepts, notifySharedEmail: false };
  }
}

function writeLocal(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
