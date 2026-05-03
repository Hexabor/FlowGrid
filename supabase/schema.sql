-- FlowGrid schema (Fase 2)
-- Run this once in Supabase: SQL editor -> New query -> paste -> Run.
-- Idempotent: safe to re-run; uses `if not exists` and `or replace`.

-- =============================================================================
-- MOVEMENTS
-- =============================================================================
create table if not exists public.movements (
  id                     text primary key,
  owner_id               uuid not null references auth.users(id) on delete cascade,
  type                   text not null check (type in ('expense', 'income')),
  date                   date not null,
  concept                text not null,
  amount                 numeric(12,2) not null,
  category               text not null,
  party                  text not null default '',
  recurrence             text not null default '',
  note                   text not null default '',
  shared_entry_id        text,
  -- Backreference to the template that generated this row (see
  -- recurring_templates below + supabase/migrate-7-recurring-templates.sql).
  -- NULL for hand-entered movements. Drives the 🔁 indicator in the list.
  recurring_template_id  text,
  updated_at             timestamptz not null default now()
);

create index if not exists movements_owner_idx       on public.movements(owner_id);
create index if not exists movements_owner_date_idx  on public.movements(owner_id, date desc);
create index if not exists movements_recurring_template_idx
  on public.movements(recurring_template_id)
  where recurring_template_id is not null;

alter table public.movements enable row level security;

drop policy if exists "movements: owner full access" on public.movements;
create policy "movements: owner full access"
  on public.movements for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- =============================================================================
