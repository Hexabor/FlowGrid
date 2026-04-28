const MOVEMENTS_KEY = "flowgrid.movements.v1";
const SETTINGS_KEY = "flowgrid.settings.v1";
const APP_LOCALE = "es-ES";

const defaultCategories = [
  { value: "supervivencia", label: "Supervivencia", color: "#b9ddf2", text: "#005f99" },
  { value: "ocio", label: "Ocio", color: "#ffc8a8", text: "#7a3200" },
  { value: "extra", label: "Extra", color: "#f7c4bd", text: "#ab1717" },
  { value: "formacion", label: "Formacion", color: "#d6e5bd", text: "#4f6419" },
  { value: "perdido", label: "Perdido", color: "#d8dce2", text: "#424a54" },
  { value: "ingreso", label: "Ingreso", color: "#dfc0ef", text: "#6b2b87" },
  { value: "ahorro", label: "Ahorro", color: "#c6e4c4", text: "#175c2e" },
];

const defaultConcepts = [
  ["Alquiler", "supervivencia"],
  ["Comer fuera", "supervivencia"],
  ["Compra", "supervivencia"],
  ["Fibra", "supervivencia"],
  ["Higiene y cuidados", "supervivencia"],
  ["Mobiliario/Utensilios", "supervivencia"],
  ["Reparaciones", "supervivencia"],
  ["Ropa", "supervivencia"],
  ["Salud", "supervivencia"],
  ["Suministros", "supervivencia"],
  ["Telefono", "supervivencia"],
  ["Transporte Urbano", "supervivencia"],
  ["Cafeteria/pub", "ocio"],
  ["Contenidos", "ocio"],
  ["Deporte", "ocio"],
  ["Gamer", "ocio"],
  ["Golosinas", "ocio"],
  ["Musica", "ocio"],
  ["Vacaciones", "ocio"],
  ["Viajes", "ocio"],
  ["Coche", "extra"],
  ["Equipos", "extra"],
  ["Oficina", "extra"],
  ["Regalos", "extra"],
  ["Formacion", "formacion"],
  ["Gastos academicos", "formacion"],
  ["IRPF", "extra"],
  ["Perdido", "perdido"],
  ["Salario", "ingreso"],
  ["Recuperados", "extra"],
  ["Renta", "extra"],
  ["Fondos indexados", "ahorro"],
  ["Cuenta remunerada", "ahorro"],
].map(([label, category]) => ({
  id: createSlug(label),
  label,
  category,
}));

const seedMovements = [
  {
    id: "fg-20260308-amazon",
    type: "expense",
    date: "2026-03-08",
    concept: "Contenidos",
    amount: 23.02,
    category: "ocio",
    party: "Amazon Prime",
    recurrence: "anual",
    note: "",
  },
  {
    id: "fg-20260308-higiene",
    type: "expense",
    date: "2026-03-08",
    concept: "Higiene y cuidados",
    amount: 18.9,
    category: "supervivencia",
    party: "Carlos Conde - Islazul",
    recurrence: "",
    note: "Peluqueria",
  },
  {
    id: "fg-20260305-claude",
    type: "expense",
    date: "2026-03-05",
    concept: "Oficina",
    amount: 89.46,
    category: "extra",
    party: "Claude",
    recurrence: "",
    note: "Suscripcion Claude Pro",
  },
  {
    id: "fg-20260301-alquiler",
    type: "expense",
    date: "2026-03-01",
    concept: "Alquiler",
    amount: 698,
    category: "supervivencia",
    party: "",
    recurrence: "mensual",
    note: "",
  },
  {
    id: "fg-20260301-salario",
    type: "income",
    date: "2026-03-01",
    concept: "Salario",
    amount: 1732.99,
    category: "ingreso",
    party: "Cex",
    recurrence: "",
    note: "Nomina febrero 2026",
  },
];

