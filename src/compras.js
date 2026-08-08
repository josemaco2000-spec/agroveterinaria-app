import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

// Estado Global
let listProveedores = []
let listProductos = []
let itemsCargadosCompra = []

// 1. Guard de Autenticación (Solo Admin)
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

    const adminEmail = document.getElementById('admin-email')
    if (adminEmail) {
        adminEmail.textContent = session.user.email
    }

    await Promise.all([
        cargarProveedores(),
        cargarProductos(),
        cargarCompras()
    ])
}

// 2. Cargar Proveedores
async function cargarProveedores() {
    const tbody = document.getElementById('tabla-proveedores')
    const selectProv = document.getElementById('compra-proveedor-id')
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-500">Cargando proveedores...</td></tr>'

    try {
        const { data: proveedores, error } = await supabase
            .from('proveedores')
            .select('*')
            .order('nombre', { ascending: true })

        if (error) throw error

        listProveedores = proveedores || []
        tbody.innerHTML = ''

        if (selectProv) {
            selectProv.innerHTML = '<option value="">Selecciona el proveedor...</option>'
        }

        if (listProveedores.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-gray-400 italic">No hay proveedores registrados aún.</td></tr>'
            return
        }

        listProveedores.forEach(p => {
            // Rellenar tabla
            tbody.innerHTML += `
                <tr class="hover:bg-gray-50 border-b border-gray-100">
                    <td class="p-4 font-bold text-gray-800">${p.nombre}</td>
                    <td class="p-4 font-mono">${p.nit || 'CF'}</td>
                    <td class="p-4">${p.telefono || 'Sin teléfono'}</td>
                    <td class="p-4 font-semibold text-green-700">${p.contacto_nombre || '--'}</td>
                    <td class="p-4 text-xs text-gray-500">${p.direccion || 'No especificada'}</td>
                </tr>
            `

            // Rellenar Select Modal
            if (selectProv) {
                const opt = document.createElement('option')
                opt.value = p.id
                opt.textContent = p.nombre
                selectProv.appendChild(opt)
            }
        })

    } catch (err) {
        console.error("Error al cargar proveedores:", err)
        tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-red-500">Error: ${err.message}</td></tr>`
    }
}

// 3. Cargar Productos para el Formulario de Items
async function cargarProductos() {
    const selectProd = document.getElementById('item-producto-id')
    if (!selectProd) return

    try {
        const { data: productos, error } = await supabase
            .from('productos')
            .select('id, nombre, unidad_base')
            .order('nombre', { ascending: true })

        if (error) throw error

        listProductos = productos || []
        selectProd.innerHTML = '<option value="">Selecciona el producto...</option>'

        listProductos.forEach(p => {
            const opt = document.createElement('option')
            opt.value = p.id
            opt.textContent = `${p.nombre} (${p.unidad_base})`
            selectProd.appendChild(opt)
        })
    } catch (err) {
        console.error("Error cargando productos:", err)
    }
}

