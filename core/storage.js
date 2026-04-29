import { state } from "./state.js";
import {
  MOVEMENTS_KEY,
  SETTINGS_KEY,
  SHARED_KEY,
  PEOPLE_KEY,
  defaultCategories,
  defaultConcepts,
  seedMovements,
} from "./constants.js";
import {
  cloudPushMovements,
  cloudPushSettings,
  cloudPushPeople,
  cloudPushSharedEntries,
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

function loadPeople() {
  const stored = localStorage.getItem(PEOPLE_KEY);

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

export function initState() {
  state.movements = loadMovements();
  state.settings = loadSettings();
  state.people = loadPeople();
  state.sharedEntries = loadSharedEntries();
}

export function saveMovements() {
  localStorage.setItem(MOVEMENTS_KEY, JSON.stringify(state.movements));
  pushInBackground(cloudPushMovements);
}

export function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  pushInBackground(cloudPushSettings);
}

export function savePeople() {
  localStorage.setItem(PEOPLE_KEY, JSON.stringify(state.people));
  pushInBackground(cloudPushPeople);
}

export function saveSharedEntries() {
  localStorage.setItem(SHARED_KEY, JSON.stringify(state.sharedEntries));
  pushInBackground(cloudPushSharedEntries);
}
