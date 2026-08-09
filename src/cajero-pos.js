import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

// Estado Global de POS
let catalogo = []
let carrito = []
let listaClientesPOS = []
let clienteSeleccionadoId = ''
let fincaSeleccionadaId = ''
let tipoPagoSeleccionado = 'EFECTIVO'
let isSyncing = false
let cajeroNombreCompleto = 'Usuario'

// 1. Guard de Autenticación y Rol Vendedor
async function validarSesion() {
    try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()

        if (sessionError || !session) {
            window.location.href = 'index.html'
            return
        }

        // Verificar rol y nombre_completo en perfiles
        const { data: perfil, error: perfilError } = await supabase
            .from('perfiles')
            .select('rol, nombre_completo')
            .eq('id', session.user.id)
            .single()

        if (perfilError) {
            console.error("Error al verificar perfil:", perfilError.message)
        } else if (perfil && perfil.rol === 'admin') {
            window.location.href = 'admin.html'
            return
        }

        cajeroNombreCompleto = perfil?.nombre_completo || session.user.email || 'Usuario'

        const cajeroEmailEl = document.getElementById('cajero-email') || document.getElementById('user-email') || document.getElementById('admin-email') || document.getElementById('usuario-info')
        if (cajeroEmailEl) {
            cajeroEmailEl.textContent = cajeroNombreCompleto
        }

        // Cargar datos del POS
        await Promise.all([
            cargarCatalogo(),
            cargarClientesPOS()
        ])

    } catch (err) {
        console.error("Error en validación de sesión POS:", err)
        window.location.href = 'index.html'
    }
}

// 2. Cargar Catálogo de Productos y Presentaciones
async function cargarCatalogo() {
    const grid = document.getElementById('grid-productos')
    if (!grid) return

    grid.innerHTML = `
        <div class="col-span-full bg-white rounded-3xl p-12 text-center text-slate-500 font-bold border border-slate-200 shadow-sm flex items-center justify-center gap-2">
            <span class="inline-block animate-spin text-2xl">⏳</span> Cargando catálogo de productos...
        </div>
    `

    try {
        if (!navigator.onLine) {
            cargarCatalogodesdeCache()
            return
        }

        // Consultar stock específico del Área de Venta (POS)
        const { data: stockVenta } = await supabase
            .from('v_stock_productos_ubicacion')
            .select('*')
            .eq('ubicacion_id', '22222222-2222-2222-2222-222222222222')

        const stockMap = {}
        if (stockVenta) {
            stockVenta.forEach(s => {
                stockMap[s.producto_id] = Number(s.stock_disponible) || 0
            })
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
                    stock_base,
                    imagen_url
                )
            `)
            .order('nombre_presentacion', { ascending: true })

        if (error) throw error

        catalogo = (presentaciones || []).map(p => {
            const stockPos = stockMap[p.productos.id] ?? Number(p.productos.stock_base)
            return {
                ...p,
                productos: {
                    ...p.productos,
                    stock_base: stockPos
                }
            }
        }).filter(p => p.productos && Number(p.productos.stock_base) > 0)

        actualizarCacheCatalogoLocal()
        renderCatalogo(catalogo)

    } catch (err) {
        console.error("Error al cargar catálogo:", err)
        cargarCatalogodesdeCache()
    }
}

function cargarCatalogodesdeCache() {
    const cachedData = localStorage.getItem('adnova_catalogo_cache')
    if (cachedData) {
        try {
            catalogo = JSON.parse(cachedData)
            renderCatalogo(catalogo)
            return
        } catch (e) {
            console.error("Error parsing cached catalog:", e)
        }
    }
    const grid = document.getElementById('grid-productos')
    if (grid) {
        grid.innerHTML = `
            <div class="col-span-full bg-white rounded-3xl p-12 text-center text-rose-500 font-bold border border-slate-200 shadow-sm">
                ❌ Sin conexión a internet y sin catálogo en caché.
            </div>
        `
    }
}

function actualizarCacheCatalogoLocal() {
    localStorage.setItem('adnova_catalogo_cache', JSON.stringify(catalogo))
}

// 3. Renderizar Catálogo de Tarjetas Gran Formato
function renderCatalogo(items) {
    const grid = document.getElementById('grid-productos')
    if (!grid) return

    grid.innerHTML = ''

    if (items.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full bg-white rounded-3xl p-12 text-center text-slate-400 font-bold border border-slate-200">
                No hay productos disponibles en esta búsqueda.
            </div>
        `
        return
    }

    items.forEach(pres => {
        const prod = pres.productos
        const precioUnitario = Number(pres.precio_venta || 0)
        const precioFmt = precioUnitario.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

        const imagenHtml = prod.imagen_url
            ? `<img src="${prod.imagen_url}" alt="${prod.nombre}" class="w-20 h-20 object-cover rounded-2xl border border-slate-200 shadow-sm shrink-0">`
            : `<div class="w-20 h-20 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-4xl font-bold shrink-0">📦</div>`

        grid.innerHTML += `
            <div class="bg-white hover:bg-emerald-50/50 border-2 border-slate-200 hover:border-emerald-400 rounded-3xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-4 group">
                <div class="flex items-start gap-4">
                    ${imagenHtml}
                    <div class="flex-1 min-w-0">
                        <span class="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block truncate">${prod.categoria || 'General'}</span>
                        <h3 class="text-base font-black text-slate-900 leading-snug line-clamp-2">${prod.nombre}</h3>
                        <span class="inline-block mt-1.5 bg-slate-100 text-slate-700 text-xs font-extrabold px-2.5 py-0.5 rounded-lg border border-slate-200">
                            ${pres.nombre_presentacion}
                        </span>
                    </div>
                </div>

                <div class="flex items-center justify-between pt-2 border-t border-slate-100 gap-2">
                    <div class="min-w-0 flex-1">
                        <span class="text-[10px] font-extrabold text-slate-400 block uppercase">Precio</span>
                        <div class="flex items-baseline space-x-1 whitespace-nowrap text-ellipsis overflow-hidden">
                            <span class="text-xs font-extrabold text-emerald-600">Q</span>
                            <span class="text-xl md:text-2xl font-black text-emerald-600 font-sans tracking-tight">${precioFmt}</span>
                        </div>
                    </div>

                    <button class="btn-agregar-carrito bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black text-sm px-4 py-2.5 rounded-2xl shadow-md transition flex items-center gap-1.5 shrink-0"
                            data-id="${pres.id}">
                        <span>➕ Agregar</span>
                    </button>
                </div>
            </div>
        `
    })

    grid.querySelectorAll('.btn-agregar-carrito').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id')
            const presItem = catalogo.find(p => p.id === id)
            if (presItem) agregarAlCarrito(presItem)
        })
    })
}

