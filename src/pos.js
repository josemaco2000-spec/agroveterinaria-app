import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

// Estado Global de la App POS
let catalogo = []
let carrito = []
let listaClientesPOS = []
let clienteSeleccionadoId = null
let fincaSeleccionadaId = null
let tipoPagoSeleccionado = 'EFECTIVO'

function actualizarStatusConexionUI() {
    const badge = document.getElementById('status-conexion')
    if (!badge) return

    if (navigator.onLine) {
        badge.textContent = '🟢 En Línea'
        badge.className = 'bg-emerald-600 text-white text-xs px-2.5 py-1 rounded-full font-semibold uppercase'
        sincronizarVentasPendientes()
    } else {
        badge.textContent = '🔴 Modo Offline'
        badge.className = 'bg-red-600 text-white text-xs px-2.5 py-1 rounded-full font-semibold uppercase animate-pulse'
    }
}

window.addEventListener('online', actualizarStatusConexionUI)
window.addEventListener('offline', actualizarStatusConexionUI)

function actualizarCacheCatalogoLocal() {
    const data = {
        catalogo: catalogo,
        listaClientesPOS: listaClientesPOS
    }
    localStorage.setItem('adnova_catalog_cache', JSON.stringify(data))
}

function cargarCatalogodesdeCache() {
    try {
        const cache = localStorage.getItem('adnova_catalog_cache')
        if (cache) {
            const parsed = JSON.parse(cache)
            catalogo = parsed.catalogo || []
            listaClientesPOS = parsed.listaClientesPOS || []
            renderCatalogo(catalogo)

            const selectCliente = document.getElementById('select-cliente')
            if (selectCliente) {
                selectCliente.innerHTML = '<option value="">Consumidor Final (CF)</option>'
                listaClientesPOS.forEach(cli => {
                    const opt = document.createElement('option')
                    opt.value = cli.id
                    opt.textContent = `${cli.nombre} (NIT: ${cli.nit || 'CF'})`
                    selectCliente.appendChild(opt)
                })
            }
            console.log("Catálogo y clientes cargados desde caché local offline.")
        }
    } catch (e) {
        console.error("Error al cargar caché local:", e)
    }
}

// 1. Guard de Autenticación
async function validarSesion() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
        const cacheSession = localStorage.getItem('adnova_session_offline')
        if (!cacheSession && !navigator.onLine) {
            window.location.href = 'index.html'
            return
        }
    } else {
        localStorage.setItem('adnova_session_offline', 'true')
        const cajeroEmail = document.getElementById('cajero-email')
        if (cajeroEmail) {
            cajeroEmail.textContent = session.user.email
        }
    }

    actualizarStatusConexionUI()

    if (navigator.onLine) {
        await Promise.all([
            cargarCatalogo(),
            cargarClientesPOS()
        ])
    } else {
        cargarCatalogodesdeCache()
    }
}

// Cargar Lista de Clientes para el POS
async function cargarClientesPOS() {
    const selectCliente = document.getElementById('select-cliente')
    if (!selectCliente) return

    try {
        if (!navigator.onLine) {
            cargarCatalogodesdeCache()
            return
        }

        const { data: clientes, error } = await supabase
            .from('clientes')
            .select('*')
            .order('nombre', { ascending: true })

        if (error) throw error

        listaClientesPOS = clientes || []
        actualizarCacheCatalogoLocal()

        selectCliente.innerHTML = '<option value="">Consumidor Final (CF)</option>'
        listaClientesPOS.forEach(cli => {
            const opt = document.createElement('option')
            opt.value = cli.id
            opt.textContent = `${cli.nombre} (NIT: ${cli.nit || 'CF'})`
            selectCliente.appendChild(opt)
        })

    } catch (err) {
        console.error("Error al cargar clientes en POS:", err)
        cargarCatalogodesdeCache()
    }
}

