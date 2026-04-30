-- Fase 3 migration: rename people→contacts and shared_entries.person_id→contact_id.
-- Run this ONCE in Supabase SQL editor on a project that already has the
-- Fase 2 schema (table `people`, column `shared_entries.person_id`).
-- Idempotent: safe to re-run; checks current state before each rename.

do $$
begin
  -- 1. Rename table public.people → public.contacts
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'people'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'contacts'
  ) then
    alter table public.people rename to contacts;
  end if;

  -- 2. Rename column shared_entries.person_id → contact_id
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shared_entries'
      and column_name = 'person_id'
  ) then
    alter table public.shared_entries rename column person_id to contact_id;
  end if;

  -- 3. Rename indexes
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'people_owner_idx') then
    alter index public.people_owner_idx rename to contacts_owner_idx;
  end if;
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'shared_entries_owner_person_idx') then
    alter index public.shared_entries_owner_person_idx rename to shared_entries_owner_contact_idx;
  end if;
end $$;

-- 4. Replace the RLS policy with the new name (drops the old one and creates the new)
drop policy if exists "people: owner full access" on public.contacts;
drop policy if exists "contacts: owner full access" on public.contacts;
create policy "contacts: owner full access"
  on public.contacts for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- 5. Replace the trigger with the new name
drop trigger if exists people_set_updated_at on public.contacts;
drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();
