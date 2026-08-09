-- 1. Crear función SECURITY DEFINER para verificar rol de admin (bypassa RLS de perfiles)
CREATE OR REPLACE FUNCTION es_admin(user_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM perfiles
    WHERE id = user_id AND rol = 'admin'
  );
END;
$$;

-- 2. Políticas corregidas para perfiles
DROP POLICY IF EXISTS "Ver propio perfil" ON perfiles;
DROP POLICY IF EXISTS "Admin ve todos los perfiles" ON perfiles;
CREATE POLICY "Ver propio perfil o admin" ON perfiles FOR SELECT TO authenticated
USING ( id = auth.uid() OR es_admin(auth.uid()) );

-- 3. Actualizar políticas de las otras tablas para usar la función y prevenir recursión/lentitud
DROP POLICY IF EXISTS "Solo admin modifica productos" ON productos;
CREATE POLICY "Solo admin modifica productos" ON productos FOR ALL TO authenticated 
USING ( es_admin(auth.uid()) );

DROP POLICY IF EXISTS "Solo admin modifica presentaciones" ON presentaciones;
CREATE POLICY "Solo admin modifica presentaciones" ON presentaciones FOR ALL TO authenticated 
USING ( es_admin(auth.uid()) );

DROP POLICY IF EXISTS "Solo admin ve y edita costos" ON productos_costos;
CREATE POLICY "Solo admin ve y edita costos" ON productos_costos FOR ALL TO authenticated 
USING ( es_admin(auth.uid()) );

DROP POLICY IF EXISTS "Admin gestiona lotes" ON lotes;
CREATE POLICY "Admin gestiona lotes" ON lotes FOR ALL TO authenticated 
USING ( es_admin(auth.uid()) );