// 4. Cargar Historial de Compras
async function cargarCompras() {
    const tbody = document.getElementById('tabla-compras')
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-500">Cargando historial de compras...</td></tr>'

    try {
        const { data: compras, error } = await supabase
            .from('compras')
            .select(`
                *,
                proveedores (
                    nombre
                )
            `)
            .order('created_at', { ascending: false })

        if (error) throw error

        tbody.innerHTML = ''

        if (!compras || compras.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-gray-400 italic">No se registran compras abastecidas en Agrovet Campo Alto.</td></tr>'
            return
        }

        compras.forEach(c => {
            const fechaStr = new Date(c.created_at).toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' })
            const totalFmt = (Number(c.total) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

            tbody.innerHTML += `
                <tr class="hover:bg-gray-50 border-b border-gray-100">
                    <td class="p-4 font-mono text-xs text-gray-500">${fechaStr}</td>
                    <td class="p-4 font-bold text-gray-800">${c.proveedores?.nombre || 'Proveedor dado de baja'}</td>
                    <td class="p-4 font-mono text-gray-700 font-semibold">${c.no_comprobante || 'S/N'}</td>
                    <td class="p-4 text-right font-extrabold text-blue-700">Q${totalFmt}</td>
                    <td class="p-4 text-center">
                        <button class="btn-ver-detalle bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold px-3 py-1 rounded transition text-xs" data-id="${c.id}">
                            👁️ Ver Renglones
                        </button>
                    </td>
                </tr>
            `
        })

        // Event listener delegado
        tbody.querySelectorAll('.btn-ver-detalle').forEach(btn => {
            btn.addEventListener('click', () => {
                abrirDetalleCompra(btn.getAttribute('data-id'))
            })
        })

    } catch (err) {
        console.error("Error al cargar historial:", err)
        tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-red-500">Error: ${err.message}</td></tr>`
    }
}

// 5. Detalles de una Compra Específica (Modal Ver Renglones)
async function abrirDetalleCompra(compraId) {
    const modal = document.getElementById('modal-detalle-compra')
    const generalEl = document.getElementById('detalle-compra-general')
    const tbody = document.getElementById('tabla-detalle-compra-rows')

    modal.classList.remove('hidden')
    generalEl.innerHTML = 'Cargando cabecera...'
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center">Cargando renglones...</td></tr>'

    try {
        // Cabecera
        const { data: compra, error: errC } = await supabase
            .from('compras')
            .select(`
                *,
                proveedores (
                    nombre,
                    nit
                )
            `)
            .eq('id', compraId)
            .single()

        if (errC) throw errC

        const fechaFmt = new Date(compra.created_at).toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' })
        generalEl.innerHTML = `
            <div class="grid grid-cols-2 gap-2 text-xs">
                <div><strong>Proveedor:</strong> ${compra.proveedores?.nombre || 'N/A'} (NIT: ${compra.proveedores?.nit || 'CF'})</div>
                <div><strong>No. Factura/Comprobante:</strong> ${compra.no_comprobante || 'Sin número'}</div>
                <div><strong>Fecha Abastecimiento:</strong> ${fechaFmt}</div>
                <div><strong>Monto Total Compra:</strong> <span class="font-bold text-green-700">Q${Number(compra.total).toFixed(2)}</span></div>
            </div>
        `

        // Detalles
        const { data: detalles, error: errD } = await supabase
            .from('detalle_compras')
            .select(`
                *,
                productos (
                    nombre,
                    unidad_base
                ),
                lotes (
                    numero_lote
                )
            `)
            .eq('compra_id', compraId)

        if (errD) throw errD

        tbody.innerHTML = ''
        detalles.forEach(d => {
            const subtotal = Number(d.subtotal) || 0
            tbody.innerHTML += `
                <tr class="hover:bg-gray-50">
                    <td class="p-3 font-semibold text-gray-800">${d.productos?.nombre || 'Producto eliminado'}</td>
                    <td class="p-3 font-mono font-bold text-gray-600">${d.lotes?.numero_lote || '--'}</td>
                    <td class="p-3 text-right font-bold text-gray-700">${d.cantidad} ${d.productos?.unidad_base || ''}</td>
                    <td class="p-3 text-right text-gray-600">Q${Number(d.precio_costo_unitario).toFixed(2)}</td>
                    <td class="p-3 text-right font-extrabold text-blue-700">Q${subtotal.toFixed(2)}</td>
                </tr>
            `
        })

    } catch (err) {
        console.error("Error al cargar detalles de la compra:", err)
        generalEl.innerHTML = '<span class="text-red-500">Error cargando detalles</span>'
    }
}

// 6. Tabs Toggles
const btnTabCompras = document.getElementById('btn-tab-compras')
const btnTabProv = document.getElementById('btn-tab-proveedores')
const viewCompras = document.getElementById('view-compras')
const viewProv = document.getElementById('view-proveedores')

btnTabCompras?.addEventListener('click', () => {
    btnTabCompras.className = 'py-2.5 px-4 font-bold text-sm border-b-2 border-green-700 text-green-800'
    btnTabProv.className = 'py-2.5 px-4 font-bold text-sm border-b-2 border-transparent text-gray-500 hover:text-gray-800'
    viewCompras.classList.remove('hidden')
    viewProv.classList.add('hidden')
})

btnTabProv?.addEventListener('click', () => {
    btnTabProv.className = 'py-2.5 px-4 font-bold text-sm border-b-2 border-green-700 text-green-800'
    btnTabCompras.className = 'py-2.5 px-4 font-bold text-sm border-b-2 border-transparent text-gray-500 hover:text-gray-800'
    viewProv.classList.remove('hidden')
    viewCompras.classList.add('hidden')
})

// 7. Modales Handlers
const modalProv = document.getElementById('modal-proveedor')
const modalCompra = document.getElementById('modal-compra')
const modalDetalle = document.getElementById('modal-detalle-compra')

document.getElementById('btn-nuevo-proveedor')?.addEventListener('click', () => modalProv.classList.remove('hidden'))
document.getElementById('btn-cerrar-modal-prov')?.addEventListener('click', () => modalProv.classList.add('hidden'))
document.getElementById('btn-cerrar-modal-prov-x')?.addEventListener('click', () => modalProv.classList.add('hidden'))

document.getElementById('btn-nuevo-compra')?.addEventListener('click', () => {
    itemsCargadosCompra = []
    renderTablaItemsCompra()
    document.getElementById('compra-no-comprobante').value = ''
    document.getElementById('compra-proveedor-id').value = ''
    modalCompra.classList.remove('hidden')
})
document.getElementById('btn-cerrar-modal-compra')?.addEventListener('click', () => modalCompra.classList.add('hidden'))
document.getElementById('btn-cerrar-modal-compra-x')?.addEventListener('click', () => modalCompra.classList.add('hidden'))

document.getElementById('btn-cerrar-modal-detalle')?.addEventListener('click', () => modalDetalle.classList.add('hidden'))
document.getElementById('btn-cerrar-modal-detalle-x')?.addEventListener('click', () => modalDetalle.classList.add('hidden'))

// Escuchar tecla Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        modalProv.classList.add('hidden')
        modalCompra.classList.add('hidden')
        modalDetalle.classList.add('hidden')
    }
})