// Buscador en Tiempo Real
const inputBusqueda = document.getElementById('input-busqueda')
if (inputBusqueda) {
    inputBusqueda.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim()
        const filtrados = catalogo.filter(p => {
            const nombreProd = (p.productos?.nombre || '').toLowerCase()
            const nombrePres = (p.nombre_presentacion || '').toLowerCase()
            const codigo = (p.productos?.codigo_barras || '').toLowerCase()
            return nombreProd.includes(query) || nombrePres.includes(query) || codigo.includes(query)
        })
        renderCatalogo(filtrados)
    })
}

// 4. Lógica de Carrito de Compras
function agregarAlCarrito(presItem) {
    const prod = presItem.productos
    const stockBaseTotal = Number(prod.stock_base) || 0
    const factor = Number(presItem.factor_conversion || 1)

    const stockBaseUsado = carrito
        .filter(item => item.productoId === prod.id)
        .reduce((sum, item) => sum + (Number(item.cantidad) * Number(item.factorConversion)), 0)

    if ((stockBaseUsado + factor) > stockBaseTotal) {
        alert(`⚠️ Stock insuficiente. El stock base disponible de "${prod.nombre}" es de ${stockBaseTotal.toFixed(3)} ${prod.unidad_base}.`)
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
            precioVenta: Number(presItem.precio_venta) || 0,
            factorConversion: factor,
            unidadBase: prod.unidad_base,
            stockBase: stockBaseTotal,
            cantidad: 1,
            descuentoPorcentaje: 0
        })
    }

    renderCarrito()
}

function cambiarCantidadDirecta(index, nuevaCantidad) {
    const item = carrito[index]
    if (!item) return

    const cantNum = parseFloat(nuevaCantidad)
    if (isNaN(cantNum) || cantNum <= 0) {
        item.cantidad = 0
    } else {
        item.cantidad = Math.round(cantNum * 1000) / 1000
    }

    renderCarrito()
}

function cambiarPresentacionItem(index, nuevaPresId) {
    const item = carrito[index]
    if (!item) return

    const presItem = catalogo.find(p => p.id === nuevaPresId)
    if (presItem) {
        item.presentacionId = presItem.id
        item.nombrePresentacion = presItem.nombre_presentacion
        item.factorConversion = Number(presItem.factor_conversion) || 1
        item.precioVenta = Number(presItem.precio_venta) || 0
    }

    renderCarrito()
}

