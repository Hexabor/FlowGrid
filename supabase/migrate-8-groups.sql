-- Migration 8: gastos compartidos en grupo (3+ personas).
-- Run this ONCE in Supabase SQL editor on a project that already has the
-- post-migration-7 schema. Idempotent: safe to re-run.
--
-- What it adds:
--
-- 1. public.groups table — espacios colaborativos con N miembros donde
--    los gastos se reparten según un default configurable (iguales o
--    porcentajes por miembro). Cada grupo tiene un admin único en
--    `owner_id`; la cesión de admin es un UPDATE de ese campo.
--
-- 2. public.group_members table — registros de pertenencia. Cada miembro
--    es una persona identificada por `auth_user_id` cuando tiene cuenta
--    en FlowGrid (linked) o por `display_name` cuando es offline (un
--    contacto del admin que aún no ha aceptado invitación). El campo
--    `left_at` es NULL mientras está activo y se setea cuando alguien
--    abandona el grupo — preserva el histórico para que los pares con
--    saldos pendientes sigan vivos.
--
-- 3. shared_entries.group_id + splits — cuando una entrada pertenece a
--    un grupo, `splits` (JSONB) almacena {member_id: {paid, owes}} con
--    los importes desglosados por participante. Coexiste con el modelo
--    1↔1 actual: las entradas legacy mantienen `contact_id` y los
--    campos paid_by/my_share/their_share; las nuevas de grupo viven en
--    splits + group_id. Una migración posterior en cliente convertirá
--    las 1↔1 a "grupos de 2 miembros" de forma idempotente.
--
-- 4. recurring_templates.group_id — las plantillas periódicas pueden
--    apuntar a un grupo en lugar de a un contacto individual. El motor
--    de generación crea N entradas de grupo en cada ocurrencia.
--
-- Decisiones tomadas el 2026-05-03 (entrevista de diseño):
-- - Cualquier miembro puede pagar: paid_by deja de ser "me/them" y pasa
--   a ser un member_id implícito en la estructura de splits.
-- - Visibilidad total: todos los miembros activos ven todas las entradas
--   del grupo, aunque no participen en el par. RLS lo refleja.
-- - Reparto: el grupo guarda un default; cada entrada lo puede sobrescribir.
-- - Cesión de admin: se reduce a un UPDATE de groups.owner_id. La
--   policy permite solo al owner actual cambiarlo.
-- - Eliminar miembro: UPDATE de group_members.left_at. La uniqueness
--   en (group_id, auth_user_id) WHERE NOT NULL impide duplicados de
--   miembros vinculados; al re-añadir se reutiliza la misma fila
--   limpiando left_at.

