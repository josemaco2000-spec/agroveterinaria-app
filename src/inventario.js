import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

// Validar que sea el Dueño (Admin) el que está aquí
async function validarAcceso() {
    try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
            window.location.href = 'index.html'
            return
        }

        const { data: perfil, error } = await supabase
            .from('perfiles')
            .select('rol, nombre_completo')
            .eq('id', session.user.id)
            .single()

        if (error || perfil?.rol !== 'admin') {
            window.location.href = 'pos.html'
            return
        }

        const userInfoEl = document.getElementById('usuario-info') || document.getElementById('user-email')
        if (userInfoEl) {
            userInfoEl.textContent = perfil?.nombre_completo || session.user.email || 'Usuario Campo Alto'
        }

        cargarInventario()
    } catch (err) {
        console.error("Error en validarAcceso:", err)
        const userInfoEl = document.getElementById('usuario-info') || document.getElementById('user-email')
        if (userInfoEl) {
            userInfoEl.textContent = 'Usuario Campo Alto'
        }
        cargarInventario()
    }
}

// ----------------------------------------------------
// ----------------------------------------------------
// LÓGICA DEL MODAL E IMAGEN
// ----------------------------------------------------
const modal = document.getElementById('modal-producto')
const btnNuevo = document.getElementById('btn-nuevo-producto')
const btnCerrar = document.getElementById('btn-cerrar-modal')
const btnCerrarX = document.getElementById('btn-cerrar-modal-x')

const dropzone = document.getElementById('dropzone-imagen')
const fileInput = document.getElementById('prod-imagen')
const previewContainer = document.getElementById('preview-imagen')

const defaultPreviewHtml = `
    <svg class="w-8 h-8 text-slate-500 group-hover:text-emerald-400 transition-colors mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
    </svg>
    <span class="text-xs text-slate-400 font-medium group-hover:text-slate-200">Haz clic para seleccionar una imagen</span>
    <span class="text-[10px] text-slate-500 mt-0.5">PNG, JPG, WEBP</span>
`

function resetPreviewImagen() {
    if (previewContainer) previewContainer.innerHTML = defaultPreviewHtml
    if (fileInput) fileInput.value = ''
}

dropzone?.addEventListener('click', () => {
    fileInput?.click()
})

fileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0]
    if (file) {
        const reader = new FileReader()
        reader.onload = (evt) => {
            if (previewContainer) {
                previewContainer.innerHTML = `
                    <div class="relative group/preview w-full flex items-center justify-center">
                        <img src="${evt.target.result}" class="h-24 max-w-full object-cover rounded-xl border border-emerald-500/40 shadow-md">
                        <span class="absolute bottom-1 right-1 bg-black/70 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-md backdrop-blur-xs">
                            ✓ Seleccionada
                        </span>
                    </div>
                `
            }
        }
        reader.readAsDataURL(file)
    } else {
        resetPreviewImagen()
    }
})

function abrirModal() {
    modal.classList.remove('hidden')
    modal.classList.add('flex')
}

function cerrarModal() {
    modal.classList.add('hidden')
    modal.classList.remove('flex')
    resetPreviewImagen()
}

btnNuevo?.addEventListener('click', abrirModal)
btnCerrar?.addEventListener('click', cerrarModal)
btnCerrarX?.addEventListener('click', cerrarModal)

// Cerrar modal al hacer clic en el fondo oscuro
modal?.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModal()
})

// Cerrar modal al presionar la tecla Esc
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        cerrarModal()
    }
})

