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

        // Obtener perfil (rol y nombre)
        const { data: perfil, error: perfilError } = await supabase
            .from('perfiles')
            .select('rol, nombre_completo')
            .eq('id', session.user.id)
            .single()

        if (perfilError) {
            console.error("Error al obtener perfil de usuario:", perfilError.message)
        } else if (perfil && perfil.rol === 'admin') {
            // Si es administrador, redirigir al panel de administración
            window.location.href = 'admin.html'
            return
        }

        // Mostrar nombre completo del cajero
        const cajeroEmailEl = document.getElementById('cajero-email')
        if (cajeroEmailEl) {
            cajeroEmailEl.textContent = perfil?.nombre_completo || session.user.email || 'Usuario'
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
            window.location.href = 'cajero-pos.html'
        })
    }

    if (cardBuscarCliente) {
        cardBuscarCliente.addEventListener('click', () => {
            window.location.href = 'cajero-clientes.html'
        })
    }

    if (cardConsultarPrecio) {
        cardConsultarPrecio.addEventListener('click', () => {
            abrirModalPrecio()
        })
    }

    if (cardCierreCaja) {
        cardCierreCaja.addEventListener('click', () => {
            window.location.href = 'cajero-cierre.html'
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
const searchPrecioInput = document.getElementById('search-precio') || document.getElementById('input-busqueda-precio')
const resultadosPrecioContainer = document.getElementById('resultados-precio')

async function abrirModalPrecio() {
    if (!modalPrecio) return

    modalPrecio.classList.remove('opacity-0', 'pointer-events-none')
    modalPrecio.classList.add('opacity-100')

    if (modalPrecioBox) {
        modalPrecioBox.classList.remove('scale-95')
        modalPrecioBox.classList.add('scale-100')
    }

    if (searchPrecioInput) {
        searchPrecioInput.value = ''
        setTimeout(() => searchPrecioInput.focus(), 150)
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
        <div class="col-span-full text-center py-12 text-slate-500 font-medium flex items-center justify-center gap-2">
            <span class="inline-block animate-spin text-2xl">⏳</span> Cargando catálogo de precios...
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
                    imagen_url
                )
            `)
            .order('nombre_presentacion', { ascending: true })

        if (error) throw error

        catalogoPresentaciones = data || []
        renderizarPrecios('')
    } catch (err) {
        console.error("Error al cargar presentaciones para consulta de precio:", err)
        resultadosPrecioContainer.innerHTML = `
            <div class="col-span-full text-center py-8 text-rose-500 font-medium">
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
            <div class="col-span-full text-center py-12 text-slate-400 font-medium">
                No se encontraron precios para "${filtroText}"
            </div>
        `
        return
    }

    resultadosPrecioContainer.innerHTML = filtrados.slice(0, 60).map(item => {
        const precioUnitario = Number(item.precio_venta || 0)
        const nombreProducto = item.productos?.nombre || 'Producto Desconocido'
        const nombrePresentacion = item.nombre_presentacion || 'Unidad Base'
        const imagenUrl = item.productos?.imagen_url

        const imagenHtml = imagenUrl 
            ? `<img src="${imagenUrl}" alt="${nombreProducto}" class="w-16 h-16 object-cover rounded-xl border border-slate-200 shadow-sm shrink-0">`
            : `<div class="w-16 h-16 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-3xl font-bold shrink-0">📦</div>`

        return `
            <div class="bg-white hover:bg-emerald-50/60 border-2 border-slate-100 hover:border-emerald-300 rounded-2xl p-4 transition shadow-sm hover:shadow-md flex items-center gap-4">
                ${imagenHtml}
                <div class="flex-1 min-w-0">
                    <h4 class="text-base font-extrabold text-slate-900 leading-snug truncate">${nombreProducto}</h4>
                    <span class="inline-block mt-1 bg-slate-100 text-slate-700 text-xs font-bold px-2.5 py-0.5 rounded-lg border border-slate-200">
                        ${nombrePresentacion}
                    </span>
                </div>
                <div class="text-right shrink-0">
                    <span class="text-[10px] font-extrabold text-slate-400 block uppercase tracking-wider">Precio Venta</span>
                    <span class="text-2xl font-black text-emerald-600 font-sans">Q ${precioUnitario.toFixed(2)}</span>
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

if (searchPrecioInput) {
    searchPrecioInput.addEventListener('input', (e) => {
        renderizarPrecios(e.target.value)
    })
}

// Inicializar al cargar la página
document.addEventListener('DOMContentLoaded', () => {
    validarSesion()
    inicializarNavegacion()
})
