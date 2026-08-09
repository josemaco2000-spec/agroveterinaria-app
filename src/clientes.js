import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

// Estado Global
let todosLosClientes = []
let clienteSeleccionadoId = null
let pestanaActivaDetalle = 'fincas'

// 1. Guard de Autenticación
async function validarSesion() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
        window.location.href = 'index.html'
        return
    }

    const { data: perfil } = await supabase
        .from('perfiles')
        .select('nombre_completo')
        .eq('id', session.user.id)
        .single()

    const nombreUsuario = perfil?.nombre_completo || session.user.email
    const userEmail = document.getElementById('user-email') || document.getElementById('usuario-info') || document.getElementById('admin-email') || document.getElementById('cajero-email')
    if (userEmail) {
        userEmail.textContent = nombreUsuario
    }

    cargarClientes()
}

// 2. Cargar Lista General de Clientes
async function cargarClientes() {
    const listaEl = document.getElementById('lista-clientes')
    const countEl = document.getElementById('clientes-count')
    const selectAbono = document.getElementById('abono-cliente-id')

    listaEl.innerHTML = '<div class="text-center py-12 text-gray-500 text-sm">Cargando directorio de clientes...</div>'

    try {
        const { data: clientes, error } = await supabase
            .from('clientes')
            .select('*')
            .order('nombre', { ascending: true })

        if (error) throw error

        todosLosClientes = clientes || []
        if (countEl) countEl.textContent = todosLosClientes.length

        // Poblar Select Modal Abono
        if (selectAbono) {
            selectAbono.innerHTML = '<option value="">Selecciona un cliente...</option>'
            todosLosClientes.forEach(cli => {
                const opt = document.createElement('option')
                opt.value = cli.id
                opt.textContent = `${cli.nombre} (NIT: ${cli.nit || 'CF'}) - Saldo: Q${Number(cli.saldo_actual).toFixed(2)}`
                selectAbono.appendChild(opt)
            })
        }

        renderListaClientes(todosLosClientes)

    } catch (err) {
        console.error("Error al cargar clientes:", err)
        listaEl.innerHTML = `<div class="text-center py-12 text-red-500 text-sm font-semibold">Error: ${err.message}</div>`
    }
}

// Renderizar la lista lateral de clientes
function renderListaClientes(list) {
    const listaEl = document.getElementById('lista-clientes')
    const query = document.getElementById('input-busqueda-cliente')?.value.toLowerCase().trim() || ''

    let filtrados = list
    if (query) {
        filtrados = list.filter(c => 
            c.nombre.toLowerCase().includes(query) || 
            (c.nit || '').toLowerCase().includes(query) || 
            (c.telefono || '').toLowerCase().includes(query)
        )
    }

    listaEl.innerHTML = ''
    if (filtrados.length === 0) {
        listaEl.innerHTML = `
            <div class="py-12 px-6 rounded-3xl bg-forest-950/40 border border-dashed border-emerald-500/20 text-center flex flex-col items-center justify-center my-2">
                <svg class="w-12 h-12 text-slate-400 dark:text-slate-500 mb-3 stroke-[1.2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path>
                </svg>
                <p class="text-xs text-slate-400 dark:text-slate-500 font-medium">No se encontraron clientes.</p>
            </div>`
        return
    }

    filtrados.forEach(cli => {
        const esSeleccionado = cli.id === clienteSeleccionadoId
        const saldo = Number(cli.saldo_actual) || 0
        const limite = Number(cli.limite_credito) || 0

        const saldoFmt = saldo.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const limiteFmt = limite.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

        const tieneDeuda = saldo > 0
        const badgeDeuda = tieneDeuda
            ? `<span class="text-xs font-extrabold text-rose-600 dark:text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-lg border border-rose-500/20">Saldo: Q${saldoFmt}</span>`
            : `<span class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">Al día (Q0.00)</span>`

        const activeClass = esSeleccionado
            ? 'glass-panel border-l-4 border-emerald-500 bg-emerald-500/10 text-emerald-400 font-bold shadow-md'
            : 'glass-card glass-panel-hover text-slate-800 dark:text-slate-200'

        listaEl.innerHTML += `
            <div class="p-3.5 rounded-2xl transition cursor-pointer shadow-sm ${activeClass} btn-seleccionar-cliente" data-id="${cli.id}">
                <div class="flex justify-between items-start mb-1">
                    <h3 class="font-bold text-slate-900 dark:text-white text-sm leading-snug truncate pr-2">${cli.nombre}</h3>
                    <span class="text-[10px] font-mono text-slate-400 dark:text-slate-400 bg-forest-950/80 border border-emerald-500/20 px-1.5 py-0.5 rounded-md">NIT: ${cli.nit || 'CF'}</span>
                </div>
                <div class="text-xs text-slate-600 dark:text-slate-300 mb-2">
                    <span>📞 ${cli.telefono || 'Sin teléfono'}</span>
                </div>
                <div class="flex justify-between items-center pt-1 border-t border-emerald-500/10">
                    <span class="text-[11px] text-slate-500 dark:text-slate-400">Límite: Q${limiteFmt}</span>
                    ${badgeDeuda}
                </div>
            </div>
        `
    })

    listaEl.querySelectorAll('.btn-seleccionar-cliente').forEach(el => {
        el.addEventListener('click', () => {
            const cliId = el.getAttribute('data-id')
            seleccionarCliente(cliId)
        })
    })
}