// Listener para Cambio de Cliente
document.getElementById('select-cliente')?.addEventListener('change', async (e) => {
    const clienteId = e.target.value
    clienteSeleccionadoId = clienteId || null
    fincaSeleccionadaId = null

    const containerFinca = document.getElementById('container-finca')
    const selectFinca = document.getElementById('select-finca')
    const badgeCredito = document.getElementById('badge-credito-cliente')

    if (clienteId) {
        containerFinca?.classList.remove('hidden')
        await cargarFincasDelClientePOS(clienteId)

        const cli = listaClientesPOS.find(c => c.id === clienteId)
        if (cli && badgeCredito) {
            const saldoFmt = Number(cli.saldo_actual).toFixed(2)
            const limiteFmt = Number(cli.limite_credito).toFixed(2)
            badgeCredito.textContent = `Saldo: Q${saldoFmt} / Límite: Q${limiteFmt}`
            badgeCredito.className = Number(cli.saldo_actual) >= Number(cli.limite_credito)
                ? 'text-[11px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-800'
                : 'text-[11px] font-bold px-2 py-0.5 rounded bg-green-100 text-green-800'
            badgeCredito.classList.remove('hidden')
        }
    } else {
        containerFinca?.classList.add('hidden')
        badgeCredito?.classList.add('hidden')
        if (selectFinca) selectFinca.innerHTML = '<option value="">Sin finca específica</option>'

        if (tipoPagoSeleccionado === 'CREDITO') {
            actualizarSeleccionTipoPago('EFECTIVO')
        }
    }
})

// Listener para Cambio de Finca
document.getElementById('select-finca')?.addEventListener('change', (e) => {
    fincaSeleccionadaId = e.target.value || null
})

// Cargar Fincas del Cliente Seleccionado
async function cargarFincasDelClientePOS(clienteId) {
    const selectFinca = document.getElementById('select-finca')
    if (!selectFinca) return

    if (!navigator.onLine) {
        selectFinca.innerHTML = '<option value="">Sin finca específica (Offline)</option>'
        return
    }

    selectFinca.innerHTML = '<option value="">Cargando fincas...</option>'

    try {
        const { data: fincas, error } = await supabase
            .from('fincas')
            .select('*')
            .eq('cliente_id', clienteId)
            .order('nombre_finca', { ascending: true })

        if (error) throw error

        selectFinca.innerHTML = '<option value="">Sin finca específica</option>'
        if (fincas && fincas.length > 0) {
            fincas.forEach(f => {
                const opt = document.createElement('option')
                opt.value = f.id
                opt.textContent = `🏡 ${f.nombre_finca} (${f.tipo_explotacion || 'General'})`
                selectFinca.appendChild(opt)
            })
        }
    } catch (err) {
        console.error("Error al cargar fincas:", err)
        selectFinca.innerHTML = '<option value="">Sin finca específica</option>'
    }
}

// Botones Opción Tipo de Pago
document.querySelectorAll('.btn-pago-opt').forEach(btn => {
    btn.addEventListener('click', () => {
        const tipo = btn.getAttribute('data-tipo')
        
        if (tipo === 'CREDITO' && !clienteSeleccionadoId) {
            alert("⚠️ Para realizar una venta a crédito debes seleccionar un cliente registrado.")
            return
        }

        actualizarSeleccionTipoPago(tipo)
    })
})

function actualizarSeleccionTipoPago(tipo) {
    tipoPagoSeleccionado = tipo
    document.querySelectorAll('.btn-pago-opt').forEach(btn => {
        if (btn.getAttribute('data-tipo') === tipo) {
            btn.className = 'btn-pago-opt py-1.5 px-2 rounded-md transition text-center bg-white text-green-800 shadow-sm font-bold'
        } else {
            btn.className = 'btn-pago-opt py-1.5 px-2 rounded-md transition text-center text-gray-600 hover:text-gray-900 font-semibold'
        }
    })
}

// 2. Cargar Catálogo de Presentaciones Disponibles
async function cargarCatalogo() {
    const grid = document.getElementById('grid-productos')
    grid.innerHTML = '<div class="col-span-full text-center py-12 text-gray-500 font-medium">Cargando presentaciones de productos...</div>'

    try {
        if (!navigator.onLine) {
            cargarCatalogodesdeCache()
            return
        }

        const { data: presentaciones, error } = await supabase
            .from('presentaciones')
            .select(`
                *,
                productos!inner (
                    id,
                    nombre,
                    codigo_barras,
                    categoria,
                    unidad_base,
                    stock_base
                )
            `)
            .order('nombre_presentacion', { ascending: true })

        if (error) throw error

        catalogo = (presentaciones || []).filter(p => p.productos && Number(p.productos.stock_base) > 0)
        actualizarCacheCatalogoLocal()
        renderCatalogo(catalogo)

    } catch (err) {
        console.error("Error al cargar catálogo:", err)
        cargarCatalogodesdeCache()
    }
}

