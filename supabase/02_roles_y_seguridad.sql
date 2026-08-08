-- 1. TABLA DE PERFILES (Conectada a la autenticación de Supabase)
CREATE TABLE perfiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  rol TEXT CHECK (rol IN ('admin', 'vendedor')) DEFAULT 'vendedor'
);

-- 2. SEPARAR LA INFORMACIÓN SENSIBLE (El truco pro)
-- Quitamos el costo de la tabla pública
ALTER TABLE productos DROP COLUMN precio_costo;

-- Creamos la tabla secreta de costos
CREATE TABLE productos_costos (
  producto_id UUID REFERENCES productos(id) ON DELETE CASCADE PRIMARY KEY,
  precio_costo DECIMAL NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. ACTIVAR LA SEGURIDAD (RLS) EN TODAS LAS TABLAS
ALTER TABLE perfiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos_costos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_ventas ENABLE ROW LEVEL SECURITY;

-- ========================================================
-- 4. POLÍTICAS DE SEGURIDAD (Las Reglas del Juego)
-- ========================================================

-- PERFILES: Cada quien puede ver su propio perfil
CREATE POLICY "Ver propio perfil" ON perfiles FOR SELECT TO authenticated 
USING ( id = auth.uid() );

-- PRODUCTOS y PRESENTACIONES: Todos pueden VER para poder vender
CREATE POLICY "Todos ven productos" ON productos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Todos ven presentaciones" ON presentaciones FOR SELECT TO authenticated USING (true);

-- PRODUCTOS (Modificar): Solo el admin puede crear, editar o borrar productos
CREATE POLICY "Solo admin modifica productos" ON productos FOR ALL TO authenticated 
USING ( (SELECT rol FROM perfiles WHERE id = auth.uid()) = 'admin' );

CREATE POLICY "Solo admin modifica presentaciones" ON presentaciones FOR ALL TO authenticated 
USING ( (SELECT rol FROM perfiles WHERE id = auth.uid()) = 'admin' );

-- COSTOS: ¡El candado principal! Solo el admin puede ver y editar los costos
CREATE POLICY "Solo admin ve y edita costos" ON productos_costos FOR ALL TO authenticated 
USING ( (SELECT rol FROM perfiles WHERE id = auth.uid()) = 'admin' );

-- VENTAS: El vendedor puede registrar ventas y verlas. (Más adelante podemos restringir que no borre)
CREATE POLICY "Empleados operan ventas" ON ventas FOR ALL TO authenticated USING (true);
CREATE POLICY "Empleados operan detalle ventas" ON detalle_ventas FOR ALL TO authenticated USING (true);