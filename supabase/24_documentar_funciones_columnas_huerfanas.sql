-- =================================================================
-- 24. DOCUMENTACIÓN: FUNCIONES, TRIGGER Y COLUMNAS YA EXISTENTES
--     EN PRODUCCIÓN SIN RASTRO EN NINGUNA MIGRACIÓN
-- =================================================================
-- Hallado en la reconciliación esquema real vs. repo (pg_get_functiondef,
-- information_schema.columns, pg_trigger contra producción). Todo lo de
-- este archivo YA ESTÁ DESPLEGADO Y FUNCIONANDO — este archivo no cambia
-- ningún comportamiento, solo hace que el historial de migraciones dexe
-- de ser ciego a estas piezas. Todas las sentencias son idempotentes
-- (CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS).
-- =================================================================

-- -----------------------------------------------------------------
-- Columnas de perfiles (la migración 02 solo creó id y rol)
-- -----------------------------------------------------------------
ALTER TABLE perfiles
  ADD COLUMN IF NOT EXISTS nombre_completo TEXT DEFAULT 'Usuario Campo Alto',
  ADD COLUMN IF NOT EXISTS pin_autorizacion TEXT,
  ADD COLUMN IF NOT EXISTS correo TEXT;

-- -----------------------------------------------------------------
-- Trigger de alta automática de perfil al registrarse un usuario
-- -----------------------------------------------------------------
-- Al crearse una fila en auth.users, el trigger on_auth_user_created
-- (ya existente en producción, no se recrea aquí para no tocar el
-- stack de auth.users) invoca esta función y crea el perfil por
-- defecto como 'vendedor' con PIN inicial '0000'.
--
-- RIESGO CONOCIDO (no corregido en esta migración, solo documentado):
-- el PIN por defecto '0000' es predecible y validar_pin_supervisor()
-- (ver abajo) autoriza acciones sensibles (descuentos) si CUALQUIER
-- admin tiene ese PIN. Si un admin nuevo no cambia su PIN desde
-- empleados.js, cualquier cajero podría autorizarse descuentos
-- probando '0000'. Recomendado para una futura migración: generar un
-- PIN aleatorio en vez de un valor fijo, o forzar su cambio en el
-- primer login.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.perfiles (id, rol, nombre_completo, pin_autorizacion, correo)
  VALUES (new.id, 'vendedor', 'Cajero Nuevo', '0000', new.email);
  RETURN new;
END;
$$;

-- -----------------------------------------------------------------
-- Validación de PIN de supervisor (autorización de descuentos en el POS)
-- -----------------------------------------------------------------
-- SECURITY DEFINER: permite comparar el PIN sin exponer la columna
-- pin_autorizacion al cliente (ver 21_cerrar_fuga_pin_perfiles.sql,
-- que cerró la política que sí la exponía directamente).
CREATE OR REPLACE FUNCTION validar_pin_supervisor(p_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_valido BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM perfiles
    WHERE rol = 'admin' AND pin_autorizacion = p_pin
  ) INTO v_valido;

  RETURN v_valido;
END;
$$;

-- -----------------------------------------------------------------
-- Política de UPDATE en perfiles (usada por empleados.js para editar
-- rol/nombre/PIN de un empleado) — existía en producción sin política
-- documentada en ninguna migración.
-- -----------------------------------------------------------------
DROP POLICY IF EXISTS "Admin puede actualizar perfiles" ON perfiles;
CREATE POLICY "Admin puede actualizar perfiles" ON perfiles
  FOR UPDATE TO authenticated
  USING ( es_admin(auth.uid()) );

-- -----------------------------------------------------------------
-- Limpieza: 'lotes' tenía dos políticas ALL admin-only redundantes
-- (misma condición, dos nombres distintos) por el mismo tipo de drift.
-- Se conserva la documentada en 08_fix_rls_recursion.sql y se elimina
-- el duplicado sin nombre rastreado.
-- -----------------------------------------------------------------
DROP POLICY IF EXISTS "Escritura de lotes solo admin" ON lotes;
