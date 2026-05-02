import { initState } from "./core/storage.js";
import { setInitialDate, toggleDatePicker } from "./ui/datepicker.js";
import { render } from "./ui/render.js";
import { closeMovementModal, elements, restoreLastView, setView } from "./core/dom.js";
import { closePaymentModal } from "./features/shared.js";
import { collapseExpandedCard } from "./features/movements.js";
import { checkPendingInvitations, closeInvitationModal, runInvitationBackfills } from "./features/invitations.js";
import { closeHistoryModal } from "./features/edit-log.js";
import { onAuthChange } from "./core/supabase.js";
import { cloudHydrate } from "./core/cloud.js";
import { showAuthGate, hideAuthGate, refreshSessionBadge } from "./ui/auth-gate.js";
import "./features/csv.js";
import "./features/backup.js";
import "./features/feedback.js";

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
  restoreLastView();
  // Self-heal any prior invitations that were accepted before the
  // reciprocal-contact auto-create existed, and populate owner_email
  // on contacts saved before that column was around. Both are no-ops
  // when nothing needs fixing.
  await runInvitationBackfills();
  // Surface any pending invitations addressed to this user's email. Runs
  // last so the rest of the app is already painted underneath the modal.
  checkPendingInvitations();
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
    closeInvitationModal();
    closeHistoryModal();
    collapseExpandedCard();
    document.querySelectorAll('.info-button[aria-expanded="true"]').forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  }
});

// Persist the open/closed state of the Compartidos info callout. Default is
// open; once the user collapses it, we remember that across reloads.
elements.sharedCallout?.addEventListener("toggle", () => {
  try {
    localStorage.setItem(
      "flowgrid.shared.callout.collapsed.v1",
      elements.sharedCallout.open ? "0" : "1"
    );
  } catch {
    // localStorage unavailable; ignore.
  }
});

// Toggle for info tooltips: hover works via CSS on desktop; on mobile the
// user taps and we flip aria-expanded so the tooltip stays open until they
// tap outside or press Escape.
document.addEventListener("click", (event) => {
  const button = event.target.closest(".info-button");
  if (button) {
    event.preventDefault();
    const wasOpen = button.getAttribute("aria-expanded") === "true";
    document.querySelectorAll('.info-button[aria-expanded="true"]').forEach((other) => {
      if (other !== button) other.setAttribute("aria-expanded", "false");
    });
    button.setAttribute("aria-expanded", wasOpen ? "false" : "true");
    return;
  }
  if (!event.target.closest(".info-tooltip")) {
    document.querySelectorAll('.info-button[aria-expanded="true"]').forEach((open) => {
      open.setAttribute("aria-expanded", "false");
    });
  }
});
