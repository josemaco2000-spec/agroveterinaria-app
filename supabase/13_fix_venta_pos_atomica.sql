-- =================================================================
-- 13. FIX: VENTA POS ATÓMICA (Área de Venta) + AMBIGÜEDAD DE FUNCIÓN
-- =================================================================
-- DIAGNÓSTICO:
-- Al probar procesar_salida_fefo contra la base real con la firma de
-- 4 parámetros que usan pos.js/cajero-pos.js (sin p_ubicacion_id),
-- PostgREST devolvió HTTP 300 / PGRST203 "Could not choose the best
-- candidate function": existen DOS versiones simultáneas de la función
-- en producción, la de 04_kardex_fefo.sql (4 parámetros, sin ubicación)
-- y la de 11_inventario_multi_ubicacion.sql (5 parámetros, con
-- p_ubicacion_id) — porque CREATE OR REPLACE FUNCTION no reemplaza una
-- función cuando cambia su firma, crea un OVERLOAD nuevo.
--
-- Resultado real: CADA venta desde el POS llama a procesar_salida_fefo
-- con 4 parámetros → PostgREST no puede resolver la ambigüedad → la
-- función NUNCA se ejecuta → el stock NUNCA se descuenta. Como esa
-- llamada RPC no formaba parte de la misma transacción que el INSERT en
-- `ventas`/`detalle_ventas` (eran 3 llamadas de red independientes), la
-- venta SÍ quedaba registrada (aparece en el historial) mientras el
-- inventario quedaba intacto — exactamente el síntoma reportado: "la UI
-- muestra éxito pero el stock no se descuenta ni se refleja en el POS".
--
-- CORRECCIÓN:
-- 1) Eliminar el overload viejo y ambiguo de procesar_salida_fefo.
-- 2) Re-afirmar la versión correcta (consciente de ubicación).
-- 3) Consolidar venta + detalle + descuento de stock FEFO en UNA SOLA
--    función RPC atómica (registrar_venta_pos), igual que ya se hizo
--    para traslados en 12_fix_traslado_atomico.sql: si cualquier ítem
--    falla, TODA la transacción se revierte — no puede quedar una venta
--    registrada sin su stock correspondiente descontado.
--
-- IMPORTANTE: Ejecutar manualmente en el SQL Editor de Supabase.
-- =================================================================

-- 1. Eliminar el overload antiguo y ambiguo (4 parámetros, sin ubicación)
DROP FUNCTION IF EXISTS public.procesar_salida_fefo(uuid, numeric, uuid, uuid);

-- 2. Re-afirmar la función consciente de ubicación (idéntica a la de
--    11_inventario_multi_ubicacion.sql, redeclarada aquí para que esta
--    migración sea autosuficiente y no dependa de qué versión haya
--    quedado activa en producción).
CREATE OR REPLACE FUNCTION procesar_salida_fefo(
  p_producto_id UUID,
  p_cantidad_base DECIMAL(12,3),
  p_referencia_id UUID DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL,
  p_ubicacion_id UUID DEFAULT '22222222-2222-2222-2222-222222222222' -- Por defecto: Área de Venta (POS)
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_resto DECIMAL(12,3) := p_cantidad_base;
  v_lote RECORD;
  v_descuento DECIMAL(12,3);
  v_stock_total DECIMAL(12,3);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ubicaciones WHERE id = p_ubicacion_id AND tipo = 'punto_venta' AND activo = true
  ) THEN
    RAISE EXCEPTION 'Las ventas POS solo pueden realizarse en ubicaciones tipo punto_venta. Ubicación solicitada no autorizada.';
  END IF;

  -- Candado transaccional: serializa ventas/traslados concurrentes sobre el
  -- mismo producto+ubicación para evitar sobregiros por condición de carrera.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_producto_id::text || '|' || p_ubicacion_id::text, 0)
  );

  SELECT COALESCE(SUM(
    CASE
      WHEN tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO') THEN cantidad
      WHEN tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO') THEN -cantidad
      ELSE 0
    END
  ), 0) INTO v_stock_total
  FROM movimientos_inventario
  WHERE producto_id = p_producto_id AND ubicacion_id = p_ubicacion_id;

  IF v_stock_total < p_cantidad_base THEN
    RAISE EXCEPTION 'Stock insuficiente en el Área de Venta para el producto. Disponible en POS: %, Requerido: %', v_stock_total, p_cantidad_base;
  END IF;

  FOR v_lote IN
    SELECT
      m.lote_id AS id,
      SUM(
        CASE
          WHEN m.tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO') THEN m.cantidad
          WHEN m.tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO') THEN -m.cantidad
          ELSE 0
        END
      ) AS stock_lote_ubicacion
    FROM movimientos_inventario m
    JOIN lotes l ON l.id = m.lote_id
    WHERE m.producto_id = p_producto_id AND m.ubicacion_id = p_ubicacion_id
    GROUP BY m.lote_id, l.fecha_vencimiento, l.created_at
    HAVING SUM(
      CASE
        WHEN m.tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO') THEN m.cantidad
        WHEN m.tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO') THEN -m.cantidad
        ELSE 0
      END
    ) > 0
    ORDER BY l.fecha_vencimiento ASC, l.created_at ASC
  LOOP
    EXIT WHEN v_resto <= 0;

    IF v_lote.stock_lote_ubicacion >= v_resto THEN
      v_descuento := v_resto;
    ELSE
      v_descuento := v_lote.stock_lote_ubicacion;
    END IF;

    UPDATE lotes
    SET stock_actual = stock_actual - v_descuento
    WHERE id = v_lote.id;

    INSERT INTO movimientos_inventario (
      producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, referencia_id, usuario_id
    ) VALUES (
      p_producto_id, v_lote.id, p_ubicacion_id, 'SALIDA_VENTA', v_descuento, p_referencia_id, p_usuario_id
    );

    v_resto := v_resto - v_descuento;
  END LOOP;

  UPDATE productos
  SET stock_base = stock_base - p_cantidad_base
  WHERE id = p_producto_id;
