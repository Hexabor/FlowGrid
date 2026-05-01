import { state } from "../core/state.js";
import { elements } from "../core/dom.js";
import { saveMovements, saveSettings } from "../core/storage.js";
import {
  createId,
  createSlug,
  formatDate,
  formatMoney,
  labelFromSlug,
  parseEuroAmount,
  parseSheetDate,
  toIsoDate,
} from "../core/utils.js";
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

function escapeCsvCell(value) {
  const str = String(value ?? "");
  if (/[";\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function formatAmountForCsv(amount) {
  // Spanish/European decimal: use comma. Excel ES respects this with `;` delimiter.
  return amount.toFixed(2).replace(".", ",");
}

export function exportMovementsCsv() {
  if (!state.movements.length) {
    elements.csvExportStatus.textContent = "No hay movimientos que exportar.";
    return;
  }

  const headers = ["Fecha", "Concepto", "Importe", "Tipo", "Categoria", "Emisor/Receptor", "Recurrencia", "Nota"];
  const rows = [...state.movements]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((movement) => [
      movement.date,
      movement.concept,
      formatAmountForCsv(getSignedAmount(movement)),
      movement.type === "income" ? "Ingreso" : "Gasto",
      labelFromSlug(movement.category),
      movement.party || "",
      movement.recurrence ? labelFromSlug(movement.recurrence) : "",
      movement.note || "",
    ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(";"))
    .join("\r\n");

  // BOM (﻿) so Excel detects UTF-8 and renders accents correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `flowgrid-movimientos-${toIsoDate(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(url);

  elements.csvExportStatus.textContent = `${state.movements.length} movimiento${state.movements.length === 1 ? "" : "s"} exportado${state.movements.length === 1 ? "" : "s"}.`;
}

elements.csvExportButton.addEventListener("click", exportMovementsCsv);

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
