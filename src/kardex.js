import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

let currentUserId = null

// 1. Guard de Autenticación (Solo Admin)
async function validarAccesoAdmin() {
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

    currentUserId = session.user.id

    const nombreUsuario = perfil?.nombre_completo || session.user.email
    const userEmail = document.getElementById('user-email') || document.getElementById('admin-email') || document.getElementById('usuario-info')
    if (userEmail) {
        userEmail.textContent = nombreUsuario
    }

    await Promise.all([
        cargarProductosDropdown(),
        cargarMovimientosKardex()
    ])
}

// 2. Poblar Dropdown de Productos (filtro de kardex + selector del modal de ajuste)
async function cargarProductosDropdown() {
    const selectProd = document.getElementById('filtro-producto')
    const selectAjusteProd = document.getElementById('ajuste-producto')
    if (!selectProd && !selectAjusteProd) return

    try {
        const { data: productos, error } = await supabase
            .from('productos')
            .select('id, nombre')
            .order('nombre', { ascending: true })

        if (error) throw error

        productos.forEach(prod => {
            if (selectProd) {
                const opt = document.createElement('option')
                opt.value = prod.id
                opt.textContent = prod.nombre
                selectProd.appendChild(opt)
            }
            if (selectAjusteProd) {
                const optAjuste = document.createElement('option')
                optAjuste.value = prod.id
                optAjuste.textContent = prod.nombre
                selectAjusteProd.appendChild(optAjuste)
            }
        })
    } catch (err) {
        console.error("Error cargando lista de productos:", err)
    }
}

