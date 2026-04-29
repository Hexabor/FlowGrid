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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (!email) return;
  submitButton.disabled = true;
  feedback.textContent = "Enviando enlace...";
  try {
    await signInWithMagicLink(email);
    feedback.textContent = "Te hemos enviado un enlace. Abre tu correo y haz clic para entrar.";
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
