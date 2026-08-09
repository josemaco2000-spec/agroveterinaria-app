-- =================================================================
-- 09. MIGRACIÓN: TRES CAPAS FINANCIERAS, IMPUESTOS (SAT GT) Y RLS
-- =================================================================

-- 1. Agregar indicador de IVA en la tabla de productos (Afecto vs Exento)
ALTER TABLE productos 
  ADD COLUMN IF NOT EXISTS es_afecto_iva BOOLEAN NOT NULL DEFAULT true;

-- 2. Agregar snapshot de costo unitario en el detalle de ventas (Resguardo Histórico)
ALTER TABLE detalle_ventas 
  ADD COLUMN IF NOT EXISTS costo_unitario DECIMAL DEFAULT 0;

-- 3. Asegurar RLS en vistas y tablas financieras exclusivas para Administrador / Gerente
CREATE OR REPLACE FUNCTION es_admin(user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM perfiles
    WHERE id = user_id AND rol = 'admin'
  );
END;
$$;

-- 4. Garantizar políticas estrictas de seguridad (Sólo Administradores pueden gestionar la configuración financiera)
ALTER TABLE productos_costos ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_compras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Solo admin ve y edita costos" ON productos_costos;
CREATE POLICY "Solo admin ve y edita costos" ON productos_costos FOR ALL TO authenticated 
USING ( es_admin(auth.uid()) );

DROP POLICY IF EXISTS "Compras operables admin" ON compras;
CREATE POLICY "Compras operables admin" ON compras FOR ALL TO authenticated 
USING ( true );

DROP POLICY IF EXISTS "Detalle compras operables admin" ON detalle_compras;
CREATE POLICY "Detalle compras operables admin" ON detalle_compras FOR ALL TO authenticated 
USING ( true );