// ----------------------------------------------------
// GUARDAR EL PRODUCTO (Inserción Múltiple: productos, costos, lotes, movimientos)
// ----------------------------------------------------
document.getElementById('form-producto')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const btnGuardar = document.getElementById('btn-guardar')
    const textoOriginal = btnGuardar.textContent
    btnGuardar.textContent = 'Guardando...'
    btnGuardar.disabled = true

    const nombre = document.getElementById('prod-nombre').value.trim()
    const codigo = document.getElementById('prod-codigo').value.trim() || null
    const categoria = document.getElementById('prod-categoria').value
    const unidad = document.getElementById('prod-unidad').value
    const stock = parseFloat(document.getElementById('prod-stock').value) || 0
    const costo = parseFloat(document.getElementById('prod-costo').value) || 0
    const precioVenta = parseFloat(document.getElementById('prod-precio-venta')?.value) || 0
    const esAfectoIva = document.getElementById('prod-afecto-iva')?.value !== 'false'
    const numeroLote = document.getElementById('prod-lote').value.trim()
    const fechaVencimiento = document.getElementById('prod-vencimiento').value

    try {
        const { data: { session } } = await supabase.auth.getSession()

        // Upload imagen si existe
        let imagenUrl = null
        const file = fileInput?.files?.[0]
        if (file) {
            btnGuardar.textContent = 'Subiendo imagen...'
            const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
            const filePath = `prod_${Date.now()}_${cleanFileName}`
            
            const { data: storageData, error: storageError } = await supabase.storage
                .from('productos-imagenes')
                .upload(filePath, file)

            if (storageError) {
                console.error("Error al subir imagen a Supabase Storage:", storageError)
                throw new Error(`Error al subir imagen: ${storageError.message || storageError}`)
            }

            const { data: urlData } = supabase.storage
                .from('productos-imagenes')
                .getPublicUrl(filePath)

            imagenUrl = urlData?.publicUrl || null
        }

        btnGuardar.textContent = 'Guardando producto...'

        // 1. Guardar en la tabla de productos
        const { data: nuevoProducto, error: errorProducto } = await supabase
            .from('productos')
            .insert([{ 
                nombre: nombre, 
                codigo_barras: codigo, 
                categoria: categoria, 
                unidad_base: unidad, 
                stock_base: stock,
                imagen_url: imagenUrl,
                es_afecto_iva: esAfectoIva
            }])
            .select()
            .single()

        if (errorProducto) throw errorProducto

        // 2. Guardar el precio de costo en productos_costos
        const { error: errorCosto } = await supabase
            .from('productos_costos')
            .insert([{ 
                producto_id: nuevoProducto.id, 
                precio_costo: costo 
            }])

        if (errorCosto) console.error("Error al registrar costo:", errorCosto)

        // 3. Guardar el primer lote con vencimiento (FEFO)
        const { data: nuevoLote, error: errorLote } = await supabase
            .from('lotes')
            .insert([{
                producto_id: nuevoProducto.id,
                numero_lote: numeroLote,
                fecha_vencimiento: fechaVencimiento,
                stock_inicial: stock,
                stock_actual: stock
            }])
            .select()
            .single()

        if (errorLote) console.error("Error al crear lote:", errorLote)

        // 4. Registrar movimiento de inventario en Kardex (ENTRADA_COMPRA en Bodega Central)
        const { error: errorKardex } = await supabase
            .from('movimientos_inventario')
            .insert([{
                producto_id: nuevoProducto.id,
                lote_id: nuevoLote?.id || null,
                ubicacion_id: '11111111-1111-1111-1111-111111111111',
                tipo_movimiento: 'ENTRADA_COMPRA',
                cantidad: stock,
                usuario_id: session?.user?.id || null
            }])

        if (errorKardex) console.error("Error al registrar movimiento Kardex:", errorKardex)

        // 5. Crear la presentación base inicial para que aparezca de inmediato en el POS
        const nombrePresentacionBase = unidad ? (unidad.charAt(0).toUpperCase() + unidad.slice(1)) : 'Unidad'
        const { error: errorPres } = await supabase
            .from('presentaciones')
            .insert([{
                producto_id: nuevoProducto.id,
                nombre_presentacion: nombrePresentacionBase,
                factor_conversion: 1,
                precio_venta: precioVenta
            }])

        if (errorPres) console.error("Error al registrar presentación base para el POS:", errorPres)

        alert('¡Producto, costo, presentación para el POS, lote inicial (FEFO) y Kardex registrados con éxito!')
        document.getElementById('form-producto').reset()
        resetPreviewImagen()
        cerrarModal()
        cargarInventario()

    } catch (error) {
        console.error("Error al guardar producto:", error)
        alert("Hubo un error al guardar: " + (error.message || error))
    } finally {
        btnGuardar.textContent = textoOriginal
        btnGuardar.disabled = false
    }
})

// ----------------------------------------------------
// AUTO-REPARAR PRODUCTOS EXISTENTES SIN PRESENTACIÓN
// ----------------------------------------------------
async function asegurarPresentacionesDefecto() {
    try {
        const { data: productosSinPres } = await supabase
            .from('productos')
            .select(`
                id,
                unidad_base,
                productos_costos (precio_costo),
                presentaciones (id)
            `)

        if (!productosSinPres) return

        const aReparar = productosSinPres.filter(p => !p.presentaciones || p.presentaciones.length === 0)
        for (const p of aReparar) {
            const costoArr = p.productos_costos || []
            const costo = costoArr.length > 0 ? (Number(costoArr[0].precio_costo) || 0) : 0
            const precioVentaSugerido = costo > 0 ? (costo * 1.25) : 10
            const nombrePres = p.unidad_base ? (p.unidad_base.charAt(0).toUpperCase() + p.unidad_base.slice(1)) : 'Unidad'

            await supabase
                .from('presentaciones')
                .insert([{
                    producto_id: p.id,
                    nombre_presentacion: nombrePres,
                    factor_conversion: 1,
                    precio_venta: precioVentaSugerido
                }])
        }
    } catch (e) {
        console.warn("Auto-reparación de presentaciones:", e)
    }
}

