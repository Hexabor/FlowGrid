import { state } from "./state.js";
import { elements } from "./dom.js";
import { saveMovements, saveSettings } from "./storage.js";
import {
  createId,
  createSlug,
  formatDate,
  formatMoney,
  labelFromSlug,
  parseEuroAmount,
  parseSheetDate,
} from "./utils.js";
import { getSignedAmount, renderMovements, syncMovementSelects } from "./movements.js";
import { renderAnalysis } from "./analysis.js";
import { createCategory, normalizeCategory, renderCategories, renderConcepts } from "./settings.js";

export function parseDelimited(text) {
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

export function normalizeHeader(value) {
  return createSlug(value.replace("€", "importe"));
}

export function readCsvMovements(text) {
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

export function renderCsvPreview(items) {
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

elements.csvFile.addEventListener("change", async () => {
  const file = elements.csvFile.files[0];

  if (!file) {
    return;
  }

  const text = await file.text();
  state.pendingCsvMovements = readCsvMovements(text);
  elements.csvImportButton.disabled = state.pendingCsvMovements.length === 0;
  elements.csvImportStatus.textContent = `${state.pendingCsvMovements.length} movimientos detectados`;
  renderCsvPreview(state.pendingCsvMovements);
});

elements.csvImportButton.addEventListener("click", () => {
  const existingIds = new Set(state.movements.map((movement) => movement.id));
  const importedMovements = state.pendingCsvMovements.filter((movement) => !existingIds.has(movement.id));

  importedMovements.forEach((movement) => {
    if (!state.settings.categories.some((category) => category.value === movement.category)) {
      state.settings.categories.push(createCategory(labelFromSlug(movement.category)));
    }

    if (!state.settings.concepts.some((concept) => concept.label.toLowerCase() === movement.concept.toLowerCase())) {
      state.settings.concepts.push({
        id: createId(),
        label: movement.concept,
        category: movement.category,
      });
    }
  });

  state.movements = [...importedMovements, ...state.movements];
  saveMovements();
  saveSettings();
  state.pendingCsvMovements = [];
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