// Renderizar las tarjetas del catálogo
function renderCatalogo(items) {
    const grid = document.getElementById('grid-productos')
    grid.innerHTML = ''

    if (items.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center py-12 text-gray-400 font-medium italic">No se encontraron productos disponibles con stock.</div>'
        return
    }

    items.forEach(pres => {
        const prod = pres.productos
        const precioNum = Number(pres.precio_venta) || 0
        const precioFormateado = precioNum.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        
        // Calcular cuántas unidades de esta presentación se pueden formar con el stock_base
        const factor = Number(pres.factor_conversion) || 1
        const maxPresentaciones = Math.floor(Number(prod.stock_base) / factor)

        grid.innerHTML += `
            <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col justify-between hover:shadow-md transition">
                <div>
                    <div class="flex justify-between items-start mb-1">
                        <span class="text-xs font-semibold uppercase px-2 py-0.5 rounded bg-green-100 text-green-800">${prod.categoria || 'General'}</span>
                        <span class="text-xs text-gray-400 font-mono">${prod.codigo_barras ? '📦 ' + prod.codigo_barras : ''}</span>
                    </div>
                    <h3 class="font-bold text-gray-800 text-base leading-tight">${prod.nombre}</h3>
                    <p class="text-sm font-semibold text-green-700 mt-1">${pres.nombre_presentacion}</p>
                    <div class="mt-2 text-xs text-gray-500 flex justify-between">
                        <span>Stock Base: <strong>${prod.stock_base} ${prod.unidad_base}</strong></span>
                        <span>Disp: ~<strong>${maxPresentaciones} pres.</strong></span>
                    </div>
                </div>

                <div class="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                    <span class="text-xl font-extrabold text-gray-900">Q${precioFormateado}</span>
                    <button class="btn-agregar-carrito bg-green-600 hover:bg-green-700 active:scale-95 text-white font-bold py-2 px-3.5 rounded-lg text-sm shadow transition flex items-center gap-1"
                            data-pres-id="${pres.id}">
                        <span>+ Agregar</span>
                    </button>
                </div>
            </div>
        `
    })

    // Event listeners para los botones "+ Agregar"
    grid.querySelectorAll('.btn-agregar-carrito').forEach(btn => {
        btn.addEventListener('click', () => {
            const presId = btn.getAttribute('data-pres-id')
            const presItem = catalogo.find(p => p.id === presId)
            if (presItem) {
                agregarAlCarrito(presItem)
            }
        })
    })
}

// 3. Filtro de Búsqueda en tiempo real
const inputBusqueda = document.getElementById('input-busqueda')
inputBusqueda?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim()
    if (!query) {
        renderCatalogo(catalogo)
        return
    }

    const filtrados = catalogo.filter(pres => {
        const prod = pres.productos
        const nombreProd = prod.nombre.toLowerCase()
        const codigo = (prod.codigo_barras || '').toLowerCase()
        const nombrePres = pres.nombre_presentacion.toLowerCase()
        const cat = (prod.categoria || '').toLowerCase()

        return nombreProd.includes(query) || codigo.includes(query) || nombrePres.includes(query) || cat.includes(query)
    })

    renderCatalogo(filtrados)
})

