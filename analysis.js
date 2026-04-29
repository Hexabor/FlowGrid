import { state } from "./state.js";
import { elements } from "./dom.js";
import { APP_LOCALE, formatMoney } from "./utils.js";
import { getCategoryLabel } from "./movements.js";

export function getPeriodRange(type) {
  if (type === "month") {
    const start = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth(), 1);
    const end = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth() + 1, 1);
    return { start, end };
  }

  const start = new Date(state.yearCursor.getFullYear(), 0, 1);
  const end = new Date(state.yearCursor.getFullYear() + 1, 0, 1);
  return { start, end };
}

export function getMovementsInRange(type) {
  const { start, end } = getPeriodRange(type);

  return state.movements.filter((movement) => {
    const date = new Date(`${movement.date}T00:00:00`);
    return date >= start && date < end;
  });
}

export function getTotals(items) {
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

export function groupTotals(items, keyGetter) {
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

export function renderBreakdown(container, rows) {
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

export function renderPeriodAnalysis(type) {
  const items = getMovementsInRange(type);
  const totals = getTotals(items);
  const prefix = type === "month" ? "month" : "year";
  const label =
    type === "month"
      ? new Intl.DateTimeFormat(APP_LOCALE, { month: "long", year: "numeric" }).format(state.monthCursor)
      : String(state.yearCursor.getFullYear());

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

export function renderAnalysis() {
  renderPeriodAnalysis("month");
  renderPeriodAnalysis("year");
}

document.querySelectorAll("[data-period]").forEach((button) => {
  button.addEventListener("click", () => {
    const step = Number(button.dataset.step);

    if (button.dataset.period === "month") {
      state.monthCursor = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth() + step, 1);
    } else {
      state.yearCursor = new Date(state.yearCursor.getFullYear() + step, 0, 1);
    }

    renderAnalysis();
  });
});
