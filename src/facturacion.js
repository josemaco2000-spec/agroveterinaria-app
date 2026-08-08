import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

// Estado Global
let ventas = []
let estadoFiltroTab = 'pendiente' // 'pendiente' o 'facturada_manual'

// 1. Guard de Autenticación (Solo Admin)
async function validarAccesoAdmin() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
        window.location.href = 'index.html'
        return
    }

    // Verificar rol admin en perfiles
    const { data: perfil, error } = await supabase
        .from('perfiles')
        .select('rol')
        .eq('id', session.user.id)
        .single()

    if (error || perfil?.rol !== 'admin') {
        window.location.href = 'pos.html'
        return
    }

    const adminEmail = document.getElementById('admin-email')
    if (adminEmail) {
        adminEmail.textContent = session.user.email
    }

    cargarVentas()
}

// 2. Cargar Registro General de Ventas
async function cargarVentas() {
    const tbody = document.getElementById('tabla-ventas')
    tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-gray-500">Cargando registro de ventas...</td></tr>'

    try {
        const { data, error } = await supabase
            .from('ventas')
            .select('*')
            .order('fecha_venta', { ascending: false })

        if (error) throw error

        ventas = data || []
        actualizarMetricas()
        renderTabla()

    } catch (err) {
        console.error("Error al cargar ventas:", err)
        tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-red-500 font-semibold">Error al cargar ventas: ${err.message}</td></tr>`
    }
}

