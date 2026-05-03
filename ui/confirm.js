// Generic confirmation modal. Used wherever a destructive action needs
// more than a one-liner — recurring movements, recurring templates, and
// (eventually) any other robust-delete flow.
//
// API: showConfirm({ title, message, extra, actions })
//   - title: short header (e.g., "Borrar movimiento recurrente")
//   - message: main body line. Plain text — no HTML.
//   - extra: optional secondary line in muted color. Plain text.
//   - actions: array of action descriptors:
//       { label, kind, onClick, requireDoubleConfirm? }
//     kind: "primary" | "secondary" | "danger"
//     requireDoubleConfirm: when true, the first click changes the
//       button's label to "¿Seguro? Pulsa otra vez" and only the second
//       click within 4s actually fires onClick. Otherwise resets.
//
// The modal is closed automatically once an action runs (unless the
// onClick returns the literal string "keep-open"). Cancel button + X +
// Escape also close it.

import { elements } from "../core/dom.js";

let activeDoubleConfirm = null;
let doubleConfirmTimer = null;

function closeModal() {
  elements.confirmModal.hidden = true;
  cancelDoubleConfirm();
  // Wipe content so a stale callback can't fire on a stale button.
  elements.confirmActions.innerHTML = "";
  elements.confirmExtra.hidden = true;
  elements.confirmExtra.textContent = "";
}

function cancelDoubleConfirm() {
  if (doubleConfirmTimer) {
    clearTimeout(doubleConfirmTimer);
    doubleConfirmTimer = null;
  }
  if (activeDoubleConfirm) {
    activeDoubleConfirm.button.textContent = activeDoubleConfirm.originalLabel;
    activeDoubleConfirm.button.classList.remove("is-armed");
  }
  activeDoubleConfirm = null;
}

function armDoubleConfirm(button, originalLabel) {
  cancelDoubleConfirm();
  button.textContent = "¿Seguro? Pulsa otra vez";
  button.classList.add("is-armed");
  activeDoubleConfirm = { button, originalLabel };
  doubleConfirmTimer = setTimeout(() => {
    cancelDoubleConfirm();
  }, 4000);
}

export function showConfirm({ title, message, extra, actions }) {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  if (extra) {
    elements.confirmExtra.textContent = extra;
    elements.confirmExtra.hidden = false;
  } else {
    elements.confirmExtra.hidden = true;
    elements.confirmExtra.textContent = "";
  }

  elements.confirmActions.innerHTML = "";

  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    const kindClass =
      action.kind === "danger"
        ? "danger-action"
        : action.kind === "primary"
          ? "primary-action"
          : "ghost-action";
    btn.className = `confirm-action ${kindClass}`;
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      if (action.requireDoubleConfirm) {
        if (activeDoubleConfirm?.button !== btn) {
          armDoubleConfirm(btn, action.label);
          return;
        }
        // Second click within the 4s window: fall through to fire.
      }
      const result = action.onClick?.();
      if (result !== "keep-open") closeModal();
    });
    elements.confirmActions.append(btn);
  }

  elements.confirmModal.hidden = false;
}

export function closeConfirmModal() {
  closeModal();
}

elements.closeConfirmModal?.addEventListener("click", closeModal);
elements.confirmModal?.addEventListener("click", (event) => {
  if (event.target === elements.confirmModal) closeModal();
});
