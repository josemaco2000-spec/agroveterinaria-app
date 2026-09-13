-- =================================================================
-- 18. FIX CRÍTICO: CERRAR RLS EN ventas / detalle_ventas
-- =================================================================
-- DIAGNÓSTICO: ambas tablas tenían una única política ALL con
-- qual = true ("Empleados operan ventas" / "Empleados operan detalle
-- ventas") — coincide exactamente con lo definido en 02_roles_y_seguridad.sql,
-- sin drift esta vez. Cualquier autenticado (incluido un cajero) podía
-- editar el total de una venta ya cobrada o borrarla por completo.
--
-- VERIFICADO ANTES DE APLICAR (auditoría de src/):
-- - Ningún archivo inserta directo en ventas/detalle_ventas: la única vía
--   es la RPC registrar_venta_pos (SECURITY DEFINER, rolbypassrls=true).
-- - El único UPDATE directo en todo el frontend es facturacion.js
--   (estado_factura, numero_factura_fisica), y esa página exige rol admin.
-- - Cero DELETE directo en cualquier archivo.
-- - ventas es leída ampliamente por admin.js, cierre.js, clientes.js,
--   facturacion.js, pos.js/cajero-pos.js (cajero también) → SELECT debe
--   seguir abierto a todos los autenticados.
--
-- CORRECCIÓN:
-- - SELECT: se mantiene abierto a authenticated (no cambia el comportamiento).
-- - INSERT: sin política (deny-all para clientes directos); la RPC sigue
--   funcionando porque bypassa RLS por completo.
-- - UPDATE/DELETE: solo admin.
-- =================================================================

DROP POLICY IF EXISTS "Empleados operan ventas" ON ventas;
CREATE POLICY "Lectura ventas autenticados" ON ventas
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Solo admin actualiza ventas" ON ventas
  FOR UPDATE TO authenticated USING (es_admin(auth.uid()));
CREATE POLICY "Solo admin elimina ventas" ON ventas
  FOR DELETE TO authenticated USING (es_admin(auth.uid()));

DROP POLICY IF EXISTS "Empleados operan detalle ventas" ON detalle_ventas;
CREATE POLICY "Lectura detalle ventas autenticados" ON detalle_ventas
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Solo admin actualiza detalle ventas" ON detalle_ventas
  FOR UPDATE TO authenticated USING (es_admin(auth.uid()));
CREATE POLICY "Solo admin elimina detalle ventas" ON detalle_ventas
  FOR DELETE TO authenticated USING (es_admin(auth.uid()));
