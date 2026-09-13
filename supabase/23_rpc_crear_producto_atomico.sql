-- =================================================================
-- 23. RPC TRANSACCIONAL: CREAR PRODUCTO COMPLETO
-- =================================================================
-- PROVENIENCIA: esta función YA ESTABA DESPLEGADA en producción antes
-- de esta migración (verificado con pg_get_functiondef durante la
-- reconciliación esquema real vs. repo — coincide byte a byte). El
-- archivo fuente original vivía solo en un worktree de revisión de
-- código que nunca se mergeó a main:
--   .claude/worktrees/code-review-refactor-12d75d/supabase/14_rpc_crear_producto_atomico.sql
-- Se renumera aquí como 23 (siguiente disponible en main) para que el
-- historial de migraciones por fin coincida con la realidad.
--
-- Además del defasaje de versionado, esta RPC existía sin uso real:
-- inventario.js seguía haciendo 5 INSERT secuenciales sin transacción
-- para crear un producto (productos → productos_costos → lotes →
-- movimientos_inventario → presentaciones), por lo que un fallo a
-- mitad de camino podía dejar un producto con stock_base sin su
-- respaldo correspondiente en el Kardex. Esta migración conecta esa
-- pieza: inventario.js ahora llama a esta RPC.
--
-- Reemplaza los 5 INSERT sueltos por una única función. Como todo el
-- cuerpo de una función plpgsql corre dentro de una sola transacción,
-- si cualquier paso falla (RAISE EXCEPTION o error de constraint),
-- Postgres revierte TODO automáticamente.
-- =================================================================

-- Columna que el frontend ya usaba pero no estaba en ninguna
-- migración rastreada; se agrega de forma defensiva e idempotente
-- (ya existe en producción).
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS imagen_url TEXT;

CREATE OR REPLACE FUNCTION crear_producto_completo(
  p_nombre TEXT,
  p_unidad_base TEXT,
  p_usuario_id UUID,
  p_codigo_barras TEXT DEFAULT NULL,
  p_categoria TEXT DEFAULT NULL,
  p_stock_base DECIMAL(12,3) DEFAULT 0,
  p_precio_costo DECIMAL(12,2) DEFAULT 0,
  p_precio_venta DECIMAL(12,2) DEFAULT 0,
  p_imagen_url TEXT DEFAULT NULL,
  p_es_afecto_iva BOOLEAN DEFAULT true,
  p_numero_lote TEXT DEFAULT NULL,
  p_fecha_vencimiento DATE DEFAULT NULL,
  p_nombre_presentacion TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_producto_id UUID;
  v_lote_id UUID := NULL;
  v_nombre_presentacion TEXT;
  UUID_BODEGA_CENTRAL CONSTANT UUID := '11111111-1111-1111-1111-111111111111';
BEGIN
  -- Solo el admin puede crear productos (misma regla que la política RLS
  -- "Solo admin modifica productos"; se repite aquí porque SECURITY DEFINER
  -- bypasea RLS al ejecutar con privilegios del dueño de la función).
  IF NOT es_admin(p_usuario_id) THEN
    RAISE EXCEPTION 'Solo un administrador puede registrar productos.';
  END IF;

  IF p_nombre IS NULL OR trim(p_nombre) = '' THEN
    RAISE EXCEPTION 'El nombre del producto es obligatorio.';
  END IF;

  IF p_unidad_base IS NULL OR trim(p_unidad_base) = '' THEN
    RAISE EXCEPTION 'La unidad base del producto es obligatoria.';
  END IF;

  IF p_stock_base < 0 THEN
    RAISE EXCEPTION 'El stock inicial no puede ser negativo.';
  END IF;

  IF p_precio_costo < 0 OR p_precio_venta < 0 THEN
    RAISE EXCEPTION 'El costo y el precio de venta no pueden ser negativos.';
  END IF;

  -- 1. Producto
  INSERT INTO productos (
    nombre, codigo_barras, categoria, unidad_base, stock_base, imagen_url, es_afecto_iva
  ) VALUES (
    trim(p_nombre), p_codigo_barras, p_categoria, trim(p_unidad_base), p_stock_base, p_imagen_url, p_es_afecto_iva
  )
  RETURNING id INTO v_producto_id;

  -- 2. Costo
  INSERT INTO productos_costos (producto_id, precio_costo)
  VALUES (v_producto_id, p_precio_costo);

  -- 3. Lote inicial (FEFO) — opcional: si no llega número de lote o
  -- fecha de vencimiento, se omite en vez de violar el NOT NULL de
  -- lotes.fecha_vencimiento (bug que existía en el flujo anterior).
  IF p_numero_lote IS NOT NULL AND trim(p_numero_lote) <> ''
     AND p_fecha_vencimiento IS NOT NULL AND p_stock_base > 0 THEN
    INSERT INTO lotes (producto_id, numero_lote, fecha_vencimiento, stock_inicial, stock_actual)
    VALUES (v_producto_id, trim(p_numero_lote), p_fecha_vencimiento, p_stock_base, p_stock_base)
    RETURNING id INTO v_lote_id;
  END IF;

  -- 4. Movimiento Kardex de entrada en Bodega Central (si hay stock inicial).
  -- lote_id puede ser NULL si no se registró lote formal (igual que el
  -- fallback "Lote General" que usa el módulo de traslados).
  IF p_stock_base > 0 THEN
    INSERT INTO movimientos_inventario (
      producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, usuario_id
    ) VALUES (
      v_producto_id, v_lote_id, UUID_BODEGA_CENTRAL, 'ENTRADA_COMPRA', p_stock_base, p_usuario_id
    );
  END IF;

  -- 5. Presentación base para que el producto aparezca de inmediato en el POS
  v_nombre_presentacion := COALESCE(
    NULLIF(trim(p_nombre_presentacion), ''),
    initcap(trim(p_unidad_base)),
    'Unidad'
  );

  INSERT INTO presentaciones (producto_id, nombre_presentacion, factor_conversion, precio_venta)
  VALUES (v_producto_id, v_nombre_presentacion, 1, p_precio_venta);

  RETURN v_producto_id;
END;
$$;
