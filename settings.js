import { state } from "./state.js";
import { elements, setSettingsPanel } from "./dom.js";
import { saveMovements, saveSettings } from "./storage.js";
import { createId, createSlug, optionMarkup } from "./utils.js";
import { getCategoryLabel, renderMovements, syncMovementSelects } from "./movements.js";
import { renderAnalysis } from "./analysis.js";

export function getSortedConcepts() {
  return [...state.settings.concepts].sort((a, b) => {
    if (elements.conceptSort.value === "category" || elements.conceptGroup.value === "category") {
      const categoryComparison = getCategoryLabel(a.category).localeCompare(getCategoryLabel(b.category));

      if (categoryComparison !== 0) {
        return categoryComparison;
      }
    }

    return a.label.localeCompare(b.label);
  });
}

export function renderConcepts() {
  const sortedConcepts = getSortedConcepts();
  elements.conceptCount.textContent = `${sortedConcepts.length} conceptos`;
  elements.conceptList.innerHTML = "";

  const fragment = document.createDocumentFragment();
  let currentGroup = "";

  sortedConcepts.forEach((concept) => {
    const groupName = getCategoryLabel(concept.category);

    if (elements.conceptGroup.value === "category" && groupName !== currentGroup) {
      currentGroup = groupName;
      const groupHeader = document.createElement("h3");
      groupHeader.className = "config-group";
      groupHeader.textContent = groupName;
      fragment.append(groupHeader);
    }

    const item = document.createElement("article");
    const name = document.createElement("input");
    const categorySelect = document.createElement("select");
    const saveButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    item.className = "config-item";
    item.dataset.conceptId = concept.id;
    name.value = concept.label;
    name.setAttribute("aria-label", "Concepto");
    categorySelect.setAttribute("aria-label", "Categoria");
    categorySelect.innerHTML = optionMarkup(state.settings.categories, concept.category);
    saveButton.type = "button";
    saveButton.className = "save-action";
    saveButton.dataset.action = "save-concept";
    saveButton.setAttribute("aria-label", `Guardar ${concept.label}`);
    saveButton.title = "Guardar";
    saveButton.textContent = "OK";
    deleteButton.type = "button";
    deleteButton.className = "delete-action";
    deleteButton.dataset.action = "delete-concept";
    deleteButton.setAttribute("aria-label", `Eliminar ${concept.label}`);
    deleteButton.title = "Eliminar";
    deleteButton.textContent = "x";

    item.append(name, categorySelect, saveButton, deleteButton);
    fragment.append(item);
  });

  elements.conceptList.append(fragment);
}

export function renderCategories() {
  elements.categoryCount.textContent = `${state.settings.categories.length} categorias`;
  elements.categoryList.innerHTML = "";

  const fragment = document.createDocumentFragment();

  state.settings.categories.forEach((category) => {
    const item = document.createElement("article");
    const swatch = document.createElement("span");
    const name = document.createElement("input");
    const saveButton = document.createElement("button");

    item.className = "config-item";
    item.dataset.categoryValue = category.value;
    swatch.className = "swatch";
    swatch.style.background = category.color;
    name.value = category.label;
    name.setAttribute("aria-label", "Categoria");
    saveButton.type = "button";
    saveButton.className = "save-action";
    saveButton.dataset.action = "save-category";
    saveButton.setAttribute("aria-label", `Guardar ${category.label}`);
    saveButton.title = "Guardar";
    saveButton.textContent = "OK";

    item.append(name, swatch, saveButton);
    fragment.append(item);
  });

  elements.categoryList.append(fragment);
}

export function createCategory(label) {
  const palette = [
    ["#b9ddf2", "#005f99"],
    ["#ffc8a8", "#7a3200"],
    ["#f7c4bd", "#ab1717"],
    ["#d6e5bd", "#4f6419"],
    ["#dfc0ef", "#6b2b87"],
    ["#c6e4c4", "#175c2e"],
  ];
  const [color, text] = palette[state.settings.categories.length % palette.length];

  return {
    value: createSlug(label),
    label,
    color,
    text,
  };
}

export function normalizeCategory(value) {
  const normalized = createSlug(value || "extra");
  const knownCategory = state.settings.categories.find((category) => category.value === normalized);

  if (knownCategory) {
    return knownCategory.value;
  }

  return normalized;
}

elements.conceptForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const label = elements.newConcept.value.trim();
  const category = elements.newConceptCategory.value;
  const existing = state.settings.concepts.find((concept) => concept.label.toLowerCase() === label.toLowerCase());

  if (existing) {
    existing.category = category;
  } else {
    state.settings.concepts.push({ id: createId(), label, category });
  }

  saveSettings();
  elements.conceptForm.reset();
  syncMovementSelects();
  renderConcepts();
});

elements.categoryForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const label = elements.newCategory.value.trim();
  const value = createSlug(label);

  if (!state.settings.categories.some((category) => category.value === value)) {
    state.settings.categories.push(createCategory(label));
    saveSettings();
  }

  elements.categoryForm.reset();
  syncMovementSelects();
  renderCategories();
});

elements.conceptList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");

  if (!button) {
    return;
  }

  const item = button.closest("[data-concept-id]");
  const concept = state.settings.concepts.find((candidate) => candidate.id === item.dataset.conceptId);

  if (!concept) {
    return;
  }

  if (button.dataset.action === "delete-concept") {
    state.settings.concepts = state.settings.concepts.filter((candidate) => candidate.id !== concept.id);
  }

  if (button.dataset.action === "save-concept") {
    const oldLabel = concept.label;
    const nextLabel = item.querySelector("input").value.trim();
    const nextCategory = item.querySelector("select").value;

    if (!nextLabel) {
      return;
    }

    concept.label = nextLabel;
    concept.category = nextCategory;
    state.movements = state.movements.map((movement) =>
      movement.concept === oldLabel
        ? { ...movement, concept: nextLabel, category: nextCategory }
        : movement
    );
    saveMovements();
  }

  saveSettings();
  syncMovementSelects();
  renderConcepts();
  renderMovements();
  renderAnalysis();
});

elements.categoryList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='save-category']");

  if (!button) {
    return;
  }

  const item = button.closest("[data-category-value]");
  const category = state.settings.categories.find((candidate) => candidate.value === item.dataset.categoryValue);
  const nextLabel = item.querySelector("input").value.trim();

  if (!category || !nextLabel) {
    return;
  }

  category.label = nextLabel;
  saveSettings();
  syncMovementSelects();
  renderCategories();
  renderMovements();
  renderAnalysis();
});

elements.conceptSort.addEventListener("input", renderConcepts);
elements.conceptGroup.addEventListener("input", renderConcepts);

elements.settingsTabs.forEach((button) => {
  button.addEventListener("click", () => setSettingsPanel(button.dataset.settingsTarget));
});
