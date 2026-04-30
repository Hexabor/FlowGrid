import { initState } from "./core/storage.js";
import { setInitialDate, toggleDatePicker } from "./ui/datepicker.js";
import { render } from "./ui/render.js";
import { closeMovementModal, elements, setView } from "./core/dom.js";
import { closePaymentModal } from "./features/shared.js";
import { onAuthChange } from "./core/supabase.js";
import { cloudHydrate } from "./core/cloud.js";
import { showAuthGate, hideAuthGate, refreshSessionBadge } from "./ui/auth-gate.js";
import "./features/csv.js";
import "./features/backup.js";

let appBooted = false;

async function bootApp() {
  if (appBooted) return;
  appBooted = true;
  console.log("[app] booting");
  try {
    await cloudHydrate();
  } catch (error) {
    console.error("[cloud hydrate]", error);
  }
  initState();
  setInitialDate();
  render();
  refreshSessionBadge();
  console.log("[app] boot complete");
}

// Single source of truth: react to every auth state change. The handler fires
// immediately on registration with INITIAL_SESSION (whether init is already
// done or not), and again on SIGNED_IN/SIGNED_OUT. No race with getSession.
onAuthChange(async (session) => {
  console.log("[app] auth change:", session ? `session for ${session.user.email}` : "no session");
  if (session) {
    hideAuthGate();
    await bootApp();
  } else {
    showAuthGate();
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
