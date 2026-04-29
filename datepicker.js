import { state } from "./state.js";
import { elements } from "./dom.js";
import { APP_LOCALE, formatDate, getMondayFirstOffset, toIsoDate } from "./utils.js";

export function getActiveDateTarget() {
  return state.activeDateTarget ?? { input: elements.date, trigger: elements.dateTrigger };
}

export function writeDateToTarget(target, date) {
  target.input.value = toIsoDate(date);
  target.trigger.textContent = formatDate(target.input.value);
}

export function setSelectedDate(date) {
  writeDateToTarget(getActiveDateTarget(), date);
  state.datePickerMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  if (!elements.datePicker.hidden) {
    renderDatePicker();
  }
}

export function setMovementDate(date) {
  writeDateToTarget({ input: elements.date, trigger: elements.dateTrigger }, date);
}

export function setPaymentDate(date) {
  writeDateToTarget({ input: elements.paymentDate, trigger: elements.paymentDateTrigger }, date);
}

export function setInitialDate() {
  setMovementDate(new Date());
  elements.currentPeriod.textContent = new Intl.DateTimeFormat(APP_LOCALE, {
    month: "long",
    year: "numeric",
  }).format(new Date());
}

export function openDatePickerFor(target) {
  state.activeDateTarget = target;
  const currentValue = target.input.value;
  if (currentValue) {
    const [y, m] = currentValue.split("-").map(Number);
    state.datePickerMonth = new Date(y, m - 1, 1);
  }
  toggleDatePicker(true);
}

export function toggleDatePicker(forceOpen) {
  const shouldOpen = forceOpen ?? elements.datePicker.hidden;
  elements.datePicker.hidden = !shouldOpen;
  getActiveDateTarget().trigger.setAttribute("aria-expanded", String(shouldOpen));

  if (shouldOpen) {
    renderDatePicker();
    positionDatePicker();
  }
}

export function positionDatePicker() {
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

export function renderDatePicker() {
  const selectedDate = getActiveDateTarget().input.value;
  const today = toIsoDate(new Date());
  const year = state.datePickerMonth.getFullYear();
  const month = state.datePickerMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = getMondayFirstOffset(firstDay);

  elements.datePickerTitle.textContent = new Intl.DateTimeFormat(APP_LOCALE, {
    month: "long",
    year: "numeric",
  }).format(state.datePickerMonth);
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

export function moveDatePickerMonth(step) {
  state.datePickerMonth = new Date(state.datePickerMonth.getFullYear(), state.datePickerMonth.getMonth() + step, 1);
  renderDatePicker();
}

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
