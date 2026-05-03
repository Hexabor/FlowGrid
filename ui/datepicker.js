import { state } from "../core/state.js";
import { elements } from "../core/dom.js";
import { APP_LOCALE, formatDate, getMondayFirstOffset, toIsoDate } from "../core/utils.js";

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

export function setRecurringStartDate(date) {
  writeDateToTarget({ input: elements.recurringStartDate, trigger: elements.recurringStartDateTrigger }, date);
}

// Optional date: pass null to clear the value entirely. The trigger label
// reverts to a placeholder so the user knows there is no end date set.
export function setRecurringEndDate(date) {
  if (!date) {
    elements.recurringEndDate.value = "";
    elements.recurringEndDateTrigger.textContent = "Sin fecha de fin";
    if (elements.recurringEndDateClear) elements.recurringEndDateClear.hidden = true;
    return;
  }
  writeDateToTarget(
    { input: elements.recurringEndDate, trigger: elements.recurringEndDateTrigger },
    date
  );
  if (elements.recurringEndDateClear) elements.recurringEndDateClear.hidden = false;
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

elements.recurringStartDateTrigger?.addEventListener("click", () => {
  openDatePickerFor({ input: elements.recurringStartDate, trigger: elements.recurringStartDateTrigger });
});

elements.recurringEndDateTrigger?.addEventListener("click", () => {
  openDatePickerFor({ input: elements.recurringEndDate, trigger: elements.recurringEndDateTrigger });
});

elements.recurringEndDateClear?.addEventListener("click", () => {
  setRecurringEndDate(null);
});

elements.prevMonth.addEventListener("click", () => moveDatePickerMonth(-1));
elements.nextMonth.addEventListener("click", () => moveDatePickerMonth(1));

elements.dateGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-date]");

  if (!button) {
    return;
  }

  const target = getActiveDateTarget();
  setSelectedDate(new Date(`${button.dataset.date}T00:00:00`));
  // Optional-date target (recurring end-date): reveal the "Quitar"
  // button now that there is something to clear.
  if (target?.input === elements.recurringEndDate && elements.recurringEndDateClear) {
    elements.recurringEndDateClear.hidden = false;
  }
  toggleDatePicker(false);
});

// Close the picker when clicking outside it AND outside any date-trigger
// button. Using `.closest('.date-trigger')` keeps every present and
// future trigger included automatically — adding a new one just needs
// the class, no plumbing here.
document.addEventListener("click", (event) => {
  if (
    elements.datePicker.hidden ||
    elements.datePicker.contains(event.target) ||
    event.target.closest(".date-trigger")
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
