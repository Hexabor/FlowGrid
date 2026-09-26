-- Migration 14: bandeja de entrada (propuestas de movimientos desde IA).
-- Run this ONCE in Supabase SQL editor. Idempotente.
--
-- Contexto: un chat (ChatGPT, Claude…) prepara los gastos que le cuentas
-- y los deja como PROPUESTAS en esta tabla, ya sea porque pegas su JSON
-- en la app o porque el conector los envía directamente. Nada entra en
-- `movements` / `shared_entries` / `recurring_templates` hasta que el
-- usuario lo aprueba desde la bandeja de FlowGrid, que crea los datos
-- reales con la misma lógica que los formularios.
--
-- Por qué tabla aparte y no escribir en `movements`: el cliente sincroniza
-- por foto completa (borra en la nube lo que no tiene en local). Una fila
-- escrita desde fuera en `movements` desaparecería con el siguiente push
-- de un dispositivo desactualizado. `inbox_items` NO entra en ese sync:
-- el cliente solo la lee y actualiza fila a fila.
--
-- Campos:
--   payload  → la propuesta tal cual (formato "flowgrid": 1, un item).
--   batch_id → agrupa las propuestas de un mismo pegado / conversación.
--   source   → 'paste', 'mcp', … (de dónde vino).
--   status   → pending | accepted | discarded.
--   result   → al aceptar, ids de lo creado (para trazabilidad).

create table if not exists public.inbox_items (
  id           text primary key default gen_random_uuid()::text,
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  batch_id     text,
  source       text not null default 'paste',
  payload      jsonb not null,
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'discarded')),
  result       jsonb,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

create index if not exists inbox_items_owner_status_idx
  on public.inbox_items(owner_id, status);

alter table public.inbox_items enable row level security;

drop policy if exists "inbox_items: owner full access" on public.inbox_items;
create policy "inbox_items: owner full access"
  on public.inbox_items for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