// 4. Gestión del Carrito
function agregarAlCarrito(presItem) {
    const prod = presItem.productos
    const factor = Number(presItem.factor_conversion) || 1
    const stockBaseTotal = Number(prod.stock_base)

    // Calcular cuánto stock base de este mismo producto ya está reservado en el carrito
    const stockBaseUsado = carrito
        .filter(item => item.productoId === prod.id)
        .reduce((sum, item) => sum + (item.cantidad * item.factorConversion), 0)

    // Si agregamos 1 más de esta presentación, requiramos `factor` adicional
    if ((stockBaseUsado + factor) > stockBaseTotal) {
        alert(`⚠️ Stock insuficiente. El stock base disponible de "${prod.nombre}" es de ${stockBaseTotal} ${prod.unidad_base}.`)
        return
    }

    const itemEnCarrito = carrito.find(item => item.presentacionId === presItem.id)

    if (itemEnCarrito) {
        itemEnCarrito.cantidad += 1
    } else {
        carrito.push({
            presentacionId: presItem.id,
            productoId: prod.id,
            nombreProducto: prod.nombre,
            nombrePresentacion: presItem.nombre_presentacion,
            factorConversion: factor,
            unidadBase: prod.unidad_base,
            precioVenta: Number(presItem.precio_venta) || 0,
            cantidad: 1
        })
    }

    renderCarrito()
}

function cambiarCantidad(presentacionId, cambio) {
    const item = carrito.find(i => i.presentacionId === presentacionId)
    if (!item) return

    const nuevaCant = item.cantidad + cambio
    if (nuevaCant <= 0) {
        eliminarDelCarrito(presentacionId)
        return
    }

    // Validar stock base disponible
    const presItem = catalogo.find(p => p.id === presentacionId)
    if (presItem) {
        const prod = presItem.productos
        const stockBaseTotal = Number(prod.stock_base)
        const stockBaseUsadoSinEste = carrito
            .filter(i => i.productoId === prod.id && i.presentacionId !== presentacionId)
            .reduce((sum, i) => sum + (i.cantidad * i.factorConversion), 0)

        const requirienteBase = stockBaseUsadoSinEste + (nuevaCant * item.factorConversion)
        if (requirienteBase > stockBaseTotal) {
            alert(`⚠️ Stock insuficiente. El stock base disponible de "${prod.nombre}" es de ${stockBaseTotal} ${prod.unidad_base}.`)
            return
        }
    }

    item.cantidad = nuevaCant
    renderCarrito()
}

function eliminarDelCarrito(presentacionId) {
    carrito = carrito.filter(item => item.presentacionId !== presentacionId)
    renderCarrito()
}

function vaciarCarrito() {
    carrito = []
    renderCarrito()
}

document.getElementById('btn-vaciar-carrito')?.addEventListener('click', () => {
    if (carrito.length > 0 && confirm("¿Deseas vaciar el carrito de compras?")) {
        vaciarCarrito()
    }
})

// Renderizar el carrito de compras
function renderCarrito() {
    const lista = document.getElementById('lista-carrito')
    const totalEl = document.getElementById('total-carrito')
    const btnCompletar = document.getElementById('btn-completar-venta')

    lista.innerHTML = ''

    if (carrito.length === 0) {
        lista.innerHTML = `
            <div class="text-center py-16 text-gray-400">
                <span class="text-4xl block mb-2">🛒</span>
                <p class="text-sm font-medium">El carrito está vacío</p>
                <p class="text-xs text-gray-400 mt-1">Haz clic en "+ Agregar" en los productos del catálogo</p>
            </div>
        `
        totalEl.textContent = 'Q0.00'
        btnCompletar.disabled = true
        return
    }

    let granTotal = 0

    carrito.forEach(item => {
        const subtotal = item.cantidad * item.precioVenta
        granTotal += subtotal

        const subtotalFormateado = subtotal.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const precioFormateado = item.precioVenta.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

        lista.innerHTML += `
            <div class="py-3 flex items-center justify-between gap-3">
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-gray-800 text-sm truncate">${item.nombreProducto}</div>
                    <div class="text-xs font-semibold text-green-700">${item.nombrePresentacion} — Q${precioFormateado} c/u</div>
                </div>

                <!-- Controles de Cantidad -->
                <div class="flex items-center border border-gray-300 rounded-lg overflow-hidden bg-white shadow-sm shrink-0">
                    <button class="btn-restar px-2.5 py-1 text-gray-600 hover:bg-gray-100 font-bold transition" data-id="${item.presentacionId}">-</button>
                    <span class="px-3 py-1 text-xs font-bold text-gray-800 min-w-[2rem] text-center">${item.cantidad}</span>
                    <button class="btn-sumar px-2.5 py-1 text-gray-600 hover:bg-gray-100 font-bold transition" data-id="${item.presentacionId}">+</button>
                </div>

                <!-- Subtotal y Eliminar -->
                <div class="text-right shrink-0 min-w-[5rem]">
                    <div class="font-extrabold text-gray-900 text-sm">Q${subtotalFormateado}</div>
                    <button class="btn-eliminar text-xs text-red-500 hover:text-red-700 font-medium transition mt-0.5" data-id="${item.presentacionId}">
                        🗑️ Quitar
                    </button>
                </div>
            </div>
        `
    })

    const totalFormateado = granTotal.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    totalEl.textContent = `Q${totalFormateado}`
    btnCompletar.disabled = false

    // Asignar eventos de los botones del carrito
    lista.querySelectorAll('.btn-restar').forEach(btn => {
        btn.addEventListener('click', () => cambiarCantidad(btn.getAttribute('data-id'), -1))
    })
    lista.querySelectorAll('.btn-sumar').forEach(btn => {
        btn.addEventListener('click', () => cambiarCantidad(btn.getAttribute('data-id'), 1))
    })
    lista.querySelectorAll('.btn-eliminar').forEach(btn => {
        btn.addEventListener('click', () => eliminarDelCarrito(btn.getAttribute('data-id')))
    })
}

