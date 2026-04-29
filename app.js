import { initState } from "./core/storage.js";
import { setInitialDate, toggleDatePicker } from "./ui/datepicker.js";
import { render } from "./ui/render.js";
import { closeMovementModal, elements, setView } from "./core/dom.js";
import { closePaymentModal } from "./features/shared.js";
import "./features/csv.js";
import "./features/backup.js";

initState();
setInitialDate();
render();

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
