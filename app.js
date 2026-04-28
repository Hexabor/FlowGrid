const MOVEMENTS_KEY = "flowgrid.movements.v1";
const SETTINGS_KEY = "flowgrid.settings.v1";
const SHARED_KEY = "flowgrid.shared.v2";
const PEOPLE_KEY = "flowgrid.people.v1";
const APP_LOCALE = "es-ES";

const SHARED_MODES = {
  "me-equal": { paidBy: "me", split: "equal", label: "Tu pagaste, partes iguales" },
  "me-uneven": { paidBy: "me", split: "uneven", label: "Tu pagaste, partes desiguales" },
  "me-full": { paidBy: "me", split: "full", label: "Se te debe la cantidad total" },
  "them-equal": { paidBy: "them", split: "equal", label: "{name} pago, partes iguales" },
  "them-uneven": { paidBy: "them", split: "uneven", label: "{name} pago, partes desiguales" },
  "them-full": { paidBy: "them", split: "full", label: "A {name} le debes la cantidad total" },
};

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
    id: "demo-cafe",
    type: "expense",
    date: "2026-04-22",
    concept: "Cafeteria/pub",
    amount: 4.5,
    category: "ocio",
    party: "Cafeteria del barrio",
    recurrence: "",
    note: "Cafe y croissant",
  },
  {
    id: "demo-compra",
    type: "expense",
    date: "2026-04-18",
    concept: "Compra",
    amount: 62.3,
    category: "supervivencia",
    party: "Supermercado",
    recurrence: "",
    note: "",
  },
  {
    id: "demo-suministros",
    type: "expense",
    date: "2026-04-15",
    concept: "Suministros",
    amount: 48.2,
    category: "supervivencia",
    party: "Compania electrica",
    recurrence: "mensual",
    note: "Factura del mes",
  },
  {
    id: "demo-streaming",
    type: "expense",
    date: "2026-04-05",
    concept: "Contenidos",
    amount: 9.99,
    category: "ocio",
    party: "Plataforma de streaming",
    recurrence: "mensual",
    note: "",
  },
  {
    id: "demo-alquiler",
    type: "expense",
    date: "2026-04-01",
    concept: "Alquiler",
    amount: 650,
    category: "supervivencia",
    party: "",
    recurrence: "mensual",
    note: "",
  },
  {
    id: "demo-salario",
    type: "income",
    date: "2026-04-01",
    concept: "Salario",
    amount: 1850,
    category: "ingreso",
    party: "Empresa Ejemplo",
    recurrence: "mensual",
    note: "Nomina mensual",
  },
];

const elements = {
  navButtons: document.querySelectorAll(".nav-button"),
  navigationTargets: document.querySelectorAll("[data-view-target]"),
  views: document.querySelectorAll(".view"),
  form: document.querySelector("#movement-form"),
  movementModal: document.querySelector("#movement-modal"),
  openMovementModal: document.querySelector("#open-movement-modal"),
  closeMovementModal: document.querySelector("#close-movement-modal"),
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
  isShared: document.querySelector("#is-shared"),
  sharedFields: document.querySelector("#shared-fields"),
  sharedPerson: document.querySelector("#shared-person"),
  sharedPersonAdd: document.querySelector("#shared-person-add"),
  sharedMode: document.querySelector("#shared-mode"),
  sharedUneven: document.querySelector("#shared-uneven"),
  sharedMyShare: document.querySelector("#shared-my-share"),
  sharedTheirShare: document.querySelector("#shared-their-share"),
  sharedTheirShareLabel: document.querySelector("#shared-their-share-label"),
  sharedUnevenFeedback: document.querySelector("#shared-uneven-feedback"),
  feedback: document.querySelector("#form-feedback"),
  submitButton: document.querySelector("#movement-form .primary-action"),
  categoryFilter: document.querySelector("#category-filter"),
  typeFilter: document.querySelector("#type-filter"),
  search: document.querySelector("#search"),
  list: document.querySelector("#movement-list"),
  template: document.querySelector("#movement-template"),
  currentPeriod: document.querySelector("#current-period"),
  movementCount: document.querySelector("#movement-count"),
  monthPeriodLabel: document.querySelector("#month-period-label"),
  monthIncomeTotal: document.querySelector("#month-income-total"),
  monthExpenseTotal: document.querySelector("#month-expense-total"),
  monthBalanceTotal: document.querySelector("#month-balance-total"),
  monthConceptBreakdown: document.querySelector("#month-concept-breakdown"),
  monthCategoryBreakdown: document.querySelector("#month-category-breakdown"),
  yearPeriodLabel: document.querySelector("#year-period-label"),
  yearIncomeTotal: document.querySelector("#year-income-total"),
  yearExpenseTotal: document.querySelector("#year-expense-total"),
  yearBalanceTotal: document.querySelector("#year-balance-total"),
  yearConceptBreakdown: document.querySelector("#year-concept-breakdown"),
  yearCategoryBreakdown: document.querySelector("#year-category-breakdown"),
  sharedBalances: document.querySelector("#shared-balances"),
  sharedPeopleCount: document.querySelector("#shared-people-count"),
  sharedPersonFilter: document.querySelector("#shared-person-filter"),
  sharedEntries: document.querySelector("#shared-entries"),
  paymentModal: document.querySelector("#payment-modal"),
  closePaymentModal: document.querySelector("#close-payment-modal"),
  paymentForm: document.querySelector("#payment-form"),
  paymentTitle: document.querySelector("#payment-title"),
  paymentPerson: document.querySelector("#payment-person"),
  paymentAmount: document.querySelector("#payment-amount"),
  paymentDate: document.querySelector("#payment-date"),
  paymentDateTrigger: document.querySelector("#payment-date-trigger"),
  paymentNote: document.querySelector("#payment-note"),
  paymentFeedback: document.querySelector("#payment-feedback"),
  peopleForm: document.querySelector("#people-form"),
  newPersonName: document.querySelector("#new-person-name"),
  peopleList: document.querySelector("#people-list"),
  peopleCount: document.querySelector("#people-count"),
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
  settingsTabs: document.querySelectorAll(".settings-tab"),
  settingsPanels: document.querySelectorAll("[data-settings-panel]"),
  csvFile: document.querySelector("#csv-file"),
  csvImportButton: document.querySelector("#csv-import-button"),
  csvImportStatus: document.querySelector("#csv-import-status"),
  csvPreview: document.querySelector("#csv-preview"),
  backupExport: document.querySelector("#backup-export"),
  backupFile: document.querySelector("#backup-file"),
  backupImport: document.querySelector("#backup-import"),
  backupStatus: document.querySelector("#backup-status"),
  changelogList: document.querySelector("#changelog-list"),
  changelogCount: document.querySelector("#changelog-count"),
};