// Búsqueda en vivo
document.getElementById('input-busqueda-cliente')?.addEventListener('input', () => {
    renderListaClientes(todosLosClientes)
})

// 3. Seleccionar Cliente y Cargar Vista Detallada
async function seleccionarCliente(clienteId) {
    clienteSeleccionadoId = clienteId
    renderListaClientes(todosLosClientes)

    const cliente = todosLosClientes.find(c => c.id === clienteId)
    if (!cliente) return

    const vistaDetalle = document.getElementById('vista-detalle-cliente')

    const saldo = Number(cliente.saldo_actual) || 0
    const limite = Number(cliente.limite_credito) || 0
    const saldoFmt = saldo.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const limiteFmt = limite.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    // Calcular Gauge de Crédito
    const pctUsado = limite > 0 ? Math.min(100, Math.round((saldo / limite) * 100)) : 0
    let colorBarra = 'bg-emerald-500'
    if (pctUsado > 85) colorBarra = 'bg-rose-500'
    else if (pctUsado > 50) colorBarra = 'bg-amber-500'

    vistaDetalle.innerHTML = `
        <!-- Encabezado del Cliente Seleccionado -->
        <div class="glass-panel p-5 rounded-3xl border border-emerald-500/20 mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-xl">
            <div>
                <div class="flex items-center gap-2 mb-1">
                    <h2 class="text-2xl font-extrabold text-slate-900 dark:text-white">${cliente.nombre}</h2>
                    <span class="text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold px-2 py-0.5 rounded-lg">NIT: ${cliente.nit || 'CF'}</span>
                </div>
                <div class="text-xs text-slate-700 dark:text-slate-300 space-x-3">
                    <span>📞 <strong>${cliente.telefono || 'Sin registrar'}</strong></span>
                    <span>📍 <strong>${cliente.direccion || 'Fray Bartolomé de las Casas'}</strong></span>
                </div>
            </div>

            <!-- Gauge de Crédito -->
            <div class="w-full sm:w-64 glass-card p-3 rounded-2xl border border-emerald-500/20 shadow-sm shrink-0">
                <div class="flex justify-between text-xs font-bold text-gray-700 mb-1">
                    <span>Saldo: Q${saldoFmt}</span>
                    <span>Límite: Q${limiteFmt}</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div class="${colorBarra} h-3 rounded-full transition-all duration-300" style="width: ${pctUsado}%"></div>
                </div>
                <span class="text-[10px] text-gray-400 font-semibold block text-right mt-1">${pctUsado}% del crédito utilizado</span>
            </div>
        </div>

        <!-- Botones de Pestañas -->
        <div class="flex border-b border-gray-200 mb-4 gap-2">
            <button id="tab-btn-fincas" class="py-2.5 px-4 font-bold text-sm border-b-2 transition ${pestanaActivaDetalle === 'fincas' ? 'border-green-700 text-green-800 bg-green-50/50 rounded-t-lg' : 'border-transparent text-gray-500 hover:text-gray-800'}">
                🏡 Fincas Registradas
            </button>
            <button id="tab-btn-compras" class="py-2.5 px-4 font-bold text-sm border-b-2 transition ${pestanaActivaDetalle === 'compras' ? 'border-green-700 text-green-800 bg-green-50/50 rounded-t-lg' : 'border-transparent text-gray-500 hover:text-gray-800'}">
                🧾 Historial de Ventas
            </button>
            <button id="tab-btn-abonos" class="py-2.5 px-4 font-bold text-sm border-b-2 transition ${pestanaActivaDetalle === 'abonos' ? 'border-green-700 text-green-800 bg-green-50/50 rounded-t-lg' : 'border-transparent text-gray-500 hover:text-gray-800'}">
                💵 Historial de Abonos
            </button>
        </div>

        <!-- Contenedor Dinámico de la Pestaña -->
        <div id="contenido-pestana-detalle" class="flex-1">
            Cargando información...
        </div>
    `

    // Asignar Eventos a las Pestañas
    document.getElementById('tab-btn-fincas')?.addEventListener('click', () => {
        pestanaActivaDetalle = 'fincas'
        seleccionarCliente(clienteId)
    })
    document.getElementById('tab-btn-compras')?.addEventListener('click', () => {
        pestanaActivaDetalle = 'compras'
        seleccionarCliente(clienteId)
    })
    document.getElementById('tab-btn-abonos')?.addEventListener('click', () => {
        pestanaActivaDetalle = 'abonos'
        seleccionarCliente(clienteId)
    })

    // Cargar Contenido según Pestaña
    if (pestanaActivaDetalle === 'fincas') {
        await cargarFincasCliente(clienteId)
    } else if (pestanaActivaDetalle === 'compras') {
        await cargarComprasCliente(clienteId)
    } else if (pestanaActivaDetalle === 'abonos') {
        await cargarAbonosCliente(clienteId)
    }
}

