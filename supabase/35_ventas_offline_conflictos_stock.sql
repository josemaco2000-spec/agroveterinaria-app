-- =================================================================
-- 35. VENTAS OFFLINE REALES: AUTOR, FECHA, PRECIO COBRADO Y
--     CONFLICTOS DE STOCK (FASE 1)
-- =================================================================
-- Requiere 32, 33 y 34 aplicadas.
--
-- PROBLEMA (hasta la 34): una venta hecha sin internet se sincronizaba
-- como si fuera nueva:
--   - autor = quien sincroniza (auth.uid()), no quien vendió;
--   - fecha_venta = NOW() al sincronizar;
--   - si el precio cambió mientras el dispositivo estaba offline, la
--     venta se RECHAZABA (migración 33);
--   - si otro dispositivo ya había vendido ese stock, procesar_salida_fefo
--     lanzaba excepción y la venta entera se revertía -> la venta real
--     (mercadería ya entregada) no quedaba registrada.
--
-- CAMBIOS:
-- 1. registrar_venta_pos recibe p_device_id, p_usuario_origen_id,
--    p_fecha_operacion y p_origen ('online' | 'offline'). Como cambia la
--    firma, se hace DROP de la versión de 7 parámetros y CREATE de la
--    nueva (sin dejar overloads: ver migraciones 13 y 32). Todos los
--    parámetros nuevos tienen DEFAULT, así que las llamadas actuales
--    (5 o 7 parámetros) siguen resolviendo a esta función y se comportan
--    igual que antes (modo 'online').
-- 2. Modo 'offline' (lo usa solo la cola de sincronización):
--    - autor = p_usuario_origen_id. Solo puede registrar en nombre de
--      otro usuario un ADMIN; si no, error 42501 (la cola lo deja
--      pendiente hasta que sincronice el autor o un admin).
--    - fecha_venta = p_fecha_operacion; sincronizado_en = NOW();
--      sincronizado_por = auth.uid().
--    - el precio enviado ES el precio cobrado: no se rechaza ni se
--      reemplaza. El precio vigente del catálogo se guarda aparte
--      (detalle_ventas.precio_catalogo) para auditoría.
--    - stock insuficiente NO revierte la venta: se descuenta lo que
--      realmente existe (primero los lotes que eligió el POS por FEFO
--      local, luego FEFO del servidor, luego stock sin lote) y el
--      faltante queda en conflictos_inventario (estado 'pendiente') para
--      que un admin lo concilie. Nunca se genera stock negativo.
-- 3. Modo 'online' (POS con internet): igual que la migración 33 —
--    precio validado contra el vigente, stock insuficiente rechaza la
--    venta (todavía no se entregó la mercadería) — más: guarda local_id,
--    device_id y el detalle de precio/lote/advertencia.
-- 4. Idempotencia por local_id con candado transaccional: dos
--    reintentos simultáneos de la misma venta no chocan en el índice
--    único; el segundo espera y devuelve la venta ya creada.
--
-- Las ventas a CRÉDITO siguen validando el límite en ambos modos (ver
-- informe de la fase: pendiente de decisión de negocio).
--
-- IMPORTANTE: Ejecutar manualmente en el SQL Editor de Supabase.
-- =================================================================

