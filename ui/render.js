import { renderMovements } from "../features/movements.js";
import { renderAnalysis } from "../features/analysis.js";
import { renderSharedView } from "../features/shared.js";
import { renderContacts } from "../features/contacts.js";
import { renderCategories, renderConcepts } from "../features/settings.js";
import { renderChangelog } from "./changelog-view.js";

export function render() {
  renderMovements();
  renderAnalysis();
  renderSharedView();
  renderContacts();
  renderConcepts();
  renderCategories();
  renderChangelog();
}
