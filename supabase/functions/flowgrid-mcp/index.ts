// FlowGrid — conector MCP para chats (ChatGPT, Claude…).
//
// Permite que la IA del usuario CONSULTE sus datos (movimientos,
// periódicos, compartidos) y PROPONGA movimientos nuevos a la bandeja
// (`inbox_items`). Nunca escribe en movements / shared_entries /
// recurring_templates: el usuario aprueba cada propuesta en la app, que
// crea los datos con la misma lógica que los formularios. Ver
// features/inbox.js y supabase/migrate-14-inbox.sql.
//
// Autenticación: OAuth 2.1 del propio Supabase Auth ("OAuth Server" en
// el dashboard, con registro dinámico de clientes). El chat descubre el
// servidor de autorización leyendo el documento de metadatos que sirve
// esta función, el usuario autoriza en la pantalla de consentimiento de
// FlowGrid (oauth/consent/) y a partir de ahí cada llamada trae
// `Authorization: Bearer <token del usuario>`. Verificamos el token
// preguntando a /auth/v1/user (igual que send-feedback y
// notify-shared-entry) y hacemos todas las lecturas con ese mismo token,
// así que la RLS de siempre limita los datos a los del usuario.
//
// Protocolo: MCP sobre "Streamable HTTP" sin estado. Cada POST lleva un
// mensaje JSON-RPC y se responde con JSON (sin stream SSE). Implementado a
// mano (initialize, tools/list, tools/call, ping) para no depender de
// librerías en alfa.
//
// Variables de entorno: SUPABASE_URL y SUPABASE_ANON_KEY (inyectadas).
// En el dashboard: Verify JWT = OFF (la función valida el token ella misma
// y la petición de descubrimiento llega sin token).

const SUPABASE_URL = (globalThis as any).Deno?.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = (globalThis as any).Deno?.env.get("SUPABASE_ANON_KEY") ?? "";

const SERVER_INFO = { name: "flowgrid", title: "FlowGrid", version: "1.0.0" };
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "www-authenticate, mcp-session-id",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

// ---- URLs públicas ----------------------------------------------------------

// Dentro de Edge Functions la URL que ve la función es /<slug>/..., sin el
// prefijo /functions/v1 del gateway. Reconstruimos la URL pública a partir
// de SUPABASE_URL y el slug.
function routeOf(req: Request) {
  const path = new URL(req.url).pathname.replace(/^\/functions\/v1/, "");
  const [, slug = "flowgrid-mcp", ...rest] = path.split("/");
  const resource = `${SUPABASE_URL}/functions/v1/${slug}`;
  return { slug, subpath: "/" + rest.join("/"), resource };
}

function protectedResourceMetadata(resource: string) {
  return {
    resource,
    authorization_servers: [`${SUPABASE_URL}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_name: "FlowGrid",
  };
}

function unauthorized(resource: string, message = "Falta el token de acceso."): Response {
  return json({ error: "unauthorized", error_description: message }, 401, {
    "WWW-Authenticate": `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource"`,
  });
}

// ---- autenticación ----------------------------------------------------------

type User = { id: string; email: string };
const tokenCache = new Map<string, { user: User; until: number }>();

async function verifyToken(token: string): Promise<User | null> {
  const cached = tokenCache.get(token);
  if (cached && cached.until > Date.now()) return cached.user;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.id) return null;
  const user = { id: data.id, email: data.email ?? "" };
  tokenCache.set(token, { user, until: Date.now() + 60_000 });
  if (tokenCache.size > 200) tokenCache.delete(tokenCache.keys().next().value!);
  return user;
}

// ---- acceso a datos (PostgREST con el token del usuario) ---------------------

class Db {
  token: string;
  user: User;

  constructor(token: string, user: User) {
    this.token = token;
    this.user = user;
  }

  private headers(extra: Record<string, string> = {}) {
    return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${this.token}`, ...extra };
  }

  async get(path: string): Promise<any[]> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Lectura fallida (${path.split("?")[0]}): ${res.status} ${await res.text()}`);
    return await res.json();
  }

  // Lectura completa por páginas: PostgREST corta cada respuesta en el
  // "Max rows" del proyecto (1000 por defecto) aunque pidas más.
  async getAll(path: string): Promise<any[]> {
    const sep = path.includes("?") ? "&" : "?";
    const order = /(^|[?&])order=/.test(path) ? "" : "&order=id.asc";
    const rows: any[] = [];
    for (;;) {
      const chunk = await this.get(`${path}${sep}offset=${rows.length}${order}`);
      if (!chunk.length) break;
      rows.push(...chunk);
    }
    return rows;
  }

  async insert(table: string, rows: unknown[]): Promise<void> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`Escritura fallida (${table}): ${res.status} ${await res.text()}`);
  }
}

