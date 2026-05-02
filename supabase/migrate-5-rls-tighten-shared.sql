-- Fase 3 paso 3 — pulido post-MVP de invitaciones.
-- Run this ONCE in Supabase SQL editor on a project that already has the
-- post-migration-4 schema (table contacts has auth_user_id, table
-- shared_entries has settled_at). Idempotent: safe to re-run.
--
-- Two fixes:
--
-- 1. The shared_entries "owner or linked partner" policy was too loose:
--    it granted access whenever ANY contact in the entry's owner account
--    pointed to the visiting user. That meant Oscar (linked to Juan's
--    contact for Oscar) could read ALL of Juan's shared entries — even
--    entries with Carlos or María. Tighten the linkage so the contact
--    must be the specific contact_id of THIS entry.
--
-- 2. Add contacts.owner_email so the invitee can build a reciprocal
--    contact pre-filled with the inviter's email, without the client
--    needing to expose auth.users.email cross-account. A trigger keeps
--    the column populated with the row owner's verified JWT email — but
--    only when the owner is the one doing the insert/update, so an
--    invitee's PATCH (where owner_id ≠ auth.uid()) doesn't disturb it.

-- =============================================================================
-- 1. Tightened shared_entries RLS
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
-- 2. contacts.owner_email + trigger
-- =============================================================================
alter table public.contacts add column if not exists owner_email text;

create or replace function public.set_contacts_owner_email()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Only auto-populate when the row's actual owner is the caller —
  -- so an invitee's PATCH (owner_id != auth.uid()) leaves owner_email
  -- alone. The OR-empty guard prevents overwriting an explicitly set
  -- value the client may have provided.
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
