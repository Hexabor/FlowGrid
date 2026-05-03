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
  RECURRING_TEMPLATES_KEY,
  GROUPS_KEY,
  GROUP_MEMBERS_KEY,
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
    settled_at: e.settledAt ?? null,
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
    settledAt: row.settled_at ?? null,
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

  // Diff-delete is scoped to MY entries: the cloud GET filters owner_id =
  // me, so partner-owned entries (visible to me via RLS) are excluded
  // from the deletion candidate set and can't be wiped by my push when
  // they sit normally in my local state. localIds here is restricted to
  // my-owned entries too, so the diff stays apples-to-apples.
  const myEntries = state.sharedEntries.filter(
    (e) => (e.ownerId ?? ownerId) === ownerId
  );
  const existing = await restGet(
    `shared_entries?owner_id=eq.${ownerId}&select=id&limit=${ROW_LIMIT}`
  );
  const localIds = new Set(myEntries.map((e) => e.id));
  const toDelete = existing.map((r) => r.id).filter((id) => !localIds.has(id));
  await restDelete("shared_entries", toDelete);

  // Upsert ALL local entries (mine + linked-partner edits). The mapper
  // preserves each entry's original owner_id; the RLS WITH CHECK clause
  // accepts both the owner case and the linked-partner case, so partner
  // edits get persisted under the partner's owner_id intact.
  if (state.sharedEntries.length) {
    await restUpsert(
      "shared_entries",
      state.sharedEntries.map((e) => sharedToCloud(e, ownerId))
    );
  }
}

export async function cloudPushRecurringTemplates() {
  const ownerId = await getUserId();
  if (!ownerId) return;
  await syncTable("recurring_templates", ownerId, state.recurringTemplates, recurringTemplateToCloud);
}

// Solo empujamos los grupos donde YO soy el owner (admin). Los grupos
// ajenos en los que soy miembro vienen del hydrate pero no los sincroniza
// mi cliente: los gestiona su propio admin. La función filtra el state
// local por ownerId === me antes de hacer la diff-delete.
export async function cloudPushGroups() {
  const ownerId = await getUserId();
  if (!ownerId) return;
  const myGroups = state.groups.filter(
    (g) => (g.ownerId ?? ownerId) === ownerId
  );
  await syncTable("groups", ownerId, myGroups, groupToCloud);
}

// group_members tiene una asimetría: solo el admin del grupo puede
// añadir/quitar miembros (RLS lo refleja). El cliente del admin empuja
// todos los miembros de SUS grupos. Los miembros ajenos solo pueden
// modificar su propia fila (UPDATE de left_at para abandonar) — eso lo
// hacen vía un REST call directo, no por sync masivo.
export async function cloudPushGroupMembers() {
  const ownerId = await getUserId();
  if (!ownerId) return;
  const myGroupIds = new Set(
    state.groups
      .filter((g) => (g.ownerId ?? ownerId) === ownerId)
      .map((g) => g.id)
  );
  const myMembers = state.groupMembers.filter((m) => myGroupIds.has(m.groupId));

  // Diff-delete restringida a los miembros de mis grupos para no tocar
  // los miembros de grupos ajenos (RLS los protege igualmente, pero un
  // ?id=in.(...) con ids ajenos generaría errores ruidosos).
  if (!myGroupIds.size) {
    return;
  }
  const groupIdsParam = [...myGroupIds]
    .map((id) => `"${encodeURIComponent(id)}"`)
    .join(",");
  const existing = await restGet(
    `group_members?group_id=in.(${groupIdsParam})&select=id&limit=${ROW_LIMIT}`
  );
  const localIds = new Set(myMembers.map((m) => m.id));
  const toDelete = existing.map((r) => r.id).filter((id) => !localIds.has(id));
  await restDelete("group_members", toDelete);
  if (myMembers.length) {
    await restUpsert("group_members", myMembers.map(groupMemberToCloud));
  }
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
  // Orden importante: groups antes que group_members (FK constraint),
  // y groups antes que recurring_templates / shared_entries para que
  // sus group_id tengan referencia válida en el cloud.
  await cloudPushGroups();
  await Promise.all([
    cloudPushMovements(),
    cloudPushContacts(),
    cloudPushSharedEntries(),
    cloudPushRecurringTemplates(),
    cloudPushGroupMembers(),
    cloudPushSettings(),
  ]);
}

