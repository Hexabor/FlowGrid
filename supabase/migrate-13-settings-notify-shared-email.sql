-- Migration 13: opt-in de avisos por email de gastos compartidos.
-- Run this ONCE in Supabase SQL editor. Idempotente.
--
-- Contexto: cuando un contacto te añade un gasto compartido, la app
-- puede mandarte un email avisándote (con el saldo resultante, para que
-- veas si ya queda cubierto por un adelanto). Es OPT-IN y está
-- DESACTIVADO por defecto: nadie recibe nada salvo que lo active en
-- Configuración → Avisos.
--
-- Modelo: añadimos `notify_shared_email BOOLEAN` a la tabla settings
-- (una fila por usuario). La Edge Function `notify-shared-entry` lee
-- esta columna del DESTINATARIO (vía service role) antes de enviar.
--
-- Coste: false por defecto en filas existentes — no requiere backfill.

alter table public.settings
  add column if not exists notify_shared_email boolean not null default false;
