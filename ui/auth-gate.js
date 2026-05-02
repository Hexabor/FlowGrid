import { signInWithMagicLink, signOut, getUser } from "../core/supabase.js";

const gate = document.getElementById("auth-gate");
const form = document.getElementById("auth-form");
const emailInput = document.getElementById("auth-email");
const submitButton = document.getElementById("auth-submit");
const feedback = document.getElementById("auth-feedback");
const userBadge = document.getElementById("auth-user");
const logoutButton = document.getElementById("auth-logout");

export function showAuthGate() {
  gate.hidden = false;
  document.body.classList.add("is-locked");
  surfaceUrlAuthInfo();
}

export function hideAuthGate() {
  gate.hidden = true;
  document.body.classList.remove("is-locked");
}

export async function refreshSessionBadge() {
  const user = await getUser();
  const email = user?.email ?? "";
  userBadge.textContent = email;
  if (email) userBadge.title = email;
  else userBadge.removeAttribute("title");
}

function surfaceUrlAuthInfo() {
  const initial = window.__FG_INITIAL_URL__;
  if (!initial) return;
  if (initial.error) {
    feedback.textContent = `Error en el enlace: ${decodeURIComponent(initial.error)}`;
    return;
  }
  if (initial.hasAccessToken || initial.hasCode) {
    // The link came back with auth params but the session never got created.
    // Surface this so the user can see the failure rather than land silently
    // back on the form.
    const kind = initial.hasAccessToken ? "access_token" : "code";
    feedback.textContent = `El enlace trajo ${kind} pero no se creo sesion. Mira la consola para detalles.`;
    console.warn("[auth gate] redirect arrived with", kind, "but no session was created. URL:", initial.href);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (!email) return;
  submitButton.disabled = true;
  feedback.textContent = "Enviando enlace...";
  try {
    await signInWithMagicLink(email);
    feedback.textContent = "Te hemos enviado un enlace. Abrelo en este mismo navegador.";
  } catch (error) {
    feedback.textContent = `Error: ${error.message ?? error}`;
  } finally {
    submitButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut();
  location.reload();
});
