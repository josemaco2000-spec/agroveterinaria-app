import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabase = createClient(supabaseUrl, supabaseKey)

// Estado Global
let currentUserId = null
let ventasEfectivoTotal = 0

// 1. Guard de Autenticación
async function validarSesion() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
        window.location.href = 'index.html'
        return
    }

    currentUserId = session.user.id
    const cajeroEmail = document.getElementById('cajero-email')
    if (cajeroEmail) {
        cajeroEmail.textContent = session.user.email
    }

    await cargarVentasDelDia()
}

// 2. Cargar Ventas del Día
async function cargarVentasDelDia() {
    try {
        const ahora = new Date()
        const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).toISOString()

        const { data: ventas, error } = await supabase
            .from('ventas')
            .select('total')
            .gte('fecha_venta', inicioHoy)

        if (error) throw error

        ventasEfectivoTotal = (ventas || []).reduce((sum, v) => sum + (Number(v.total) || 0), 0)

        const ventasFormatted = ventasEfectivoTotal.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        document.getElementById('ventas-sistema').textContent = `Q${ventasFormatted}`
        document.getElementById('resumen-ventas').textContent = `Q${ventasFormatted}`

        recalcularTotales()

    } catch (err) {
        console.error("Error al cargar ventas del día:", err)
        document.getElementById('ventas-sistema').textContent = "Q0.00"
    }
}

// 3. Calculadora de Denominaciones
function calcularSubtotalesDenominaciones() {
    const d200 = (parseInt(document.getElementById('den-200')?.value) || 0) * 200
    const d100 = (parseInt(document.getElementById('den-100')?.value) || 0) * 100
    const d50 = (parseInt(document.getElementById('den-50')?.value) || 0) * 50
    const d20 = (parseInt(document.getElementById('den-20')?.value) || 0) * 20
    const d10 = (parseInt(document.getElementById('den-10')?.value) || 0) * 10
    const d5 = (parseInt(document.getElementById('den-5')?.value) || 0) * 5
    const d1 = (parseInt(document.getElementById('den-1')?.value) || 0) * 1
    const dMonedas = parseFloat(document.getElementById('den-monedas')?.value) || 0

    document.getElementById('sub-200').textContent = `Q${d200.toFixed(2)}`
    document.getElementById('sub-100').textContent = `Q${d100.toFixed(2)}`
    document.getElementById('sub-50').textContent = `Q${d50.toFixed(2)}`
    document.getElementById('sub-20').textContent = `Q${d20.toFixed(2)}`
    document.getElementById('sub-10').textContent = `Q${d10.toFixed(2)}`
    document.getElementById('sub-5').textContent = `Q${d5.toFixed(2)}`
    document.getElementById('sub-1').textContent = `Q${d1.toFixed(2)}`
    document.getElementById('sub-monedas').textContent = `Q${dMonedas.toFixed(2)}`

    const totalRealContado = d200 + d100 + d50 + d20 + d10 + d5 + d1 + dMonedas

    const inputMontoReal = document.getElementById('monto-real')
    if (inputMontoReal) {
        inputMontoReal.value = totalRealContado.toFixed(2)
    }

    recalcularTotales()
}

// Escuchar cambios en los inputs de denominación
document.querySelectorAll('.den-input').forEach(input => {
    input.addEventListener('input', calcularSubtotalesDenominaciones)
})

document.getElementById('monto-inicial')?.addEventListener('input', recalcularTotales)
document.getElementById('monto-real')?.addEventListener('input', recalcularTotales)

