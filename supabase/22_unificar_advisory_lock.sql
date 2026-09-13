-- =================================================================
-- 22. FIX ALTA: UNIFICAR CLAVE DE ADVISORY LOCK (venta vs. traslado)
-- =================================================================
-- DIAGNÓSTICO (demostrado con prueba de concurrencia real antes de
-- aplicar este fix): procesar_salida_fefo (venta) bloquea con la clave
-- producto_id|ubicacion_id, mientras que realizar_traslado_inventario
-- (traslado) bloqueaba con producto_id|lote_id-o-'GENERAL'|ubicacion_id.
-- Como son claves distintas para la MISMA fila de stock real, una venta
-- y un traslado concurrentes sobre el mismo producto+ubicación NUNCA se
-- serializaban entre sí — ambos podían leer el mismo "stock disponible"
-- antes de que el otro confirmara su cambio, permitiendo sobregiro.
-- Prueba: sesión A retiene el lock de venta 6s: sesión B, con la clave
-- de traslado, adquirió su propio lock distinto en ~0s (no se bloqueó).
--
-- CORRECCIÓN: realizar_traslado_inventario ahora bloquea con la MISMA
-- forma de clave que procesar_salida_fefo — producto_id|ubicacion_id,
-- sin lote_id — sobre la ubicación de ORIGEN (que es donde se valida
-- disponibilidad; el destino nunca tiene chequeo de "alcanza el stock").
-- Efecto secundario aceptado: dos traslados de LOTES distintos del
-- mismo producto desde la misma ubicación ahora se serializan entre sí
-- (antes corrían en paralelo) — costo mínimo de concurrencia a cambio
-- de cerrar la condición de carrera real con las ventas.
--
-- Firma de la función sin cambios (6 parámetros, igual que
-- 12_fix_traslado_atomico.sql) → CREATE OR REPLACE la reemplaza in situ,
-- sin riesgo de crear un overload duplicado.
-- =================================================================

CREATE OR REPLACE FUNCTION realizar_traslado_inventario(
  p_producto_id UUID,
  p_lote_id UUID,
  p_ubicacion_origen_id UUID,
  p_ubicacion_destino_id UUID,
  p_cantidad_base DECIMAL(12,3),
  p_usuario_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_traslado_id UUID := uuid_generate_v4();
  v_stock_origen DECIMAL(12,3);
  v_movimientos_registrados INT;
BEGIN
  IF p_ubicacion_origen_id IS NULL OR p_ubicacion_destino_id IS NULL THEN
    RAISE EXCEPTION 'Debe indicar ubicación de origen y destino.';
  END IF;

  IF p_ubicacion_origen_id = p_ubicacion_destino_id THEN
    RAISE EXCEPTION 'La ubicación de origen y destino deben ser distintas.';
  END IF;

  IF p_cantidad_base IS NULL OR p_cantidad_base <= 0 THEN
    RAISE EXCEPTION 'La cantidad a trasladar debe ser mayor a 0.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ubicaciones WHERE id = p_ubicacion_origen_id AND activo = true) THEN
    RAISE EXCEPTION 'Ubicación de origen inválida o inactiva.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ubicaciones WHERE id = p_ubicacion_destino_id AND activo = true) THEN
    RAISE EXCEPTION 'Ubicación de destino inválida o inactiva.';
  END IF;

  -- Candado transaccional: MISMA forma de clave que procesar_salida_fefo
  -- (producto_id|ubicacion_id) para que una venta y un traslado sobre el
  -- mismo producto+ubicación se serialicen entre sí de verdad.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_producto_id::text || '|' || p_ubicacion_origen_id::text, 0)
  );

  IF p_lote_id IS NOT NULL THEN
    -- Stock disponible del lote específico en la ubicación de origen
    SELECT COALESCE(SUM(
      CASE
        WHEN tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO') THEN cantidad
        WHEN tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO') THEN -cantidad
        ELSE 0
      END
    ), 0) INTO v_stock_origen
    FROM movimientos_inventario
    WHERE lote_id = p_lote_id AND ubicacion_id = p_ubicacion_origen_id;

    -- Resiliencia: si Bodega Central no tiene movimientos aún para este lote,
    -- respaldar desde la tabla 'lotes' e insertar el movimiento inicial.
    IF v_stock_origen = 0 AND p_ubicacion_origen_id = '11111111-1111-1111-1111-111111111111'::uuid THEN
      SELECT COALESCE(stock_actual, 0) INTO v_stock_origen
      FROM lotes
      WHERE id = p_lote_id;

      IF v_stock_origen > 0 THEN
        INSERT INTO movimientos_inventario (
          producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad
        ) VALUES (
          p_producto_id, p_lote_id, p_ubicacion_origen_id, 'ENTRADA_COMPRA', v_stock_origen
        );
      END IF;
    END IF;
  ELSE
    -- "Lote General" (sin lote formal): validar contra el total del
    -- producto sin lote en la ubicación de origen.
    SELECT COALESCE(SUM(
      CASE
        WHEN tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO') THEN cantidad
        WHEN tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO') THEN -cantidad
        ELSE 0
      END
    ), 0) INTO v_stock_origen
    FROM movimientos_inventario
    WHERE producto_id = p_producto_id AND lote_id IS NULL AND ubicacion_id = p_ubicacion_origen_id;

    IF v_stock_origen = 0 AND p_ubicacion_origen_id = '11111111-1111-1111-1111-111111111111'::uuid THEN
      SELECT COALESCE(stock_base, 0) INTO v_stock_origen
      FROM productos
      WHERE id = p_producto_id;

      IF v_stock_origen > 0 THEN
        INSERT INTO movimientos_inventario (
          producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad
        ) VALUES (
          p_producto_id, NULL, p_ubicacion_origen_id, 'ENTRADA_COMPRA', v_stock_origen
        );
      END IF;
    END IF;
  END IF;

  IF v_stock_origen < p_cantidad_base THEN
    RAISE EXCEPTION 'Stock insuficiente en la ubicación de origen. Disponible: %, Solicitado: %', v_stock_origen, p_cantidad_base;
  END IF;

  -- Movimiento 1: Salida de Origen — ubicacion_id fijado explícitamente
  -- (nunca depender del DEFAULT de columna, que apunta a Bodega Central).
  INSERT INTO movimientos_inventario (
    producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, referencia_id, traslado_id, usuario_id
  ) VALUES (
    p_producto_id, p_lote_id, p_ubicacion_origen_id, 'TRASLADO_SALIDA', p_cantidad_base, NULL, v_traslado_id, p_usuario_id
  );

  -- Movimiento 2: Entrada a Destino — ubicacion_id fijado explícitamente.
  INSERT INTO movimientos_inventario (
    producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, referencia_id, traslado_id, usuario_id
  ) VALUES (
    p_producto_id, p_lote_id, p_ubicacion_destino_id, 'TRASLADO_ENTRADA', p_cantidad_base, NULL, v_traslado_id, p_usuario_id
  );

  -- Verificación defensiva post-inserción: si por cualquier razón no quedaron
  -- registrados AMBOS movimientos (origen + destino), abortar la transacción
  -- completa en vez de devolver un ID de traslado "exitoso" pero incompleto.
  SELECT COUNT(*) INTO v_movimientos_registrados
  FROM movimientos_inventario
  WHERE traslado_id = v_traslado_id;

  IF v_movimientos_registrados <> 2 THEN
    RAISE EXCEPTION 'Fallo de integridad al registrar el traslado (% de 2 movimientos). Operación abortada.', v_movimientos_registrados;
  END IF;

  RETURN v_traslado_id;
END;
$$;
