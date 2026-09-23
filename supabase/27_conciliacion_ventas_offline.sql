-- =================================================================
-- 27. CONCILIACIÓN DE VENTAS OFFLINE NO SINCRONIZADAS
-- =================================================================
-- DIAGNÓSTICO: cuando el POS está offline, la venta se guarda en
-- localStorage del navegador del cajero, se imprime el ticket y se
-- marca "exitosa" localmente. Si al reconectar la sincronización con
-- registrar_venta_pos falla por una razón real (p.ej. otro cajero ya
-- vendió el último stock disponible), la venta queda atascada en el
-- localStorage de ESE dispositivo específico — invisible para un admin
-- en otra computadora, sin ninguna alerta. El dinero ya se cobró pero
-- la venta nunca quedó registrada en el sistema.
--
-- CORRECCIÓN: tabla server-side donde el cajero registra el intento
-- fallido (con el motivo exacto del error) apenas ocurre, para que
-- CUALQUIER admin, desde cualquier dispositivo, pueda verlo y decidir
-- qué hacer (rehacer la venta, contactar al cliente, ajustar stock, etc).
-- =================================================================

CREATE TABLE IF NOT EXISTS ventas_offline_fallidas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  local_id TEXT NOT NULL,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  finca_id UUID REFERENCES fincas(id) ON DELETE SET NULL,
  tipo_pago TEXT,
  total DECIMAL(14,2) NOT NULL,
  items JSONB NOT NULL,
  error_mensaje TEXT NOT NULL,
  usuario_id UUID REFERENCES auth.users(id),
  resuelto BOOLEAN NOT NULL DEFAULT false,
  resuelto_por UUID REFERENCES auth.users(id),
  resuelto_en TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE ventas_offline_fallidas ENABLE ROW LEVEL SECURITY;

-- El cajero registra su propio intento fallido (usuario_id debe ser él mismo).
CREATE POLICY "Cajero registra su propio intento fallido" ON ventas_offline_fallidas
  FOR INSERT TO authenticated
  WITH CHECK ( usuario_id = auth.uid() );

-- Solo admin ve y resuelve la cola de conciliación (incluye vendedor_id de
-- otros cajeros, que un vendedor no debería poder listar libremente).
CREATE POLICY "Solo admin lee ventas offline fallidas" ON ventas_offline_fallidas
  FOR SELECT TO authenticated
  USING ( es_admin(auth.uid()) );

CREATE POLICY "Solo admin marca resueltas las ventas offline fallidas" ON ventas_offline_fallidas
  FOR UPDATE TO authenticated
  USING ( es_admin(auth.uid()) );

CREATE INDEX IF NOT EXISTS idx_ventas_offline_fallidas_resuelto
  ON ventas_offline_fallidas (resuelto, created_at DESC);
