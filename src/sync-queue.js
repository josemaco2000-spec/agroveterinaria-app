// Cola de sincronización genérica para escrituras hechas offline — Fase 4.
//
// Reemplaza el arreglo plano `adnova_pending_sales` en localStorage
// (usado hasta ahora solo por pos.js/cajero-pos.js) por una tabla
// estructurada en IndexedDB (`sync_queue`, ver db.js), compartida por
// ventas y por ajustes/mermas de inventario (kardex.js), y cargada en
// TODAS las páginas para que la cola se vacíe sola apenas se abra
// cualquier página con conexión, sin depender de qué pantalla haya
// quedado abierta cuando el dueño conecta la laptop en su casa.
//
// Idempotencia: cada ítem lleva su propio `local_id` (uuid) que se manda
// como `p_local_id` a la RPC correspondiente (ver migración
// supabase/28_idempotencia_ventas_ajustes.sql). Si esa migración TODAVÍA
// no se aplicó en el proyecto de Supabase, este módulo lo detecta (error
// PGRST202 de PostgREST: "no existe una función con esa firma") y
// reintenta sin `p_local_id` en vez de romperse — se pierde la protección
// extra contra duplicados por esa venta/ajuste puntual, pero la
// sincronización sigue funcionando igual que antes de esta fase.
const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'
const supabaseQueue = window.supabase.createClient(supabaseUrl, supabaseKey)

const TABLA_FALLIDOS = {
  venta: 'ventas_offline_fallidas',
  ajuste_inventario: 'movimientos_offline_fallidos',
}

let procesando = false

// tipo: 'venta' | 'ajuste_inventario'. payload: objeto ya listo para
// convertirse en los parámetros de la RPC (ver sincronizarVenta/
// sincronizarAjuste abajo) — el módulo genérico no conoce catálogo ni
// costos, así que quien encola debe entregar el payload ya armado.
async function encolar(tipo, payload) {
  const localId = crypto.randomUUID()
  await window.CampoAltoDB.sync_queue.add({
    tipo,
    local_id: localId,
    payload,
    estado: 'pendiente',
    intentos: 0,
    created_at: new Date().toISOString(),
  })
  return localId
}

async function llamarRpcConFallback(nombreRpc, paramsConLocalId, paramsSinLocalId) {
  const primero = await supabaseQueue.rpc(nombreRpc, paramsConLocalId)
  if (!primero.error) return primero

  if (primero.error.code === 'PGRST202') {
    console.warn(`${nombreRpc}: falta aplicar supabase/28_idempotencia_ventas_ajustes.sql (p_local_id no existe todavía). Sincronizando sin idempotencia.`)
    return supabaseQueue.rpc(nombreRpc, paramsSinLocalId)
  }

  return primero
}

function sincronizarVenta(item, usuarioId) {
  const p = item.payload
  const base = {
    p_items: p.items,
    p_cliente_id: p.cliente_id || null,
    p_finca_id: p.finca_id || null,
    p_tipo_pago: p.tipo_pago,
    p_usuario_id: usuarioId,
  }
  return llamarRpcConFallback('registrar_venta_pos', { ...base, p_local_id: item.local_id }, base)
}

function sincronizarAjuste(item, usuarioId) {
  const p = item.payload
  const base = {
    p_producto_id: p.producto_id,
    p_ubicacion_id: p.ubicacion_id,
    p_tipo_movimiento: p.tipo_movimiento,
    p_cantidad: p.cantidad,
    p_usuario_id: usuarioId,
    p_lote_id: p.lote_id || null,
    p_observaciones: p.observaciones || null,
  }
  return llamarRpcConFallback('registrar_ajuste_inventario', { ...base, p_local_id: item.local_id }, base)
}

const SINCRONIZADORES = {
  venta: sincronizarVenta,
  ajuste_inventario: sincronizarAjuste,
}

