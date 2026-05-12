// Toast transitorio para feedback de acciones puntuales (invitación
// enviada, errores recuperables, etc.). Se crea el contenedor bajo
// demanda y se reutiliza. Solo hay un toast activo: una segunda llamada
// reemplaza el anterior.
//
// API: showToast(text, kind, durationMs)
//   - text: mensaje a mostrar
//   - kind: "success" | "error" | "info" (default "info")
//   - durationMs: tiempo antes de auto-ocultar (default 3500)

let toastEl = null;
let hideTimer = null;

function ensureToast() {
  if (toastEl) return toastEl;
  toastEl = document.createElement("div");
  toastEl.className = "fg-toast";
  toastEl.setAttribute("role", "status");
  toastEl.setAttribute("aria-live", "polite");
  toastEl.hidden = true;
  document.body.append(toastEl);
  return toastEl;
}

export function showToast(text, kind = "info", durationMs = 3500) {
  const el = ensureToast();
  el.textContent = text;
  el.dataset.kind = kind;
  el.hidden = false;
  // Force reflow para que la transición de entrada se aplique siempre,
  // incluso si llamamos dos veces seguidas con el toast aún visible.
  void el.offsetWidth;
  el.classList.add("is-visible");

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    el.classList.remove("is-visible");
    hideTimer = setTimeout(() => {
      el.hidden = true;
    }, 200);
  }, durationMs);
}