// 5. Flujo de Cobro y Finalización de Venta
document.getElementById('btn-completar-venta')?.addEventListener('click', async () => {
    if (carrito.length === 0) return

    const btnCompletar = document.getElementById('btn-completar-venta')
    const textoOriginal = btnCompletar.innerHTML
    btnCompletar.innerHTML = '<span>⏳ Procesando venta...</span>'
    btnCompletar.disabled = true

    try {
        const totalVenta = carrito.reduce((sum, item) => sum + (item.cantidad * item.precioVenta), 0)

        // FALLBACK MODO OFFLINE
        if (!navigator.onLine) {
            if (tipoPagoSeleccionado === 'CREDITO') {
                if (!clienteSeleccionadoId) {
                    alert("⚠️ No se puede realizar una venta a crédito a Consumidor Final. Selecciona un cliente registrado.")
                    btnCompletar.innerHTML = textoOriginal
                    btnCompletar.disabled = false
                    return
                }

                const cliLocal = listaClientesPOS.find(c => c.id === clienteSeleccionadoId)
                if (cliLocal) {
                    const saldoActual = Number(cliLocal.saldo_actual) || 0
                    const limiteCredito = Number(cliLocal.limite_credito) || 0

                    if ((saldoActual + totalVenta) > limiteCredito) {
                        const disponible = Math.max(0, limiteCredito - saldoActual)
                        const disponibleFmt = disponible.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        alert(`⚠️ Límite de crédito excedido para "${cliLocal.nombre}". Crédito disponible: Q${disponibleFmt}.`)
                        btnCompletar.innerHTML = textoOriginal
                        btnCompletar.disabled = false
                        return
                    }
                    // Actualizar saldo localmente
                    cliLocal.saldo_actual = saldoActual + totalVenta
                }
            }

            const localId = 'local-' + crypto.randomUUID()

            // Descontar stock localmente en catalogo cargado
            carrito.forEach(item => {
                const pres = catalogo.find(p => p.id === item.presentacionId)
                if (pres && pres.productos) {
                    pres.productos.stock_base = Math.max(0, Number(pres.productos.stock_base) - (item.cantidad * item.factorConversion))
                }
            })

            actualizarCacheCatalogoLocal()
            renderCatalogo(catalogo)

            // Encolar venta pendiente
            const pendingSales = JSON.parse(localStorage.getItem('adnova_pending_sales') || '[]')
            const nuevaVentaOffline = {
                id: localId,
                total: totalVenta,
                cliente_id: clienteSeleccionadoId || null,
                finca_id: fincaSeleccionadaId || null,
                tipo_pago: tipoPagoSeleccionado,
                carrito: [...carrito]
            }
            pendingSales.push(nuevaVentaOffline)
            localStorage.setItem('adnova_pending_sales', JSON.stringify(pendingSales))

            // Generar ticket con marca de agua offline
            const itemsParaTicket = [...carrito]
            renderizarTicket(localId, itemsParaTicket, totalVenta)

            vaciarCarrito()

            const modalExito = document.getElementById('modal-exito')
            const detalleExito = document.getElementById('mensaje-exito-detalle')
            if (detalleExito) {
                const totalForm = totalVenta.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                detalleExito.textContent = `La venta offline por Q${totalForm} se guardó localmente. Se sincronizará automáticamente al recuperar internet.`
            }
            modalExito?.classList.remove('hidden')

            btnCompletar.innerHTML = textoOriginal
            btnCompletar.disabled = true
            return
        }

        // VALIDACIÓN ONLINE DE CRÉDITO
        if (tipoPagoSeleccionado === 'CREDITO') {
            if (!clienteSeleccionadoId) {
                alert("⚠️ No se puede realizar una venta a crédito a Consumidor Final. Selecciona un cliente registrado.")
                btnCompletar.innerHTML = textoOriginal
                btnCompletar.disabled = false
                return
            }

            const { data: clienteFresh, error: errCli } = await supabase
                .from('clientes')
                .select('saldo_actual, limite_credito, nombre')
                .eq('id', clienteSeleccionadoId)
                .single()

            if (errCli || !clienteFresh) {
                alert("⚠️ No se pudo verificar la información del cliente.")
                btnCompletar.innerHTML = textoOriginal
                btnCompletar.disabled = false
                return
            }

            const saldoActual = Number(clienteFresh.saldo_actual) || 0
            const limiteCredito = Number(clienteFresh.limite_credito) || 0

            if ((saldoActual + totalVenta) > limiteCredito) {
                const disponible = Math.max(0, limiteCredito - saldoActual)
                const disponibleFmt = disponible.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                alert(`⚠️ Límite de crédito excedido para "${clienteFresh.nombre}". Crédito disponible actual: Q${disponibleFmt}.`)
                btnCompletar.innerHTML = textoOriginal
                btnCompletar.disabled = false
                return
            }
        }

        // Paso 1: Registrar en tabla `ventas`
        const { data: nuevaVenta, error: errorVenta } = await supabase
            .from('ventas')
            .insert([{
                total: totalVenta,
                estado_factura: 'pendiente',
                cliente_id: clienteSeleccionadoId || null,
                finca_id: fincaSeleccionadaId || null,
                tipo_pago: tipoPagoSeleccionado
            }])
            .select()
            .single()

        if (errorVenta) throw errorVenta

        // Si fue Venta a Crédito, actualizar el saldo_actual del cliente en DB
        if (tipoPagoSeleccionado === 'CREDITO' && clienteSeleccionadoId) {
            const { data: cliData } = await supabase.from('clientes').select('saldo_actual').eq('id', clienteSeleccionadoId).single()
            const nuevoSaldo = (Number(cliData?.saldo_actual) || 0) + totalVenta
            await supabase.from('clientes').update({ saldo_actual: nuevoSaldo }).eq('id', clienteSeleccionadoId)
        }

        // Paso 2: Bulk INSERT en `detalle_ventas`
        const detalles = carrito.map(item => ({
            venta_id: nuevaVenta.id,
            presentacion_id: item.presentacionId,
            cantidad: item.cantidad,
            subtotal: item.cantidad * item.precioVenta
        }))

        const { error: errorDetalle } = await supabase
            .from('detalle_ventas')
            .insert(detalles)

        if (errorDetalle) throw errorDetalle

        // Paso 3: Invocar procedimiento almacenado (RPC) procesar_salida_fefo por cada ítem del carrito
        const { data: { session } } = await supabase.auth.getSession()
        const usuarioId = session?.user?.id || null

        for (const item of carrito) {
            const cantidadBase = item.cantidad * item.factorConversion

            const { error: errorFefo } = await supabase.rpc('procesar_salida_fefo', {
                p_producto_id: item.productoId,
                p_cantidad_base: cantidadBase,
                p_referencia_id: nuevaVenta.id,
                p_usuario_id: usuarioId
            })

            if (errorFefo) {
                console.error(`Error procesando salida FEFO para producto ${item.productoId}:`, errorFefo)
                alert(`⚠️ Atención con el producto "${item.nombreProducto}": ${errorFefo.message}`)
            }
        }

        // Paso 4: Éxito, generar ticket de impresión, limpiar carrito y actualizar vistas
        const itemsParaTicket = [...carrito]
        renderizarTicket(nuevaVenta.id, itemsParaTicket, totalVenta)

        vaciarCarrito()
        await cargarCatalogo()

        const modalExito = document.getElementById('modal-exito')
        const detalleExito = document.getElementById('mensaje-exito-detalle')
        if (detalleExito) {
            const totalForm = totalVenta.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            detalleExito.textContent = `La venta por Q${totalForm} (#${nuevaVenta.id.substring(0, 8)}) se procesó correctamente.`
        }
        modalExito?.classList.remove('hidden')

    } catch (err) {
        console.error("Error al procesar la venta:", err)
        alert("Error al procesar la venta: " + (err.message || err))
    } finally {
        btnCompletar.innerHTML = textoOriginal
        btnCompletar.disabled = carrito.length === 0
    }
})