// ----------------------------------------------------
// CARGAR LA TABLA DE INVENTARIO
// ----------------------------------------------------
async function cargarInventario() {
    const tbody = document.getElementById('tabla-productos')
    const countBadge = document.getElementById('total-productos-count')
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">Cargando inventario...</td></tr>'
    if (countBadge) countBadge.textContent = 'Cargando...'

    try {
        await asegurarPresentacionesDefecto()

        const { data: stockUbicaciones } = await supabase
            .from('v_stock_productos_ubicacion')
            .select('*')

        const ubicacionesMap = {}
        if (stockUbicaciones) {
            stockUbicaciones.forEach(s => {
                if (!ubicacionesMap[s.producto_id]) ubicacionesMap[s.producto_id] = {}
                ubicacionesMap[s.producto_id][s.ubicacion_nombre] = Number(s.stock_disponible) || 0
            })
        }

        const { data: productos, error } = await supabase
            .from('productos')
            .select(`
                *,
                productos_costos (precio_costo)
            `)
            .order('created_at', { ascending: false })

        if (error) throw error

        if (countBadge) {
            countBadge.textContent = `${productos ? productos.length : 0} productos`
        }

        if (tbody) {
            tbody.innerHTML = ''

            if (!productos || productos.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="p-0">
                            <div class="py-12 px-6 rounded-3xl bg-forest-950/40 border border-dashed border-emerald-500/20 text-center flex flex-col items-center justify-center my-2">
                                <svg class="w-16 h-16 text-slate-400 dark:text-slate-500 mb-3 stroke-[1.2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path>
                                </svg>
                                <p class="text-xs text-slate-400 dark:text-slate-500 font-medium">No hay productos registrados en Agrovet Campo Alto aún.</p>
                            </div>
                        </td>
                    </tr>`
                return
            }

    productos.forEach(prod => {
        const costoObj = Array.isArray(prod.productos_costos) ? prod.productos_costos[0] : prod.productos_costos
        const costoNum = costoObj && costoObj.precio_costo !== undefined ? Number(costoObj.precio_costo) : 0
        const costoFormateado = costoNum.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

        const stockTotal = Number(prod.stock_base) || 0
        const stockPos = ubicacionesMap[prod.id]?.['Área de Venta'] ?? 0
        const stockBodega = Math.max(0, stockTotal - stockPos)

        const imgHtml = prod.imagen_url 
            ? `<img src="${prod.imagen_url}" alt="${prod.nombre}" class="w-10 h-10 object-cover rounded-xl border border-slate-700/80 shadow-sm shrink-0">`
            : `<div class="w-10 h-10 rounded-xl bg-forest-950 border border-slate-800 flex items-center justify-center text-slate-500 shrink-0" title="Sin imagen">
                <svg class="w-5 h-5 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                </svg>
               </div>`

        tbody.innerHTML += `
            <tr class="glass-panel glass-panel-hover rounded-2xl transition-all duration-200 shadow-sm text-slate-800 dark:text-slate-200 group">
                <td class="p-3.5 pl-6">${imgHtml}</td>
                <td class="p-3.5">
                    <div class="font-bold text-slate-900 dark:text-white">${prod.nombre}</div>
                    <div class="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">${prod.codigo_barras ? '📦 ' + prod.codigo_barras : 'Sin código'}</div>
                </td>
                <td class="p-3.5">
                    <span class="inline-block bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/20 text-xs px-2.5 py-1 rounded-full font-bold">${prod.categoria || 'General'}</span>
                </td>
                <td class="p-3.5 font-semibold text-slate-700 dark:text-slate-200">
                    <div class="font-bold text-slate-900 dark:text-white">${stockTotal.toFixed(2)} ${prod.unidad_base}</div>
                    <div class="flex items-center gap-1.5 flex-wrap mt-1 text-[10px]">
                        <span class="px-2 py-0.5 rounded bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/20 font-mono font-bold" title="Stock en Bodega Central">
                            🏢 Bodega: ${stockBodega.toFixed(2)}
                        </span>
                        <span class="px-2 py-0.5 rounded ${stockPos > 0 ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20' : 'bg-slate-800 text-slate-400 border border-slate-700'} font-mono font-bold" title="Stock disponible para el POS">
                            🛒 POS: ${stockPos.toFixed(2)}
                        </span>
                    </div>
                </td>
                <td class="p-3.5 font-extrabold text-rose-600 dark:text-rose-400">
                    Q${costoFormateado}
                </td>
                <td class="p-3.5 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button class="btn-abrir-presentaciones bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl shadow transition inline-flex items-center gap-1"
                                data-id="${prod.id}"
                                data-nombre="${prod.nombre}"
                                data-unidad="${prod.unidad_base || ''}">\n                            \u2699\ufe0f Presentaciones
                        </button>
                        <button class="btn-abrir-kardex bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl shadow transition inline-flex items-center gap-1" data-id="${prod.id}" data-nombre="${prod.nombre}">
                            📋 Lotes / Kardex
                        </button>
                    </div>
                </td>
            </tr>
        `
    })

    tbody.querySelectorAll('.btn-abrir-presentaciones').forEach(btn => {
        btn.addEventListener('click', () => {
            abrirModalPresentaciones(
                btn.getAttribute('data-id'),
                btn.getAttribute('data-nombre'),
                btn.getAttribute('data-unidad') || ''
            )
        })
    })

        tbody.querySelectorAll('.btn-abrir-kardex').forEach(btn => {
            btn.addEventListener('click', () => {
                abrirModalKardex(btn.getAttribute('data-id'), btn.getAttribute('data-nombre'))
            })
        })
    }
    } catch (err) {
        console.error("Error cargando inventario:", err)
        if (countBadge) countBadge.textContent = 'Error al cargar'
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-red-500 font-semibold">Error al cargar productos: ${err.message || err}</td></tr>`
        }
    }
}

// ----------------------------------------------------
// LÓGICA DEL MODAL DE PRESENTACIONES
// ----------------------------------------------------
let productoSeleccionadoId = null
let productoUnidadBase = ''  // Unidad base del producto activo en el modal de presentaciones
const modalPres = document.getElementById('modal-presentaciones')
const btnCerrarPres = document.getElementById('btn-cerrar-modal-pres')
const btnCerrarPresX = document.getElementById('btn-cerrar-modal-pres-x')
const presProductoNombre = document.getElementById('pres-producto-nombre')
const formPresentacion = document.getElementById('form-presentacion')
const tablaPresentaciones = document.getElementById('tabla-presentaciones')

// ---  abrirModalPresentaciones  ---
// Recibe la unidad base del producto para mostrarla en el modal y guiar el factor de conversión
function abrirModalPresentaciones(id, nombre, unidadBase) {
    productoSeleccionadoId = id
    productoUnidadBase = (unidadBase || '').trim()

    // Nombre del producto
    presProductoNombre.textContent = nombre

    // Badge unidad base
    const badge = document.getElementById('pres-unidad-base-badge')
    const badgeTexto = document.getElementById('pres-unidad-base-texto')
    if (badge && badgeTexto) {
        if (productoUnidadBase) {
            badgeTexto.textContent = productoUnidadBase
            badge.classList.remove('hidden')
        } else {
            badge.classList.add('hidden')
        }
    }

    // Label y hint del campo Factor de Conversión
    const labelFactor = document.getElementById('label-pres-factor')
    const hintFactor = document.getElementById('pres-factor-hint')
    if (labelFactor) {
        labelFactor.textContent = productoUnidadBase
            ? `Factor de conversión (¿Cuántas ${productoUnidadBase} contiene?)`
            : 'Factor de conversión'
    }
    if (hintFactor) {
        if (productoUnidadBase) {
            hintFactor.textContent = `Ej: si el producto es "Quintal" y la unidad base es "${productoUnidadBase}", ingresa 100. Si es la unidad base exacta, ingresa 1.`
            hintFactor.classList.remove('hidden')
        } else {
            hintFactor.classList.add('hidden')
        }
    }

    modalPres.classList.remove('hidden')
    cargarPresentaciones(id)
}

function cerrarModalPresentaciones() {
    modalPres.classList.add('hidden')
    productoSeleccionadoId = null
    formPresentacion.reset()
}

btnCerrarPres?.addEventListener('click', cerrarModalPresentaciones)
btnCerrarPresX?.addEventListener('click', cerrarModalPresentaciones)

modalPres?.addEventListener('click', (e) => {
    if (e.target === modalPres) cerrarModalPresentaciones()
})

// ----------------------------------------------------
// LÓGICA DEL MODAL DE LOTES Y KARDEX
// ----------------------------------------------------
const modalKardex = document.getElementById('modal-kardex')
const btnCerrarKardex = document.getElementById('btn-cerrar-modal-kardex')
const btnCerrarKardexX = document.getElementById('btn-cerrar-modal-kardex-x')
const kardexProductoNombre = document.getElementById('kardex-producto-nombre')
const tablaLotesProducto = document.getElementById('tabla-lotes-producto')
const tablaMovimientosKardex = document.getElementById('tabla-movimientos-kardex')

async function abrirModalKardex(id, nombre) {
    kardexProductoNombre.textContent = nombre
    modalKardex.classList.remove('hidden')
    await Promise.all([
        cargarLotesDeProducto(id),
        cargarKardexDeProducto(id)
    ])
}

function cerrarModalKardex() {
    modalKardex.classList.add('hidden')
}

btnCerrarKardex?.addEventListener('click', cerrarModalKardex)
btnCerrarKardexX?.addEventListener('click', cerrarModalKardex)

modalKardex?.addEventListener('click', (e) => {
    if (e.target === modalKardex) cerrarModalKardex()
})

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!modalPres.classList.contains('hidden')) cerrarModalPresentaciones()
        if (!modalKardex.classList.contains('hidden')) cerrarModalKardex()
    }
})

