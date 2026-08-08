-- 6. TABLA DE CIERRES DE CAJA (Arqueos diarios)
CREATE TABLE IF NOT EXISTS cierres_caja (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID REFERENCES auth.users(id),
  monto_inicial DECIMAL NOT NULL DEFAULT 0,
  ventas_efectivo DECIMAL NOT NULL DEFAULT 0,
  monto_esperado DECIMAL NOT NULL DEFAULT 0,
  monto_real DECIMAL NOT NULL DEFAULT 0,
  diferencia DECIMAL NOT NULL DEFAULT 0,
  observaciones TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS y políticas
ALTER TABLE cierres_caja ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir operar cierres de caja" ON cierres_caja 
FOR ALL TO authenticated USING (true);
