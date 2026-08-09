import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

// Estado Global
let todosLosEmpleados = []
let sessionUsuario = null

// 1. Guard de Autenticación y Verificación de Rol Admin
async function validarAccesoAdmin() {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()

    if (!session) {
        window.location.href = 'index.html'
        return
    }

    sessionUsuario = session.user

    // Consultar perfil de administrador
    const { data: perfilData, error: perfilError } = await supabase
        .from('perfiles')
        .select('*')
        .eq('id', session.user.id)
        .single()

    if (perfilError || perfilData?.rol !== 'admin') {
        alert("Acceso denegado. Área exclusiva para administración.")
        window.location.href = 'pos.html'
        return
    }

    // Mostrar nombre del usuario e iniciales en el Header
    const nombreUsuario = perfilData?.nombre_completo || session.user.email || 'Administrador'
    const userInfoEl = document.getElementById('usuario-info') || document.getElementById('user-email') || document.getElementById('admin-email') || document.getElementById('cajero-email')
    if (userInfoEl) {
        userInfoEl.textContent = nombreUsuario
    }

    const avatarInitialsEl = document.getElementById('user-avatar-initials')
    if (avatarInitialsEl && nombreUsuario) {
        const partes = nombreUsuario.trim().split(' ')
        const iniciales = partes.length >= 2 
            ? (partes[0][0] + partes[1][0]).toUpperCase() 
            : nombreUsuario.substring(0, 2).toUpperCase()
        avatarInitialsEl.textContent = iniciales
    }

    // Cargar Lista de Empleados
    await cargarEmpleados()
}

// 2. Data Fetching: Obtener todos los registros de perfiles ordenados por rol
async function cargarEmpleados() {
    const tablaEl = document.getElementById('tabla-empleados')
    const countEl = document.getElementById('empleados-count')

    if (tablaEl) {
        tablaEl.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-12 text-slate-400">
                    <div class="inline-flex items-center gap-2">
                        <svg class="animate-spin h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Cargando directorio de personal...</span>
                    </div>
                </td>
            </tr>`
    }

    try {
        const { data: perfiles, error } = await supabase
            .from('perfiles')
            .select('*')
            .order('rol', { ascending: true })

        if (error) throw error

        todosLosEmpleados = perfiles || []

        if (countEl) {
            countEl.textContent = todosLosEmpleados.length
        }

        renderTablaEmpleados(todosLosEmpleados)

    } catch (err) {
        console.error("Error al cargar empleados:", err)
        if (tablaEl) {
            tablaEl.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center py-12 text-rose-400 font-medium">
                        ⚠️ Error al obtener personal: ${err.message}
                    </td>
                </tr>`
        }
    }
}

// 3. Renderizar Tabla de Empleados con filtro y formateo
function renderTablaEmpleados(lista) {
    const tablaEl = document.getElementById('tabla-empleados')
    const searchVal = (document.getElementById('input-busqueda-empleado')?.value || '').toLowerCase().trim()

    if (!tablaEl) return

    let filtrados = lista
    if (searchVal) {
        filtrados = lista.filter(emp => {
            const nombre = (emp.nombre_completo || '').toLowerCase()
            const correo = (emp.correo || emp.email || '').toLowerCase()
            const rol = (emp.rol || '').toLowerCase()
            return nombre.includes(searchVal) || correo.includes(searchVal) || rol.includes(searchVal)
        })
    }

    if (filtrados.length === 0) {
        tablaEl.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-12 text-slate-400">
                    No se encontraron empleados registrados.
                </td>
            </tr>`
        return
    }

    tablaEl.innerHTML = filtrados.map(emp => {
        const correo = emp.correo || emp.email || (emp.id === sessionUsuario?.id ? sessionUsuario.email : 'N/A')
        const nombre = emp.nombre_completo || 'Sin Nombre'
        const rol = emp.rol || 'vendedor'
        const pin = emp.pin_autorizacion || ''

        // Badge de Rol (Admin = Green, Vendedor = Blue)
        const rolBadge = rol === 'admin'
            ? `<span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Admin</span>`
            : `<span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-blue-500/20 text-blue-400 border border-blue-500/30">Vendedor</span>`

        return `
            <tr class="glass-panel glass-panel-hover rounded-2xl transition-all duration-200 shadow-sm text-slate-200 group">
                <td class="py-4 pl-6 font-mono text-slate-300">
                    ${correo}
                </td>
                <td class="py-4 font-bold text-slate-800 dark:text-white">
                    ${nombre}
                </td>
                <td class="py-4 text-center">
                    ${rolBadge}
                </td>
                <td class="py-4 text-center">
                    <div class="inline-flex items-center justify-center gap-2">
                        <span class="pin-text font-mono font-bold tracking-widest text-slate-300" data-pin="${pin}">
                            ••••
                        </span>
                        <button type="button" class="btn-toggle-pin text-slate-400 hover:text-emerald-400 transition text-xs p-1" title="Ver / Ocultar PIN">
                            👁️
                        </button>
                    </div>
                </td>
                <td class="py-4 pr-6 text-right">
                    <button type="button" 
                            data-id="${emp.id}" 
                            class="btn-editar-empleado px-3 py-1.5 rounded-xl bg-forest-950 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 hover:text-emerald-300 font-bold text-xs transition inline-flex items-center gap-1 shadow-sm">
                        <span>✏️ Editar</span>
                    </button>
                </td>
            </tr>`
    }).join('')

    // Bind Toggle PIN Buttons
    tablaEl.querySelectorAll('.btn-toggle-pin').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const container = e.currentTarget.closest('td')
            const pinSpan = container?.querySelector('.pin-text')
            if (!pinSpan) return

            const actualPin = pinSpan.getAttribute('data-pin') || ''
            if (pinSpan.textContent.trim() === '••••') {
                pinSpan.textContent = actualPin ? actualPin : '(Sin PIN)'
                e.currentTarget.textContent = '🙈'
            } else {
                pinSpan.textContent = '••••'
                e.currentTarget.textContent = '👁️'
            }
        })
    })

    // Bind Editar Buttons
    tablaEl.querySelectorAll('.btn-editar-empleado').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id')
            abrirModalEditarEmpleado(id)
        })
    })
}