// Todo lo que la IA necesita para hablar el idioma del usuario.
async function loadCatalog(db: Db) {
  const uid = db.user.id;
  const [settings, contacts, groups, members] = await Promise.all([
    db.get(`settings?owner_id=eq.${uid}&select=categories,concepts`),
    db.getAll(`contacts?owner_id=eq.${uid}&select=id,name,auth_user_id`),
    db.getAll(`groups?select=id,name,owner_id`),
    db.getAll(`group_members?select=id,group_id,auth_user_id,display_name,inviter_contact_id,left_at`),
  ]);
  const concepts: { label: string; category: string }[] = settings[0]?.concepts ?? [];
  const categories: { value: string; label: string }[] = settings[0]?.categories ?? [];
  const memberLabel = (m: any) => {
    if (m.auth_user_id && m.auth_user_id === uid) return "yo";
    if (m.auth_user_id) {
      const c = contacts.find((x: any) => x.auth_user_id === m.auth_user_id);
      if (c) return c.name;
    }
    return m.display_name;
  };
  const activeMembers = members.filter((m: any) => !m.left_at);
  return {
    uid,
    concepts,
    categories,
    contacts,
    groups: groups.map((g: any) => ({
      id: g.id,
      name: g.name,
      members: activeMembers.filter((m: any) => m.group_id === g.id).map((m: any) => ({ id: m.id, label: memberLabel(m), isMe: m.auth_user_id === uid })),
    })),
  };
}
type Catalog = Awaited<ReturnType<typeof loadCatalog>>;

// ---- utilidades ---------------------------------------------------------------