-- =============================================================================
-- TABLAS: groups + group_members
-- =============================================================================
-- Ojo al orden: las policies de groups referencian group_members y
-- viceversa. Postgres registra las dependencias al CREATE POLICY, así
-- que ambas tablas tienen que existir ANTES de declarar policies que
-- se referencien mutuamente. Por eso este bloque crea primero las
-- dos tablas (sin policies todavía) y el siguiente declara todas las
-- policies de golpe.
create table if not exists public.groups (
  id                  text primary key,
  owner_id            uuid not null references auth.users(id) on delete cascade,
  name                text not null,
  default_split_mode  text not null default 'equal' check (default_split_mode in ('equal', 'uneven')),
  -- Mapa {member_id: percent}. Suma 100. Solo se mira cuando
  -- default_split_mode = 'uneven'. Las entradas pueden sobrescribirlo.
  default_split       jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists groups_owner_idx on public.groups(owner_id);

alter table public.groups enable row level security;

create table if not exists public.group_members (
  id                   text primary key,
  group_id             text not null references public.groups(id) on delete cascade,
  -- Vinculado: el miembro tiene cuenta FlowGrid. NULL para miembros
  -- offline (contactos del admin sin cuenta aceptada).
  auth_user_id         uuid references auth.users(id) on delete set null,
  -- Siempre poblado. Para vinculados es el nombre que el admin tiene
  -- guardado para esa persona en sus contactos al añadirla; para
  -- offline es el nombre del contacto offline.
  display_name         text not null,
  -- Email del miembro. Usado para invitar a offlines vía magic-link.
  email                text,
  -- Pista de mapeo al contacto del admin que origina este miembro.
  -- Permite que el admin gestione invitaciones desde su lista de
  -- contactos sin que los demás miembros vean ese vínculo.
  inviter_contact_id   text,
  joined_at            timestamptz not null default now(),
  -- NULL mientras el miembro está activo. Se setea cuando abandona o
  -- es expulsado. Las entradas pasadas siguen mostrando su parte.
  left_at              timestamptz
);

create index if not exists group_members_group_idx     on public.group_members(group_id);
create index if not exists group_members_auth_user_idx on public.group_members(auth_user_id);

-- Un mismo auth_user_id no puede aparecer dos veces en el mismo grupo
-- (se reutiliza la fila al re-añadir). Offline (auth_user_id NULL) sí
-- puede repetirse: dos personas distintas pueden tener el mismo
-- display_name si el admin lo decide.
create unique index if not exists group_members_unique_user_per_group
  on public.group_members(group_id, auth_user_id)
  where auth_user_id is not null;

alter table public.group_members enable row level security;

-- =============================================================================
-- POLICIES: groups
-- =============================================================================
-- SELECT: el dueño actual (admin) y cualquier miembro activo del grupo.
drop policy if exists "groups: owner or member can read" on public.groups;
create policy "groups: owner or member can read"
  on public.groups for select
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.group_members gm
      where gm.group_id = id
        and gm.auth_user_id = auth.uid()
        and gm.left_at is null
    )
  );

-- INSERT: cualquier usuario autenticado puede crear un grupo siendo el dueño.
drop policy if exists "groups: anyone can create" on public.groups;
create policy "groups: anyone can create"
  on public.groups for insert
  with check (owner_id = auth.uid());

-- UPDATE: solo el dueño actual. Cubre rename, cambio de default_split,
-- y la cesión de admin (donde el dueño actualiza owner_id al uid del
-- nuevo admin — la policy se evalúa contra el valor PREVIO de owner_id
-- vía USING, así que el cedente sigue autorizado en la operación).
drop policy if exists "groups: owner can update" on public.groups;
create policy "groups: owner can update"
  on public.groups for update
  using (owner_id = auth.uid());

-- DELETE: solo el dueño actual.
drop policy if exists "groups: owner can delete" on public.groups;
create policy "groups: owner can delete"
  on public.groups for delete
  using (owner_id = auth.uid());

-- =============================================================================
-- POLICIES: group_members
-- =============================================================================
-- SELECT: el dueño del grupo, los miembros activos del grupo, y el
-- propio miembro (incluso si está inactivo, para que vea su histórico).
drop policy if exists "group_members: members can read" on public.group_members;
create policy "group_members: members can read"
  on public.group_members for select
  using (
    auth_user_id = auth.uid()
    or exists (
      select 1 from public.groups g
      where g.id = group_id and g.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.group_members me
      where me.group_id = group_members.group_id
        and me.auth_user_id = auth.uid()
        and me.left_at is null
    )
  );

-- INSERT: solo el dueño del grupo añade miembros.
drop policy if exists "group_members: owner adds" on public.group_members;
create policy "group_members: owner adds"
  on public.group_members for insert
  with check (
    exists (
      select 1 from public.groups g
      where g.id = group_id and g.owner_id = auth.uid()
    )
  );

-- UPDATE: el dueño puede modificar cualquier fila (cambiar nombre,
-- email, expulsar = setear left_at); el propio miembro vinculado
-- puede actualizar su propia fila para abandonar (setear left_at) o
-- volver a entrar (limpiar left_at; respeta la unicidad).
drop policy if exists "group_members: owner or self update" on public.group_members;
create policy "group_members: owner or self update"
  on public.group_members for update
  using (
    auth_user_id = auth.uid()
    or exists (
      select 1 from public.groups g
      where g.id = group_id and g.owner_id = auth.uid()
    )
  )
  with check (
    auth_user_id = auth.uid()
    or exists (
      select 1 from public.groups g
      where g.id = group_id and g.owner_id = auth.uid()
    )
  );