function venderTodoElDisponible(index) {
    const item = carrito[index]
    if (!item) return

    const stockBaseTotal = Number(item.stockBase) || 0
    const stockUsadoOtros = carrito
        .filter((i, idx) => i.productoId === item.productoId && idx !== index)
        .reduce((sum, i) => sum + (Number(i.cantidad) * Number(i.factorConversion)), 0)

    const stockDisponibleRestante = Math.max(0, stockBaseTotal - stockUsadoOtros)
    const factor = Number(item.factorConversion) || 1

    if (factor > 0) {
        const cantMax = stockDisponibleRestante / factor
        item.cantidad = Math.max(0, Math.floor(cantMax * 1000) / 1000)
    }

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

// Renderizar Carrito
function renderCarrito() {
    const lista = document.getElementById('lista-carrito')
    const totalEl = document.getElementById('total-carrito')
    const btnCompletar = document.getElementById('btn-completar-venta')

    if (!lista || !totalEl) return
    lista.innerHTML = ''

    if (carrito.length === 0) {
        lista.innerHTML = `
            <div class="bg-slate-50 rounded-2xl p-8 text-center text-slate-400 border border-slate-200">
                <span class="text-4xl block mb-2">🛒</span>
                <p class="text-sm font-extrabold text-slate-700">El carrito está vacío</p>
                <p class="text-xs text-slate-500 mt-1">Haz clic en "+ Agregar" en los productos del catálogo</p>
            </div>
        `
        totalEl.textContent = 'Q0.00'
        if (btnCompletar) {
            btnCompletar.disabled = true
            btnCompletar.innerHTML = '<span>💳 Registrar Venta (POS)</span>'
        }
        return
    }

    let granTotal = 0
    let hayErrorStock = false

    carrito.forEach((item, index) => {
        const desc = Number(item.descuentoPorcentaje) || 0
        const precioEfectivo = item.precioVenta * (1 - desc / 100)
        const subtotal = item.cantidad * precioEfectivo
        granTotal += subtotal

        const subtotalFormateado = subtotal.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const precioFormateado = item.precioVenta.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

        // 1. Stock base disponible total del producto
        const stockBaseTotal = Number(item.stockBase) || 0

        // 2. Stock reservado por OTROS ítems del mismo producto en el carrito
        const stockUsadoOtros = carrito
            .filter((i, idx) => i.productoId === item.productoId && idx !== index)
            .reduce((sum, i) => sum + (Number(i.cantidad) * Number(i.factorConversion)), 0)

        // 3. Stock disponible restante para esta línea
        const stockDisponibleRestante = Math.max(0, stockBaseTotal - stockUsadoOtros)

        // 4. Cantidad consumida en unidad base por esta línea
        const cantidadBaseRequerida = Number(item.cantidad) * Number(item.factorConversion)

        // 5. Validación de stock excedido
        const excedeStock = cantidadBaseRequerida > (stockDisponibleRestante + 0.0001) || Number(item.cantidad) <= 0
        if (excedeStock) {
            hayErrorStock = true
        }

        const presentacionesProducto = catalogo
            .filter(p => p.productos && p.productos.id === item.productoId)
            .map(p => ({
                id: p.id,
                nombre: p.nombre_presentacion,
                factor: Number(p.factor_conversion) || 1,
                precio: Number(p.precio_venta) || 0
            }))

        let selectPresentacionesHtml = ''
        if (presentacionesProducto.length > 1) {
            selectPresentacionesHtml = `
                <select class="select-presentacion-item text-xs font-bold bg-white text-slate-800 border border-slate-300 rounded-lg px-2 py-1 outline-none focus:border-emerald-500 shrink-0" data-index="${index}">
                    ${presentacionesProducto.map(p => `
                        <option value="${p.id}" ${p.id === item.presentacionId ? 'selected' : ''}>
                            ${p.nombre} (x${p.factor}) — Q${p.precio.toFixed(2)}
                        </option>
                    `).join('')}
                </select>
            `
        } else {
            selectPresentacionesHtml = `<span class="text-xs font-bold text-emerald-700">${item.nombrePresentacion} — Q${precioFormateado} c/u</span>`
        }

        const cantidadBaseTotalStr = cantidadBaseRequerida.toFixed(3)
        const stockDisponibleStr = stockDisponibleRestante.toFixed(3)
        const unidadBaseText = item.unidadBase || 'unidad'

        lista.innerHTML += `
            <div class="p-3 bg-slate-50 border-2 ${excedeStock ? 'border-rose-500 bg-rose-50' : 'border-slate-200 hover:border-emerald-300'} rounded-2xl space-y-2.5 transition">
                <!-- Fila Superior -->
                <div class="flex items-center justify-between gap-2">
                    <div class="flex-1 min-w-0">
                        <div class="font-extrabold text-slate-900 text-sm truncate">${item.nombreProducto}</div>
                        <div class="flex items-center gap-1.5 flex-wrap mt-0.5">
                            ${selectPresentacionesHtml}
                            ${desc > 0 ? `<span class="bg-amber-100 text-amber-900 text-[10px] font-black px-1.5 py-0.5 rounded border border-amber-300">-${desc}% desc</span>` : ''}
                        </div>
                    </div>
                    <!-- Botón Vender Todo el Disponible -->
                    <button type="button" class="btn-max-item text-[10px] font-black px-2 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300 transition shrink-0 flex items-center gap-1" data-index="${index}" title="Llenar con el máximo stock disponible">
                        <span>⚡ Max</span>
                    </button>
                </div>

                <!-- Fila Media -->
                <div class="flex items-center justify-between gap-2 pt-1 border-t border-slate-200">
                    <div class="flex items-center gap-1">
                        <div class="flex items-center border-2 border-slate-300 rounded-xl overflow-hidden bg-white shadow-sm">
                            <button type="button" class="btn-restar px-2.5 py-1 text-slate-700 hover:bg-slate-100 font-black transition text-sm" data-index="${index}">-</button>
                            <input type="number" step="0.001" min="0.001" class="input-cantidad-item w-16 px-1 py-0.5 text-center text-xs font-black text-slate-900 bg-transparent outline-none border-x-2 border-slate-300" value="${item.cantidad}" data-index="${index}">
                            <button type="button" class="btn-sumar px-2.5 py-1 text-slate-700 hover:bg-slate-100 font-black transition text-sm" data-index="${index}">+</button>
                        </div>
                    </div>

                    <div class="flex items-center gap-2">
                        <div class="text-right">
                            <div class="font-black text-slate-900 text-sm">Q${subtotalFormateado}</div>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <button type="button" class="btn-descuento-item text-xs text-amber-800 hover:text-amber-900 font-extrabold transition px-2 py-0.5 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg" data-index="${index}" title="Aplicar Descuento %">
                                🏷️
                            </button>
                            <button type="button" class="btn-eliminar text-xs text-rose-700 hover:text-rose-900 font-extrabold transition px-2 py-0.5 bg-rose-100 hover:bg-rose-200 border border-rose-300 rounded-lg" data-index="${index}" title="Eliminar ítem">
                                🗑️
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Fila Inferior -->
                <div class="flex items-center justify-between text-[10px] font-bold pt-1 border-t border-slate-200">
                    <span class="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 font-mono">
                        = ${cantidadBaseTotalStr} ${unidadBaseText}
                    </span>
                    <span class="${excedeStock ? 'text-rose-600 font-black animate-pulse' : 'text-slate-500'}">
                        ${excedeStock ? `⚠️ Stock insuficiente (Disp: ${stockDisponibleStr} ${unidadBaseText})` : `Disp: ${stockDisponibleStr} ${unidadBaseText}`}
                    </span>
                </div>
            </div>
        `
    })

    const totalFormateado = granTotal.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    totalEl.textContent = `Q${totalFormateado}`

    if (btnCompletar) {
        if (hayErrorStock) {
            btnCompletar.disabled = true
            btnCompletar.innerHTML = '<span>⚠️ Ajustar Cantidad (Stock Excedido)</span>'
            btnCompletar.className = 'w-full py-3.5 px-4 rounded-2xl bg-rose-600 opacity-80 cursor-not-allowed text-white font-extrabold text-xs shadow-lg transition'
        } else {
            btnCompletar.disabled = false
            btnCompletar.innerHTML = '<span>💳 Registrar Venta (POS)</span>'
            btnCompletar.className = 'w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black text-sm shadow-md transition flex items-center justify-center gap-2'
        }
    }

    asignarEventosCarrito()
}

function asignarEventosCarrito() {
    const lista = document.getElementById('lista-carrito')
    if (!lista) return

    lista.querySelectorAll('.btn-restar').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault()
            const idx = Number(btn.getAttribute('data-index'))
            const item = carrito[idx]
            if (item) {
                if (item.cantidad > 1) {
                    item.cantidad = Math.round((item.cantidad - 1) * 1000) / 1000
                } else {
                    solicitarEliminacionItemIndex(idx)
                }
                renderCarrito()
            }
        })
    })

    lista.querySelectorAll('.btn-sumar').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault()
            const idx = Number(btn.getAttribute('data-index'))
            const item = carrito[idx]
            if (item) {
                item.cantidad = Math.round((item.cantidad + 1) * 1000) / 1000
                renderCarrito()
            }
        })
    })

    lista.querySelectorAll('.input-cantidad-item').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = Number(input.getAttribute('data-index'))
            cambiarCantidadDirecta(idx, e.target.value)
        })
    })

    lista.querySelectorAll('.select-presentacion-item').forEach(select => {
        select.addEventListener('change', (e) => {
            const idx = Number(select.getAttribute('data-index'))
            cambiarPresentacionItem(idx, e.target.value)
        })
    })

    lista.querySelectorAll('.btn-max-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault()
            const idx = Number(btn.getAttribute('data-index'))
            venderTodoElDisponible(idx)
        })
    })

    lista.querySelectorAll('.btn-descuento-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault()
            const idx = Number(btn.getAttribute('data-index'))
            const item = carrito[idx]
            if (item) solicitarDescuentoItem(item.presentacionId)
        })
    })

    lista.querySelectorAll('.btn-eliminar').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault()
            const idx = Number(btn.getAttribute('data-index'))
            solicitarEliminacionItemIndex(idx)
        })
    })
}