const elements = {
  navButtons: document.querySelectorAll(".nav-button"),
  navigationTargets: document.querySelectorAll("[data-view-target]"),
  views: document.querySelectorAll(".view"),
  form: document.querySelector("#movement-form"),
  type: document.querySelector("#type"),
  date: document.querySelector("#date"),
  dateTrigger: document.querySelector("#date-trigger"),
  datePicker: document.querySelector("#date-picker"),
  datePickerTitle: document.querySelector("#date-picker-title"),
  dateGrid: document.querySelector("#date-grid"),
  prevMonth: document.querySelector("#prev-month"),
  nextMonth: document.querySelector("#next-month"),
  amount: document.querySelector("#amount"),
  concept: document.querySelector("#concept"),
  category: document.querySelector("#category"),
  party: document.querySelector("#party"),
  recurrence: document.querySelector("#recurrence"),
  note: document.querySelector("#note"),
  feedback: document.querySelector("#form-feedback"),
  categoryFilter: document.querySelector("#category-filter"),
  typeFilter: document.querySelector("#type-filter"),
  search: document.querySelector("#search"),
  list: document.querySelector("#movement-list"),
  template: document.querySelector("#movement-template"),
  incomeTotal: document.querySelector("#income-total"),
  expenseTotal: document.querySelector("#expense-total"),
  balanceTotal: document.querySelector("#balance-total"),
  currentPeriod: document.querySelector("#current-period"),
  movementCount: document.querySelector("#movement-count"),
  conceptForm: document.querySelector("#concept-form"),
  categoryForm: document.querySelector("#category-form"),
  newConcept: document.querySelector("#new-concept"),
  newConceptCategory: document.querySelector("#new-concept-category"),
  newCategory: document.querySelector("#new-category"),
  conceptSort: document.querySelector("#concept-sort"),
  conceptGroup: document.querySelector("#concept-group"),
  conceptList: document.querySelector("#concept-list"),
  categoryList: document.querySelector("#category-list"),
  conceptCount: document.querySelector("#concept-count"),
  categoryCount: document.querySelector("#category-count"),
  changelogList: document.querySelector("#changelog-list"),
  changelogCount: document.querySelector("#changelog-count"),
};

let movements = loadMovements();
let settings = loadSettings();
let datePickerMonth = new Date();

function createSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

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