-- DELETE: solo el dueño. Borrado físico de fila — generalmente
-- preferimos UPDATE left_at, pero el dueño puede limpiar miembros
-- cuya pertenencia fue un error (ej: añadió a la persona equivocada
-- y nadie ha registrado nada con ella).
drop policy if exists "group_members: owner deletes" on public.group_members;
create policy "group_members: owner deletes"
  on public.group_members for delete
  using (
    exists (
      select 1 from public.groups g
      where g.id = group_id and g.owner_id = auth.uid()
    )
  );

-- =============================================================================
-- SHARED ENTRIES: group_id + splits columns
-- =============================================================================
alter table public.shared_entries
  add column if not exists group_id text;

-- FK separada para que el `add column if not exists` siga siendo
-- idempotente (si el constraint ya existe lo dropeamos antes).
alter table public.shared_entries
  drop constraint if exists shared_entries_group_id_fkey;
alter table public.shared_entries
  add constraint shared_entries_group_id_fkey
  foreign key (group_id) references public.groups(id) on delete cascade;

-- splits JSONB: estructura {member_id: {paid: numeric, owes: numeric}}.
-- `paid` es lo que ese miembro puso en efectivo; `owes` es la parte
-- del total que le toca consumir. La diferencia paid - owes es la
-- contribución neta del miembro (positiva si pagó más de lo que le
-- toca, negativa si menos). El balance pairwise se computa cliente.
alter table public.shared_entries
  add column if not exists splits jsonb;

create index if not exists shared_entries_group_idx
  on public.shared_entries(group_id)
  where group_id is not null;

-- Extender la RLS de shared_entries para que los miembros activos del
-- grupo puedan leer y escribir entradas con ese group_id, además de
-- los casos legacy (owner directo o partner vinculado del 1↔1).
drop policy if exists "shared_entries: owner full access" on public.shared_entries;
drop policy if exists "shared_entries: owner or linked partner" on public.shared_entries;
drop policy if exists "shared_entries: owner, linked partner or group member" on public.shared_entries;
create policy "shared_entries: owner, linked partner or group member"
  on public.shared_entries for all
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.contacts c
      where c.owner_id = shared_entries.owner_id
        and c.id = shared_entries.contact_id
        and c.auth_user_id = auth.uid()
    )
    or (
      group_id is not null
      and exists (
        select 1 from public.group_members gm
        where gm.group_id = shared_entries.group_id
          and gm.auth_user_id = auth.uid()
          and gm.left_at is null
      )
    )
  )
  with check (
    owner_id = auth.uid()
    or exists (
      select 1 from public.contacts c
      where c.owner_id = shared_entries.owner_id
        and c.id = shared_entries.contact_id
        and c.auth_user_id = auth.uid()
    )
    or (
      group_id is not null
      and exists (
        select 1 from public.group_members gm
        where gm.group_id = shared_entries.group_id
          and gm.auth_user_id = auth.uid()
          and gm.left_at is null
      )
    )
  );

-- shared_entry_edits: la policy actual mira shared_entries via subquery,
-- así que automáticamente se beneficia de la nueva visibilidad de grupo
-- sin necesidad de recrearla. La dejamos intacta.

-- =============================================================================
-- RECURRING TEMPLATES: group_id
-- =============================================================================
alter table public.recurring_templates
  add column if not exists group_id text;

alter table public.recurring_templates
  drop constraint if exists recurring_templates_group_id_fkey;
alter table public.recurring_templates
  add constraint recurring_templates_group_id_fkey
  foreign key (group_id) references public.groups(id) on delete set null;

-- Cuando una plantilla apunta a un grupo, los campos legacy
-- shared_contact_id / shared_paid_by / shared_split_mode /
-- shared_my_share / shared_their_share quedan ignorados — el motor
-- de generación lee group_id + el reparto del grupo (o el override
-- guardado en la propia plantilla, columnas a añadir si llega el caso).

-- =============================================================================
-- updated_at trigger para groups
-- =============================================================================
drop trigger if exists groups_set_updated_at on public.groups;
create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();
