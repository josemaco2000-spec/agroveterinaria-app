-- =================================================================
-- 17. FIX CRÍTICO: CERRAR RLS EN compras / detalle_compras
-- =================================================================
-- DIAGNÓSTICO (auditoría de pg_policies real, no del historial de
-- migraciones): 'compras' y 'detalle_compras' tenían DOS políticas ALL
-- simultáneas cada una:
--   1) Una permisiva con qual = true ("...operables admin", nombre
--      heredado de 07_proveedores_compras.sql / 09_..._reportes.sql,
--      que en realidad NUNCA restringió nada pese al nombre).
--   2) Una correctamente restringida a admin ("...solo admin"), que
--      alguien agregó después pero sin borrar la anterior.
-- Como Postgres combina políticas permisivas del mismo comando con OR,
-- la permisiva ganaba: cualquier autenticado (incluido un cajero) podía
-- crear/editar/borrar compras y su detalle, viendo y manipulando costos
-- de proveedor. Mismo patrón exacto ya visto en movimientos_inventario.
--
-- VERIFICADO ANTES DE APLICAR:
-- - admin.js y compras.js (únicos lectores/escritores de estas tablas)
--   exigen rol='admin' en el frontend (redirigen a pos.html si no).
-- - registrar_entrada_compra (RPC) es SECURITY DEFINER, propiedad de
--   postgres con rolbypassrls=true → no se ve afectada por esta política.
-- - 'proveedores' ya estaba correctamente cerrada (no requirió cambios).
--
-- CORRECCIÓN: eliminar únicamente la política permisiva duplicada en
-- cada tabla; la política admin-only correcta ya existía y se conserva.
-- =================================================================

DROP POLICY IF EXISTS "Compras operables admin" ON compras;
DROP POLICY IF EXISTS "Detalle compras operables admin" ON detalle_compras;
