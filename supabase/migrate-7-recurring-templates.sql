-- Migration 7: recurring templates (Periódicos versión B).
-- Run this ONCE in Supabase SQL editor on a project that already has the
-- post-migration-6 schema. Idempotent: safe to re-run.
--
-- What it adds:
--
-- 1. A new public.recurring_templates table that stores user-defined
--    plantillas of recurring movements (alquileres, suscripciones,
--    nóminas). Each template describes a periodicity (monthly / yearly),
--    a target day, an optional date range, and the movement payload to
--    materialise on each tick (concept, amount, category, party, note,
--    type). When a template targets a shared contact, it also stores
--    the shared-split parameters so the generated movement can spawn
--    a paired shared_entries row just like a hand-entered shared
--    expense would.
--
-- 2. A new recurring_template_id column on public.movements pointing
--    back to the originating template. Drives the 🔁 icon in the list,
--    prevents duplicate generation on reboot, and lets the user delete
--    a template "and its movements" if they ever want to.
--
-- Why: until now FlowGrid only had a free-text "recurrence" hint on
-- each movement, useful as a label but with no engine behind it. The
-- user has to re-enter every alquiler, every suscripción, every nómina
-- every month. This migration lays the data foundation so the client
-- can generate those movements automatically (last_generated_date
-- makes the generation idempotent across reboots and devices).

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
  -- For monthly templates this is the target day (1-31). When the month
  -- doesn't have that day (e.g. day 31 in February), the client falls
  -- back to the last real day of that month.
  day_of_month          smallint not null check (day_of_month between 1 and 31),
  -- For yearly templates this is the target month (1-12). NULL on
  -- monthly templates.
  month_of_year         smallint check (month_of_year between 1 and 12),
  start_date            date not null,
  end_date              date,
  -- Last calendar date for which this template has already produced a
  -- movement. NULL means nothing generated yet. The client never
  -- regenerates for a date <= last_generated_date.
  last_generated_date   date,
  is_active             boolean not null default true,
  -- Shared-expense fields. NULL contact_id means the generated movement
  -- is purely personal; non-NULL means each tick also creates a paired
  -- shared_entries row. Mirrors the columns on shared_entries so the
  -- semantics carry over 1-to-1.
  shared_contact_id     text,
  shared_paid_by        text check (shared_paid_by in ('me', 'them')),
  shared_split_mode     text check (shared_split_mode in ('equal', 'uneven', 'full')),
  shared_my_share       numeric(12,2),
  shared_their_share    numeric(12,2),
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

-- Auto-update updated_at on every row update so last-write-wins sync
-- has something to compare against.
drop trigger if exists recurring_templates_set_updated_at
  on public.recurring_templates;
create trigger recurring_templates_set_updated_at
  before update on public.recurring_templates
  for each row execute function public.set_updated_at();

-- =============================================================================
-- MOVEMENTS: backreference to the template that generated the row.
-- =============================================================================
alter table public.movements
  add column if not exists recurring_template_id text;

create index if not exists movements_recurring_template_idx
  on public.movements(recurring_template_id)
  where recurring_template_id is not null;
