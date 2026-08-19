import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

// Estado Global
let todasLasVentas = []
let todasLasCompras = []

// 1. Guard de Autenticación y Verificación de Rol Admin
async function validarAccesoAdmin() {
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
        window.location.href = 'index.html'
        return
    }

    const userId = session.user.id

    // Consultar perfil de administrador
    const { data: perfilData, error: perfilError } = await supabase
        .from('perfiles')
        .select('rol, nombre_completo')
        .eq('id', userId)
        .single()

    if (perfilError || perfilData?.rol !== 'admin') {
        alert("Acceso denegado. Área exclusiva para administración.")
        window.location.href = 'pos.html'
        return
    }

    // Mostrar nombre del usuario e iniciales
    const nombreUsuario = perfilData?.nombre_completo || session.user.email || 'Usuario'
    const userInfoEl = document.getElementById('usuario-info') || document.getElementById('user-email') || document.getElementById('admin-email')
    if (userInfoEl) userInfoEl.textContent = nombreUsuario

    const avatarInitialsEl = document.getElementById('user-avatar-initials')
    if (avatarInitialsEl && nombreUsuario) {
        const partes = nombreUsuario.trim().split(' ')
        const iniciales = partes.length >= 2
            ? (partes[0][0] + partes[1][0]).toUpperCase()
            : nombreUsuario.substring(0, 2).toUpperCase()
        avatarInitialsEl.textContent = iniciales
    }

    // Cargar información inicial de Ventas, Compras y Stock
    await Promise.all([
        cargarVentasYGanancias(),
        cargarCompras(),
        cargarAlertaStockBajo()
    ])
}

// 2. Cargar Ventas
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
                    costo_unitario,
                    presentaciones (
                        id,
                        nombre_presentacion,
                        factor_conversion,
                        precio_venta,
                        productos (
                            id,
                            nombre,
                            es_afecto_iva,
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
        console.error("Error al cargar ventas:", err)
    }
}

// 3. Cargar Compras
async function cargarCompras() {
    try {
        const { data: comprasData, error } = await supabase
            .from('compras')
            .select(`
                *,
                proveedores (
                    nombre,
                    nit
                )
            `)
            .order('created_at', { ascending: false })

        if (!error && comprasData) {
            todasLasCompras = comprasData
            procesarYRenderizarDashboard()
        }
    } catch (err) {
        console.warn("Módulo de compras:", err)
    }
}

// 4. Cálculo de Costo y Ganancia Neta por Venta con Snapshot
function calcularMetricasVenta(venta) {
    let costoTotalVenta = 0
    let cantidadItemsTotal = 0
    let subtotalAfectoIva = 0

    if (venta.detalle_ventas && Array.isArray(venta.detalle_ventas)) {
        venta.detalle_ventas.forEach(det => {
            const cant = Number(det.cantidad) || 0
            const subtotalRenglon = Number(det.subtotal) || 0
            cantidadItemsTotal += cant

            const pres = det.presentaciones
            const prod = pres?.productos
            const esAfecto = prod?.es_afecto_iva !== false

            if (esAfecto) {
                subtotalAfectoIva += subtotalRenglon
            }

            // Snapshot histórico si existe en detalle_ventas
            if (det.costo_unitario !== undefined && det.costo_unitario !== null && Number(det.costo_unitario) > 0) {
                costoTotalVenta += (cant * Number(det.costo_unitario))
            } else if (pres) {
                const factor = Number(pres.factor_conversion) || 1
                const costoObj = Array.isArray(prod?.productos_costos)
                    ? prod.productos_costos[0]
                    : prod?.productos_costos
                const precioCostoBase = Number(costoObj?.precio_costo) || 0
                costoTotalVenta += (cant * factor * precioCostoBase)
            }
        })
    }

    const totalVenta = Number(venta.total) || 0
    const gananciaNetaVenta = totalVenta - costoTotalVenta

    return {
        totalVenta,
        costoTotalVenta,
        gananciaNetaVenta,
        cantidadItemsTotal,
        subtotalAfectoIva
    }
}

// 5. Filtrado por Rango de Fechas
function filtrarPorRango(items, campoFecha, rango) {
    const ahora = new Date()
    const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())

    if (rango === 'hoy') {
        return items.filter(v => new Date(v[campoFecha]) >= inicioHoy)
    }
    if (rango === 'semana') {
        const hace7Dias = new Date(ahora.getTime() - (7 * 24 * 60 * 60 * 1000))
        return items.filter(v => new Date(v[campoFecha]) >= hace7Dias)
    }
    if (rango === 'mes') {
        const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
        return items.filter(v => new Date(v[campoFecha]) >= inicioMes)
    }
    return items
}

