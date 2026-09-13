-- =================================================================
-- 25. FIX CRÍTICO: STOCK SIN LOTE INVISIBLE + TIPOS DE AJUSTE NO
--     RECONOCIDOS EN EL CÁLCULO DE STOCK
-- =================================================================
-- DIAGNÓSTICO (confirmado con datos reales de producción antes de
-- aplicar este fix):
--
-- 1) v_stock_lotes_ubicacion usaba INNER JOIN contra 'lotes'. Cualquier
--    movimiento con lote_id = NULL (compras/traslados de "Lote General",
--    que sí existen hoy: 10 movimientos reales) desaparecía por completo
--    de la vista. Como v_stock_productos_ubicacion (usada por pos.js y
--    cajero-pos.js para decidir qué mostrar y cuánto stock hay) se
--    calcula desde esa vista, productos con stock real aparecían con
--    stock 0 o incluso NEGATIVO en el POS. Verificado con datos reales:
--      Maiz                       stock_base=1000  vista=0    (invisible)
--      Ivermectina 1% L.A.        stock_base=450   vista=-550 (negativo)
--      Dispositivo Intravaginal   stock_base=15     vista=-30  (negativo)
--    Coincide con el bug de visualización de stock en el carrito que
--    motivó esta auditoría.
--
-- 2) El mismo INNER JOIN existe en el bucle de despacho FEFO de
--    procesar_salida_fefo: su chequeo inicial de "¿alcanza el stock?"
--    SÍ cuenta el stock sin lote (no hace join), pero el bucle que
--    reparte la salida entre lotes NUNCA puede tocar ese stock sin lote
--    — si pasaba la validación inicial gracias a stock sin lote, el
--    bucle se quedaba corto y el producto quedaba sobre-despachado sin
--    que el sistema lo notara (v_resto no llegaba a 0, sin error).
--
-- 3) Las vistas y funciones de stock solo reconocían 'AJUSTE_POSITIVO'/
--    'AJUSTE_NEGATIVO' en su CASE de cálculo, pero el CHECK constraint,
--    el dropdown de kardex.html y los badges de kardex.js usan
--    'AJUSTE_ENTRADA'/'AJUSTE_SALIDA'/'MERMA_VENCIDO' — un movimiento de
--    ese tipo se insertaría sin afectar NINGÚN cálculo de stock (caía al
--    ELSE 0 del CASE). Necesario corregir esto antes de construir la RPC
--    de ajustes/mermas.
--
-- CORRECCIÓN:
-- - v_stock_lotes_ubicacion: LEFT JOIN en vez de INNER JOIN (el
--   frontend de traslados en inventario.js ya maneja lote_id=null
--   correctamente, lo etiqueta "Lote General").
-- - CASE de stock ampliado en las 3 funciones/vista para reconocer
--   AJUSTE_ENTRADA y AJUSTE_SALIDA/MERMA_VENCIDO junto a los nombres
--   ya soportados.
-- - procesar_salida_fefo: si tras recorrer todos los lotes reales queda
--   remanente (v_resto > 0), se descuenta del stock sin lote de esa
--   ubicación con un movimiento SALIDA_VENTA final (lote_id NULL). Es
--   seguro por construcción: el chequeo inicial ya garantizó que
--   total_lotes + stock_sin_lote >= cantidad solicitada.
-- - v_stock_productos_ubicacion NO se toca: se recalcula automáticamente
--   porque agrega desde v_stock_lotes_ubicacion por producto+ubicación.
--
-- Firmas de función sin cambios → CREATE OR REPLACE reemplaza in situ.
-- =================================================================

-- -----------------------------------------------------------------
-- 1. Vista de stock por lote y ubicación (LEFT JOIN + CASE ampliado)
-- -----------------------------------------------------------------
CREATE OR REPLACE VIEW v_stock_lotes_ubicacion AS
SELECT
    m.lote_id,
    l.numero_lote,
    l.fecha_vencimiento,
    m.producto_id,
    m.ubicacion_id,
    u.nombre AS ubicacion_nombre,
    u.tipo AS ubicacion_tipo,
    SUM(
      CASE
        WHEN m.tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_ENTRADA') THEN m.cantidad
        WHEN m.tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO', 'AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN -m.cantidad
        ELSE 0
      END
    ) AS stock_actual
FROM movimientos_inventario m
LEFT JOIN lotes l ON l.id = m.lote_id
JOIN ubicaciones u ON u.id = m.ubicacion_id
GROUP BY m.lote_id, l.numero_lote, l.fecha_vencimiento, m.producto_id, m.ubicacion_id, u.nombre, u.tipo;

