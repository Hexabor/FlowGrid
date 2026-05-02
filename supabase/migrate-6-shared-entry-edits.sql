-- Migration 6: edit log for shared expenses.
-- Run this ONCE in Supabase SQL editor on a project that already has the
-- post-migration-5 schema. Idempotent: safe to re-run.
--
-- What it adds:
--
-- A new public.shared_entry_edits table that records every save of a
-- shared expense — who edited it, when, a short summary of the changes
-- and an optional human comment from the editor (e.g. "corregí el
-- importe, era 12 €"). Both sides of a linked pair can read each
-- other's edit history through the same RLS visibility rule that
-- governs shared_entries themselves.
--
-- Why: with symmetric editing (the invitee can now save changes to
-- shared expenses owned by the inviter), each side needs a reliable
-- way to audit what the other touched. The log is append-only — we
-- never UPDATE or DELETE rows from this table; old edit records stay
-- forever as the truth of who did what.

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

create index if not exists shared_entry_edits_entry_idx on public.shared_entry_edits(entry_id);
create index if not exists shared_entry_edits_editor_idx on public.shared_entry_edits(editor_id);

alter table public.shared_entry_edits enable row level security;

-- SELECT: a user can read edit rows for entries they have access to via
-- the shared_entries RLS — same logic, applied transitively.
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

-- INSERT: only by the editor themselves, and only for entries the
-- editor can also see. Combined, these mean a malicious actor can't
-- write fake history into someone else's entry.
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