let listaFincasCliente = []

// 5. Cargar Clientes y Fincas para Autocomplete Datalist
async function cargarClientesPOS() {
    const datalistClientes = document.getElementById('datalist-clientes')

    try {
        const { data: clientes, error } = await supabase
            .from('clientes')
            .select('*')
            .order('nombre', { ascending: true })

        if (error) throw error

        listaClientesPOS = clientes || []
        if (datalistClientes) {
            datalistClientes.innerHTML = listaClientesPOS.map(cli => 
                `<option value="${cli.nombre}">${cli.nit ? `NIT: ${cli.nit}` : 'CF'}</option>`
            ).join('')
        }
    } catch (err) {
        console.error("Error al cargar clientes en POS:", err)
    }
}

// Evento al escribir en input-cliente
document.getElementById('input-cliente')?.addEventListener('input', async (e) => {
    const val = e.target.value.trim().toLowerCase()
    const badgeCredito = document.getElementById('badge-credito-cliente')
    const datalistFincas = document.getElementById('datalist-fincas')

    fincaSeleccionadaId = null

    const clienteEncontrado = listaClientesPOS.find(c => (c.nombre || '').toLowerCase() === val)

    if (clienteEncontrado) {
        clienteSeleccionadoId = clienteEncontrado.id

        if (badgeCredito) {
            const limite = Number(clienteEncontrado.limite_credito) || 0
            const saldo = Number(clienteEncontrado.saldo_actual) || 0
            const disponible = Math.max(0, limite - saldo)

            badgeCredito.textContent = `Crédito Disp: Q${disponible.toFixed(2)}`
            badgeCredito.className = `text-[11px] font-bold px-2 py-0.5 rounded ${disponible > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`
            badgeCredito.classList.remove('hidden')
        }

        // Cargar fincas del cliente para el datalist-fincas
        try {
            const { data: fincas } = await supabase
                .from('fincas')
                .select('*')
                .eq('cliente_id', clienteSeleccionadoId)
                .order('nombre_finca', { ascending: true })

            listaFincasCliente = fincas || []
            if (datalistFincas) {
                datalistFincas.innerHTML = listaFincasCliente.map(f => 
                    `<option value="${f.nombre_finca}">${f.ubicacion || ''}</option>`
                ).join('')
            }
        } catch (err) {
            console.error("Error al cargar fincas de cliente:", err)
        }
    } else {
        clienteSeleccionadoId = null
        badgeCredito?.classList.add('hidden')
        listaFincasCliente = []
        if (datalistFincas) datalistFincas.innerHTML = ''
    }
})

