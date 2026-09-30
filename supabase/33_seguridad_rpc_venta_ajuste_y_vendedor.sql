-- =================================================================
-- 33. SEGURIDAD EN RPC DE VENTA/AJUSTE + VENDEDOR EN CADA VENTA
-- =================================================================
-- Requiere haber ejecutado antes 32_fix_ambiguedad_overloads_venta_ajuste.sql.
--
-- DIAGNÓSTICO (verificado contra producción el 2026-09-24):
--
-- 1) Las RPC SECURITY DEFINER se podían ejecutar SIN iniciar sesión, solo
--    con la clave anon (que es pública: está en el JavaScript del sitio).
--    Nunca se hizo REVOKE, y Supabase da EXECUTE a anon por defecto.
--    Cualquiera podía registrar ventas, descontar stock o subir la deuda
--    de un cliente. Peor aún, procesar_salida_fefo (función interna)
--    también era invocable directamente y descuenta stock sin venta.
--
-- 2) registrar_venta_pos confiaba en lo que mandaba el navegador:
--    precio_venta, factor_conversion, costo_unitario y descuento. Con las
--    devtools se podía vender a Q0.01 o con 100%+ de descuento.
--    Además, como productos_costos solo lo lee un admin (RLS), el POS del
--    vendedor mandaba siempre costo_unitario = 0 → todas las ventas del
--    vendedor quedaban con costo 0 y margen falso en los reportes.
--
-- 3) registrar_ajuste_inventario validaba es_admin(p_usuario_id), un
--    parámetro que manda el navegador: un vendedor podía pasar el uuid de
--    un admin y registrar ajustes/mermas.
--
-- 4) La tabla ventas no guardaba quién hizo la venta.
--
-- CORRECCIÓN:
-- - El usuario SIEMPRE sale de la sesión (auth.uid()); p_usuario_id se
--   conserva en la firma solo por compatibilidad y se ignora.
-- - Precio, factor, producto y costo se leen de la base. Si el precio que
--   mandó el POS no coincide con el vigente (p.ej. el admin lo cambió
--   mientras el carrito estaba abierto, o una venta offline se sincroniza
--   después de un cambio de precio), la venta se RECHAZA con un mensaje
--   claro en vez de cobrar una cifra distinta a la del ticket. Una venta
--   offline rechazada así cae en el panel de conciliación (migración 27).
-- - Descuento limitado a 0–100%. (La autorización por PIN sigue siendo
--   del lado del navegador; ver nota al final.)
-- - Nueva columna ventas.usuario_id (vendedor).
-- - REVOKE de EXECUTE a anon/PUBLIC en todas las RPC de escritura, y
--   procesar_salida_fefo queda solo de uso interno.
--
-- Las firmas NO cambian → CREATE OR REPLACE reemplaza in situ (sin crear
-- overloads nuevos, ver migraciones 13 y 32).
--
-- IMPORTANTE: Ejecutar manualmente en el SQL Editor de Supabase.
-- =================================================================

-- -----------------------------------------------------------------
-- 1. Vendedor en cada venta
-- -----------------------------------------------------------------
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS usuario_id UUID REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_ventas_usuario_fecha ON ventas (usuario_id, fecha_venta DESC);