// Submit Formulario Proveedor
document.getElementById('form-proveedor')?.addEventListener('submit', async (e) => {
    e.preventDefault()

    const btn = document.getElementById('btn-guardar-proveedor')
    const textoOrig = btn.textContent
    btn.textContent = 'Guardando...'
    btn.disabled = true

    const nombre = document.getElementById('prov-nombre').value.trim()
    const nit = document.getElementById('prov-nit').value.trim() || 'CF'
    const telefono = document.getElementById('prov-telefono').value.trim()
    const contacto = document.getElementById('prov-contacto').value.trim()
    const direccion = document.getElementById('prov-direccion').value.trim()

    try {
        const { error } = await supabase
            .from('proveedores')
            .insert([{
                nombre,
                nit,
                telefono,
                direccion,
                contacto_nombre: contacto
            }])

        if (error) throw error

        alert('¡Proveedor registrado con éxito!')
        document.getElementById('form-proveedor').reset()
        modalProv.classList.add('hidden')
        await cargarProveedores()

    } catch (err) {
        console.error("Error al registrar proveedor:", err)
        alert("Error al registrar proveedor: " + (err.message || err))
    } finally {
        btn.textContent = textoOrig
        btn.disabled = false
    }
})

// 8. Manejo de Items dentro de la Compra
document.getElementById('form-item-compra')?.addEventListener('submit', (e) => {
    e.preventDefault()

    const selectProd = document.getElementById('item-producto-id')
    const productoId = selectProd.value
    const numeroLote = document.getElementById('item-numero-lote').value.trim()
    const fechaVencimiento = document.getElementById('item-fecha-vencimiento').value
    const cantidad = parseFloat(document.getElementById('item-cantidad').value) || 0
    const costoUnitario = parseFloat(document.getElementById('item-costo').value) || 0

    if (!productoId) {
        alert("Selecciona un producto.")
        return
    }
    if (!numeroLote) {
        alert("Ingresa el número de lote.")
        return
    }
    if (!fechaVencimiento) {
        alert("Selecciona la fecha de vencimiento.")
        return
    }
    if (cantidad <= 0) {
        alert("La cantidad debe ser mayor a 0.")
        return
    }
    if (costoUnitario <= 0) {
        alert("El costo unitario debe ser mayor a 0.")
        return
    }

    const prodObj = listProductos.find(p => p.id === productoId)
    const subtotal = cantidad * costoUnitario

    // Agregar al estado temporal de items de compra
    itemsCargadosCompra.push({
        producto_id: productoId,
        nombre_producto: prodObj?.nombre || 'Producto',
        numero_lote: numeroLote,
        fecha_vencimiento: fechaVencimiento,
        cantidad: cantidad,
        precio_costo_unitario: costoUnitario,
        subtotal: subtotal
    })

    // Limpiar formulario de item
    document.getElementById('item-producto-id').value = ''
    document.getElementById('item-numero-lote').value = ''
    document.getElementById('item-fecha-vencimiento').value = ''
    document.getElementById('item-cantidad').value = ''
    document.getElementById('item-costo').value = ''

    renderTablaItemsCompra()
})