// 3. Consultar y Renderizar Movimientos Kardex
async function cargarMovimientosKardex() {
    const tbody = document.getElementById('tabla-kardex')
    const countTag = document.getElementById('registros-count')
    tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-gray-500">Cargando movimientos de Kardex...</td></tr>'

    try {
        let query = supabase
            .from('movimientos_inventario')
            .select(`
                *,
                productos (
                    id,
                    nombre,
                    unidad_base
                ),
                lotes (
                    id,
                    numero_lote,
                    fecha_vencimiento
                )
            `)
            .order('created_at', { ascending: false })

        // Aplicar Filtros Dinámicos
        const ubicacionId = document.getElementById('filtro-ubicacion')?.value
        const productoId = document.getElementById('filtro-producto')?.value
        const tipoMovimiento = document.getElementById('filtro-tipo')?.value
        const fechaInicio = document.getElementById('fecha-inicio')?.value
        const fechaFin = document.getElementById('fecha-fin')?.value

        if (ubicacionId) {
            query = query.eq('ubicacion_id', ubicacionId)
        }
        if (productoId) {
            query = query.eq('producto_id', productoId)
        }
        if (tipoMovimiento) {
            query = query.eq('tipo_movimiento', tipoMovimiento)
        }
        if (fechaInicio) {
            query = query.gte('created_at', new Date(fechaInicio + 'T00:00:00').toISOString())
        }
        if (fechaFin) {
            query = query.lte('created_at', new Date(fechaFin + 'T23:59:59').toISOString())
        }

        const { data: movimientos, error } = await query

        if (error) throw error

        tbody.innerHTML = ''
        const list = movimientos || []

        if (countTag) {
            countTag.textContent = `${list.length} registros encontrados`
        }

        if (list.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="p-0">
                        <div class="py-12 px-6 rounded-3xl bg-forest-950/40 border border-dashed border-emerald-500/20 text-center flex flex-col items-center justify-center my-2">
                            <svg class="w-16 h-16 text-slate-400 dark:text-slate-500 mb-3 stroke-[1.2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                            </svg>
                            <p class="text-xs text-slate-400 dark:text-slate-500 font-medium">No se encontraron movimientos registrados en Kardex con los filtros aplicados.</p>
                        </div>
                    </td>
                </tr>`
            actualizarMetricasResumen([])
            return
        }

        actualizarMetricasResumen(list)

        let tbodyHtml = ''
        list.forEach(m => {
            const prod = m.productos
            const lote = m.lotes
            const fechaStr = new Date(m.created_at).toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' })

            // Formatear Badges según el Tipo de Movimiento
            let badgeTipo = ''
            let signoCantidad = ''
            let colorCantidad = ''

            switch (m.tipo_movimiento) {
                case 'ENTRADA_COMPRA':
                case 'AJUSTE_ENTRADA':
                    badgeTipo = '<span class="inline-block bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/20 text-xs font-bold px-2.5 py-1 rounded-full">📥 ENTRADA COMPRA</span>'
                    signoCantidad = '+'
                    colorCantidad = 'text-emerald-600 dark:text-emerald-400 font-extrabold'
                    break
                case 'TRASLADO_ENTRADA':
                    badgeTipo = '<span class="inline-block bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold px-2.5 py-1 rounded-full">📦 TRASLADO ENTRADA</span>'
                    signoCantidad = '+'
                    colorCantidad = 'text-emerald-400 font-extrabold'
                    break
                case 'TRASLADO_SALIDA':
                    badgeTipo = '<span class="inline-block bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-bold px-2.5 py-1 rounded-full">📦 TRASLADO SALIDA</span>'
                    signoCantidad = '-'
                    colorCantidad = 'text-amber-400 font-extrabold'
                    break
                case 'SALIDA_VENTA':
                    badgeTipo = '<span class="inline-block bg-blue-500/10 text-blue-600 dark:text-blue-300 border border-blue-500/20 text-xs font-bold px-2.5 py-1 rounded-full">📤 SALIDA VENTA (FEFO)</span>'
                    signoCantidad = '-'
                    colorCantidad = 'text-blue-600 dark:text-blue-400 font-extrabold'
                    break
                case 'MERMA_VENCIDO':
                case 'AJUSTE_SALIDA':
                    badgeTipo = '<span class="inline-block bg-rose-500/10 text-rose-600 dark:text-rose-300 border border-rose-500/20 text-xs font-bold px-2.5 py-1 rounded-full">⚠️ MERMA / VENCIDO</span>'
                    signoCantidad = '-'
                    colorCantidad = 'text-rose-600 dark:text-rose-400 font-extrabold'
                    break
                default:
                    badgeTipo = `<span class="inline-block bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold px-2.5 py-1 rounded-full border border-slate-700">${m.tipo_movimiento}</span>`
                    signoCantidad = ''
                    colorCantidad = 'text-slate-800 dark:text-slate-200 font-bold'
            }

            const loteDisplay = lote 
                ? `<div><strong class="font-mono text-slate-800 dark:text-slate-200">${lote.numero_lote}</strong></div><div class="text-[11px] text-slate-500 dark:text-slate-400">Venc: ${lote.fecha_vencimiento}</div>`
                : '<span class="text-slate-400 dark:text-slate-500 italic">Sin lote asignado</span>'

            const refDisplay = m.observaciones
                ? `<span class="text-xs text-slate-600 dark:text-slate-300 italic">${m.observaciones}</span>`
                : m.referencia_id
                    ? `<span class="font-mono text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700">Ref #${m.referencia_id.substring(0, 8)}</span>`
                    : '<span class="text-xs text-slate-400 dark:text-slate-500">Registro automático</span>'

            tbodyHtml += `
                <tr class="glass-panel glass-panel-hover rounded-2xl transition-all duration-200 shadow-sm text-slate-800 dark:text-slate-200 group">
                    <td class="p-3.5 pl-6 font-mono text-xs text-slate-600 dark:text-slate-300">${fechaStr}</td>
                    <td class="p-3.5 font-bold text-slate-900 dark:text-white">${prod?.nombre || 'Producto no encontrado'}</td>
                    <td class="p-3.5 text-xs">${loteDisplay}</td>
                    <td class="p-3.5">${badgeTipo}</td>
                    <td class="p-3.5 text-right ${colorCantidad}">
                        ${signoCantidad}${Number(m.cantidad).toFixed(2)} <span class="text-xs text-slate-500 dark:text-slate-400 font-normal">${prod?.unidad_base || ''}</span>
                    </td>
                    <td class="p-3.5 pr-6">${refDisplay}</td>
                </tr>
            `
        })

        tbody.innerHTML = tbodyHtml

    } catch (err) {
        console.error("Error al cargar Kardex:", err)
        tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-red-500 font-semibold">Error al cargar Kardex: ${err.message}</td></tr>`
    }
}

// 4. Actualizar Tarjetas de Resumen
function actualizarMetricasResumen(movimientos) {
    let entradas = 0
    let salidas = 0
    let mermas = 0

    movimientos.forEach(m => {
        const cant = Number(m.cantidad) || 0
        if (m.tipo_movimiento === 'ENTRADA_COMPRA' || m.tipo_movimiento === 'AJUSTE_ENTRADA') {
            entradas += cant
        } else if (m.tipo_movimiento === 'SALIDA_VENTA') {
            salidas += cant
        } else if (m.tipo_movimiento === 'MERMA_VENCIDO' || m.tipo_movimiento === 'AJUSTE_SALIDA') {
            mermas += cant
        }
    })

    document.getElementById('stat-total-entradas').textContent = entradas.toLocaleString()
    document.getElementById('stat-total-salidas').textContent = salidas.toLocaleString()
    document.getElementById('stat-total-mermas').textContent = mermas.toLocaleString()
}

