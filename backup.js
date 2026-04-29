import { state } from "./state.js";
import { elements } from "./dom.js";
import { saveMovements, savePeople, saveSettings, saveSharedEntries } from "./storage.js";
import { toIsoDate } from "./utils.js";
import { syncMovementSelects } from "./movements.js";
import { render } from "./render.js";

export function exportBackup() {
  const backup = {
    exportedAt: new Date().toISOString(),
    version: 2,
    movements: state.movements,
    settings: state.settings,
    people: state.people,
    sharedEntries: state.sharedEntries,
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

export function parseBackup(text) {
  const jsonText = text.trim().startsWith("{") ? text : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(jsonText);

  if (!Array.isArray(parsed.movements) || !parsed.settings?.categories || !parsed.settings?.concepts) {
    throw new Error("Backup invalido");
  }

  parsed.people = Array.isArray(parsed.people) ? parsed.people : [];
  parsed.sharedEntries = Array.isArray(parsed.sharedEntries) ? parsed.sharedEntries : [];

  return parsed;
}

elements.backupExport.addEventListener("click", exportBackup);

elements.backupFile.addEventListener("change", async () => {
  const file = elements.backupFile.files[0];

  if (!file) {
    return;
  }

  try {
    state.pendingBackup = parseBackup(await file.text());
    elements.backupImport.disabled = false;
    elements.backupStatus.textContent = `${state.pendingBackup.movements.length} movimientos en backup`;
  } catch {
    state.pendingBackup = null;
    elements.backupImport.disabled = true;
    elements.backupStatus.textContent = "Backup no valido";
  }
});

elements.backupImport.addEventListener("click", () => {
  if (!state.pendingBackup || !confirm("Importar backup y reemplazar los datos locales actuales?")) {
    return;
  }

  state.movements = state.pendingBackup.movements;
  state.settings = state.pendingBackup.settings;
  state.people = state.pendingBackup.people;
  state.sharedEntries = state.pendingBackup.sharedEntries;
  saveMovements();
  saveSettings();
  savePeople();
  saveSharedEntries();
  state.pendingBackup = null;
  elements.backupFile.value = "";
  elements.backupImport.disabled = true;
  elements.backupStatus.textContent = "Backup importado";
  syncMovementSelects();
  render();
});
