-- =================================================================
-- 11. MIGRACIÓN: INVENTARIO MULTI-UBICACIÓN Y TRASLADOS ATÓMICOS
-- =================================================================

-- 1. Crear tabla de ubicaciones del negocio
CREATE TABLE IF NOT EXISTS ubicaciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('almacenamiento', 'punto_venta')),
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insertar ubicaciones base con IDs fijos para consistencia
INSERT INTO ubicaciones (id, nombre, tipo) 
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'Bodega Central', 'almacenamiento'),
  ('22222222-2222-2222-2222-222222222222', 'Área de Venta', 'punto_venta')
ON CONFLICT (nombre) DO NOTHING;

-- 2. Agregar columnas ubicacion_id y traslado_id a movimientos_inventario
ALTER TABLE movimientos_inventario 
  ADD COLUMN IF NOT EXISTS ubicacion_id UUID REFERENCES ubicaciones(id) DEFAULT '11111111-1111-1111-1111-111111111111',
  ADD COLUMN IF NOT EXISTS traslado_id UUID;

-- Migrar todos los movimientos históricos existentes a Bodega Central
UPDATE movimientos_inventario 
SET ubicacion_id = '11111111-1111-1111-1111-111111111111' 
WHERE ubicacion_id IS NULL;

-- 2.b AUTO-REPARACIÓN DE LOTES EXISTENTES SINO TIENEN FILA EN MOVIMIENTOS_INVENTARIO
INSERT INTO movimientos_inventario (
  producto_id,
  lote_id,
  ubicacion_id,
  tipo_movimiento,
  cantidad
)
SELECT 
  l.producto_id,
  l.id AS lote_id,
  '11111111-1111-1111-1111-111111111111'::uuid AS ubicacion_id,
  'ENTRADA_COMPRA' AS tipo_movimiento,
  l.stock_actual AS cantidad
FROM lotes l
LEFT JOIN movimientos_inventario m ON m.lote_id = l.id
WHERE l.stock_actual > 0 AND m.id IS NULL;

-- 3. Crear tabla de stock mínimo (puntos de reorden) por ubicación
CREATE TABLE IF NOT EXISTS stock_minimo_ubicacion (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id UUID REFERENCES productos(id) ON DELETE CASCADE,
  ubicacion_id UUID REFERENCES ubicaciones(id) ON DELETE CASCADE,
  stock_minimo DECIMAL(12,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unq_producto_ubicacion UNIQUE(producto_id, ubicacion_id)
);

-- Habilitar RLS en las nuevas tablas
ALTER TABLE ubicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_minimo_ubicacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura ubicaciones autenticados" ON ubicaciones;
DROP POLICY IF EXISTS "Admin gestiona ubicaciones" ON ubicaciones;
CREATE POLICY "Lectura ubicaciones autenticados" ON ubicaciones FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin gestiona ubicaciones" ON ubicaciones FOR ALL TO authenticated 
USING ( (SELECT rol FROM perfiles WHERE id = auth.uid()) = 'admin' );

DROP POLICY IF EXISTS "Lectura stock minimo autenticados" ON stock_minimo_ubicacion;
DROP POLICY IF EXISTS "Admin gestiona stock minimo" ON stock_minimo_ubicacion;
CREATE POLICY "Lectura stock minimo autenticados" ON stock_minimo_ubicacion FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin gestiona stock minimo" ON stock_minimo_ubicacion FOR ALL TO authenticated 
USING ( (SELECT rol FROM perfiles WHERE id = auth.uid()) = 'admin' );

-- 4. Vistas de Stock Puro Calculado por Ubicación (desde movimientos_inventario)

-- Vista A: Stock por lote y ubicación
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
        WHEN m.tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO') THEN m.cantidad
        WHEN m.tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO') THEN -m.cantidad
        ELSE 0
      END
    ) AS stock_actual
FROM movimientos_inventario m
JOIN lotes l ON l.id = m.lote_id
JOIN ubicaciones u ON u.id = m.ubicacion_id
GROUP BY m.lote_id, l.numero_lote, l.fecha_vencimiento, m.producto_id, m.ubicacion_id, u.nombre, u.tipo;

-- Vista B: Stock total por producto y ubicación con alerta de reorden
CREATE OR REPLACE VIEW v_stock_productos_ubicacion AS
SELECT 
    p.id AS producto_id,
    p.nombre AS producto_nombre,
    p.unidad_base,
    u.id AS ubicacion_id,
    u.nombre AS ubicacion_nombre,
    u.tipo AS ubicacion_tipo,
    COALESCE(s.stock_actual, 0) AS stock_disponible,
    COALESCE(sm.stock_minimo, 0) AS stock_minimo,
    CASE WHEN COALESCE(s.stock_actual, 0) < COALESCE(sm.stock_minimo, 0) THEN true ELSE false END AS bajo_minimo