// Evento al escribir en input-finca
document.getElementById('input-finca')?.addEventListener('input', (e) => {
    const val = e.target.value.trim().toLowerCase()
    const fincaEncontrada = listaFincasCliente.find(f => (f.nombre_finca || '').toLowerCase() === val)
    if (fincaEncontrada) {
        fincaSeleccionadaId = fincaEncontrada.id
    } else {
        fincaSeleccionadaId = null
    }
})

// Selector de Método de Pago
document.querySelectorAll('.btn-pago-opt').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-pago-opt').forEach(b => {
            b.classList.remove('bg-emerald-600', 'text-white', 'shadow-md')
            b.classList.add('text-slate-700', 'hover:bg-slate-200')
        })
        btn.classList.remove('text-slate-700', 'hover:bg-slate-200')
        btn.classList.add('bg-emerald-600', 'text-white', 'shadow-md')
        tipoPagoSeleccionado = btn.getAttribute('data-tipo') || 'EFECTIVO'
    })
})

// 6. Flujo de Cobro y Registro de Venta
document.getElementById('btn-completar-venta')?.addEventListener('click', async () => {
    if (carrito.length === 0) return

    const btnCompletar = document.getElementById('btn-completar-venta')
    const textoOriginal = btnCompletar.innerHTML
    btnCompletar.innerHTML = '<span>⏳ Procesando...</span>'
    btnCompletar.disabled = true

    try {
        const totalVenta = carrito.reduce((sum, item) => {
            const desc = Number(item.descuentoPorcentaje) || 0
            const precioEfectivo = item.precioVenta * (1 - desc / 100)
            return sum + (item.cantidad * precioEfectivo)
        }, 0)

        // Determinar o auto-crear Cliente y Finca silenciosamente
        const inputClienteVal = document.getElementById('input-cliente')?.value.trim() || ''
        const inputFincaVal = document.getElementById('input-finca')?.value.trim() || ''

        let activeClienteId = clienteSeleccionadoId

        if (!activeClienteId && inputClienteVal !== '') {
            const existCli = listaClientesPOS.find(c => (c.nombre || '').toLowerCase() === inputClienteVal.toLowerCase())
            if (existCli) {
                activeClienteId = existCli.id
            } else if (navigator.onLine) {
                try {
                    const { data: newCli, error: errNewCli } = await supabase
                        .from('clientes')
                        .insert([{ nombre: inputClienteVal, nit: 'CF' }])
                        .select()
                        .single()

                    if (!errNewCli && newCli) {
                        activeClienteId = newCli.id
                        listaClientesPOS.push(newCli)
                    }
                } catch (e) {
                    console.error("Auto-creación cliente silenciosa error:", e)
                }
            }
        }

        let activeFincaId = fincaSeleccionadaId

        if (activeClienteId && !activeFincaId && inputFincaVal !== '' && navigator.onLine) {
            const existFinca = listaFincasCliente.find(f => (f.nombre_finca || '').toLowerCase() === inputFincaVal.toLowerCase())
            if (existFinca) {
                activeFincaId = existFinca.id
            } else {
                try {
                    const { data: newFinca, error: errNewFinca } = await supabase
                        .from('fincas')
                        .insert([{ cliente_id: activeClienteId, nombre_finca: inputFincaVal }])
                        .select()
                        .single()

                    if (!errNewFinca && newFinca) {
                        activeFincaId = newFinca.id
                    }
                } catch (e) {
                    console.error("Auto-creación finca silenciosa error:", e)
                }
            }
        }

        // FALLBACK MODO OFFLINE
        if (!navigator.onLine) {
            if (tipoPagoSeleccionado === 'CREDITO' && !activeClienteId) {
                alert("⚠️ No se puede realizar una venta a crédito a Consumidor Final.")
                btnCompletar.innerHTML = textoOriginal
                btnCompletar.disabled = false
                return
            }

            const localId = 'local-' + crypto.randomUUID()
            carrito.forEach(item => {
                const pres = catalogo.find(p => p.id === item.presentacionId)
                if (pres && pres.productos) {
                    pres.productos.stock_base = Math.max(0, Number(pres.productos.stock_base) - (item.cantidad * item.factorConversion))
                }
            })

            actualizarCacheCatalogoLocal()
            renderCatalogo(catalogo)

            const pendingSales = JSON.parse(localStorage.getItem('adnova_pending_sales') || '[]')
            pendingSales.push({
                id: localId,
                total: totalVenta,
                cliente_id: activeClienteId || null,
                finca_id: activeFincaId || null,
                tipo_pago: tipoPagoSeleccionado,
                carrito: [...carrito]
            })
            localStorage.setItem('adnova_pending_sales', JSON.stringify(pendingSales))

            renderizarTicket(localId, [...carrito], totalVenta)
            vaciarCarrito()

            const modalExito = document.getElementById('modal-exito')
            const detalleExito = document.getElementById('mensaje-exito-detalle')
            if (detalleExito) {
                detalleExito.textContent = `La venta offline por Q${totalVenta.toFixed(2)} se guardó localmente. Se sincronizará al recuperar internet.`
            }
            modalExito?.classList.remove('hidden')
            btnCompletar.innerHTML = textoOriginal
            btnCompletar.disabled = true
            return
        }

        // VALIDACIÓN ONLINE DE CRÉDITO
        if (tipoPagoSeleccionado === 'CREDITO') {
            if (!activeClienteId) {
                alert("⚠️ No se puede realizar una venta a crédito a Consumidor Final.")
                btnCompletar.innerHTML = textoOriginal
                btnCompletar.disabled = false
                return
            }

            const { data: clienteFresh } = await supabase
                .from('clientes')
                .select('saldo_actual, limite_credito, nombre')
                .eq('id', activeClienteId)
                .single()

            if (clienteFresh) {
                const saldoActual = Number(clienteFresh.saldo_actual) || 0
                const limiteCredito = Number(clienteFresh.limite_credito) || 0
                if ((saldoActual + totalVenta) > limiteCredito) {
                    const disponible = Math.max(0, limiteCredito - saldoActual)
                    alert(`⚠️ Límite de crédito excedido para "${clienteFresh.nombre}". Crédito disponible: Q${disponible.toFixed(2)}.`)
                    btnCompletar.innerHTML = textoOriginal
                    btnCompletar.disabled = false
                    return
                }
            }
        }

        // 1. Insert en `ventas`
        const { data: nuevaVenta, error: errorVenta } = await supabase
            .from('ventas')
            .insert([{
                total: totalVenta,
                estado_factura: 'pendiente',
                cliente_id: activeClienteId || null,
                finca_id: activeFincaId || null,
                tipo_pago: tipoPagoSeleccionado
            }])
            .select()
            .single()

        if (errorVenta) throw errorVenta

        if (tipoPagoSeleccionado === 'CREDITO' && activeClienteId) {
            const { data: cliData } = await supabase.from('clientes').select('saldo_actual').eq('id', activeClienteId).single()
            const nuevoSaldo = (Number(cliData?.saldo_actual) || 0) + totalVenta
            await supabase.from('clientes').update({ saldo_actual: nuevoSaldo }).eq('id', activeClienteId)
        }

        // 2. Bulk INSERT en `detalle_ventas` (con Snapshot de Costo Histórico)
        const detalles = carrito.map(item => {
            const desc = Number(item.descuentoPorcentaje) || 0
            const precioEfectivo = item.precioVenta * (1 - desc / 100)

            const presItem = catalogo.find(p => p.id === item.presentacionId)
            const costoBaseObj = Array.isArray(presItem?.productos?.productos_costos) 
                ? presItem?.productos?.productos_costos[0] 
                : presItem?.productos?.productos_costos
            const costoUnitarioBase = Number(costoBaseObj?.precio_costo) || 0
            const costoSnapshot = item.factorConversion * costoUnitarioBase

            return {
                venta_id: nuevaVenta.id,
                presentacion_id: item.presentacionId,
                cantidad: item.cantidad,
                subtotal: item.cantidad * precioEfectivo,
                costo_unitario: costoSnapshot
            }
        })

        const { error: errorDetalle } = await supabase
            .from('detalle_ventas')
            .insert(detalles)

        if (errorDetalle) throw errorDetalle

        // 3. Salida FEFO por RPC
        const { data: { session } } = await supabase.auth.getSession()
        const usuarioId = session?.user?.id || null

        for (const item of carrito) {
            const cantidadBase = item.cantidad * item.factorConversion
            await supabase.rpc('procesar_salida_fefo', {
                p_producto_id: item.productoId,
                p_cantidad_base: cantidadBase,
                p_referencia_id: nuevaVenta.id,
                p_usuario_id: usuarioId
            })
        }

        // 4. Ticket y Éxito
        renderizarTicket(nuevaVenta.id, [...carrito], totalVenta)
        vaciarCarrito()

        const modalExito = document.getElementById('modal-exito')
        const detalleExito = document.getElementById('mensaje-exito-detalle')
        if (detalleExito) {
            detalleExito.textContent = `Venta #${nuevaVenta.id.slice(0, 8)} completada exitosamente. Total: Q${totalVenta.toFixed(2)}.`
        }
        modalExito?.classList.remove('hidden')

        await cargarCatalogo()

    } catch (err) {
        console.error("Error al procesar la venta:", err)
        alert(`❌ Error al completar la venta: ${err.message || err}`)
    } finally {
        btnCompletar.innerHTML = textoOriginal
        btnCompletar.disabled = carrito.length === 0
    }
})

