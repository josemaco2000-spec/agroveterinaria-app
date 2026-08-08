-- 10. TABLA DE CLIENTES
CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre TEXT NOT NULL,
  nit TEXT DEFAULT 'CF',
  telefono TEXT,
  direccion TEXT,
  limite_credito DECIMAL NOT NULL DEFAULT 0,
  saldo_actual DECIMAL NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. TABLA DE FINCAS
CREATE TABLE IF NOT EXISTS fincas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
  nombre_finca TEXT NOT NULL,
  ubicacion TEXT,
  tipo_explotacion TEXT, -- Ej: 'Ganadería Bovino', 'Avícola', 'Porcina', 'Agrícola'
  tamano_hectareas DECIMAL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. TABLA DE PAGOS DE CRÉDITO (ABONOS)
CREATE TABLE IF NOT EXISTS pagos_credito (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
  monto DECIMAL NOT NULL,
  metodo_pago TEXT DEFAULT 'EFECTIVO',
  numero_referencia TEXT,
  observaciones TEXT,
  usuario_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS y políticas
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fincas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos_credito ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clientes operables" ON clientes FOR ALL TO authenticated USING (true);
CREATE POLICY "Fincas operables" ON fincas FOR ALL TO authenticated USING (true);
CREATE POLICY "Pagos credito operables" ON pagos_credito FOR ALL TO authenticated USING (true);

-- RPC REGISTRAR ABONO
CREATE OR REPLACE FUNCTION registrar_abono_credito(
  p_cliente_id UUID,
  p_monto DECIMAL,
  p_metodo_pago TEXT DEFAULT 'EFECTIVO',
  p_numero_referencia TEXT DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insertar registro de abono
  INSERT INTO pagos_credito (
    cliente_id,
    monto,
    metodo_pago,
    numero_referencia,
    observaciones,
    usuario_id
  ) VALUES (
    p_cliente_id,
    p_monto,
    p_metodo_pago,
    p_numero_referencia,
    p_observaciones,
    p_usuario_id
  );

  -- Descontar saldo actual del cliente
  UPDATE clientes
  SET saldo_actual = GREATEST(0, saldo_actual - p_monto)
  WHERE id = p_cliente_id;
END;
$$;
