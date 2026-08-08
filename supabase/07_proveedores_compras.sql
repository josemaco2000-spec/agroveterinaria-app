-- 14. TABLA DE PROVEEDORES
CREATE TABLE IF NOT EXISTS proveedores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre TEXT NOT NULL,
  nit TEXT DEFAULT 'CF',
  telefono TEXT,
  direccion TEXT,
  contacto_nombre TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 15. TABLA DE COMPRAS (Órdenes de Recepción)
CREATE TABLE IF NOT EXISTS compras (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proveedor_id UUID REFERENCES proveedores(id) ON DELETE SET NULL,
  no_comprobante TEXT,
  total DECIMAL NOT NULL DEFAULT 0,
  usuario_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 16. TABLA DE DETALLE DE COMPRAS
CREATE TABLE IF NOT EXISTS detalle_compras (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  compra_id UUID REFERENCES compras(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES productos(id) ON DELETE CASCADE,
  lote_id UUID REFERENCES lotes(id) ON DELETE SET NULL,
  cantidad DECIMAL NOT NULL,
  precio_costo_unitario DECIMAL NOT NULL,
  subtotal DECIMAL NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS y políticas
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_compras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Proveedores operables" ON proveedores FOR ALL TO authenticated USING (true);
CREATE POLICY "Compras operables" ON compras FOR ALL TO authenticated USING (true);
CREATE POLICY "Detalle compras operables" ON detalle_compras FOR ALL TO authenticated USING (true);

-- RPC REGISTRAR ENTRADA COMPRA
CREATE OR REPLACE FUNCTION registrar_entrada_compra(
  p_proveedor_id UUID,
  p_no_comprobante TEXT,
  p_total DECIMAL,
  p_usuario_id UUID,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_compra_id UUID;
  v_item JSONB;
  v_lote_id UUID;
  v_producto_id UUID;
  v_numero_lote TEXT;
  v_fecha_vencimiento DATE;
  v_cantidad DECIMAL;
  v_precio_costo DECIMAL;
  v_subtotal DECIMAL;
BEGIN
  -- 1. Insertar cabecera de compra
  INSERT INTO compras (
    proveedor_id,
    no_comprobante,
    total,
    usuario_id
  ) VALUES (
    p_proveedor_id,
    p_no_comprobante,
    p_total,
    p_usuario_id
  ) RETURNING id INTO v_compra_id;

  -- 2. Procesar items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_numero_lote := v_item->>'numero_lote';
    v_fecha_vencimiento := (v_item->>'fecha_vencimiento')::DATE;
    v_cantidad := (v_item->>'cantidad')::DECIMAL;
    v_precio_costo := (v_item->>'precio_costo_unitario')::DECIMAL;
    v_subtotal := (v_item->>'subtotal')::DECIMAL;

    -- 2.1. Crear o encontrar lote
    SELECT id INTO v_lote_id 
    FROM lotes 
    WHERE producto_id = v_producto_id AND numero_lote = v_numero_lote;

    IF v_lote_id IS NOT NULL THEN
      UPDATE lotes 
      SET stock_actual = stock_actual + v_cantidad,
          stock_inicial = stock_inicial + v_cantidad
      WHERE id = v_lote_id;
    ELSE
      INSERT INTO lotes (
        producto_id,
        numero_lote,
        fecha_vencimiento,
        stock_inicial,
        stock_actual
      ) VALUES (
        v_producto_id,
        v_numero_lote,
        v_fecha_vencimiento,
        v_cantidad,
        v_cantidad
      ) RETURNING id INTO v_lote_id;
    END IF;

    -- 2.2. Registrar/actualizar costo unitario en productos_costos
    IF EXISTS (SELECT 1 FROM productos_costos WHERE producto_id = v_producto_id) THEN
      UPDATE productos_costos 
      SET precio_costo = v_precio_costo,
          updated_at = NOW()
      WHERE producto_id = v_producto_id;
    ELSE
      INSERT INTO productos_costos (
        producto_id,
        precio_costo
      ) VALUES (
        v_producto_id,
        v_precio_costo
      );
    END IF;

    -- 2.3. Actualizar stock global del producto
    UPDATE productos 
    SET stock_base = stock_base + v_cantidad
    WHERE id = v_producto_id;

    -- 2.4. Registrar movimiento de inventario (Kardex)
    INSERT INTO movimientos_inventario (
      producto_id,
      lote_id,
      tipo_movimiento,
      cantidad,
      referencia_id,
      usuario_id
    ) VALUES (
      v_producto_id,
      v_lote_id,
      'ENTRADA_COMPRA',
      v_cantidad,
      v_compra_id,
      p_usuario_id
    );

    -- 2.5. Insertar detalle de compra
    INSERT INTO detalle_compras (
      compra_id,
      producto_id,
      lote_id,
      cantidad,
      precio_costo_unitario,
      subtotal
    ) VALUES (
      v_compra_id,
      v_producto_id,
      v_lote_id,
      v_cantidad,
      v_precio_costo,
      v_subtotal
    );

  END LOOP;

  RETURN v_compra_id;
END;
$$;
