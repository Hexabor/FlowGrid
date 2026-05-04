-- Migration 11: reparto custom por miembro en plantillas periódicas de
-- grupo. Run this ONCE en Supabase SQL editor; idempotente.
--
-- Contexto: hasta ahora una plantilla con `group_id` se materializaba
-- usando el `default_split_mode` y `default_split` del grupo. Si el
-- usuario quería que esa plantilla repartiera distinto que el default
-- (p. ej. la suscripción de YouTube reparte 50/30/20% pero el grupo en
-- general por defecto va a partes iguales), no había forma de
-- decírselo a la plantilla — el motor pisaba con el default.
--
-- Modelo: añadimos `group_split JSONB` con la forma
--   { member_id: percent }
-- (la suma debe ser 100). Si está NULL, el motor cae al default del
-- grupo. Si está presente, se respeta — incluso si más adelante
-- cambia el default del grupo.
--
-- Por qué porcentajes y no cantidades: la plantilla puede generar a
-- distintos importes (si el usuario edita `amount`); guardando %
-- escalamos correctamente sin tener que recalcular cada vez.

alter table public.recurring_templates
  add column if not exists group_split jsonb;