// Ticket Térmico Render
function renderizarTicket(ventaId, cartItems, total) {
    const ticketContainer = document.getElementById('ticket-impresion')
    if (!ticketContainer) return

    const shortId = (ventaId || '').slice(0, 8).toUpperCase()
    const fechaHora = new Date().toLocaleString('es-GT')
    const cajeroDisplayNombre = cajeroNombreCompleto || document.getElementById('cajero-email')?.textContent || 'Usuario'
    const valInputCli = document.getElementById('input-cliente')?.value.trim()
    const nombreClienteStr = valInputCli || 'Consumidor Final (CF)'

    const totalForm = total.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    let filasHtml = ''
    cartItems.forEach(item => {
        const desc = Number(item.descuentoPorcentaje) || 0
        const precioEfectivo = item.precioVenta * (1 - desc / 100)
        const subtotal = item.cantidad * precioEfectivo
        const subtotalForm = subtotal.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        
        filasHtml += `
            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                <span style="font-weight: bold;">${item.cantidad}x ${item.nombreProducto}</span>
                <span>Q${subtotalForm}</span>
            </div>
            <div style="font-size: 10px; color: #444; margin-bottom: 4px; padding-left: 8px;">
                ${item.nombrePresentacion} @ Q${precioEfectivo.toFixed(2)} c/u
            </div>
        `
    })

    ticketContainer.innerHTML = `
        <div style="text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
            <h2 style="font-size: 14px; font-weight: bold; margin: 0; text-transform: uppercase;">Agroservicio Campo Alto</h2>
            <p style="font-size: 10px; margin: 2px 0 0 0;">Terminal POS Vendedor</p>
        </div>

        <div style="font-size: 10px; border-bottom: 1px dashed #000; padding-bottom: 6px; margin-bottom: 8px;">
            <div><strong>Ticket No:</strong> #${shortId}</div>
            <div><strong>Fecha:</strong> ${fechaHora}</div>
            <div><strong>Atendido por:</strong> ${cajeroDisplayNombre}</div>
            <div><strong>Cliente:</strong> ${nombreClienteStr}</div>
            <div><strong>Pago:</strong> ${tipoPagoSeleccionado}</div>
        </div>

        <div style="border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
            ${filasHtml}
        </div>

        <div style="text-align: right; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
            <div style="font-size: 14px; font-weight: bold;">TOTAL: Q${totalForm}</div>
        </div>

        <div style="text-align: center; font-size: 10px; margin-top: 8px;">
            <p style="margin: 0; font-weight: bold;">*** Comprobante de Caja ***</p>
            <p style="margin: 2px 0 0 0;">¡Gracias por su compra!</p>
        </div>
    `
}

