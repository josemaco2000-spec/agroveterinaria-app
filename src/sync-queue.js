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
  // cierre_caja no tiene tabla de conciliación propia: la política RLS de
  // cierres_caja es "cualquier autenticado puede insertar" sin ninguna
  // regla de negocio que lo rechace (a diferencia de stock o límite de
  // crédito), así que un rechazo REAL del servidor es prácticamente
  // inalcanzable hoy. Si llegara a pasar, registrarFalloDefinitivo
  // devuelve { ok: false } (ver abajo) y el ítem simplemente se queda
  // pendiente en la cola en vez de perderse — no amerita una tabla server
  // side + panel de admin para un caso que no puede ocurrir con el
  // esquema actual.
}

// Ciclo de vida de un ítem de la cola (Fase 0, multi-dispositivo).
const ESTADOS = Object.freeze({
  PENDIENTE: 'pendiente',       // esperando turno para sincronizar
  PROCESANDO: 'procesando',     // reclamado por una pestaña (ver lease_owner/lease_hasta)
  SINCRONIZADO: 'sincronizado', // el servidor lo confirmó (se conserva para dependencias/auditoría)
  FALLIDO: 'fallido',           // rechazado de verdad; constancia en la tabla de conciliación
  BLOQUEADO: 'bloqueado',       // una dependencia falló o no existe: no se puede enviar
  CONFLICTO: 'conflicto',       // reservado (Fase 1+): registrado en el servidor pero con conflicto (p.ej. stock)
})

// Estados de una dependencia que permiten enviar al dependiente. CONFLICTO
// cuenta como resuelta: una venta con conflicto de stock SÍ queda
// registrada en el servidor (el conflicto se concilia aparte).
const DEPENDENCIA_RESUELTA = [ESTADOS.SINCRONIZADO, ESTADOS.CONFLICTO]
const DEPENDENCIA_ROTA = [ESTADOS.FALLIDO, ESTADOS.BLOQUEADO]

// Si una pestaña reclama un ítem y muere a medio envío, otra lo puede
// retomar cuando vence el lease. Las ventas/ajustes son idempotentes por
// local_id en el servidor, así que un reenvío tardío no duplica.
const LEASE_MS = 5 * 60 * 1000
const MAX_ERRORES_GUARDADOS = 10
const NOMBRE_LOCK = 'campo-alto:sync-queue'
// Identifica a ESTA pestaña como dueña de un lease.
const EJECUTOR_ID = crypto.randomUUID()

let procesando = false

// Avisa a esta y a las demás pestañas del mismo dispositivo que la cola
// cambió. Es un evento aparte de 'sync-queue:completado' a propósito: ese
// dispara alert()/recarga de catálogo en pos.js/cajero-pos.js y no debe
// repetirse en cada pestaña abierta. Hoy nadie escucha 'sync-queue:cambio';
// queda listo para badges/indicadores en fases siguientes.
const canalCola = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('campo-alto:sync-queue')
  : null

canalCola?.addEventListener('message', (ev) => {
  window.dispatchEvent(new CustomEvent('sync-queue:cambio', { detail: ev.data }))
})

function notificarCambio(detalle) {
  const detail = { ...detalle, origen: EJECUTOR_ID }
  window.dispatchEvent(new CustomEvent('sync-queue:cambio', { detail }))
  try {
    canalCola?.postMessage(detail)
  } catch (e) {
    // Canal cerrado (pestaña descargándose): no afecta a la cola.
  }
}

// Usuario que tiene la sesión (online u offline) en este momento. Es quien
// realiza la operación: se guarda en el ítem y NO cambia aunque después
// sincronice otra persona.
function usuarioSesionActual() {
  return window.AuthGuard?.leerSesionLocal?.()?.user_id || null
}

