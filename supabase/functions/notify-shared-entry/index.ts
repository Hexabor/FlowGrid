// FlowGrid — aviso por email de gastos compartidos.
//
// Recibe del cliente que CREA un gasto compartido la lista de
// destinatarios (sus contactos vinculados que participan) y un texto de
// saldo ya redactado desde la perspectiva de cada uno. Para cada
// destinatario:
//   1. Verifica que emisor y destinatario están realmente vinculados
//      (contacto recíproco o miembros del mismo grupo). Anti-abuso: nadie
//      puede usar esto para spamear a usuarios cualesquiera.
//   2. Lee el opt-in del DESTINATARIO (settings.notify_shared_email). Si
//      no lo tiene activado, no se envía nada. Desactivado por defecto.
//   3. Resuelve el email verificado real del destinatario (no nos fiamos
//      de un email que venga del cliente).
//   4. Envía el correo vía Resend.
//
// Variables de entorno (supabase secrets set ...):
//   RESEND_API_KEY            API key de Resend.
//   NOTIFY_FROM_EMAIL         Remitente (verificado en Resend). Si falta,
//                             cae a FEEDBACK_FROM_EMAIL.
//   FEEDBACK_FROM_EMAIL       Remitente del feedback (reutilizable).
//   SUPABASE_URL              Inyectada por la plataforma.
//   SUPABASE_ANON_KEY         Inyectada por la plataforma.
//   SUPABASE_SERVICE_ROLE_KEY Inyectada por la plataforma. Necesaria para
//                             leer datos de OTROS usuarios (opt-in, email).
//
// Deploy:  supabase functions deploy notify-shared-entry

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL =
  Deno.env.get("NOTIFY_FROM_EMAIL") ?? Deno.env.get("FEEDBACK_FROM_EMAIL") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_RECIPIENTS = 25;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const serviceHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

// Lectura REST con service role (PostgREST). Devuelve array (vacío si nada).
async function restGet(path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: serviceHeaders,
  });
  if (!res.ok) {
    console.error("[notify] restGet failed", path, res.status, await res.text());
    return [];
  }
  return await res.json();
}

// ¿Están emisor y destinatario vinculados? Contacto recíproco o grupo
// compartido. Sin esto, no se envía (anti-abuso).
async function areLinked(callerId: string, recipientId: string): Promise<boolean> {
  const contactLink = await restGet(
    `contacts?select=id&limit=1&or=(and(owner_id.eq.${callerId},auth_user_id.eq.${recipientId}),and(owner_id.eq.${recipientId},auth_user_id.eq.${callerId}))`
  );
  if (contactLink.length) return true;

  // Grupo compartido: ambos como miembros activos del mismo grupo.
  const callerGroups = await restGet(
    `group_members?select=group_id&auth_user_id=eq.${callerId}&left_at=is.null`
  );
  if (!callerGroups.length) return false;
  const recipientGroups = await restGet(
    `group_members?select=group_id&auth_user_id=eq.${recipientId}&left_at=is.null`
  );
  const callerSet = new Set(callerGroups.map((g) => g.group_id));
  return recipientGroups.some((g) => callerSet.has(g.group_id));
}

async function recipientOptedIn(recipientId: string): Promise<boolean> {
  const rows = await restGet(
    `settings?select=notify_shared_email&owner_id=eq.${recipientId}&limit=1`
  );
  return rows.length > 0 && rows[0].notify_shared_email === true;
}