// 6. Procesar Métricas Globales y Renderizar Interfaz
function procesarYRenderizarDashboard() {
    const selectRango = document.getElementById('select-rango')
    const rangoSeleccionado = selectRango?.value || 'hoy'

    const ventasFiltradas = filtrarPorRango(todasLasVentas, 'fecha_venta', rangoSeleccionado)
    const comprasFiltradas = filtrarPorRango(todasLasCompras, 'created_at', rangoSeleccionado)

    let acumuladoVentas = 0
    let acumuladoCostos = 0
    let acumuladoGanancia = 0
    let acumuladoVentasAfectas = 0

    const ventasProcesadas = ventasFiltradas.map(venta => {
        const metricas = calcularMetricasVenta(venta)
        acumuladoVentas += metricas.totalVenta
        acumuladoCostos += metricas.costoTotalVenta
        acumuladoGanancia += metricas.gananciaNetaVenta
        acumuladoVentasAfectas += metricas.subtotalAfectoIva

        return {
            ...venta,
            metricas
        }
    })

    const margenPorcentaje = acumuladoVentas > 0
        ? ((acumuladoGanancia / acumuladoVentas) * 100)
        : 0

    // KPI Header Cards
    const statVentasEl = document.getElementById('stat-ventas')
    const statVentasSubEl = document.getElementById('stat-ventas-sub')
    const statGananciaEl = document.getElementById('stat-ganancia')
    const statGananciaSubEl = document.getElementById('stat-ganancia-sub')
    const statFacturasEl = document.getElementById('stat-facturas')
    const statFacturasSubEl = document.getElementById('stat-facturas-sub')

    if (statVentasEl) statVentasEl.textContent = `Q${acumuladoVentas.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    if (statVentasSubEl) statVentasSubEl.textContent = `${ventasFiltradas.length} transacciones registradas`

    if (statGananciaEl) statGananciaEl.textContent = `Q${acumuladoGanancia.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    if (statGananciaSubEl) statGananciaSubEl.textContent = `Margen Neto: ${margenPorcentaje.toFixed(1)}%`

    const pendientesCount = todasLasVentas.filter(v => v.estado_factura === 'pendiente').length
    if (statFacturasEl) statFacturasEl.textContent = pendientesCount
    if (statFacturasSubEl) statFacturasSubEl.textContent = `${pendientesCount} pendientes de facturar SAT`

    const countTag = document.getElementById('ventas-count-tag')
    if (countTag) countTag.textContent = `${ventasFiltradas.length} ventas en periodo`

    // --- VISTA 1: GANANCIAS REALES ---
    const elGanVentas = document.getElementById('rep-ganancias-ventas')
    const elGanCostos = document.getElementById('rep-ganancias-costos')
    const elGanUtilidad = document.getElementById('rep-ganancias-utilidad')
    if (elGanVentas) elGanVentas.textContent = `Q${acumuladoVentas.toFixed(2)}`
    if (elGanCostos) elGanCostos.textContent = `Q${acumuladoCostos.toFixed(2)}`
    if (elGanUtilidad) elGanUtilidad.textContent = `Q${acumuladoGanancia.toFixed(2)} (${margenPorcentaje.toFixed(1)}%)`

    // --- VISTA 2: COMPRAS & SURTIDO ---
    let totalCompras = 0
    comprasFiltradas.forEach(c => { totalCompras += (Number(c.total) || 0) })
    const baseCompras = totalCompras / 1.12
    const creditoFiscalIVA = totalCompras - baseCompras

    const elCompTotal = document.getElementById('rep-compras-total')
    const elCompCount = document.getElementById('rep-compras-count')
    const elCompCredito = document.getElementById('rep-compras-credito')
    const elCompBase = document.getElementById('rep-compras-base')

    if (elCompTotal) elCompTotal.textContent = `Q${totalCompras.toFixed(2)}`
    if (elCompCount) elCompCount.textContent = `${comprasFiltradas.length} órdenes de abastecimiento`
    if (elCompCredito) elCompCredito.textContent = `Q${creditoFiscalIVA.toFixed(2)}`
    if (elCompBase) elCompBase.textContent = `Q${baseCompras.toFixed(2)}`

    renderTablaCompras(comprasFiltradas)

    // --- VISTA 3: IMPUESTOS SAT GT (DÉBITO vs CRÉDITO FISCAL) ---
    const baseVentasAfectas = acumuladoVentasAfectas / 1.12
    const debitoFiscalIVA = acumuladoVentasAfectas - baseVentasAfectas
    const ivaNetoPagar = debitoFiscalIVA - creditoFiscalIVA

    const elDebito = document.getElementById('sat-debito-fiscal')
    const elCredito = document.getElementById('sat-credito-fiscal')
    const elIvaNeto = document.getElementById('sat-iva-neto')
    const elIvaEstado = document.getElementById('sat-iva-estado')
    const elExplicacion = document.getElementById('sat-explicacion-contador')

    if (elDebito) elDebito.textContent = `Q${debitoFiscalIVA.toFixed(2)}`
    if (elCredito) elCredito.textContent = `Q${creditoFiscalIVA.toFixed(2)}`

    if (elIvaNeto) {
        if (ivaNetoPagar >= 0) {
            elIvaNeto.textContent = `Q${ivaNetoPagar.toFixed(2)}`
            elIvaNeto.className = "text-2xl font-extrabold text-amber-600 dark:text-amber-400"
            if (elIvaEstado) elIvaEstado.textContent = "Débito Fiscal − Crédito Fiscal (Impuesto Estimado a Pagar)"
            if (elExplicacion) {
                elExplicacion.innerHTML = `En el período seleccionado, el <strong>Débito Fiscal</strong> generado por ventas afectas (Q${debitoFiscalIVA.toFixed(2)}) supera al <strong>Crédito Fiscal</strong> de compras registradas (Q${creditoFiscalIVA.toFixed(2)}). El monto a declarar y pagar ante SAT se calcula en <strong>Q${ivaNetoPagar.toFixed(2)}</strong>.`
            }
        } else {
            const remanente = Math.abs(ivaNetoPagar)
            elIvaNeto.textContent = `Q${remanente.toFixed(2)} (A Favor)`
            elIvaNeto.className = "text-2xl font-extrabold text-emerald-600 dark:text-emerald-400"
            if (elIvaEstado) elIvaEstado.textContent = "Crédito Fiscal Excedente (Saldo a Favor)"
            if (elExplicacion) {
                elExplicacion.innerHTML = `En el período seleccionado, el <strong>Crédito Fiscal</strong> por compras de insumos (Q${creditoFiscalIVA.toFixed(2)}) es mayor al Débito Fiscal de ventas (Q${debitoFiscalIVA.toFixed(2)}). Se acumula un <strong>remanente de Crédito Fiscal a favor de Q${remanente.toFixed(2)}</strong> para compensación en el siguiente mes.`
            }
        }
    }

    renderTablaVentasRecientes(ventasProcesadas)
}

function renderTablaCompras(compras) {
    const tbody = document.getElementById('tabla-reporte-compras')
    if (!tbody) return

    tbody.innerHTML = ''
    if (compras.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-400">Sin compras registradas en este período</td></tr>'
        return
    }

    compras.forEach(c => {
        const fechaFormat = new Date(c.created_at).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })
        const provNombre = c.proveedores?.nombre || 'Proveedor General'
        const totalNum = Number(c.total) || 0
        const creditoIva = totalNum - (totalNum / 1.12)

        tbody.innerHTML += `
            <tr class="hover:bg-slate-100 dark:hover:bg-forest-950/60 transition">
                <td class="p-3 text-slate-400">${fechaFormat}</td>
                <td class="p-3 font-bold text-slate-200">${provNombre}</td>
                <td class="p-3 font-mono text-emerald-400">${c.no_comprobante || 'S/N'}</td>
                <td class="p-3 text-right font-extrabold text-blue-400">Q${totalNum.toFixed(2)}</td>
                <td class="p-3 text-right font-bold text-teal-400">Q${creditoIva.toFixed(2)}</td>
            </tr>
        `
    })
}