// Cargar Lotes del Producto
async function cargarLotesDeProducto(productoId) {
    tablaLotesProducto.innerHTML = '<tr><td colspan="5" class="p-3 text-center text-gray-400">Cargando lotes...</td></tr>'

    try {
        const { data: lotes, error } = await supabase
            .from('lotes')
            .select('*')
            .eq('producto_id', productoId)
            .order('fecha_vencimiento', { ascending: true })

        if (error) throw error

        tablaLotesProducto.innerHTML = ''

        if (!lotes || lotes.length === 0) {
            tablaLotesProducto.innerHTML = '<tr><td colspan="5" class="p-3 text-center text-gray-400 italic">No hay lotes registrados para este producto.</td></tr>'
            return
        }

        const hoy = new Date()

        lotes.forEach(lote => {
            const fechaVenc = new Date(lote.fecha_vencimiento)
            const esVencido = fechaVenc < hoy
            const badgeEstado = esVencido 
                ? '<span class="bg-red-100 text-red-800 text-[10px] font-bold px-2 py-0.5 rounded">⚠️ Vencido</span>'
                : Number(lote.stock_actual) > 0
                ? '<span class="bg-green-100 text-green-800 text-[10px] font-bold px-2 py-0.5 rounded">✓ Activo FEFO</span>'
                : '<span class="bg-gray-100 text-gray-600 text-[10px] font-medium px-2 py-0.5 rounded">Agotado</span>'

            tablaLotesProducto.innerHTML += `
                <tr class="hover:bg-gray-50">
                    <td class="p-3 font-mono font-bold text-gray-800">${lote.numero_lote}</td>
                    <td class="p-3 font-medium text-gray-700">${lote.fecha_vencimiento}</td>
                    <td class="p-3 font-medium text-gray-600">${lote.stock_inicial}</td>
                    <td class="p-3 font-bold ${Number(lote.stock_actual) > 0 ? 'text-green-700' : 'text-gray-400'}">${lote.stock_actual}</td>
                    <td class="p-3">${badgeEstado}</td>
                </tr>
            `
        })
    } catch (err) {
        console.error("Error al cargar lotes:", err)
        tablaLotesProducto.innerHTML = `<tr><td colspan="5" class="p-3 text-center text-red-500">Error: ${err.message}</td></tr>`
    }
}

