# Incidente — supabase-js cuelga queries silenciosamente

**Fecha**: 2026-04-30
**Commits relevantes**: `67aff3b`, `5013572`, `e4c18ef`, `adafce5`
**Estado**: resuelto bypassando supabase-js para el data plane.

---

## Síntoma observable

Tras login con magic-link la app entra correctamente en `bootApp` (auth funciona perfectamente), pero **se queda colgada en `cloudHydrate` sin error, sin timeout, sin tráfico saliente al endpoint REST**.

Logs típicos en consola:

```
[supabase auth] SIGNED_IN session for usuario@correo.com
[app] auth change: session for usuario@correo.com
[app] booting
[cloud hydrate] start
[cloud hydrate] ownerId: 3cc30921-...
[cloud hydrate] firing queries
                                         ← aquí se queda forever
```

Las queries `supabase.from(table).select(...).eq(...)` quedan `pending` en `Promise.all` y **nunca resuelven ni rechazan**. La pestaña Network NO muestra peticiones a `/rest/v1/*`. Tampoco hay errores en consola. Y el botón de logout deja de responder porque `signOut()` también pasa por la auth-stack interna.

## Causa raíz (lo que sabemos)

supabase-js v2.x mantiene una "lock"/coordinación interna en su auth client (`navigator.locks`-based por defecto) que se llama no solo al hacer `getSession()` sino también **antes de cada query** porque el PostgrestClient interno necesita el `access_token` en cada request y lo pide a `auth._getAccessToken()` → `_useSession()` → `_acquireLock(...)`.

Cuando ese lock se queda en estado inconsistente (pending queue corrupto, lock huérfano de un cierre de tab, o algún edge case post-login), todas las llamadas a `_useSession` esperan la cola para siempre **incluso con `lock` config sobreescrito a no-op**. La razón: la cola interna `pendingInLock` puede acumular promises que nunca resuelven porque `lockAcquired` se quedó en `true`.

## Lo que NO funcionó

1. **Override de `lock` con no-op** (`lock: async (_, _, fn) => fn()`). Resolvió el primer cuelgue (`getSession()` directo) pero no el cuelgue de queries — porque la cola interna sigue activa por debajo.
2. **Pinear versión** (`@supabase/supabase-js@2.45.0`). Mismo síntoma.
3. **Cachear sesión desde `onAuthStateChange`** y devolverla sincronamente desde `getSession()`. Funciona para nuestras lecturas de `userId/accessToken`, pero supabase-js no usa nuestro `getSession`; tiene su propio camino interno para queries.

## La solución que sí funciona

**Bypass total de supabase-js para el data plane** — `fetch` directo contra `/rest/v1/{table}` con headers manuales. supabase-js se sigue usando para autenticación (signIn, signOut, listener `onAuthStateChange`) porque eso funciona; solo se bypasa lo que rompe.

### Pasos del fix

1. Exportar el `access_token` desde el módulo de auth (cachearlo desde el listener):

```js
// core/supabase.js
let cachedSession = null;
supabase.auth.onAuthStateChange((event, session) => {
  cachedSession = session;
});
export function getAccessToken() {
  return cachedSession?.access_token ?? null;
}
```

2. Reescribir las llamadas a `supabase.from(...)` con `fetch`:

```js
// core/cloud.js
function authHeaders() {
  const token = getAccessToken();
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
  };
}

async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`);
  return await res.json();
}

async function restUpsert(table, rows, conflictColumn = "id") {
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictColumn}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${table} ${res.status}`);
}

async function restDelete(table, ids) {
  if (!ids.length) return;
  const inList = ids.map((id) => `"${encodeURIComponent(id)}"`).join(",");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=in.(${inList})`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`delete ${table} ${res.status}`);
}
```

Con esto:
- Las queries van por la red sin pasar por la auth-stack rota.
- El `access_token` ya está validado y refrescado por supabase-js (vía el listener), así que las requests autorizan correctamente con RLS.
- Todo el camino de "delete extras + upsert all" se reduce a tres helpers triviales.

### Endpoints PostgREST que necesitas saber

```
GET    /rest/v1/{table}?owner_id=eq.{uuid}&select=*    — read
POST   /rest/v1/{table}?on_conflict={col}              — upsert (Prefer: resolution=merge-duplicates,return=minimal)
DELETE /rest/v1/{table}?id=in.("a","b","c")            — bulk delete
```

Los IDs en `in.()` van entre comillas para PostgREST porque son `text`. Si fuesen `uuid` o números, sin comillas.

## Señales para reconocer este mismo bug en el futuro

- `[cloud hydrate] firing queries` aparece pero **ningún `[cloud hydrate] X done`** lo sigue.
- Network tab vacía de peticiones a `/rest/v1/*` (solo módulos JS de esm.sh).
- Botón de logout sin reaccionar (`signOut()` también se atasca).
- El bug aparece **post-login**, no antes; auth flow funciona, solo el data-plane cuelga.
- Pasa con cualquier versión de supabase-js v2.x probada y con `lock` no-op.

Si ves estas señales, no pierdas tiempo intentando arreglar la auth: ve directo al bypass con fetch.

## Por qué lo dejamos así

Mantener la dependencia de supabase-js para queries era frágil — el bug podía resurgir en cualquier versión nueva, en cualquier estado raro de localStorage. El fetch directo es:

- **Más simple** (3 helpers triviales vs PostgrestClient + AuthClient).
- **Más predecible** (sin colas internas, sin locks, sin estado oculto).
- **Suficientemente robusto** (auth sigue siendo supabase-js).
- **Más fácil de debuggear** (Network tab muestra todo).

El coste es perder algunas comodidades del builder (`.eq()`, `.gt()`, joins, etc.) pero FlowGrid hace queries muy simples — `select("*").eq("owner_id", X)` y poco más — así que no hay pérdida real.