// 4. Abrir Modal de Edición de Empleado
function abrirModalEditarEmpleado(perfilId) {
    const emp = todosLosEmpleados.find(e => e.id === perfilId)
    if (!emp) return

    const modal = document.getElementById('modal-empleado')
    const inputId = document.getElementById('perfil_id')
    const inputNombre = document.getElementById('nombre_completo')
    const selectRol = document.getElementById('rol')
    const inputPin = document.getElementById('pin_autorizacion')
    const inputCorreoDisp = document.getElementById('emp-correo-display')

    if (inputId) inputId.value = emp.id
    if (inputCorreoDisp) {
        inputCorreoDisp.value = emp.correo || emp.email || (emp.id === sessionUsuario?.id ? sessionUsuario.email : 'N/A')
    }
    if (inputNombre) inputNombre.value = emp.nombre_completo || ''
    if (selectRol) selectRol.value = emp.rol || 'vendedor'
    if (inputPin) inputPin.value = emp.pin_autorizacion || ''

    if (modal) {
        modal.classList.remove('hidden')
        modal.classList.add('flex')
    }
}

// 5. Cerrar Modal
function cerrarModalEmpleado() {
    const modal = document.getElementById('modal-empleado')
    if (modal) {
        modal.classList.add('hidden')
        modal.classList.remove('flex')
    }
}

// 6. Submit Formulario (UPDATE perfiles)
async function guardarCambiosEmpleado(e) {
    e.preventDefault()

    const perfilId = document.getElementById('perfil_id')?.value
    const nombreCompleto = document.getElementById('nombre_completo')?.value.trim()
    const rol = document.getElementById('rol')?.value
    const pinAutorizacion = document.getElementById('pin_autorizacion')?.value.trim()

    if (!perfilId) {
        mostrarToast("No se seleccionó un perfil válido.", "error")
        return
    }

    if (!nombreCompleto) {
        mostrarToast("El nombre completo es requerido.", "error")
        return
    }

    if (pinAutorizacion && !/^\d{1,4}$/.test(pinAutorizacion)) {
        mostrarToast("El PIN de autorización debe tener máximo 4 dígitos numéricos.", "error")
        return
    }

    const btnSubmit = document.getElementById('btn-guardar-empleado')
    if (btnSubmit) {
        btnSubmit.disabled = true
        btnSubmit.textContent = 'Guardando...'
    }

    try {
        const { error } = await supabase
            .from('perfiles')
            .update({
                nombre_completo: nombreCompleto,
                rol: rol,
                pin_autorizacion: pinAutorizacion || null
            })
            .eq('id', perfilId)

        if (error) throw error

        mostrarToast("¡Permisos y datos actualizados correctamente!", "success")
        cerrarModalEmpleado()
        await cargarEmpleados()

    } catch (err) {
        console.error("Error al actualizar perfil:", err)
        mostrarToast(`Error al guardar: ${err.message}`, "error")
    } finally {
        if (btnSubmit) {
            btnSubmit.disabled = false
            btnSubmit.textContent = 'Guardar Cambios'
        }
    }
}

// 7. Notificación Toast
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
            ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200 shadow-emerald-950/60' 
            : 'bg-rose-950/90 border-rose-500/50 text-rose-200 shadow-rose-950/60'
    }`
    toast.innerHTML = `<span>${tipo === 'success' ? '✅' : '⚠️'}</span><span>${mensaje}</span>`
    container.appendChild(toast)

    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-4', 'opacity-0')
    })

    setTimeout(() => {
        toast.classList.add('translate-y-4', 'opacity-0')
        setTimeout(() => toast.remove(), 300)
    }, 3200)
}

// 8. Event Listeners de la interfaz
document.addEventListener('DOMContentLoaded', () => {
    // Validar acceso inicial
    validarAccesoAdmin()

    // Búsqueda en tiempo real
    document.getElementById('input-busqueda-empleado')?.addEventListener('input', () => {
        renderTablaEmpleados(todosLosEmpleados)
    })

    // Listeners del Modal
    document.getElementById('btn-cerrar-modal-empleado-x')?.addEventListener('click', cerrarModalEmpleado)
    document.getElementById('btn-cancelar-modal')?.addEventListener('click', cerrarModalEmpleado)
    document.getElementById('form-empleado')?.addEventListener('submit', guardarCambiosEmpleado)

    // Cerrar modal al hacer clic en el backdrop
    document.getElementById('modal-empleado')?.addEventListener('click', (e) => {
        if (e.target.id === 'modal-empleado') {
            cerrarModalEmpleado()
        }
    })

    // Logout
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        await supabase.auth.signOut()
        window.location.href = 'index.html'
    })
})
