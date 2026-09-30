/**
 * Suite de Pruebas FASE 0: identidad de dispositivo y cola de sincronización.
 * Ejecución: node tests/fase0-offline.test.js
 *
 * Corre los archivos REALES del app (src/vendor/dexie.js, src/db.js,
 * src/auth-guard.js, src/sync-queue.js) en Chromium vía Playwright, porque
 * lo que se prueba depende de IndexedDB, Web Locks y BroadcastChannel del
 * navegador. Supabase se reemplaza por un cliente simulado (sin red).
 *
 * Cada "dispositivo" es un contexto de navegador aislado (almacenamiento
 * propio); cada "pestaña" es una página dentro del mismo contexto.
 */
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { chromium } = require('playwright')

const RAIZ = path.join(__dirname, '..')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let pasados = 0
let fallados = 0

function assert(condicion, mensaje) {
  if (condicion) {
    console.log(`  ✅ PASÓ: ${mensaje}`)
    pasados++
  } else {
    console.error(`  ❌ FALLÓ: ${mensaje}`)
    fallados++
  }
}

// Supabase simulado: registra cada llamada; la respuesta y la demora se
// controlan desde la prueba vía window.__rpcRespuesta / __demoraMs.
const SUPABASE_FALSO = `
window.__llamadas = []
window.__sesionUsuario = null
window.__demoraMs = 0
window.__rpcRespuesta = null
window.__eventosCambio = []
window.addEventListener('sync-queue:cambio', (e) => window.__eventosCambio.push(e.detail))
const esperar = () => new Promise((r) => setTimeout(r, window.__demoraMs))
window.supabase = {
  createClient: () => ({
    rpc: async (nombre, params) => {
      window.__llamadas.push({ nombre, local_id: params.p_local_id })
      await esperar()
      return window.__rpcRespuesta ? window.__rpcRespuesta(nombre, params) : { data: crypto.randomUUID(), error: null }
    },
    from: (tabla) => ({
      insert: async (filas) => {
        window.__llamadas.push({ tabla, filas })
        await esperar()
        return { error: null }
      },
    }),
    auth: {
      getSession: async () => ({
        data: { session: window.__sesionUsuario ? { user: { id: window.__sesionUsuario } } : null },
      }),
    },
  }),
}
`

function harness(sinLocks) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
${sinLocks ? "Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true })" : ''}
${SUPABASE_FALSO}
</script>
<script src="/src/vendor/dexie.js"></script>
<script src="/src/db.js"></script>
<script src="/src/auth-guard.js"></script>
<script src="/src/sync-queue.js"></script>
</body></html>`
}

// Página que crea la base con el esquema v3 (el de producción antes de
// esta fase) y deja un ítem viejo en la cola, para probar el upgrade.
const PAGINA_V3 = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script src="/src/vendor/dexie.js"></script>
<script>
window.listo = (async () => {
  const db = new Dexie('campo_alto_local')
  db.version(3).stores({
    usuarios_cache: 'user_id, email',
    presentaciones: 'id, producto_id, nombre_presentacion',
    stock_ubicacion: '[producto_id+ubicacion_id], producto_id, ubicacion_id',
    clientes: 'id, nombre, nit',
    meta_sync: 'clave',
    sync_queue: '++id, tipo, estado, created_at',
  })
  await db.sync_queue.add({ tipo: 'venta', local_id: '11111111-1111-4111-8111-111111111111',
    payload: { items: [], total: 10 }, estado: 'pendiente', intentos: 2, created_at: '2026-09-01T10:00:00.000Z' })
  db.close()
  return true
})()
</script></body></html>`

function iniciarServidor() {
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/harness') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(harness(url.searchParams.has('sinLocks')))
    }
    if (url.pathname === '/v3') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(PAGINA_V3)
    }
    const archivo = path.join(RAIZ, decodeURIComponent(url.pathname))
    if (!archivo.startsWith(path.join(RAIZ, 'src')) || !fs.existsSync(archivo)) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' })
    fs.createReadStream(archivo).pipe(res)
  })
  return new Promise((resolve) => servidor.listen(0, '127.0.0.1', () => resolve(servidor)))
}

async function abrir(contexto, base, sinLocks = false) {
  const pagina = await contexto.newPage()
  await pagina.goto(`${base}/harness${sinLocks ? '?sinLocks=1' : ''}`)
  await pagina.waitForFunction(() => window.SyncQueue && window.CampoAltoDevice)
  return pagina
}

