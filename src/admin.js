import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

// Estado Global
let todasLasVentas = []

// 1. Guard de Autenticación y Verificación de Rol Admin
async function validarAccesoAdmin() {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()

    if (!session) {
        window.location.href = 'index.html'
        return
    }

    const userId = session.user.id

    // Consultar perfil de administrador
    const { data: perfilData, error: perfilError } = await supabase
        .from('perfiles')
        .select('rol')
        .eq('id', userId)
        .single()

    if (perfilError || perfilData?.rol !== 'admin') {
        alert("Acceso denegado. Área exclusiva para administración.")
        window.location.href = 'pos.html'
        return
    }

    // Mostrar usuario
    const userInfoEl = document.getElementById('usuario-info')
    if (userInfoEl) {
        userInfoEl.textContent = `Conectado como: ${session.user.email}`
    }
    
    // Cargar información inicial
    await Promise.all([
        cargarVentasYGanancias(),
        cargarAlertaStockBajo()
    ])
}

// 2. Motor de Agregación de Datos de Ventas y Cálculo de Ganancias
async function cargarVentasYGanancias() {
    try {
        const { data: ventasData, error } = await supabase
            .from('ventas')
            .select(`
                *,
                detalle_ventas (
                    id,
                    cantidad,
                    subtotal,
                    presentaciones (
                        id,
                        nombre_presentacion,
                        factor_conversion,
                        precio_venta,
                        productos (
                            id,
                            nombre,
                            productos_costos (
                                precio_costo
                            )
                        )
                    )
                )
            `)
            .order('fecha_venta', { ascending: false })

        if (error) throw error

        todasLasVentas = ventasData || []
        procesarYRenderizarDashboard()

    } catch (err) {
        console.error("Error al cargar ventas y ganancias:", err)
        const tbody = document.getElementById('tabla-ventas-recientes')
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-red-500 font-semibold">Error al cargar métricas: ${err.message}</td></tr>`
        }
    }
}

// 3. Cálculo de Costo y Ganancia Neta por Venta
function calcularMétricasVenta(venta) {
    let costoTotalVenta = 0
    let cantidadItemsTotal = 0

    if (venta.detalle_ventas && Array.isArray(venta.detalle_ventas)) {
        venta.detalle_ventas.forEach(det => {
            const cant = Number(det.cantidad) || 0
            cantidadItemsTotal += cant

            const pres = det.presentaciones
            if (pres) {
                const factor = Number(pres.factor_conversion) || 1
                const prod = pres.productos
                const costoObj = Array.isArray(prod?.productos_costos) 
                    ? prod.productos_costos[0] 
                    : prod?.productos_costos
                
                const precioCostoBase = Number(costoObj?.precio_costo) || 0
                
                // Costo del renglón = cantidad_presentaciones * factor_conversion * costo_unitario_base
                const costoRenglon = cant * factor * precioCostoBase
                costoTotalVenta += costoRenglon
            }
        })
    }

    const totalVenta = Number(venta.total) || 0
    const gananciaNetaVenta = totalVenta - costoTotalVenta

    return {
        totalVenta,
        costoTotalVenta,
        gananciaNetaVenta,
        cantidadItemsTotal
    }
}

// 4. Filtrado por Rango de Fechas
function filtrarVentasPorRango(ventas, rango) {
    const ahora = new Date()
    const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())

    if (rango === 'hoy') {
        return ventas.filter(v => new Date(v.fecha_venta) >= inicioHoy)
    }
    if (rango === 'semana') {
        const hace7Dias = new Date(ahora.getTime() - (7 * 24 * 60 * 60 * 1000))
        return ventas.filter(v => new Date(v.fecha_venta) >= hace7Dias)
    }
    if (rango === 'mes') {
        const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
        return ventas.filter(v => new Date(v.fecha_venta) >= inicioMes)
    }
    return ventas // 'todo'
}

