-- Migration 12: adelantos (pagos anticipados por gastos futuros).
-- Run this ONCE in Supabase SQL editor. Idempotente.
--
-- Contexto: a veces un contacto te paga ANTES de que el gasto
-- compartido haya ocurrido (te da 50 € hoy para una cena del mes que
-- viene). En cuanto al saldo, eso es idéntico a un pago normal: el
-- importe se neto automáticamente cuando el gasto real aparece. Lo
-- único que cambia es la SEMÁNTICA: ese -50 € no es una deuda, es un
-- adelanto que aún no se ha consumido.
--
-- Modelo: añadimos `advance BOOLEAN`. Solo aplica a filas con
-- type = 'payment'. Cuando es true, la app etiqueta la entrada como
-- "Adelanto" en el historial y marca la card del contacto para que se
-- distinga de una deuda real. El cálculo de saldo NO cambia: un
-- adelanto suma/resta exactamente igual que una liquidación.
--
-- Coste: false por defecto en filas existentes — no requiere backfill.

alter table public.shared_entries
  add column if not exists advance boolean not null default false;