function norm(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function todayMadrid(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  return Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function incomeConcept(c: { label: string; category: string }) {
  return c.category === "ingreso" || c.label === "Renta";
}

function contactName(cat: Catalog, id: string | null) {
  return cat.contacts.find((c: any) => c.id === id)?.name ?? null;
}

// Una entrada compartida vista desde MI lado. Las que pertenecen a un
// contacto vinculado vienen en su perspectiva: se invierten pagador y
// partes, y el contacto pasa a ser mi contacto recíproco de ese usuario.
function sharedAsMine(e: any, cat: Catalog) {
  if (!e.owner_id || e.owner_id === cat.uid) return { ...e, contact: contactName(cat, e.contact_id) };
  const reciprocal = cat.contacts.find((c: any) => c.auth_user_id === e.owner_id);
  return {
    ...e,
    contact: reciprocal?.name ?? "contacto vinculado",
    paid_by: e.paid_by === "me" ? "them" : "me",
    my_share: e.their_share,
    their_share: e.my_share,
  };
}

// Qué supone una entrada para mi saldo (positivo = me deben).
function balanceImpact(e: any, cat: Catalog): number {
  if (e.group_id && e.splits) {
    const me = cat.groups.find((g) => g.id === e.group_id)?.members.find((m) => m.isMe);
    const mine = me ? e.splits[me.id] : null;
    if (!mine) return 0;
    const settled = e.settled_members ?? {};
    if (Number(mine.paid) > 0) {
      let owed = 0;
      for (const [id, s] of Object.entries<any>(e.splits)) {
        if (id !== me!.id && !settled[id]) owed += Number(s.owes) || 0;
      }
      return round2(owed);
    }
    return settled[me!.id] ? 0 : -(Number(mine.owes) || 0);
  }
  if (e.type === "expense") return e.paid_by === "me" ? Number(e.their_share) : -Number(e.my_share);
  return e.paid_by === "me" ? Number(e.total) : -Number(e.total);
}

// ---- herramientas ----------------------------------------------------------------

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  run: (args: any, db: Db) => Promise<unknown>;
};

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

const dateProp = (description: string) => ({ type: "string", description: `${description} (AAAA-MM-DD)` });

const proposalItemSchema = {
  type: "object",
  description: "Un movimiento propuesto. Mismo formato que las instrucciones de FlowGrid.",
  properties: {
    kind: { type: "string", enum: ["movement", "payment"], description: "movement (gasto/ingreso) o payment (pago entre personas)." },
    type: { type: "string", enum: ["expense", "income"] },
    date: dateProp("Fecha"),
    amount: { type: "number", description: "Euros, positivo. En compartidos, el TOTAL del ticket." },
    concept: { type: "string", description: "Uno de los conceptos del catálogo, tal cual. En payment con advance, descripción libre del gasto previsto." },
    party: { type: "string", description: "Establecimiento o persona (opcional)." },
    note: { type: "string", description: "Detalle libre (opcional)." },
    comment: { type: "string", description: "Dudas o aclaraciones para el usuario (opcional)." },
    shared: {
      type: "object",
      description: "Solo gastos compartidos. Con contacto: {with, mode, my_share?, their_share?}. Con grupo: {with, payer, split, shares?}.",
      properties: {
        with: { type: "string" },
        mode: { type: "string", enum: ["me-equal", "me-uneven", "me-full", "them-equal", "them-uneven", "them-full"] },
        my_share: { type: "number" },
        their_share: { type: "number" },
        payer: { type: "string", description: "'me' o nombre del miembro que pagó (grupos)." },
        split: { type: "string", enum: ["equal", "uneven"] },
        shares: { type: "object", description: "{ 'me': 10, 'Nombre': 5 } en grupos con reparto desigual.", additionalProperties: { type: "number" } },
      },
    },
    recurring: {
      type: "object",
      description: "Si se repite. La app crea una plantilla que genera esta ocurrencia y las siguientes.",
      properties: {
        periodicity: { type: "string", enum: ["monthly", "yearly"] },
        end_date: dateProp("Fecha de fin opcional"),
      },
    },
    with: { type: "string", description: "Solo payment: contacto." },
    paid_by: { type: "string", enum: ["me", "them"], description: "Solo payment: quién pagó." },
    advance: { type: "boolean", description: "Solo payment: pago por adelantado de un gasto futuro." },
  },
  required: ["date", "amount"],
};

// Revisión ligera de una propuesta contra el catálogo. La validación de
// verdad la hace la bandeja; esto sirve para que la IA corrija antes.
function reviewProposal(item: any, cat: Catalog): string[] {
  const warnings: string[] = [];
  if (!isIsoDate(item.date)) warnings.push(`Fecha no válida: ${item.date}`);
  if (!(Number(item.amount) > 0)) warnings.push(`Importe no válido: ${item.amount}`);
  const findContact = (n: string) => cat.contacts.find((c: any) => norm(c.name) === norm(n));
  const findGroup = (n: string) => cat.groups.find((g) => norm(g.name) === norm(n));
  if (item.kind === "payment") {
    if (!item.with || !findContact(item.with)) warnings.push(`Contacto desconocido: ${item.with ?? "(vacío)"}`);
    if (!["me", "them"].includes(item.paid_by)) warnings.push("paid_by debe ser 'me' o 'them'.");
    return warnings;
  }
  const type = item.type === "income" ? "income" : "expense";
  const valid = cat.concepts.filter((c) => (type === "income" ? incomeConcept(c) : c.category !== "ingreso"));
  if (!valid.some((c) => norm(c.label) === norm(item.concept))) {
    warnings.push(`El concepto «${item.concept ?? ""}» no existe para ${type === "income" ? "ingresos" : "gastos"}.`);
  }
  if (item.shared) {
    const target = item.shared.with ?? "";
    const group = findGroup(target);
    if (!findContact(target) && !group) warnings.push(`No existe el contacto o grupo «${target}».`);
    if (group) {
      const payer = item.shared.payer ?? "me";
      const known = ["me", "yo"].includes(norm(payer)) || group.members.some((m) => norm(m.label) === norm(payer));
      if (!known) warnings.push(`«${payer}» no es miembro del grupo ${group.name}.`);
    } else if (!item.shared.mode) {
      warnings.push("Falta shared.mode (quién pagó y cómo se reparte).");
    }
  }
  if (item.recurring && !["monthly", "yearly"].includes(item.recurring.periodicity)) {
    warnings.push("recurring.periodicity debe ser 'monthly' o 'yearly'.");
  }
  return warnings;
}

const tools: Tool[] = [
  {
    name: "get_catalog",
    title: "Catálogo del usuario",
    description:
      "Devuelve los conceptos (de gasto y de ingreso), categorías, contactos y grupos (con sus miembros) del usuario, y la fecha de hoy en Madrid. Llámala al empezar: los movimientos propuestos deben usar exactamente estos nombres.",
    inputSchema: { type: "object", properties: {} },
    annotations: READ_ONLY,
    run: async (_args, db) => {
      const cat = await loadCatalog(db);
      return {
        today: todayMadrid(),
        expense_concepts: cat.concepts.filter((c) => c.category !== "ingreso").map((c) => ({ concept: c.label, category: c.category })),
        income_concepts: cat.concepts.filter(incomeConcept).map((c) => c.label),
        categories: cat.categories.map((c) => ({ value: c.value, label: c.label })),
        contacts: cat.contacts.map((c: any) => c.name),
        groups: cat.groups.map((g) => ({ name: g.name, members: g.members.map((m) => m.label) })),
      };
    },
  },
  {
    name: "search_movements",
    title: "Buscar movimientos",
    description:
      "Busca movimientos personales (gastos e ingresos) con filtros opcionales. Incluye la parte propia de los gastos compartidos que registró el usuario. Devuelve las filas, el número y la suma. Úsala para consultas del tipo '¿cuánto gasté en X?' o '¿ya apunté Y?'.",
    inputSchema: {
      type: "object",
      properties: {
        from: dateProp("Desde"),
        to: dateProp("Hasta"),
        text: { type: "string", description: "Texto a buscar en concepto, establecimiento o nota." },
        concept: { type: "string" },
        category: { type: "string", description: "Valor de categoría (ver get_catalog)." },
        type: { type: "string", enum: ["expense", "income"] },
        min_amount: { type: "number" },
        max_amount: { type: "number" },
        limit: { type: "integer", minimum: 1, maximum: 1000, default: 200 },
      },
    },
    annotations: READ_ONLY,
    run: async (a, db) => {
      const f = [`owner_id=eq.${db.user.id}`];
      if (isIsoDate(a.from)) f.push(`date=gte.${a.from}`);
      if (isIsoDate(a.to)) f.push(`date=lte.${a.to}`);
      if (a.type) f.push(`type=eq.${encodeURIComponent(a.type)}`);
      if (a.category) f.push(`category=eq.${encodeURIComponent(a.category)}`);
      if (a.concept) f.push(`concept=ilike.${encodeURIComponent(a.concept)}`);
      if (a.min_amount != null) f.push(`amount=gte.${Number(a.min_amount)}`);
      if (a.max_amount != null) f.push(`amount=lte.${Number(a.max_amount)}`);
      if (a.text) {
        const t = encodeURIComponent(`*${String(a.text).replace(/[(),*]/g, " ")}*`);
        f.push(`or=(concept.ilike.${t},party.ilike.${t},note.ilike.${t})`);
      }
      const limit = Math.min(Number(a.limit) || 200, 1000);
      const rows = await db.get(
        `movements?${f.join("&")}&select=id,date,type,concept,category,amount,party,note,shared_entry_id,recurring_template_id&order=date.desc,id.desc&limit=${limit}`
      );
      const sum = (t: string) => round2(rows.filter((r) => r.type === t).reduce((s, r) => s + Number(r.amount), 0));
      return {
        count: rows.length,
        truncated: rows.length === limit,
        total_expense: sum("expense"),
        total_income: sum("income"),
        movements: rows.map((r) => ({
          id: r.id,
          date: r.date,
          type: r.type,
          concept: r.concept,
          category: r.category,
          amount: Number(r.amount),
          party: r.party || undefined,
          note: r.note || undefined,
          shared: r.shared_entry_id ? true : undefined,
          from_recurring: r.recurring_template_id ? true : undefined,
        })),
      };
    },
  },
  {
    name: "summarize_movements",
    title: "Resumen de movimientos",
    description:
      "Totales de gastos e ingresos agrupados por mes, categoría, concepto o establecimiento en un rango de fechas. Útil para detectar patrones, meses anómalos o gastos que crecen.",
    inputSchema: {
      type: "object",
      properties: {
        from: dateProp("Desde"),
        to: dateProp("Hasta"),
        group_by: { type: "string", enum: ["month", "category", "concept", "party"], default: "month" },
        type: { type: "string", enum: ["expense", "income"] },
      },
      required: ["from", "to"],
    },
    annotations: READ_ONLY,
    run: async (a, db) => {
      if (!isIsoDate(a.from) || !isIsoDate(a.to)) throw new Error("from y to deben ser fechas AAAA-MM-DD.");
      const typeFilter = a.type ? `&type=eq.${encodeURIComponent(a.type)}` : "";
      const rows = await db.getAll(
        `movements?owner_id=eq.${db.user.id}&date=gte.${a.from}&date=lte.${a.to}${typeFilter}&select=date,type,concept,category,amount,party`
      );
      const by = a.group_by ?? "month";
      const key = (r: any) => (by === "month" ? r.date.slice(0, 7) : by === "party" ? r.party || "(sin establecimiento)" : r[by]);
      const groups = new Map<string, { expense: number; income: number; count: number }>();
      for (const r of rows) {
        const g = groups.get(key(r)) ?? { expense: 0, income: 0, count: 0 };
        g[r.type as "expense" | "income"] += Number(r.amount);
        g.count += 1;
        groups.set(key(r), g);
      }
      const out = [...groups.entries()].map(([k, g]) => ({ [by]: k, expense: round2(g.expense), income: round2(g.income), net: round2(g.income - g.expense), count: g.count }));
      out.sort((x: any, y: any) => (by === "month" ? String(x.month).localeCompare(String(y.month)) : y.expense - x.expense));
      return { from: a.from, to: a.to, group_by: by, rows: out };
    },
  },
  {
    name: "list_recurring_templates",
    title: "Plantillas periódicas",
    description:
      "Lista las plantillas periódicas del usuario (alquiler, suscripciones, nómina…): importe, periodicidad, día, si está activa, última generación y con quién se comparte.",
    inputSchema: { type: "object", properties: {} },
    annotations: READ_ONLY,
    run: async (_a, db) => {
      const cat = await loadCatalog(db);
      const rows = await db.getAll(`recurring_templates?owner_id=eq.${db.user.id}&select=*`);
      return rows.map((t) => ({
        concept: t.concept,
        type: t.type,
        amount: Number(t.amount),
        party: t.party || undefined,
        periodicity: t.periodicity,
        day_of_month: t.day_of_month,
        month_of_year: t.month_of_year ?? undefined,
        start_date: t.start_date,
        end_date: t.end_date ?? undefined,
        last_generated_date: t.last_generated_date ?? undefined,
        active: t.is_active,
        shared_with: t.group_id
          ? `grupo ${cat.groups.find((g) => g.id === t.group_id)?.name ?? "?"}`
          : t.shared_contact_id
            ? `${contactName(cat, t.shared_contact_id) ?? "?"} (${t.shared_paid_by}-${t.shared_split_mode})`
            : undefined,
      }));
    },
  },
  {
    name: "check_regular_expenses",
    title: "Revisar gastos regulares",
    description:
      "Detecta gastos e ingresos que se repiten casi todos los meses (mismo concepto y establecimiento) y dice cuándo se apuntaron por última vez, cuánto suelen costar, si ya los cubre una plantilla periódica y si parece que falta el último. Úsala para responder '¿tengo todo al día?' o '¿qué me falta por apuntar?'.",
    inputSchema: {
      type: "object",
      properties: {
        months: { type: "integer", minimum: 3, maximum: 36, default: 12, description: "Meses hacia atrás a analizar." },
      },
    },
    annotations: READ_ONLY,
    run: async (a, db) => {
      const months = Math.min(Math.max(Number(a.months) || 12, 3), 36);
      const today = todayMadrid();
      const from = addDays(today, -Math.round(months * 30.5));
      const [rows, templates] = await Promise.all([
        db.getAll(`movements?owner_id=eq.${db.user.id}&date=gte.${from}&select=date,type,concept,amount,party,recurring_template_id`),
        db.getAll(`recurring_templates?owner_id=eq.${db.user.id}&select=concept,party,amount,is_active,periodicity`),
      ]);
      const buckets = new Map<string, any[]>();
      for (const r of rows) {
        const k = `${r.type}|${norm(r.concept)}|${norm(r.party)}`;
        buckets.set(k, [...(buckets.get(k) ?? []), r]);
      }
      const out = [];
      for (const list of buckets.values()) {
        const monthsSeen = new Set(list.map((r) => r.date.slice(0, 7)));
        if (monthsSeen.size < 3) continue;
        list.sort((x, y) => x.date.localeCompare(y.date));
        const last = list[list.length - 1];
        const amounts = list.map((r) => Number(r.amount)).sort((x, y) => x - y);
        const median = amounts[Math.floor(amounts.length / 2)];
        const days = list.map((r) => Number(r.date.slice(8, 10))).sort((x, y) => x - y);
        const covered = templates.some((t) => t.is_active && norm(t.concept) === norm(last.concept) && (!t.party || norm(t.party) === norm(last.party)));
        const daysSince = daysBetween(today, last.date);
        out.push({
          type: last.type,
          concept: last.concept,
          party: last.party || undefined,
          months_with_movement: monthsSeen.size,
          of_months_analyzed: months,
          typical_amount: round2(median),
          typical_day: days[Math.floor(days.length / 2)],
          last_date: last.date,
          last_amount: Number(last.amount),
          days_since_last: daysSince,
          covered_by_recurring_template: covered,
          looks_overdue: !covered && daysSince > 40,
        });
      }
      out.sort((x, y) => Number(y.looks_overdue) - Number(x.looks_overdue) || y.days_since_last - x.days_since_last);
      return { today, analyzed_from: from, regular_items: out };
    },
  },
  {
    name: "list_shared_entries",
    title: "Gastos compartidos y saldos",
    description:
      "Lista los gastos compartidos y pagos entre personas (desde el punto de vista del usuario) y calcula el saldo pendiente por contacto y por grupo (positivo = le deben al usuario, negativo = debe él).",
    inputSchema: {
      type: "object",
      properties: {
        from: dateProp("Desde"),
        to: dateProp("Hasta"),
        with: { type: "string", description: "Filtrar por nombre de contacto o grupo." },
        pending_only: { type: "boolean", default: false, description: "Solo entradas no liquidadas." },
        limit: { type: "integer", minimum: 1, maximum: 1000, default: 200 },
      },
    },
    annotations: READ_ONLY,
    run: async (a, db) => {
      const cat = await loadCatalog(db);
      const all = await db.getAll(`shared_entries?select=*&order=date.desc,id.desc`);
      const balances = new Map<string, number>();
      const entries = all.map((raw) => {
        const e = sharedAsMine(raw, cat);
        const group = raw.group_id ? cat.groups.find((g) => g.id === raw.group_id) : null;
        const withName = group ? `grupo ${group.name}` : e.contact;
        const impact = raw.settled_at ? 0 : balanceImpact(group ? raw : e, cat);
        balances.set(withName, round2((balances.get(withName) ?? 0) + impact));
        return {
          date: e.date,
          kind: e.type === "payment" ? (e.advance ? "adelanto" : "pago") : "gasto",
          concept: e.concept,
          with: withName,
          total: Number(e.total),
          paid_by: group ? undefined : e.paid_by,
          split: e.split_mode,
          my_share: group ? undefined : Number(e.my_share),
          their_share: group ? undefined : Number(e.their_share),
          settled: Boolean(e.settled_at),
          note: e.note || undefined,
          balance_impact: round2(impact),
        };
      });
      let list = entries;
      if (isIsoDate(a.from)) list = list.filter((e) => e.date >= a.from);
      if (isIsoDate(a.to)) list = list.filter((e) => e.date <= a.to);
      if (a.with) list = list.filter((e) => norm(e.with).includes(norm(a.with)));
      if (a.pending_only) list = list.filter((e) => !e.settled);
      const limit = Math.min(Number(a.limit) || 200, 1000);
      return {
        balances: [...balances.entries()].filter(([, v]) => Math.abs(v) >= 0.005).map(([with_, balance]) => ({ with: with_, balance })),
        count: list.length,
        entries: list.slice(0, limit),
      };
    },
  },
  {
    name: "find_possible_duplicates",
    title: "Buscar posibles duplicados",
    description:
      "Antes de proponer movimientos, comprueba si ya existen: busca movimientos, compartidos y propuestas pendientes con fecha cercana (±3 días) e importe igual, o mismo concepto con importe parecido. Si hay coincidencias, pregunta al usuario antes de proponer.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { date: dateProp("Fecha"), amount: { type: "number" }, concept: { type: "string" }, type: { type: "string", enum: ["expense", "income"] } },
            required: ["date", "amount"],
          },
        },
      },
      required: ["items"],
    },
    annotations: READ_ONLY,
    run: async (a, db) => {
      const items: any[] = Array.isArray(a.items) ? a.items.slice(0, 100) : [];
      const dates = items.map((i) => i.date).filter(isIsoDate).sort();
      if (!dates.length) return { results: [] };
      const from = addDays(dates[0], -3);
      const to = addDays(dates[dates.length - 1], 3);
      const [movs, shared, inbox] = await Promise.all([
        db.getAll(`movements?owner_id=eq.${db.user.id}&date=gte.${from}&date=lte.${to}&select=date,type,concept,amount,party`),
        db.getAll(`shared_entries?date=gte.${from}&date=lte.${to}&select=date,type,concept,total`),
        db.getAll(`inbox_items?owner_id=eq.${db.user.id}&status=eq.pending&select=payload,created_at`),
      ]);
      const results = items.map((item) => {
        const amount = Number(item.amount);
        const matches: string[] = [];
        for (const m of movs) {
          if (item.type && m.type !== item.type) continue;
          if (daysBetween(m.date, item.date) > 3) continue;
          const exact = Math.abs(Number(m.amount) - amount) < 0.01;
          const similar = item.concept && norm(m.concept) === norm(item.concept) && Math.abs(Number(m.amount) - amount) <= Math.max(1, amount * 0.1);
          if (exact || similar) matches.push(`movimiento ${m.date} · ${m.concept} · ${Number(m.amount)} €${m.party ? ` · ${m.party}` : ""}`);
        }
        for (const e of shared) {
          if (daysBetween(e.date, item.date) <= 3 && Math.abs(Number(e.total) - amount) < 0.01) {
            matches.push(`compartido ${e.date} · ${e.concept} · total ${Number(e.total)} €`);
          }
        }
        for (const p of inbox) {
          const pl = p.payload ?? {};
          if (pl.date && daysBetween(pl.date, item.date) <= 3 && Math.abs(Number(pl.amount) - amount) < 0.01) {
            matches.push(`propuesta pendiente en la bandeja ${pl.date} · ${pl.concept ?? pl.kind} · ${Number(pl.amount)} €`);
          }
        }
        return { item: { date: item.date, amount, concept: item.concept }, possible_duplicates: matches };
      });
      return { results };
    },
  },
  {
    name: "list_inbox",
    title: "Propuestas pendientes",
    description: "Lista las propuestas que siguen pendientes de aprobar en la bandeja de FlowGrid.",
    inputSchema: { type: "object", properties: {} },
    annotations: READ_ONLY,
    run: async (_a, db) => {
      const rows = await db.getAll(`inbox_items?owner_id=eq.${db.user.id}&status=eq.pending&select=id,payload,source,created_at&order=created_at.asc,id.asc`);
      return { pending: rows.length, items: rows.map((r) => ({ id: r.id, source: r.source, created_at: r.created_at, ...r.payload })) };
    },
  },
  {
    name: "propose_movements",
    title: "Proponer movimientos a la bandeja",
    description:
      "Envía movimientos a la bandeja de FlowGrid para que el usuario los apruebe en la app. NO los guarda como definitivos: el usuario los acepta o descarta. Úsala solo después de enseñar al usuario la tabla de revisión y de que la confirme. Devuelve avisos si algún nombre no encaja con el catálogo.",
    inputSchema: {
      type: "object",
      properties: {
        items: { type: "array", minItems: 1, maxItems: 100, items: proposalItemSchema },
      },
      required: ["items"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async (a, db) => {
      const items: any[] = Array.isArray(a.items) ? a.items : [];
      if (!items.length) throw new Error("No hay movimientos que proponer.");
      const cat = await loadCatalog(db);
      const batchId = crypto.randomUUID();
      const rows = items.map((item) => ({
        id: crypto.randomUUID(),
        owner_id: db.user.id,
        batch_id: batchId,
        source: "mcp",
        payload: { kind: item.kind === "payment" ? "payment" : "movement", ...item },
      }));
      await db.insert("inbox_items", rows);
      return {
        proposed: rows.length,
        message: "Propuestas enviadas a la bandeja. El usuario debe aprobarlas en FlowGrid → Movimientos → Bandeja.",
        warnings: items
          .map((item, i) => ({ index: i, date: item.date, concept: item.concept, warnings: reviewProposal(item, cat) }))
          .filter((w) => w.warnings.length),
      };
    },
  },
  {
    name: "propose_changes",
    title: "Proponer cambios o borrados de movimientos",
    description:
      "Propone corregir o borrar movimientos que ya existen (los ids salen de search_movements). NO cambia nada directamente: cada propuesta llega a la bandeja de FlowGrid y el usuario la aprueba en la app. Campos editables: date, amount, concept, party, note. En movimientos vinculados a un gasto compartido solo se pueden cambiar party y note, y no se pueden borrar desde aquí. Enseña antes al usuario qué vas a cambiar y pide confirmación.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["update", "delete"] },
              movement_id: { type: "string", description: "id del movimiento (de search_movements)." },
              changes: {
                type: "object",
                description: "Solo en update: campos nuevos.",
                properties: {
                  date: dateProp("Nueva fecha"),
                  amount: { type: "number" },
                  concept: { type: "string", description: "Concepto del catálogo." },
                  party: { type: "string" },
                  note: { type: "string" },
                },
              },
              reason: { type: "string", description: "Por qué se propone (se muestra al usuario)." },
            },
            required: ["action", "movement_id"],
          },
        },
      },
      required: ["items"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async (a, db) => {
      const items: any[] = Array.isArray(a.items) ? a.items : [];
      if (!items.length) throw new Error("No hay cambios que proponer.");
      const cat = await loadCatalog(db);
      const ids = [...new Set(items.map((i) => String(i.movement_id ?? "")))].filter(Boolean);
      const found = ids.length
        ? await db.getAll(`movements?owner_id=eq.${db.user.id}&id=in.(${ids.map((id) => `"${encodeURIComponent(id)}"`).join(",")})&select=id,date,type,concept,amount,party,note,shared_entry_id`)
        : [];
      const EDITABLE = ["date", "amount", "concept", "party", "note"];
      const accepted: any[] = [];
      const rejected: any[] = [];
      for (const item of items) {
        const m = found.find((x) => x.id === item.movement_id);
        const action = item.action === "delete" ? "delete" : "update";
        if (!m) {
          rejected.push({ movement_id: item.movement_id, error: "No existe ningún movimiento tuyo con ese id." });
          continue;
        }
        const changes: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(item.changes ?? {})) if (EDITABLE.includes(k)) changes[k] = v;
        const problems: string[] = [];
        if (action === "update" && !Object.keys(changes).length) problems.push("No hay campos que cambiar.");
        if (m.shared_entry_id && (action === "delete" || ["date", "amount", "concept"].some((k) => k in changes))) {
          problems.push("Es un gasto compartido: fecha, importe, concepto o borrado se cambian desde la app (Compartidos).");
        }
        if ("date" in changes && !isIsoDate(changes.date)) problems.push(`Fecha no válida: ${changes.date}`);
        if ("amount" in changes && !(Number(changes.amount) > 0)) problems.push(`Importe no válido: ${changes.amount}`);
        if ("concept" in changes) {
          const valid = cat.concepts.filter((c) => (m.type === "income" ? incomeConcept(c) : c.category !== "ingreso"));
          if (!valid.some((c) => norm(c.label) === norm(changes.concept))) problems.push(`El concepto «${changes.concept}» no existe.`);
        }
        if (problems.length) {
          rejected.push({ movement_id: m.id, error: problems.join(" ") });
          continue;
        }
        const before = { date: m.date, amount: Number(m.amount), concept: m.concept, party: m.party ?? "", note: m.note ?? "" };
        accepted.push({ kind: "edit", action, movement_id: m.id, changes: action === "update" ? changes : undefined, before, type: m.type, reason: item.reason ?? "" });
      }
      if (accepted.length) {
        const batchId = crypto.randomUUID();
        await db.insert(
          "inbox_items",
          accepted.map((payload) => ({ id: crypto.randomUUID(), owner_id: db.user.id, batch_id: batchId, source: "mcp", payload }))
        );
      }
      return {
        proposed: accepted.length,
        rejected,
        message: accepted.length
          ? "Cambios enviados a la bandeja. El usuario debe aprobarlos en FlowGrid → Movimientos → Bandeja."
          : "No se ha enviado nada.",
      };
    },
  },
];

