-- =================================================================
-- 16. FIX CRÍTICO: BLOQUEAR INSERT DIRECTO EN movimientos_inventario
-- =================================================================
-- DIAGNÓSTICO:
-- La política "Todos operan movimientos" permitía INSERT a cualquier
-- usuario autenticado (WITH CHECK (true)), sin pasar por las RPC. Como
-- las vistas de stock (v_stock_lotes_ubicacion, v_stock_productos_ubicacion)
-- se calculan 100% desde esta tabla, cualquier cliente autenticado
-- (incluido un cajero) podía fabricar un movimiento 'AJUSTE_POSITIVO'
-- o 'TRASLADO_ENTRADA' y crear stock de la nada, o insertar una
-- 'SALIDA_VENTA' falsa para sabotear el inventario de otro producto.
--
-- CORRECCIÓN:
-- Restringir el INSERT a solo administradores. Las RPC SECURITY DEFINER
-- (procesar_salida_fefo, realizar_traslado_inventario,
-- registrar_entrada_compra, registrar_venta_pos) siguen funcionando sin
-- ningún cambio: son propiedad de 'postgres', que tiene rolbypassrls = true,
-- por lo que ignoran esta política por completo. Verificado antes de
-- aplicar este fix (ver consulta de auditoría previa).
--
-- El único INSERT directo desde el cliente (no-RPC) detectado en el
-- código es en inventario.js, al crear un producto nuevo (ENTRADA_COMPRA
-- inicial) — esa página exige rol admin en el frontend (validarAccesoAdmin),
-- así que sigue funcionando igual con esta política.
--
-- NOTA DE AUDITORÍA (post-aplicación): la política real en producción no
-- se llamaba "Todos operan movimientos" (nombre usado en 04_kardex_fefo.sql)
-- sino "Escritura de kardex autenticados" — otra prueba de que el estado
-- real de producción diverge del historial de migraciones versionadas.
-- Como Postgres combina políticas permisivas del mismo comando con OR,
-- crear la política restrictiva NO bastaba mientras la permisiva original
-- siguiera activa: había que eliminar la política real por su nombre real.
-- =================================================================

DROP POLICY IF EXISTS "Todos operan movimientos" ON movimientos_inventario;
DROP POLICY IF EXISTS "Escritura de kardex autenticados" ON movimientos_inventario;

CREATE POLICY "Solo admin inserta movimientos manualmente" ON movimientos_inventario
  FOR INSERT TO authenticated
  WITH CHECK ( es_admin(auth.uid()) );
