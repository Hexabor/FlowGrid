// FlowGrid feedback forwarder.
//
// Receives a JSON payload from the client (`{ subject, message, senderEmail }`),
// verifies the caller is an authenticated FlowGrid user, and forwards the
// feedback as an email via Resend to the project owner.
//
// Environment variables required (set via `supabase secrets set ...`):
//   RESEND_API_KEY      Resend API key with sending access.
//   FEEDBACK_TO_EMAIL   Recipient address (where feedback should land).
//   FEEDBACK_FROM_EMAIL Sender address (must be verified in Resend, e.g.
//                       noreply@arcdev.app).
//
// Deploy:  supabase functions deploy send-feedback

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FEEDBACK_TO = Deno.env.get("FEEDBACK_TO_EMAIL") ?? "";
const FEEDBACK_FROM = Deno.env.get("FEEDBACK_FROM_EMAIL") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!RESEND_API_KEY || !FEEDBACK_TO || !FEEDBACK_FROM) {
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Verify the caller using their JWT.
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse({ error: "Invalid session" }, 401);
  }
  const userEmail = userData.user.email ?? "(unknown)";

  let payload: { subject?: string; message?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const subject = (payload.subject ?? "").toString().trim().slice(0, 120);
  const message = (payload.message ?? "").toString().trim();
  if (message.length < 10) {
    return jsonResponse({ error: "Message too short" }, 400);
  }
  if (message.length > 3000) {
    return jsonResponse({ error: "Message too long" }, 400);
  }

  const safeSubject = subject || "Feedback";
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1a242b;">
      <p style="margin: 0 0 12px;"><strong>De:</strong> ${escapeHtml(userEmail)}</p>
      <p style="margin: 0 0 12px;"><strong>Asunto:</strong> ${escapeHtml(safeSubject)}</p>
      <hr style="border: 0; border-top: 1px solid #d8e0e4; margin: 16px 0;">
      <pre style="white-space: pre-wrap; font-family: inherit; font-size: 14px; margin: 0;">${escapeHtml(message)}</pre>
    </div>
  `;

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: `FlowGrid Feedback <${FEEDBACK_FROM}>`,
      to: [FEEDBACK_TO],
      reply_to: userEmail,
      subject: `[FlowGrid] ${safeSubject}`,
      html,
    }),
  });

  if (!resendResponse.ok) {
    const detail = await resendResponse.text();
    console.error("[send-feedback] Resend error", resendResponse.status, detail);
    return jsonResponse({ error: "Email delivery failed" }, 502);
  }

  return jsonResponse({ ok: true });
});