// 6. Generar HTML para Ticket Térmico de Impresión (80mm / 58mm)
function renderizarTicket(ventaId, cartItems, totalAmount) {
    const ticketContainer = document.getElementById('ticket-impresion')
    if (!ticketContainer) return

    const shortId = ventaId ? ventaId.substring(0, 8) : '--------'
    const fechaHora = new Date().toLocaleString('es-GT', {
        dateStyle: 'medium',
        timeStyle: 'short'
    })

    const cajeroEmail = document.getElementById('cajero-email')?.textContent || 'Vendedor'
    const totalForm = totalAmount.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    const clienteObj = listaClientesPOS.find(c => c.id === clienteSeleccionadoId)
    const nombreClienteStr = clienteObj ? clienteObj.nombre : 'Consumidor Final (CF)'
    const nitClienteStr = clienteObj ? (clienteObj.nit || 'CF') : 'CF'

    const esOffline = !navigator.onLine || (ventaId && ventaId.startsWith('local-'))
    const watermarkHtml = esOffline 
        ? `<div style="text-align: center; color: red; border: 2px dashed red; padding: 6px; font-weight: bold; font-size: 11px; margin-bottom: 10px;">
             ** VENTA PENDIENTE DE SINCRONIZAR **
           </div>`
        : ''

    let filasItemsHtml = ''
    cartItems.forEach(item => {
        const subtotal = item.cantidad * item.precioVenta
        const subtotalForm = subtotal.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        
        filasItemsHtml += `
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                <span style="font-weight: bold;">${item.cantidad}x ${item.nombreProducto}</span>
                <span>Q${subtotalForm}</span>
            </div>
            <div style="font-size: 10px; color: #333; margin-bottom: 5px; padding-left: 10px;">
                ${item.nombrePresentacion} @ Q${item.precioVenta.toFixed(2)} c/u
            </div>
        `
    })

    ticketContainer.innerHTML = `
        ${watermarkHtml}
        <div style="text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
            <h2 style="font-size: 14px; font-weight: bold; margin: 0; text-transform: uppercase;">Agrovet Campo Alto</h2>
            <p style="font-size: 10px; margin: 2px 0 0 0;">Fray Bartolomé de las Casas, Alta Verapaz</p>
            <p style="font-size: 10px; margin: 1px 0 0 0;">Tel: (502) 7700-0000</p>
        </div>

        <div style="font-size: 10px; border-bottom: 1px dashed #000; padding-bottom: 6px; margin-bottom: 8px;">
            <div><strong>Ticket No:</strong> #${shortId}</div>
            <div><strong>Fecha:</strong> ${fechaHora}</div>
            <div><strong>Atendido por:</strong> ${cajeroEmail}</div>
            <div><strong>Cliente:</strong> ${nombreClienteStr} (NIT: ${nitClienteStr})</div>
            <div><strong>Pago:</strong> ${tipoPagoSeleccionado}</div>
        </div>

        <div style="border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
            ${filasItemsHtml}
        </div>

        <div style="text-align: right; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
            <div style="font-size: 14px; font-weight: font-extrabold;">TOTAL A PAGAR: Q${totalForm}</div>
        </div>

        <div style="text-align: center; font-size: 10px; margin-top: 10px;">
            <p style="margin: 0; font-weight: bold;">*** Comprobante Interno de Venta ***</p>
            <p style="margin: 3px 0 0 0;">¡Gracias por su preferencia y confianza!</p>
        </div>
    `
}