// 3. Actualizar Tarjetas de Resumen
function actualizarMetricas() {
    const pendientes = ventas.filter(v => v.estado_factura === 'pendiente')
    const facturadas = ventas.filter(v => v.estado_factura === 'facturada_manual')

    const totalPendienteMonto = pendientes.reduce((sum, v) => sum + Number(v.total || 0), 0)
    const totalFacturadasMonto = facturadas.reduce((sum, v) => sum + Number(v.total || 0), 0)

    document.getElementById('stat-pendientes-monto').textContent = `Q${totalPendienteMonto.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    document.getElementById('stat-pendientes-count').textContent = `${pendientes.length} ventas pendientes de facturar`

    document.getElementById('stat-facturadas-monto').textContent = `Q${totalFacturadasMonto.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    document.getElementById('stat-facturadas-count').textContent = `${facturadas.length} ventas facturadas manualmente`
}

// 4. Renderizar Tabla según Pestaña y Búsqueda
function renderTabla() {
    const tbody = document.getElementById('tabla-ventas')
    const query = document.getElementById('input-busqueda')?.value.toLowerCase().trim() || ''

    // Filtrar por estado de la pestaña activa
    let listaFiltrada = ventas.filter(v => v.estado_factura === estadoFiltroTab)

    // Filtrar por término de búsqueda si existe
    if (query) {
        listaFiltrada = listaFiltrada.filter(v => {
            const shortId = v.id.substring(0, 8).toLowerCase()
            const fullId = v.id.toLowerCase()
            const numFactura = (v.numero_factura_fisica || '').toLowerCase()
            const fechaStr = new Date(v.fecha_venta).toLocaleString('es-GT').toLowerCase()

            return shortId.includes(query) || fullId.includes(query) || numFactura.includes(query) || fechaStr.includes(query)
        })
    }

    tbody.innerHTML = ''

    if (listaFiltrada.length === 0) {
        const msg = estadoFiltroTab === 'pendiente' 
            ? 'No hay ventas pendientes por facturar.' 
            : 'No hay ventas facturadas registradas.'
        tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-500 italic">${msg}</td></tr>`
        return
    }

    listaFiltrada.forEach(venta => {
        const shortId = venta.id.substring(0, 8)
        const fechaFormat = new Date(venta.fecha_venta).toLocaleString('es-GT', {
            dateStyle: 'medium',
            timeStyle: 'short'
        })

        const totalNum = Number(venta.total) || 0
        const totalFormateado = totalNum.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

        const esPendiente = venta.estado_factura === 'pendiente'
        const badgeEstado = esPendiente
            ? '<span class="inline-block bg-orange-100 text-orange-800 text-xs px-2.5 py-1 rounded-full font-bold">⏳ Pendiente</span>'
            : '<span class="inline-block bg-green-100 text-green-800 text-xs px-2.5 py-1 rounded-full font-bold">✓ Facturada</span>'

        const numFacturaDisplay = venta.numero_factura_fisica
            ? `<span class="font-mono font-bold text-gray-800 bg-gray-100 px-2 py-1 rounded">📄 ${venta.numero_factura_fisica}</span>`
            : '<span class="text-xs text-gray-400 italic">Sin registrar</span>'

        const botonFacturar = esPendiente
            ? `<button class="btn-abrir-facturar bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow transition inline-flex items-center gap-1" data-id="${venta.id}" data-total="${totalFormateado}">
                📝 Registrar Factura
               </button>`
            : `<button class="btn-abrir-facturar bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold px-3 py-1.5 rounded-lg transition inline-flex items-center gap-1" data-id="${venta.id}" data-total="${totalFormateado}" data-num="${venta.numero_factura_fisica}">
                ✏️ Editar Factura
               </button>`

        tbody.innerHTML += `
            <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
                <td class="p-4 font-mono text-xs font-bold text-gray-700">#${shortId}</td>
                <td class="p-4 text-xs font-medium text-gray-600">${fechaFormat}</td>
                <td class="p-4 font-extrabold text-green-700">Q${totalFormateado}</td>
                <td class="p-4">${badgeEstado}</td>
                <td class="p-4">${numFacturaDisplay}</td>
                <td class="p-4 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button class="btn-ver-detalle bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-lg transition inline-flex items-center gap-1" data-id="${venta.id}">
                            👁️ Detalle
                        </button>
                        ${botonFacturar}
                    </div>
                </td>
            </tr>
        `
    })

    // Event listeners para los botones de las filas
    tbody.querySelectorAll('.btn-ver-detalle').forEach(btn => {
        btn.addEventListener('click', () => {
            const ventaId = btn.getAttribute('data-id')
            abrirModalDetalle(ventaId)
        })
    })

    tbody.querySelectorAll('.btn-abrir-facturar').forEach(btn => {
        btn.addEventListener('click', () => {
            const ventaId = btn.getAttribute('data-id')
            const total = btn.getAttribute('data-total')
            const numExistente = btn.getAttribute('data-num') || ''
            abrirModalFacturar(ventaId, total, numExistente)
        })
    })
}

// 5. Control de Pestañas (Tabs)
const tabPendientes = document.getElementById('tab-pendientes')
const tabFacturadas = document.getElementById('tab-facturadas')

tabPendientes?.addEventListener('click', () => {
    estadoFiltroTab = 'pendiente'
    tabPendientes.className = 'px-5 py-2 rounded-lg text-sm font-bold transition bg-white text-gray-800 shadow-sm'
    tabFacturadas.className = 'px-5 py-2 rounded-lg text-sm font-semibold transition text-gray-500 hover:text-gray-800'
    renderTabla()
})

tabFacturadas?.addEventListener('click', () => {
    estadoFiltroTab = 'facturada_manual'
    tabFacturadas.className = 'px-5 py-2 rounded-lg text-sm font-bold transition bg-white text-gray-800 shadow-sm'
    tabPendientes.className = 'px-5 py-2 rounded-lg text-sm font-semibold transition text-gray-500 hover:text-gray-800'
    renderTabla()
})

// Buscador en vivo
document.getElementById('input-busqueda')?.addEventListener('input', renderTabla)

// 6. Modal Registrar Factura
const modalFacturar = document.getElementById('modal-facturar')
const btnCerrarFacturar = document.getElementById('btn-cerrar-modal-facturar')
const btnCerrarFacturarX = document.getElementById('btn-cerrar-modal-facturar-x')

function abrirModalFacturar(ventaId, totalFormatted, numExistente = '') {
    document.getElementById('factura-venta-id').value = ventaId
    document.getElementById('factura-venta-shortid').textContent = '#' + ventaId.substring(0, 8)
    document.getElementById('factura-venta-monto').textContent = `Q${totalFormatted}`
    
    const inputNum = document.getElementById('factura-numero')
    inputNum.value = numExistente

    modalFacturar.classList.remove('hidden')
    inputNum.focus()
}

function cerrarModalFacturar() {
    modalFacturar.classList.add('hidden')
    document.getElementById('form-factura').reset()
}

btnCerrarFacturar?.addEventListener('click', cerrarModalFacturar)
btnCerrarFacturarX?.addEventListener('click', cerrarModalFacturar)

modalFacturar?.addEventListener('click', (e) => {
    if (e.target === modalFacturar) cerrarModalFacturar()
})

// Form submit registrar factura
document.getElementById('form-factura')?.addEventListener('submit', async (e) => {
    e.preventDefault()

    const ventaId = document.getElementById('factura-venta-id').value
    const numFactura = document.getElementById('factura-numero').value.trim()

    if (!ventaId || !numFactura) return

    const btnGuardar = document.getElementById('btn-guardar-factura')
    const textoOrig = btnGuardar.textContent
    btnGuardar.textContent = 'Guardando...'
    btnGuardar.disabled = true

    try {
        const { error } = await supabase
            .from('ventas')
            .update({
                estado_factura: 'facturada_manual',
                numero_factura_fisica: numFactura
            })
            .eq('id', ventaId)

        if (error) throw error

        alert(`¡Factura física "${numFactura}" registrada con éxito!`)
        cerrarModalFacturar()
        await cargarVentas()

    } catch (err) {
        console.error("Error registrando factura:", err)
        alert("Error al guardar la factura: " + (err.message || err))
    } finally {
        btnGuardar.textContent = textoOrig
        btnGuardar.disabled = false
    }
})

// 7. Modal Ver Detalle de Venta
const modalDetalle = document.getElementById('modal-detalle')
const btnCerrarDetalle = document.getElementById('btn-cerrar-modal-detalle')
const btnCerrarDetalleX = document.getElementById('btn-cerrar-modal-detalle-x')

async function abrirModalDetalle(ventaId) {
    const venta = ventas.find(v => v.id === ventaId)
    if (!venta) return

    const shortId = venta.id.substring(0, 8)
    const fechaStr = new Date(venta.fecha_venta).toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' })
    const totalNum = Number(venta.total) || 0

    document.getElementById('detalle-venta-id').textContent = `ID: ${venta.id}`
    document.getElementById('detalle-fecha').textContent = fechaStr
    document.getElementById('detalle-estado').textContent = venta.estado_factura === 'pendiente' ? '⏳ Pendiente' : '✓ Facturada'
    document.getElementById('detalle-factura-num').textContent = venta.numero_factura_fisica || 'Sin registrar'
    document.getElementById('detalle-total').textContent = `Q${totalNum.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

    modalDetalle.classList.remove('hidden')
    await cargarDetalleItems(ventaId)
}

function cerrarModalDetalle() {
    modalDetalle.classList.add('hidden')
}

btnCerrarDetalle?.addEventListener('click', cerrarModalDetalle)
btnCerrarDetalleX?.addEventListener('click', cerrarModalDetalle)

modalDetalle?.addEventListener('click', (e) => {
    if (e.target === modalDetalle) cerrarModalDetalle()
})

async function cargarDetalleItems(ventaId) {
    const tbody = document.getElementById('tabla-detalle-items')
    tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-500">Cargando productos del ticket...</td></tr>'

    try {
        const { data: detalles, error } = await supabase
            .from('detalle_ventas')
            .select(`
                *,
                presentaciones (
                    nombre_presentacion,
                    productos (
                        nombre
                    )
                )
            `)
            .eq('venta_id', ventaId)

        if (error) throw error

        tbody.innerHTML = ''

        if (!detalles || detalles.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400 italic">No hay ítems registrados en esta venta.</td></tr>'
            return
        }

        detalles.forEach(item => {
            const pres = item.presentaciones
            const prodNombre = pres?.productos?.nombre || 'Producto'
            const presNombre = pres?.nombre_presentacion || 'Presentación'
            const subtotalNum = Number(item.subtotal) || 0
            const subtotalFormateado = subtotalNum.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

            tbody.innerHTML += `
                <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="p-3">
                        <div class="font-bold text-gray-800 text-xs">${prodNombre}</div>
                        <div class="text-xs text-green-700 font-semibold">${presNombre}</div>
                    </td>
                    <td class="p-3 text-center font-bold text-gray-700">${item.cantidad}</td>
                    <td class="p-3 text-right font-extrabold text-gray-900">Q${subtotalFormateado}</td>
                </tr>
            `
        })

    } catch (err) {
        console.error("Error al cargar detalle del ticket:", err)
        tbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-red-500">Error: ${err.message}</td></tr>`
    }
}

// Tecla Escape para modales
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!modalFacturar.classList.contains('hidden')) cerrarModalFacturar()
        if (!modalDetalle.classList.contains('hidden')) cerrarModalDetalle()
    }
})

// Logout
document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    window.location.href = 'index.html'
})

// Inicializar
validarAccesoAdmin()
