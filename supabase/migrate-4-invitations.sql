-- Fase 3 paso 3: invitaciones a contactos + liquidación por gasto concreto.
-- Run this ONCE in Supabase SQL editor on a project that already has the
-- post-migration-3 schema (table `contacts`, column `shared_entries.contact_id`).
-- Idempotent: safe to re-run; uses `if not exists`, `or replace` and policy
-- drop-recreate cycles throughout.
--
-- What it does:
--   1. Adds `contacts.auth_user_id` (nullable). When set, marks that the
--      contact has accepted an invitation and is now linked to a real
--      `auth.users` row. While null + email is non-empty, the contact row
--      doubles as a "pending invitation" addressed to that email.
--   2. Adds `shared_entries.settled_at` (nullable). When set, the entry is
--      excluded from the live balance (the user marked it as liquidated
--      individually, separately from the global "Liquidar saldo" flow).
--   3. Adds two extra RLS policies on `contacts` so an invitee can (a) see
--      pending invitations addressed to their verified email and (b) claim
--      them by setting auth_user_id to their own uid.
--   4. Replaces the `shared_entries` RLS policy with one that grants
--      read/write to the owner OR to a linked partner (a user that exists
--      as a contact in the entry's owner account with auth_user_id matching
--      the visiting user). Symmetric editing per the design.

-- =============================================================================
-- 1. contacts.auth_user_id
-- =============================================================================
alter table public.contacts add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create index if not exists contacts_auth_user_idx on public.contacts(auth_user_id);

-- =============================================================================
-- 2. shared_entries.settled_at
-- =============================================================================
alter table public.shared_entries add column if not exists settled_at timestamptz;

create index if not exists shared_entries_owner_settled_idx on public.shared_entries(owner_id, settled_at);

-- =============================================================================
-- 3. contacts RLS — additional SELECT/UPDATE policies for the invitation flow
-- =============================================================================

-- The visiting user can read contacts where they are the linked partner.
-- Required so the RLS subquery in shared_entries (below) can find the
-- linking row across account boundaries (the contact lives in the inviter's
-- account, but the invitee needs to find it by their own auth.uid()).
drop policy if exists "contacts: linked partner can read" on public.contacts;
create policy "contacts: linked partner can read"
  on public.contacts for select
  using (auth_user_id = auth.uid());

-- The visiting user can read contacts whose email matches their verified
-- email AND that haven't been linked yet — i.e. pending invitations
-- addressed to them. Used by the client at first login to detect "Juan
-- has invited you" and surface the acceptance modal.
drop policy if exists "contacts: invitee can read by email" on public.contacts;
create policy "contacts: invitee can read by email"
  on public.contacts for select
  using (
    auth_user_id is null
    and email <> ''
    and email = (auth.jwt() ->> 'email')
  );

-- The visiting user can claim a pending invitation addressed to their
-- email by setting auth_user_id to their own uid. The WITH CHECK locks
-- the new auth_user_id to the visitor's own uid so an invitee can't
-- redirect the contact to someone else.
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
-- 4. shared_entries RLS — owner OR linked partner full access
-- =============================================================================
drop policy if exists "shared_entries: owner full access" on public.shared_entries;
drop policy if exists "shared_entries: owner or linked partner" on public.shared_entries;
create policy "shared_entries: owner or linked partner"
  on public.shared_entries for all
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.contacts c
      where c.owner_id = shared_entries.owner_id
        and c.auth_user_id = auth.uid()
    )
  )
  with check (
    owner_id = auth.uid()
    or exists (
      select 1 from public.contacts c
      where c.owner_id = shared_entries.owner_id
        and c.auth_user_id = auth.uid()
    )
  );
