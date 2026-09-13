-- =================================================================
-- 20. FIX CRÍTICO: CERRAR RLS EN clientes / fincas / pagos_credito
-- =================================================================
-- DIAGNÓSTICO (pg_policies real):
-- - clientes: política ALL "Escritura clientes" con qual=true → cualquier
--   autenticado (cajero incluido) podía subir su propio limite_credito,
--   editar el de cualquier cliente, o borrar clientes.
-- - fincas: mismo patrón, política ALL "Escritura fincas" qual=true.
-- - pagos_credito: solo tenía INSERT abierto (WITH CHECK true) sin
--   política de UPDATE/DELETE (esas ya estaban bien, denegadas por
--   ausencia de política). El INSERT abierto no tiene ningún uso
--   legítimo: la única vía real es la RPC registrar_abono_credito
--   (SECURITY DEFINER, rolbypassrls=true).
--
-- VERIFICADO ANTES DE APLICAR (auditoría de src/):
-- - clientes.js (admin) y cajero-pos.js (cajero, alta silenciosa) hacen
--   INSERT directo en clientes → debe seguir abierto a authenticated.
-- - clientes.js (admin) y cajero-pos.js (cajero, alta silenciosa) hacen
--   INSERT directo en fincas → debe seguir abierto a authenticated.
-- - Cero UPDATE/DELETE directo en clientes o fincas en todo el frontend
--   (no existe pantalla de "editar cliente" hoy).
-- - clientes.js y cajero-clientes.js registran abonos vía
--   supabase.rpc('registrar_abono_credito', ...), nunca .insert() directo
--   sobre pagos_credito.
--
-- CORRECCIÓN:
-- - clientes/fincas: INSERT abierto a authenticated (sin cambio real de
--   comportamiento), UPDATE/DELETE solo admin.
-- - pagos_credito: se cierra el INSERT directo (deny-all); la RPC sigue
--   funcionando porque bypassa RLS.
-- =================================================================

DROP POLICY IF EXISTS "Escritura clientes" ON clientes;
CREATE POLICY "Insertar clientes autenticados" ON clientes
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Solo admin actualiza clientes" ON clientes
  FOR UPDATE TO authenticated USING (es_admin(auth.uid()));
CREATE POLICY "Solo admin elimina clientes" ON clientes
  FOR DELETE TO authenticated USING (es_admin(auth.uid()));

DROP POLICY IF EXISTS "Escritura fincas" ON fincas;
CREATE POLICY "Insertar fincas autenticados" ON fincas
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Solo admin actualiza fincas" ON fincas
  FOR UPDATE TO authenticated USING (es_admin(auth.uid()));
CREATE POLICY "Solo admin elimina fincas" ON fincas
  FOR DELETE TO authenticated USING (es_admin(auth.uid()));

DROP POLICY IF EXISTS "Escritura pagos_credito" ON pagos_credito;