async function recipientEmail(recipientId: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${recipientId}`, {
    headers: serviceHeaders,
  });
  if (!res.ok) {
    console.error("[notify] admin getUser failed", res.status, await res.text());
    return null;
  }
  const user = await res.json();
  return user?.email ?? null;
}

// Cómo llama el destinatario al emisor (su contacto recíproco). Si no lo
// tiene guardado, caemos al email del emisor.
async function senderNameFor(recipientId: string, callerId: string, fallback: string): Promise<string> {
  const rows = await restGet(
    `contacts?select=name&owner_id=eq.${recipientId}&auth_user_id=eq.${callerId}&limit=1`
  );
  return rows.length && rows[0].name ? rows[0].name : fallback;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!RESEND_API_KEY || !FROM_EMAIL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  // Verificar al emisor con su propio JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
  });
  if (!userRes.ok) {
    return jsonResponse({ error: "Invalid session" }, 401);
  }
  const caller = await userRes.json();
  const callerId: string = caller?.id ?? "";
  const callerEmail: string = caller?.email ?? "FlowGrid";
  if (!callerId) {
    return jsonResponse({ error: "Invalid session" }, 401);
  }

  let payload: {
    expense?: { concept?: string; totalText?: string; date?: string };
    recipients?: Array<{ authUserId?: string; shareText?: string; balanceText?: string }>;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const expense = payload.expense ?? {};
  const concept = (expense.concept ?? "Gasto compartido").toString().slice(0, 200);
  const totalText = (expense.totalText ?? "").toString().slice(0, 40);
  const recipients = Array.isArray(payload.recipients)
    ? payload.recipients.slice(0, MAX_RECIPIENTS)
    : [];

  if (!recipients.length) {
    return jsonResponse({ ok: true, sent: 0 });
  }

  let sent = 0;
  const results: Array<{ recipient: string; status: string }> = [];

  for (const r of recipients) {
    const recipientId = (r.authUserId ?? "").toString();
    if (!recipientId || recipientId === callerId) {
      results.push({ recipient: recipientId, status: "skipped-invalid" });
      continue;
    }

    try {
      if (!(await areLinked(callerId, recipientId))) {
        results.push({ recipient: recipientId, status: "skipped-not-linked" });
        continue;
      }
      if (!(await recipientOptedIn(recipientId))) {
        results.push({ recipient: recipientId, status: "skipped-opted-out" });
        continue;
      }
      const email = await recipientEmail(recipientId);
      if (!email) {
        results.push({ recipient: recipientId, status: "skipped-no-email" });
        continue;
      }
      const senderName = await senderNameFor(recipientId, callerId, callerEmail);
      const shareText = (r.shareText ?? "").toString().slice(0, 40);
      const balanceText = (r.balanceText ?? "").toString().slice(0, 200);

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1a242b;">
          <p style="margin: 0 0 12px;"><strong>${escapeHtml(senderName)}</strong> te ha añadido un gasto compartido en FlowGrid:</p>
          <table style="border-collapse: collapse; margin: 0 0 16px;">
            <tr><td style="padding: 2px 12px 2px 0; color: #5a6b73;">Concepto</td><td style="padding: 2px 0;"><strong>${escapeHtml(concept)}</strong></td></tr>
            ${totalText ? `<tr><td style="padding: 2px 12px 2px 0; color: #5a6b73;">Total</td><td style="padding: 2px 0;">${escapeHtml(totalText)}</td></tr>` : ""}
            ${shareText ? `<tr><td style="padding: 2px 12px 2px 0; color: #5a6b73;">Tu parte</td><td style="padding: 2px 0;"><strong>${escapeHtml(shareText)}</strong></td></tr>` : ""}
          </table>
          ${balanceText ? `<p style="margin: 0 0 16px; padding: 10px 14px; background: #f5f7f8; border-radius: 8px;">Saldo con ${escapeHtml(senderName)}: <strong>${escapeHtml(balanceText)}</strong></p>` : ""}
          <hr style="border: 0; border-top: 1px solid #d8e0e4; margin: 16px 0;">
          <p style="margin: 0; font-size: 12px; color: #8a979e;">Recibes este aviso porque lo activaste en FlowGrid → Configuración → Avisos. Puedes desactivarlo cuando quieras desde ahí.</p>
        </div>
      `;

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: `FlowGrid <${FROM_EMAIL}>`,
          to: [email],
          subject: `[FlowGrid] ${senderName} te añadió un gasto compartido`,
          html,
        }),
      });

      if (!resendRes.ok) {
        console.error("[notify] Resend error", resendRes.status, await resendRes.text());
        results.push({ recipient: recipientId, status: "send-failed" });
        continue;
      }
      sent += 1;
      results.push({ recipient: recipientId, status: "sent" });
    } catch (err) {
      console.error("[notify] recipient failed", recipientId, err);
      results.push({ recipient: recipientId, status: "error" });
    }
  }

  return jsonResponse({ ok: true, sent, results });
});
