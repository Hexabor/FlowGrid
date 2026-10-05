// Aviso de cambios sin subir a la nube. Antes un fallo de subida solo
// quedaba en la consola y el usuario creía que todo estaba guardado.
// Ahora, si la cola de core/cloud.js no consigue vaciarse, aparece una
// pastilla fija con el número de cambios pendientes; pulsarla reintenta.
// Mientras la subida va bien no se muestra nada.

import { onSyncStatus, retrySyncNow } from "../core/cloud.js";
import { showToast } from "./toast.js";

let pill = null;
let wasFailing = false;
let seenRejected = 0;

function ensurePill() {
  if (pill) return pill;
  pill = document.createElement("button");
  pill.type = "button";
  pill.className = "fg-sync-pill";
  pill.hidden = true;
  pill.addEventListener("click", async () => {
    pill.disabled = true;
    pill.textContent = "Subiendo…";
    await retrySyncNow();
    pill.disabled = false;
  });
  document.body.append(pill);
  return pill;
}

onSyncStatus(({ pending, error, rejected }) => {
  const el = ensurePill();
  const failing = Boolean(error) && pending > 0;

  if (failing) {
    el.textContent = pending === 1
      ? "1 cambio sin subir a la nube · Reintentar"
      : `${pending} cambios sin subir a la nube · Reintentar`;
    el.title = "Están guardados en este dispositivo y se subirán solos en cuanto haya conexión.";
  }
  el.hidden = !failing;

  if (wasFailing && !failing && pending === 0) {
    showToast("Cambios subidos a la nube.", "success");
  }
  wasFailing = failing;

  if (rejected > seenRejected) {
    seenRejected = rejected;
    showToast("La nube ha rechazado un cambio. Avísame para revisarlo.", "error", 8000);
  }
});