-- -----------------------------------------------------------------
-- 2. registrar_venta_pos: usuario de la sesión + precios/costos del servidor
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION registrar_venta_pos(
  p_items JSONB,
  p_cliente_id UUID DEFAULT NULL,
  p_finca_id UUID DEFAULT NULL,
  p_tipo_pago TEXT DEFAULT 'EFECTIVO',
  p_usuario_id UUID DEFAULT NULL, -- Ignorado: se usa auth.uid(). Se conserva por compatibilidad de firma.
  p_ubicacion_id UUID DEFAULT '22222222-2222-2222-2222-222222222222', -- Área de Venta (POS)
  p_local_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id UUID := auth.uid();
  v_venta_id UUID;
  v_total DECIMAL(14,2) := 0;
  v_item JSONB;
  v_presentacion_id UUID;
  v_producto_id UUID;
  v_producto_cliente UUID;
  v_nombre_presentacion TEXT;
  v_cantidad DECIMAL(12,3);
  v_precio_venta DECIMAL(14,2);
  v_precio_cliente DECIMAL(14,2);
  v_descuento DECIMAL(5,2);
  v_precio_efectivo DECIMAL(14,2);
  v_factor_conversion DECIMAL(12,3);
  v_costo_base DECIMAL(14,4);
  v_cantidad_base DECIMAL(12,3);
  v_saldo_actual DECIMAL(14,2);
  v_limite_credito DECIMAL(14,2);
  v_lineas JSONB := '[]'::JSONB;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida: inicia sesión para registrar ventas.';
  END IF;

  -- Idempotencia (ver migración 28)
  IF p_local_id IS NOT NULL THEN
    SELECT id INTO v_venta_id FROM ventas WHERE local_id = p_local_id;
    IF FOUND THEN
      RETURN v_venta_id;
    END IF;
  END IF;

  IF p_tipo_pago IS NULL OR p_tipo_pago NOT IN ('EFECTIVO', 'TRANSFERENCIA', 'CREDITO') THEN
    RAISE EXCEPTION 'Tipo de pago inválido: %', p_tipo_pago;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El carrito no puede estar vacío.';
  END IF;

  -- 1. Validar cada ítem contra la base y calcular el total real ANTES de
  --    insertar nada. Precio, factor, producto y costo salen de la base;
  --    del POS solo se toman presentacion_id, cantidad y descuento.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_presentacion_id  := (v_item->>'presentacion_id')::UUID;
    v_cantidad         := (v_item->>'cantidad')::DECIMAL;
    v_descuento        := COALESCE((v_item->>'descuento_porcentaje')::DECIMAL, 0);
    v_precio_cliente   := (v_item->>'precio_venta')::DECIMAL;
    v_producto_cliente := (v_item->>'producto_id')::UUID;

    IF v_presentacion_id IS NULL OR v_cantidad IS NULL OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Ítem del carrito inválido: presentacion_id y cantidad (> 0) son obligatorios.';
    END IF;

    IF v_descuento < 0 OR v_descuento > 100 THEN
      RAISE EXCEPTION 'Descuento inválido (% por ciento): debe estar entre 0 y 100.', v_descuento;
    END IF;

    SELECT pr.producto_id, pr.precio_venta, COALESCE(pr.factor_conversion, 1), pr.nombre_presentacion
      INTO v_producto_id, v_precio_venta, v_factor_conversion, v_nombre_presentacion
    FROM presentaciones pr
    WHERE pr.id = v_presentacion_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La presentación % ya no existe. Recarga el catálogo.', v_presentacion_id;
    END IF;

    IF v_producto_cliente IS NOT NULL AND v_producto_cliente <> v_producto_id THEN
      RAISE EXCEPTION 'Ítem del carrito inválido: la presentación no pertenece al producto indicado.';
    END IF;

    -- El precio cobrado (ticket) debe coincidir con el vigente.
    IF v_precio_cliente IS NOT NULL AND abs(v_precio_cliente - v_precio_venta) > 0.005 THEN
      RAISE EXCEPTION 'El precio de "%" cambió (ticket: Q%, vigente: Q%). Recarga el catálogo y vuelve a cobrar.',
        v_nombre_presentacion, v_precio_cliente, v_precio_venta;
    END IF;

    SELECT COALESCE(pc.precio_costo, 0) INTO v_costo_base
    FROM productos_costos pc WHERE pc.producto_id = v_producto_id;
    v_costo_base := COALESCE(v_costo_base, 0);

    v_precio_efectivo := v_precio_venta * (1 - v_descuento / 100);
    v_total := v_total + (v_cantidad * v_precio_efectivo);

    v_lineas := v_lineas || jsonb_build_object(
      'presentacion_id', v_presentacion_id,
      'producto_id', v_producto_id,
      'cantidad', v_cantidad,
      'precio_efectivo', v_precio_efectivo,
      'cantidad_base', v_cantidad * v_factor_conversion,
      'costo_unitario', v_factor_conversion * v_costo_base
    );
  END LOOP;

  -- 2. Validación de crédito con bloqueo de fila
  IF p_tipo_pago = 'CREDITO' THEN
    IF p_cliente_id IS NULL THEN
      RAISE EXCEPTION 'No se puede realizar una venta a crédito a Consumidor Final.';
    END IF;

    SELECT saldo_actual, limite_credito INTO v_saldo_actual, v_limite_credito
    FROM clientes WHERE id = p_cliente_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cliente no encontrado.';
    END IF;

    IF (COALESCE(v_saldo_actual, 0) + v_total) > COALESCE(v_limite_credito, 0) THEN
      RAISE EXCEPTION 'Límite de crédito excedido. Disponible: %, Requerido: %',
        GREATEST(0, COALESCE(v_limite_credito, 0) - COALESCE(v_saldo_actual, 0)), v_total;
    END IF;
  END IF;

  -- 3. Cabecera
  INSERT INTO ventas (total, estado_factura, cliente_id, finca_id, tipo_pago, local_id, usuario_id)
  VALUES (v_total, 'pendiente', p_cliente_id, p_finca_id, p_tipo_pago, p_local_id, v_usuario_id)
  RETURNING id INTO v_venta_id;

  -- 4. Detalle + salida FEFO (cualquier excepción revierte TODO)
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_lineas)
  LOOP
    INSERT INTO detalle_ventas (venta_id, presentacion_id, cantidad, subtotal, costo_unitario)
    VALUES (
      v_venta_id,
      (v_item->>'presentacion_id')::UUID,
      (v_item->>'cantidad')::DECIMAL,
      (v_item->>'cantidad')::DECIMAL * (v_item->>'precio_efectivo')::DECIMAL,
      (v_item->>'costo_unitario')::DECIMAL
    );

    PERFORM procesar_salida_fefo(
      (v_item->>'producto_id')::UUID,
      (v_item->>'cantidad_base')::DECIMAL,
      v_venta_id,
      v_usuario_id,
      p_ubicacion_id
    );
  END LOOP;

  -- 5. Crédito: actualizar saldo (fila ya bloqueada en el paso 2)
  IF p_tipo_pago = 'CREDITO' THEN
    UPDATE clientes SET saldo_actual = COALESCE(saldo_actual, 0) + v_total WHERE id = p_cliente_id;
  END IF;

  RETURN v_venta_id;
