// Fase 3 paso 3 — invitaciones a contactos.
//
// Flow:
//   1. The inviter opens Configuración → Contactos, picks a contact with
//      a non-empty email, and clicks "Invitar". sendInvitation triggers
//      Supabase magic-link to that email and stamps the local contact
//      with invitedAt so the UI can show "Reinvitar" the next time.
//   2. The invitee receives the email, clicks the magic link, and lands
//      back on FlowGrid with a fresh session. checkPendingInvitations
//      runs after cloudHydrate completes and finds any contact rows that
//      (a) have email matching their verified email and (b) haven't been
//      claimed yet (auth_user_id IS NULL). RLS exposes only those.
//   3. The invitation modal lists each pending invite. On Aceptar we
//      PATCH the contact row setting auth_user_id = my uid (RLS allows
//      this exact transition via the "invitee can claim by email"
//      policy). Re-hydrate so the now-visible shared_entries from the
//      inviter land in local state.

import { state } from "../core/state.js";
import { elements } from "../core/dom.js";
import { saveContacts } from "../core/storage.js";
import { createId } from "../core/utils.js";
import { signInWithMagicLink, getUserId, getAccessToken, getUser } from "../core/supabase.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../core/config.js";
import { cloudHydrate } from "../core/cloud.js";
import { renderSharedView } from "./shared.js";
import { renderContacts } from "./contacts.js";
import { renderMovements } from "./movements.js";

function authHeaders() {
  const token = getAccessToken();
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
  };
}

export async function sendInvitation(contact) {
  if (!contact?.email) {
    throw new Error("El contacto no tiene email.");
  }
  await signInWithMagicLink(contact.email);
  contact.invitedAt = new Date().toISOString();
  saveContacts();
  renderContacts();
}

export async function fetchPendingInvitations() {
  const user = await getUser();
  if (!user?.email) return [];

  const url =
    `${SUPABASE_URL}/rest/v1/contacts` +
    `?auth_user_id=is.null` +
    `&email=eq.${encodeURIComponent(user.email)}` +
    `&select=*`;

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    console.error("[invitations] fetch failed", res.status, await res.text());
    return [];
  }
  const all = await res.json();
  // Exclude rows the visiting user owns themselves (e.g. they created a
  // contact with their own email by mistake — they don't want to "accept"
  // an invitation from themselves).
  return all.filter((row) => row.owner_id !== user.id);
}