// 4. Tab 1: Cargar Fincas del Cliente
async function cargarFincasCliente(clienteId) {
    const contenedor = document.getElementById('contenido-pestana-detalle')
    contenedor.innerHTML = `
        <div class="flex justify-between items-center mb-3">
            <h3 class="text-xs font-bold uppercase tracking-wider text-gray-500">Perfiles Ganaderos / Agrícolas</h3>
            <button id="btn-nueva-finca" class="bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-1.5 px-3 rounded-lg shadow transition flex items-center gap-1">
                <span>+ Agregar Finca</span>
            </button>
        </div>

        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table class="w-full text-left border-collapse text-xs">
                <thead class="bg-gray-100 text-gray-600 uppercase tracking-wider border-b border-gray-200">
                    <tr>
                        <th class="p-3 font-semibold">Nombre de la Finca</th>
                        <th class="p-3 font-semibold">Ubicación</th>
                        <th class="p-3 font-semibold">Tipo Explotación</th>
                        <th class="p-3 font-semibold text-right">Tamaño</th>
                    </tr>
                </thead>
                <tbody id="tabla-fincas-body" class="divide-y divide-gray-100">
                    <tr><td colspan="4" class="p-4 text-center text-gray-400">Cargando fincas...</td></tr>
                </tbody>
            </table>
        </div>
    `

    document.getElementById('btn-nueva-finca')?.addEventListener('click', () => {
        abrirModalFinca(clienteId)
    })

    try {
        const { data: fincas, error } = await supabase
            .from('fincas')
            .select('*')
            .eq('cliente_id', clienteId)
            .order('created_at', { ascending: false })

        if (error) throw error

        const tbody = document.getElementById('tabla-fincas-body')
        tbody.innerHTML = ''

        if (!fincas || fincas.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-400 italic">Este cliente no tiene fincas registradas aún.</td></tr>'
            return
        }

        fincas.forEach(f => {
            tbody.innerHTML += `
                <tr class="hover:bg-gray-50">
                    <td class="p-3 font-bold text-gray-800">🏡 ${f.nombre_finca}</td>
                    <td class="p-3 text-gray-600">${f.ubicacion || 'Sin datos'}</td>
                    <td class="p-3">
                        <span class="inline-block bg-green-100 text-green-800 text-[10px] font-bold px-2 py-0.5 rounded">${f.tipo_explotacion || 'General'}</span>
                    </td>
                    <td class="p-3 text-right font-mono text-gray-700">${f.tamano_hectareas || 0} Mz/Ha</td>
                </tr>
            `
        })
    } catch (err) {
        console.error("Error al cargar fincas:", err)
    }
}

