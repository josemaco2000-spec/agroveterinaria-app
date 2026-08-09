import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

let todosLosClientes = []

// 1. Guard de Autenticación y Rol
async function validarSesion() {
    try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()

        if (sessionError || !session) {
            window.location.href = 'index.html'
            return
        }

        const { data: perfil, error: perfilError } = await supabase
            .from('perfiles')
            .select('rol')
            .eq('id', session.user.id)
            .single()

        if (perfilError) {
            console.error("Error al obtener perfil:", perfilError.message)
        } else if (perfil && perfil.rol === 'admin') {
            window.location.href = 'admin.html'
            return
        }

        const cajeroEmailEl = document.getElementById('cajero-email')
        if (cajeroEmailEl) {
            cajeroEmailEl.textContent = session.user.email
        }

        await cargarClientes()
    } catch (err) {
        console.error("Error en autenticación de clientes:", err)
        window.location.href = 'index.html'
    }
}

// 2. Cargar Lista de Clientes
async function cargarClientes() {
    const grid = document.getElementById('grid-clientes')
    if (!grid) return

    grid.innerHTML = `
        <div class="col-span-full bg-white rounded-3xl p-12 text-center text-slate-500 font-bold border border-slate-200 flex items-center justify-center gap-2">
            <span class="inline-block animate-spin text-2xl">⏳</span> Cargando clientes...
        </div>
    `

    try {
        const { data: clientes, error } = await supabase
            .from('clientes')
            .select('*')
            .order('nombre', { ascending: true })

        if (error) throw error

        todosLosClientes = clientes || []
        renderizarClientes(todosLosClientes)
    } catch (err) {
        console.error("Error al cargar clientes:", err)
        grid.innerHTML = `
            <div class="col-span-full bg-white rounded-3xl p-12 text-center text-rose-500 font-bold border border-slate-200">
                ❌ Error al cargar los clientes. Intente nuevamente.
            </div>
        `
    }
}

