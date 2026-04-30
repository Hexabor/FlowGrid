import { state } from "../core/state.js";
import { elements } from "../core/dom.js";
import { saveMovements, saveContacts, saveSettings, saveSharedEntries } from "../core/storage.js";
import { toIsoDate } from "../core/utils.js";
import { syncMovementSelects } from "./movements.js";
import { render } from "../ui/render.js";

export function exportBackup() {
  const backup = {
    exportedAt: new Date().toISOString(),
    version: 3,
    movements: state.movements,
    settings: state.settings,
    contacts: state.contacts,
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

  // Older backups (v<3) use `people` / `personId`; map them transparently.
  parsed.contacts = Array.isArray(parsed.contacts)
    ? parsed.contacts
    : Array.isArray(parsed.people)
      ? parsed.people
      : [];
  parsed.sharedEntries = Array.isArray(parsed.sharedEntries)
    ? parsed.sharedEntries.map((entry) =>
        entry.contactId || !entry.personId ? entry : { ...entry, contactId: entry.personId }
      )
    : [];

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
  state.contacts = state.pendingBackup.contacts;
  state.sharedEntries = state.pendingBackup.sharedEntries;
  saveMovements();
  saveSettings();
  saveContacts();
  saveSharedEntries();
  state.pendingBackup = null;
  elements.backupFile.value = "";
  elements.backupImport.disabled = true;
  elements.backupStatus.textContent = "Backup importado";
  syncMovementSelects();
  render();
});
