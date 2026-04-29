import { state } from "../core/state.js";
import { elements } from "../core/dom.js";
import { savePeople } from "../core/storage.js";
import { createId } from "../core/utils.js";
import { entryBalanceImpact, renderSharedView, syncSharedPersonOptions, syncSharedModeLabels } from "./shared.js";

export function getPerson(id) {
  return state.people.find((person) => person.id === id);
}

export function getPersonName(id) {
  return getPerson(id)?.name ?? "Persona";
}

export function personHasEntries(id) {
  return state.sharedEntries.some((entry) => entry.personId === id);
}

export function getSharedBalance(personId) {
  return state.sharedEntries
    .filter((entry) => entry.personId === personId)
    .reduce((balance, entry) => balance + entryBalanceImpact(entry), 0);
}

export function renderPeople() {
  elements.peopleCount.textContent = `${state.people.length} personas`;
  elements.peopleList.innerHTML = "";

  if (!state.people.length) {
    elements.peopleList.innerHTML = '<p class="empty-state">Aun no hay personas. Anade la primera arriba.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  state.people.forEach((person) => {
    const item = document.createElement("article");
    const name = document.createElement("input");
    const saveButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    item.className = "config-item";
    item.dataset.personId = person.id;
    name.value = person.name;
    name.setAttribute("aria-label", "Nombre de la persona");
    saveButton.type = "button";
    saveButton.className = "save-action";
    saveButton.dataset.action = "save-person";
    saveButton.title = "Guardar";
    saveButton.textContent = "OK";
    deleteButton.type = "button";
    deleteButton.className = "delete-action";
    deleteButton.dataset.action = "delete-person";
    deleteButton.title = personHasEntries(person.id)
      ? "No se puede eliminar (tiene entradas)"
      : "Eliminar";
    deleteButton.textContent = "x";
    deleteButton.disabled = personHasEntries(person.id);

    item.append(name, saveButton, deleteButton);
    fragment.append(item);
  });

  elements.peopleList.append(fragment);
}

elements.peopleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = elements.newPersonName.value.trim();

  if (!name) {
    return;
  }

  const existing = state.people.find((person) => person.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    elements.peopleForm.reset();
    return;
  }

  state.people = [
    ...state.people,
    { id: createId(), name, email: "", invitedAt: null, createdAt: new Date().toISOString() },
  ];
  savePeople();
  elements.peopleForm.reset();
  renderPeople();
  renderSharedView();
});

elements.peopleList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");

  if (!button) {
    return;
  }

  const item = button.closest("[data-person-id]");
  const person = state.people.find((candidate) => candidate.id === item.dataset.personId);

  if (!person) {
    return;
  }

  if (button.dataset.action === "save-person") {
    const nextName = item.querySelector("input").value.trim();
    if (!nextName || nextName === person.name) {
      return;
    }
    person.name = nextName;
    savePeople();
    renderPeople();
    renderSharedView();
    syncSharedPersonOptions();
    syncSharedModeLabels();
    return;
  }

  if (button.dataset.action === "delete-person") {
    if (personHasEntries(person.id)) {
      alert(`No puedes borrar a ${person.name}: tiene entradas en Compartidos.`);
      return;
    }
    if (!confirm(`Eliminar a ${person.name}?`)) {
      return;
    }
    state.people = state.people.filter((candidate) => candidate.id !== person.id);
    savePeople();
    renderPeople();
    renderSharedView();
    syncSharedPersonOptions();
  }
});