-- -----------------------------------------------------------------
-- 1. Columnas nuevas (nullable / con default; sin backfill)
-- -----------------------------------------------------------------
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS origen TEXT;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS conflicto_stock BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN ventas.origen IS '''online'' = registrada con internet; ''offline'' = llegó desde la cola de sincronización. NULL = anterior a la migración 35.';
COMMENT ON COLUMN ventas.conflicto_stock IS 'true si al sincronizar faltó stock para algún ítem (ver conflictos_inventario).';

ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS detalle_local_id UUID;
ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS precio_unitario DECIMAL(14,2);
ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS descuento_porcentaje DECIMAL(5,2);
ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS precio_catalogo DECIMAL(14,2);
ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS factor_conversion DECIMAL(12,3);
ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS cantidad_base DECIMAL(12,3);
ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS lotes_sugeridos JSONB;
ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS advertencia_vencimiento BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN detalle_ventas.precio_unitario IS 'Precio de lista por presentación que vio y cobró el POS (antes de descuento).';
COMMENT ON COLUMN detalle_ventas.precio_catalogo IS 'Precio vigente en el servidor al registrar. Distinto de precio_unitario = el precio cambió mientras el dispositivo estaba offline.';
COMMENT ON COLUMN detalle_ventas.lotes_sugeridos IS 'Lotes que el POS asignó por FEFO local [{lote_id, numero_lote, fecha_vencimiento, cantidad_base, vencido}].';
COMMENT ON COLUMN detalle_ventas.advertencia_vencimiento IS 'El POS advirtió que se vendía producto de un lote vencido y el usuario confirmó.';

-- -----------------------------------------------------------------
-- 2. Conflictos de inventario
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conflictos_inventario (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo TEXT NOT NULL DEFAULT 'STOCK_INSUFICIENTE',
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'en_revision', 'resuelto')),

  -- Operación de origen
  local_id UUID,
  venta_id UUID REFERENCES ventas(id) ON DELETE SET NULL,
  detalle_venta_id UUID REFERENCES detalle_ventas(id) ON DELETE SET NULL,
  detalle_local_id UUID,
  device_id UUID,
  usuario_origen_id UUID REFERENCES auth.users(id),
  sincronizado_por UUID REFERENCES auth.users(id),
  fecha_operacion TIMESTAMP WITH TIME ZONE,
  sincronizado_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Qué faltó (cantidades en unidad base del producto)
  producto_id UUID REFERENCES productos(id) ON DELETE SET NULL,
  presentacion_id UUID REFERENCES presentaciones(id) ON DELETE SET NULL,
  lote_id UUID REFERENCES lotes(id) ON DELETE SET NULL,
  ubicacion_id UUID REFERENCES ubicaciones(id) ON DELETE SET NULL,
  unidad_base TEXT,
  cantidad_presentacion DECIMAL(12,3),
  cantidad_solicitada DECIMAL(12,3) NOT NULL,
  cantidad_cubierta DECIMAL(12,3) NOT NULL DEFAULT 0,
  cantidad_disponible DECIMAL(12,3) NOT NULL DEFAULT 0,
  deficit DECIMAL(12,3) NOT NULL CHECK (deficit > 0),
  lotes_sugeridos JSONB,
  detalle TEXT,

  -- Resolución (la hace un admin en una fase posterior; nunca automática)
  fecha_resolucion TIMESTAMP WITH TIME ZONE,
  resuelto_por UUID REFERENCES auth.users(id),
  resolucion TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE conflictos_inventario IS 'Ventas offline registradas sin stock suficiente al sincronizar. El faltante NO se descontó: queda aquí para conciliación manual.';
COMMENT ON COLUMN conflictos_inventario.lote_id IS 'Primer lote elegido por el POS (FEFO local) que el servidor no pudo cubrir completo; NULL si el POS no tenía información de lote.';
COMMENT ON COLUMN conflictos_inventario.cantidad_disponible IS 'Stock total del producto en la ubicación al momento de sincronizar (antes de descontar esta línea).';

-- Un conflicto por línea de venta: protege contra duplicados.
CREATE UNIQUE INDEX IF NOT EXISTS conflictos_inventario_detalle_key
  ON conflictos_inventario (detalle_venta_id) WHERE detalle_venta_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conflictos_inventario_estado
  ON conflictos_inventario (estado, sincronizado_en DESC);
CREATE INDEX IF NOT EXISTS idx_conflictos_inventario_venta
  ON conflictos_inventario (venta_id);

ALTER TABLE conflictos_inventario ENABLE ROW LEVEL SECURITY;

-- Solo lo crea la RPC (SECURITY DEFINER): no hay política de INSERT.
DROP POLICY IF EXISTS "Solo admin lee conflictos de inventario" ON conflictos_inventario;
CREATE POLICY "Solo admin lee conflictos de inventario" ON conflictos_inventario
  FOR SELECT TO authenticated USING (es_admin(auth.uid()));

DROP POLICY IF EXISTS "Solo admin actualiza conflictos de inventario" ON conflictos_inventario;
CREATE POLICY "Solo admin actualiza conflictos de inventario" ON conflictos_inventario
  FOR UPDATE TO authenticated USING (es_admin(auth.uid()));

-- -----------------------------------------------------------------
-- 3. Salida de stock tolerante a faltantes (solo uso interno)
-- -----------------------------------------------------------------
-- Descuenta hasta donde alcance el stock REAL de esa ubicación y devuelve
-- cuánto se cubrió. Orden: lotes sugeridos por el POS (lo que el
-- dispositivo decidió por FEFO local) -> FEFO del servidor sobre los lotes
-- restantes -> stock sin lote. Nunca deja un lote ni el total en negativo.
CREATE OR REPLACE FUNCTION consumir_stock_venta_offline(
  p_producto_id UUID,
  p_cantidad_base DECIMAL(12,3),
  p_lotes_sugeridos JSONB,
  p_venta_id UUID,
  p_usuario_id UUID,
  p_ubicacion_id UUID,
  p_device_id UUID,
  p_fecha_operacion TIMESTAMP WITH TIME ZONE,
  p_sincronizado_por UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_disponible DECIMAL(12,3);
  v_objetivo DECIMAL(12,3);
  v_resto DECIMAL(12,3);
  v_sug JSONB;
  v_lote_id UUID;
  v_pedido DECIMAL(12,3);
  v_stock DECIMAL(12,3);
  v_toma DECIMAL(12,3);
  v_lote RECORD;
  v_lote_sin_cubrir UUID;
BEGIN
  -- Mismo candado que ventas online, traslados y ajustes (migración 22).
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_producto_id::text || '|' || p_ubicacion_id::text, 0)
  );

  SELECT COALESCE(SUM(
    CASE
      WHEN tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_ENTRADA') THEN cantidad
      WHEN tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO', 'AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN -cantidad
      ELSE 0
    END
  ), 0) INTO v_disponible
  FROM movimientos_inventario
  WHERE producto_id = p_producto_id AND ubicacion_id = p_ubicacion_id;

  -- Nunca descontar más que el total real (aunque algún lote suelto
  -- tenga saldo positivo por datos viejos inconsistentes).
  v_objetivo := LEAST(p_cantidad_base, GREATEST(v_disponible, 0));
  v_resto := v_objetivo;

  -- a) Lotes elegidos por el POS
  FOR v_sug IN SELECT * FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_lotes_sugeridos) = 'array' THEN p_lotes_sugeridos ELSE '[]'::jsonb END)
  LOOP
    v_lote_id := NULLIF(v_sug->>'lote_id', '')::UUID;
    v_pedido := COALESCE((v_sug->>'cantidad_base')::DECIMAL, 0);
    CONTINUE WHEN v_lote_id IS NULL OR v_pedido <= 0;

    IF v_resto <= 0 THEN
      v_lote_sin_cubrir := COALESCE(v_lote_sin_cubrir, v_lote_id);
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(
      CASE
        WHEN m.tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_ENTRADA') THEN m.cantidad
        WHEN m.tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO', 'AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN -m.cantidad
        ELSE 0
      END
    ), 0) INTO v_stock
    FROM movimientos_inventario m
    JOIN lotes l ON l.id = m.lote_id AND l.producto_id = p_producto_id
    WHERE m.lote_id = v_lote_id AND m.ubicacion_id = p_ubicacion_id;

    v_toma := LEAST(v_resto, v_pedido, GREATEST(v_stock, 0));
    IF v_toma < v_pedido THEN
      v_lote_sin_cubrir := COALESCE(v_lote_sin_cubrir, v_lote_id);
    END IF;

    IF v_toma > 0 THEN
      UPDATE lotes SET stock_actual = stock_actual - v_toma WHERE id = v_lote_id;
      INSERT INTO movimientos_inventario (
        producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, referencia_id, usuario_id,
        device_id, fecha_operacion, sincronizado_en, sincronizado_por
      ) VALUES (
        p_producto_id, v_lote_id, p_ubicacion_id, 'SALIDA_VENTA', v_toma, p_venta_id, p_usuario_id,
        p_device_id, p_fecha_operacion, NOW(), p_sincronizado_por
      );
      v_resto := v_resto - v_toma;
    END IF;
  END LOOP;

  -- b) FEFO del servidor sobre los lotes con saldo (misma regla que
  --    procesar_salida_fefo; ya ve los movimientos insertados arriba).
  IF v_resto > 0 THEN
    FOR v_lote IN
      SELECT m.lote_id AS id,
        SUM(
          CASE
            WHEN m.tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_ENTRADA') THEN m.cantidad
            WHEN m.tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO', 'AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN -m.cantidad
            ELSE 0
          END
        ) AS stock_lote
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
      v_toma := LEAST(v_resto, v_lote.stock_lote);

      UPDATE lotes SET stock_actual = stock_actual - v_toma WHERE id = v_lote.id;
      INSERT INTO movimientos_inventario (
        producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, referencia_id, usuario_id,
        device_id, fecha_operacion, sincronizado_en, sincronizado_por
      ) VALUES (
        p_producto_id, v_lote.id, p_ubicacion_id, 'SALIDA_VENTA', v_toma, p_venta_id, p_usuario_id,
        p_device_id, p_fecha_operacion, NOW(), p_sincronizado_por
      );
      v_resto := v_resto - v_toma;
    END LOOP;
  END IF;

  -- c) Stock sin lote ("Lote General")
  IF v_resto > 0 THEN
    SELECT COALESCE(SUM(
      CASE
        WHEN tipo_movimiento IN ('ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_ENTRADA') THEN cantidad
        WHEN tipo_movimiento IN ('SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO', 'AJUSTE_SALIDA', 'MERMA_VENCIDO') THEN -cantidad
        ELSE 0
      END
    ), 0) INTO v_stock
    FROM movimientos_inventario
    WHERE producto_id = p_producto_id AND lote_id IS NULL AND ubicacion_id = p_ubicacion_id;

    v_toma := LEAST(v_resto, GREATEST(v_stock, 0));
    IF v_toma > 0 THEN
      INSERT INTO movimientos_inventario (
        producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad, referencia_id, usuario_id,
        device_id, fecha_operacion, sincronizado_en, sincronizado_por
      ) VALUES (
        p_producto_id, NULL, p_ubicacion_id, 'SALIDA_VENTA', v_toma, p_venta_id, p_usuario_id,
        p_device_id, p_fecha_operacion, NOW(), p_sincronizado_por
      );
      v_resto := v_resto - v_toma;
    END IF;
  END IF;

  -- Campo redundante (se retirará gradualmente): solo lo que sí salió.
  UPDATE productos SET stock_base = stock_base - (v_objetivo - v_resto) WHERE id = p_producto_id;

  RETURN jsonb_build_object(
    'cubierto', v_objetivo - v_resto,
    'disponible', GREATEST(v_disponible, 0),
    'deficit', p_cantidad_base - (v_objetivo - v_resto),
    'lote_sin_cubrir', v_lote_sin_cubrir
  );
END;
$$;

-- -----------------------------------------------------------------
-- 4. registrar_venta_pos (reemplazo explícito de la firma de 7 params)
-- -----------------------------------------------------------------
DROP FUNCTION IF EXISTS public.registrar_venta_pos(jsonb, uuid, uuid, text, uuid, uuid, uuid);

CREATE FUNCTION registrar_venta_pos(
  p_items JSONB,
  p_cliente_id UUID DEFAULT NULL,
  p_finca_id UUID DEFAULT NULL,
  p_tipo_pago TEXT DEFAULT 'EFECTIVO',
  p_usuario_id UUID DEFAULT NULL, -- Ignorado (ver migración 33). Se conserva por compatibilidad.
  p_ubicacion_id UUID DEFAULT '22222222-2222-2222-2222-222222222222', -- Área de Venta (POS)
  p_local_id UUID DEFAULT NULL,
  p_device_id UUID DEFAULT NULL,
  p_usuario_origen_id UUID DEFAULT NULL,
  p_fecha_operacion TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  p_origen TEXT DEFAULT 'online'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sesion UUID := auth.uid();
  v_offline BOOLEAN;
  v_autor UUID;
  v_fecha_operacion TIMESTAMP WITH TIME ZONE;
  v_venta_id UUID;
  v_detalle_id UUID;
  v_total DECIMAL(14,2) := 0;
  v_item JSONB;
  v_presentacion_id UUID;
  v_producto_id UUID;
  v_producto_cliente UUID;
  v_nombre_presentacion TEXT;
  v_unidad_base TEXT;
  v_cantidad DECIMAL(12,3);
  v_precio_catalogo DECIMAL(14,2);
  v_precio_cliente DECIMAL(14,2);
  v_precio_venta DECIMAL(14,2);
  v_descuento DECIMAL(5,2);
  v_precio_efectivo DECIMAL(14,2);
  v_factor_servidor DECIMAL(12,3);
  v_factor_cliente DECIMAL(12,3);
  v_factor_conversion DECIMAL(12,3);
  v_costo_base DECIMAL(14,4);
  v_saldo_actual DECIMAL(14,2);
  v_limite_credito DECIMAL(14,2);
  v_lineas JSONB := '[]'::JSONB;
  v_consumo JSONB;
  v_hay_conflicto BOOLEAN := false;
BEGIN
  IF v_sesion IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida: inicia sesión para registrar ventas.';
  END IF;

  IF p_origen IS NULL OR p_origen NOT IN ('online', 'offline') THEN
    RAISE EXCEPTION 'Origen de venta inválido: %', p_origen;
  END IF;
  v_offline := p_origen = 'offline';

  -- Autor: quien hizo la venta, no quien sincroniza.
  v_autor := COALESCE(p_usuario_origen_id, v_sesion);
  IF v_autor <> v_sesion AND NOT es_admin(v_sesion) THEN
    RAISE EXCEPTION 'Solo el autor de la venta o un administrador puede sincronizarla.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM perfiles WHERE id = v_autor) THEN
    RAISE EXCEPTION 'El autor de la venta (%) no tiene perfil registrado.', v_autor;
  END IF;

  v_fecha_operacion := CASE WHEN v_offline THEN COALESCE(p_fecha_operacion, NOW()) ELSE NOW() END;

  -- Idempotencia (migración 28) + candado por local_id: dos reintentos
  -- simultáneos de la misma venta se serializan en vez de chocar.
  IF p_local_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('venta|' || p_local_id::text, 0));
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

  IF NOT EXISTS (
    SELECT 1 FROM ubicaciones WHERE id = p_ubicacion_id AND tipo = 'punto_venta' AND activo = true
  ) THEN
    RAISE EXCEPTION 'Las ventas POS solo pueden realizarse en ubicaciones tipo punto_venta. Ubicación solicitada no autorizada.';
  END IF;

  -- 1. Validar ítems y calcular el total ANTES de insertar nada.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_presentacion_id  := (v_item->>'presentacion_id')::UUID;
    v_cantidad         := (v_item->>'cantidad')::DECIMAL;
    v_descuento        := COALESCE((v_item->>'descuento_porcentaje')::DECIMAL, 0);
    v_precio_cliente   := (v_item->>'precio_venta')::DECIMAL;
    v_producto_cliente := (v_item->>'producto_id')::UUID;
    v_factor_cliente   := (v_item->>'factor_conversion')::DECIMAL;

    IF v_presentacion_id IS NULL OR v_cantidad IS NULL OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Ítem del carrito inválido: presentacion_id y cantidad (> 0) son obligatorios.';
    END IF;

    IF v_descuento < 0 OR v_descuento > 100 THEN
      RAISE EXCEPTION 'Descuento inválido (% por ciento): debe estar entre 0 y 100.', v_descuento;
    END IF;

    SELECT pr.producto_id, pr.precio_venta, COALESCE(pr.factor_conversion, 1), pr.nombre_presentacion, p.unidad_base
      INTO v_producto_id, v_precio_catalogo, v_factor_servidor, v_nombre_presentacion, v_unidad_base
    FROM presentaciones pr
    JOIN productos p ON p.id = pr.producto_id
    WHERE pr.id = v_presentacion_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La presentación % ya no existe. Recarga el catálogo.', v_presentacion_id;
    END IF;

    IF v_producto_cliente IS NOT NULL AND v_producto_cliente <> v_producto_id THEN
      RAISE EXCEPTION 'Ítem del carrito inválido: la presentación no pertenece al producto indicado.';
    END IF;

    IF v_offline THEN
      -- Venta ya realizada: el precio y el factor con que se cobró/entregó
      -- son los del momento de la venta, aunque el catálogo haya cambiado.
      IF v_precio_cliente IS NULL OR v_precio_cliente < 0 THEN
        RAISE EXCEPTION 'La venta offline no trae un precio cobrado válido para "%".', v_nombre_presentacion;
      END IF;
      v_precio_venta := v_precio_cliente;
      v_factor_conversion := CASE WHEN v_factor_cliente > 0 THEN v_factor_cliente ELSE v_factor_servidor END;
    ELSE
      -- En línea: el ticket debe coincidir con el precio vigente (migración 33).
      IF v_precio_cliente IS NOT NULL AND abs(v_precio_cliente - v_precio_catalogo) > 0.005 THEN
        RAISE EXCEPTION 'El precio de "%" cambió (ticket: Q%, vigente: Q%). Recarga el catálogo y vuelve a cobrar.',
          v_nombre_presentacion, v_precio_cliente, v_precio_catalogo;
      END IF;
      v_precio_venta := v_precio_catalogo;
      v_factor_conversion := v_factor_servidor;
    END IF;

    SELECT COALESCE(pc.precio_costo, 0) INTO v_costo_base
    FROM productos_costos pc WHERE pc.producto_id = v_producto_id;
    v_costo_base := COALESCE(v_costo_base, 0);

    v_precio_efectivo := v_precio_venta * (1 - v_descuento / 100);
    v_total := v_total + (v_cantidad * v_precio_efectivo);

    v_lineas := v_lineas || jsonb_build_object(
      'presentacion_id', v_presentacion_id,
      'producto_id', v_producto_id,
      'unidad_base', v_unidad_base,
      'cantidad', v_cantidad,
      'precio_unitario', v_precio_venta,
      'precio_catalogo', v_precio_catalogo,
      'descuento', v_descuento,
      'precio_efectivo', v_precio_efectivo,
      'factor_conversion', v_factor_conversion,
      'cantidad_base', v_cantidad * v_factor_conversion,
      'costo_unitario', v_factor_conversion * v_costo_base,
      'detalle_local_id', NULLIF(v_item->>'detalle_local_id', ''),
      'lotes', CASE WHEN jsonb_typeof(v_item->'lotes') = 'array' THEN v_item->'lotes' ELSE NULL END,
      'vencido', COALESCE((v_item->>'vencido')::BOOLEAN, false)
    );
  END LOOP;

  -- 2. Crédito (fila bloqueada)
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
  INSERT INTO ventas (
    total, estado_factura, cliente_id, finca_id, tipo_pago, local_id, usuario_id,
    fecha_venta, device_id, origen, sincronizado_en, sincronizado_por
  ) VALUES (
    v_total, 'pendiente', p_cliente_id, p_finca_id, p_tipo_pago, p_local_id, v_autor,
    v_fecha_operacion, p_device_id, p_origen,
    CASE WHEN v_offline THEN NOW() END,
    CASE WHEN v_offline THEN v_sesion END
  )
  RETURNING id INTO v_venta_id;

  -- 4. Detalle + salida de stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_lineas)
  LOOP
    INSERT INTO detalle_ventas (
      venta_id, presentacion_id, cantidad, subtotal, costo_unitario,
      detalle_local_id, precio_unitario, descuento_porcentaje, precio_catalogo,
      factor_conversion, cantidad_base, lotes_sugeridos, advertencia_vencimiento
    ) VALUES (
      v_venta_id,
      (v_item->>'presentacion_id')::UUID,
      (v_item->>'cantidad')::DECIMAL,
      (v_item->>'cantidad')::DECIMAL * (v_item->>'precio_efectivo')::DECIMAL,
      (v_item->>'costo_unitario')::DECIMAL,
      (v_item->>'detalle_local_id')::UUID,
      (v_item->>'precio_unitario')::DECIMAL,
      (v_item->>'descuento')::DECIMAL,
      (v_item->>'precio_catalogo')::DECIMAL,
      (v_item->>'factor_conversion')::DECIMAL,
      (v_item->>'cantidad_base')::DECIMAL,
      NULLIF(v_item->'lotes', 'null'::jsonb),
      (v_item->>'vencido')::BOOLEAN
    )
    RETURNING id INTO v_detalle_id;

    IF NOT v_offline THEN
      -- En línea: FEFO estricto, stock insuficiente revierte TODO.
      PERFORM procesar_salida_fefo(
        (v_item->>'producto_id')::UUID,
        (v_item->>'cantidad_base')::DECIMAL,
        v_venta_id,
        v_autor,
        p_ubicacion_id
      );
    ELSE
      v_consumo := consumir_stock_venta_offline(
        (v_item->>'producto_id')::UUID,
        (v_item->>'cantidad_base')::DECIMAL,
        v_item->'lotes',
        v_venta_id,
        v_autor,
        p_ubicacion_id,
        p_device_id,
        v_fecha_operacion,
        v_sesion
      );

      IF (v_consumo->>'deficit')::DECIMAL > 0 THEN
        v_hay_conflicto := true;
        INSERT INTO conflictos_inventario (
          tipo, estado, local_id, venta_id, detalle_venta_id, detalle_local_id,
          device_id, usuario_origen_id, sincronizado_por, fecha_operacion, sincronizado_en,
          producto_id, presentacion_id, lote_id, ubicacion_id, unidad_base,
          cantidad_presentacion, cantidad_solicitada, cantidad_cubierta, cantidad_disponible,
          deficit, lotes_sugeridos, detalle
        ) VALUES (
          'STOCK_INSUFICIENTE', 'pendiente', p_local_id, v_venta_id, v_detalle_id,
          (v_item->>'detalle_local_id')::UUID,
          p_device_id, v_autor, v_sesion, v_fecha_operacion, NOW(),
          (v_item->>'producto_id')::UUID, (v_item->>'presentacion_id')::UUID,
          (v_consumo->>'lote_sin_cubrir')::UUID, p_ubicacion_id, v_item->>'unidad_base',
          (v_item->>'cantidad')::DECIMAL,
          (v_item->>'cantidad_base')::DECIMAL,
          (v_consumo->>'cubierto')::DECIMAL,
          (v_consumo->>'disponible')::DECIMAL,
          (v_consumo->>'deficit')::DECIMAL,
          NULLIF(v_item->'lotes', 'null'::jsonb),
          format('Stock insuficiente al sincronizar venta offline: disponible %s, solicitado %s, descontado %s, faltante %s %s.',
            v_consumo->>'disponible', v_item->>'cantidad_base', v_consumo->>'cubierto',
            v_consumo->>'deficit', COALESCE(v_item->>'unidad_base', ''))
        );
      END IF;
    END IF;
  END LOOP;

  IF v_hay_conflicto THEN
    UPDATE ventas SET conflicto_stock = true WHERE id = v_venta_id;
  END IF;

  -- 5. Crédito: actualizar saldo (fila ya bloqueada)
  IF p_tipo_pago = 'CREDITO' THEN
    UPDATE clientes SET saldo_actual = COALESCE(saldo_actual, 0) + v_total WHERE id = p_cliente_id;
  END IF;

  RETURN v_venta_id;
END;
$$;

-- -----------------------------------------------------------------
-- 5. Permisos (el DROP/CREATE perdió los de la migración 33)
-- -----------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION registrar_venta_pos(jsonb, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION registrar_venta_pos(jsonb, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, timestamptz, text) TO authenticated;

-- Solo uso interno (la llama registrar_venta_pos como su dueño).
REVOKE EXECUTE ON FUNCTION consumir_stock_venta_offline(uuid, numeric, jsonb, uuid, uuid, uuid, uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