// Cargar Historial Kardex
async function cargarKardexDeProducto(productoId) {
    tablaMovimientosKardex.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-gray-400">Cargando Kardex...</td></tr>'

    try {
        const { data: movs, error } = await supabase
            .from('movimientos_inventario')
            .select(`
                *,
                lotes (
                    numero_lote
                )
            `)
            .eq('producto_id', productoId)
            .order('created_at', { ascending: false })

        if (error) throw error

        tablaMovimientosKardex.innerHTML = ''

        if (!movs || movs.length === 0) {
            tablaMovimientosKardex.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-gray-400 italic">No hay movimientos registrados en Kardex.</td></tr>'
            return
        }

        movs.forEach(m => {
            const fechaStr = new Date(m.created_at).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })
            const esEntrada = m.tipo_movimiento === 'ENTRADA_COMPRA'
            const badgeTipo = esEntrada 
                ? '<span class="text-green-700 font-bold">📥 ENTRADA COMPRA</span>'
                : '<span class="text-red-600 font-bold">📤 SALIDA VENTA (FEFO)</span>'

            const numLote = m.lotes?.numero_lote || '--'

            tablaMovimientosKardex.innerHTML += `
                <tr class="hover:bg-gray-50">
                    <td class="p-3 text-gray-500 font-mono">${fechaStr}</td>
                    <td class="p-3">${badgeTipo}</td>
                    <td class="p-3 font-mono font-medium text-gray-700">${numLote}</td>
                    <td class="p-3 text-right font-extrabold ${esEntrada ? 'text-green-700' : 'text-red-600'}">
                        ${esEntrada ? '+' : '-'}${m.cantidad}
                    </td>
                </tr>
            `
        })
    } catch (err) {
        console.error("Error al cargar Kardex:", err)
        tablaMovimientosKardex.innerHTML = `<tr><td colspan="4" class="p-3 text-center text-red-500">Error: ${err.message}</td></tr>`
    }
}

// Cargar presentaciones de un producto
async function cargarPresentaciones(productoId) {
    tablaPresentaciones.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500">Cargando presentaciones...</td></tr>'

    const { data: presentaciones, error } = await supabase
        .from('presentaciones')
        .select('*')
        .eq('producto_id', productoId)
        .order('created_at', { ascending: true })

    if (error) {
        console.error("Error al cargar presentaciones:", error)
        tablaPresentaciones.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-red-500">Error: ${error.message}</td></tr>`
        return
    }

    tablaPresentaciones.innerHTML = ''

    if (!presentaciones || presentaciones.length === 0) {
        tablaPresentaciones.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500 italic">No hay presentaciones registradas para este producto.</td></tr>'
        return
    }

    presentaciones.forEach(pres => {
        const precioNum = Number(pres.precio_venta) || 0
        const precioFormateado = precioNum.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

        tablaPresentaciones.innerHTML += `
            <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
                <td class="p-3 font-medium text-gray-800">${pres.nombre_presentacion}</td>
                <td class="p-3 font-mono text-gray-600">${pres.factor_conversion}</td>
                <td class="p-3 font-bold text-green-700">Q${precioFormateado}</td>
                <td class="p-3 text-center">
                    <button class="btn-eliminar-pres bg-red-100 hover:bg-red-200 text-red-700 text-xs font-semibold px-2.5 py-1 rounded transition inline-flex items-center gap-1" data-id="${pres.id}">
                        🗑️ Eliminar
                    </button>
                </td>
            </tr>
        `
    })

    tablaPresentaciones.querySelectorAll('.btn-eliminar-pres').forEach(btn => {
        btn.addEventListener('click', async () => {
            const presId = btn.getAttribute('data-id')
            if (confirm("¿Estás seguro de eliminar esta presentación de venta?")) {
                await eliminarPresentacion(presId)
            }
        })
    })
}