-- -----------------------------------------------------------------
-- 2. procesar_salida_fefo: CASE ampliado + fallback de stock sin lote
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION procesar_salida_fefo(
  p_producto_id UUID,
  p_cantidad_base DECIMAL(12,3),
  p_referencia_id UUID DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL,
  p_ubicacion_id UUID DEFAULT '22222222-2222-2222-2222-222222222222'
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_producto_id::text || '|' || p_ubicacion_id::text, 0)
  );

  SELECT COALESCE(SUM(
    CASE
      WHEN tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_ENTRADA') THEN cantidad
      WHEN tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO', 'AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN -cantidad
      ELSE 0
    END
  ), 0) INTO v_stock_total
  FROM movimientos_inventario
  WHERE producto_id = p_producto_id AND ubicacion_id = p_ubicacion_id;

  IF v_stock_total < p_cantidad_base THEN
    RAISE EXCEPTION 'Stock insuficiente en el Área de Venta para el producto. Disponible en POS: %, Requerido: %', v_stock_total, p_cantidad_base;
  END IF;

  -- Despacho FEFO sobre lotes reales, ordenados por vencimiento
  FOR v_lote IN
    SELECT
      m.lote_id AS id,
      SUM(
        CASE
          WHEN m.tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_ENTRADA') THEN m.cantidad
          WHEN m.tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO', 'AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN -m.cantidad
          ELSE 0
        END
      ) AS stock_lote_ubicacion
    FROM movimientos_inventario m
    JOIN lotes l ON l.id = m.lote_id
    WHERE m.producto_id = p_producto_id AND m.ubicacion_id = p_ubicacion_id
    GROUP BY m.lote_id, l.fecha_vencimiento, l.created_at
    HAVING SUM(
      CASE
        WHEN m.tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_ENTRADA') THEN m.cantidad
        WHEN m.tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO', 'AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN -m.cantidad
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

  -- Remanente después de agotar lotes reales: viene de stock SIN lote
  -- registrado en esta ubicación (p.ej. compras/traslados de "Lote
  -- General"). Es seguro por construcción: el chequeo de v_stock_total
  -- ya validó que total_lotes + stock_sin_lote cubre lo solicitado.
  IF v_resto > 0 THEN
    INSERT INTO movimientos_inventario (
      producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, referencia_id, usuario_id
    ) VALUES (
      p_producto_id, NULL, p_ubicacion_id, 'SALIDA_VENTA', v_resto, p_referencia_id, p_usuario_id
    );
    v_resto := 0;
  END IF;

  UPDATE productos
  SET stock_base = stock_base - p_cantidad_base
  WHERE id = p_producto_id;
END;
$$;

-- -----------------------------------------------------------------
-- 3. realizar_traslado_inventario: CASE ampliado (sin problema de JOIN,
--    ya filtraba directo por lote_id / lote_id IS NULL)
-- -----------------------------------------------------------------
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_producto_id::text || '|' || p_ubicacion_origen_id::text, 0)
  );

  IF p_lote_id IS NOT NULL THEN
    SELECT COALESCE(SUM(
      CASE
        WHEN tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_ENTRADA') THEN cantidad
        WHEN tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO', 'AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN -cantidad
        ELSE 0
      END
    ), 0) INTO v_stock_origen
    FROM movimientos_inventario
    WHERE lote_id = p_lote_id AND ubicacion_id = p_ubicacion_origen_id;

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
    SELECT COALESCE(SUM(
      CASE
        WHEN tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_ENTRADA') THEN cantidad
        WHEN tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO', 'AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN -cantidad
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

  INSERT INTO movimientos_inventario (
    producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, referencia_id, traslado_id, usuario_id
  ) VALUES (
    p_producto_id, p_lote_id, p_ubicacion_origen_id, 'TRASLADO_SALIDA', p_cantidad_base, NULL, v_traslado_id, p_usuario_id
  );

  INSERT INTO movimientos_inventario (
    producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, referencia_id, traslado_id, usuario_id
  ) VALUES (
    p_producto_id, p_lote_id, p_ubicacion_destino_id, 'TRASLADO_ENTRADA', p_cantidad_base, NULL, v_traslado_id, p_usuario_id
  );

  SELECT COUNT(*) INTO v_movimientos_registrados
  FROM movimientos_inventario
  WHERE traslado_id = v_traslado_id;

  IF v_movimientos_registrados <> 2 THEN
    RAISE EXCEPTION 'Fallo de integridad al registrar el traslado (% de 2 movimientos). Operación abortada.', v_movimientos_registrados;
  END IF;

  RETURN v_traslado_id;
END;
$$;
