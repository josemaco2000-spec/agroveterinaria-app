const { createClient } = window.supabase

// Tus credenciales (las que ya configuraste bien)
const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'

const supabase = createClient(supabaseUrl, supabaseKey)

// Seleccionar elementos del DOM
const formLogin = document.getElementById('form-login')
const inputEmail = document.getElementById('email')
const inputPassword = document.getElementById('password')
const mensajeError = document.getElementById('mensaje-error')
const btnSubmit = document.getElementById('btn-submit')

function redirigirPorRol(rol) {
    if (rol === 'admin') {
        window.location.href = 'admin.html'
    } else if (rol === 'vendedor') {
        window.location.href = 'cajero-home.html'
    } else {
        window.location.href = 'pos.html'
    }
}

// Si ya hay una sesión válida (Supabase en línea, o la sesión local
// respaldada por AuthGuard cuando no hay red), saltar directo al panel
// del rol en vez de mostrar el formulario de login — p. ej. al abrir el
// ícono instalado con un login previo todavía vigente.
async function redirigirSiYaHaySesion() {
    const datos = await window.AuthGuard.obtenerSesionActiva(supabase)
    if (!datos || !datos.rol) return

    redirigirPorRol(datos.rol)
}

redirigirSiYaHaySesion()

// Intenta el login normal contra Supabase Auth. Si la contraseña llegó a
// verificarse en el servidor (éxito o rechazo explícito), cachea el hash
// localmente para que el mismo usuario pueda entrar sin red la próxima vez.
async function iniciarSesionOnline(email, password) {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) throw authError

    const userId = authData.user.id
    let perfil = null
    try {
        const { data, error } = await supabase.from('perfiles').select('rol, nombre_completo').eq('id', userId).single()
        if (error) throw error
        perfil = data
    } catch (e) {
        console.warn('No se pudo confirmar el perfil recién autenticado por red, usando caché local si existe:', e)
        perfil = await window.AuthLocal.obtenerPerfilLocal(userId)
    }

    if (!perfil) {
        throw new Error('No se pudo determinar el perfil del usuario (ni por red ni en caché local).')
    }

    await window.AuthLocal.cachearCredenciales({
        user_id: userId,
        email,
        nombre_completo: perfil.nombre_completo,
        rol: perfil.rol,
        password,
    })
    window.AuthGuard.guardarSesionLocal({ user_id: userId, email, rol: perfil.rol, nombre_completo: perfil.nombre_completo })
    redirigirPorRol(perfil.rol)
}

// Sin red (o el intento online falló por red): valida contra el hash
// guardado localmente la última vez que este usuario inició sesión con
// éxito en este dispositivo.
async function iniciarSesionLocal(email, password) {
    const usuario = await window.AuthLocal.validarLoginLocal(email, password)
    if (!usuario) {
        const error = new Error('offline-sin-cache')
        error.offline = true
        throw error
    }
    window.AuthGuard.guardarSesionLocal(usuario)
    redirigirPorRol(usuario.rol)
}

function esRechazoDeCredencialesConfirmado(error) {
    // AuthApiError = Supabase sí recibió la petición y el servidor
    // rechazó la contraseña. Cualquier otro error -AuthRetryableFetchError,
    // TypeError de fetch, etc.- es una falla de red (nunca llegó a
    // servidor), no un rechazo real de credenciales, así que no debe
    // bloquear el intento de login local.
    return error?.name === 'AuthApiError'
}

// Escuchar el evento de envío del formulario
formLogin.addEventListener('submit', async (e) => {
    e.preventDefault() // Evita que la página se recargue

    // Cambiar estado del botón
    btnSubmit.textContent = 'Iniciando...'
    btnSubmit.disabled = true
    mensajeError.classList.add('hidden')

    const email = inputEmail.value
    const password = inputPassword.value

    try {
        if (navigator.onLine) {
            try {
                await iniciarSesionOnline(email, password)
                return
            } catch (error) {
                if (esRechazoDeCredencialesConfirmado(error)) {
                    throw error
                }
                console.warn('Login online no se pudo completar por red, intentando con credenciales locales:', error)
            }
        }

        await iniciarSesionLocal(email, password)
    } catch (error) {
        console.error('Error en login:', error)
        mensajeError.textContent = error?.offline
            ? 'Sin conexión y no hay datos guardados de este usuario en este dispositivo. Conectate a internet al menos una vez para habilitar el acceso offline.'
            : 'Correo o contraseña incorrectos.'
        mensajeError.classList.remove('hidden')
    } finally {
        // Restaurar el botón
        btnSubmit.textContent = 'Iniciar Sesión'
        btnSubmit.disabled = false
    }
})