// Guardar nueva presentación
formPresentacion?.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!productoSeleccionadoId) return

    const btnGuardarPres = document.getElementById('btn-guardar-pres')
    const textoOrig = btnGuardarPres.textContent
    btnGuardarPres.textContent = 'Guardando...'
    btnGuardarPres.disabled = true

    const nombrePresentacion = document.getElementById('pres-nombre').value.trim()

    // --- REGLA DE FACTOR ---
    // Si el nombre de presentación coincide (ignorando mayúsculas) con la unidad base del producto,
    // forzar factor = 1 para evitar errores de configuración (ej. crear "Libra" con factor 100).
    const esUnidadBase = productoUnidadBase &&
        nombrePresentacion.toLowerCase() === productoUnidadBase.toLowerCase()
    const factorConversion = esUnidadBase
        ? 1
        : (parseFloat(document.getElementById('pres-factor').value) || 1)
    const precioVenta = parseFloat(document.getElementById('pres-precio').value) || 0

    try {
        const { error } = await supabase
            .from('presentaciones')
            .insert([{
                producto_id: productoSeleccionadoId,
                nombre_presentacion: nombrePresentacion,
                factor_conversion: factorConversion,
                precio_venta: precioVenta
            }])

        if (error) throw error

        formPresentacion.reset()
        await cargarPresentaciones(productoSeleccionadoId)
    } catch (err) {
        console.error("Error guardando presentación:", err)
        alert("Error al agregar la presentación: " + (err.message || err))
    } finally {
        btnGuardarPres.textContent = textoOrig
        btnGuardarPres.disabled = false
    }
})

// Eliminar presentación
async function eliminarPresentacion(presId) {
    try {
        const { error } = await supabase
            .from('presentaciones')
            .delete()
            .eq('id', presId)

        if (error) throw error

        await cargarPresentaciones(productoSeleccionadoId)
    } catch (err) {
        console.error("Error eliminando presentación:", err)
        alert("Error al eliminar la presentación: " + (err.message || err))
    }
}

// ----------------------------------------------------
// CALCULADORA DE MARGEN EN TIEMPO REAL
// ----------------------------------------------------
const inputCosto = document.getElementById('prod-costo')
const inputMargenPct = document.getElementById('prod-margen-pct')
const inputPrecioVenta = document.getElementById('prod-precio-venta')
const badgeMargen = document.getElementById('preview-margen-badge')

function actualizarCalculadoraMargen(origen = 'costo') {
    if (!inputCosto || !inputPrecioVenta || !badgeMargen) return
    const costo = parseFloat(inputCosto.value) || 0
    let margenPct = parseFloat(inputMargenPct?.value) || 0
    let precioVenta = parseFloat(inputPrecioVenta.value) || 0

    if (origen === 'costo' || origen === 'margen') {
        if (costo > 0) {
            precioVenta = costo * (1 + (margenPct / 100))
            inputPrecioVenta.value = precioVenta.toFixed(2)
        }
    } else if (origen === 'precio') {
        if (costo > 0 && precioVenta >= costo) {
            margenPct = ((precioVenta - costo) / costo) * 100
            if (inputMargenPct) inputMargenPct.value = margenPct.toFixed(1)
        }
    }

    const margenQ = precioVenta - costo
    const margenRealPct = precioVenta > 0 ? ((margenQ / precioVenta) * 100) : 0
    badgeMargen.textContent = `Margen: Q${margenQ.toFixed(2)} (${margenRealPct.toFixed(1)}% de venta)`
}

inputCosto?.addEventListener('input', () => actualizarCalculadoraMargen('costo'))
inputMargenPct?.addEventListener('input', () => actualizarCalculadoraMargen('margen'))
inputPrecioVenta?.addEventListener('input', () => actualizarCalculadoraMargen('precio'))

// ----------------------------------------------------
// GESTIÓN DE TRASLADOS ENTRE UBICACIONES
// ----------------------------------------------------
const modalTraslado = document.getElementById('modal-traslado')
const modalHistorial = document.getElementById('modal-historial-traslados')
const btnAbrirTraslado = document.getElementById('btn-abrir-traslado')
const btnVerHistorial = document.getElementById('btn-ver-historial-traslados')

const selectOrigen = document.getElementById('traslado-origen')
const selectDestino = document.getElementById('traslado-destino')
const selectProductoTraslado = document.getElementById('traslado-producto')
const selectLoteTraslado = document.getElementById('traslado-lote')
const inputCantTraslado = document.getElementById('traslado-cantidad')
const selectPresTraslado = document.getElementById('traslado-presentacion')
const previewBaseTraslado = document.getElementById('preview-traslado-base')
const formTraslado = document.getElementById('form-traslado')
const tablaHistorialTraslados = document.getElementById('tabla-historial-traslados')

