// Avisos por email de gastos compartidos (opt-in del destinatario).
//
// Cuando el usuario crea un gasto compartido, este módulo resuelve a
// QUIÉN hay que avisar (contactos vinculados que participan), redacta el
// saldo resultante DESDE LA PERSPECTIVA DEL DESTINATARIO y dispara una
// llamada a la Edge Function `notify-shared-entry`. La función es la que
// decide de verdad si manda el correo: comprueba que ambos estén
// vinculados, lee el opt-in del destinatario y resuelve su email real.
//
// Diseño deliberado (Opción A — disparado por el cliente que crea el
// gasto): como el sync re-sube TODAS las entradas en cada guardado, un
// trigger en base de datos provocaría tormentas de emails. El cliente,
// en cambio, sabe exactamente cuál es el gasto nuevo, así que avisamos
// una sola vez y solo en creación real (no en edición ni en la
// materialización de recurrentes).
//
// No duplicamos el cálculo de saldo en el servidor: el cliente ya lo
// tiene calculado para su propia UI, así que manda el texto ya hecho.

import { state } from "../core/state.js";
import { getContact, getSharedBalance } from "./contacts.js";
import { getGroupMembers, getMyMemberInGroup } from "./groups.js";
import { getUserIdSync, getAccessToken } from "../core/supabase.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../core/config.js";
import { formatMoney } from "../core/utils.js";

// El slug de la función se fija al desplegarla por primera vez. Si al
// hacer `supabase functions deploy notify-shared-entry` Supabase le
// asigna otro slug, ajusta esta constante.
const ENDPOINT = `${SUPABASE_URL}/functions/v1/notify-shared-entry`;

// True si tengo algún adelanto vivo con este contacto. Sirve para
// añadir "(incluye tus adelantos)" al texto del saldo, que es justo el
// caso que da valor a esta función.
function hasAdvancesWithContact(contactId) {
  return state.sharedEntries.some(
    (e) =>
      e.contactId === contactId &&
      e.type === "payment" &&
      e.advance &&
      !e.settledAt
  );
}

// Redacta el saldo total con un contacto DESDE LA PERSPECTIVA del
// destinatario. getSharedBalance devuelve mi perspectiva (positivo = me
// debe); para el correo del otro hay que invertir el signo.
function balanceTextForContact(contactId) {
  const myBalance = getSharedBalance(contactId);
  const advancesNote = hasAdvancesWithContact(contactId) ? " (incluye tus adelantos)" : "";
  if (Math.abs(myBalance) < 0.005) {
    return "Estáis en paz.";
  }
  if (myBalance > 0) {
    // El contacto me debe → desde su lado, él debe.
    return `Le debes ${formatMoney(myBalance)}${advancesNote}.`;
  }
  // Yo le debo → desde su lado, le deben.
  return `Te deben ${formatMoney(-myBalance)}${advancesNote}.`;
}

// Construye la lista de destinatarios de un gasto recién creado.
// Cada uno: { authUserId, share, balanceText }. Solo incluye contactos
// vinculados (con authUserId) distintos de mí.
function resolveRecipients(entry) {
  const myUid = getUserIdSync();
  const recipients = [];

  if (entry.groupId && entry.splits) {
    const myMember = getMyMemberInGroup(entry.groupId);
    const members = getGroupMembers(entry.groupId, { includeInactive: false });
    for (const member of members) {
      if (!member.authUserId) continue;
      if (member.authUserId === myUid) continue;
      if (myMember && member.id === myMember.id) continue;
      const split = entry.splits[member.id];
      const owes = Number(split?.owes) || 0;
      if (owes <= 0) continue; // solo a quien le toca pagar algo
      // Si ese miembro mapea a uno de mis contactos, puedo dar el saldo
      // total con él; si no, omito la línea de saldo.
      const myContact = state.contacts.find((c) => c.authUserId === member.authUserId);
      recipients.push({
        authUserId: member.authUserId,
        shareText: formatMoney(owes),
        balanceText: myContact ? balanceTextForContact(myContact.id) : "",
      });
    }
    return recipients;
  }

  // Caso 1↔1.
  const contact = getContact(entry.contactId);
  if (contact?.authUserId && contact.authUserId !== myUid) {
    recipients.push({
      authUserId: contact.authUserId,
      shareText: formatMoney(Number(entry.theirShare) || 0),
      balanceText: balanceTextForContact(contact.id),
    });
  }
  return recipients;
}

// Dispara el aviso de un gasto compartido recién creado. Fire-and-forget:
// nunca bloquea ni rompe el guardado; los errores solo se loguean.
export function notifyNewSharedExpense(entry) {
  try {
    if (!entry || entry.type !== "expense") return;
    const recipients = resolveRecipients(entry);
    if (!recipients.length) return;

    const token = getAccessToken();
    if (!token) return;

    const payload = {
      expense: {
        concept: entry.concept || "Gasto compartido",
        totalText: formatMoney(Number(entry.total) || 0),
        date: entry.date,
      },
      recipients,
    };

    // Background, sin await: no debe afectar al flujo del formulario.
    fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    }).catch((err) => console.error("[notify] send failed:", err));
  } catch (err) {
    console.error("[notify] resolve failed:", err);
  }
}
