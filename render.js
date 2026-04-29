import { renderMovements } from "./movements.js";
import { renderAnalysis } from "./analysis.js";
import { renderSharedView } from "./shared.js";
import { renderPeople } from "./people.js";
import { renderCategories, renderConcepts } from "./settings.js";
import { renderChangelog } from "./changelog-view.js";

export function render() {
  renderMovements();
  renderAnalysis();
  renderSharedView();
  renderPeople();
  renderConcepts();
  renderCategories();
  renderChangelog();
}
