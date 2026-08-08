import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

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
        // 1. Intentar hacer Login con Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        })

        if (authError) throw authError

        // 2. Si el login es exitoso, buscar su rol en la tabla perfiles
        const userId = authData.user.id
        const { data: perfilData, error: perfilError } = await supabase
            .from('perfiles')
            .select('rol')
            .eq('id', userId)
            .single()

        if (perfilError) throw perfilError

        // 3. Redirigir según el rol
        const rol = perfilData.rol
        if (rol === 'admin') {
            window.location.href = 'admin.html' 
        } else if (rol === 'vendedor') {
            window.location.href = 'cajero-home.html' 
        }

    } catch (error) {
        // Mostrar mensaje de error si la contraseña está mal o no existe
        console.error("Error en login:", error.message)
        mensajeError.textContent = "Correo o contraseña incorrectos."
        mensajeError.classList.remove('hidden')
    } finally {
        // Restaurar el botón
        btnSubmit.textContent = 'Iniciar Sesión'
        btnSubmit.disabled = false
    }
})