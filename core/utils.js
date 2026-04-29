export const APP_LOCALE = "es-ES";

export function createSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `fg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function formatMoney(value) {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export function formatDate(value) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export function formatMonthLabel(value) {
  const formatted = new Intl.DateTimeFormat(APP_LOCALE, {
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function formatDateTime(value) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function getMondayFirstOffset(date) {
  return (date.getDay() + 6) % 7;
}

export function optionMarkup(items, selectedValue = "") {
  return items
    .map((item) => {
      const selected = item.value === selectedValue || item.label === selectedValue ? " selected" : "";
      return `<option value="${item.value ?? item.label}"${selected}>${item.label}</option>`;
    })
    .join("");
}

export function labelFromSlug(value) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function parseSheetDate(value) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (!match) {
    return value;
  }

  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function parseEuroAmount(value) {
  const normalized = value.replace(/\s/g, "").replace("€", "").replace(/\./g, "").replace(",", ".");
  return Number(normalized);
}
