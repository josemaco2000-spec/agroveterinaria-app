-- =================================================================
-- 31. LIMPIEZA TOTAL DE DATOS DE PRUEBA (TRANSACCIONES + CATÁLOGO)
-- =================================================================
-- ADVERTENCIA: esto borra datos de forma PERMANENTE e IRREVERSIBLE.
-- Corré antes 30_preview_antes_de_limpiar.sql y confirmá que ya tenés
-- un respaldo (ver instrucciones aparte) si te importa conservar algo
-- de lo que se va a borrar.
--
-- Alcance (decidido explícitamente, no es el default): borra TODA la
-- información transaccional (ventas, compras, movimientos de kardex,
-- cierres de caja, conciliación offline) Y TODO el catálogo (productos,
-- presentaciones, lotes, clientes, fincas, proveedores) -- un reinicio
-- total, como si el sistema nunca se hubiera usado.
--
-- Se conservan intactos (NO se tocan):
--   - perfiles / auth.users  (tus usuarios y roles reales)
--   - ubicaciones            (Bodega Central / Área de Venta, con sus
--                             IDs fijos referenciados por las RPC)
--
-- TRUNCATE ... CASCADE resuelve el orden de dependencias entre las
-- tablas listadas automáticamente (no hace falta borrar en un orden
-- manual). Si Postgres muestra un aviso "truncate cascades to table X"
-- con una tabla que NO esté en esta lista, DETENÉ y avisame antes de
-- confirmar -- significaría que hay una relación que no contemplé.
-- =================================================================

BEGIN;

TRUNCATE TABLE
  detalle_ventas,
  detalle_compras,
  pagos_credito,
  ventas_offline_fallidas,
  movimientos_offline_fallidos,
  movimientos_inventario,
  stock_minimo_ubicacion,
  ventas,
  compras,
  cierres_caja,
  lotes,
  presentaciones,
  productos_costos,
  productos,
  fincas,
  clientes,
  proveedores
CASCADE;

COMMIT;

-- Verificación rápida: todas estas deberían dar 0, y las dos de abajo
-- deberían seguir mostrando tus datos reales sin cambios.
SELECT 'productos' AS tabla, COUNT(*) FROM productos
UNION ALL SELECT 'ventas', COUNT(*) FROM ventas
UNION ALL SELECT 'clientes', COUNT(*) FROM clientes
UNION ALL SELECT '-- perfiles (debe seguir igual)', COUNT(*) FROM perfiles
UNION ALL SELECT '-- ubicaciones (debe seguir igual)', COUNT(*) FROM ubicaciones;
