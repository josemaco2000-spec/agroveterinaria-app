import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

// Estado Global de la App POS
let catalogo = []
let carrito = []

// 1. Guard de Autenticación
async function validarSesion() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
        window.location.href = 'index.html'
        return
    }

    const cajeroEmail = document.getElementById('cajero-email')
    if (cajeroEmail) {
        cajeroEmail.textContent = session.user.email
    }

    cargarCatalogo()
}

// 2. Cargar Catálogo de Presentaciones Disponibles
async function cargarCatalogo() {
    const grid = document.getElementById('grid-productos')
    grid.innerHTML = '<div class="col-span-full text-center py-12 text-gray-500 font-medium">Cargando presentaciones de productos...</div>'

    try {
        // Consultar presentaciones unidas con datos del producto
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

        // Filtrar presentaciones cuyos productos tengan stock base disponible > 0
        catalogo = (presentaciones || []).filter(p => p.productos && Number(p.productos.stock_base) > 0)
        renderCatalogo(catalogo)

    } catch (err) {
        console.error("Error al cargar catálogo:", err)
        grid.innerHTML = `<div class="col-span-full text-center py-12 text-red-500 font-semibold">Error al cargar productos: ${err.message}</div>`
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
        // Calcular total general de la venta
        const totalVenta = carrito.reduce((sum, item) => sum + (item.cantidad * item.precioVenta), 0)

        // Paso 1: Registrar en tabla `ventas`
        const { data: nuevaVenta, error: errorVenta } = await supabase
            .from('ventas')
            .insert([{
                total: totalVenta,
                estado_factura: 'pendiente'
            }])
            .select()
            .single()

        if (errorVenta) throw errorVenta

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

        // Paso 3: Descuenta el stock en la tabla `productos`
        // Agrupamos el consumo total de stock_base por cada producto_id
        const consumoPorProducto = {}
        carrito.forEach(item => {
            const consumoBase = item.cantidad * item.factorConversion
            consumoPorProducto[item.productoId] = (consumoPorProducto[item.productoId] || 0) + consumoBase
        })

        // Actualizamos cada producto consumido
        for (const [prodId, consumoTotalBase] of Object.entries(consumoPorProducto)) {
            // Obtenemos el stock actual directo de la base de datos
            const { data: prodData, error: errFetchProd } = await supabase
                .from('productos')
                .select('stock_base')
                .eq('id', prodId)
                .single()

            if (!errFetchProd && prodData) {
                const nuevoStockBase = Math.max(0, Number(prodData.stock_base) - consumoTotalBase)
                const { error: errUpdateProd } = await supabase
                    .from('productos')
                    .update({ stock_base: nuevoStockBase })
                    .eq('id', prodId)

                if (errUpdateProd) {
                    console.error(`Error actualizando stock_base del producto ${prodId}:`, errUpdateProd)
                }
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
        <div style="text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
            <h2 style="font-size: 14px; font-weight: bold; margin: 0; text-transform: uppercase;">Agrovet Campo Alto</h2>
            <p style="font-size: 10px; margin: 2px 0 0 0;">Fray Bartolomé de las Casas, Alta Verapaz</p>
            <p style="font-size: 10px; margin: 1px 0 0 0;">Tel: (502) 7700-0000</p>
        </div>

        <div style="font-size: 10px; border-bottom: 1px dashed #000; padding-bottom: 6px; margin-bottom: 8px;">
            <div><strong>Ticket No:</strong> #${shortId}</div>
            <div><strong>Fecha:</strong> ${fechaHora}</div>
            <div><strong>Atendido por:</strong> ${cajeroEmail}</div>
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

// 7. Acciones del Modal de Exito (Imprimir / Nueva Venta)
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
    window.location.href = 'index.html'
})

// Inicializar la aplicación POS
validarSesion()