function saveMovements() {
  localStorage.setItem(MOVEMENTS_KEY, JSON.stringify(movements));
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function formatMoney(value) {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `fg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getCategory(value) {
  return settings.categories.find((category) => category.value === value);
}

function getCategoryLabel(value) {
  return getCategory(value)?.label ?? value;
}

function getConcept(value) {
  return settings.concepts.find((concept) => concept.label === value);
}

function getSignedAmount(movement) {
  return movement.type === "income" ? movement.amount : -movement.amount;
}

function getConceptsForType(type) {
  if (type === "income") {
    return settings.concepts.filter((concept) => concept.category === "ingreso");
  }

  return settings.concepts.filter((concept) => concept.category !== "ingreso");
}

function optionMarkup(items, selectedValue = "") {
  return items
    .map((item) => {
      const selected = item.value === selectedValue || item.label === selectedValue ? " selected" : "";
      return `<option value="${item.value ?? item.label}"${selected}>${item.label}</option>`;
    })
    .join("");
}

function syncMovementSelects() {
  const currentConcept = elements.concept.value;
  const concepts = getConceptsForType(elements.type.value);
  const selectedConcept = concepts.some((concept) => concept.label === currentConcept)
    ? currentConcept
    : concepts[0]?.label;

  elements.concept.innerHTML = optionMarkup(concepts, selectedConcept);
  elements.category.innerHTML = optionMarkup(settings.categories, getConcept(selectedConcept)?.category);
  elements.categoryFilter.innerHTML = '<option value="all">Todas</option>' + optionMarkup(settings.categories);
  elements.newConceptCategory.innerHTML = optionMarkup(settings.categories);
  syncCategoryFromConcept();
}

function syncCategoryFromConcept() {
  const concept = getConcept(elements.concept.value);

  if (concept) {
    elements.category.value = concept.category;
  }
}

function getMondayFirstOffset(date) {
  return (date.getDay() + 6) % 7;
}

function setSelectedDate(date) {
  elements.date.value = toIsoDate(date);
  elements.dateTrigger.textContent = formatDate(elements.date.value);
  datePickerMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  renderDatePicker();
}

function setInitialDate() {
  setSelectedDate(new Date());
  elements.currentPeriod.textContent = new Intl.DateTimeFormat(APP_LOCALE, {
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function toggleDatePicker(forceOpen) {
  const shouldOpen = forceOpen ?? elements.datePicker.hidden;
  elements.datePicker.hidden = !shouldOpen;
  elements.dateTrigger.setAttribute("aria-expanded", String(shouldOpen));

  if (shouldOpen) {
    renderDatePicker();
    positionDatePicker();
  }
}

function positionDatePicker() {
  const triggerRect = elements.dateTrigger.getBoundingClientRect();
  const pickerRect = elements.datePicker.getBoundingClientRect();
  const spacing = 6;
  const viewportPadding = 10;
  const availableBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
  const top =
    availableBelow >= pickerRect.height
      ? triggerRect.bottom + spacing
      : Math.max(viewportPadding, triggerRect.top - pickerRect.height - spacing);
  const left = Math.min(
    Math.max(viewportPadding, triggerRect.left),
    window.innerWidth - pickerRect.width - viewportPadding
  );

  elements.datePicker.style.top = `${top}px`;
  elements.datePicker.style.left = `${left}px`;
}

function renderDatePicker() {
  const selectedDate = elements.date.value;
  const today = toIsoDate(new Date());
  const year = datePickerMonth.getFullYear();
  const month = datePickerMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = getMondayFirstOffset(firstDay);

  elements.datePickerTitle.textContent = new Intl.DateTimeFormat(APP_LOCALE, {
    month: "long",
    year: "numeric",
  }).format(datePickerMonth);
  elements.dateGrid.innerHTML = "";

  const fragment = document.createDocumentFragment();

  for (let index = 0; index < offset; index += 1) {
    const spacer = document.createElement("span");
    spacer.className = "date-spacer";
    fragment.append(spacer);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const button = document.createElement("button");
    const date = new Date(year, month, day);
    const isoDate = toIsoDate(date);

    button.type = "button";
    button.className = "date-day";
    button.textContent = String(day);
    button.dataset.date = isoDate;
    button.setAttribute("aria-label", formatDate(isoDate));
    button.classList.toggle("is-selected", isoDate === selectedDate);
    button.classList.toggle("is-today", isoDate === today);
    fragment.append(button);
  }

  elements.dateGrid.append(fragment);
}

function moveDatePickerMonth(step) {
  datePickerMonth = new Date(datePickerMonth.getFullYear(), datePickerMonth.getMonth() + step, 1);
  renderDatePicker();
}

function getFilteredMovements() {
  const query = elements.search.value.trim().toLowerCase();
  const selectedCategory = elements.categoryFilter.value;
  const selectedType = elements.typeFilter.value;

  return movements
    .filter((movement) => selectedType === "all" || movement.type === selectedType)
    .filter((movement) => selectedCategory === "all" || movement.category === selectedCategory)
    .filter((movement) => {
      const haystack = [movement.concept, movement.note, movement.party, getCategoryLabel(movement.category)]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function renderSummary() {
  const income = movements
    .filter((movement) => movement.type === "income")
    .reduce((total, movement) => total + movement.amount, 0);
  const expense = movements
    .filter((movement) => movement.type === "expense")
    .reduce((total, movement) => total + movement.amount, 0);

  elements.incomeTotal.textContent = formatMoney(income);
  elements.expenseTotal.textContent = formatMoney(expense);
  elements.balanceTotal.textContent = formatMoney(income - expense);
}

function paintTag(tag, categoryValue) {
  const category = getCategory(categoryValue);

  tag.textContent = getCategoryLabel(categoryValue);
  tag.style.background = category?.color ?? "#d8e0e4";
  tag.style.color = category?.text ?? "#172026";
}

function createMovementCard(movement, compact = false) {
  const card = elements.template.content.firstElementChild.cloneNode(true);
  const signedAmount = getSignedAmount(movement);
  const recurrence = movement.recurrence || "Puntual";

  card.dataset.id = movement.id;
  card.classList.toggle("is-compact", compact);
  paintTag(card.querySelector(".tag"), movement.category);
  card.querySelector("h3").textContent = movement.concept;
  card.querySelector(".movement-note").textContent = movement.note || "Sin nota";
  card.querySelector(".amount").textContent = formatMoney(signedAmount);
  card.querySelector(".amount").classList.add(movement.type);
  card.querySelector(".date").textContent = formatDate(movement.date);
  card.querySelector(".party").textContent = movement.party || "Sin emisor";
  card.querySelector(".recurrence").textContent = recurrence[0].toUpperCase() + recurrence.slice(1);

  if (compact) {
    card.querySelector(".delete-action").remove();
  }

  return card;
}

function renderMovementList(container, items, compact = false) {
  container.innerHTML = "";

  if (!items.length) {
    container.innerHTML = '<p class="empty-state">No hay movimientos con estos filtros.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((movement) => fragment.append(createMovementCard(movement, compact)));
  container.append(fragment);
}

function renderMovements() {
  const filteredMovements = getFilteredMovements();
  elements.movementCount.textContent = `${filteredMovements.length} movimientos`;
  renderMovementList(elements.list, filteredMovements);
}

function renderConcepts() {
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
    categorySelect.innerHTML = optionMarkup(settings.categories, concept.category);
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

function renderCategories() {
  elements.categoryCount.textContent = `${settings.categories.length} categorias`;
  elements.categoryList.innerHTML = "";

  const fragment = document.createDocumentFragment();

  settings.categories.forEach((category) => {
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

function renderChangelog() {
  const entries = window.FlowGridChangelog ?? [];
  elements.changelogCount.textContent = `${entries.length} sesiones`;
  elements.changelogList.innerHTML = "";

  if (!entries.length) {
    elements.changelogList.innerHTML = '<p class="empty-state">No hay novedades registradas.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  entries.forEach((entry) => {
    const item = document.createElement("article");
    const date = document.createElement("time");
    const title = document.createElement("h3");
    const list = document.createElement("ul");

    item.className = "changelog-item";
    date.dateTime = entry.date;
    date.textContent = formatDate(entry.date);
    title.textContent = entry.title;

    entry.changes.forEach((change) => {
      const listItem = document.createElement("li");
      listItem.textContent = change;
      list.append(listItem);
    });

    item.append(date, title, list);
    fragment.append(item);
  });

  elements.changelogList.append(fragment);
}

function getSortedConcepts() {
  return [...settings.concepts].sort((a, b) => {
    if (elements.conceptSort.value === "category" || elements.conceptGroup.value === "category") {
      const categoryComparison = getCategoryLabel(a.category).localeCompare(getCategoryLabel(b.category));

      if (categoryComparison !== 0) {
        return categoryComparison;
      }
    }

    return a.label.localeCompare(b.label);
  });
}

function render() {
  syncMovementSelects();
  renderSummary();
  renderMovements();
  renderConcepts();
  renderCategories();
  renderChangelog();
}

function createMovement(formData) {
  return {
    id: createId(),
    type: formData.get("type"),
    date: formData.get("date"),
    concept: formData.get("concept"),
    amount: Number(formData.get("amount")),
    category: formData.get("category"),
    party: formData.get("party").trim(),
    recurrence: formData.get("recurrence"),
    note: formData.get("note").trim(),
  };
}

function setView(viewName) {
  elements.views.forEach((view) => view.classList.toggle("is-active", view.dataset.view === viewName));
  elements.navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewTarget === viewName);
  });
}

function createCategory(label) {
  const palette = [
    ["#b9ddf2", "#005f99"],
    ["#ffc8a8", "#7a3200"],
    ["#f7c4bd", "#ab1717"],
    ["#d6e5bd", "#4f6419"],
    ["#dfc0ef", "#6b2b87"],
    ["#c6e4c4", "#175c2e"],
  ];
  const [color, text] = palette[settings.categories.length % palette.length];

  return {
    value: createSlug(label),
    label,
    color,
    text,
  };
}

elements.navigationTargets.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.viewTarget));
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();

  const movement = createMovement(new FormData(elements.form));
  movements = [movement, ...movements];
  saveMovements();
  render();

  elements.form.reset();
  elements.type.value = movement.type;
  setSelectedDate(new Date(`${movement.date}T00:00:00`));
  elements.feedback.textContent = "Movimiento anadido.";
  syncMovementSelects();
  elements.concept.focus();
});

elements.list.addEventListener("click", (event) => {
  const button = event.target.closest(".delete-action");

  if (!button) {
    return;
  }

  const card = button.closest(".movement-card");
  movements = movements.filter((movement) => movement.id !== card.dataset.id);
  saveMovements();
  render();
});

elements.conceptForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const label = elements.newConcept.value.trim();
  const category = elements.newConceptCategory.value;
  const existing = settings.concepts.find((concept) => concept.label.toLowerCase() === label.toLowerCase());

  if (existing) {
    existing.category = category;
  } else {
    settings.concepts.push({ id: createId(), label, category });
  }

  saveSettings();
  elements.conceptForm.reset();
  render();
});

elements.categoryForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const label = elements.newCategory.value.trim();
  const value = createSlug(label);

  if (!settings.categories.some((category) => category.value === value)) {
    settings.categories.push(createCategory(label));
    saveSettings();
  }

  elements.categoryForm.reset();
  render();
});

elements.conceptList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");

  if (!button) {
    return;
  }

  const item = button.closest("[data-concept-id]");
  const concept = settings.concepts.find((candidate) => candidate.id === item.dataset.conceptId);

  if (!concept) {
    return;
  }

  if (button.dataset.action === "delete-concept") {
    settings.concepts = settings.concepts.filter((candidate) => candidate.id !== concept.id);
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
    movements = movements.map((movement) =>
      movement.concept === oldLabel
        ? { ...movement, concept: nextLabel, category: nextCategory }
        : movement
    );
    saveMovements();
  }

  saveSettings();
  render();
});

[elements.search, elements.categoryFilter, elements.typeFilter].forEach((control) => {
  control.addEventListener("input", renderMovements);
});

elements.categoryList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='save-category']");

  if (!button) {
    return;
  }

  const item = button.closest("[data-category-value]");
  const category = settings.categories.find((candidate) => candidate.value === item.dataset.categoryValue);
  const nextLabel = item.querySelector("input").value.trim();

  if (!category || !nextLabel) {
    return;
  }

  category.label = nextLabel;
  saveSettings();
  render();
});

elements.conceptSort.addEventListener("input", renderConcepts);
elements.conceptGroup.addEventListener("input", renderConcepts);
elements.type.addEventListener("change", syncMovementSelects);
elements.concept.addEventListener("change", syncCategoryFromConcept);
elements.dateTrigger.addEventListener("click", () => toggleDatePicker());
elements.prevMonth.addEventListener("click", () => moveDatePickerMonth(-1));
elements.nextMonth.addEventListener("click", () => moveDatePickerMonth(1));
elements.dateGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-date]");

  if (!button) {
    return;
  }

  setSelectedDate(new Date(`${button.dataset.date}T00:00:00`));
  toggleDatePicker(false);
});

document.addEventListener("click", (event) => {
  if (
    elements.datePicker.hidden ||
    elements.datePicker.contains(event.target) ||
    elements.dateTrigger.contains(event.target)
  ) {
    return;
  }

  toggleDatePicker(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    toggleDatePicker(false);
  }
});

window.addEventListener("resize", () => {
  if (!elements.datePicker.hidden) {
    positionDatePicker();
  }
});

window.addEventListener("scroll", () => {
  if (!elements.datePicker.hidden) {
    positionDatePicker();
  }
});

setInitialDate();
render();
