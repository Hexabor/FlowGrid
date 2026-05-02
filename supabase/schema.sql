-- FlowGrid schema (Fase 2)
-- Run this once in Supabase: SQL editor -> New query -> paste -> Run.
-- Idempotent: safe to re-run; uses `if not exists` and `or replace`.

-- =============================================================================
-- MOVEMENTS
-- =============================================================================
create table if not exists public.movements (
  id              text primary key,
  owner_id        uuid not null references auth.users(id) on delete cascade,
  type            text not null check (type in ('expense', 'income')),
  date            date not null,
  concept         text not null,
  amount          numeric(12,2) not null,
  category        text not null,
  party           text not null default '',
  recurrence      text not null default '',
  note            text not null default '',
  shared_entry_id text,
  updated_at      timestamptz not null default now()
);

create index if not exists movements_owner_idx       on public.movements(owner_id);
create index if not exists movements_owner_date_idx  on public.movements(owner_id, date desc);

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
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists shared_entries_owner_idx          on public.shared_entries(owner_id);
create index if not exists shared_entries_owner_contact_idx  on public.shared_entries(owner_id, contact_id);
create index if not exists shared_entries_owner_settled_idx  on public.shared_entries(owner_id, settled_at);

alter table public.shared_entries enable row level security;

-- Owner has full access AND a linked partner (a user matched as
-- contact.auth_user_id in the entry's owner account) gets symmetric
-- read/write access. The contact must be the SPECIFIC contact_id of
-- the entry, otherwise an invitee linked to one contact would also
-- see the inviter's shared entries with everyone else.
drop policy if exists "shared_entries: owner full access" on public.shared_entries;
drop policy if exists "shared_entries: owner or linked partner" on public.shared_entries;
create policy "shared_entries: owner or linked partner"
  on public.shared_entries for all
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.contacts c
      where c.owner_id = shared_entries.owner_id
        and c.id = shared_entries.contact_id
        and c.auth_user_id = auth.uid()
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
  );

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

drop trigger if exists movements_set_updated_at      on public.movements;
drop trigger if exists settings_set_updated_at       on public.settings;
drop trigger if exists contacts_set_updated_at       on public.contacts;
drop trigger if exists shared_entries_set_updated_at on public.shared_entries;

create trigger movements_set_updated_at      before update on public.movements      for each row execute function public.set_updated_at();
create trigger settings_set_updated_at       before update on public.settings       for each row execute function public.set_updated_at();
create trigger contacts_set_updated_at       before update on public.contacts       for each row execute function public.set_updated_at();
create trigger shared_entries_set_updated_at before update on public.shared_entries for each row execute function public.set_updated_at();
