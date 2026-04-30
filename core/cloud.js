// Cloud sync layer. Uses raw fetch against the Supabase REST endpoint instead
// of going through supabase-js's PostgrestClient: we hit a hang in the
// library's internal auth/lock mechanism that wasn't fixable by overriding
// `lock` or pinning the version. Auth (login, session) still uses supabase-js
// because that side worked fine; only the data plane is bypassed.

import { state } from "./state.js";
import { getUserId, getAccessToken } from "./supabase.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import {
  MOVEMENTS_KEY,
  SETTINGS_KEY,
  CONTACTS_KEY,
  SHARED_KEY,
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
  };
}

function contactToCloud(c, ownerId) {
  return {
    id: c.id,
    owner_id: ownerId,
    name: c.name,
    email: c.email ?? "",
    invited_at: c.invitedAt ?? null,
    created_at: c.createdAt ?? new Date().toISOString(),
  };
}

function contactFromCloud(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? "",
    invitedAt: row.invited_at ?? null,
    createdAt: row.created_at,
  };
}

function sharedToCloud(e, ownerId) {
  return {
    id: e.id,
    owner_id: ownerId,
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
    created_at: e.createdAt ?? new Date().toISOString(),
  };
}

function sharedFromCloud(row) {
  return {
    id: row.id,
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
    createdAt: row.created_at,
  };
}

// ---- raw REST helpers ----

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

async function restUpsert(table, rows, conflictColumn = "id") {
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictColumn}`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${table} failed: ${res.status} ${await res.text()}`);
}

async function restDelete(table, ids) {
  if (!ids.length) return;
  const inList = ids.map((id) => `"${encodeURIComponent(id)}"`).join(",");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=in.(${inList})`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`delete ${table} failed: ${res.status} ${await res.text()}`);
}

// ---- push (full-snapshot diff: delete extras + upsert all) ----

// Supabase truncates GET responses to a project-wide max (1000 rows by
// default) without flagging the truncation. We always pass an explicit limit
// well above any realistic personal-finance dataset so silent data loss
// can't happen during hydrate or sync diffing.
const ROW_LIMIT = 50000;

async function syncTable(table, ownerId, localRows, toCloud) {
  const existing = await restGet(`${table}?owner_id=eq.${ownerId}&select=id&limit=${ROW_LIMIT}`);
  const localIds = new Set(localRows.map((r) => r.id));
  const toDelete = existing.map((r) => r.id).filter((id) => !localIds.has(id));
  await restDelete(table, toDelete);
  if (localRows.length) {
    await restUpsert(table, localRows.map((r) => toCloud(r, ownerId)));
  }
}

export async function cloudPushMovements() {
  const ownerId = await getUserId();
  if (!ownerId) return;
  await syncTable("movements", ownerId, state.movements, movementToCloud);
}

export async function cloudPushContacts() {
  const ownerId = await getUserId();
  if (!ownerId) return;
  await syncTable("contacts", ownerId, state.contacts, contactToCloud);
}

export async function cloudPushSharedEntries() {
  const ownerId = await getUserId();
  if (!ownerId) return;
  await syncTable("shared_entries", ownerId, state.sharedEntries, sharedToCloud);
}

export async function cloudPushSettings() {
  const ownerId = await getUserId();
  if (!ownerId) return;
  await restUpsert(
    "settings",
    [{
      owner_id: ownerId,
      categories: state.settings.categories,
      concepts: state.settings.concepts,
    }],
    "owner_id"
  );
}

export async function cloudPushAll() {
  await Promise.all([
    cloudPushMovements(),
    cloudPushContacts(),
    cloudPushSharedEntries(),
    cloudPushSettings(),
  ]);
}

// ---- hydrate (cloud is authoritative; first login pushes local seed up) ----

export async function cloudHydrate() {
  const ownerId = await getUserId();
  if (!ownerId) return;

  const [movementsData, settingsData, contactsData, sharedData] = await Promise.all([
    restGet(`movements?owner_id=eq.${ownerId}&select=*&limit=${ROW_LIMIT}`),
    restGet(`settings?owner_id=eq.${ownerId}&select=*&limit=${ROW_LIMIT}`),
    restGet(`contacts?owner_id=eq.${ownerId}&select=*&limit=${ROW_LIMIT}`),
    restGet(`shared_entries?owner_id=eq.${ownerId}&select=*&limit=${ROW_LIMIT}`),
  ]);

  const settingsRow = settingsData[0] ?? null;
  const cloudIsEmpty =
    !movementsData.length &&
    !contactsData.length &&
    !sharedData.length &&
    !settingsRow;

  if (cloudIsEmpty) {
    // First login on this account: seed the cloud with whatever is in localStorage
    // (or with the demo defaults if localStorage is also empty).
    const localMovements = readLocalArray(MOVEMENTS_KEY) ?? seedMovements;
    const localContacts = readLocalArray(CONTACTS_KEY) ?? [];
    const localShared = readLocalArray(SHARED_KEY) ?? [];
    const localSettings = readLocalSettings();

    state.movements = localMovements;
    state.contacts = localContacts;
    state.sharedEntries = localShared;
    state.settings = localSettings;

    writeLocal(MOVEMENTS_KEY, state.movements);
    writeLocal(CONTACTS_KEY, state.contacts);
    writeLocal(SHARED_KEY, state.sharedEntries);
    writeLocal(SETTINGS_KEY, state.settings);

    await cloudPushAll();
    return;
  }

  // Cloud is authoritative: replace local snapshot with what's in the cloud.
  state.movements = movementsData.map(movementFromCloud);
  state.contacts = contactsData.map(contactFromCloud);
  state.sharedEntries = sharedData.map(sharedFromCloud);
  state.settings = settingsRow
    ? {
        categories: settingsRow.categories?.length ? settingsRow.categories : defaultCategories,
        concepts: settingsRow.concepts?.length ? settingsRow.concepts : defaultConcepts,
      }
    : { categories: defaultCategories, concepts: defaultConcepts };

  // One-shot migration (2026-05-01): "Recuperados" moved from category
  // "extra" to "ingreso". Idempotent; runs only on accounts that still have
  // the old mapping. Pushes the corrected settings back to cloud once.
  let settingsMigrated = false;
  for (const concept of state.settings.concepts) {
    if (concept.label === "Recuperados" && concept.category === "extra") {
      concept.category = "ingreso";
      settingsMigrated = true;
    }
  }

  writeLocal(MOVEMENTS_KEY, state.movements);
  writeLocal(CONTACTS_KEY, state.contacts);
  writeLocal(SHARED_KEY, state.sharedEntries);
  writeLocal(SETTINGS_KEY, state.settings);

  if (settingsMigrated) {
    await cloudPushSettings();
  }
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
  if (!raw) return { categories: defaultCategories, concepts: defaultConcepts };
  try {
    const parsed = JSON.parse(raw);
    return {
      categories: parsed.categories?.length ? parsed.categories : defaultCategories,
      concepts: parsed.concepts?.length ? parsed.concepts : defaultConcepts,
    };
  } catch {
    return { categories: defaultCategories, concepts: defaultConcepts };
  }
}

function writeLocal(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---- background push (fire-and-forget, errors logged) ----

export function pushInBackground(fn) {
  Promise.resolve()
    .then(fn)
    .catch((err) => console.error("[cloud sync]", err));
}
