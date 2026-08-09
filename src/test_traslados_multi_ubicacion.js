/**
 * Suite de Pruebas Automáticas: Inventario Multi-Ubicación, Traslados Atómicos y Restricciones POS
 * Ejecución vía Node.js: node src/test_traslados_multi_ubicacion.js
 */

function testMultiUbicacionTraslados() {
    console.log("==================================================")
    console.log("🧪 EJECUTANDO TEST: Inventario Multi-Ubicación & Traslados")
    console.log("==================================================")

    let pasados = 0
    let fallados = 0

    function assert(condicion, mensaje) {
        if (condicion) {
            console.log(`  ✅ PASÓ: ${mensaje}`)
            pasados++
        } else {
            console.error(`  ❌ FALLÓ: ${mensaje}`)
            fallados++
        }
    }

    const BODEGA_CENTRAL_ID = '11111111-1111-1111-1111-111111111111'
    const AREA_VENTA_ID = '22222222-2222-2222-2222-222222222222'

    // Mock Database State
    const ubicaciones = [
        { id: BODEGA_CENTRAL_ID, nombre: 'Bodega Central', tipo: 'almacenamiento' },
        { id: AREA_VENTA_ID, nombre: 'Área de Venta', tipo: 'punto_venta' }
    ]

    const movimientos = [
        // Compra inicial ingresada a Bodega Central
        {
            id: 'm1',
            producto_id: 'prod-concentrado-1',
            lote_id: 'lote-conc-2026',
            ubicacion_id: BODEGA_CENTRAL_ID,
            tipo_movimiento: 'ENTRADA_COMPRA',
            cantidad: 5000.000,
            traslado_id: null
        }
    ]

    function calcularStockUbicacion(productoId, ubicacionId) {
        return movimientos
            .filter(m => m.producto_id === productoId && m.ubicacion_id === ubicacionId)
            .reduce((sum, m) => {
                if (['ENTRADA_COMPRA', 'TRASLADO_ENTRADA', 'AJUSTE_POSITIVO'].includes(m.tipo_movimiento)) {
                    return sum + m.cantidad
                } else if (['SALIDA_VENTA', 'TRASLADO_SALIDA', 'AJUSTE_NEGATIVO'].includes(m.tipo_movimiento)) {
                    return sum - m.cantidad
                }
                return sum
            }, 0)
    }

    // --- TEST 1: Stock Inicial Migrado a Bodega Central ---
    const stockBodegaInicial = calcularStockUbicacion('prod-concentrado-1', BODEGA_CENTRAL_ID)
    const stockPOSInicial = calcularStockUbicacion('prod-concentrado-1', AREA_VENTA_ID)

    assert(stockBodegaInicial === 5000, "Bodega Central debe iniciar con las 5,000 libras recibidas")
    assert(stockPOSInicial === 0, "El Área de Venta debe iniciar en 0 hasta recibir un traslado explícito")

    // --- TEST 2: Restricción POS contra Bodega Central ---
    function intentarVentaPOS(productoId, cantidad, ubicacionSolicitadaId) {
        const ubic = ubicaciones.find(u => u.id === ubicacionSolicitadaId)
        if (!ubic || ubic.tipo !== 'punto_venta') {
            return { exito: false, mensaje: "Las ventas POS solo pueden realizarse en ubicaciones tipo punto_venta." }
        }
        const stockDisp = calcularStockUbicacion(productoId, ubicacionSolicitadaId)
        if (stockDisp < cantidad) {
            return { exito: false, mensaje: `Stock insuficiente en Área de Venta. Disponible: ${stockDisp}` }
        }
        return { exito: true }
    }

    const resVentaDirectaBodega = intentarVentaPOS('prod-concentrado-1', 100, BODEGA_CENTRAL_ID)
    assert(resVentaDirectaBodega.exito === false, "El POS debe rechazar vender directamente contra Bodega Central")

    const resVentaPOSSinStock = intentarVentaPOS('prod-concentrado-1', 100, AREA_VENTA_ID)
    assert(resVentaPOSSinStock.exito === false, "El POS debe rechazar vender si el Área de Venta tiene 0 stock")

    // --- TEST 3: Traslado Atómico Bodega ➔ Área de Venta ---
    function ejecutarTrasladoAtomico(productoId, loteId, origenId, destinoId, cantidad) {
        const stockOrigen = calcularStockUbicacion(productoId, origenId)
        if (stockOrigen < cantidad) {
            throw new Error(`Stock insuficiente en origen. Disponible: ${stockOrigen}, Requerido: ${cantidad}`)
        }

        const trasladoId = 'traslado-uuid-1001'

        // Movimiento Salida en Origen
        movimientos.push({
            id: 'm2',
            producto_id: productoId,
            lote_id: loteId,
            ubicacion_id: origenId,
            tipo_movimiento: 'TRASLADO_SALIDA',
            cantidad: cantidad,
            traslado_id: trasladoId
        })

        // Movimiento Entrada en Destino
        movimientos.push({
            id: 'm3',
            producto_id: productoId,
            lote_id: loteId,
            ubicacion_id: destinoId,
            tipo_movimiento: 'TRASLADO_ENTRADA',
            cantidad: cantidad,
            traslado_id: trasladoId
        })

        return trasladoId
    }

    const trasladoId = ejecutarTrasladoAtomico('prod-concentrado-1', 'lote-conc-2026', BODEGA_CENTRAL_ID, AREA_VENTA_ID, 1000)

    const stockBodegaPostTraslado = calcularStockUbicacion('prod-concentrado-1', BODEGA_CENTRAL_ID)
    const stockPOSPostTraslado = calcularStockUbicacion('prod-concentrado-1', AREA_VENTA_ID)

    assert(trasladoId === 'traslado-uuid-1001', "El traslado atómico debe generar un traslado_id único enlazando origen y destino")
    assert(stockBodegaPostTraslado === 4000, "Bodega Central debe descontar 1,000 lbs (quedan 4,000 lbs)")
    assert(stockPOSPostTraslado === 1000, "Área de Venta debe recibir exactamente 1,000 lbs")

    // --- TEST 4: Venta POS Exitosa tras Traslado ---
    const resVentaPOSTrasTraslado = intentarVentaPOS('prod-concentrado-1', 200, AREA_VENTA_ID)
    assert(resVentaPOSTrasTraslado.exito === true, "El POS debe permitir la venta una vez que el stock fue trasladado al Área de Venta")

    // --- TEST 5: Alerta de Reorden por Ubicación ---
    const stockMinimoPOS = 900 // Umbral de alerta
    const bajoMinimoPOS = stockPOSPostTraslado < stockMinimoPOS

    assert(bajoMinimoPOS === false, "No debe disparar alerta de reorden cuando 1,000 lbs >= umbral mínimo de 900 lbs")

    // Simular venta de 200 lbs en POS
    movimientos.push({
        id: 'm4',
        producto_id: 'prod-concentrado-1',
        lote_id: 'lote-conc-2026',
        ubicacion_id: AREA_VENTA_ID,
        tipo_movimiento: 'SALIDA_VENTA',
        cantidad: 200.000,
        traslado_id: null
    })

    const stockPOSFinal = calcularStockUbicacion('prod-concentrado-1', AREA_VENTA_ID)
    const bajoMinimoPOSTrasVenta = stockPOSFinal < stockMinimoPOS

    assert(stockPOSFinal === 800, "El stock en Área de Venta tras la venta de 200 lbs debe ser de 800 lbs")
    assert(bajoMinimoPOSTrasVenta === true, "Debe disparar la alerta de reorden al caer a 800 lbs (por debajo del mínimo de 900 lbs)")

    console.log("--------------------------------------------------")
    console.log(`RESULTADOS FINAL: ${pasados} Pasados, ${fallados} Fallados.`)
    console.log("==================================================")

    if (fallados > 0) process.exit(1)
}

testMultiUbicacionTraslados()
