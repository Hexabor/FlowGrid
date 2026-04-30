import { state } from "../core/state.js";
import { elements } from "../core/dom.js";
import { APP_LOCALE, formatMoney } from "../core/utils.js";
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
    const current = groups.get(key) ?? { label: key, income: 0, expense: 0, count: 0 };

    current.count += 1;
    if (movement.type === "income") {
      current.income += movement.amount;
    } else {
      current.expense += movement.amount;
    }

    groups.set(key, current);
  });

  return [...groups.values()];
}

const BREAKDOWN_COLUMNS = [
  { label: "Concepto", key: "label" },
  { label: "Mov.", key: "count" },
  { label: "Balance", key: "balance" },
];

function compareBreakdownRows(a, b, key) {
  switch (key) {
    case "label":
      return a.label.localeCompare(b.label, "es", { sensitivity: "base" });
    case "count":
      return a.count - b.count;
    case "balance":
      return (a.income - a.expense) - (b.income - b.expense);
    default:
      return 0;
  }
}

function sortBreakdownRows(rows) {
  const { key, dir } = state.breakdownSort;
  return [...rows].sort((a, b) => {
    const cmp = compareBreakdownRows(a, b, key);
    return dir === "asc" ? cmp : -cmp;
  });
}

export function renderBreakdown(container, rows) {
  container.innerHTML = "";

  const { key: sortKey, dir: sortDir } = state.breakdownSort;
  const header = document.createElement("div");
  header.className = "breakdown-header";
  BREAKDOWN_COLUMNS.forEach(({ label, key }) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "breakdown-header-cell";
    cell.dataset.sortKey = key;
    if (key === sortKey) {
      cell.classList.add("is-active");
    }
    const arrow = key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "";
    cell.textContent = `${label}${arrow}`;
    header.append(cell);
  });
  container.append(header);

  if (!rows.length) {
    container.insertAdjacentHTML(
      "beforeend",
      '<p class="empty-state">No hay movimientos en este periodo.</p>'
    );
    return;
  }

  const fragment = document.createDocumentFragment();

  sortBreakdownRows(rows).forEach((row) => {
    const item = document.createElement("article");
    const label = document.createElement("strong");
    const count = document.createElement("span");
    const balance = document.createElement("span");

    item.className = "breakdown-row";
    label.textContent = row.label;
    count.textContent = row.count;
    const net = row.income - row.expense;
    balance.textContent = formatMoney(net);
    balance.className = net >= 0 ? "amount income" : "amount expense";

    item.append(label, count, balance);
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

// Click on a breakdown header cell toggles sort. Same sort applies to all
// four breakdown lists (month/year × concept/category) for consistency.
[
  elements.monthConceptBreakdown,
  elements.monthCategoryBreakdown,
  elements.yearConceptBreakdown,
  elements.yearCategoryBreakdown,
].forEach((list) => {
  list.addEventListener("click", (event) => {
    const cell = event.target.closest(".breakdown-header-cell");
    if (!cell) return;
    const key = cell.dataset.sortKey;
    if (state.breakdownSort.key === key) {
      state.breakdownSort.dir = state.breakdownSort.dir === "asc" ? "desc" : "asc";
    } else {
      state.breakdownSort.key = key;
      state.breakdownSort.dir = key === "label" ? "asc" : "desc";
    }
    renderAnalysis();
  });
});