// 7. SISTEMA DE AUTORIZACIÓN DE SUPERVISOR (PIN RESTRICTED)
const modalPinSupervisor = document.getElementById('modal-pin-supervisor')
const modalPinContent = document.getElementById('modal-pin-content')
const formPinSupervisor = document.getElementById('form-pin-supervisor')
const inputPinSupervisor = document.getElementById('input-pin-supervisor')
const errorPinSupervisor = document.getElementById('error-pin-supervisor')
const descAccionPin = document.getElementById('desc-accion-pin')
const btnCancelarPin = document.getElementById('btn-cancelar-pin')
const btnAplicarDescuentoCart = document.getElementById('btn-aplicar-descuento-cart')

function mostrarToast(mensaje, tipo = 'success') {
    let container = document.getElementById('toast-container')
    if (!container) {
        container = document.createElement('div')
        container.id = 'toast-container'
        container.className = 'fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none'
        document.body.appendChild(container)
    }

    const toast = document.createElement('div')
    toast.className = `pointer-events-auto px-4 py-3 rounded-2xl text-xs font-extrabold text-white shadow-2xl flex items-center gap-2 border transition-all duration-300 transform translate-y-4 opacity-0 ${
        tipo === 'success' 
            ? 'bg-emerald-900 border-emerald-500 text-emerald-100' 
            : 'bg-rose-900 border-rose-500 text-rose-100'
    }`
    toast.innerHTML = `<span>${tipo === 'success' ? '✅' : '⚠️'}</span><span>${mensaje}</span>`
    container.appendChild(toast)

    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-4', 'opacity-0')
    })

    setTimeout(() => {
        toast.classList.add('translate-y-4', 'opacity-0')
        setTimeout(() => toast.remove(), 300)
    }, 3000)
}

function abrirModalPinSupervisor(accion, targetId, valor = null, descripcion = '') {
    if (!modalPinSupervisor) return

    modalPinSupervisor.setAttribute('data-action', accion)
    modalPinSupervisor.setAttribute('data-target', targetId || '')
    modalPinSupervisor.setAttribute('data-value', valor !== null ? String(valor) : '')

    if (descAccionPin) {
        descAccionPin.textContent = descripcion || 'Ingresa el PIN de 4 dígitos para autorizar la acción'
    }

    if (errorPinSupervisor) {
        errorPinSupervisor.classList.add('hidden')
    }

    if (inputPinSupervisor) {
        inputPinSupervisor.value = ''
    }

    modalPinSupervisor.classList.remove('hidden', 'opacity-0')
    modalPinSupervisor.classList.add('flex', 'opacity-100')

    setTimeout(() => {
        inputPinSupervisor?.focus()
    }, 100)
}

function cerrarModalPinSupervisor() {
    if (!modalPinSupervisor) return

    modalPinSupervisor.classList.add('hidden')
    modalPinSupervisor.classList.remove('flex', 'opacity-100')
    modalPinSupervisor.setAttribute('data-action', '')
    modalPinSupervisor.setAttribute('data-target', '')
    modalPinSupervisor.setAttribute('data-value', '')

    if (inputPinSupervisor) {
        inputPinSupervisor.value = ''
    }
}

function solicitarEliminacionItem(presentacionId) {
    const item = carrito.find(i => i.presentacionId === presentacionId)
    const nombreItem = item ? item.nombreProducto : 'el ítem'
    abrirModalPinSupervisor(
        'delete_item', 
        presentacionId, 
        null, 
        `Autorizar eliminación de "${nombreItem}" del carrito`
    )
}