// 5. Procesar Métricas Globales y Renderizar Interfaz
function procesarYRenderizarDashboard() {
    const selectRango = document.getElementById('select-rango')
    const rangoSeleccionado = selectRango?.value || 'hoy'

    // Filtrar ventas del periodo seleccionado
    const ventasFiltradas = filtrarVentasPorRango(todasLasVentas, rangoSeleccionado)

    let acumuladoVentas = 0
    let acumuladoCostos = 0
    let acumuladoGanancia = 0

    const ventasProcesadas = ventasFiltradas.map(venta => {
        const metricas = calcularMétricasVenta(venta)
        acumuladoVentas += metricas.totalVenta
        acumuladoCostos += metricas.costoTotalVenta
        acumuladoGanancia += metricas.gananciaNetaVenta

        return {
            ...venta,
            metricas
        }
    })

    // Calcular Margen de Ganancia Neta %
    const margenPorcentaje = acumuladoVentas > 0 
        ? ((acumuladoGanancia / acumuladoVentas) * 100)
        : 0

    // Actualizar KPI 1: Ventas Totales
    document.getElementById('stat-ventas').textContent = `Q${acumuladoVentas.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    document.getElementById('stat-ventas-sub').textContent = `${ventasFiltradas.length} transacciones registradas`

    // Actualizar KPI 2: Ganancia Neta
    document.getElementById('stat-ganancia').textContent = `Q${acumuladoGanancia.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    document.getElementById('stat-ganancia-sub').textContent = `Margen Neto: ${margenPorcentaje.toFixed(1)}%`

    // Actualizar KPI 3: Facturas Pendientes (sobre todo el histórico o filtro)
    const pendientesCount = todasLasVentas.filter(v => v.estado_factura === 'pendiente').length
    document.getElementById('stat-facturas').textContent = pendientesCount
    document.getElementById('stat-facturas-sub').textContent = `${pendientesCount} pendientes de facturar SAT`

    // Actualizar Etiqueta Contador Ventas Recientes
    const countTag = document.getElementById('ventas-count-tag')
    if (countTag) {
        countTag.textContent = `${ventasFiltradas.length} ventas en periodo`
    }

    // Renderizar Tabla de Ventas Recientes
    renderTablaVentasRecientes(ventasProcesadas)
}

// 6. Renderizar Tabla de Ventas Recientes
function renderTablaVentasRecientes(ventasProcesadas) {
    const tbody = document.getElementById('tabla-ventas-recientes')
    if (!tbody) return

    tbody.innerHTML = ''

    if (ventasProcesadas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-gray-500 italic">No hay ventas registradas en este periodo.</td></tr>'
        return
    }

    // Mostrar las primeras 15 ventas del periodo
    const ultimasVentas = ventasProcesadas.slice(0, 15)

    ultimasVentas.forEach(v => {
        const shortId = v.id.substring(0, 8)
        const fechaFormat = new Date(v.fecha_venta).toLocaleString('es-GT', {
            dateStyle: 'short',
            timeStyle: 'short'
        })

        const totalForm = v.metricas.totalVenta.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const gananciaForm = v.metricas.gananciaNetaVenta.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

        const esPendiente = v.estado_factura === 'pendiente'
        const badgeEstado = esPendiente
            ? '<span class="inline-block bg-orange-100 text-orange-800 text-xs px-2.5 py-1 rounded-full font-bold">⏳ Pendiente</span>'
            : '<span class="inline-block bg-green-100 text-green-800 text-xs px-2.5 py-1 rounded-full font-bold">✓ Facturada</span>'

        tbody.innerHTML += `
            <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
                <td class="p-4 font-mono text-xs font-bold text-gray-700">#${shortId}</td>
                <td class="p-4 text-xs font-medium text-gray-600">${fechaFormat}</td>
                <td class="p-4 text-center font-bold text-gray-700">${v.metricas.cantidadItemsTotal}</td>
                <td class="p-4 font-extrabold text-gray-900">Q${totalForm}</td>
                <td class="p-4 font-extrabold text-emerald-600">Q${gananciaForm}</td>
                <td class="p-4">${badgeEstado}</td>
            </tr>
        `
    })
}

// 7. Alerta de Stock Bajo (≤ 10)
async function cargarAlertaStockBajo() {
    try {
        const { data: prodsBajos, error } = await supabase
            .from('productos')
            .select('id, nombre, stock_base, unidad_base')
            .lte('stock_base', 10)

        if (error) throw error

        const count = prodsBajos ? prodsBajos.length : 0
        document.getElementById('stat-stock').textContent = `${count} productos`
        document.getElementById('stat-stock-sub').textContent = count > 0 
            ? `${count} ítems con stock ≤ 10` 
            : 'Stock en niveles óptimos'

    } catch (err) {
        console.error("Error al cargar alerta de stock bajo:", err)
        document.getElementById('stat-stock').textContent = "0 productos"
    }
}

// Escuchar cambios en el selector de periodo
document.getElementById('select-rango')?.addEventListener('change', () => {
    procesarYRenderizarDashboard()
})

// Configurar el botón de cerrar sesión
document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    window.location.href = 'index.html'
})

// Inicializar la validación al cargar la página
validarAccesoAdmin()