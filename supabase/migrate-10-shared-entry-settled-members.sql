-- Migration 10: liquidación granular por miembro en gastos de grupo.
-- Run this ONCE in Supabase SQL editor on a project con la migración 8/9
-- ya aplicadas. Idempotente.
--
-- Contexto: hasta ahora `shared_entries.settled_at` era un único
-- timestamp que liquidaba la entrada entera. Funcionaba bien para 1↔1,
-- pero en gastos de grupo necesitas marcar liquidada SOLO la parte de
-- un miembro concreto sin tocar las demás. Por ejemplo, en la
-- suscripción de YouTube a 6 personas, si Oscar te paga su parte vía
-- Bizum, quieres marcar su porción como saldada y dejar las otras 4
-- abiertas.
--
-- Modelo: añadimos `settled_members JSONB` con la forma
--   { member_id: "2026-05-04T22:30:37.000Z" }
-- Cada clave es un member_id del JSONB `splits` y el valor es el
-- timestamp de liquidación de esa parte. Splits ausentes en
-- settled_members se consideran abiertos. settled_at sigue existiendo
-- para liquidaciones globales (1↔1 legacy y para liquidar el grupo
-- entero de un toque cuando aplique).
--
-- Coste: NULL por defecto en filas existentes — no requiere backfill.

alter table public.shared_entries
  add column if not exists settled_members jsonb;
