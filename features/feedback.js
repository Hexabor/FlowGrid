import { elements } from "../core/dom.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../core/config.js";
import { getAccessToken, getUser } from "../core/supabase.js";

const ENDPOINT = `${SUPABASE_URL}/functions/v1/send-feedback`;

function setStatus(text, kind) {
  elements.feedbackStatus.textContent = text;
  elements.feedbackStatus.dataset.state = kind || "";
}

elements.feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (elements.feedbackForm.classList.contains("is-coming-soon")) {
    setStatus("El formulario aún no está operativo.", "error");
    return;
  }

  const subject = elements.feedbackSubject.value.trim();
  const message = elements.feedbackMessage.value.trim();

  if (message.length < 10) {
    setStatus("Cuéntame un poco más (mínimo 10 caracteres).", "error");
    elements.feedbackMessage.focus();
    return;
  }

  const token = getAccessToken();
  if (!token) {
    setStatus("Tu sesión ha expirado. Recarga la página y vuelve a intentarlo.", "error");
    return;
  }

  elements.feedbackSubmit.disabled = true;
  setStatus("Enviando…", "loading");

  try {
    const user = await getUser();
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        subject,
        message,
        senderEmail: user?.email ?? null,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status} — ${body || "sin detalle"}`);
    }

    elements.feedbackForm.reset();
    setStatus("¡Gracias! Tu feedback ha llegado bien.", "success");
  } catch (error) {
    console.error("[feedback] send failed:", error);
    setStatus(`No se pudo enviar: ${error.message}. Inténtalo de nuevo en un momento.`, "error");
  } finally {
    elements.feedbackSubmit.disabled = false;
  }
});