async function registrarFalloDefinitivo(item, usuarioId, mensaje) {
  const tabla = TABLA_FALLIDOS[item.tipo]
  if (!tabla) return { ok: false }

  const p = item.payload
  const fila = item.tipo === 'venta'
    ? {
        local_id: item.local_id,
        cliente_id: p.cliente_id || null,
        finca_id: p.finca_id || null,
        tipo_pago: p.tipo_pago,
        total: p.total,
        items: p.items,
        error_mensaje: mensaje,
        usuario_id: usuarioId,
      }
    : {
        local_id: item.local_id,
        producto_id: p.producto_id,
        ubicacion_id: p.ubicacion_id,
        lote_id: p.lote_id || null,
        tipo_movimiento: p.tipo_movimiento,
        cantidad: p.cantidad,
        observaciones: p.observaciones || null,
        error_mensaje: mensaje,
        usuario_id: usuarioId,
      }

  const { error } = await supabaseQueue.from(tabla).insert([fila])
  return { ok: !error, error }
}

// Recorre la cola en orden FIFO. Nunca lanza: cada ítem que falle por red
// se queda pendiente para el próximo intento; cada ítem rechazado de
// verdad por el servidor se registra en la tabla de conciliación
// correspondiente y se saca de la cola local.
//
// No recibe callbacks: se dispara igual desde cualquier página (la que
// haya quedado abierta cuando vuelve la conexión), así que en vez de
// callbacks emite un evento `sync-queue:completado` en `window` — cada
// página escucha ese evento y decide cómo refrescar su propia UI (ver
// pos.js/cajero-pos.js).
async function procesarCola() {
  if (procesando || !navigator.onLine) return { procesadas: 0, fallidasDefinitivas: 0 }
  procesando = true

  let procesadas = 0
  let fallidasDefinitivas = 0

  try {
    const pendientes = await window.CampoAltoDB.sync_queue.where('estado').equals('pendiente').sortBy('created_at')
    if (pendientes.length === 0) return { procesadas: 0, fallidasDefinitivas: 0 }

    const { data: { session } } = await supabaseQueue.auth.getSession()
    const usuarioId = session?.user?.id || null

    for (const item of pendientes) {
      const sincronizar = SINCRONIZADORES[item.tipo]
      if (!sincronizar) {
        await window.CampoAltoDB.sync_queue.delete(item.id)
        continue
      }

      const { error } = await sincronizar(item, usuarioId)

      if (!error) {
        await window.CampoAltoDB.sync_queue.delete(item.id)
        procesadas++
        continue
      }

      // error.code presente (y no PGRST202, ya manejado en el fallback) =
      // el servidor SÍ respondió y rechazó la operación por una razón
      // real → no es un problema de red, no tiene caso reintentar solo.
      const esFallaReal = !!error.code && error.code !== 'PGRST202'

      if (!esFallaReal) {
        await window.CampoAltoDB.sync_queue.update(item.id, { intentos: (item.intentos || 0) + 1 })
        continue
      }

      const mensaje = error.message || String(error)
      const { ok } = await registrarFalloDefinitivo(item, usuarioId, mensaje)

      if (ok) {
        await window.CampoAltoDB.sync_queue.delete(item.id)
        fallidasDefinitivas++
      } else {
        // Ni siquiera se pudo dejar constancia del fallo (¿la conexión se
        // cayó de nuevo?) -- no perder el registro, reintentar después.
        await window.CampoAltoDB.sync_queue.update(item.id, { intentos: (item.intentos || 0) + 1 })
      }
    }
  } finally {
    procesando = false
  }

  if (procesadas > 0 || fallidasDefinitivas > 0) {
    window.dispatchEvent(new CustomEvent('sync-queue:completado', { detail: { procesadas, fallidasDefinitivas } }))
  }

  return { procesadas, fallidasDefinitivas }
}

function contarPendientes() {
  return window.CampoAltoDB.sync_queue.where('estado').equals('pendiente').count()
}

window.addEventListener('online', () => { procesarCola() })
if (navigator.onLine) {
  setTimeout(() => procesarCola(), 1500)
}

window.SyncQueue = {
  encolar,
  procesarCola,
  contarPendientes,
}