function solicitarDescuentoItem(presentacionId) {
    const item = carrito.find(i => i.presentacionId === presentacionId)
    if (!item) return

    const actualDesc = item.descuentoPorcentaje || 0
    const pctStr = prompt(`Porcentaje de descuento para "${item.nombreProducto}" (0 - 100%):`, actualDesc ? String(actualDesc) : '10')

    if (pctStr === null) return
    const pct = parseFloat(pctStr)

    if (isNaN(pct) || pct < 0 || pct > 100) {
        alert("⚠️ Ingrese un porcentaje de descuento válido (entre 0% y 100%).")
        return
    }

    abrirModalPinSupervisor(
        'discount_item',
        presentacionId,
        pct,
        `Autorizar descuento de ${pct}% para "${item.nombreProducto}"`
    )
}

function solicitarDescuentoGlobal() {
    if (carrito.length === 0) return

    const pctStr = prompt('Porcentaje de descuento global para todo el carrito (0 - 100%):', '10')
    if (pctStr === null) return

    const pct = parseFloat(pctStr)
    if (isNaN(pct) || pct < 0 || pct > 100) {
        alert("⚠️ Ingrese un porcentaje de descuento válido (entre 0% y 100%).")
        return
    }

    abrirModalPinSupervisor(
        'discount_global',
        'cart',
        pct,
        `Autorizar descuento global de ${pct}% a todos los ítems`
    )
}

function eliminarDelCarritoDirecto(presentacionId) {
    carrito = carrito.filter(item => item.presentacionId !== presentacionId)
    renderCarrito()
}

// Form PIN Submit Engine
if (formPinSupervisor) {
    formPinSupervisor.addEventListener('submit', async (e) => {
        e.preventDefault()

        const inputPin = inputPinSupervisor ? inputPinSupervisor.value.trim() : ''

        if (!inputPin || inputPin.length !== 4 || !/^\d+$/.test(inputPin)) {
            if (errorPinSupervisor) {
                errorPinSupervisor.textContent = '⚠️ El PIN debe ser exactamente de 4 dígitos numéricos.'
                errorPinSupervisor.classList.remove('hidden')
            }
            if (modalPinContent) {
                modalPinContent.classList.remove('animate-shake')
                void modalPinContent.offsetWidth
                modalPinContent.classList.add('animate-shake')
            }
            return
        }

        const btnAutorizar = document.getElementById('btn-autorizar-pin')
        const textoOriginal = btnAutorizar ? btnAutorizar.innerHTML : 'Autorizar'
        if (btnAutorizar) {
            btnAutorizar.disabled = true
            btnAutorizar.innerHTML = '<span>⏳ Validando...</span>'
        }

        try {
            const { data: isValid, error } = await supabase.rpc('validar_pin_supervisor', { p_pin: inputPin })

            if (error) {
                console.error("Error al validar PIN de supervisor:", error)
                throw error
            }

            if (isValid === true) {
                const accion = modalPinSupervisor.getAttribute('data-action')
                const targetId = modalPinSupervisor.getAttribute('data-target')
                const valor = modalPinSupervisor.getAttribute('data-value')

                cerrarModalPinSupervisor()

                if (accion === 'delete_item') {
                    eliminarDelCarritoDirecto(targetId)
                } else if (accion === 'discount_item') {
                    const item = carrito.find(i => i.presentacionId === targetId)
                    if (item) {
                        item.descuentoPorcentaje = parseFloat(valor) || 0
                        renderCarrito()
                    }
                } else if (accion === 'discount_global') {
                    const descPct = parseFloat(valor) || 0
                    carrito.forEach(item => {
                        item.descuentoPorcentaje = descPct
                    })
                    renderCarrito()
                }

                mostrarToast("Autorización de Admin aceptada", "success")

            } else {
                if (inputPinSupervisor) {
                    inputPinSupervisor.value = ''
                }
                if (errorPinSupervisor) {
                    errorPinSupervisor.textContent = '⚠️ PIN Incorrecto.'
                    errorPinSupervisor.classList.remove('hidden')
                }
                if (modalPinContent) {
                    modalPinContent.classList.remove('animate-shake')
                    void modalPinContent.offsetWidth
                    modalPinContent.classList.add('animate-shake')
                }
                setTimeout(() => inputPinSupervisor?.focus(), 150)
            }
        } catch (err) {
            console.error("Excepción en validación de PIN:", err)
            if (errorPinSupervisor) {
                errorPinSupervisor.textContent = '⚠️ Error al verificar PIN. Verifique su conexión.'
                errorPinSupervisor.classList.remove('hidden')
            }
        } finally {
            if (btnAutorizar) {
                btnAutorizar.disabled = false
                btnAutorizar.innerHTML = textoOriginal
            }
        }
    })
}

if (btnCancelarPin) {
    btnCancelarPin.addEventListener('click', cerrarModalPinSupervisor)
}

if (btnAplicarDescuentoCart) {
    btnAplicarDescuentoCart.addEventListener('click', solicitarDescuentoGlobal)
}

// Listeners Modal Exito
document.getElementById('btn-imprimir-ticket')?.addEventListener('click', () => {
    window.print()
    document.getElementById('modal-exito')?.classList.add('hidden')
})

document.getElementById('btn-nueva-venta')?.addEventListener('click', () => {
    document.getElementById('modal-exito')?.classList.add('hidden')
})

// Inicializar la aplicación POS
document.addEventListener('DOMContentLoaded', () => {
    validarSesion()
})