const INSTRUCTIONS = `Eres el asistente de FlowGrid, la app de finanzas personales del usuario. Hablas en español.
- Al empezar, llama a get_catalog: usa SIEMPRE sus conceptos, contactos y grupos tal cual. "concept" es un concepto del catálogo; las descripciones van en "note".
- Para apuntar gastos: extrae los movimientos, llama a find_possible_duplicates y enseña una tabla de revisión con las columnas Fecha · Importe · Concepto · Establecimiento · Nota · Con quién y reparto · Se repite. Si hay posibles duplicados, pregúntalo. Solo cuando el usuario confirme, llama a propose_movements.
- Para corregir o borrar movimientos existentes: búscalos con search_movements (te da su id), enseña al usuario qué cambiarías (antes → después) y, cuando confirme, usa propose_changes.
- propose_movements y propose_changes no guardan nada definitivo: di al usuario que revise y acepte las propuestas en FlowGrid → Movimientos → Bandeja.
- Para consultas (¿tengo todo al día?, ¿cuánto gasto en…?, patrones, cosas que sobran o faltan) usa search_movements, summarize_movements, check_regular_expenses, list_recurring_templates y list_shared_entries.
- Importes en euros; fechas AAAA-MM-DD; la fecha de hoy la da get_catalog.`;