function abrirModalTraslado() {
    if (modalTraslado) {
        modalTraslado.classList.remove('hidden')
        modalTraslado.classList.add('flex')
        cargarProductosTraslado()
    }
}

function cerrarModalTraslado() {
    if (modalTraslado) {
        modalTraslado.classList.add('hidden')
        modalTraslado.classList.remove('flex')
    }
}

function abrirModalHistorial() {
    if (modalHistorial) {
        modalHistorial.classList.remove('hidden')
        modalHistorial.classList.add('flex')
        cargarHistorialTraslados()
    }
}

function cerrarModalHistorial() {
    if (modalHistorial) {
        modalHistorial.classList.add('hidden')
        modalHistorial.classList.remove('flex')
    }
}

btnAbrirTraslado?.addEventListener('click', abrirModalTraslado)
btnVerHistorial?.addEventListener('click', abrirModalHistorial)

document.getElementById('btn-cerrar-modal-traslado')?.addEventListener('click', cerrarModalTraslado)
document.getElementById('btn-cerrar-modal-traslado-x')?.addEventListener('click', cerrarModalTraslado)
document.getElementById('btn-cerrar-modal-historial')?.addEventListener('click', cerrarModalHistorial)
document.getElementById('btn-cerrar-modal-historial-x')?.addEventListener('click', cerrarModalHistorial)

let productosTrasladoCache = []
let lotesOrigenCache = []

async function cargarProductosTraslado() {
    if (!selectProductoTraslado) return
    selectProductoTraslado.innerHTML = '<option value="">Cargando productos...</option>'

    const { data, error } = await supabase
        .from('productos')
        .select('id, nombre, unidad_base')
        .order('nombre', { ascending: true })

    if (error) {
        console.error("Error al cargar productos para traslado:", error)
        return
    }

    productosTrasladoCache = data || []
    selectProductoTraslado.innerHTML = '<option value="">-- Seleccionar producto --</option>'
    productosTrasladoCache.forEach(p => {
        selectProductoTraslado.innerHTML += `<option value="${p.id}">${p.nombre} (${p.unidad_base})</option>`
    })
}

selectProductoTraslado?.addEventListener('change', async (e) => {
    const prodId = e.target.value
    if (!prodId) return

    const { data: presentaciones } = await supabase
        .from('presentaciones')
        .select('*')
        .eq('producto_id', prodId)

    if (selectPresTraslado) {
        const prodObj = productosTrasladoCache.find(p => p.id === prodId)
        selectPresTraslado.innerHTML = `<option value="1">Unidad Base (${prodObj?.unidad_base || 'unidad'}) x1</option>`
        if (presentaciones) {
            presentaciones.forEach(pres => {
                selectPresTraslado.innerHTML += `<option value="${pres.factor_conversion}">${pres.nombre_presentacion} (x${pres.factor_conversion})</option>`
            })
        }
    }

    cargarLotesOrigen(prodId)
})

selectOrigen?.addEventListener('change', () => {
    const prodId = selectProductoTraslado?.value
    if (prodId) cargarLotesOrigen(prodId)
})

async function cargarLotesOrigen(productoId) {
    if (!selectLoteTraslado) return
    const origenId = selectOrigen?.value || '11111111-1111-1111-1111-111111111111'

    selectLoteTraslado.innerHTML = '<option value="">Cargando lotes disponibles...</option>'

    // 1. Consultar vista de stock por lotes y ubicación
    const { data: lotesUbic } = await supabase
        .from('v_stock_lotes_ubicacion')
        .select('*')
        .eq('producto_id', productoId)
        .eq('ubicacion_id', origenId)
        .gt('stock_actual', 0)
        .order('fecha_vencimiento', { ascending: true })

    lotesOrigenCache = lotesUbic || []

    // 2. Fallback resiliente: Si el origen es Bodega Central y aún no existen filas de movimientos en la vista, consultar la tabla 'lotes' directamente
    if (lotesOrigenCache.length === 0 && origenId === '11111111-1111-1111-1111-111111111111') {
        const { data: lotesDirectos } = await supabase
            .from('lotes')
            .select('*')
            .eq('producto_id', productoId)
            .gt('stock_actual', 0)
            .order('fecha_vencimiento', { ascending: true })

        if (lotesDirectos && lotesDirectos.length > 0) {
            lotesOrigenCache = lotesDirectos.map(l => ({
                lote_id: l.id,
                numero_lote: l.numero_lote,
                stock_actual: l.stock_actual,
                fecha_vencimiento: l.fecha_vencimiento
            }))
        }
    }

    selectLoteTraslado.innerHTML = ''

    if (lotesOrigenCache.length === 0) {
        selectLoteTraslado.innerHTML = '<option value="">Sin lotes con stock en esta ubicación</option>'
        return
    }

    lotesOrigenCache.forEach(l => {
        selectLoteTraslado.innerHTML += `
            <option value="${l.lote_id}">
                Lote: ${l.numero_lote} | Stock Disp: ${Number(l.stock_actual).toFixed(2)} | Vence: ${l.fecha_vencimiento}
            </option>
        `
    })
}