export async function acceptInvitation(contactId) {
  const myUid = await getUserId();
  if (!myUid) throw new Error("Sin sesión.");

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/contacts?id=eq.${encodeURIComponent(contactId)}`,
    {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ auth_user_id: myUid }),
    }
  );
  if (!res.ok) {
    throw new Error(`accept failed: ${res.status} ${await res.text()}`);
  }
}

function setInvitationFeedback(text, kind) {
  elements.invitationFeedback.textContent = text;
  elements.invitationFeedback.dataset.state = kind || "";
}

function renderInvitationList(invitations) {
  elements.invitationList.innerHTML = "";
  invitations.forEach((invitation) => {
    const item = document.createElement("li");
    item.className = "invitation-item";
    item.dataset.contactId = invitation.id;
    // Cache the inviter info on the DOM node so the click handler can
    // build the reciprocal contact without re-fetching.
    item.dataset.ownerId = invitation.owner_id;
    item.dataset.ownerEmail = invitation.owner_email ?? "";
    item.dataset.invitationName = invitation.name ?? "";

    const text = document.createElement("div");
    text.className = "invitation-item-text";
    const headline = document.createElement("strong");
    headline.textContent = invitation.owner_email
      ? `${invitation.owner_email} te ha invitado`
      : `Te han invitado como "${invitation.name}"`;
    const sub = document.createElement("small");
    sub.textContent = invitation.invited_at
      ? `Enviada el ${new Date(invitation.invited_at).toLocaleDateString("es-ES")}`
      : "Pendiente de aceptar";
    text.append(headline, sub);

    const acceptButton = document.createElement("button");
    acceptButton.type = "button";
    acceptButton.className = "primary-action";
    acceptButton.dataset.action = "accept-invitation";
    acceptButton.textContent = "Aceptar";

    item.append(text, acceptButton);
    elements.invitationList.append(item);
  });
}

function openInvitationModal(invitations) {
  renderInvitationList(invitations);
  setInvitationFeedback("", "");
  elements.invitationModal.hidden = false;
}

export function closeInvitationModal() {
  elements.invitationModal.hidden = true;
}

export async function checkPendingInvitations() {
  try {
    const invitations = await fetchPendingInvitations();
    if (invitations.length) {
      openInvitationModal(invitations);
    }
  } catch (error) {
    console.error("[invitations] check failed:", error);
  }
}

// Backfills run on every boot so prior invitations (accepted before the
// reciprocal-contact auto-create existed) and contacts saved before the
// owner_email column landed self-heal without any user action.

async function backfillOwnerEmailOnOwnContacts() {
  const user = await getUser();
  if (!user?.email) return;
  const needsBackfill = state.contacts.filter((c) => !c.ownerEmail);
  if (!needsBackfill.length) return;
  needsBackfill.forEach((c) => {
    c.ownerEmail = user.email;
  });
  saveContacts();
}

async function backfillReciprocalContacts() {
  const myUid = await getUserId();
  if (!myUid) return;
  const partnerIds = new Set(
    state.sharedEntries
      .filter((e) => e.ownerId && e.ownerId !== myUid)
      .map((e) => e.ownerId)
  );
  if (!partnerIds.size) return;

  let created = false;
  for (const partnerId of partnerIds) {
    if (state.contacts.some((c) => c.authUserId === partnerId)) continue;

    // Look up the partner's contact (the one that links me) via the
    // "linked partner can read" RLS policy. This row sits in the
    // partner's account; we read it cross-account purely to pull out
    // their owner_email.
    let partnerEmail = "";
    try {
      const url =
        `${SUPABASE_URL}/rest/v1/contacts` +
        `?owner_id=eq.${partnerId}&auth_user_id=eq.${myUid}` +
        `&select=owner_email,name`;
      const res = await fetch(url, { headers: authHeaders() });
      if (res.ok) {
        const rows = await res.json();
        partnerEmail = rows[0]?.owner_email ?? "";
      }
    } catch (error) {
      console.warn("[invitations] reciprocal lookup failed:", error);
    }

    state.contacts.push({
      id: createId(),
      name: nameFromEmail(partnerEmail) || "Vinculado",
      email: partnerEmail,
      invitedAt: null,
      authUserId: partnerId,
      ownerEmail: null,
      createdAt: new Date().toISOString(),
    });
    created = true;
  }

  if (created) {
    saveContacts();
    renderContacts();
    renderSharedView();
    renderMovements();
  }
}

export async function runInvitationBackfills() {
  try {
    await backfillOwnerEmailOnOwnContacts();
    await backfillReciprocalContacts();
  } catch (error) {
    console.error("[invitations] backfill failed:", error);
  }
}

elements.closeInvitationModal.addEventListener("click", closeInvitationModal);

elements.invitationModal.addEventListener("click", (event) => {
  if (event.target === elements.invitationModal) {
    closeInvitationModal();
  }
});

function nameFromEmail(email) {
  if (!email) return "Cuenta vinculada";
  const local = String(email).split("@")[0];
  return local || email;
}

function ensureReciprocalContact({ ownerId, ownerEmail }) {
  // Skip if the invitee already has a contact pointing at this user.
  if (state.contacts.some((c) => c.authUserId === ownerId)) return;
  const reciprocal = {
    id: createId(),
    name: nameFromEmail(ownerEmail),
    email: ownerEmail || "",
    invitedAt: null,
    authUserId: ownerId,
    ownerEmail: null, // owner is ME (the invitee); the trigger will fill this
    createdAt: new Date().toISOString(),
  };
  state.contacts = [...state.contacts, reciprocal];
  saveContacts();
}

elements.invitationList.addEventListener("click", async (event) => {
  const button = event.target.closest('[data-action="accept-invitation"]');
  if (!button) return;
  const item = button.closest("[data-contact-id]");
  if (!item) return;
  const contactId = item.dataset.contactId;
  const ownerId = item.dataset.ownerId;
  const ownerEmail = item.dataset.ownerEmail || "";

  button.disabled = true;
  setInvitationFeedback("Aceptando…", "loading");
  try {
    await acceptInvitation(contactId);
    item.remove();
    setInvitationFeedback(
      "Invitación aceptada. Cargando datos compartidos…",
      "success"
    );
    // Auto-create a reciprocal contact in the invitee's account so the
    // inviter shows up in their contacts list and shared entries can be
    // displayed under that name. Pre-fills name from the email's local
    // part; the user can rename later.
    ensureReciprocalContact({ ownerId, ownerEmail });
    // Re-hydrate so the newly-visible shared_entries from the inviter
    // (now reachable via the linked-partner RLS clause) land in state.
    await cloudHydrate();
    renderMovements();
    renderSharedView();
    renderContacts();
    setInvitationFeedback("¡Listo! Ya puedes ver los gastos compartidos.", "success");
    if (!elements.invitationList.children.length) {
      // No more invitations to show — close after a short beat.
      setTimeout(closeInvitationModal, 1200);
    }
  } catch (error) {
    console.error("[invitations] accept failed:", error);
    setInvitationFeedback(
      `No se pudo aceptar: ${error.message ?? error}. Inténtalo de nuevo.`,
      "error"
    );
    button.disabled = false;
  }
});