// 3. Renderizar Clientes en Grid Gran Formato
function renderizarClientes(lista) {
    const grid = document.getElementById('grid-clientes')
    if (!grid) return

    grid.innerHTML = ''

    if (lista.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full bg-white rounded-3xl p-12 text-center text-slate-400 font-bold border border-slate-200">
                No se encontraron clientes.
            </div>
        `
        return
    }

    lista.forEach(cli => {
        const saldo = Number(cli.saldo_actual || 0)
        const limite = Number(cli.limite_credito || 0)
        const saldoFmt = saldo.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const limiteFmt = limite.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

        grid.innerHTML += `
            <div class="bg-white hover:bg-slate-50 border-2 border-slate-200 rounded-3xl p-6 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-5">
                <div class="space-y-3">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex items-center gap-3">
                            <div class="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center text-xl font-black shrink-0">
                                👤
                            </div>
                            <div class="min-w-0">
                                <h3 class="text-lg font-black text-slate-900 leading-snug truncate">${cli.nombre}</h3>
                                <p class="text-xs font-bold text-slate-500">${cli.nit ? `NIT: ${cli.nit}` : 'CF (Consumidor Final)'}</p>
                            </div>
                        </div>
                    </div>

                    <div class="text-xs font-bold text-slate-600 space-y-1 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <div class="flex justify-between">
                            <span class="text-slate-400">Teléfono:</span>
                            <span class="text-slate-800">${cli.telefono || 'Sin registrar'}</span>
                        </div>
                    </div>

                    <!-- Saldos Gran Formato -->
                    <div class="grid grid-cols-2 gap-3 pt-1">
                        <div class="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-center">
                            <span class="text-[10px] font-extrabold text-rose-700 uppercase tracking-wider block">Saldo Deudor</span>
                            <span class="text-xl font-black text-rose-600 font-sans">Q ${saldoFmt}</span>
                        </div>
                        <div class="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-center">
                            <span class="text-[10px] font-extrabold text-emerald-700 uppercase tracking-wider block">Límite Crédito</span>
                            <span class="text-xl font-black text-emerald-600 font-sans">Q ${limiteFmt}</span>
                        </div>
                    </div>
                </div>

                <!-- 2 Botones de Acción Restringidos -->
                <div class="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                    <button class="btn-abono-cliente min-h-12 py-3 px-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-md transition active:scale-95 flex items-center justify-center gap-1.5"
                            data-id="${cli.id}" data-nombre="${cli.nombre}">
                        <span>💵</span>
                        <span>+ Nuevo Abono</span>
                    </button>

                    <button class="btn-ver-fincas min-h-12 py-3 px-3 rounded-2xl bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-extrabold text-xs transition active:scale-95 flex items-center justify-center gap-1.5"
                            data-id="${cli.id}" data-nombre="${cli.nombre}">
                        <span>🏡</span>
                        <span>Ver Fincas</span>
                    </button>
                </div>
            </div>
        `
    })

    // Listeners
    grid.querySelectorAll('.btn-abono-cliente').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id')
            const nombre = btn.getAttribute('data-nombre')
            abrirModalAbono(id, nombre)
        })
    })

    grid.querySelectorAll('.btn-ver-fincas').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id')
            const nombre = btn.getAttribute('data-nombre')
            abrirModalFincas(id, nombre)
        })
    })
}

// 4. Lógica Modal Abono
const modalAbono = document.getElementById('modal-abono')
const formAbono = document.getElementById('form-abono')

function abrirModalAbono(clienteId, clienteNombre) {
    if (!modalAbono) return

    document.getElementById('abono-cliente-id').value = clienteId
    document.getElementById('abono-cliente-nombre').textContent = clienteNombre
    document.getElementById('abono-monto').value = ''
    document.getElementById('abono-referencia').value = ''
    document.getElementById('abono-observaciones').value = ''

    modalAbono.classList.remove('hidden')
    setTimeout(() => document.getElementById('abono-monto')?.focus(), 150)
}

function cerrarModalAbono() {
    modalAbono?.classList.add('hidden')
}

document.getElementById('btn-cerrar-modal-abono')?.addEventListener('click', cerrarModalAbono)
document.getElementById('btn-cancelar-abono')?.addEventListener('click', cerrarModalAbono)

if (formAbono) {
    formAbono.addEventListener('submit', async (e) => {
        e.preventDefault()

        const btnGuardar = document.getElementById('btn-guardar-abono')
        const textoOrig = btnGuardar ? btnGuardar.textContent : 'Guardar Abono'
        if (btnGuardar) {
            btnGuardar.textContent = 'Procesando...'
            btnGuardar.disabled = true
        }

        const clienteId = document.getElementById('abono-cliente-id').value
        const monto = parseFloat(document.getElementById('abono-monto').value) || 0
        const metodo = document.getElementById('abono-metodo').value
        const referencia = document.getElementById('abono-referencia').value.trim()
        const observaciones = document.getElementById('abono-observaciones').value.trim()

        try {
            const { data: { session } } = await supabase.auth.getSession()

            const { error } = await supabase.rpc('registrar_abono_credito', {
                p_cliente_id: clienteId,
                p_monto: monto,
                p_metodo_pago: metodo,
                p_numero_referencia: referencia || null,
                p_observaciones: observaciones || null,
                p_usuario_id: session?.user?.id || null
            })

            if (error) throw error

            alert('✅ ¡Abono de crédito registrado con éxito!')
            cerrarModalAbono()
            await cargarClientes()

        } catch (err) {
            console.error("Error al registrar abono:", err)
            alert("⚠️ Error al procesar el abono: " + (err.message || err))
        } finally {
            if (btnGuardar) {
                btnGuardar.textContent = textoOrig
                btnGuardar.disabled = false
            }
        }
    })
}

// 5. Lógica Modal Ver Fincas (Read-Only)
const modalFincas = document.getElementById('modal-fincas')
const listaFincasModal = document.getElementById('lista-fincas-modal')

async function abrirModalFincas(clienteId, clienteNombre) {
    if (!modalFincas || !listaFincasModal) return

    document.getElementById('fincas-cliente-nombre').textContent = clienteNombre
    listaFincasModal.innerHTML = '<div class="text-center py-8 text-slate-400 font-medium">⏳ Cargando fincas del cliente...</div>'
    modalFincas.classList.remove('hidden')

    try {
        const { data: fincas, error } = await supabase
            .from('fincas')
            .select('*')
            .eq('cliente_id', clienteId)
            .order('nombre_finca', { ascending: true })

        if (error) throw error

        if (!fincas || fincas.length === 0) {
            listaFincasModal.innerHTML = `
                <div class="text-center py-8 text-slate-400 font-medium italic">
                    Este cliente no tiene fincas registradas.
                </div>
            `
            return
        }

        listaFincasModal.innerHTML = fincas.map(f => `
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                <h4 class="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <span>🏡</span> ${f.nombre_finca}
                </h4>
                <p class="text-xs font-bold text-slate-600">📍 Ubicación: ${f.ubicacion || 'Sin especificar'}</p>
                ${f.superficie_manzanas ? `<p class="text-xs font-bold text-slate-500">📐 Tamaño: ${f.superficie_manzanas} manzanas</p>` : ''}
            </div>
        `).join('')

    } catch (err) {
        console.error("Error al cargar fincas:", err)
        listaFincasModal.innerHTML = `
            <div class="text-center py-8 text-rose-500 font-medium">
                ❌ Error al cargar las fincas del cliente.
            </div>
        `
    }
}

function cerrarModalFincas() {
    modalFincas?.classList.add('hidden')
}

document.getElementById('btn-cerrar-modal-fincas')?.addEventListener('click', cerrarModalFincas)
document.getElementById('btn-cerrar-fincas-footer')?.addEventListener('click', cerrarModalFincas)

// Buscador en tiempo real
document.getElementById('input-busqueda-cliente')?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim()
    const filtrados = todosLosClientes.filter(c => {
        const nombre = (c.nombre || '').toLowerCase()
        const nit = (c.nit || '').toLowerCase()
        return nombre.includes(query) || nit.includes(query)
    })
    renderizarClientes(filtrados)
})

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    validarSesion()
})
