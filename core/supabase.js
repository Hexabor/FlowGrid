import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: "implicit",
  },
});

supabase.auth.onAuthStateChange((event, session) => {
  console.log("[supabase auth]", event, session ? `session for ${session.user.email}` : "no session");
});

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

export async function getUserId() {
  const user = await getUser();
  return user?.id ?? null;
}

export async function signInWithMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split("#")[0] },
  });
  if (error) throw error;
}

export async function signOut() {
  console.log("[supabase auth] signOut called");
  await supabase.auth.signOut();
  console.log("[supabase auth] signOut returned");
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
}
