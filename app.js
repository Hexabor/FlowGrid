import { initState } from "./storage.js";
import { setInitialDate, toggleDatePicker } from "./datepicker.js";
import { render } from "./render.js";
import { closeMovementModal, elements, setView } from "./dom.js";
import { closePaymentModal } from "./shared.js";
import "./csv.js";
import "./backup.js";

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
