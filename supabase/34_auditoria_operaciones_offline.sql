-- =================================================================
-- 34. AUDITORÍA DE OPERACIONES OFFLINE MULTI-DISPOSITIVO (FASE 0)
-- =================================================================
-- Contexto: el sistema lo usan a la vez 1 computadora y 2 teléfonos, y
-- los tres pueden operar sin internet. Cada operación offline nace en un
-- dispositivo, la hace un usuario en un momento dado, y llega al servidor
-- más tarde -- a veces sincronizada por OTRA persona (p.ej. el admin abre
-- la app y la cola del cajero se vacía con la sesión del admin).
--
-- Hoy el servidor no puede distinguir eso:
--   - ventas.fecha_venta / movimientos_inventario.created_at se llenan
--     con NOW() al sincronizar, no cuando ocurrió la operación.
--   - ventas.usuario_id sale de auth.uid() (migración 33) = quien
--     sincroniza, no necesariamente quien vendió.
--   - no se sabe desde qué dispositivo vino cada operación.
--
-- Esta migración SOLO PREPARA el esquema (columnas nullable, sin
-- defaults, sin backfill). NO cambia ninguna RPC, política RLS ni dato
-- existente: el código actual sigue funcionando igual y deja estas
-- columnas en NULL. Las RPC que las llenen (validando que quien
-- sincroniza tenga derecho a registrar en nombre del autor) son de la
-- FASE 1.
--
-- Semántica acordada (para no duplicar columnas existentes):
--   ventas.usuario_id        = autor de la venta (vendedor original)
--   ventas.fecha_venta       = fecha/hora de la operación (original)
--   movimientos.usuario_id   = autor del movimiento
--   cierres_caja.usuario_id  = autor del cierre (ya lo manda el cliente)
--   *.fecha_operacion        = fecha/hora original, donde no había columna
--   *.sincronizado_en        = cuándo lo recibió el servidor desde la cola
--                              (NULL = se registró en línea, sin cola)
--   *.sincronizado_por       = sesión con la que se sincronizó
--   *.device_id              = dispositivo de origen (CampoAltoDevice)
--
-- device_id es una afirmación del cliente (identifica, no autentica): sirve
-- para trazabilidad, nunca para autorizar.
--
-- IMPORTANTE: Ejecutar manualmente en el SQL Editor de Supabase. Es
-- idempotente (IF NOT EXISTS) y no bloquea tablas por tiempo apreciable
-- (ADD COLUMN nullable sin default es solo metadatos en PostgreSQL).
-- =================================================================

-- -----------------------------------------------------------------
-- 1. Ventas
-- -----------------------------------------------------------------
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS sincronizado_en TIMESTAMP WITH TIME ZONE;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS sincronizado_por UUID REFERENCES auth.users(id);

COMMENT ON COLUMN ventas.device_id IS 'Dispositivo donde se hizo la venta (device_id local). NULL = anterior a la migración 34.';
COMMENT ON COLUMN ventas.sincronizado_en IS 'Cuándo llegó al servidor desde la cola offline. NULL = registrada en línea. fecha_venta es la fecha de la operación.';
COMMENT ON COLUMN ventas.sincronizado_por IS 'Sesión que sincronizó la venta offline. El autor sigue siendo usuario_id.';

-- -----------------------------------------------------------------
-- 2. Movimientos de inventario
-- -----------------------------------------------------------------
ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS fecha_operacion TIMESTAMP WITH TIME ZONE;
ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS sincronizado_en TIMESTAMP WITH TIME ZONE;
ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS sincronizado_por UUID REFERENCES auth.users(id);

COMMENT ON COLUMN movimientos_inventario.fecha_operacion IS 'Fecha/hora original del movimiento en el dispositivo. NULL = igual a created_at (registrado en línea).';
COMMENT ON COLUMN movimientos_inventario.sincronizado_en IS 'Cuándo llegó al servidor desde la cola offline. NULL = registrado en línea.';
COMMENT ON COLUMN movimientos_inventario.sincronizado_por IS 'Sesión que sincronizó el movimiento offline. El autor sigue siendo usuario_id.';

-- -----------------------------------------------------------------
-- 3. Cierres de caja: además, identidad propia (local_id) para poder
--    hacerlos idempotentes igual que ventas/ajustes (migración 28).
-- -----------------------------------------------------------------
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS local_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS cierres_caja_local_id_key ON cierres_caja(local_id) WHERE local_id IS NOT NULL;

ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS fecha_operacion TIMESTAMP WITH TIME ZONE;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS sincronizado_en TIMESTAMP WITH TIME ZONE;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS sincronizado_por UUID REFERENCES auth.users(id);

COMMENT ON COLUMN cierres_caja.local_id IS 'Identidad local (uuid) del cierre encolado offline; único para idempotencia.';
COMMENT ON COLUMN cierres_caja.fecha_operacion IS 'Fecha/hora original del cierre en el dispositivo. NULL = igual a created_at.';

-- -----------------------------------------------------------------
-- 4. Tablas de conciliación (migraciones 27 y 29). Ahí usuario_id es
--    quien REGISTRÓ el fallo (la política exige usuario_id = auth.uid()),
--    así que el autor original necesita su propia columna.
-- -----------------------------------------------------------------
ALTER TABLE ventas_offline_fallidas ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE ventas_offline_fallidas ADD COLUMN IF NOT EXISTS usuario_origen_id UUID REFERENCES auth.users(id);
ALTER TABLE ventas_offline_fallidas ADD COLUMN IF NOT EXISTS fecha_operacion TIMESTAMP WITH TIME ZONE;

ALTER TABLE movimientos_offline_fallidos ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE movimientos_offline_fallidos ADD COLUMN IF NOT EXISTS usuario_origen_id UUID REFERENCES auth.users(id);
ALTER TABLE movimientos_offline_fallidos ADD COLUMN IF NOT EXISTS fecha_operacion TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN ventas_offline_fallidas.usuario_origen_id IS 'Autor original de la venta offline. usuario_id = quien registró el fallo al sincronizar.';
COMMENT ON COLUMN movimientos_offline_fallidos.usuario_origen_id IS 'Autor original del ajuste offline. usuario_id = quien registró el fallo al sincronizar.';

-- Consultas de auditoría por dispositivo (p.ej. "qué subió el teléfono 2").
CREATE INDEX IF NOT EXISTS idx_ventas_device_id ON ventas (device_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movimientos_device_id ON movimientos_inventario (device_id) WHERE device_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
