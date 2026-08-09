-- =================================================================
-- 10. MIGRACIÓN: SEPARACIÓN DE UNIDAD BASE Y PRESENTACIONES DE VENTA
-- =================================================================

-- 0. Eliminar temporalmente vistas dependientes para permitir el cambio de tipo de dato decimal
DROP VIEW IF EXISTS v_stock_productos CASCADE;

-- 1. Agregar tipo_medida a la tabla de productos (peso, volumen, unidad, conteo)
ALTER TABLE productos 
  ADD COLUMN IF NOT EXISTS tipo_medida TEXT DEFAULT 'unidad';

-- 2. Asegurar precisión DECIMAL(12,3) en stock_base para evitar descalces por redondeo
ALTER TABLE productos 
  ALTER COLUMN stock_base TYPE DECIMAL(12,3);

-- 3. Agregar banderas de usabilidad en compras y ventas en presentaciones
ALTER TABLE presentaciones 
  ADD COLUMN IF NOT EXISTS usable_en_compra BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS usable_en_venta BOOLEAN NOT NULL DEFAULT true;

-- 4. Asegurar precisión DECIMAL(12,3) en factor_conversion de presentaciones
ALTER TABLE presentaciones 
  ALTER COLUMN factor_conversion TYPE DECIMAL(12,3);

-- 5. Asegurar columna stock_inicial si no existe y ajustar precisión a DECIMAL(12,3) en lotes
ALTER TABLE lotes 
  ADD COLUMN IF NOT EXISTS stock_inicial DECIMAL(12,3) DEFAULT 0;

ALTER TABLE lotes 
  ALTER COLUMN stock_inicial TYPE DECIMAL(12,3),
  ALTER COLUMN stock_actual TYPE DECIMAL(12,3);

-- 6. Asegurar precisión DECIMAL(12,3) en cantidad de movimientos de inventario
ALTER TABLE movimientos_inventario 
  ALTER COLUMN cantidad TYPE DECIMAL(12,3);

-- 7. Recrear la vista v_stock_productos con los nuevos tipos de datos
CREATE OR REPLACE VIEW v_stock_productos AS
SELECT 
    p.id AS producto_id,
    p.nombre,
    p.unidad_base,
    COALESCE(SUM(l.stock_actual), 0) AS stock_total_lotes
FROM productos p
LEFT JOIN lotes l ON l.producto_id = p.id AND l.stock_actual > 0
GROUP BY p.id, p.nombre, p.unidad_base;

-- 8. Actualizar procedimiento RPC procesar_salida_fefo para soportar la mayor precisión decimal y orden PEPS/FEFO
CREATE OR REPLACE FUNCTION procesar_salida_fefo(
  p_producto_id UUID,
  p_cantidad_base DECIMAL(12,3),
  p_referencia_id UUID DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL
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
  -- Verificar stock total disponible del producto en lotes activos
  SELECT COALESCE(SUM(stock_actual), 0) INTO v_stock_total
  FROM lotes
  WHERE producto_id = p_producto_id AND stock_actual > 0;

  IF v_stock_total < p_cantidad_base THEN
    RAISE EXCEPTION 'Stock insuficiente por lotes FEFO para el producto. Disponible: %, Requerido: %', v_stock_total, p_cantidad_base;
  END IF;

  -- Iterar sobre lotes ordenados por fecha de vencimiento ASC (FEFO) y creación ASC
  FOR v_lote IN
    SELECT id, stock_actual
    FROM lotes
    WHERE producto_id = p_producto_id AND stock_actual > 0
    ORDER BY fecha_vencimiento ASC, created_at ASC
  LOOP
    EXIT WHEN v_resto <= 0;

    IF v_lote.stock_actual >= v_resto THEN
      v_descuento := v_resto;
    ELSE
      v_descuento := v_lote.stock_actual;
    END IF;

    -- Descontar stock del lote específico
    UPDATE lotes
    SET stock_actual = stock_actual - v_descuento
    WHERE id = v_lote.id;

    -- Registrar movimiento en Kardex en la unidad base exacta
    INSERT INTO movimientos_inventario (
      producto_id,
      lote_id,
      tipo_movimiento,
      cantidad,
      referencia_id,
      usuario_id
    ) VALUES (
      p_producto_id,
      v_lote.id,
      'SALIDA_VENTA',
      v_descuento,
      p_referencia_id,
      p_usuario_id
    );

    v_resto := v_resto - v_descuento;
  END LOOP;

  -- Actualizar el inventario general del producto en su unidad base
  UPDATE productos
  SET stock_base = stock_base - p_cantidad_base
  WHERE id = p_producto_id;
END;
$$;