// tipo: 'venta' | 'ajuste_inventario' | 'cierre_caja'. payload: objeto ya
// listo para convertirse en los parámetros de la RPC (ver
// sincronizarVenta/sincronizarAjuste abajo) — el módulo genérico no conoce
// catálogo ni costos, así que quien encola debe entregar el payload ya
// armado.
//
// opciones (todas opcionales):
// - dependencias: local_id de operaciones YA encoladas que deben
//   sincronizarse antes que esta (p.ej. crear cliente → venta a crédito).
// - localId: identidad propia si quien encola ya la generó; encolar dos
//   veces el mismo localId no duplica (devuelve el mismo id).
// - usuarioId: autor de la operación (por defecto, la sesión actual).
// - fechaOperacion: cuándo ocurrió la operación (por defecto, ahora).
async function encolar(tipo, payload, opciones = {}) {
  const dependencias = opciones.dependencias || []
  if (!Array.isArray(dependencias) || dependencias.some((d) => typeof d !== 'string' || !d)) {
    throw new Error('dependencias debe ser un arreglo de local_id.')
  }

  const db = window.CampoAltoDB
  const localId = opciones.localId || crypto.randomUUID()
  const deviceId = await window.CampoAltoDevice.obtenerDeviceId()
  const ahora = new Date().toISOString()

  await db.transaction('rw', db.sync_queue, async () => {
    const existente = await db.sync_queue.where('local_id').equals(localId).first()
    if (existente) {
      if (existente.tipo !== tipo) {
        throw new Error(`El local_id ${localId} ya existe en la cola con otro tipo (${existente.tipo}).`)
      }
      return
    }

    if (dependencias.length > 0) {
      const encontradas = await db.sync_queue.where('local_id').anyOf(dependencias).toArray()
      const ids = new Set(encontradas.map((f) => f.local_id))
      const faltantes = dependencias.filter((d) => !ids.has(d))
      if (faltantes.length > 0) {
        throw new Error(`Dependencias inexistentes en la cola local: ${faltantes.join(', ')}`)
      }
    }

    await db.sync_queue.add({
      tipo,
      local_id: localId,
      device_id: deviceId,
      usuario_id: opciones.usuarioId || usuarioSesionActual(),
      fecha_operacion: opciones.fechaOperacion || ahora,
      created_at: ahora,
      payload,
      dependencias: [...dependencias],
      estado: ESTADOS.PENDIENTE,
      intentos: 0,
      errores: [],
      ultimo_error: null,
      conflicto: null,
      sincronizado_en: null,
      sincronizado_por: null,
      remote_id: null,
      lease_owner: null,
      lease_hasta: null,
    })
  })

  notificarCambio({ evento: 'encolado', local_id: localId })
  return localId
}

// { listas: true } si todas las dependencias ya están en el servidor,
// { listas: false } si hay que esperar, { bloqueo: mensaje } si nunca
// podrán cumplirse. Se llama dentro de la transacción de reclamarItem.
async function evaluarDependencias(db, item) {
  const dependencias = item.dependencias || []
  if (dependencias.length === 0) return { listas: true }

  const filas = await db.sync_queue.where('local_id').anyOf(dependencias).toArray()
  const porLocalId = new Map(filas.map((f) => [f.local_id, f]))

  let listas = true
  for (const dep of dependencias) {
    const fila = porLocalId.get(dep)
    if (!fila) return { bloqueo: `La dependencia ${dep} no existe en la cola local.` }
    if (DEPENDENCIA_ROTA.includes(fila.estado)) {
      return { bloqueo: `La dependencia ${dep} quedó en estado "${fila.estado}".` }
    }
    if (!DEPENDENCIA_RESUELTA.includes(fila.estado)) listas = false
  }
  return { listas }
}

// Reclama un ítem para procesarlo, de forma atómica (transacción rw de
// IndexedDB: dos pestañas no pueden ganar el mismo ítem). Devuelve el ítem
// reclamado, o null si no está disponible (ya lo tiene otra pestaña con
// lease vigente, ya se sincronizó, o sus dependencias no están listas).
async function reclamarItem(id, ejecutorId = EJECUTOR_ID) {
  const db = window.CampoAltoDB
  return db.transaction('rw', db.sync_queue, async () => {
    const item = await db.sync_queue.get(id)
    if (!item) return null

    const ahora = Date.now()
    const leaseVencido = item.estado === ESTADOS.PROCESANDO &&
      (!item.lease_hasta || Date.parse(item.lease_hasta) <= ahora)
    if (item.estado !== ESTADOS.PENDIENTE && !leaseVencido) return null

    const deps = await evaluarDependencias(db, item)
    if (deps.bloqueo) {
      await db.sync_queue.update(id, {
        estado: ESTADOS.BLOQUEADO,
        ...registroDeError(item, deps.bloqueo),
        lease_owner: null,
        lease_hasta: null,
      })
      return null
    }
    if (!deps.listas) return null

    const cambios = {
      estado: ESTADOS.PROCESANDO,
      lease_owner: ejecutorId,
      lease_hasta: new Date(ahora + LEASE_MS).toISOString(),
    }
    await db.sync_queue.update(id, cambios)
    return { ...item, ...cambios }
  })
}