-- SETTINGS  (one row per user; categories/concepts as JSONB blobs)
-- =============================================================================
create table if not exists public.settings (
  owner_id    uuid primary key references auth.users(id) on delete cascade,
  categories  jsonb not null default '[]'::jsonb,
  concepts    jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.settings enable row level security;

drop policy if exists "settings: owner full access" on public.settings;
create policy "settings: owner full access"
  on public.settings for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- =============================================================================
-- CONTACTS  (renamed from "people" in Fase 3; existing projects must run
-- supabase/migrate-3-people-to-contacts.sql once. The auth_user_id column
-- is the link target for accepted invitations — see migrate-4-invitations.sql)
-- =============================================================================
create table if not exists public.contacts (
  id            text primary key,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  email         text not null default '',
  invited_at    timestamptz,
  auth_user_id  uuid references auth.users(id) on delete set null,
  -- Snapshot of the row owner's verified email at insert/update time.
  -- Lets an invitee build a reciprocal contact pre-filled with the
  -- inviter's email without needing direct access to auth.users. A
  -- BEFORE INSERT/UPDATE trigger maintains it (see below).
  owner_email   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists contacts_owner_idx     on public.contacts(owner_id);
create index if not exists contacts_auth_user_idx on public.contacts(auth_user_id);

alter table public.contacts enable row level security;

drop policy if exists "contacts: owner full access" on public.contacts;
create policy "contacts: owner full access"
  on public.contacts for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Trigger: populate owner_email from the JWT email when the row's
-- actual owner is the caller. Skips the invitee's claim-PATCH because
-- there owner_id != auth.uid().
create or replace function public.set_contacts_owner_email()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.owner_id = auth.uid() and (new.owner_email is null or new.owner_email = '') then
    new.owner_email := auth.jwt() ->> 'email';
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_set_owner_email on public.contacts;
create trigger contacts_set_owner_email
  before insert or update on public.contacts
  for each row execute function public.set_contacts_owner_email();

-- Extra SELECT policy: a user can read contacts where they are the linked
-- partner, regardless of who owns the row. Required so the cross-account
-- subquery in shared_entries' policy finds the linking contact.
drop policy if exists "contacts: linked partner can read" on public.contacts;
create policy "contacts: linked partner can read"
  on public.contacts for select
  using (auth_user_id = auth.uid());

-- Extra SELECT policy: a user can read pending invitations (contact rows
-- with their verified email and no link yet), so the client can surface
-- "X invited you" at first login.
drop policy if exists "contacts: invitee can read by email" on public.contacts;
create policy "contacts: invitee can read by email"
  on public.contacts for select
  using (
    auth_user_id is null
    and email <> ''
    and email = (auth.jwt() ->> 'email')
  );

-- Extra UPDATE policy: a user can claim a pending invitation addressed
-- to their email by writing their own uid into auth_user_id. The WITH
-- CHECK locks the destination to the visitor's own uid.
drop policy if exists "contacts: invitee can claim by email" on public.contacts;
create policy "contacts: invitee can claim by email"
  on public.contacts for update
  using (
    auth_user_id is null
    and email <> ''
    and email = (auth.jwt() ->> 'email')
  )
  with check (
    auth_user_id = auth.uid()
    and email = (auth.jwt() ->> 'email')
  );

-- =============================================================================
-- GROUPS + GROUP MEMBERS  (gastos compartidos en grupo de 3+ personas;
--   ver migrate-8-groups.sql. Las shared_entries con group_id IS NOT NULL
--   viven dentro de un grupo y usan `splits` JSONB para el desglose;
--   las legacy 1↔1 mantienen contact_id y paid_by/my_share/their_share.)
--   Las dos tablas se crean primero y todas las policies se declaran
--   después porque las policies se referencian mutuamente y Postgres
--   valida la existencia de las tablas referenciadas al CREATE POLICY.
-- =============================================================================
create table if not exists public.groups (
  id                  text primary key,
  owner_id            uuid not null references auth.users(id) on delete cascade,
  name                text not null,
  default_split_mode  text not null default 'equal' check (default_split_mode in ('equal', 'uneven')),
  default_split       jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists groups_owner_idx on public.groups(owner_id);

alter table public.groups enable row level security;

create table if not exists public.group_members (
  id                  text primary key,
  group_id            text not null references public.groups(id) on delete cascade,
  auth_user_id        uuid references auth.users(id) on delete set null,
  display_name        text not null,
  email               text,
  inviter_contact_id  text,
  joined_at           timestamptz not null default now(),
  left_at             timestamptz
);

create index if not exists group_members_group_idx     on public.group_members(group_id);
create index if not exists group_members_auth_user_idx on public.group_members(auth_user_id);
create unique index if not exists group_members_unique_user_per_group
  on public.group_members(group_id, auth_user_id)
  where auth_user_id is not null;

alter table public.group_members enable row level security;

-- ---- policies: groups ----
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

drop policy if exists "groups: anyone can create" on public.groups;
create policy "groups: anyone can create"
  on public.groups for insert
  with check (owner_id = auth.uid());

drop policy if exists "groups: owner can update" on public.groups;
create policy "groups: owner can update"
  on public.groups for update
  using (owner_id = auth.uid());

drop policy if exists "groups: owner can delete" on public.groups;
create policy "groups: owner can delete"
  on public.groups for delete
  using (owner_id = auth.uid());

-- ---- policies: group_members ----
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

drop policy if exists "group_members: owner adds" on public.group_members;
create policy "group_members: owner adds"
  on public.group_members for insert
  with check (
    exists (
      select 1 from public.groups g
      where g.id = group_id and g.owner_id = auth.uid()
    )
  );

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
-- SHARED ENTRIES
-- =============================================================================
create table if not exists public.shared_entries (
  id                 text primary key,
  owner_id           uuid not null references auth.users(id) on delete cascade,
  contact_id         text not null,   -- soft FK; app cleans up if a contact is removed
  type               text not null check (type in ('expense', 'payment')),
  date               date not null,
  concept            text not null,
  note               text not null default '',
  total              numeric(12,2) not null,
  paid_by            text not null check (paid_by in ('me', 'them')),
  split_mode         text not null check (split_mode in ('equal', 'uneven', 'full', 'payment')),
  my_share           numeric(12,2) not null default 0,
  their_share        numeric(12,2) not null default 0,
  source_movement_id text,
  -- When set, the entry is excluded from the live balance: it represents
  -- a per-entry settlement (e.g. the user received the exact Bizum for
  -- this YouTube subscription and marked the row as liquidado without
  -- waiting to settle the global balance). See migrate-4-invitations.sql.
  settled_at         timestamptz,
  -- When set, this entry belongs to a group (3+ personas). The fields
  -- contact_id / paid_by / my_share / their_share become legacy hints
  -- and the canonical breakdown lives in `splits` JSONB:
  -- { member_id: { paid: numeric, owes: numeric } }. See migrate-8-groups.sql.
  group_id           text references public.groups(id) on delete cascade,
  splits             jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists shared_entries_owner_idx          on public.shared_entries(owner_id);
create index if not exists shared_entries_owner_contact_idx  on public.shared_entries(owner_id, contact_id);
create index if not exists shared_entries_owner_settled_idx  on public.shared_entries(owner_id, settled_at);
create index if not exists shared_entries_group_idx
  on public.shared_entries(group_id)
  where group_id is not null;

alter table public.shared_entries enable row level security;

-- Visibilidad de una shared_entry:
--  (a) el owner del row (caso clásico 1↔1 + grupos creados por mí),
--  (b) el partner vinculado de un par 1↔1 (legacy contact_id), o
--  (c) un miembro activo del grupo cuando group_id está poblado.
-- Las tres ramas se evalúan tanto en USING como en WITH CHECK para
-- permitir que cualquier miembro inserte/edite entradas del grupo.
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

-- =============================================================================
-- RECURRING TEMPLATES  (Periódicos versión B; see migrate-7-recurring-templates.sql)
-- Per-user definitions of recurring movements (alquileres, suscripciones,
-- nóminas). The client materialises actual movements from these templates
-- on every boot, idempotent via last_generated_date.
-- =============================================================================
create table if not exists public.recurring_templates (
  id                    text primary key,
  owner_id              uuid not null references auth.users(id) on delete cascade,
  type                  text not null check (type in ('expense', 'income')),
  concept               text not null,
  amount                numeric(12,2) not null,
  category              text not null,
  party                 text not null default '',
  note                  text not null default '',
  periodicity           text not null check (periodicity in ('monthly', 'yearly')),
  day_of_month          smallint not null check (day_of_month between 1 and 31),
  month_of_year         smallint check (month_of_year between 1 and 12),
  start_date            date not null,
  end_date              date,
  last_generated_date   date,
  is_active             boolean not null default true,
  shared_contact_id     text,
  shared_paid_by        text check (shared_paid_by in ('me', 'them')),
  shared_split_mode     text check (shared_split_mode in ('equal', 'uneven', 'full')),
  shared_my_share       numeric(12,2),
  shared_their_share    numeric(12,2),
  -- Cuando la plantilla apunta a un grupo (3+ personas), los campos
  -- shared_* anteriores se ignoran y el motor genera el reparto leyendo
  -- el grupo y sus miembros activos. Ver migrate-8-groups.sql.
  group_id              text references public.groups(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists recurring_templates_owner_idx
  on public.recurring_templates(owner_id);
create index if not exists recurring_templates_owner_active_idx
  on public.recurring_templates(owner_id, is_active);

alter table public.recurring_templates enable row level security;

drop policy if exists "recurring_templates: owner full access"
  on public.recurring_templates;
create policy "recurring_templates: owner full access"
  on public.recurring_templates for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- =============================================================================
-- updated_at auto-trigger (so the client can rely on it for last-write-wins)
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists movements_set_updated_at           on public.movements;
drop trigger if exists settings_set_updated_at            on public.settings;
drop trigger if exists contacts_set_updated_at            on public.contacts;
drop trigger if exists shared_entries_set_updated_at      on public.shared_entries;
drop trigger if exists recurring_templates_set_updated_at on public.recurring_templates;
drop trigger if exists groups_set_updated_at              on public.groups;

create trigger movements_set_updated_at           before update on public.movements           for each row execute function public.set_updated_at();
create trigger settings_set_updated_at            before update on public.settings            for each row execute function public.set_updated_at();
create trigger contacts_set_updated_at            before update on public.contacts            for each row execute function public.set_updated_at();
create trigger shared_entries_set_updated_at      before update on public.shared_entries      for each row execute function public.set_updated_at();
create trigger recurring_templates_set_updated_at before update on public.recurring_templates for each row execute function public.set_updated_at();
create trigger groups_set_updated_at              before update on public.groups              for each row execute function public.set_updated_at();

-- =============================================================================
-- SHARED ENTRY EDITS  (append-only audit log; see migrate-6-shared-entry-edits.sql)
-- =============================================================================
create table if not exists public.shared_entry_edits (
  id            text primary key,
  entry_id      text not null,
  editor_id     uuid references auth.users(id) on delete set null,
  editor_email  text not null default '',
  edited_at     timestamptz not null default now(),
  summary       text not null default '',
  comment       text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists shared_entry_edits_entry_idx  on public.shared_entry_edits(entry_id);
create index if not exists shared_entry_edits_editor_idx on public.shared_entry_edits(editor_id);

alter table public.shared_entry_edits enable row level security;

-- A user can read edit rows for entries they have visibility on via
-- shared_entries' "owner or linked partner" rule. Append-only: we
-- never expose UPDATE or DELETE policies, so the audit trail is
-- tamper-resistant.
drop policy if exists "shared_entry_edits: read by entry visibility" on public.shared_entry_edits;
create policy "shared_entry_edits: read by entry visibility"
  on public.shared_entry_edits for select
  using (
    exists (
      select 1 from public.shared_entries e
      where e.id = entry_id
        and (
          e.owner_id = auth.uid()
          or exists (
            select 1 from public.contacts c
            where c.owner_id = e.owner_id
              and c.id = e.contact_id
              and c.auth_user_id = auth.uid()
          )
        )
    )
  );

drop policy if exists "shared_entry_edits: insert by editor" on public.shared_entry_edits;
create policy "shared_entry_edits: insert by editor"
  on public.shared_entry_edits for insert
  with check (
    editor_id = auth.uid()
    and exists (
      select 1 from public.shared_entries e
      where e.id = entry_id
        and (
          e.owner_id = auth.uid()
          or exists (
            select 1 from public.contacts c
            where c.owner_id = e.owner_id
              and c.id = e.contact_id
              and c.auth_user_id = auth.uid()
          )
        )
    )
  );