END;
$$;

-- 3. RPC atómica: registrar una venta POS completa (cabecera + detalle +
--    descuento de stock FEFO) en una única transacción de base de datos.
CREATE OR REPLACE FUNCTION registrar_venta_pos(
  p_items JSONB,
  p_cliente_id UUID DEFAULT NULL,
  p_finca_id UUID DEFAULT NULL,
  p_tipo_pago TEXT DEFAULT 'EFECTIVO',
  p_usuario_id UUID DEFAULT NULL,
  p_ubicacion_id UUID DEFAULT '22222222-2222-2222-2222-222222222222' -- Área de Venta (POS)
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_venta_id UUID;
  v_total DECIMAL(14,2) := 0;
  v_item JSONB;
  v_presentacion_id UUID;
  v_producto_id UUID;
  v_cantidad DECIMAL(12,3);
  v_precio_venta DECIMAL(14,2);
  v_descuento DECIMAL(5,2);
  v_precio_efectivo DECIMAL(14,2);
  v_factor_conversion DECIMAL(12,3);
  v_costo_unitario DECIMAL(14,4);
  v_cantidad_base DECIMAL(12,3);
  v_saldo_actual DECIMAL(14,2);
  v_limite_credito DECIMAL(14,2);
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El carrito no puede estar vacío.';
  END IF;

  -- 1. Calcular el total real ANTES de insertar nada (permite validar
  --    crédito con la cifra correcta sin tocar aún la base de datos).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_cantidad        := (v_item->>'cantidad')::DECIMAL;
    v_precio_venta    := (v_item->>'precio_venta')::DECIMAL;
    v_descuento       := COALESCE((v_item->>'descuento_porcentaje')::DECIMAL, 0);
    v_precio_efectivo := v_precio_venta * (1 - v_descuento / 100);
    v_total := v_total + (v_cantidad * v_precio_efectivo);
  END LOOP;

  -- 2. Validación de crédito con bloqueo de fila (evita sobregiro por
  --    ventas a crédito concurrentes del mismo cliente).
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

  -- 3. Insertar cabecera de venta
  INSERT INTO ventas (total, estado_factura, cliente_id, finca_id, tipo_pago)
  VALUES (v_total, 'pendiente', p_cliente_id, p_finca_id, p_tipo_pago)
  RETURNING id INTO v_venta_id;

  -- 4. Insertar detalle y descontar stock FEFO (Área de Venta) por cada
  --    ítem. Si procesar_salida_fefo lanza una excepción (p.ej. stock
  --    insuficiente), TODA la transacción se revierte: la cabecera de
  --    venta, el detalle ya insertado y cualquier movimiento de stock de
  --    ítems anteriores del mismo carrito — atomicidad real, no aparente.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_presentacion_id   := (v_item->>'presentacion_id')::UUID;
    v_producto_id       := (v_item->>'producto_id')::UUID;
    v_cantidad          := (v_item->>'cantidad')::DECIMAL;
    v_precio_venta      := (v_item->>'precio_venta')::DECIMAL;
    v_descuento         := COALESCE((v_item->>'descuento_porcentaje')::DECIMAL, 0);
    v_precio_efectivo   := v_precio_venta * (1 - v_descuento / 100);
    v_factor_conversion := COALESCE((v_item->>'factor_conversion')::DECIMAL, 1);
    v_costo_unitario    := COALESCE((v_item->>'costo_unitario')::DECIMAL, 0);
    v_cantidad_base     := v_cantidad * v_factor_conversion;

    IF v_producto_id IS NULL OR v_presentacion_id IS NULL OR v_cantidad IS NULL OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Ítem del carrito inválido: producto_id, presentacion_id y cantidad son obligatorios.';
    END IF;

    INSERT INTO detalle_ventas (venta_id, presentacion_id, cantidad, subtotal, costo_unitario)
    VALUES (v_venta_id, v_presentacion_id, v_cantidad, v_cantidad * v_precio_efectivo, v_costo_unitario);

    PERFORM procesar_salida_fefo(v_producto_id, v_cantidad_base, v_venta_id, p_usuario_id, p_ubicacion_id);
  END LOOP;

  -- 5. Si fue crédito, actualizar saldo_actual del cliente (fila ya
  --    bloqueada por el FOR UPDATE del paso 2).
  IF p_tipo_pago = 'CREDITO' AND p_cliente_id IS NOT NULL THEN
    UPDATE clientes SET saldo_actual = COALESCE(saldo_actual, 0) + v_total WHERE id = p_cliente_id;
  END IF;

  RETURN v_venta_id;
END;
$$;
