import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

let catalogoPresentaciones = []

// 1. Guard de Autenticación y Rol
async function validarSesion() {
    try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()

        if (sessionError || !session) {
            window.location.href = 'index.html'
            return
        }

        // Obtener rol del perfil
        const { data: perfil, error: perfilError } = await supabase
            .from('perfiles')
            .select('rol')
            .eq('id', session.user.id)
            .single()

        if (perfilError) {
            console.error("Error al obtener perfil de usuario:", perfilError.message)
        } else if (perfil && perfil.rol === 'admin') {
            // Si es administrador, redirigir al panel de administración
            window.location.href = 'admin.html'
            return
        }

        // Mostrar email del cajero
        const cajeroEmailEl = document.getElementById('cajero-email')
        if (cajeroEmailEl) {
            cajeroEmailEl.textContent = session.user.email
        }
    } catch (err) {
        console.error("Excepción en autenticación:", err)
        window.location.href = 'index.html'
    }
}

// 2. Inicializar Event Listeners de las Tarjetas de Navegación
function inicializarNavegacion() {
    const cardNuevaVenta = document.getElementById('card-nueva-venta')
    const cardBuscarCliente = document.getElementById('card-buscar-cliente')
    const cardConsultarPrecio = document.getElementById('card-consultar-precio')
    const cardCierreCaja = document.getElementById('card-cierre-caja')
    const btnLogout = document.getElementById('btn-logout')

    if (cardNuevaVenta) {
        cardNuevaVenta.addEventListener('click', () => {
            window.location.href = 'pos.html'
        })
    }

    if (cardBuscarCliente) {
        cardBuscarCliente.addEventListener('click', () => {
            window.location.href = 'clientes.html?mode=readonly'
        })
    }

    if (cardConsultarPrecio) {
        cardConsultarPrecio.addEventListener('click', () => {
            abrirModalPrecio()
        })
    }

    if (cardCierreCaja) {
        cardCierreCaja.addEventListener('click', () => {
            window.location.href = 'cierre.html'
        })
    }

    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await supabase.auth.signOut()
            window.location.href = 'index.html'
        })
    }
}

// 3. Lógica Modal de Consulta de Precio
const modalPrecio = document.getElementById('modal-precio')
const modalPrecioBox = document.getElementById('modal-precio-box')
const btnCerrarModalPrecio = document.getElementById('btn-cerrar-modal-precio')
const inputBusquedaPrecio = document.getElementById('input-busqueda-precio')
const resultadosPrecioContainer = document.getElementById('resultados-precio')

async function abrirModalPrecio() {
    if (!modalPrecio) return

    modalPrecio.classList.remove('opacity-0', 'pointer-events-none')
    modalPrecio.classList.add('opacity-100')

    if (modalPrecioBox) {
        modalPrecioBox.classList.remove('scale-95')
        modalPrecioBox.classList.add('scale-100')
    }

    if (inputBusquedaPrecio) {
        inputBusquedaPrecio.value = ''
        setTimeout(() => inputBusquedaPrecio.focus(), 150)
    }

    if (catalogoPresentaciones.length === 0) {
        await cargarCatalogoPrecios()
    } else {
        renderizarPrecios('')
    }
}

function cerrarModalPrecio() {
    if (!modalPrecio) return

    modalPrecio.classList.add('opacity-0', 'pointer-events-none')
    modalPrecio.classList.remove('opacity-100')

    if (modalPrecioBox) {
        modalPrecioBox.classList.add('scale-95')
        modalPrecioBox.classList.remove('scale-100')
    }
}

async function cargarCatalogoPrecios() {
    if (!resultadosPrecioContainer) return

    resultadosPrecioContainer.innerHTML = `
        <div class="text-center py-12 text-slate-500 font-medium flex items-center justify-center gap-2">
            <span class="inline-block animate-spin">⏳</span> Cargando catálogo de precios...
        </div>
    `

    try {
        const { data, error } = await supabase
            .from('presentaciones')
            .select(`
                *,
                productos (
                    id,
                    nombre,
                    codigo_barras,
                    unidad_base
                )
            `)
            .order('nombre_presentacion', { ascending: true })

        if (error) throw error

        catalogoPresentaciones = data || []
        renderizarPrecios('')
    } catch (err) {
        console.error("Error al cargar presentaciones para consulta de precio:", err)
        resultadosPrecioContainer.innerHTML = `
            <div class="text-center py-8 text-rose-500 font-medium">
                ❌ Error al cargar los precios. Intente nuevamente.
            </div>
        `
    }
}

function renderizarPrecios(filtroText) {
    if (!resultadosPrecioContainer) return

    const query = filtroText.toLowerCase().trim()

    const filtrados = catalogoPresentaciones.filter(item => {
        if (!query) return true

        const nombrePres = (item.nombre_presentacion || '').toLowerCase()
        const nombreProd = (item.productos?.nombre || '').toLowerCase()
        const codigoProd = (item.productos?.codigo_barras || '').toLowerCase()

        return nombrePres.includes(query) || nombreProd.includes(query) || codigoProd.includes(query)
    })

    if (filtrados.length === 0) {
        resultadosPrecioContainer.innerHTML = `
            <div class="text-center py-12 text-slate-400 font-medium">
                No se encontraron productos o presentaciones para "${filtroText}"
            </div>
        `
        return
    }

    resultadosPrecioContainer.innerHTML = filtrados.slice(0, 50).map(item => {
        const precioUnitario = Number(item.precio_venta || 0)
        const nombreProducto = item.productos?.nombre || 'Producto Desconocido'
        const nombrePresentacion = item.nombre_presentacion || 'Unidad Base'
        const factor = Number(item.factor_conversion || 1)

        return `
            <div class="bg-slate-50 hover:bg-emerald-50/70 border border-slate-200/80 hover:border-emerald-300 rounded-2xl p-4 transition flex items-center justify-between gap-4">
                <div class="flex-1 min-w-0">
                    <h4 class="text-lg font-extrabold text-slate-900 truncate">${nombreProducto}</h4>
                    <div class="flex items-center gap-2 mt-1">
                        <span class="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-0.5 rounded-md">
                            ${nombrePresentacion} (${factor} base)
                        </span>
                    </div>
                </div>
                <div class="text-right flex-shrink-0">
                    <span class="text-xs font-semibold text-slate-500 block uppercase tracking-wider">Precio Venta</span>
                    <span class="text-2xl font-black text-emerald-600">Q ${precioUnitario.toFixed(2)}</span>
                </div>
            </div>
        `
    }).join('')
}

// 4. Listeners para el Modal de Precios
if (btnCerrarModalPrecio) {
    btnCerrarModalPrecio.addEventListener('click', cerrarModalPrecio)
}

if (modalPrecio) {
    modalPrecio.addEventListener('click', (e) => {
        if (e.target === modalPrecio) {
            cerrarModalPrecio()
        }
    })
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalPrecio && modalPrecio.classList.contains('opacity-100')) {
        cerrarModalPrecio()
    }
})

if (inputBusquedaPrecio) {
    inputBusquedaPrecio.addEventListener('input', (e) => {
        renderizarPrecios(e.target.value)
    })
}

// Inicializar al cargar la página
document.addEventListener('DOMContentLoaded', () => {
    validarSesion()
    inicializarNavegacion()
})
