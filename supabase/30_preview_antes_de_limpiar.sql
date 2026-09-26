-- =================================================================
-- 30. VISTA PREVIA ANTES DE LA LIMPIEZA TOTAL (NO BORRA NADA)
-- =================================================================
-- Corré esto en el SQL Editor de Supabase ANTES de
-- 31_limpieza_total_datos_prueba.sql, para confirmar que las cantidades
-- de filas tienen sentido (son datos de prueba, no datos reales que se
-- te haya olvidado respaldar).
-- =================================================================

SELECT 'detalle_ventas' AS tabla, COUNT(*) AS filas FROM detalle_ventas
UNION ALL SELECT 'ventas', COUNT(*) FROM ventas
UNION ALL SELECT 'detalle_compras', COUNT(*) FROM detalle_compras
UNION ALL SELECT 'compras', COUNT(*) FROM compras
UNION ALL SELECT 'pagos_credito', COUNT(*) FROM pagos_credito
UNION ALL SELECT 'ventas_offline_fallidas', COUNT(*) FROM ventas_offline_fallidas
UNION ALL SELECT 'movimientos_offline_fallidos', COUNT(*) FROM movimientos_offline_fallidos
UNION ALL SELECT 'movimientos_inventario', COUNT(*) FROM movimientos_inventario
UNION ALL SELECT 'stock_minimo_ubicacion', COUNT(*) FROM stock_minimo_ubicacion
UNION ALL SELECT 'cierres_caja', COUNT(*) FROM cierres_caja
UNION ALL SELECT 'lotes', COUNT(*) FROM lotes
UNION ALL SELECT 'presentaciones', COUNT(*) FROM presentaciones
UNION ALL SELECT 'productos_costos', COUNT(*) FROM productos_costos
UNION ALL SELECT 'productos', COUNT(*) FROM productos
UNION ALL SELECT 'fincas', COUNT(*) FROM fincas
UNION ALL SELECT 'clientes', COUNT(*) FROM clientes
UNION ALL SELECT 'proveedores', COUNT(*) FROM proveedores
-- Referencia: esto NO se toca, solo para que veas que sigue intacto.
UNION ALL SELECT '-- perfiles (NO SE BORRA)', COUNT(*) FROM perfiles
UNION ALL SELECT '-- ubicaciones (NO SE BORRA)', COUNT(*) FROM ubicaciones
ORDER BY tabla;
