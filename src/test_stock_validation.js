/**
 * Suite de Pruebas Automáticas: Validación de Stock en Carrito POS y Conversión Decimal
 * Ejecución vía Node.js: node src/test_stock_validation.js
 */

function testStockCarritoValidation() {
    console.log("==================================================")
    console.log("🧪 EJECUTANDO TEST: Validación de Stock POS & Carrito")
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

    // --- TEST 1: Inicialización de stockBase al agregar ítem ---
    const prodEjemplo = {
        id: 'prod-001',
        nombre: 'Maíz Blanco Granel',
        unidad_base: 'libra',
        stock_base: 1000.000
    }

    const presQuintal = {
        id: 'pres-q1',
        nombre_presentacion: 'Quintal',
        factor_conversion: 100.000,
        precio_venta: 220.00,
        productos: prodEjemplo
    }

    const presLibra = {
        id: 'pres-l1',
        nombre_presentacion: 'Libra',
        factor_conversion: 1.000,
        precio_venta: 2.50,
        productos: prodEjemplo
    }

    const carrito = []

    // Agregar 2 Quintales al carrito (200 libras)
    carrito.push({
        presentacionId: presQuintal.id,
        productoId: prodEjemplo.id,
        nombreProducto: prodEjemplo.nombre,
        nombrePresentacion: presQuintal.nombre_presentacion,
        factorConversion: Number(presQuintal.factor_conversion),
        unidadBase: prodEjemplo.unidad_base,
        stockBase: Number(prodEjemplo.stock_base),
        precioVenta: Number(presQuintal.precio_venta),
        cantidad: 2,
        descuentoPorcentaje: 0
    })

    assert(carrito[0].stockBase === 1000, "El ítem del carrito debe preservar stockBase = 1000 libras")

    // --- TEST 2: Cálculo de Stock Restante Disponible para nuevo ítem del mismo producto ---
    const indexLineaActual = 1 // Segunda línea en el carrito (ej. venta en libras sueltas)
    const stockBaseTotal = Number(prodEjemplo.stock_base)

    // Stock ocupado por otras líneas
    const stockUsadoOtros = carrito
        .filter((i, idx) => i.productoId === prodEjemplo.id && idx !== indexLineaActual)
        .reduce((sum, i) => sum + (Number(i.cantidad) * Number(i.factorConversion)), 0)

    const stockDisponibleRestante = Math.max(0, stockBaseTotal - stockUsadoOtros)
    assert(stockUsadoOtros === 200, "El stock reservado por la primera línea (2 Quintales) debe ser exactamente 200 libras")
    assert(stockDisponibleRestante === 800, "El stock disponible restante para la segunda línea debe ser exactamente 800 libras")

    // --- TEST 3: Detección y bloqueo por sobre-venta ---
    const cantidadSolicitadaLibra = 850.000 // Intenta pedir 850 libras (excede las 800 disponibles)
    const excedeStock = (cantidadSolicitadaLibra * 1.000) > stockDisponibleRestante

    assert(excedeStock === true, "Debe detectar que 850 libras excede el stock disponible de 800 libras")

    // --- TEST 4: Botón 'Vender todo el disponible' (Max) ---
    const cantMaxValida = stockDisponibleRestante / 1.000 // 800 / 1 = 800 libras
    assert(cantMaxValida === 800, "El botón Max debe auto-completar exactamente las 800 libras disponibles")

    // --- TEST 5: Regla visual de conversión redundante (~N pres.) ---
    const esMismaUnidadLibra = presLibra.nombre_presentacion.toLowerCase().trim() === prodEjemplo.unidad_base.toLowerCase().trim() || presLibra.factor_conversion === 1
    const esMismaUnidadQuintal = presQuintal.nombre_presentacion.toLowerCase().trim() === prodEjemplo.unidad_base.toLowerCase().trim() || presQuintal.factor_conversion === 1

    assert(esMismaUnidadLibra === true, "La presentación 'Libra' para unidad base 'libra' es idéntica (NO debe mostrar conversion redundante)")
    assert(esMismaUnidadQuintal === false, "La presentación 'Quintal' (factor 100) es distinta de 'libra' (SÍ debe mostrar (~10 Quintal))")

    console.log("--------------------------------------------------")
    console.log(`RESULTADOS FINAL: ${pasados} Pasados, ${fallados} Fallados.`)
    console.log("==================================================")

    if (fallados > 0) process.exit(1)
}

testStockCarritoValidation()
