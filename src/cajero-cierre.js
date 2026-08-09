import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

let currentUserId = null

// 1. Guard de Autenticación y Rol
async function validarSesion() {
    try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()

        if (sessionError || !session) {
            window.location.href = 'index.html'
            return
        }

        currentUserId = session.user.id

        const { data: perfil, error: perfilError } = await supabase
            .from('perfiles')
            .select('rol, nombre_completo')
            .eq('id', session.user.id)
            .single()

        if (perfilError) {
            console.error("Error al verificar perfil:", perfilError.message)
        } else if (perfil && perfil.rol === 'admin') {
            window.location.href = 'admin.html'
            return
        }

        const cajeroEmailEl = document.getElementById('cajero-email')
        if (cajeroEmailEl) {
            cajeroEmailEl.textContent = perfil?.nombre_completo || session.user.email || 'Usuario'
        }
    } catch (err) {
        console.error("Error en sesión de cierre de caja:", err)
        window.location.href = 'index.html'
    }
}

// 2. Cálculo en Tiempo Real del Arqueo Ciego
function calcularMontoReal() {
    const c200 = parseInt(document.getElementById('cant-200')?.value) || 0
    const c100 = parseInt(document.getElementById('cant-100')?.value) || 0
    const c50  = parseInt(document.getElementById('cant-50')?.value) || 0
    const c20  = parseInt(document.getElementById('cant-20')?.value) || 0
    const c10  = parseInt(document.getElementById('cant-10')?.value) || 0
    const c5   = parseInt(document.getElementById('cant-5')?.value) || 0
    const c1   = parseInt(document.getElementById('cant-1')?.value) || 0

    const totalReal = (c200 * 200) + (c100 * 100) + (c50 * 50) + (c20 * 20) + (c10 * 10) + (c5 * 5) + (c1 * 1)

    const totalEl = document.getElementById('total-monto-real')
    if (totalEl) {
        const totalFmt = totalReal.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        totalEl.textContent = `Q ${totalFmt}`
    }

    return { totalReal, breakdown: `Q200x${c200}, Q100x${c100}, Q50x${c50}, Q20x${c20}, Q10x${c10}, Q5x${c5}, Q1x${c1}` }
}

document.querySelectorAll('.input-billete').forEach(input => {
    input.addEventListener('input', calcularMontoReal)
})

// 3. Procesar Envió de Cierre de Caja
const formCierreCiego = document.getElementById('form-cierre-ciego')
if (formCierreCiego) {
    formCierreCiego.addEventListener('submit', async (e) => {
        e.preventDefault()

        const btnEnviar = document.getElementById('btn-enviar-cierre')
        const textoOrig = btnEnviar ? btnEnviar.innerHTML : 'ENVIAR CIERRE'
        if (btnEnviar) {
            btnEnviar.disabled = true
            btnEnviar.innerHTML = '<span>⏳ Registrando...</span>'
        }

        try {
            const { totalReal, breakdown } = calcularMontoReal()

            // Insertar en cierres_caja
            const { error } = await supabase
                .from('cierres_caja')
                .insert([{
                    usuario_id: currentUserId,
                    monto_real: totalReal,
                    observaciones: `Arqueo Ciego: ${breakdown}`
                }])

            if (error) {
                console.error("Error al insertar cierre de caja:", error)
            }

            // Mostrar modal de éxito
            document.getElementById('modal-cierre-exito')?.classList.remove('hidden')

        } catch (err) {
            console.error("Excepción en cierre de caja:", err)
            alert("⚠️ Error al registrar el cierre: " + (err.message || err))
        } finally {
            if (btnEnviar) {
                btnEnviar.disabled = false
                btnEnviar.innerHTML = textoOrig
            }
        }
    })
}

// 4. Salir y signOut
document.getElementById('btn-salir-cierre')?.addEventListener('click', async () => {
    try {
        await supabase.auth.signOut()
    } catch (e) {
        console.error("Error al cerrar sesión:", e)
    }
    localStorage.removeItem('adnova_session_offline')
    window.location.href = 'index.html'
})

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    validarSesion()
})