END;
$$;

-- -----------------------------------------------------------------
-- 3. registrar_ajuste_inventario: admin según la SESIÓN, no el parámetro
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION registrar_ajuste_inventario(
  p_producto_id UUID,
  p_ubicacion_id UUID,
  p_tipo_movimiento TEXT,
  p_cantidad DECIMAL(12,3),
  p_usuario_id UUID, -- Ignorado: se usa auth.uid(). Se conserva por compatibilidad de firma.
  p_lote_id UUID DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_local_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id UUID := auth.uid();
  v_movimiento_id UUID;
  v_stock_actual DECIMAL(12,3);
BEGIN
  IF v_usuario_id IS NULL OR NOT es_admin(v_usuario_id) THEN
    RAISE EXCEPTION 'Solo un administrador puede registrar ajustes de inventario.';
  END IF;

  -- Idempotencia: mismo criterio que registrar_venta_pos.
  IF p_local_id IS NOT NULL THEN
    SELECT id INTO v_movimiento_id FROM movimientos_inventario WHERE local_id = p_local_id;
    IF FOUND THEN
      RETURN v_movimiento_id;
    END IF;
  END IF;

  IF p_tipo_movimiento NOT IN ('AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN
    RAISE EXCEPTION 'Tipo de movimiento inválido para un ajuste: %', p_tipo_movimiento;
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad del ajuste debe ser mayor a 0.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ubicaciones WHERE id = p_ubicacion_id AND activo = true) THEN
    RAISE EXCEPTION 'Ubicación inválida o inactiva.';
  END IF;

  IF p_lote_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM lotes WHERE id = p_lote_id AND producto_id = p_producto_id
  ) THEN
    RAISE EXCEPTION 'El lote indicado no pertenece a este producto.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_producto_id::text || '|' || p_ubicacion_id::text, 0)
  );

  IF p_tipo_movimiento IN ('AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN
    IF p_lote_id IS NOT NULL THEN
      SELECT COALESCE(SUM(
        CASE
          WHEN tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_ENTRADA') THEN cantidad
          WHEN tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO', 'AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN -cantidad
          ELSE 0
        END
      ), 0) INTO v_stock_actual
      FROM movimientos_inventario
      WHERE lote_id = p_lote_id AND ubicacion_id = p_ubicacion_id;
    ELSE
      SELECT COALESCE(SUM(
        CASE
          WHEN tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_ENTRADA') THEN cantidad
          WHEN tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO', 'AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN -cantidad
          ELSE 0
        END
      ), 0) INTO v_stock_actual
      FROM movimientos_inventario
      WHERE producto_id = p_producto_id AND lote_id IS NULL AND ubicacion_id = p_ubicacion_id;
    END IF;

    IF v_stock_actual < p_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para el ajuste. Disponible: %, Solicitado: %', v_stock_actual, p_cantidad;
    END IF;

    IF p_lote_id IS NOT NULL THEN
      UPDATE lotes SET stock_actual = stock_actual - p_cantidad WHERE id = p_lote_id;
    END IF;
    UPDATE productos SET stock_base = stock_base - p_cantidad WHERE id = p_producto_id;
  ELSE
    IF p_lote_id IS NOT NULL THEN
      UPDATE lotes SET stock_actual = stock_actual + p_cantidad WHERE id = p_lote_id;
    END IF;
    UPDATE productos SET stock_base = stock_base + p_cantidad WHERE id = p_producto_id;
  END IF;

  INSERT INTO movimientos_inventario (
    producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, usuario_id, observaciones, local_id
  ) VALUES (
    p_producto_id, p_lote_id, p_ubicacion_id, p_tipo_movimiento, p_cantidad, v_usuario_id, p_observaciones, p_local_id
  ) RETURNING id INTO v_movimiento_id;

  RETURN v_movimiento_id;
END;
$$;

-- -----------------------------------------------------------------
-- 4. Cerrar la ejecución sin sesión (anon) en todas las RPC de escritura.
--    Se recorre pg_proc por nombre para cubrir la firma exacta que exista
--    en producción, sin depender de cuál migración la dejó.
-- -----------------------------------------------------------------
DO $$
DECLARE
  f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS firma, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'registrar_venta_pos',
        'registrar_ajuste_inventario',
        'procesar_salida_fefo',
        'realizar_traslado_inventario',
        'registrar_entrada_compra',
        'registrar_abono_credito',
        'crear_producto_completo',
        'validar_pin_supervisor'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.firma);

    IF f.proname = 'procesar_salida_fefo' THEN
      -- Solo uso interno (la llama registrar_venta_pos como su dueño).
      -- Invocarla directo descontaba stock sin registrar ninguna venta.
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', f.firma);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.firma);
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------
-- NOTA PENDIENTE: la autorización de descuentos con PIN de supervisor
-- (validar_pin_supervisor) ocurre en el navegador. El servidor ahora
-- limita el descuento a 0–100%, pero un vendedor con conocimientos
-- técnicos todavía podría enviar un descuento sin PIN. Cerrarlo del todo
-- exige mandar el PIN junto con la venta y validarlo aquí, lo que choca
-- con las ventas offline (el PIN no se puede verificar sin conexión).
-- -----------------------------------------------------------------
