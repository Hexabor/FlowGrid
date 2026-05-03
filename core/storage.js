import { state } from "./state.js";
import {
  MOVEMENTS_KEY,
  SETTINGS_KEY,
  SHARED_KEY,
  CONTACTS_KEY,
  RECURRING_TEMPLATES_KEY,
  GROUPS_KEY,
  GROUP_MEMBERS_KEY,
  LEGACY_PEOPLE_KEY,
  defaultCategories,
  defaultConcepts,
  seedMovements,
} from "./constants.js";
import {
  cloudPushMovements,
  cloudPushSettings,
  cloudPushContacts,
  cloudPushSharedEntries,
  cloudPushRecurringTemplates,
  cloudPushGroups,
  cloudPushGroupMembers,
  pushInBackground,
} from "./cloud.js";

function loadMovements() {
  const stored = localStorage.getItem(MOVEMENTS_KEY);

  if (!stored) {
    return seedMovements;
  }

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : seedMovements;
  } catch {
    return seedMovements;
  }
}

function loadSettings() {
  const stored = localStorage.getItem(SETTINGS_KEY);

  if (!stored) {
    return {
      categories: defaultCategories,
      concepts: defaultConcepts,
    };
  }

  try {
    const parsed = JSON.parse(stored);
    return {
      categories: parsed.categories?.length ? parsed.categories : defaultCategories,
      concepts: parsed.concepts?.length ? parsed.concepts : defaultConcepts,
    };
  } catch {
    return {
      categories: defaultCategories,
      concepts: defaultConcepts,
    };
  }
}

function loadSharedEntries() {
  const stored = localStorage.getItem(SHARED_KEY);

  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadRecurringTemplates() {
  const stored = localStorage.getItem(RECURRING_TEMPLATES_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadGroups() {
  const stored = localStorage.getItem(GROUPS_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadGroupMembers() {
  const stored = localStorage.getItem(GROUP_MEMBERS_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadContacts() {
  const stored = localStorage.getItem(CONTACTS_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  // One-time migration from the legacy key. If found, copy to the new key
  // and remove the legacy entry so this only happens once per device.
  const legacy = localStorage.getItem(LEGACY_PEOPLE_KEY);
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed)) {
        localStorage.setItem(CONTACTS_KEY, legacy);
        localStorage.removeItem(LEGACY_PEOPLE_KEY);
        return parsed;
      }
    } catch {
      // fall through
    }
  }
  return [];
}

export function initState() {
  state.movements = loadMovements();
  state.settings = loadSettings();
  state.contacts = loadContacts();
  state.sharedEntries = loadSharedEntries();
  state.recurringTemplates = loadRecurringTemplates();
  state.groups = loadGroups();
  state.groupMembers = loadGroupMembers();
}

export function saveMovements() {
  localStorage.setItem(MOVEMENTS_KEY, JSON.stringify(state.movements));
  pushInBackground(cloudPushMovements);
}

export function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  pushInBackground(cloudPushSettings);
}

export function saveContacts() {
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(state.contacts));
  pushInBackground(cloudPushContacts);
}

export function saveSharedEntries() {
  localStorage.setItem(SHARED_KEY, JSON.stringify(state.sharedEntries));
  pushInBackground(cloudPushSharedEntries);
}

export function saveRecurringTemplates() {
  localStorage.setItem(RECURRING_TEMPLATES_KEY, JSON.stringify(state.recurringTemplates));
  pushInBackground(cloudPushRecurringTemplates);
}

export function saveGroups() {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(state.groups));
  pushInBackground(cloudPushGroups);
}

export function saveGroupMembers() {
  localStorage.setItem(GROUP_MEMBERS_KEY, JSON.stringify(state.groupMembers));
  pushInBackground(cloudPushGroupMembers);
}
