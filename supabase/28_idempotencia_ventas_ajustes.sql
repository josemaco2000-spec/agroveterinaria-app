-- =================================================================
-- 28. IDEMPOTENCIA PARA SINCRONIZACIÓN OFFLINE (VENTAS Y AJUSTES)
-- =================================================================
-- Contexto: la Fase 4 del modo offline (laptop sin internet en el local,
-- ventas/ajustes se sincronizan al reconectar) reintenta automáticamente
-- cualquier operación que parezca haber fallado por red. Sin esto, si el
-- servidor SÍ llega a registrar la venta/ajuste pero la respuesta se
-- pierde antes de llegar al navegador (el caso raro pero real: se corta
-- la conexión justo después de que el servidor confirma), el reintento
-- automático la duplicaría.
--
-- Esta migración agrega una columna `local_id` (el uuid que el
-- dispositivo genera al crear la venta/ajuste offline) a `ventas` y
-- `movimientos_inventario`, con un índice único parcial (permite muchos
-- NULL para todo lo creado en línea, que no manda local_id). Las RPC
-- `registrar_venta_pos` y `registrar_ajuste_inventario` ahora aceptan
-- `p_local_id` opcional: si ya existe una fila con ese local_id, la
-- devuelven tal cual en vez de insertar de nuevo.
--
-- Compatibilidad: p_local_id tiene DEFAULT NULL, así que el código
-- cliente que aún no mande este parámetro sigue funcionando exactamente
-- igual que antes.
-- =================================================================

ALTER TABLE ventas ADD COLUMN IF NOT EXISTS local_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS ventas_local_id_key ON ventas(local_id) WHERE local_id IS NOT NULL;

ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS local_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS movimientos_inventario_local_id_key ON movimientos_inventario(local_id) WHERE local_id IS NOT NULL;

CREATE OR REPLACE FUNCTION registrar_venta_pos(
  p_items JSONB,
  p_cliente_id UUID DEFAULT NULL,
  p_finca_id UUID DEFAULT NULL,
  p_tipo_pago TEXT DEFAULT 'EFECTIVO',
  p_usuario_id UUID DEFAULT NULL,
  p_ubicacion_id UUID DEFAULT '22222222-2222-2222-2222-222222222222', -- Área de Venta (POS)
  p_local_id UUID DEFAULT NULL
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
  -- Idempotencia: si esta venta offline ya se había registrado en un
  -- intento anterior (la respuesta se perdió, pero la venta sí quedó
  -- creada), devolver el mismo id en vez de duplicarla.
  IF p_local_id IS NOT NULL THEN
    SELECT id INTO v_venta_id FROM ventas WHERE local_id = p_local_id;
    IF FOUND THEN
      RETURN v_venta_id;
    END IF;
  END IF;

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
  INSERT INTO ventas (total, estado_factura, cliente_id, finca_id, tipo_pago, local_id)
  VALUES (v_total, 'pendiente', p_cliente_id, p_finca_id, p_tipo_pago, p_local_id)
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

CREATE OR REPLACE FUNCTION registrar_ajuste_inventario(
  p_producto_id UUID,
  p_ubicacion_id UUID,
  p_tipo_movimiento TEXT,
  p_cantidad DECIMAL(12,3),
  p_usuario_id UUID,
  p_lote_id UUID DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_local_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_movimiento_id UUID;
  v_stock_actual DECIMAL(12,3);
BEGIN
  -- Idempotencia: mismo criterio que registrar_venta_pos.
  IF p_local_id IS NOT NULL THEN
    SELECT id INTO v_movimiento_id FROM movimientos_inventario WHERE local_id = p_local_id;
    IF FOUND THEN
      RETURN v_movimiento_id;
    END IF;
  END IF;

  IF NOT es_admin(p_usuario_id) THEN
    RAISE EXCEPTION 'Solo un administrador puede registrar ajustes de inventario.';
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

  -- Mismo candado que ventas/traslados: serializa contra cualquier otra
  -- operación sobre el mismo producto+ubicación.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_producto_id::text || '|' || p_ubicacion_id::text, 0)
  );

  IF p_tipo_movimiento IN ('AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN
    -- Validar stock disponible en esa ubicación (y ese lote específico,
    -- si se indicó) antes de restar.
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
    -- AJUSTE_ENTRADA: no requiere validación de stock previo
    IF p_lote_id IS NOT NULL THEN
      UPDATE lotes SET stock_actual = stock_actual + p_cantidad WHERE id = p_lote_id;
    END IF;
    UPDATE productos SET stock_base = stock_base + p_cantidad WHERE id = p_producto_id;
  END IF;

  INSERT INTO movimientos_inventario (
    producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, usuario_id, observaciones, local_id
  ) VALUES (
    p_producto_id, p_lote_id, p_ubicacion_id, p_tipo_movimiento, p_cantidad, p_usuario_id, p_observaciones, p_local_id
  ) RETURNING id INTO v_movimiento_id;

  RETURN v_movimiento_id;
END;
$$;
