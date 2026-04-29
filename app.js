import { initState } from "./core/storage.js";
import { setInitialDate, toggleDatePicker } from "./ui/datepicker.js";
import { render } from "./ui/render.js";
import { closeMovementModal, elements, setView } from "./core/dom.js";
import { closePaymentModal } from "./features/shared.js";
import { getSession, onAuthChange } from "./core/supabase.js";
import { cloudHydrate } from "./core/cloud.js";
import { showAuthGate, hideAuthGate, refreshSessionBadge } from "./ui/auth-gate.js";
import "./features/csv.js";
import "./features/backup.js";

let appBooted = false;

async function bootApp() {
  if (appBooted) return;
  appBooted = true;
  try {
    await cloudHydrate();
  } catch (error) {
    console.error("[cloud hydrate]", error);
  }
  initState();
  setInitialDate();
  render();
  refreshSessionBadge();
}

const initialSession = await getSession();
if (initialSession) {
  hideAuthGate();
  await bootApp();
} else {
  showAuthGate();
}

onAuthChange(async (session) => {
  if (session) {
    hideAuthGate();
    await bootApp();
  }
});

elements.navigationTargets.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.viewTarget));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    toggleDatePicker(false);
    closeMovementModal();
    closePaymentModal();
  }
});
