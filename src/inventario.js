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
// LÓGICA DEL MODAL
// ----------------------------------------------------
const modal = document.getElementById('modal-producto')
const btnNuevo = document.getElementById('btn-nuevo-producto')
const btnCerrar = document.getElementById('btn-cerrar-modal')
const btnCerrarX = document.getElementById('btn-cerrar-modal-x')

function abrirModal() {
    modal.classList.remove('hidden')
}

function cerrarModal() {
    modal.classList.add('hidden')
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
// GUARDAR EL PRODUCTO (Inserción Doble)
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

    try {
        // 1. Guardar en la tabla pública de productos y obtener el registro con su ID generado
        const { data: nuevoProducto, error: errorProducto } = await supabase
            .from('productos')
            .insert([{ 
                nombre: nombre, 
                codigo_barras: codigo, 
                categoria: categoria, 
                unidad_base: unidad, 
                stock_base: stock 
            }])
            .select() // Solicita que Supabase retorne el objeto recién insertado con el id
            .single()

        if (errorProducto) throw errorProducto

        // 2. Usar el ID del nuevo producto para guardar el precio de costo en productos_costos
        const { error: errorCosto } = await supabase
            .from('productos_costos')
            .insert([{ 
                producto_id: nuevoProducto.id, 
                precio_costo: costo 
            }])

        if (errorCosto) {
            console.error("Error al registrar costo:", errorCosto)
            alert("El producto se creó pero hubo un detalle al guardar el costo: " + errorCosto.message)
        } else {
            alert('¡Producto y costo registrados con éxito en Agrovet Campo Alto!')
        }

        document.getElementById('form-producto').reset()
        cerrarModal()
        cargarInventario() // Recargar la lista de productos

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
    tbody.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-gray-500">Cargando inventario...</td></tr>'

    // Realizar consulta con relacion a productos_costos
    const { data: productos, error } = await supabase
        .from('productos')
        .select(`
            *,
            productos_costos (precio_costo)
        `)
        .order('created_at', { ascending: false })

    if (error) {
        console.error("Error cargando inventario:", error)
        tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-red-500 font-semibold">Error al cargar productos: ${error.message}</td></tr>`
        return
    }

    tbody.innerHTML = ''

    if (!productos || productos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-gray-500 italic">No hay productos registrados en Agrovet Campo Alto aún.</td></tr>'
        return
    }

    // Renderizar cada producto en la tabla
    productos.forEach(prod => {
        // Extraer costo de forma segura sea objeto o array de Supabase
        const costoObj = Array.isArray(prod.productos_costos) ? prod.productos_costos[0] : prod.productos_costos
        const costoNum = costoObj && costoObj.precio_costo !== undefined ? Number(costoObj.precio_costo) : 0
        const costoFormateado = costoNum.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

        tbody.innerHTML += `
            <tr class="border-b border-gray-100 hover:bg-green-50/50 transition">
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
                    <button class="btn-abrir-presentaciones bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow transition inline-flex items-center gap-1.5" data-id="${prod.id}" data-nombre="${prod.nombre}">
                        ⚙️ Presentaciones
                    </button>
                </td>
            </tr>
        `
    })

    // Event listener delegado para los botones de presentaciones
    tbody.querySelectorAll('.btn-abrir-presentaciones').forEach(btn => {
        btn.addEventListener('click', () => {
            const prodId = btn.getAttribute('data-id')
            const prodNombre = btn.getAttribute('data-nombre')
            abrirModalPresentaciones(prodId, prodNombre)
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

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalPres.classList.contains('hidden')) {
        cerrarModalPresentaciones()
    }
})

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

    // Event listener para eliminar presentación
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