function calcularBaseTraslado() {
    if (!inputCantTraslado || !selectPresTraslado || !previewBaseTraslado) return
    const cant = parseFloat(inputCantTraslado.value) || 0
    const factor = parseFloat(selectPresTraslado.value) || 1
    const totalBase = cant * factor
    const prodObj = productosTrasladoCache.find(p => p.id === selectProductoTraslado?.value)
    const unidadText = prodObj?.unidad_base || 'unidad'
    previewBaseTraslado.textContent = `${totalBase.toFixed(2)} ${unidadText}`
}

inputCantTraslado?.addEventListener('input', calcularBaseTraslado)
selectPresTraslado?.addEventListener('change', calcularBaseTraslado)

formTraslado?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const origenId = selectOrigen.value
    const destinoId = selectDestino.value
    const prodId = selectProductoTraslado.value
    const loteId = selectLoteTraslado.value
    const cant = parseFloat(inputCantTraslado.value) || 0
    const factor = parseFloat(selectPresTraslado.value) || 1

    if (origenId === destinoId) {
        alert("⚠️ La ubicación de origen y destino no pueden ser iguales.")
        return
    }

    const cantidadBaseTotal = Math.round((cant * factor) * 1000) / 1000

    if (cantidadBaseTotal <= 0) {
        alert("⚠️ Ingrese una cantidad a trasladar válida.")
        return
    }

    try {
        const { data: { session } } = await supabase.auth.getSession()

        const { data: trasladoId, error } = await supabase.rpc('realizar_traslado_inventario', {
            p_producto_id: prodId,
            p_lote_id: loteId,
            p_ubicacion_origen_id: origenId,
            p_ubicacion_destino_id: destinoId,
            p_cantidad_base: cantidadBaseTotal,
            p_usuario_id: session?.user?.id || null
        })

        if (error) throw error

        alert("✅ Traslado atómico completado con éxito.")
        cerrarModalTraslado()
        cargarInventario()
    } catch (err) {
        console.error("Error al ejecutar traslado:", err)
        alert("Error al ejecutar traslado: " + (err.message || err))
    }
})

async function cargarHistorialTraslados() {
    if (!tablaHistorialTraslados) return
    tablaHistorialTraslados.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-400">Cargando historial de traslados...</td></tr>'

    const { data: traslados, error } = await supabase
        .from('movimientos_inventario')
        .select(`
            *,
            productos (nombre, unidad_base),
            lotes (numero_lote),
            ubicaciones (nombre)
        `)
        .eq('tipo_movimiento', 'TRASLADO_SALIDA')
        .order('created_at', { ascending: false })

    if (error) {
        console.error("Error al cargar historial de traslados:", error)
        tablaHistorialTraslados.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">Error: ${error.message}</td></tr>`
        return
    }

    tablaHistorialTraslados.innerHTML = ''

    if (!traslados || traslados.length === 0) {
        tablaHistorialTraslados.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-400 italic">No se han registrado traslados entre ubicaciones.</td></tr>'
        return
    }

    const trasladoIds = traslados.map(t => t.traslado_id).filter(Boolean)
    const { data: entradasDestino } = await supabase
        .from('movimientos_inventario')
        .select('traslado_id, ubicaciones(nombre)')
        .eq('tipo_movimiento', 'TRASLADO_ENTRADA')
        .in('traslado_id', trasladoIds)

    const destinoMap = {}
    if (entradasDestino) {
        entradasDestino.forEach(e => {
            destinoMap[e.traslado_id] = e.ubicaciones?.nombre || 'Destino'
        })
    }

    traslados.forEach(t => {
        const fechaStr = new Date(t.created_at).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })
        const origenNombre = t.ubicaciones?.nombre || 'Bodega Central'
        const destinoNombre = destinoMap[t.traslado_id] || 'Área de Venta'
        const cantFmt = Number(t.cantidad).toFixed(2)

        tablaHistorialTraslados.innerHTML += `
            <tr class="hover:bg-slate-800/40 transition border-b border-slate-800/60">
                <td class="p-3 text-slate-400 font-mono">${fechaStr}</td>
                <td class="p-3 font-bold text-white">${t.productos?.nombre || '--'}</td>
                <td class="p-3 font-mono text-emerald-400 font-medium">${t.lotes?.numero_lote || '--'}</td>
                <td class="p-3 font-semibold text-slate-300">
                    <span class="text-amber-400">${origenNombre}</span> ➔ <span class="text-emerald-400">${destinoNombre}</span>
                </td>
                <td class="p-3 text-right font-extrabold text-emerald-400 font-mono">
                    -${cantFmt} ${t.productos?.unidad_base || ''}
                </td>
                <td class="p-3 text-center text-slate-400">Administración</td>
            </tr>
        `
    })
}

validarAcceso()