// 7. Renderizar Tabla de Ventas Recientes
function renderTablaVentasRecientes(ventasProcesadas) {
    const tbody = document.getElementById('tabla-ventas-recientes')
    if (!tbody) return

    tbody.innerHTML = ''

    if (ventasProcesadas.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="p-0">
                    <div class="py-14 px-6 rounded-3xl bg-forest-950/40 border border-dashed border-emerald-500/20 text-center flex flex-col items-center justify-center my-2 animate-fade-in">
                        <h3 class="text-base font-bold text-white mb-1 tracking-wide">Sin Ventas Registradas</h3>
                        <p class="text-xs text-slate-400 max-w-sm mb-6 leading-relaxed">
                            No se encontraron transacciones para el periodo seleccionado.
                        </p>
                    </div>
                </td>
            </tr>
        `
        return
    }

    const ultimasVentas = ventasProcesadas.slice(0, 15)

    ultimasVentas.forEach(v => {
        const shortId = v.id.substring(0, 8)
        const fechaFormat = new Date(v.fecha_venta).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })
        const totalForm = v.metricas.totalVenta.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const gananciaForm = v.metricas.gananciaNetaVenta.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

        const esPendiente = v.estado_factura === 'pendiente'
        const badgeEstado = esPendiente
            ? '<span class="inline-flex items-center gap-1 bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[11px] px-3 py-1 rounded-full font-bold">⏳ Pendiente SAT</span>'
            : '<span class="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[11px] px-3 py-1 rounded-full font-bold">✓ Facturada</span>'

        tbody.innerHTML += `
            <tr class="glass-panel glass-panel-hover rounded-2xl transition-all duration-200 shadow-sm text-slate-200 group">
                <td class="py-4 pl-6 font-mono text-xs font-bold text-emerald-400 group-hover:text-emerald-300">#${shortId}</td>
                <td class="py-4 text-xs font-medium text-slate-300">${fechaFormat}</td>
                <td class="py-4 text-center">
                    <span class="px-2.5 py-1 rounded-full text-xs font-bold bg-forest-950/80 text-slate-200 border border-slate-700">
                        ${v.metricas.cantidadItemsTotal}
                    </span>
                </td>
                <td class="py-4 font-extrabold text-amber-400 text-base tracking-tight">Q${totalForm}</td>
                <td class="py-4 font-extrabold text-violet-400 text-base tracking-tight">Q${gananciaForm}</td>
                <td class="py-4 pr-6">${badgeEstado}</td>
            </tr>
        `
    })
}

// 8. Alerta de Stock Bajo (≤ 10)
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

// 9. Manejo de Sub-Vistas Financieras
const btnGanancias = document.getElementById('btn-vista-ganancias')
const btnCompras = document.getElementById('btn-vista-compras')
const btnImpuestos = document.getElementById('btn-vista-impuestos')

const vGanancias = document.getElementById('vista-container-ganancias')
const vCompras = document.getElementById('vista-container-compras')
const vImpuestos = document.getElementById('vista-container-impuestos')

function cambiarVistaFinanciera(vista) {
    const btnGanancias = document.getElementById('btn-vista-ganancias');
    const btnCompras = document.getElementById('btn-vista-compras');
    const btnImpuestos = document.getElementById('btn-vista-impuestos');

    const vGanancias = document.getElementById('vista-container-ganancias');
    const vCompras = document.getElementById('vista-container-compras');
    const vImpuestos = document.getElementById('vista-container-impuestos');

    const botones = [btnGanancias, btnCompras, btnImpuestos].filter(Boolean);
    const vistas = [vGanancias, vCompras, vImpuestos].filter(Boolean);

    // Resetear estilos de todos los botones y ocultar todas las vistas
    botones.forEach(b => {
        b.classList.remove('bg-emerald-600', 'text-white', 'shadow-md');
        b.classList.add('text-slate-400');
    });
    vistas.forEach(v => v.classList.add('hidden'));

    // Activar la vista y estilo del botón seleccionado
    if (vista === 'ganancias') {
        btnGanancias?.classList.add('bg-emerald-600', 'text-white', 'shadow-md');
        btnGanancias?.classList.remove('text-slate-400');
        vGanancias?.classList.remove('hidden');
    } else if (vista === 'compras') {
        btnCompras?.classList.add('bg-emerald-600', 'text-white', 'shadow-md');
        btnCompras?.classList.remove('text-slate-400');
        vCompras?.classList.remove('hidden');
    } else if (vista === 'impuestos') {
        btnImpuestos?.classList.add('bg-emerald-600', 'text-white', 'shadow-md');
        btnImpuestos?.classList.remove('text-slate-400');
        vImpuestos?.classList.remove('hidden');
    }
}

// Event listeners asignados con los IDs exactos del HTML
document.getElementById('btn-vista-ganancias')?.addEventListener('click', () => cambiarVistaFinanciera('ganancias'));
document.getElementById('btn-vista-compras')?.addEventListener('click', () => cambiarVistaFinanciera('compras'));
document.getElementById('btn-vista-impuestos')?.addEventListener('click', () => cambiarVistaFinanciera('impuestos'));

// Listeners con captura segura
document.getElementById('btnGanancias')?.addEventListener('click', () => cambiarVistaFinanciera('ganancias'));
document.getElementById('btnCompras')?.addEventListener('click', () => cambiarVistaFinanciera('compras'));
document.getElementById('btnImpuestos')?.addEventListener('click', () => cambiarVistaFinanciera('impuestos'));
// Globalizar funciones
window.procesarYRenderizarDashboard = procesarYRenderizarDashboard

// Listeners globales
document.getElementById('select-rango')?.addEventListener('change', () => {
    procesarYRenderizarDashboard()
})

document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    window.location.href = 'index.html'
})

// Inicializar la validación al cargar la página
validarAccesoAdmin()