// 4. Recalcular Esperado vs Real y Diferencia
function recalcularTotales() {
    const montoInicial = parseFloat(document.getElementById('monto-inicial')?.value) || 0
    const montoReal = parseFloat(document.getElementById('monto-real')?.value) || 0

    const montoEsperado = montoInicial + ventasEfectivoTotal
    const diferencia = montoReal - montoEsperado

    // Actualizar etiquetas
    const fmt = num => num.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    
    document.getElementById('resumen-inicial').textContent = `Q${fmt(montoInicial)}`
    document.getElementById('monto-esperado').textContent = `Q${fmt(montoEsperado)}`
    document.getElementById('resumen-monto-real').textContent = `Q${fmt(montoReal)}`
    document.getElementById('diferencia-monto').textContent = `Q${fmt(Math.abs(diferencia))}`

    // Formatear Badge e Indicador de Discrepancia
    const cardDif = document.getElementById('card-diferencia')
    const badgeDif = document.getElementById('badge-diferencia')
    const textDif = document.getElementById('diferencia-monto')

    if (Math.abs(diferencia) < 0.01) {
        badgeDif.textContent = 'Q0.00 (Cuadrado ✓)'
        badgeDif.className = 'inline-block mt-1 text-xs px-2.5 py-0.5 rounded-full font-bold bg-green-100 text-green-800'
        cardDif.className = 'p-4 rounded-xl border flex justify-between items-center bg-green-50/50 border-green-200'
        textDif.className = 'text-2xl font-extrabold text-green-700'
    } else if (diferencia < 0) {
        badgeDif.textContent = `Faltante: -Q${fmt(Math.abs(diferencia))} ⚠️`
        badgeDif.className = 'inline-block mt-1 text-xs px-2.5 py-0.5 rounded-full font-bold bg-red-100 text-red-800'
        cardDif.className = 'p-4 rounded-xl border flex justify-between items-center bg-red-50/50 border-red-200'
        textDif.className = 'text-2xl font-extrabold text-red-700'
    } else {
        badgeDif.textContent = `Sobrante: +Q${fmt(diferencia)} ℹ️`
        badgeDif.className = 'inline-block mt-1 text-xs px-2.5 py-0.5 rounded-full font-bold bg-blue-100 text-blue-800'
        cardDif.className = 'p-4 rounded-xl border flex justify-between items-center bg-blue-50/50 border-blue-200'
        textDif.className = 'text-2xl font-extrabold text-blue-700'
    }
}

// 5. Guardar Cierre de Caja
document.getElementById('btn-guardar-cierre')?.addEventListener('click', async () => {
    const btnGuardar = document.getElementById('btn-guardar-cierre')
    const textoOrig = btnGuardar.innerHTML
    btnGuardar.innerHTML = '<span>⏳ Guardando Cierre...</span>'
    btnGuardar.disabled = true

    const montoInicial = parseFloat(document.getElementById('monto-inicial').value) || 0
    const montoReal = parseFloat(document.getElementById('monto-real').value) || 0
    const montoEsperado = montoInicial + ventasEfectivoTotal
    const diferencia = montoReal - montoEsperado
    const observaciones = document.getElementById('observaciones').value.trim()

    try {
        // Intentar guardar en la tabla `cierres_caja`
        const { error } = await supabase
            .from('cierres_caja')
            .insert([{
                usuario_id: currentUserId,
                monto_inicial: montoInicial,
                ventas_efectivo: ventasEfectivoTotal,
                monto_esperado: montoEsperado,
                monto_real: montoReal,
                diferencia: diferencia,
                observaciones: observaciones || null
            }])

        if (error) {
            console.error("Aviso al insertar en cierres_caja:", error)
        }

        // Llenar resumen en ticket modal de éxito
        const fmt = num => num.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        document.getElementById('ticket-ventas').textContent = `Q${fmt(ventasEfectivoTotal)}`
        document.getElementById('ticket-inicial').textContent = `Q${fmt(montoInicial)}`
        document.getElementById('ticket-esperado').textContent = `Q${fmt(montoEsperado)}`
        document.getElementById('ticket-real').textContent = `Q${fmt(montoReal)}`
        document.getElementById('ticket-diferencia').textContent = `Q${fmt(diferencia)}`

        document.getElementById('modal-cierre-exito')?.classList.remove('hidden')

    } catch (err) {
        console.error("Error al procesar cierre:", err)
        alert("Ocurrió un error al guardar el cierre de caja: " + (err.message || err))
    } finally {
        btnGuardar.innerHTML = textoOrig
        btnGuardar.disabled = false
    }
})

// Imprimir Ticket
document.getElementById('btn-imprimir-cierre')?.addEventListener('click', () => {
    window.print()
})

// Finalizar y salir a la caja POS
document.getElementById('btn-finalizar-cierre')?.addEventListener('click', () => {
    window.location.href = 'pos.html'
})

// Inicializar
validarSesion()