// 5. Tab 2: Cargar Compras del Cliente
async function cargarComprasCliente(clienteId) {
    const contenedor = document.getElementById('contenido-pestana-detalle')
    contenedor.innerHTML = `
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table class="w-full text-left border-collapse text-xs">
                <thead class="bg-gray-100 text-gray-600 uppercase tracking-wider border-b border-gray-200">
                    <tr>
                        <th class="p-3 font-semibold">ID Venta</th>
                        <th class="p-3 font-semibold">Fecha / Hora</th>
                        <th class="p-3 font-semibold">Estado Factura</th>
                        <th class="p-3 font-semibold text-right">Total</th>
                    </tr>
                </thead>
                <tbody id="tabla-compras-body" class="divide-y divide-gray-100">
                    <tr><td colspan="4" class="p-4 text-center text-gray-400">Cargando ventas...</td></tr>
                </tbody>
            </table>
        </div>
    `

    try {
        const { data: ventas, error } = await supabase
            .from('ventas')
            .select('*')
            .order('fecha_venta', { ascending: false })
            .limit(20)

        if (error) throw error

        const tbody = document.getElementById('tabla-compras-body')
        tbody.innerHTML = ''

        if (!ventas || ventas.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-400 italic">No hay ventas registradas.</td></tr>'
            return
        }

        ventas.forEach(v => {
            const fechaStr = new Date(v.fecha_venta).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })
            const totalFmt = (Number(v.total) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

            tbody.innerHTML += `
                <tr class="hover:bg-gray-50">
                    <td class="p-3 font-mono font-bold text-gray-700">#${v.id.substring(0, 8)}</td>
                    <td class="p-3 text-gray-600">${fechaStr}</td>
                    <td class="p-3">
                        <span class="inline-block bg-gray-100 text-gray-700 text-[10px] font-bold px-2 py-0.5 rounded">${v.estado_factura}</span>
                    </td>
                    <td class="p-3 text-right font-extrabold text-green-700">Q${totalFmt}</td>
                </tr>
            `
        })
    } catch (err) {
        console.error("Error cargando ventas:", err)
    }
}

// 6. Tab 3: Cargar Abonos del Cliente
async function cargarAbonosCliente(clienteId) {
    const contenedor = document.getElementById('contenido-pestana-detalle')
    contenedor.innerHTML = `
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table class="w-full text-left border-collapse text-xs">
                <thead class="bg-gray-100 text-gray-600 uppercase tracking-wider border-b border-gray-200">
                    <tr>
                        <th class="p-3 font-semibold">Fecha / Hora</th>
                        <th class="p-3 font-semibold">Método Pago</th>
                        <th class="p-3 font-semibold">No. Referencia</th>
                        <th class="p-3 font-semibold text-right">Monto Abono</th>
                    </tr>
                </thead>
                <tbody id="tabla-abonos-body" class="divide-y divide-gray-100">
                    <tr><td colspan="4" class="p-4 text-center text-gray-400">Cargando abonos...</td></tr>
                </tbody>
            </table>
        </div>
    `

    try {
        const { data: abonos, error } = await supabase
            .from('pagos_credito')
            .select('*')
            .eq('cliente_id', clienteId)
            .order('created_at', { ascending: false })

        if (error) throw error

        const tbody = document.getElementById('tabla-abonos-body')
        tbody.innerHTML = ''

        if (!abonos || abonos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-400 italic">Este cliente no registra abonos aún.</td></tr>'
            return
        }

        abonos.forEach(a => {
            const fechaStr = new Date(a.created_at).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })
            const montoFmt = (Number(a.monto) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

            tbody.innerHTML += `
                <tr class="hover:bg-gray-50">
                    <td class="p-3 font-mono text-gray-600">${fechaStr}</td>
                    <td class="p-3"><span class="inline-block bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded">${a.metodo_pago}</span></td>
                    <td class="p-3 font-mono text-gray-700">${a.numero_referencia || '--'}</td>
                    <td class="p-3 text-right font-extrabold text-emerald-600">+Q${montoFmt}</td>
                </tr>
            `
        })
    } catch (err) {
        console.error("Error al cargar abonos:", err)
    }
}

// 7. Modales (Cliente, Finca, Abono)
const modalCliente = document.getElementById('modal-cliente')
const modalFinca = document.getElementById('modal-finca')
const modalAbono = document.getElementById('modal-abono')

document.getElementById('btn-nuevo-cliente')?.addEventListener('click', () => modalCliente.classList.remove('hidden'))
document.getElementById('btn-cerrar-modal-cliente')?.addEventListener('click', () => modalCliente.classList.add('hidden'))
document.getElementById('btn-cerrar-modal-cliente-x')?.addEventListener('click', () => modalCliente.classList.add('hidden'))

function abrirModalFinca(clienteId) {
    document.getElementById('finca-cliente-id').value = clienteId
    modalFinca.classList.remove('hidden')
}
document.getElementById('btn-cerrar-modal-finca')?.addEventListener('click', () => modalFinca.classList.add('hidden'))
document.getElementById('btn-cerrar-modal-finca-x')?.addEventListener('click', () => modalFinca.classList.add('hidden'))

document.getElementById('btn-nuevo-abono')?.addEventListener('click', () => {
    if (clienteSeleccionadoId) {
        document.getElementById('abono-cliente-id').value = clienteSeleccionadoId
    }
    modalAbono.classList.remove('hidden')
})
document.getElementById('btn-cerrar-modal-abono')?.addEventListener('click', () => modalAbono.classList.add('hidden'))
document.getElementById('btn-cerrar-modal-abono-x')?.addEventListener('click', () => modalAbono.classList.add('hidden'))

