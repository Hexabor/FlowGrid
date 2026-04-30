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
-- supabase/migrate-3-people-to-contacts.sql once)
-- =============================================================================
create table if not exists public.contacts (
  id          text primary key,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  email       text not null default '',  -- ready for Fase 3 invitations
  invited_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists contacts_owner_idx on public.contacts(owner_id);

alter table public.contacts enable row level security;

drop policy if exists "contacts: owner full access" on public.contacts;
create policy "contacts: owner full access"
  on public.contacts for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

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
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists shared_entries_owner_idx          on public.shared_entries(owner_id);
create index if not exists shared_entries_owner_contact_idx  on public.shared_entries(owner_id, contact_id);

alter table public.shared_entries enable row level security;

drop policy if exists "shared_entries: owner full access" on public.shared_entries;
create policy "shared_entries: owner full access"
  on public.shared_entries for all
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

drop trigger if exists movements_set_updated_at      on public.movements;
drop trigger if exists settings_set_updated_at       on public.settings;
drop trigger if exists contacts_set_updated_at       on public.contacts;
drop trigger if exists shared_entries_set_updated_at on public.shared_entries;

create trigger movements_set_updated_at      before update on public.movements      for each row execute function public.set_updated_at();
create trigger settings_set_updated_at       before update on public.settings       for each row execute function public.set_updated_at();
create trigger contacts_set_updated_at       before update on public.contacts       for each row execute function public.set_updated_at();
create trigger shared_entries_set_updated_at before update on public.shared_entries for each row execute function public.set_updated_at();
