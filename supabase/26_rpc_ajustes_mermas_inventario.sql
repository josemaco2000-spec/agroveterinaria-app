-- =================================================================
-- 26. RPC: REGISTRAR AJUSTES Y MERMAS DE INVENTARIO
-- =================================================================
-- Hasta ahora, AJUSTE_ENTRADA / AJUSTE_SALIDA / MERMA_VENCIDO existían
-- en el CHECK constraint de movimientos_inventario y en el dropdown de
-- filtro de kardex.html, pero no había ninguna manera de crearlos desde
-- la UI — el negocio no tenía forma oficial de dar de baja mercadería
-- vencida/dañada ni de corregir un conteo físico, y cualquier fix real
-- requería editar 'productos.stock_base' a mano en el editor de tablas
-- de Supabase (la causa raíz confirmada de los 7 productos con stock
-- desincronizado encontrados en 25_fix_stock_sin_lote_y_tipos_ajuste.sql).
--
-- Esta RPC es admin-only, SECURITY DEFINER, y sigue el mismo patrón de
-- candado transaccional (producto_id|ubicacion_id) que ventas y
-- traslados para no reabrir la condición de carrera que se cerró en
-- 22_unificar_advisory_lock.sql.
-- =================================================================

-- Motivo del ajuste (p.ej. "conteo físico", "vencido", "dañado en
-- transporte"). Resultó que esta columna YA EXISTÍA en producción sin
-- rastro en ninguna migración (otro hallazgo de drift, igual que los de
-- 24_documentar_funciones_columnas_huerfanas.sql) — explica por qué
-- kardex.html ya rotulaba esa columna de la tabla "Referencia /
-- Observaciones". Se deja el ADD COLUMN IF NOT EXISTS para que el
-- archivo sea autosuficiente igual si se corre contra un entorno nuevo.
ALTER TABLE movimientos_inventario
  ADD COLUMN IF NOT EXISTS observaciones TEXT;

CREATE OR REPLACE FUNCTION registrar_ajuste_inventario(
  p_producto_id UUID,
  p_ubicacion_id UUID,
  p_tipo_movimiento TEXT,
  p_cantidad DECIMAL(12,3),
  p_usuario_id UUID,
  p_lote_id UUID DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_movimiento_id UUID;
  v_stock_actual DECIMAL(12,3);
BEGIN
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
    producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, usuario_id, observaciones
  ) VALUES (
    p_producto_id, p_lote_id, p_ubicacion_id, p_tipo_movimiento, p_cantidad, p_usuario_id, p_observaciones
  ) RETURNING id INTO v_movimiento_id;

  RETURN v_movimiento_id;
END;
$$;

-- La RLS de movimientos_inventario ya restringe INSERT directo a admin
-- (16_bloquear_insert_directo_movimientos.sql); esta RPC es SECURITY
-- DEFINER y no depende de esa política para funcionar, pero el chequeo
-- es_admin() interno es la defensa real ya que PostgREST podría
-- exponerla a cualquier autenticado si se llama vía supabase.rpc().