FROM productos p
CROSS JOIN ubicaciones u
LEFT JOIN (
    SELECT producto_id, ubicacion_id, SUM(stock_actual) AS stock_actual
    FROM v_stock_lotes_ubicacion
    GROUP BY producto_id, ubicacion_id
) s ON s.producto_id = p.id AND s.ubicacion_id = u.id
LEFT JOIN stock_minimo_ubicacion sm ON sm.producto_id = p.id AND sm.ubicacion_id = u.id;

-- 5. Procedimiento Almacenado (RPC) para Traslados Atómicos entre Ubicaciones
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
BEGIN
  IF p_ubicacion_origen_id = p_ubicacion_destino_id THEN
    RAISE EXCEPTION 'La ubicación de origen y destino deben ser distintas.';
  END IF;

  IF p_cantidad_base <= 0 THEN
    RAISE EXCEPTION 'La cantidad a trasladar debe ser mayor a 0.';
  END IF;

  -- Validar stock disponible en la ubicación de origen para ese lote
  SELECT COALESCE(SUM(
    CASE 
      WHEN tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO') THEN cantidad
      WHEN tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO') THEN -cantidad
      ELSE 0
    END
  ), 0) INTO v_stock_origen
  FROM movimientos_inventario
  WHERE lote_id = p_lote_id AND ubicacion_id = p_ubicacion_origen_id;

  -- Resiliencia: Si el origen es Bodega Central y no hay movimientos registrados aún, verificar tabla 'lotes'
  IF v_stock_origen = 0 AND p_ubicacion_origen_id = '11111111-1111-1111-1111-111111111111'::uuid THEN
    SELECT COALESCE(stock_actual, 0) INTO v_stock_origen
    FROM lotes
    WHERE id = p_lote_id;

    -- Si existe stock en la tabla lotes, insertar automáticamente el movimiento inicial de entrada a Bodega Central
    IF v_stock_origen > 0 THEN
      INSERT INTO movimientos_inventario (
        producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad
      ) VALUES (
        p_producto_id, p_lote_id, p_ubicacion_origen_id, 'ENTRADA_COMPRA', v_stock_origen
      );
    END IF;
  END IF;

  IF v_stock_origen < p_cantidad_base THEN
    RAISE EXCEPTION 'Stock insuficiente en la ubicación de origen. Disponible: %, Solicitado: %', v_stock_origen, p_cantidad_base;
  END IF;

  -- Transacción atómica: Movimiento 1 (Salida de Origen)
  INSERT INTO movimientos_inventario (
    producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, referencia_id, traslado_id, usuario_id
  ) VALUES (
    p_producto_id, p_lote_id, p_ubicacion_origen_id, 'TRASLADO_SALIDA', p_cantidad_base, NULL, v_traslado_id, p_usuario_id
  );

  -- Transacción atómica: Movimiento 2 (Entrada a Destino)
  INSERT INTO movimientos_inventario (
    producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, referencia_id, traslado_id, usuario_id
  ) VALUES (
    p_producto_id, p_lote_id, p_ubicacion_destino_id, 'TRASLADO_ENTRADA', p_cantidad_base, NULL, v_traslado_id, p_usuario_id
  );

  RETURN v_traslado_id;
END;
$$;

-- 6. Actualizar RPC procesar_salida_fefo para vender EXCLUSIVAMENTE contra Área de Venta (o ubicación especificada)
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
  -- 1. Validar que la ubicación sea tipo 'punto_venta' para ventas POS
  IF NOT EXISTS (
    SELECT 1 FROM ubicaciones WHERE id = p_ubicacion_id AND tipo = 'punto_venta' AND activo = true
  ) THEN
    RAISE EXCEPTION 'Las ventas POS solo pueden realizarse en ubicaciones tipo punto_venta. Ubicación solicitada no autorizada.';
  END IF;

  -- 2. Verificar stock total disponible del producto en esa ubicación específica
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

  -- 3. Iterar sobre lotes con stock en dicha ubicación ordenados por FEFO
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

    -- Descontar stock actual del lote global en tabla lotes
    UPDATE lotes
    SET stock_actual = stock_actual - v_descuento
    WHERE id = v_lote.id;

    -- Registrar movimiento de SALIDA_VENTA asociado a la ubicación Área de Venta
    INSERT INTO movimientos_inventario (
      producto_id,
      lote_id,
      ubicacion_id,
      tipo_movimiento,
      cantidad,
      referencia_id,
      usuario_id
    ) VALUES (
      p_producto_id,
      v_lote.id,
      p_ubicacion_id,
      'SALIDA_VENTA',
      v_descuento,
      p_referencia_id,
      p_usuario_id
    );

    v_resto := v_resto - v_descuento;
  END LOOP;

  -- Actualizar stock_base global del producto
  UPDATE productos
  SET stock_base = stock_base - p_cantidad_base
  WHERE id = p_producto_id;
END;
$$;
