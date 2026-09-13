-- =================================================================
-- 15. ÍNDICES DE RENDIMIENTO (sin cambios de lógica ni de permisos)
-- =================================================================
-- Cubre los patrones de consulta reales del POS/Kardex/Inventario:
-- filtros y agrupaciones por producto_id, ubicacion_id, lote_id,
-- traslado_id y created_at en movimientos_inventario (la tabla de
-- mayor volumen de escritura, base de las vistas de stock), más
-- el join detalle_ventas -> venta_id usado en historial y reportes.
-- =================================================================

CREATE INDEX IF NOT EXISTS idx_movimientos_producto_ubicacion
  ON movimientos_inventario (producto_id, ubicacion_id);

CREATE INDEX IF NOT EXISTS idx_movimientos_lote
  ON movimientos_inventario (lote_id);

CREATE INDEX IF NOT EXISTS idx_movimientos_traslado
  ON movimientos_inventario (traslado_id) WHERE traslado_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_movimientos_created_at
  ON movimientos_inventario (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lotes_producto
  ON lotes (producto_id) WHERE stock_actual > 0;

CREATE INDEX IF NOT EXISTS idx_detalle_ventas_venta
  ON detalle_ventas (venta_id);
