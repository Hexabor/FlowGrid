import { renderMovements, syncMovementSelects } from "../features/movements.js";
import { renderAnalysis } from "../features/analysis.js";
import { renderSharedView } from "../features/shared.js";
import { renderContacts } from "../features/contacts.js";
import { renderCategories, renderConcepts } from "../features/settings.js";
import { renderRecurringView } from "../features/recurring.js";
import { renderChangelog } from "./changelog-view.js";

export function render() {
  // Populate the form selects + the inline filter dropdowns BEFORE
  // rendering the views, so the categoria/concepto pickers in the
  // movements filter bar are already filled on first paint instead of
  // waiting for the user to open the new-movement modal for the first
  // time (where syncMovementSelects used to be triggered).
  syncMovementSelects();
  renderMovements();
  renderAnalysis();
  renderSharedView();
  renderContacts();
  renderConcepts();
  renderCategories();
  renderRecurringView();
  renderChangelog();
}
