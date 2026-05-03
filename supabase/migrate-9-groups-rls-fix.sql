-- Migration 9: arreglo de la recursión infinita en RLS de grupos.
-- Run this ONCE in Supabase SQL editor después de migrate-8-groups.sql.
-- Idempotente: safe to re-run.
--
-- ¿Qué pasaba?
-- La policy de SELECT en `groups` consultaba `group_members` y la policy
-- de SELECT en `group_members` consultaba `groups` — un ciclo. Postgres
-- evalúa la policy de cada tabla recursivamente al disparar la subquery
-- y aborta con `42P17 — infinite recursion detected in policy for
-- relation "groups"`.
--
-- Solución: encapsular las dos comprobaciones (¿soy admin de este grupo?
-- y ¿soy miembro activo de este grupo?) en funciones `SECURITY DEFINER`.
-- Esas funciones se ejecutan con los privilegios del owner (postgres),
-- así que sus subqueries internas saltan RLS y no disparan recursión.
-- Las policies pasan a llamar a esas funciones en vez de hacer EXISTS
-- inline.
--
-- `set search_path = public` evita que un usuario malicioso pueda
-- redirigir las consultas a un schema falso (best practice para
-- SECURITY DEFINER).

-- =============================================================================
-- HELPERS: is_group_owner / is_group_member
-- =============================================================================
create or replace function public.is_group_owner(p_group_id text, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.groups
    where id = p_group_id and owner_id = p_user_id
  );
$$;

create or replace function public.is_group_member(p_group_id text, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id
      and auth_user_id = p_user_id
      and left_at is null
  );
$$;

-- Permitir que `authenticated` llame a las funciones (si no, las policies
-- las invocarían sin permiso y fallarían silenciosamente).
grant execute on function public.is_group_owner(text, uuid) to authenticated;
grant execute on function public.is_group_member(text, uuid) to authenticated;

-- =============================================================================
-- POLICIES: groups (recreadas usando is_group_member)
-- =============================================================================
drop policy if exists "groups: owner or member can read" on public.groups;
create policy "groups: owner or member can read"
  on public.groups for select
  using (
    owner_id = auth.uid()
    or public.is_group_member(id, auth.uid())
  );

-- Las demás policies de groups (insert/update/delete) no necesitaban
-- subquery a group_members, así que no tenían recursión y las dejamos.

-- =============================================================================
-- POLICIES: group_members (recreadas usando is_group_owner / is_group_member)
-- =============================================================================
drop policy if exists "group_members: members can read" on public.group_members;
create policy "group_members: members can read"
  on public.group_members for select
  using (
    auth_user_id = auth.uid()
    or public.is_group_owner(group_id, auth.uid())
    or public.is_group_member(group_id, auth.uid())
  );

drop policy if exists "group_members: owner adds" on public.group_members;
create policy "group_members: owner adds"
  on public.group_members for insert
  with check (public.is_group_owner(group_id, auth.uid()));

drop policy if exists "group_members: owner or self update" on public.group_members;
create policy "group_members: owner or self update"
  on public.group_members for update
  using (
    auth_user_id = auth.uid()
    or public.is_group_owner(group_id, auth.uid())
  )
  with check (
    auth_user_id = auth.uid()
    or public.is_group_owner(group_id, auth.uid())
  );

drop policy if exists "group_members: owner deletes" on public.group_members;
create policy "group_members: owner deletes"
  on public.group_members for delete
  using (public.is_group_owner(group_id, auth.uid()));

-- =============================================================================
-- POLICIES: shared_entries (la rama de grupo usa is_group_member)
-- =============================================================================
-- También limpiamos la subquery a group_members aquí. No causaba el
-- ciclo (shared_entries no se referencia a sí misma), pero usar la
-- helper deja el SQL homogéneo y un poco más rápido.
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
      and public.is_group_member(group_id, auth.uid())
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
      and public.is_group_member(group_id, auth.uid())
    )
  );
