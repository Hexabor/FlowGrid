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
  if (user) userBadge.textContent = user.email ?? "";
  else userBadge.textContent = "";
}

function surfaceUrlAuthInfo() {
  const hash = window.location.hash;
  const search = window.location.search;
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : search.slice(1));
  const error = params.get("error_description") || params.get("error");
  if (error) {
    feedback.textContent = `Error en el enlace: ${decodeURIComponent(error)}`;
    return;
  }
  if (params.get("code") || params.get("access_token")) {
    feedback.textContent = "Procesando enlace...";
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