// Submit Form Cliente
document.getElementById('form-cliente')?.addEventListener('submit', async (e) => {
    e.preventDefault()

    const btnGuardar = document.getElementById('btn-guardar-cliente')
    const textoOrig = btnGuardar.textContent
    btnGuardar.textContent = 'Guardando...'
    btnGuardar.disabled = true

    const nombre = document.getElementById('cli-nombre').value.trim()
    const nit = document.getElementById('cli-nit').value.trim() || 'CF'
    const telefono = document.getElementById('cli-telefono').value.trim()
    const direccion = document.getElementById('cli-direccion').value.trim()
    const limite = parseFloat(document.getElementById('cli-limite').value) || 0

    try {
        const { error } = await supabase
            .from('clientes')
            .insert([{
                nombre,
                nit,
                telefono,
                direccion,
                limite_credito: limite,
                saldo_actual: 0
            }])

        if (error) throw error

        alert('¡Cliente creado con éxito!')
        document.getElementById('form-cliente').reset()
        modalCliente.classList.add('hidden')
        await cargarClientes()
    } catch (err) {
        console.error("Error al crear cliente:", err)
        alert("Error al guardar cliente: " + (err.message || err))
    } finally {
        btnGuardar.textContent = textoOrig
        btnGuardar.disabled = false
    }
})

// Submit Form Finca
document.getElementById('form-finca')?.addEventListener('submit', async (e) => {
    e.preventDefault()

    const btnGuardar = document.getElementById('btn-guardar-finca')
    const textoOrig = btnGuardar.textContent
    btnGuardar.textContent = 'Guardando...'
    btnGuardar.disabled = true

    const clienteId = document.getElementById('finca-cliente-id').value
    const nombreFinca = document.getElementById('finc-nombre').value.trim()
    const ubicacion = document.getElementById('finc-ubicacion').value.trim()
    const tipo = document.getElementById('finc-tipo').value
    const tamano = parseFloat(document.getElementById('finc-tamano').value) || 0

    try {
        const { error } = await supabase
            .from('fincas')
            .insert([{
                cliente_id: clienteId,
                nombre_finca: nombreFinca,
                ubicacion: ubicacion,
                tipo_explotacion: tipo,
                tamano_hectareas: tamano
            }])

        if (error) throw error

        document.getElementById('form-finca').reset()
        modalFinca.classList.add('hidden')
        await cargarFincasCliente(clienteId)
    } catch (err) {
        console.error("Error al crear finca:", err)
        alert("Error al guardar finca: " + (err.message || err))
    } finally {
        btnGuardar.textContent = textoOrig
        btnGuardar.disabled = false
    }
})

// Submit Form Abono (RPC registrar_abono_credito)
document.getElementById('form-abono')?.addEventListener('submit', async (e) => {
    e.preventDefault()

    const btnGuardar = document.getElementById('btn-guardar-abono')
    const textoOrig = btnGuardar.textContent
    btnGuardar.textContent = 'Registrando...'
    btnGuardar.disabled = true

    const clienteId = document.getElementById('abono-cliente-id').value
    const monto = parseFloat(document.getElementById('abono-monto').value) || 0
    const metodo = document.getElementById('abono-metodo').value
    const referencia = document.getElementById('abono-referencia').value.trim()
    const observaciones = document.getElementById('abono-observaciones').value.trim()

    try {
        const { data: { session } } = await supabase.auth.getSession()

        const { error } = await supabase.rpc('registrar_abono_credito', {
            p_cliente_id: clienteId,
            p_monto: monto,
            p_metodo_pago: metodo,
            p_numero_referencia: referencia || null,
            p_observaciones: observaciones || null,
            p_usuario_id: session?.user?.id || null
        })

        if (error) throw error

        alert('¡Abono de crédito registrado con éxito!')
        document.getElementById('form-abono').reset()
        modalAbono.classList.add('hidden')
        await cargarClientes()
        if (clienteSeleccionadoId) {
            seleccionarCliente(clienteSeleccionadoId)
        }
    } catch (err) {
        console.error("Error al registrar abono:", err)
        alert("Error al procesar el abono: " + (err.message || err))
    } finally {
        btnGuardar.textContent = textoOrig
        btnGuardar.disabled = false
    }
})

// Tecla Escape para modales
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        modalCliente.classList.add('hidden')
        modalFinca.classList.add('hidden')
        modalAbono.classList.add('hidden')
    }
})

// Logout
document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    window.location.href = 'index.html'
})

// Inicializar
validarSesion()
