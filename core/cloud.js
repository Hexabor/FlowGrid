import { state } from "./state.js";
import { supabase, getUserId } from "./supabase.js";
import {
  MOVEMENTS_KEY,
  SETTINGS_KEY,
  PEOPLE_KEY,
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

function personToCloud(p, ownerId) {
  return {
    id: p.id,
    owner_id: ownerId,
    name: p.name,
    email: p.email ?? "",
    invited_at: p.invitedAt ?? null,
    created_at: p.createdAt ?? new Date().toISOString(),
  };
}

function personFromCloud(row) {
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
    person_id: e.personId,
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
    personId: row.person_id,
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

// ---- push (full-snapshot diff: delete extras + upsert all) ----

async function syncTable(table, ownerId, localRows, toCloud) {
  const { data: existing, error: selErr } = await supabase
    .from(table)
    .select("id")
    .eq("owner_id", ownerId);
  if (selErr) throw selErr;

  const localIds = new Set(localRows.map((r) => r.id));
  const toDelete = (existing ?? []).map((r) => r.id).filter((id) => !localIds.has(id));

  if (toDelete.length) {
    const { error } = await supabase.from(table).delete().in("id", toDelete);
    if (error) throw error;
  }

  if (localRows.length) {
    const payload = localRows.map((r) => toCloud(r, ownerId));
    const { error } = await supabase.from(table).upsert(payload, { onConflict: "id" });
    if (error) throw error;
  }
}

export async function cloudPushMovements() {
  const ownerId = await getUserId();
  if (!ownerId) return;
  await syncTable("movements", ownerId, state.movements, movementToCloud);
}

export async function cloudPushPeople() {
  const ownerId = await getUserId();
  if (!ownerId) return;
  await syncTable("people", ownerId, state.people, personToCloud);
}

export async function cloudPushSharedEntries() {
  const ownerId = await getUserId();
  if (!ownerId) return;
  await syncTable("shared_entries", ownerId, state.sharedEntries, sharedToCloud);
}

export async function cloudPushSettings() {
  const ownerId = await getUserId();
  if (!ownerId) return;
  const { error } = await supabase.from("settings").upsert(
    {
      owner_id: ownerId,
      categories: state.settings.categories,
      concepts: state.settings.concepts,
    },
    { onConflict: "owner_id" }
  );
  if (error) throw error;
}

export async function cloudPushAll() {
  await Promise.all([
    cloudPushMovements(),
    cloudPushPeople(),
    cloudPushSharedEntries(),
    cloudPushSettings(),
  ]);
}

// ---- hydrate (cloud is authoritative; first login pushes local seed up) ----

export async function cloudHydrate() {
  console.log("[cloud hydrate] start");
  const ownerId = await getUserId();
  console.log("[cloud hydrate] ownerId:", ownerId);
  if (!ownerId) return;

  console.log("[cloud hydrate] firing queries");
  const [movementsRes, settingsRes, peopleRes, sharedRes] = await Promise.all([
    supabase.from("movements").select("*").eq("owner_id", ownerId),
    supabase.from("settings").select("*").eq("owner_id", ownerId).maybeSingle(),
    supabase.from("people").select("*").eq("owner_id", ownerId),
    supabase.from("shared_entries").select("*").eq("owner_id", ownerId),
  ]);
  console.log("[cloud hydrate] queries done", {
    movements: movementsRes.data?.length,
    people: peopleRes.data?.length,
    shared: sharedRes.data?.length,
    hasSettings: !!settingsRes.data,
  });

  for (const res of [movementsRes, settingsRes, peopleRes, sharedRes]) {
    if (res.error) throw res.error;
  }

  const cloudIsEmpty =
    !movementsRes.data?.length &&
    !peopleRes.data?.length &&
    !sharedRes.data?.length &&
    !settingsRes.data;

  if (cloudIsEmpty) {
    // First login on this account: seed the cloud with whatever is in localStorage
    // (or with the demo defaults if localStorage is also empty).
    const localMovements = readLocalArray(MOVEMENTS_KEY) ?? seedMovements;
    const localPeople = readLocalArray(PEOPLE_KEY) ?? [];
    const localShared = readLocalArray(SHARED_KEY) ?? [];
    const localSettings = readLocalSettings();

    state.movements = localMovements;
    state.people = localPeople;
    state.sharedEntries = localShared;
    state.settings = localSettings;

    writeLocal(MOVEMENTS_KEY, state.movements);
    writeLocal(PEOPLE_KEY, state.people);
    writeLocal(SHARED_KEY, state.sharedEntries);
    writeLocal(SETTINGS_KEY, state.settings);

    await cloudPushAll();
    return;
  }

  // Cloud is authoritative: replace local snapshot with what's in the cloud.
  const cloudMovements = (movementsRes.data ?? []).map(movementFromCloud);
  const cloudPeople = (peopleRes.data ?? []).map(personFromCloud);
  const cloudShared = (sharedRes.data ?? []).map(sharedFromCloud);
  const cloudSettings = settingsRes.data
    ? {
        categories: settingsRes.data.categories?.length ? settingsRes.data.categories : defaultCategories,
        concepts: settingsRes.data.concepts?.length ? settingsRes.data.concepts : defaultConcepts,
      }
    : { categories: defaultCategories, concepts: defaultConcepts };

  state.movements = cloudMovements;
  state.people = cloudPeople;
  state.sharedEntries = cloudShared;
  state.settings = cloudSettings;

  writeLocal(MOVEMENTS_KEY, state.movements);
  writeLocal(PEOPLE_KEY, state.people);
  writeLocal(SHARED_KEY, state.sharedEntries);
  writeLocal(SETTINGS_KEY, state.settings);
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