function iniciarSesionLocal(pagina, userId, rol = 'vendedor') {
  return pagina.evaluate(([id, r]) => {
    localStorage.setItem('campo_alto_session', JSON.stringify({ user_id: id, rol: r, expira_en: Date.now() + 3600000 }))
  }, [userId, rol])
}

const leerCola = (pagina) => pagina.evaluate(() => window.CampoAltoDB.sync_queue.toArray())

async function main() {
  console.log('==================================================')
  console.log('🧪 EJECUTANDO TEST: FASE 0 — device_id y SyncQueue')
  console.log('==================================================')

  const servidor = await iniciarServidor()
  const base = `http://127.0.0.1:${servidor.address().port}`
  const navegador = await chromium.launch()
  const perfilDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-alto-fase0-'))

  try {
    // --- TEST 1: device_id se genera, es UUID y persiste entre recargas ---
    console.log('\n[1] device_id: generación y persistencia')
    {
      const ctx = await navegador.newContext()
      const p = await abrir(ctx, base)
      const id1 = await p.evaluate(() => window.CampoAltoDevice.obtenerDeviceId())
      assert(UUID_RE.test(id1), `device_id es un UUID v4 (${id1})`)
      const id1b = await p.evaluate(() => window.CampoAltoDevice.obtenerDeviceId())
      assert(id1 === id1b, 'Llamadas repetidas en la misma pestaña devuelven el mismo id')
      await p.reload()
      await p.waitForFunction(() => window.CampoAltoDevice)
      const id2 = await p.evaluate(() => window.CampoAltoDevice.obtenerDeviceId())
      assert(id1 === id2, 'El device_id se conserva al recargar la página (nueva sesión de la pestaña)')
      const p2 = await abrir(ctx, base)
      const id3 = await p2.evaluate(() => window.CampoAltoDevice.obtenerDeviceId())
      assert(id1 === id3, 'Otra pestaña del mismo dispositivo ve el mismo device_id')
      await ctx.close()
    }

    // --- TEST 2: persiste al cerrar y reabrir el navegador ---
    console.log('\n[2] device_id: persistencia entre sesiones del navegador')
    {
      let ctx = await chromium.launchPersistentContext(perfilDir)
      let p = await abrir(ctx, base)
      const antes = await p.evaluate(() => window.CampoAltoDevice.obtenerDeviceId())
      await ctx.close()
      ctx = await chromium.launchPersistentContext(perfilDir)
      p = await abrir(ctx, base)
      const despues = await p.evaluate(() => window.CampoAltoDevice.obtenerDeviceId())
      assert(antes === despues, 'El device_id sobrevive a cerrar y reabrir el navegador')
      await ctx.close()
    }

    // --- TEST 3: computadora + 2 teléfonos = 3 ids distintos ---
    console.log('\n[3] device_id: dispositivos distintos generan ids distintos')
    {
      const ids = []
      for (let i = 0; i < 3; i++) {
        const ctx = await navegador.newContext()
        const p = await abrir(ctx, base)
        ids.push(await p.evaluate(() => window.CampoAltoDevice.obtenerDeviceId()))
        await ctx.close()
      }
      assert(new Set(ids).size === 3, `Computadora y 2 teléfonos tienen ids distintos (${ids.map((x) => x.slice(0, 8)).join(', ')})`)
    }

    // --- TEST 4: carrera al crear el id en un dispositivo nuevo ---
    console.log('\n[4] device_id: pestañas simultáneas en un dispositivo nuevo')
    {
      const ctx = await navegador.newContext()
      const paginas = await Promise.all([abrir(ctx, base), abrir(ctx, base), abrir(ctx, base)])
      const ids = await Promise.all(paginas.map((p) => p.evaluate(() => window.CampoAltoDevice.obtenerDeviceId())))
      assert(new Set(ids).size === 1, 'Tres pestañas que arrancan a la vez obtienen el MISMO device_id')
      await ctx.close()
    }

    // --- TEST 5: local_id e identidad completa de la operación ---
    console.log('\n[5] local_id e identidad de la operación')
    {
      const ctx = await navegador.newContext()
      const p = await abrir(ctx, base)
      await iniciarSesionLocal(p, 'usuario-cajero-a')
      const ids = await p.evaluate(async () => {
        const res = []
        for (let i = 0; i < 20; i++) res.push(await window.SyncQueue.encolar('venta', { items: [], total: i }))
        return res
      })
      assert(ids.every((x) => UUID_RE.test(x)), 'Cada local_id es un UUID v4')
      assert(new Set(ids).size === 20, '20 operaciones encoladas generan 20 local_id distintos')
      const cola = await leerCola(p)
      const deviceId = await p.evaluate(() => window.CampoAltoDevice.obtenerDeviceId())
      const item = cola[0]
      assert(item.device_id === deviceId, 'La operación guarda el device_id del dispositivo')
      assert(item.usuario_id === 'usuario-cajero-a', 'La operación guarda el usuario que la creó')
      assert(item.tipo === 'venta' && item.estado === 'pendiente', 'La operación guarda tipo y estado inicial')
      assert(Array.isArray(item.dependencias) && item.intentos === 0 && Array.isArray(item.errores) && item.conflicto === null,
        'La operación trae dependencias, intentos, errores y conflicto inicializados')
      assert(!!item.fecha_operacion && item.sincronizado_en === null, 'Tiene fecha de operación y aún no fecha de sincronización')

      const repetido = await p.evaluate(async (id) => window.SyncQueue.encolar('venta', { items: [] }, { localId: id }), ids[0])
      const total = await p.evaluate(() => window.CampoAltoDB.sync_queue.count())
      assert(repetido === ids[0] && total === 20, 'Encolar dos veces el mismo local_id no duplica la operación')
      await ctx.close()
    }

    // --- TEST 6 y 7: usuario original y fechas distintas ---
    console.log('\n[6-7] Usuario original y timestamps de operación vs sincronización')
    {
      const ctx = await navegador.newContext()
      const p = await abrir(ctx, base)
      await iniciarSesionLocal(p, 'usuario-cajero-a')
      const ayer = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      const [idAyer, idAhora] = await p.evaluate(async (fecha) => [
        await window.SyncQueue.encolar('venta', { items: [], total: 5 }, { fechaOperacion: fecha }),
        await window.SyncQueue.encolar('venta', { items: [], total: 6 }),
      ], ayer)
      await p.waitForTimeout(30)
      // Un admin inicia sesión después y la cola se vacía con SU sesión.
      await iniciarSesionLocal(p, 'usuario-admin-b', 'admin')
      await p.evaluate(() => { window.__sesionUsuario = 'usuario-admin-b' })
      const r = await p.evaluate(() => window.SyncQueue.procesarCola())
      const cola = await leerCola(p)
      const a = cola.find((x) => x.local_id === idAyer)
      const b = cola.find((x) => x.local_id === idAhora)
      assert(r.procesadas === 2 && a.estado === 'sincronizado' && b.estado === 'sincronizado', 'Ambas operaciones se sincronizan')
      assert(a.usuario_id === 'usuario-cajero-a' && b.usuario_id === 'usuario-cajero-a', 'El autor sigue siendo el cajero original')
      assert(a.sincronizado_por === 'usuario-admin-b', 'Queda registrado que el admin fue quien sincronizó (no el autor)')
      assert(a.fecha_operacion === ayer, 'La fecha de operación original se conserva intacta')
      assert(Date.parse(a.sincronizado_en) > Date.parse(a.fecha_operacion), 'sincronizado_en es posterior a la operación offline de ayer')
      assert(b.sincronizado_en !== b.fecha_operacion && Date.parse(b.sincronizado_en) > Date.parse(b.fecha_operacion),
        'Aun sin fecha explícita, fecha de operación y de sincronización son campos distintos')
      assert(UUID_RE.test(a.remote_id), 'Se guarda el id que devolvió el servidor')
      const enviados = await p.evaluate(() => window.__llamadas.map((l) => l.local_id))
      assert(enviados.includes(idAyer) && enviados.includes(idAhora), 'Cada RPC viaja con su local_id (idempotencia en servidor)')
      await ctx.close()
    }

    // --- TEST 8: no procesar la misma operación dos veces a la vez ---
    for (const sinLocks of [false, true]) {
      console.log(`\n[8] Exclusión entre pestañas del mismo dispositivo (${sinLocks ? 'SIN Web Locks: solo lease' : 'con Web Locks'})`)
      const ctx = await navegador.newContext()
      const p1 = await abrir(ctx, base, sinLocks)
      const p2 = await abrir(ctx, base, sinLocks)
      assert(sinLocks === !(await p1.evaluate(() => !!navigator.locks)), `navigator.locks ${sinLocks ? 'deshabilitado' : 'disponible'} en la prueba`)
      await iniciarSesionLocal(p1, 'usuario-cajero-a')
      const ids = await p1.evaluate(async () => {
        const res = []
        for (let i = 0; i < 5; i++) res.push(await window.SyncQueue.encolar('venta', { items: [], total: i }))
        return res
      })
      for (const p of [p1, p2]) await p.evaluate(() => { window.__sesionUsuario = 'usuario-cajero-a'; window.__demoraMs = 150 })
      await Promise.all([
        p1.evaluate(() => window.SyncQueue.procesarCola()),
        p2.evaluate(() => window.SyncQueue.procesarCola()),
        p1.evaluate(() => window.SyncQueue.procesarCola()),
        p2.evaluate(() => window.SyncQueue.procesarCola()),
      ])
      const llamadas = [
        ...(await p1.evaluate(() => window.__llamadas)),
        ...(await p2.evaluate(() => window.__llamadas)),
      ].map((l) => l.local_id)
      const porId = ids.map((id) => llamadas.filter((x) => x === id).length)
      assert(porId.every((n) => n === 1), `Cada operación se envió exactamente 1 vez (envíos: ${porId.join(',')})`)
      const cola = await leerCola(p1)
      assert(cola.every((x) => x.estado === 'sincronizado' && x.lease_owner === null), 'Todas quedan sincronizadas y sin lease')
      await ctx.close()
    }

    console.log('\n[8b] Reclamo atómico y lease vencido')
    {
      const ctx = await navegador.newContext()
      const p1 = await abrir(ctx, base)
      const p2 = await abrir(ctx, base)
      await p1.evaluate(() => window.SyncQueue.encolar('venta', { items: [] }))
      const id = await p1.evaluate(async () => (await window.CampoAltoDB.sync_queue.toCollection().first()).id)
      const [r1, r2] = await Promise.all([
        p1.evaluate((i) => window.SyncQueue.reclamarItem(i, 'pestaña-1'), id),
        p2.evaluate((i) => window.SyncQueue.reclamarItem(i, 'pestaña-2'), id),
      ])
      assert([r1, r2].filter(Boolean).length === 1, 'Dos pestañas reclaman el mismo ítem a la vez: solo una lo obtiene')
      const tercero = await p1.evaluate((i) => window.SyncQueue.reclamarItem(i, 'pestaña-3'), id)
      assert(tercero === null, 'Con lease vigente, nadie más puede reclamarlo')
      const perdedor = r1 ? 'pestaña-2' : 'pestaña-1'
      const escribio = await p1.evaluate(([i, e]) => window.SyncQueue.finalizarItem({ id: i }, { estado: 'sincronizado' }, e), [id, perdedor])
      assert(escribio === false, 'Una pestaña que no es dueña del lease no puede escribir el resultado')
      await p1.evaluate((i) => window.CampoAltoDB.sync_queue.update(i, { lease_hasta: new Date(Date.now() - 1000).toISOString() }), id)
      const retomado = await p1.evaluate((i) => window.SyncQueue.reclamarItem(i, 'pestaña-3'), id)
      assert(retomado && retomado.lease_owner === 'pestaña-3', 'Si la pestaña dueña murió (lease vencido), otra puede retomarlo')
      await ctx.close()
    }

    // --- TEST 9: dependencias ---
    console.log('\n[9] Operaciones con dependencias')
    {
      const ctx = await navegador.newContext()
      const p = await abrir(ctx, base)
      await iniciarSesionLocal(p, 'usuario-cajero-a')
      const error = await p.evaluate(async () => {
        try {
          await window.SyncQueue.encolar('venta', { items: [] }, { dependencias: ['no-existe'] })
          return null
        } catch (e) {
          return e.message
        }
      })
      assert(!!error && error.includes('no-existe'), 'No se puede encolar con una dependencia inexistente')

      const [idA, idB] = await p.evaluate(async () => {
        const a = await window.SyncQueue.encolar('ajuste_inventario', { producto_id: 'x', cantidad: 1 })
        const b = await window.SyncQueue.encolar('venta', { items: [] }, { dependencias: [a] })
        return [a, b]
      })
      const cola0 = await leerCola(p)
      assert(JSON.stringify(cola0.find((x) => x.local_id === idB).dependencias) === JSON.stringify([idA]),
        'La operación dependiente guarda el local_id de su dependencia')

      // A falla por red → B no debe enviarse.
      await p.evaluate(() => {
        window.__sesionUsuario = 'usuario-cajero-a'
        window.__rpcRespuesta = (nombre) => nombre === 'registrar_ajuste_inventario'
          ? { data: null, error: { message: 'Failed to fetch', code: '' } }
          : { data: crypto.randomUUID(), error: null }
      })
      await p.evaluate(() => window.SyncQueue.procesarCola())
      let llamadas = await p.evaluate(() => window.__llamadas.map((l) => l.local_id))
      let cola = await leerCola(p)
      assert(!llamadas.includes(idB), 'Si la dependencia no se sincronizó, la dependiente NO se envía')
      assert(cola.find((x) => x.local_id === idA).estado === 'pendiente' && cola.find((x) => x.local_id === idA).intentos === 1,
        'La dependencia vuelve a pendiente con el intento contado')
      assert(cola.find((x) => x.local_id === idA).ultimo_error === 'Failed to fetch', 'El error queda registrado en la operación')

      // A se sincroniza → B se envía después de A, en la misma pasada.
      await p.evaluate(() => { window.__rpcRespuesta = null; window.__llamadas = [] })
      await p.evaluate(() => window.SyncQueue.procesarCola())
      llamadas = await p.evaluate(() => window.__llamadas.map((l) => l.local_id))
      cola = await leerCola(p)
      assert(llamadas.indexOf(idA) === 0 && llamadas.indexOf(idB) === 1, 'Con la dependencia sincronizada, la dependiente se envía después')
      assert(cola.every((x) => x.estado === 'sincronizado'), 'Ambas quedan sincronizadas')

      // C depende de D, y D es rechazada por el servidor → C queda bloqueada.
      const [idD, idC] = await p.evaluate(async () => {
        const d = await window.SyncQueue.encolar('ajuste_inventario', { producto_id: 'y', cantidad: 1 })
        const c = await window.SyncQueue.encolar('venta', { items: [] }, { dependencias: [d] })
        window.__rpcRespuesta = (nombre) => nombre === 'registrar_ajuste_inventario'
          ? { data: null, error: { message: 'Stock insuficiente', code: 'P0001' } }
          : { data: crypto.randomUUID(), error: null }
        window.__llamadas = []
        await window.SyncQueue.procesarCola()
        return [d, c]
      })
      cola = await leerCola(p)
      llamadas = await p.evaluate(() => window.__llamadas.map((l) => l.local_id))
      assert(cola.find((x) => x.local_id === idD).estado === 'fallido', 'La dependencia rechazada queda como fallido (no se borra)')
      assert(cola.find((x) => x.local_id === idC).estado === 'bloqueado' && !llamadas.includes(idC),
        'La dependiente de una operación fallida queda bloqueada y nunca se envía')
      const pendientes = await p.evaluate(() => window.SyncQueue.contarPendientes())
      assert(pendientes === 1, 'El contador de pendientes incluye la operación bloqueada (requiere atención)')
      await ctx.close()
    }

    // --- TEST 10: upgrade desde el esquema v3 de producción ---
    console.log('\n[10] Migración local de la cola existente (Dexie v3 → v4)')
    {
      const ctx = await navegador.newContext()
      const pv3 = await ctx.newPage()
      await pv3.goto(`${base}/v3`)
      await pv3.evaluate(() => window.listo)
      await pv3.close()
      const p = await abrir(ctx, base)
      const [item] = await leerCola(p)
      const deviceId = await p.evaluate(() => window.CampoAltoDevice.obtenerDeviceId())
      assert(item.local_id === '11111111-1111-4111-8111-111111111111' && item.intentos === 2 && item.payload.total === 10,
        'El ítem viejo conserva local_id, intentos y payload')
      assert(item.device_id === deviceId, 'El ítem viejo recibe el device_id de este dispositivo')
      assert(item.usuario_id === null, 'El autor desconocido queda en null (no se inventa)')
      assert(item.fecha_operacion === '2026-09-01T10:00:00.000Z' && Array.isArray(item.dependencias),
        'fecha_operacion toma el created_at original y dependencias queda vacía')
      await ctx.close()
    }

    // --- TEST 11: aviso entre pestañas por BroadcastChannel ---
    console.log('\n[11] Aviso entre pestañas (BroadcastChannel)')
    {
      const ctx = await navegador.newContext()
      const p1 = await abrir(ctx, base)
      const p2 = await abrir(ctx, base)
      const localId = await p1.evaluate(() => window.SyncQueue.encolar('venta', { items: [] }))
      await p2.waitForFunction((id) => window.__eventosCambio.some((e) => e.local_id === id), localId, { timeout: 3000 }).catch(() => {})
      const recibido = await p2.evaluate((id) => window.__eventosCambio.some((e) => e.evento === 'encolado' && e.local_id === id), localId)
      assert(recibido, 'Otra pestaña recibe "sync-queue:cambio" cuando se encola una operación')
      await ctx.close()
    }
  } finally {
    await navegador.close()
    servidor.close()
    fs.rmSync(perfilDir, { recursive: true, force: true })
  }

  console.log('--------------------------------------------------')
  console.log(`RESULTADOS FINAL: ${pasados} Pasados, ${fallados} Fallados.`)
  console.log('==================================================')
  if (fallados > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
