// Append-only audit log for shared expense edits.
//
// Every save of a shared_entry (mine or the partner's, edited via the
// symmetric-edit shortcut) inserts a row in shared_entry_edits with
// who, when, a short summary of what changed and an optional comment
// from the editor. The other side can open a small history modal on
// any entry to see the edits, so a partner editing your record never
// goes unnoticed.
//
// The log is append-only: no UPDATE or DELETE RLS policies exist for
// shared_entry_edits, so old rows are immutable.

import { elements } from "../core/dom.js";
import { createId, formatMoney } from "../core/utils.js";
import { getAccessToken, getUser } from "../core/supabase.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../core/config.js";

function authHeaders() {
  const token = getAccessToken();
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
  };
}

function quoteShort(value) {
  if (!value) return "(vacío)";
  const s = String(value);
  return s.length > 50 ? `"${s.slice(0, 47)}…"` : `"${s}"`;
}

function paidByLabel(paidBy) {
  return paidBy === "me" ? "tú" : "el contacto";
}

function splitModeLabel(splitMode) {
  if (splitMode === "equal") return "partes iguales";
  if (splitMode === "uneven") return "partes desiguales";
  if (splitMode === "full") return "deuda completa";
  if (splitMode === "payment") return "pago";
  return splitMode || "?";
}

function buildSummary(oldEntry, newEntry) {
  if (!oldEntry) return "Entrada creada";
  const changes = [];
  if (Math.abs((oldEntry.total ?? 0) - (newEntry.total ?? 0)) > 0.005) {
    changes.push(`importe ${formatMoney(oldEntry.total)} → ${formatMoney(newEntry.total)}`);
  }
  if ((oldEntry.concept ?? "") !== (newEntry.concept ?? "")) {
    changes.push(`concepto ${quoteShort(oldEntry.concept)} → ${quoteShort(newEntry.concept)}`);
  }
  if ((oldEntry.note ?? "") !== (newEntry.note ?? "")) {
    changes.push(`nota ${quoteShort(oldEntry.note)} → ${quoteShort(newEntry.note)}`);
  }
  if (oldEntry.date !== newEntry.date) {
    changes.push(`fecha ${oldEntry.date} → ${newEntry.date}`);
  }
  if (oldEntry.paidBy !== newEntry.paidBy) {
    changes.push(`pagador: ${paidByLabel(oldEntry.paidBy)} → ${paidByLabel(newEntry.paidBy)}`);
  }
  if (oldEntry.splitMode !== newEntry.splitMode) {
    changes.push(`modo: ${splitModeLabel(oldEntry.splitMode)} → ${splitModeLabel(newEntry.splitMode)}`);
  }
  if (Math.abs((oldEntry.myShare ?? 0) - (newEntry.myShare ?? 0)) > 0.005) {
    changes.push(`tu parte ${formatMoney(oldEntry.myShare)} → ${formatMoney(newEntry.myShare)}`);
  }
  if (Math.abs((oldEntry.theirShare ?? 0) - (newEntry.theirShare ?? 0)) > 0.005) {
    changes.push(`su parte ${formatMoney(oldEntry.theirShare)} → ${formatMoney(newEntry.theirShare)}`);
  }
  if ((oldEntry.contactId ?? "") !== (newEntry.contactId ?? "")) {
    changes.push("contacto");
  }
  if ((oldEntry.settledAt ?? null) !== (newEntry.settledAt ?? null)) {
    changes.push(newEntry.settledAt ? "marcado como liquidado" : "reabierto");
  }
  const oldSM = oldEntry.settledMembers || {};
  const newSM = newEntry.settledMembers || {};
  const added = Object.keys(newSM).filter((k) => !oldSM[k]);
  const removed = Object.keys(oldSM).filter((k) => !newSM[k]);
  if (added.length) {
    changes.push(
      added.length === 1
        ? "parte de un miembro marcada como liquidada"
        : `partes de ${added.length} miembros marcadas como liquidadas`
    );
  }
  if (removed.length) {
    changes.push(
      removed.length === 1
        ? "parte de un miembro reabierta"
        : `partes de ${removed.length} miembros reabiertas`
    );
  }
  return changes.length ? changes.join(", ") : "sin cambios materiales";
}

export async function recordSharedEntryEdit(oldEntry, newEntry, comment) {
  const user = await getUser();
  if (!user) return;
  const summary = buildSummary(oldEntry, newEntry);
  const row = {
    id: createId(),
    entry_id: newEntry.id,
    editor_id: user.id,
    editor_email: user.email ?? "",
    edited_at: new Date().toISOString(),
    summary,
    comment: (comment ?? "").trim(),
  };
  console.log("[edit-log] recording", { entryId: newEntry.id, summary });
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/shared_entry_edits`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      console.warn("[edit-log] insert non-ok:", res.status, await res.text());
    }
  } catch (error) {
    console.error("[edit-log] record failed:", error);
  }
}

async function fetchEditsForEntry(entryId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/shared_entry_edits` +
        `?entry_id=eq.${encodeURIComponent(entryId)}` +
        `&order=edited_at.desc&select=*`,
      { headers: authHeaders() }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch (error) {
    console.error("[edit-log] fetch failed:", error);
    return [];
  }
}

function renderHistoryList(edits) {
  elements.historyList.innerHTML = "";
  if (!edits.length) {
    elements.historyList.innerHTML =
      '<p class="empty-state">No hay cambios registrados todavía.</p>';
    return;
  }
  edits.forEach((edit) => {
    const item = document.createElement("article");
    item.className = "history-item";

    const meta = document.createElement("div");
    meta.className = "history-meta";
    const editor = document.createElement("strong");
    editor.textContent = edit.editor_email || "(sin email)";
    const when = document.createElement("small");
    when.textContent = new Date(edit.edited_at).toLocaleString("es-ES");
    meta.append(editor, when);

    const summary = document.createElement("p");
    summary.className = "history-summary";
    summary.textContent = edit.summary || "(sin descripción)";

    item.append(meta, summary);

    if (edit.comment) {
      const comment = document.createElement("p");
      comment.className = "history-comment";
      comment.textContent = `“${edit.comment}”`;
      item.append(comment);
    }

    elements.historyList.append(item);
  });
}

export async function openHistoryModal(entryId) {
  elements.historyTitle.textContent = "Historial de cambios";
  elements.historyList.innerHTML =
    '<p class="empty-state">Cargando…</p>';
  elements.historyModal.hidden = false;
  const edits = await fetchEditsForEntry(entryId);
  renderHistoryList(edits);
}

export function closeHistoryModal() {
  elements.historyModal.hidden = true;
}

elements.closeHistoryModal.addEventListener("click", closeHistoryModal);
elements.historyModal.addEventListener("click", (event) => {
  if (event.target === elements.historyModal) closeHistoryModal();
});
