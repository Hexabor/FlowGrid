import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: "implicit",
    // Default lock uses navigator.locks. We had it hang getSession() forever
    // when the lock got into a stale state. FlowGrid is single-tab anyway, so
    // a no-op lock is safe and removes the hang entirely.
    lock: async (_name, _timeout, fn) => fn(),
  },
});

// Module-level cache of the current session, fed by onAuthStateChange. We use
// this instead of calling supabase.auth.getSession() because that call has been
// hanging in production even with the no-op lock. The cached value is enough
// for reading user identity; supabase-js handles its own auth-token internals
// for outgoing requests separately.
let cachedSession = null;

supabase.auth.onAuthStateChange((event, session) => {
  cachedSession = session;
  console.log("[supabase auth]", event, session ? `session for ${session.user.email}` : "no session");
});

export async function getSession() {
  return cachedSession;
}

export async function getUser() {
  return cachedSession?.user ?? null;
}

export async function getUserId() {
  return cachedSession?.user?.id ?? null;
}

export function getAccessToken() {
  return cachedSession?.access_token ?? null;
}

export async function signInWithMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split("#")[0] },
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
}