// Renderizar tabla temporal de items agregados
function renderTablaItemsCompra() {
    const tbody = document.getElementById('tabla-items-compra')
    const labelTotal = document.getElementById('total-compra-label')

    tbody.innerHTML = ''

    if (itemsCargadosCompra.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-gray-400 italic">No hay productos agregados a esta compra.</td></tr>'
        labelTotal.textContent = 'Q0.00'
        return
    }

    let total = 0

    itemsCargadosCompra.forEach((item, idx) => {
        total += item.subtotal
        tbody.innerHTML += `
            <tr class="hover:bg-gray-50">
                <td class="p-3 font-semibold text-gray-800">${item.nombre_producto}</td>
                <td class="p-3 font-mono font-bold text-gray-600">${item.numero_lote}</td>
                <td class="p-3 font-mono text-gray-500">${item.fecha_vencimiento}</td>
                <td class="p-3 text-right font-bold text-gray-700">${item.cantidad}</td>
                <td class="p-3 text-right text-gray-600">Q${item.precio_costo_unitario.toFixed(2)}</td>
                <td class="p-3 text-right font-extrabold text-blue-700">Q${item.subtotal.toFixed(2)}</td>
                <td class="p-3 text-center">
                    <button class="btn-quitar-item-compra text-red-600 hover:text-red-800 font-bold text-xs" data-idx="${idx}">&times; Quitar</button>
                </td>
            </tr>
        `
    })

    labelTotal.textContent = `Q${total.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

    // Deletion Listeners
    tbody.querySelectorAll('.btn-quitar-item-compra').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.getAttribute('data-idx'))
            itemsCargadosCompra.splice(index, 1)
            renderTablaItemsCompra()
        })
    })
}

// 9. Ejecutar RPC registrar_entrada_compra (Guardar todo)
document.getElementById('btn-guardar-compra')?.addEventListener('click', async () => {
    const proveedorId = document.getElementById('compra-proveedor-id').value
    const noComprobante = document.getElementById('compra-no-comprobante').value.trim()

    if (!proveedorId) {
        alert("⚠️ Por favor selecciona el proveedor.")
        return
    }
    if (!noComprobante) {
        alert("⚠️ Por favor ingresa el número de factura/comprobante.")
        return
    }
    if (itemsCargadosCompra.length === 0) {
        alert("⚠️ Agrega al menos un producto a la compra antes de guardar.")
        return
    }

    const btn = document.getElementById('btn-guardar-compra')
    const textoOrig = btn.textContent
    btn.textContent = 'Guardando Compra...'
    btn.disabled = true

    try {
        const { data: { session } } = await supabase.auth.getSession()

        const totalCompra = itemsCargadosCompra.reduce((sum, item) => sum + item.subtotal, 0)

        // Limpiar nombres auxiliares del JSON para que coincida exactamente con la firma de BD
        const itemsList = itemsCargadosCompra.map(i => ({
            producto_id: i.producto_id,
            numero_lote: i.numero_lote,
            fecha_vencimiento: i.fecha_vencimiento,
            cantidad: i.cantidad,
            precio_costo_unitario: i.precio_costo_unitario,
            subtotal: i.subtotal
        }))

        const { data: compraId, error } = await supabase.rpc('registrar_entrada_compra', {
            p_proveedor_id: proveedorId,
            p_no_comprobante: noComprobante,
            p_total: totalCompra,
            p_usuario_id: session?.user?.id || null,
            p_items: itemsList
        })

        if (error) throw error

        alert('¡Compra registrada exitosamente! Se actualizaron los lotes, costos globales y Kardex de inventario.')
        modalCompra.classList.add('hidden')
        itemsCargadosCompra = []
        renderTablaItemsCompra()

        await cargarCompras()

    } catch (err) {
        console.error("Error al registrar compra:", err)
        alert("Error al registrar compra: " + (err.message || err))
    } finally {
        btn.textContent = textoOrig
        btn.disabled = false
    }
})

// Logout
document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    window.location.href = 'index.html'
})

// Inicializar
validarAcceso()
