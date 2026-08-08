-- 7. TABLA DE LOTES (FEFO - First Expired, First Out)
CREATE TABLE IF NOT EXISTS lotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id UUID REFERENCES productos(id) ON DELETE CASCADE,
  numero_lote TEXT NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  stock_inicial DECIMAL NOT NULL DEFAULT 0,
  stock_actual DECIMAL NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. TABLA DE MOVIMIENTOS DE INVENTARIO (KARDEX)
CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id UUID REFERENCES productos(id) ON DELETE CASCADE,
  lote_id UUID REFERENCES lotes(id) ON DELETE SET NULL,
  tipo_movimiento TEXT NOT NULL, -- Ej: 'ENTRADA_COMPRA', 'SALIDA_VENTA', 'AJUSTE'
  cantidad DECIMAL NOT NULL,
  referencia_id UUID,
  usuario_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS y Políticas
ALTER TABLE lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_inventario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver lotes autenticados" ON lotes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin gestiona lotes" ON lotes FOR ALL TO authenticated 
USING ( (SELECT rol FROM perfiles WHERE id = auth.uid()) = 'admin' );

CREATE POLICY "Ver movimientos autenticados" ON movimientos_inventario FOR SELECT TO authenticated USING (true);
CREATE POLICY "Todos operan movimientos" ON movimientos_inventario FOR INSERT TO authenticated WITH CHECK (true);

-- 9. PROCEDIMIENTO ALMACENADO (RPC) PROCESAR SALIDA FEFO
CREATE OR REPLACE FUNCTION procesar_salida_fefo(
  p_producto_id UUID,
  p_cantidad_base DECIMAL,
  p_referencia_id UUID DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_resto DECIMAL := p_cantidad_base;
  v_lote RECORD;
  v_descuento DECIMAL;
  v_stock_total DECIMAL;
BEGIN
  -- Verificar stock total disponible del producto
  SELECT COALESCE(SUM(stock_actual), 0) INTO v_stock_total
  FROM lotes
  WHERE producto_id = p_producto_id AND stock_actual > 0;

  IF v_stock_total < p_cantidad_base THEN
    RAISE EXCEPTION 'Stock insuficiente por lotes FEFO para el producto. Disponible en lotes: %, Requerido: %', v_stock_total, p_cantidad_base;
  END IF;

  -- Iterar sobre lotes ordenados por fecha de vencimiento ASC (FEFO)
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

    -- Descontar stock del lote
    UPDATE lotes
    SET stock_actual = stock_actual - v_descuento
    WHERE id = v_lote.id;

    -- Registrar movimiento en Kardex
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

  -- Actualizar stock_base global en tabla productos
  UPDATE productos
  SET stock_base = stock_base - p_cantidad_base
  WHERE id = p_producto_id;

END;
$$;
