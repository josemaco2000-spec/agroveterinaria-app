-- =================================================================
-- 32. FIX CRÍTICO: AMBIGÜEDAD DE FUNCIÓN EN VENTAS POS Y AJUSTES
-- =================================================================
-- DIAGNÓSTICO (verificado contra producción el 2026-09-24):
-- La migración 28 agregó el parámetro `p_local_id` a registrar_venta_pos
-- y registrar_ajuste_inventario con CREATE OR REPLACE. Como cambió la
-- firma, Postgres NO reemplazó las funciones: creó un OVERLOAD nuevo
-- (el mismo problema ya documentado en 13_fix_venta_pos_atomica.sql).
--
-- Resultado real: pos.js y cajero-pos.js llaman registrar_venta_pos en
-- línea SIN p_local_id → ambas versiones coinciden → PostgREST responde
--   PGRST203 "Could not choose the best candidate function"
-- y la venta NO se registra (el POS muestra "Error al procesar la
-- venta"). Lo mismo pasa con kardex.js → registrar_ajuste_inventario.
-- Solo funcionaba la sincronización offline (sync-queue.js), que sí
-- manda p_local_id y por eso resuelve a la versión nueva sin ambigüedad.
--
-- CORRECCIÓN: eliminar los overloads viejos. La versión de la migración
-- 28 tiene p_local_id DEFAULT NULL, así que las llamadas sin ese
-- parámetro resuelven a ella y se comportan exactamente igual que antes.
--
-- IMPORTANTE: Ejecutar manualmente en el SQL Editor de Supabase.
-- =================================================================

-- Firma de 13_fix_venta_pos_atomica.sql (6 parámetros, sin p_local_id)
DROP FUNCTION IF EXISTS public.registrar_venta_pos(jsonb, uuid, uuid, text, uuid, uuid);

-- Firma de 26_rpc_ajustes_mermas_inventario.sql (7 parámetros, sin p_local_id)
DROP FUNCTION IF EXISTS public.registrar_ajuste_inventario(uuid, uuid, text, numeric, uuid, uuid, text);

-- Recargar el caché de esquema de PostgREST para que deje de ver los
-- overloads eliminados de inmediato.
NOTIFY pgrst, 'reload schema';