// ---- JSON-RPC ------------------------------------------------------------------

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handleMessage(msg: any, db: Db): Promise<unknown | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg?.id, -32600, "Invalid Request");
  }
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;

  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return rpcResult(msg.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, {
        tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
      });
    case "tools/call": {
      const tool = tools.find((t) => t.name === msg.params?.name);
      if (!tool) return rpcError(msg.id, -32602, `Herramienta desconocida: ${msg.params?.name}`);
      try {
        const data = await tool.run(msg.params?.arguments ?? {}, db);
        return rpcResult(msg.id, {
          content: [{ type: "text", text: JSON.stringify(data) }],
          structuredContent: Array.isArray(data) ? { items: data } : data,
          isError: false,
        });
      } catch (error) {
        console.error(`[mcp] ${tool.name}`, error);
        return rpcResult(msg.id, {
          content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(msg.id, -32601, `Método no soportado: ${msg.method}`);
  }
}

// ---- entrada HTTP ------------------------------------------------------------------

export async function handler(req: Request): Promise<Response> {
  const { subpath, resource } = routeOf(req);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  if (subpath.endsWith("oauth-protected-resource")) {
    return json(protectedResourceMetadata(resource));
  }

  if (req.method === "GET" || req.method === "DELETE") {
    // Sin stream SSE ni sesiones: el transporte lo permite respondiendo 405.
    return new Response(null, { status: 405, headers: { ...corsHeaders, Allow: "POST, OPTIONS" } });
  }
  if (req.method !== "POST") return new Response(null, { status: 405, headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token === SUPABASE_ANON_KEY) return unauthorized(resource);
  const user = await verifyToken(token);
  if (!user) return unauthorized(resource, "Token no válido o caducado.");
  const db = new Db(token, user);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }

  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map((m) => handleMessage(m, db)))).filter(Boolean);
    return responses.length ? json(responses) : new Response(null, { status: 202, headers: corsHeaders });
  }
  const response = await handleMessage(body, db);
  return response ? json(response) : new Response(null, { status: 202, headers: corsHeaders });
}

if ((globalThis as any).Deno?.serve) {
  (globalThis as any).Deno.serve(handler);
}