// Escribe el resultado solo si esta pestaña sigue siendo la dueña del
// lease (si venció y otra lo retomó, el resultado lo escribe la otra).
async function finalizarItem(item, cambios, ejecutorId = EJECUTOR_ID) {
  const db = window.CampoAltoDB
  return db.transaction('rw', db.sync_queue, async () => {
    const actual = await db.sync_queue.get(item.id)
    if (!actual || actual.estado !== ESTADOS.PROCESANDO || actual.lease_owner !== ejecutorId) return false
    await db.sync_queue.update(item.id, { ...cambios, lease_owner: null, lease_hasta: null })
    return true
  })
}

function registroDeError(item, mensaje) {
  const errores = [...(item.errores || []), { en: new Date().toISOString(), mensaje }]
  return { errores: errores.slice(-MAX_ERRORES_GUARDADOS), ultimo_error: mensaje }
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

// cierres_caja se llena con un INSERT directo (no hay RPC ni columna
// local_id) -- no necesita el patrón de idempotencia de ventas/ajustes
// porque un cierre se hace una sola vez por turno, muy baja frecuencia,
// y un eventual duplicado por la carrera "el servidor confirmó pero la
// respuesta se perdió" sería fácil de detectar a simple vista en el
// panel de cierres (dos filas del mismo usuario el mismo día) y de
// borrar a mano -- no justifica otra migración de esquema.
function sincronizarCierre(item) {
  return supabaseQueue.from('cierres_caja').insert([item.payload])
}

const SINCRONIZADORES = {
  venta: sincronizarVenta,
  ajuste_inventario: sincronizarAjuste,
  cierre_caja: sincronizarCierre,
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

// Recorre la cola en orden FIFO (respetando dependencias). Nunca lanza:
// cada ítem que falle por red vuelve a 'pendiente' para el próximo
// intento; cada ítem rechazado de verdad por el servidor se registra en la
// tabla de conciliación correspondiente y queda como 'fallido' en la cola
// local.
//
// No recibe callbacks: se dispara igual desde cualquier página (la que
// haya quedado abierta cuando vuelve la conexión), así que en vez de
// callbacks emite un evento `sync-queue:completado` en `window` — cada
// página escucha ese evento y decide cómo refrescar su propia UI (ver
// pos.js/cajero-pos.js).
//
// Exclusión mutua en dos capas:
// 1. Web Locks (navigator.locks): solo UNA pestaña del dispositivo recorre
//    la cola a la vez; las demás ni lo intentan. El navegador libera el
//    candado solo si la pestaña se cierra o se cuelga.
// 2. Reclamo atómico por ítem con lease en IndexedDB (reclamarItem): aun
//    sin Web Locks (navegador viejo), dos pestañas nunca envían el mismo
//    ítem al mismo tiempo.
// Entre dispositivos distintos no hay candado local posible: ahí la
// protección es la idempotencia por local_id en el servidor.
async function procesarCola() {
  if (procesando || !navigator.onLine) return { procesadas: 0, fallidasDefinitivas: 0 }

  if (navigator.locks?.request) {
    return navigator.locks.request(NOMBRE_LOCK, { ifAvailable: true }, (lock) => {
      // null = otra pestaña de este dispositivo ya está sincronizando.
      if (!lock) return { procesadas: 0, fallidasDefinitivas: 0 }
      return procesarColaConCandado()
    })
  }

  return procesarColaConCandado()
}

async function procesarColaConCandado() {
  if (procesando) return { procesadas: 0, fallidasDefinitivas: 0 }
  procesando = true

  let procesadas = 0
  let fallidasDefinitivas = 0

  try {
    // Incluye 'procesando': si una pestaña murió con un ítem reclamado,
    // reclamarItem lo retoma cuando vence su lease.
    const candidatos = await window.CampoAltoDB.sync_queue
      .where('estado').anyOf(ESTADOS.PENDIENTE, ESTADOS.PROCESANDO)
      .sortBy('created_at')
    if (candidatos.length === 0) return { procesadas: 0, fallidasDefinitivas: 0 }

    const { data: { session } } = await supabaseQueue.auth.getSession()
    const usuarioId = session?.user?.id || null

    // Sin sesión las RPC rechazan la llamada (migración 33): esperar a
    // que alguien inicie sesión en vez de gastar intentos inútiles.
    if (!usuarioId) return { procesadas: 0, fallidasDefinitivas: 0 }

    for (const candidato of candidatos) {
      const item = await reclamarItem(candidato.id)
      if (!item) continue

      const sincronizar = SINCRONIZADORES[item.tipo]
      if (!sincronizar) {
        // Antes se borraba en silencio; ahora queda visible localmente.
        await finalizarItem(item, {
          estado: ESTADOS.FALLIDO,
          ...registroDeError(item, `Tipo de operación desconocido: ${item.tipo}`),
        })
        continue
      }

      let resultado
      try {
        resultado = await sincronizar(item, usuarioId)
      } catch (e) {
        // Excepción del cliente (p.ej. fetch abortado): se trata como red.
        resultado = { error: { message: e?.message || String(e) } }
      }
      const { data, error } = resultado

      if (!error) {
        // sincronizado_por = quien tenía la sesión al sincronizar; el autor
        // de la operación sigue siendo item.usuario_id.
        await finalizarItem(item, {
          estado: ESTADOS.SINCRONIZADO,
          sincronizado_en: new Date().toISOString(),
          sincronizado_por: usuarioId,
          remote_id: typeof data === 'string' ? data : null,
        })
        procesadas++
        continue
      }

      // error.code presente (y no PGRST202, ya manejado en el fallback) =
      // el servidor SÍ respondió y rechazó la operación por una razón
      // real → no es un problema de red, no tiene caso reintentar solo.
      const esFallaReal = !!error.code && error.code !== 'PGRST202'
      const mensaje = error.message || String(error)

      if (!esFallaReal) {
        await finalizarItem(item, {
          estado: ESTADOS.PENDIENTE,
          intentos: (item.intentos || 0) + 1,
          ...registroDeError(item, mensaje),
        })
        continue
      }

      const { ok } = await registrarFalloDefinitivo(item, usuarioId, mensaje)

      if (ok) {
        // Se conserva localmente (antes se borraba) para que sus
        // dependientes sepan que no deben enviarse.
        await finalizarItem(item, { estado: ESTADOS.FALLIDO, ...registroDeError(item, mensaje) })
        fallidasDefinitivas++
      } else {
        // Ni siquiera se pudo dejar constancia del fallo (¿la conexión se
        // cayó de nuevo?) -- no perder el registro, reintentar después.
        await finalizarItem(item, {
          estado: ESTADOS.PENDIENTE,
          intentos: (item.intentos || 0) + 1,
          ...registroDeError(item, mensaje),
        })
      }
    }
  } finally {
    procesando = false
  }

  if (procesadas > 0 || fallidasDefinitivas > 0) {
    window.dispatchEvent(new CustomEvent('sync-queue:completado', { detail: { procesadas, fallidasDefinitivas } }))
    notificarCambio({ evento: 'procesado', procesadas, fallidasDefinitivas })
  }

  return { procesadas, fallidasDefinitivas }
}

// Todo lo que sigue en el dispositivo sin haber llegado al servidor:
// incluye 'procesando' (envío en curso) y 'bloqueado' (necesita revisión).
function contarPendientes() {
  return window.CampoAltoDB.sync_queue
    .where('estado').anyOf(ESTADOS.PENDIENTE, ESTADOS.PROCESANDO, ESTADOS.BLOQUEADO)
    .count()
}

window.addEventListener('online', () => { procesarCola() })
if (navigator.onLine) {
  setTimeout(() => procesarCola(), 1500)
}

window.SyncQueue = {
  ESTADOS,
  encolar,
  procesarCola,
  contarPendientes,
  reclamarItem,
  finalizarItem,
}
