import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

// Validar que sea el Dueño (Admin) el que está aquí
async function validarAcceso() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
        window.location.href = 'index.html'
        return
    }

    const { data: perfil, error } = await supabase
        .from('perfiles')
        .select('rol')
        .eq('id', session.user.id)
        .single()

    if (error || perfil?.rol !== 'admin') {
        window.location.href = 'pos.html'
        return
    }
    
    cargarInventario()
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
}

function cerrarModal() {
    modal.classList.add('hidden')
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
                imagen_url: imagenUrl
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

        // 4. Registrar movimiento de inventario en Kardex (ENTRADA_COMPRA)
        const { error: errorKardex } = await supabase
            .from('movimientos_inventario')
            .insert([{
                producto_id: nuevoProducto.id,
                lote_id: nuevoLote?.id || null,
                tipo_movimiento: 'ENTRADA_COMPRA',
                cantidad: stock,
                usuario_id: session?.user?.id || null
            }])

        if (errorKardex) console.error("Error al registrar movimiento Kardex:", errorKardex)

        alert('¡Producto, costo, lote inicial (FEFO) y Kardex registrados con éxito!')
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
// CARGAR LA TABLA DE INVENTARIO
// ----------------------------------------------------
async function cargarInventario() {
    const tbody = document.getElementById('tabla-productos')
    tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-gray-500">Cargando inventario...</td></tr>'

    const { data: productos, error } = await supabase
        .from('productos')
        .select(`
            *,
            productos_costos (precio_costo)
        `)
        .order('created_at', { ascending: false })

    if (error) {
        console.error("Error cargando inventario:", error)
        tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-red-500 font-semibold">Error al cargar productos: ${error.message}</td></tr>`
        return
    }

    tbody.innerHTML = ''

    if (!productos || productos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-gray-500 italic">No hay productos registrados en Agrovet Campo Alto aún.</td></tr>'
        return
    }

    productos.forEach(prod => {
        const costoObj = Array.isArray(prod.productos_costos) ? prod.productos_costos[0] : prod.productos_costos
        const costoNum = costoObj && costoObj.precio_costo !== undefined ? Number(costoObj.precio_costo) : 0
        const costoFormateado = costoNum.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

        const imgHtml = prod.imagen_url 
            ? `<img src="${prod.imagen_url}" alt="${prod.nombre}" class="w-10 h-10 object-cover rounded-xl border border-slate-700/80 shadow-sm shrink-0">`
            : `<div class="w-10 h-10 rounded-xl bg-forest-950 border border-slate-800 flex items-center justify-center text-slate-500 shrink-0" title="Sin imagen">
                <svg class="w-5 h-5 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                </svg>
               </div>`

        tbody.innerHTML += `
            <tr class="border-b border-gray-100 hover:bg-green-50/50 transition">
                <td class="p-4 pl-6">${imgHtml}</td>
                <td class="p-4">
                    <div class="font-semibold text-gray-800">${prod.nombre}</div>
                    <div class="text-xs text-gray-400 font-mono mt-0.5">${prod.codigo_barras ? '📦 ' + prod.codigo_barras : 'Sin código'}</div>
                </td>
                <td class="p-4">
                    <span class="inline-block bg-green-100 text-green-800 text-xs px-2.5 py-1 rounded-full font-medium">${prod.categoria || 'General'}</span>
                </td>
                <td class="p-4 font-medium text-gray-700">
                    ${prod.stock_base} <span class="text-xs text-gray-500 font-normal">${prod.unidad_base}</span>
                </td>
                <td class="p-4 font-bold text-red-600">
                    Q${costoFormateado}
                </td>
                <td class="p-4 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button class="btn-abrir-presentaciones bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg shadow transition inline-flex items-center gap-1" data-id="${prod.id}" data-nombre="${prod.nombre}">
                            ⚙️ Presentaciones
                        </button>
                        <button class="btn-abrir-kardex bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg shadow transition inline-flex items-center gap-1" data-id="${prod.id}" data-nombre="${prod.nombre}">
                            📋 Lotes / Kardex
                        </button>
                    </div>
                </td>
            </tr>
        `
    })

    tbody.querySelectorAll('.btn-abrir-presentaciones').forEach(btn => {
        btn.addEventListener('click', () => {
            abrirModalPresentaciones(btn.getAttribute('data-id'), btn.getAttribute('data-nombre'))
        })
    })

    tbody.querySelectorAll('.btn-abrir-kardex').forEach(btn => {
        btn.addEventListener('click', () => {
            abrirModalKardex(btn.getAttribute('data-id'), btn.getAttribute('data-nombre'))
        })
    })
}

// ----------------------------------------------------
// LÓGICA DEL MODAL DE PRESENTACIONES
// ----------------------------------------------------
let productoSeleccionadoId = null
const modalPres = document.getElementById('modal-presentaciones')
const btnCerrarPres = document.getElementById('btn-cerrar-modal-pres')
const btnCerrarPresX = document.getElementById('btn-cerrar-modal-pres-x')
const presProductoNombre = document.getElementById('pres-producto-nombre')
const formPresentacion = document.getElementById('form-presentacion')
const tablaPresentaciones = document.getElementById('tabla-presentaciones')

function abrirModalPresentaciones(id, nombre) {
    productoSeleccionadoId = id
    presProductoNombre.textContent = nombre
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
    const factorConversion = parseFloat(document.getElementById('pres-factor').value) || 1
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

// Configurar botón de logout
document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    window.location.href = 'index.html'
})

validarAcceso()