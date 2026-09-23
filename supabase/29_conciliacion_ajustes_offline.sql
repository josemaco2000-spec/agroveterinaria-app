-- =================================================================
-- 29. CONCILIACIÓN DE AJUSTES/MERMAS DE INVENTARIO OFFLINE FALLIDOS
-- =================================================================
-- Mismo problema que 27_conciliacion_ventas_offline.sql pero para
-- ajustes/mermas registrados desde kardex.html (Fase 4 del modo
-- offline): si el admin registra un ajuste sin conexión y, al
-- sincronizar, el servidor lo rechaza por una razón real (p.ej. el lote
-- ya no tiene ese stock disponible porque se vendió mientras tanto),
-- el ajuste queda en la cola local de ESE dispositivo -- sin esta
-- tabla, invisible para revisión.
-- =================================================================

CREATE TABLE IF NOT EXISTS movimientos_offline_fallidos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  local_id TEXT NOT NULL,
  producto_id UUID REFERENCES productos(id) ON DELETE SET NULL,
  ubicacion_id UUID REFERENCES ubicaciones(id) ON DELETE SET NULL,
  lote_id UUID REFERENCES lotes(id) ON DELETE SET NULL,
  tipo_movimiento TEXT NOT NULL,
  cantidad DECIMAL(12,3) NOT NULL,
  observaciones TEXT,
  error_mensaje TEXT NOT NULL,
  usuario_id UUID REFERENCES auth.users(id),
  resuelto BOOLEAN NOT NULL DEFAULT false,
  resuelto_por UUID REFERENCES auth.users(id),
  resuelto_en TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE movimientos_offline_fallidos ENABLE ROW LEVEL SECURITY;

-- Los ajustes son admin-only (registrar_ajuste_inventario ya lo exige),
-- así que quien registra su propio intento fallido siempre es un admin.
CREATE POLICY "Admin registra su propio ajuste fallido" ON movimientos_offline_fallidos
  FOR INSERT TO authenticated
  WITH CHECK ( usuario_id = auth.uid() AND es_admin(auth.uid()) );

CREATE POLICY "Solo admin lee ajustes offline fallidos" ON movimientos_offline_fallidos
  FOR SELECT TO authenticated
  USING ( es_admin(auth.uid()) );

CREATE POLICY "Solo admin marca resueltos los ajustes offline fallidos" ON movimientos_offline_fallidos
  FOR UPDATE TO authenticated
  USING ( es_admin(auth.uid()) );

CREATE INDEX IF NOT EXISTS idx_movimientos_offline_fallidos_resuelto
  ON movimientos_offline_fallidos (resuelto, created_at DESC);