let movements = loadMovements();
let settings = loadSettings();
let people = loadPeople();
let sharedEntries = loadSharedEntries();
let datePickerMonth = new Date();
let editingMovementId = null;
let pendingCsvMovements = [];
let pendingBackup = null;
let monthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let yearCursor = new Date(new Date().getFullYear(), 0, 1);
let sharedFilterPersonId = "all";
let editingSharedEntryId = null;

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

function saveSharedEntries() {
  localStorage.setItem(SHARED_KEY, JSON.stringify(sharedEntries));
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

function savePeople() {
  localStorage.setItem(PEOPLE_KEY, JSON.stringify(people));
}

function getPerson(id) {
  return people.find((person) => person.id === id);
}

function getPersonName(id) {
  return getPerson(id)?.name ?? "Persona";
}

function personHasEntries(id) {
  return sharedEntries.some((entry) => entry.personId === id);
}

function getSharedBalance(personId) {
  return sharedEntries
    .filter((entry) => entry.personId === personId)
    .reduce((balance, entry) => balance + entryBalanceImpact(entry), 0);
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

function formatMonthLabel(value) {
  const formatted = new Intl.DateTimeFormat(APP_LOCALE, {
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
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

function openMovementModal() {
  elements.movementModal.hidden = false;
  elements.concept.focus();
}

function closeMovementModal() {
  elements.movementModal.hidden = true;
}

function syncSharedFields() {
  if (elements.type.value !== "expense") {
    elements.isShared.checked = false;
  }

  const enabled = elements.isShared.checked && elements.type.value === "expense";
  elements.sharedFields.hidden = !enabled;
  elements.sharedPerson.required = enabled;
  elements.sharedMode.required = enabled;

  if (!enabled) {
    elements.sharedUneven.hidden = true;
    elements.sharedMyShare.required = false;
    elements.sharedTheirShare.required = false;
    return;
  }

  syncSharedPersonOptions();
  syncSharedModeLabels();
  syncSharedUnevenVisibility();
  syncSharedTotalHint();
}

function syncSharedPersonOptions() {
  const selected = elements.sharedPerson.value;
  elements.sharedPerson.innerHTML = people.length
    ? people.map((person) => `<option value="${person.id}">${person.name}</option>`).join("")
    : '<option value="">Sin personas creadas</option>';

  if (selected && people.some((person) => person.id === selected)) {
    elements.sharedPerson.value = selected;
  }
}

function syncSharedModeLabels() {
  const name = getPersonName(elements.sharedPerson.value) || "Persona";
  Object.entries(SHARED_MODES).forEach(([key, mode]) => {
    const option = elements.sharedMode.querySelector(`option[value="${key}"]`);
    if (option) {
      option.textContent = mode.label.replace("{name}", name);
    }
  });
}

function syncSharedUnevenVisibility() {
  const mode = SHARED_MODES[elements.sharedMode.value];
  const isUneven = mode?.split === "uneven";
  elements.sharedUneven.hidden = !isUneven;
  elements.sharedMyShare.required = isUneven;
  elements.sharedTheirShare.required = isUneven;
  elements.sharedTheirShareLabel.textContent = `Parte de ${getPersonName(elements.sharedPerson.value) || "la otra persona"}`;
}

function syncSharedTotalHint() {
  const total = Number(elements.amount.value) || 0;
  const mode = SHARED_MODES[elements.sharedMode.value];

  if (!mode || mode.split !== "uneven") {
    elements.sharedUnevenFeedback.textContent = "";
    return;
  }

  const my = Number(elements.sharedMyShare.value) || 0;
  const their = Number(elements.sharedTheirShare.value) || 0;
  const sum = my + their;
  const diff = Math.round((total - sum) * 100) / 100;

  if (!total) {
    elements.sharedUnevenFeedback.textContent = "Introduce primero el importe total.";
    elements.sharedUnevenFeedback.dataset.state = "warn";
  } else if (Math.abs(diff) < 0.005) {
    elements.sharedUnevenFeedback.textContent = `Total ${formatMoney(total)} — coincide.`;
    elements.sharedUnevenFeedback.dataset.state = "ok";
  } else if (diff > 0) {
    elements.sharedUnevenFeedback.textContent = `Total ${formatMoney(total)} — faltan ${formatMoney(diff)}.`;
    elements.sharedUnevenFeedback.dataset.state = "warn";
  } else {
    elements.sharedUnevenFeedback.textContent = `Total ${formatMoney(total)} — sobran ${formatMoney(-diff)}.`;
    elements.sharedUnevenFeedback.dataset.state = "warn";
  }
}

function getMondayFirstOffset(date) {
  return (date.getDay() + 6) % 7;
}

let activeDateTarget = null;

function getActiveDateTarget() {
  return activeDateTarget ?? { input: elements.date, trigger: elements.dateTrigger };
}

function writeDateToTarget(target, date) {
  target.input.value = toIsoDate(date);
  target.trigger.textContent = formatDate(target.input.value);
}

function setSelectedDate(date) {
  writeDateToTarget(getActiveDateTarget(), date);
  datePickerMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  if (!elements.datePicker.hidden) {
    renderDatePicker();
  }
}

function setMovementDate(date) {
  writeDateToTarget({ input: elements.date, trigger: elements.dateTrigger }, date);
}

function setPaymentDate(date) {
  writeDateToTarget({ input: elements.paymentDate, trigger: elements.paymentDateTrigger }, date);
}

function setInitialDate() {
  setMovementDate(new Date());
  elements.currentPeriod.textContent = new Intl.DateTimeFormat(APP_LOCALE, {
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function openDatePickerFor(target) {
  activeDateTarget = target;
  const currentValue = target.input.value;
  if (currentValue) {
    const [y, m] = currentValue.split("-").map(Number);
    datePickerMonth = new Date(y, m - 1, 1);
  }
  toggleDatePicker(true);
}

function toggleDatePicker(forceOpen) {
  const shouldOpen = forceOpen ?? elements.datePicker.hidden;
  elements.datePicker.hidden = !shouldOpen;
  getActiveDateTarget().trigger.setAttribute("aria-expanded", String(shouldOpen));

  if (shouldOpen) {
    renderDatePicker();
    positionDatePicker();
  }
}

function positionDatePicker() {
  const triggerRect = getActiveDateTarget().trigger.getBoundingClientRect();
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
  const selectedDate = getActiveDateTarget().input.value;
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
  card.querySelector(".movement-note").textContent = movement.note || "";
  card.querySelector(".amount").textContent = formatMoney(signedAmount);
  card.querySelector(".amount").classList.add(movement.type);
  card.querySelector(".date").textContent = formatDate(movement.date);
  card.querySelector(".party").textContent = movement.party || "Sin emisor";
  card.querySelector(".recurrence").textContent = recurrence[0].toUpperCase() + recurrence.slice(1);
  card.querySelector(".shared-cell").textContent = getMovementSharedLabel(movement);

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

  if (!compact) {
    const header = document.createElement("div");
    header.className = "movement-header";
    [
      "Fecha",
      "Concepto",
      "Importe",
      "Nota",
      "Emisor / receptor",
      "Categoria",
      "Recurrencia",
      "Compartido",
      "",
      "",
      "",
    ].forEach((label) => {
      const cell = document.createElement("span");
      cell.textContent = label;
      header.append(cell);
    });
    fragment.append(header);
  }

  let lastDate = null;
  let lastMonthKey = null;
  items.forEach((movement) => {
    if (!compact) {
      const monthKey = movement.date.slice(0, 7);
      if (monthKey !== lastMonthKey) {
        const monthHeader = document.createElement("div");
        monthHeader.className = "month-group";
        monthHeader.textContent = formatMonthLabel(movement.date);
        fragment.append(monthHeader);
        lastMonthKey = monthKey;
        lastDate = null;
      }
      if (movement.date !== lastDate) {
        const groupHeader = document.createElement("div");
        groupHeader.className = "date-group";
        groupHeader.textContent = formatDate(movement.date);
        fragment.append(groupHeader);
        lastDate = movement.date;
      }
    }
    fragment.append(createMovementCard(movement, compact));
  });
  container.append(fragment);
}

function renderMovements() {
  const filteredMovements = getFilteredMovements();
  elements.movementCount.textContent = `${filteredMovements.length} movimientos`;
  renderMovementList(elements.list, filteredMovements);
}

function getPeriodRange(type) {
  if (type === "month") {
    const start = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
    const end = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1);
    return { start, end };
  }

  const start = new Date(yearCursor.getFullYear(), 0, 1);
  const end = new Date(yearCursor.getFullYear() + 1, 0, 1);
  return { start, end };
}

function getMovementsInRange(type) {
  const { start, end } = getPeriodRange(type);

  return movements.filter((movement) => {
    const date = new Date(`${movement.date}T00:00:00`);
    return date >= start && date < end;
  });
}

function getTotals(items) {
  return items.reduce(
    (totals, movement) => {
      if (movement.type === "income") {
        totals.income += movement.amount;
      } else {
        totals.expense += movement.amount;
      }

      return totals;
    },
    { income: 0, expense: 0 }
  );
}

function groupTotals(items, keyGetter) {
  const groups = new Map();

  items.forEach((movement) => {
    const key = keyGetter(movement);
    const current = groups.get(key) ?? { label: key, income: 0, expense: 0 };

    if (movement.type === "income") {
      current.income += movement.amount;
    } else {
      current.expense += movement.amount;
    }

    groups.set(key, current);
  });

  return [...groups.values()].sort((a, b) => b.income - b.expense - (a.income - a.expense));
}

function renderBreakdown(container, rows) {
  container.innerHTML = "";

  if (!rows.length) {
    container.innerHTML = '<p class="empty-state">No hay movimientos en este periodo.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  rows.forEach((row) => {
    const item = document.createElement("article");
    const label = document.createElement("strong");
    const income = document.createElement("span");
    const expense = document.createElement("span");
    const balance = document.createElement("span");

    item.className = "breakdown-row";
    label.textContent = row.label;
    income.textContent = formatMoney(row.income);
    expense.textContent = formatMoney(row.expense);
    balance.textContent = formatMoney(row.income - row.expense);
    balance.className = row.income - row.expense >= 0 ? "amount income" : "amount expense";

    item.append(label, income, expense, balance);
    fragment.append(item);
  });

  container.append(fragment);
}

function renderPeriodAnalysis(type) {
  const items = getMovementsInRange(type);
  const totals = getTotals(items);
  const prefix = type === "month" ? "month" : "year";
  const label =
    type === "month"
      ? new Intl.DateTimeFormat(APP_LOCALE, { month: "long", year: "numeric" }).format(monthCursor)
      : String(yearCursor.getFullYear());

  elements[`${prefix}PeriodLabel`].textContent = label;
  elements[`${prefix}IncomeTotal`].textContent = formatMoney(totals.income);
  elements[`${prefix}ExpenseTotal`].textContent = formatMoney(totals.expense);
  elements[`${prefix}BalanceTotal`].textContent = formatMoney(totals.income - totals.expense);
  renderBreakdown(elements[`${prefix}ConceptBreakdown`], groupTotals(items, (movement) => movement.concept));
  renderBreakdown(
    elements[`${prefix}CategoryBreakdown`],
    groupTotals(items, (movement) => getCategoryLabel(movement.category))
  );
}

function renderAnalysis() {
  renderPeriodAnalysis("month");
  renderPeriodAnalysis("year");
}

function getMovementSharedLabel(movement) {
  if (!movement.sharedEntryId) {
    return "";
  }
  const entry = sharedEntries.find((candidate) => candidate.id === movement.sharedEntryId);
  if (!entry) {
    return "";
  }
  return getPersonName(entry.personId);
}

function renderSharedView() {
  renderSharedBalances();
  renderSharedFilterOptions();
  renderSharedEntries();
}

function renderSharedBalances() {
  const peopleWithActivity = people.filter(
    (person) => personHasEntries(person.id)
  );

  elements.sharedPeopleCount.textContent = `${peopleWithActivity.length} personas activas`;
  elements.sharedBalances.innerHTML = "";

  if (!people.length) {
    elements.sharedBalances.innerHTML =
      '<p class="empty-state">Crea personas en Configuracion para empezar a registrar gastos compartidos.</p>';
    return;
  }

  if (!peopleWithActivity.length) {
    elements.sharedBalances.innerHTML =
      '<p class="empty-state">Sin actividad. Anade un gasto compartido desde Movimientos.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  peopleWithActivity
    .map((person) => ({ person, balance: getSharedBalance(person.id) }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    .forEach(({ person, balance }) => {
      const card = document.createElement("article");
      const header = document.createElement("div");
      const name = document.createElement("strong");
      const hint = document.createElement("span");
      const value = document.createElement("span");
      const actions = document.createElement("div");

      card.className = "balance-card";
      card.dataset.personId = person.id;
      card.classList.toggle("is-positive", balance > 0.005);
      card.classList.toggle("is-negative", balance < -0.005);
      card.classList.toggle("is-zero", Math.abs(balance) < 0.005);

      header.className = "balance-header";
      name.textContent = person.name;
      hint.className = "balance-hint";

      if (Math.abs(balance) < 0.005) {
        hint.textContent = "Saldado";
      } else if (balance > 0) {
        hint.textContent = "te debe";
      } else {
        hint.textContent = "le debes";
      }

      header.append(name, hint);

      value.className = "balance-amount";
      value.textContent = formatMoney(Math.abs(balance));

      actions.className = "balance-actions";

      const viewButton = document.createElement("button");
      viewButton.type = "button";
      viewButton.className = "balance-action ghost";
      viewButton.dataset.action = "view";
      viewButton.textContent = "Ver entradas";

      const settleButton = document.createElement("button");
      settleButton.type = "button";
      settleButton.className = "balance-action settle";
      settleButton.dataset.action = "settle";
      settleButton.disabled = Math.abs(balance) < 0.005;
      const direction = balance > 0 ? `${person.name} te paga` : `Tu pagas a ${person.name}`;
      settleButton.innerHTML = Math.abs(balance) < 0.005
        ? `<strong>Saldo al dia</strong>`
        : `<strong>Liquidar saldo</strong><small>${direction}</small>`;

      actions.append(viewButton, settleButton);

      card.append(header, value, actions);
      fragment.append(card);
    });

  elements.sharedBalances.append(fragment);
}

function renderSharedFilterOptions() {
  const selected = sharedFilterPersonId;
  const options = ['<option value="all">Todas</option>'].concat(
    people.map((person) => `<option value="${person.id}">${person.name}</option>`)
  );
  elements.sharedPersonFilter.innerHTML = options.join("");
  elements.sharedPersonFilter.value = people.some((person) => person.id === selected) ? selected : "all";
  sharedFilterPersonId = elements.sharedPersonFilter.value;
}

function renderSharedEntries() {
  const personId = sharedFilterPersonId;

  let entries = [...sharedEntries];

  if (personId !== "all") {
    entries = entries.filter((entry) => entry.personId === personId);
  }

  entries.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

  elements.sharedEntries.innerHTML = "";

  if (!entries.length) {
    elements.sharedEntries.innerHTML = '<p class="empty-state">Sin entradas con esta persona.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  let lastMonthKey = null;

  entries.forEach((entry) => {
    const monthKey = entry.date.slice(0, 7);
    if (monthKey !== lastMonthKey) {
      const monthHeader = document.createElement("div");
      monthHeader.className = "month-group";
      monthHeader.textContent = formatMonthLabel(entry.date);
      fragment.append(monthHeader);
      lastMonthKey = monthKey;
    }
    fragment.append(buildSharedEntryRow(entry));
  });

  elements.sharedEntries.append(fragment);
}

function entryBalanceImpact(entry) {
  if (entry.type === "expense") {
    return entry.paidBy === "me" ? entry.theirShare : -entry.myShare;
  }
  return entry.paidBy === "me" ? entry.total : -entry.total;
}

function entryDescription(entry) {
  const personName = getPersonName(entry.personId);
  if (entry.type === "payment") {
    return entry.paidBy === "me"
      ? `Pago a ${personName}`
      : `${personName} te paga`;
  }
  const mode = entry.splitMode === "full"
    ? entry.paidBy === "me" ? `Prestado a ${personName}` : `Cubierto por ${personName}`
    : entry.paidBy === "me" ? `Pagaste tu` : `Pago ${personName}`;
  return `${entry.concept} — ${mode}`;
}

function buildSharedEntryRow(entry) {
  const row = document.createElement("article");
  row.className = "shared-entry";
  row.dataset.id = entry.id;
  row.dataset.type = entry.type;

  const date = document.createElement("span");
  date.className = "shared-entry-date";
  date.textContent = formatDate(entry.date);

  const main = document.createElement("div");
  main.className = "shared-entry-main";
  const description = document.createElement("strong");
  description.textContent = entryDescription(entry);
  main.append(description);

  if (entry.note) {
    const note = document.createElement("span");
    note.className = "shared-entry-note";
    note.textContent = entry.note;
    main.append(note);
  }

  if (entry.type === "expense" && entry.splitMode !== "full") {
    const breakdown = document.createElement("span");
    breakdown.className = "shared-entry-breakdown";
    const personName = getPersonName(entry.personId);
    breakdown.textContent = `Total ${formatMoney(entry.total)} — tu ${formatMoney(entry.myShare)} · ${personName} ${formatMoney(entry.theirShare)}`;
    main.append(breakdown);
  }

  const impact = entryBalanceImpact(entry);
  const amount = document.createElement("span");
  amount.className = "shared-entry-amount";
  if (impact > 0.005) {
    amount.classList.add("income");
    amount.textContent = `+${formatMoney(impact)}`;
  } else if (impact < -0.005) {
    amount.classList.add("expense");
    amount.textContent = `-${formatMoney(-impact)}`;
  } else {
    amount.textContent = formatMoney(0);
  }

  row.append(date, main, amount);

  if (entry.type === "expense") {
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "edit-action";
    editButton.dataset.action = "edit-shared";
    editButton.title = "Editar";
    editButton.textContent = "Editar";
    row.append(editButton);
  }

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-action";
  deleteButton.dataset.action = "delete-shared";
  deleteButton.title = "Eliminar";
  deleteButton.textContent = "x";
  row.append(deleteButton);

  return row;
}

function renderPeople() {
  elements.peopleCount.textContent = `${people.length} personas`;
  elements.peopleList.innerHTML = "";

  if (!people.length) {
    elements.peopleList.innerHTML = '<p class="empty-state">Aun no hay personas. Anade la primera arriba.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  people.forEach((person) => {
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
    const meta = document.createElement("div");
    const title = document.createElement("h3");
    const list = document.createElement("ul");

    item.className = "changelog-item";
    meta.className = "changelog-meta";
    date.dateTime = entry.date;
    date.textContent = formatDate(entry.date);
    meta.append(date);

    if (entry.commit) {
      const commit = document.createElement("code");
      commit.textContent = entry.commit;
      meta.append(commit);
    }

    title.textContent = entry.title;

    entry.changes.forEach((change) => {
      const listItem = document.createElement("li");
      listItem.textContent = change;
      list.append(listItem);
    });

    item.append(meta, title, list);
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
  renderMovements();
  renderAnalysis();
  renderSharedView();
  renderPeople();
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

function buildSharedExpenseEntry({ personId, total, modeKey, myShare, theirShare, date, concept, note, sourceMovementId }) {
  const mode = SHARED_MODES[modeKey];

  return {
    id: createId(),
    type: "expense",
    personId,
    date,
    concept,
    note: note || "",
    total,
    paidBy: mode.paidBy,
    splitMode: mode.split,
    myShare,
    theirShare,
    sourceMovementId: sourceMovementId || null,
    createdAt: new Date().toISOString(),
  };
}

function buildSharedPaymentEntry({ personId, total, paidBy, date, note }) {
  return {
    id: createId(),
    type: "payment",
    personId,
    date,
    concept: "Liquidacion",
    note: note || "",
    total,
    paidBy,
    splitMode: "payment",
    myShare: 0,
    theirShare: 0,
    sourceMovementId: null,
    createdAt: new Date().toISOString(),
  };
}

function computeSharedShares(total, modeKey, rawMyShare, rawTheirShare) {
  const mode = SHARED_MODES[modeKey];

  if (!mode) {
    throw new Error("Modo compartido invalido");
  }

  if (mode.split === "equal") {
    const half = Math.round((total / 2) * 100) / 100;
    return { myShare: half, theirShare: total - half };
  }

  if (mode.split === "full") {
    if (mode.paidBy === "me") {
      return { myShare: 0, theirShare: total };
    }
    return { myShare: total, theirShare: 0 };
  }

  const myShare = Math.round((Number(rawMyShare) || 0) * 100) / 100;
  const theirShare = Math.round((Number(rawTheirShare) || 0) * 100) / 100;
  return { myShare, theirShare };
}

function resetMovementForm(movement) {
  elements.form.reset();
  elements.type.value = movement?.type ?? "expense";
  setMovementDate(movement ? new Date(`${movement.date}T00:00:00`) : new Date());
  elements.isShared.checked = false;
  elements.sharedFields.hidden = true;
  elements.sharedUneven.hidden = true;
  elements.sharedMyShare.value = "";
  elements.sharedTheirShare.value = "";
  elements.sharedUnevenFeedback.textContent = "";
  elements.submitButton.textContent = "Anadir movimiento";
  editingMovementId = null;
  editingSharedEntryId = null;
  syncMovementSelects();
}

function setSettingsPanel(panelName) {
  elements.settingsTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.settingsTarget === panelName);
  });
  elements.settingsPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.settingsPanel === panelName);
  });
}

function parseDelimited(text) {
  const delimiter = text.includes("\t") ? "\t" : text.includes(";") ? ";" : ",";
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && quoted && nextChar === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(value.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value) {
  return createSlug(value.replace("€", "importe"));
}

function normalizeCategory(value) {
  const normalized = createSlug(value || "extra");
  const knownCategory = settings.categories.find((category) => category.value === normalized);

  if (knownCategory) {
    return knownCategory.value;
  }

  return normalized;
}

function labelFromSlug(value) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function parseSheetDate(value) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (!match) {
    return value;
  }

  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseEuroAmount(value) {
  const normalized = value.replace(/\s/g, "").replace("€", "").replace(/\./g, "").replace(",", ".");
  return Number(normalized);
}

function readCsvMovements(text) {
  const rows = parseDelimited(text);
  const headers = rows.shift()?.map(normalizeHeader) ?? [];
  const indexOf = (...names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0);
  const idIndex = indexOf("id-movimiento", "id");
  const dateIndex = indexOf("fecha");
  const conceptIndex = indexOf("concepto");
  const amountIndex = indexOf("importe", "eur");
  const noteIndex = indexOf("nota");
  const partyIndex = indexOf("emisor-receptor", "emisor-receptor");
  const categoryIndex = indexOf("categoria");
  const recurrenceIndex = indexOf("recurrencia");

  return rows
    .map((row) => {
      const amount = parseEuroAmount(row[amountIndex] ?? "0");
      const category = normalizeCategory(row[categoryIndex] ?? "extra");
      const concept = row[conceptIndex] ?? "";

      return {
        id: row[idIndex] || createId(),
        type: amount >= 0 || category === "ingreso" ? "income" : "expense",
        date: parseSheetDate(row[dateIndex] ?? ""),
        concept,
        amount: Math.abs(amount),
        category,
        party: row[partyIndex] ?? "",
        recurrence: createSlug(row[recurrenceIndex] ?? ""),
        note: row[noteIndex] ?? "",
      };
    })
    .filter((movement) => movement.date && movement.concept && Number.isFinite(movement.amount));
}

function renderCsvPreview(items) {
  if (!items.length) {
    elements.csvPreview.textContent = "No se han encontrado movimientos importables.";
    return;
  }

  const preview = items
    .slice(0, 8)
    .map((movement) => `${formatDate(movement.date)} · ${movement.concept} · ${formatMoney(getSignedAmount(movement))}`)
    .join("\n");

  elements.csvPreview.textContent = preview;
}

function exportBackup() {
  const backup = {
    exportedAt: new Date().toISOString(),
    version: 2,
    movements,
    settings,
    people,
    sharedEntries,
  };
  const content = `window.FlowGridBackup = ${JSON.stringify(backup, null, 2)};\n`;
  const blob = new Blob([content], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `flowgrid-backup-${toIsoDate(new Date())}.js`;
  link.click();
  URL.revokeObjectURL(url);
}

function parseBackup(text) {
  const jsonText = text.trim().startsWith("{") ? text : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(jsonText);

  if (!Array.isArray(parsed.movements) || !parsed.settings?.categories || !parsed.settings?.concepts) {
    throw new Error("Backup invalido");
  }

  parsed.people = Array.isArray(parsed.people) ? parsed.people : [];
  parsed.sharedEntries = Array.isArray(parsed.sharedEntries) ? parsed.sharedEntries : [];

  return parsed;
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

elements.openMovementModal.addEventListener("click", () => {
  resetMovementForm();
  elements.feedback.textContent = "";
  openMovementModal();
});

elements.closeMovementModal.addEventListener("click", closeMovementModal);

elements.movementModal.addEventListener("click", (event) => {
  if (event.target === elements.movementModal) {
    closeMovementModal();
  }
});

elements.settingsTabs.forEach((button) => {
  button.addEventListener("click", () => setSettingsPanel(button.dataset.settingsTarget));
});

document.querySelectorAll("[data-period]").forEach((button) => {
  button.addEventListener("click", () => {
    const step = Number(button.dataset.step);

    if (button.dataset.period === "month") {
      monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + step, 1);
    } else {
      yearCursor = new Date(yearCursor.getFullYear() + step, 0, 1);
    }

    renderAnalysis();
  });
});

elements.csvFile.addEventListener("change", async () => {
  const file = elements.csvFile.files[0];

  if (!file) {
    return;
  }

  const text = await file.text();
  pendingCsvMovements = readCsvMovements(text);
  elements.csvImportButton.disabled = pendingCsvMovements.length === 0;
  elements.csvImportStatus.textContent = `${pendingCsvMovements.length} movimientos detectados`;
  renderCsvPreview(pendingCsvMovements);
});

elements.sharedEntries.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='delete-shared']");

  if (!button) {
    return;
  }

  const row = event.target.closest("[data-id]");
  const entry = sharedEntries.find((candidate) => candidate.id === row.dataset.id);

  if (!entry) {
    return;
  }

  const action = button.dataset.action;

  if (action === "edit-shared") {
    openSharedEntryEdit(entry);
    return;
  }

  if (!confirm(`Eliminar entrada "${entry.concept}" con ${getPersonName(entry.personId)}?`)) {
    return;
  }

  sharedEntries = sharedEntries.filter((candidate) => candidate.id !== entry.id);
  if (entry.sourceMovementId) {
    movements = movements.map((movement) =>
      movement.id === entry.sourceMovementId ? { ...movement, sharedEntryId: null } : movement
    );
    saveMovements();
  }
  saveSharedEntries();
  renderSharedView();
  renderMovements();
});

elements.sharedPersonFilter.addEventListener("change", () => {
  sharedFilterPersonId = elements.sharedPersonFilter.value;
  renderSharedEntries();
});

elements.sharedBalances.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  const card = event.target.closest("[data-person-id]");
  if (!card) {
    return;
  }

  const personId = card.dataset.personId;
  const action = button?.dataset.action || "view";

  if (action === "settle") {
    openLiquidateModal(personId);
    return;
  }

  sharedFilterPersonId = personId;
  elements.sharedPersonFilter.value = sharedFilterPersonId;
  renderSharedEntries();
  document.querySelector("#shared-entries")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

function openLiquidateModal(personId) {
  const balance = getSharedBalance(personId);
  if (Math.abs(balance) < 0.005) {
    return;
  }

  elements.paymentModal.hidden = false;
  elements.paymentForm.reset();
  elements.paymentFeedback.textContent = "";
  elements.paymentPerson.innerHTML = people
    .map((person) => `<option value="${person.id}">${person.name}</option>`)
    .join("");
  elements.paymentPerson.value = personId;
  elements.paymentAmount.value = Math.abs(balance).toFixed(2);
  setPaymentDate(new Date());

  const personName = getPersonName(personId);
  const direction = balance > 0 ? `${personName} te paga` : `tu pagas a ${personName}`;
  elements.paymentTitle.textContent = `Liquidar saldo con ${personName}`;
  elements.paymentFeedback.textContent = `Saldo actual: ${formatMoney(Math.abs(balance))} (${direction})`;
  elements.paymentAmount.focus();
  elements.paymentAmount.select();
}

function closePaymentModal() {
  elements.paymentModal.hidden = true;
}

elements.closePaymentModal.addEventListener("click", closePaymentModal);

elements.paymentModal.addEventListener("click", (event) => {
  if (event.target === elements.paymentModal) {
    closePaymentModal();
  }
});

elements.paymentForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const personId = elements.paymentPerson.value;
  const amount = Number(elements.paymentAmount.value);
  const date = elements.paymentDate.value;
  const note = elements.paymentNote.value.trim();

  if (!personId || !Number.isFinite(amount) || amount <= 0 || !date) {
    elements.paymentFeedback.textContent = "Completa persona, importe y fecha.";
    return;
  }

  const balance = getSharedBalance(personId);
  if (Math.abs(balance) < 0.005) {
    elements.paymentFeedback.textContent = "No hay saldo con esta persona.";
    return;
  }

  const entry = buildSharedPaymentEntry({
    personId,
    total: amount,
    paidBy: balance > 0 ? "them" : "me",
    date,
    note,
  });

  sharedEntries = [entry, ...sharedEntries];
  saveSharedEntries();
  closePaymentModal();
  renderSharedView();
});

elements.csvImportButton.addEventListener("click", () => {
  const existingIds = new Set(movements.map((movement) => movement.id));
  const importedMovements = pendingCsvMovements.filter((movement) => !existingIds.has(movement.id));

  importedMovements.forEach((movement) => {
    if (!settings.categories.some((category) => category.value === movement.category)) {
      settings.categories.push(createCategory(labelFromSlug(movement.category)));
    }

    if (!settings.concepts.some((concept) => concept.label.toLowerCase() === movement.concept.toLowerCase())) {
      settings.concepts.push({
        id: createId(),
        label: movement.concept,
        category: movement.category,
      });
    }
  });

  movements = [...importedMovements, ...movements];
  saveMovements();
  saveSettings();
  pendingCsvMovements = [];
  elements.csvFile.value = "";
  elements.csvImportButton.disabled = true;
  elements.csvImportStatus.textContent = `${importedMovements.length} movimientos importados`;
  elements.csvPreview.textContent = "Importacion completada.";
  syncMovementSelects();
  renderMovements();
  renderAnalysis();
  renderConcepts();
  renderCategories();
});

elements.backupExport.addEventListener("click", exportBackup);

elements.backupFile.addEventListener("change", async () => {
  const file = elements.backupFile.files[0];

  if (!file) {
    return;
  }

  try {
    pendingBackup = parseBackup(await file.text());
    elements.backupImport.disabled = false;
    elements.backupStatus.textContent = `${pendingBackup.movements.length} movimientos en backup`;
  } catch {
    pendingBackup = null;
    elements.backupImport.disabled = true;
    elements.backupStatus.textContent = "Backup no valido";
  }
});

elements.backupImport.addEventListener("click", () => {
  if (!pendingBackup || !confirm("Importar backup y reemplazar los datos locales actuales?")) {
    return;
  }

  movements = pendingBackup.movements;
  settings = pendingBackup.settings;
  people = pendingBackup.people;
  sharedEntries = pendingBackup.sharedEntries;
  saveMovements();
  saveSettings();
  savePeople();
  saveSharedEntries();
  pendingBackup = null;
  elements.backupFile.value = "";
  elements.backupImport.disabled = true;
  elements.backupStatus.textContent = "Backup importado";
  syncMovementSelects();
  render();
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(elements.form);
  const totalAmount = Number(formData.get("amount"));
  const wasEditing = !!editingMovementId || !!editingSharedEntryId;
  const shouldShare = elements.isShared.checked && formData.get("type") === "expense";
  const movement = createMovement(formData);

  let sharedEntry = null;
  let modeKey = null;

  if (shouldShare) {
    const personId = elements.sharedPerson.value;
    modeKey = elements.sharedMode.value;
    const mode = SHARED_MODES[modeKey];

    if (!personId || !mode) {
      elements.feedback.textContent = "Selecciona persona y modo del gasto compartido.";
      return;
    }

    const { myShare, theirShare } = computeSharedShares(
      totalAmount,
      modeKey,
      elements.sharedMyShare.value,
      elements.sharedTheirShare.value
    );

    if (mode.split === "uneven") {
      const sum = Math.round((myShare + theirShare) * 100) / 100;
      if (Math.abs(sum - totalAmount) >= 0.005) {
        elements.feedback.textContent = `Las partes (${formatMoney(sum)}) no coinciden con el total (${formatMoney(totalAmount)}).`;
        return;
      }
    }

    sharedEntry = buildSharedExpenseEntry({
      personId,
      total: totalAmount,
      modeKey,
      myShare,
      theirShare,
      date: movement.date,
      concept: movement.concept,
      note: movement.note,
      sourceMovementId: movement.id,
    });

    movement.amount = myShare;
    movement.sharedEntryId = sharedEntry.id;
  }

  const skipMovement = shouldShare && SHARED_MODES[modeKey].paidBy === "me" && SHARED_MODES[modeKey].split === "full";

  if (wasEditing) {
    if (editingMovementId) {
      const oldMovement = movements.find((m) => m.id === editingMovementId);
      if (oldMovement?.sharedEntryId) {
        sharedEntries = sharedEntries.filter((e) => e.id !== oldMovement.sharedEntryId);
      }
      movements = movements.filter((m) => m.id !== editingMovementId);
    }
    if (editingSharedEntryId) {
      const oldEntry = sharedEntries.find((e) => e.id === editingSharedEntryId);
      if (oldEntry?.sourceMovementId) {
        movements = movements.filter((m) => m.id !== oldEntry.sourceMovementId);
      }
      sharedEntries = sharedEntries.filter((e) => e.id !== editingSharedEntryId);
    }
    editingMovementId = null;
    editingSharedEntryId = null;
    elements.submitButton.textContent = "Anadir movimiento";
    elements.feedback.textContent = "Cambios guardados.";
  } else {
    elements.feedback.textContent = skipMovement
      ? "Prestamo registrado en Compartidos."
      : "Movimiento anadido.";
  }

  if (!skipMovement) {
    movements = [movement, ...movements];
  }
  if (sharedEntry) {
    if (skipMovement) {
      sharedEntry.sourceMovementId = null;
    }
    sharedEntries = [sharedEntry, ...sharedEntries];
  }

  saveMovements();
  saveSharedEntries();
  renderMovements();
  renderAnalysis();
  if (sharedEntry || wasEditing) {
    renderSharedView();
  }

  resetMovementForm(movement);
  closeMovementModal();
});

function inferSharedModeKey(entry) {
  for (const [key, mode] of Object.entries(SHARED_MODES)) {
    if (mode.paidBy === entry.paidBy && mode.split === entry.splitMode) {
      return key;
    }
  }
  return "me-equal";
}

function applySharedEntryToForm(entry) {
  elements.amount.value = entry.total;
  elements.isShared.checked = true;
  syncSharedFields();
  elements.sharedPerson.value = entry.personId;
  syncSharedModeLabels();
  elements.sharedMode.value = inferSharedModeKey(entry);
  syncSharedUnevenVisibility();
  if (entry.splitMode === "uneven") {
    elements.sharedMyShare.value = entry.myShare;
    elements.sharedTheirShare.value = entry.theirShare;
  }
  syncSharedTotalHint();
}

function fillMovementForm(movement) {
  elements.type.value = movement.type;
  syncMovementSelects();
  elements.concept.value = movement.concept;
  elements.category.value = movement.category;
  setMovementDate(new Date(`${movement.date}T00:00:00`));
  elements.amount.value = movement.amount;
  elements.party.value = movement.party;
  elements.recurrence.value = movement.recurrence;
  elements.note.value = movement.note;

  const linkedEntry = movement.sharedEntryId
    ? sharedEntries.find((entry) => entry.id === movement.sharedEntryId)
    : null;

  if (linkedEntry) {
    applySharedEntryToForm(linkedEntry);
  } else {
    elements.isShared.checked = false;
    syncSharedFields();
  }
}

function openSharedEntryEdit(entry) {
  if (entry.type !== "expense") {
    return;
  }

  if (entry.sourceMovementId) {
    const movement = movements.find((candidate) => candidate.id === entry.sourceMovementId);
    if (!movement) {
      alert("Movimiento asociado no encontrado.");
      return;
    }
    editingMovementId = movement.id;
    editingSharedEntryId = null;
    fillMovementForm(movement);
  } else {
    editingMovementId = null;
    editingSharedEntryId = entry.id;
    elements.type.value = "expense";
    syncMovementSelects();
    const concept = settings.concepts.find((c) => c.label === entry.concept);
    elements.concept.value = entry.concept;
    elements.category.value = concept?.category ?? settings.categories[0]?.value ?? "extra";
    setMovementDate(new Date(`${entry.date}T00:00:00`));
    elements.party.value = "";
    elements.recurrence.value = "";
    elements.note.value = entry.note || "";
    applySharedEntryToForm(entry);
  }

  elements.submitButton.textContent = "Guardar cambios";
  elements.feedback.textContent = "Editando entrada compartida.";
  openMovementModal();
}

elements.list.addEventListener("click", (event) => {
  const editButton = event.target.closest(".edit-action");
  const duplicateButton = event.target.closest(".duplicate-action");
  const deleteButton = event.target.closest(".delete-action");

  if (!editButton && !duplicateButton && !deleteButton) {
    return;
  }

  const card = event.target.closest(".movement-card");
  const movement = movements.find((candidate) => candidate.id === card.dataset.id);

  if (!movement) {
    return;
  }

  if (editButton) {
    editingMovementId = movement.id;
    fillMovementForm(movement);
    elements.submitButton.textContent = "Guardar cambios";
    elements.feedback.textContent = "Editando movimiento.";
    openMovementModal();
    elements.concept.focus();
    return;
  }

  if (duplicateButton) {
    editingMovementId = null;
    fillMovementForm(movement);
    elements.submitButton.textContent = "Anadir movimiento";
    elements.feedback.textContent = "Copia preparada. Ajusta lo que cambie.";
    openMovementModal();
    elements.concept.focus();
    return;
  }

  const linkedEntry = movement.sharedEntryId
    ? sharedEntries.find((entry) => entry.id === movement.sharedEntryId)
    : null;

  if (confirm(`Eliminar "${movement.concept}" del ${formatDate(movement.date)}?`)) {
    movements = movements.filter((candidate) => candidate.id !== movement.id);
    if (linkedEntry) {
      sharedEntries = sharedEntries.filter((entry) => entry.id !== linkedEntry.id);
      saveSharedEntries();
    }
    saveMovements();
    renderMovements();
    renderAnalysis();
    if (linkedEntry) {
      renderSharedView();
    }
  }
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
  syncMovementSelects();
  renderConcepts();
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
  syncMovementSelects();
  renderCategories();
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
  syncMovementSelects();
  renderConcepts();
  renderMovements();
  renderAnalysis();
});

[elements.search, elements.categoryFilter, elements.typeFilter].forEach((control) => {
  control.addEventListener("input", renderMovements);
});

elements.peopleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = elements.newPersonName.value.trim();

  if (!name) {
    return;
  }

  const existing = people.find((person) => person.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    elements.peopleForm.reset();
    return;
  }

  people = [
    ...people,
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
  const person = people.find((candidate) => candidate.id === item.dataset.personId);

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
    people = people.filter((candidate) => candidate.id !== person.id);
    savePeople();
    renderPeople();
    renderSharedView();
    syncSharedPersonOptions();
  }
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
  syncMovementSelects();
  renderCategories();
  renderMovements();
  renderAnalysis();
});

elements.conceptSort.addEventListener("input", renderConcepts);
elements.conceptGroup.addEventListener("input", renderConcepts);
elements.type.addEventListener("change", () => {
  syncMovementSelects();
  syncSharedFields();
});
elements.concept.addEventListener("change", syncCategoryFromConcept);
elements.isShared.addEventListener("change", () => {
  syncSharedFields();
});
elements.sharedPerson.addEventListener("change", () => {
  syncSharedModeLabels();
  syncSharedUnevenVisibility();
});
elements.sharedMode.addEventListener("change", () => {
  syncSharedUnevenVisibility();
  syncSharedTotalHint();
});
elements.sharedMyShare.addEventListener("input", syncSharedTotalHint);
elements.sharedTheirShare.addEventListener("input", syncSharedTotalHint);
elements.amount.addEventListener("input", syncSharedTotalHint);
elements.sharedPersonAdd.addEventListener("click", () => {
  const name = prompt("Nombre de la persona:");
  if (!name?.trim()) {
    return;
  }
  const trimmed = name.trim();
  const existing = people.find((person) => person.name.toLowerCase() === trimmed.toLowerCase());
  let personId;
  if (existing) {
    personId = existing.id;
  } else {
    const created = { id: createId(), name: trimmed, email: "", invitedAt: null, createdAt: new Date().toISOString() };
    people = [...people, created];
    savePeople();
    personId = created.id;
  }
  syncSharedPersonOptions();
  elements.sharedPerson.value = personId;
  syncSharedModeLabels();
  syncSharedUnevenVisibility();
  renderPeople();
});
elements.dateTrigger.addEventListener("click", () => {
  openDatePickerFor({ input: elements.date, trigger: elements.dateTrigger });
});
elements.paymentDateTrigger.addEventListener("click", () => {
  openDatePickerFor({ input: elements.paymentDate, trigger: elements.paymentDateTrigger });
});
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
    elements.dateTrigger.contains(event.target) ||
    elements.paymentDateTrigger.contains(event.target)
  ) {
    return;
  }

  toggleDatePicker(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    toggleDatePicker(false);
    closeMovementModal();
    closePaymentModal();
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