// Escuchar envío del formulario de filtros
document.getElementById('form-filtros')?.addEventListener('submit', (e) => {
    e.preventDefault()
    cargarMovimientosKardex()
})

// ----------------------------------------------------
// MODAL: REGISTRAR AJUSTE / MERMA DE INVENTARIO
// ----------------------------------------------------
const modalAjuste = document.getElementById('modal-ajuste')
const formAjuste = document.getElementById('form-ajuste')
const selectAjusteProducto = document.getElementById('ajuste-producto')
const selectAjusteUbicacion = document.getElementById('ajuste-ubicacion')
const selectAjusteLote = document.getElementById('ajuste-lote')

function abrirModalAjuste() {
    formAjuste?.reset()
    modalAjuste?.classList.remove('hidden')
    modalAjuste?.classList.add('flex')
    cargarLotesParaAjuste()
}

function cerrarModalAjuste() {
    modalAjuste?.classList.add('hidden')
    modalAjuste?.classList.remove('flex')
}

document.getElementById('btn-abrir-ajuste')?.addEventListener('click', abrirModalAjuste)
document.getElementById('btn-cerrar-ajuste')?.addEventListener('click', cerrarModalAjuste)
document.getElementById('btn-cancelar-ajuste')?.addEventListener('click', cerrarModalAjuste)
modalAjuste?.addEventListener('click', (e) => {
    if (e.target === modalAjuste) cerrarModalAjuste()
})

// Recargar lotes del producto seleccionado (independiente de la ubicación:
// el admin puede sumar/restar de un lote sin importar dónde está su stock
// hoy — la RPC valida disponibilidad real antes de aplicar el ajuste).
async function cargarLotesParaAjuste() {
    if (!selectAjusteLote) return
    selectAjusteLote.innerHTML = '<option value="">Sin lote específico</option>'

    const productoId = selectAjusteProducto?.value
    if (!productoId) return

    try {
        const { data: lotes, error } = await supabase
            .from('lotes')
            .select('id, numero_lote, fecha_vencimiento')
            .eq('producto_id', productoId)
            .order('fecha_vencimiento', { ascending: true })

        if (error) throw error

        lotes?.forEach(l => {
            const opt = document.createElement('option')
            opt.value = l.id
            const vence = l.fecha_vencimiento ? new Date(l.fecha_vencimiento).toLocaleDateString('es-GT') : 'sin vencimiento'
            opt.textContent = `${l.numero_lote} (vence: ${vence})`
            selectAjusteLote.appendChild(opt)
        })
    } catch (err) {
        console.error("Error cargando lotes para ajuste:", err)
    }
}

selectAjusteProducto?.addEventListener('change', cargarLotesParaAjuste)

formAjuste?.addEventListener('submit', async (e) => {
    e.preventDefault()

    const btnGuardar = document.getElementById('btn-guardar-ajuste')
    const textoOriginal = btnGuardar.textContent
    btnGuardar.textContent = 'Guardando...'
    btnGuardar.disabled = true

    const productoId = selectAjusteProducto.value
    const ubicacionId = selectAjusteUbicacion.value
    const loteId = selectAjusteLote.value || null
    const tipoMovimiento = formAjuste.querySelector('input[name="ajuste-tipo"]:checked')?.value
    const cantidad = parseFloat(document.getElementById('ajuste-cantidad').value)
    const observaciones = document.getElementById('ajuste-observaciones').value.trim() || null

    try {
        const { error } = await supabase.rpc('registrar_ajuste_inventario', {
            p_producto_id: productoId,
            p_ubicacion_id: ubicacionId,
            p_tipo_movimiento: tipoMovimiento,
            p_cantidad: cantidad,
            p_usuario_id: currentUserId,
            p_lote_id: loteId,
            p_observaciones: observaciones
        })

        if (error) throw error

        cerrarModalAjuste()
        await cargarMovimientosKardex()
    } catch (err) {
        console.error("Error al registrar ajuste de inventario:", err)
        alert("Error al registrar el ajuste: " + (err.message || err))
    } finally {
        btnGuardar.textContent = textoOriginal
        btnGuardar.disabled = false
    }
})

// Logout
document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    window.location.href = 'index.html'
})

// Inicializar
validarAccesoAdmin()