// 7. Auto-Sincronización de Ventas Guardadas en Modo Offline
let isSyncing = false
async function sincronizarVentasPendientes() {
    if (isSyncing || !navigator.onLine) return

    const pendingSales = JSON.parse(localStorage.getItem('adnova_pending_sales') || '[]')
    if (pendingSales.length === 0) return

    isSyncing = true
    console.log(`Iniciando auto-sincronización de ${pendingSales.length} ventas offline...`)

    let successfulSyncs = 0

    try {
        const { data: { session } } = await supabase.auth.getSession()
        const usuarioId = session?.user?.id || null

        for (const venta of pendingSales) {
            // 1. Insertar venta
            const { data: nuevaVenta, error: errorVenta } = await supabase
                .from('ventas')
                .insert([{
                    total: venta.total,
                    estado_factura: 'pendiente',
                    cliente_id: venta.cliente_id,
                    finca_id: venta.finca_id,
                    tipo_pago: venta.tipo_pago
                }])
                .select()
                .single()

            if (errorVenta) throw errorVenta

            // 2. Insertar detalles
            const detalles = venta.carrito.map(item => ({
                venta_id: nuevaVenta.id,
                presentacion_id: item.presentacionId,
                cantidad: item.cantidad,
                subtotal: item.cantidad * item.precioVenta
            }))

            const { error: errorDetalle } = await supabase
                .from('detalle_ventas')
                .insert(detalles)

            if (errorDetalle) throw errorDetalle

            // 3. Procesar salida FEFO por cada ítem
            for (const item of venta.carrito) {
                const cantidadBase = item.cantidad * item.factorConversion
                await supabase.rpc('procesar_salida_fefo', {
                    p_producto_id: item.productoId,
                    p_cantidad_base: cantidadBase,
                    p_referencia_id: nuevaVenta.id,
                    p_usuario_id: usuarioId
                })
            }

            // 4. Si fue crédito, actualizar saldo_actual del cliente
            if (venta.tipo_pago === 'CREDITO' && venta.cliente_id) {
                const { data: cliData } = await supabase.from('clientes').select('saldo_actual').eq('id', venta.cliente_id).single()
                const nuevoSaldo = (Number(cliData?.saldo_actual) || 0) + venta.total
                await supabase.from('clientes').update({ saldo_actual: nuevoSaldo }).eq('id', venta.cliente_id)
            }

            successfulSyncs++
        }

        // Limpiar cola local
        localStorage.setItem('adnova_pending_sales', '[]')
        alert(`✅ Sincronización exitosa: ${successfulSyncs} venta(s) offline guardada(s) en la nube.`)

        // Recargar datos frescos
        await Promise.all([
            cargarCatalogo(),
            cargarClientesPOS()
        ])

    } catch (err) {
        console.error("Error durante sincronización offline:", err)
        // Mantener las restantes en cola
        const remaining = pendingSales.slice(successfulSyncs)
        localStorage.setItem('adnova_pending_sales', JSON.stringify(remaining))
    } finally {
        isSyncing = false
    }
}

// 8. Acciones del Modal de Exito (Imprimir / Nueva Venta)
document.getElementById('btn-imprimir-ticket')?.addEventListener('click', () => {
    window.print()
    document.getElementById('modal-exito')?.classList.add('hidden')
})

document.getElementById('btn-nueva-venta')?.addEventListener('click', () => {
    document.getElementById('modal-exito')?.classList.add('hidden')
})

// Logout
document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    localStorage.removeItem('adnova_session_offline')
    window.location.href = 'index.html'
})

// Inicializar la aplicación POS
validarSesion()