// ---- hydrate (cloud is authoritative; first login pushes local seed up) ----

export async function cloudHydrate() {
  const ownerId = await getUserId();
  if (!ownerId) return;

  const [movementsData, settingsData, contactsData, sharedData, templatesData, groupsData, groupMembersData] = await Promise.all([
    restGet(`movements?owner_id=eq.${ownerId}&select=*&limit=${ROW_LIMIT}`),
    restGet(`settings?owner_id=eq.${ownerId}&select=*&limit=${ROW_LIMIT}`),
    restGet(`contacts?owner_id=eq.${ownerId}&select=*&limit=${ROW_LIMIT}`),
    // shared_entries: NO owner_id filter — RLS already returns my own
    // entries plus those owned by linked partners (contacts where the
    // partner has set me as auth_user_id). We hydrate them as a single
    // pool keyed by ownerId so the UI can display them seamlessly.
    restGet(`shared_entries?select=*&limit=${ROW_LIMIT}`),
    restGet(`recurring_templates?owner_id=eq.${ownerId}&select=*&limit=${ROW_LIMIT}`),
    // groups y group_members: SIN filtro de owner_id. RLS devuelve los
    // grupos donde soy admin O miembro activo, y los miembros de esos
    // grupos. La UI los rendea sin distinguir: para el usuario es lo
    // mismo "mi grupo Casa" que "el grupo Casa de Juan donde estoy".
    restGet(`groups?select=*&limit=${ROW_LIMIT}`),
    restGet(`group_members?select=*&limit=${ROW_LIMIT}`),
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

    await cloudPushAll();
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
      }
    : { categories: defaultCategories, concepts: defaultConcepts };

  // One-shot migration (2026-05-01): "Recuperados" moved from category
  // "extra" to "ingreso". Idempotent; runs only on accounts that still have
  // the old mapping.
  let settingsMigrated = false;
  let movementsMigrated = false;
  for (const concept of state.settings.concepts) {
    if (concept.label === "Recuperados" && concept.category === "extra") {
      concept.category = "ingreso";
      settingsMigrated = true;
    }
  }

  // One-shot migration: collapse accent / case duplicates among concepts
  // (e.g. "Cafeteria/pub" + "Cafetería/pub"). The variant with the most
  // associated movements wins; the loser's movements are re-pointed to
  // the winner and the loser concept is removed from the catalogue.
  const conceptMerge = mergeAccentDuplicates(state.settings.concepts, state.movements);
  if (conceptMerge.changed) {
    settingsMigrated = true;
    if (conceptMerge.movementsTouched) movementsMigrated = true;
  }

  // Defensa: asegurar que soy miembro activo de todos los grupos que
  // tengo en propiedad (admin). Cubre el caso legacy de grupos creados
  // antes de que el auto-add del creador estuviera bien cableado, o
  // grupos donde mi member row se perdió en algún sync.
  const groupMembersTouched = ensureOwnerIsMemberOfOwnGroups(ownerId);

  writeLocal(MOVEMENTS_KEY, state.movements);
  writeLocal(CONTACTS_KEY, state.contacts);
  writeLocal(SHARED_KEY, state.sharedEntries);
  writeLocal(RECURRING_TEMPLATES_KEY, state.recurringTemplates);
  writeLocal(GROUPS_KEY, state.groups);
  writeLocal(GROUP_MEMBERS_KEY, state.groupMembers);
  writeLocal(SETTINGS_KEY, state.settings);

  if (settingsMigrated) {
    await cloudPushSettings();
  }
  if (movementsMigrated) {
    await cloudPushMovements();
  }
  if (groupMembersTouched) {
    await cloudPushGroupMembers();
  }
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
