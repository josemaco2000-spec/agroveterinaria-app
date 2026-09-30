/**
 * Suite de Pruebas FASE 1 (cliente, E2E): venta offline en los POS reales.
 * Ejecución: node tests/fase1-pos-offline.test.js
 *
 * Abre src/cajero-pos.html y src/pos.html en Chromium (Playwright) sin
 * red, cobra con clics como lo haría el usuario y verifica ticket, cola,
 * FEFO local, advertencia de vencido y lo que se manda al sincronizar.
 * Supabase se reemplaza por un cliente falso que registra cada llamada.
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const RAIZ = path.join(__dirname, '..')
const AREA_VENTA = '22222222-2222-2222-2222-222222222222'
const CAJERO = 'aaaaaaaa-0000-4000-8000-00000000000a'
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const PROD = 'bbbbbbbb-0000-4000-8000-000000000001'
const PRES = 'cccccccc-0000-4000-8000-000000000001'
const LOTE_VENCIDO = 'eeeeeeee-0000-4000-8000-000000000001'
const LOTE_VIGENTE = 'eeeeeeee-0000-4000-8000-000000000002'

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

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' }

// Cliente Supabase falso: cualquier consulta encadenada responde vacío; las
// RPC responden con un uuid y quedan registradas en window.__llamadas.
const SUPABASE_FALSO = `
window.__llamadas = []
window.__sesion = null
function cadena(resultado) {
  const c = {}
  for (const m of ['select', 'eq', 'gt', 'gte', 'lt', 'order', 'in', 'or', 'insert', 'update', 'delete', 'limit', 'ilike'])
    c[m] = () => c
  c.single = () => Promise.resolve({ data: null, error: null })
  c.maybeSingle = () => Promise.resolve({ data: null, error: null })
  c.then = (ok, ko) => Promise.resolve(resultado).then(ok, ko)
  return c
}
window.supabase = {
  createClient: () => ({
    rpc: async (nombre, params) => {
      window.__llamadas.push({ nombre, params: JSON.parse(JSON.stringify(params)) })
      return { data: crypto.randomUUID(), error: null }
    },
    from: (tabla) => cadena({ data: [], error: null }),
    auth: {
      getSession: async () => ({ data: { session: window.__sesion ? { user: { id: window.__sesion, email: 'x@x' } } : null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
  }),
}
`

// Página auxiliar del mismo origen para sembrar IndexedDB antes de abrir el POS.
const PAGINA_SEMBRAR = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script src="/src/vendor/dexie.js"></script>
<script src="/src/db.js"></script>
</body></html>`

function iniciarServidor() {
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/sembrar') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(PAGINA_SEMBRAR)
    }
    const archivo = path.join(RAIZ, decodeURIComponent(url.pathname))
    if (!archivo.startsWith(path.join(RAIZ, 'src')) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': (MIME[path.extname(archivo)] || 'application/octet-stream') + '; charset=utf-8' })
    fs.createReadStream(archivo).pipe(res)
  })
  return new Promise((resolve) => servidor.listen(0, '127.0.0.1', () => resolve(servidor)))
}

async function prepararDispositivo(navegador, base, { usuario, rol }) {
  const ctx = await navegador.newContext({ serviceWorkers: 'block' })
  // Sin red salvo que la prueba lo cambie (window.__online = true).
  await ctx.addInitScript(() => {
    window.__online = false
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => window.__online === true, configurable: true })
  })
  await ctx.route('**/vendor/supabase.js', (route) => route.fulfill({ contentType: 'application/javascript', body: SUPABASE_FALSO }))
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())

  const p = await ctx.newPage()
  await p.goto(`${base}/sembrar`)
  await p.waitForFunction(() => window.CampoAltoDB)
  await p.evaluate(async ({ PROD, PRES, LOTE_VENCIDO, LOTE_VIGENTE, AREA_VENTA, usuario, rol }) => {
    localStorage.setItem('campo_alto_session', JSON.stringify({
      user_id: usuario, email: 'u@x', rol, nombre_completo: 'Usuario Prueba', expira_en: Date.now() + 3600000,
    }))
    const db = window.CampoAltoDB
    await db.presentaciones.put({
      id: PRES, producto_id: PROD, nombre_presentacion: 'Frasco 100ml', factor_conversion: 1, precio_venta: 10,
      usable_en_compra: true, usable_en_venta: true,
      productos: { id: PROD, nombre: 'Ivermectina 1%', codigo_barras: '123', categoria: 'Farmacia', unidad_base: 'unidad', stock_base: 15, imagen_url: null },
    })
    await db.stock_ubicacion.put({ producto_id: PROD, ubicacion_id: AREA_VENTA, stock_disponible: 15 })
    await db.stock_lotes.bulkAdd([
      { lote_id: LOTE_VIGENTE, numero_lote: 'L-2027', fecha_vencimiento: '2027-06-30', producto_id: PROD, ubicacion_id: AREA_VENTA, stock_actual: 12 },
      { lote_id: LOTE_VENCIDO, numero_lote: 'L-VIEJO', fecha_vencimiento: '2026-01-31', producto_id: PROD, ubicacion_id: AREA_VENTA, stock_actual: 3 },
    ])
  }, { PROD, PRES, LOTE_VENCIDO, LOTE_VIGENTE, AREA_VENTA, usuario, rol })
  return { ctx, p }
}

// page.waitForFunction no espera Promises (las toma como "verdaderas"):
// sondeo explícito para condiciones que leen IndexedDB.
async function esperarQue(p, fn, timeoutMs = 10000) {
  const limite = Date.now() + timeoutMs
  while (Date.now() < limite) {
    if (await p.evaluate(fn)) return true
    await p.waitForTimeout(100)
  }
  throw new Error('Tiempo de espera agotado: ' + fn.toString())
}

async function agregarUnidades(p, n) {
  for (let i = 0; i < n; i++) await p.click('.btn-agregar-carrito')
}

async function probarPOS(navegador, base, pagina, { usuario, rol }) {
  console.log(`\n==> ${pagina} (${rol}, sin red)`)
  const { ctx, p } = await prepararDispositivo(navegador, base, { usuario, rol })
  const dialogos = []
  let aceptarVencido = true
  p.on('dialog', (d) => {
    dialogos.push(d.message())
    if (d.type() === 'confirm' && /VENCIDO/.test(d.message())) return aceptarVencido ? d.accept() : d.dismiss()
    return d.accept()
  })
  const errores = []
  p.on('pageerror', (e) => errores.push(e.message))

  await p.goto(`${base}/src/${pagina}`)
  await p.waitForSelector('.btn-agregar-carrito', { timeout: 15000 })

  // --- Rechazar la advertencia de vencido: no se registra nada ---
  await agregarUnidades(p, 5)
  aceptarVencido = false
  await p.click('#btn-completar-venta')
  await p.waitForTimeout(300)
  let cola = await p.evaluate(() => window.CampoAltoDB.sync_queue.toArray())
  assert(dialogos.some((m) => /VENCIDO/.test(m) && /L-VIEJO/.test(m)), '14. Se muestra advertencia clara del lote vencido antes de completar')
  assert(cola.length === 0, 'Si el usuario no confirma, la venta no se registra (no se bloquea: decide el usuario)')

  // --- Confirmar: venta offline completa ---
  aceptarVencido = true
  await p.click('#btn-completar-venta')
  await p.waitForFunction(() => !document.getElementById('modal-exito').classList.contains('hidden'), null, { timeout: 5000 })
  cola = await p.evaluate(() => window.CampoAltoDB.sync_queue.toArray())
  const item = cola[0]
  const ticket = await p.evaluate(() => document.getElementById('ticket-impresion').innerText)
  const numeroTicket = (ticket.match(/#([0-9A-Za-z-]{8})/) || [])[1] || ''
  const deviceId = await p.evaluate(() => window.CampoAltoDevice.obtenerDeviceId())

  assert(cola.length === 1, '1. Una venta offline produce una sola operación en la cola')
  assert(item.local_id === item.payload.local_id && /^[0-9a-f-]{36}$/.test(item.local_id), '1. La venta tiene un único local_id (cola = venta)')
  assert(numeroTicket.toLowerCase() === item.local_id.slice(0, 8), `2. El ticket (#${numeroTicket}) usa el mismo local_id que la cola`)
  assert(item.usuario_id === usuario && item.device_id === deviceId, '3/7. La operación guarda el usuario y el dispositivo que vendieron')
  assert(item.fecha_operacion === item.payload.fecha_operacion && item.sincronizado_en === null, '5. Guarda la fecha de operación; aún sin fecha de sincronización')

  const linea = item.payload.items[0]
  assert(linea.cantidad === 5 && linea.precio_venta === 10 && item.payload.total === 50 && item.payload.moneda === 'GTQ',
    'La venta guarda cantidad, precio cobrado, total y moneda')
  assert(linea.presentacion_id === PRES && linea.producto_id === PROD && linea.unidad_base === 'unidad' && linea.factor_conversion === 1,
    'La venta guarda producto, presentación, unidad y factor de conversión')
  assert(item.payload.ubicacion_id === AREA_VENTA, 'La venta guarda la ubicación')
  assert(linea.lotes.length === 2 && linea.lotes[0].lote_id === LOTE_VENCIDO && linea.lotes[0].cantidad_base === 3
    && linea.lotes[1].lote_id === LOTE_VIGENTE && linea.lotes[1].cantidad_base === 2,
  '15. FEFO local: 3 del lote que vence primero + 2 del siguiente')
  assert(linea.vencido === true && item.payload.advertencias.length === 1 && item.payload.advertencias[0].numero_lote === 'L-VIEJO',
    '14. La advertencia de vencimiento queda guardada en la venta')
  assert(!/costo|margen|utilidad/i.test(JSON.stringify(item.payload)), '18. La venta no lleva costos, márgenes ni utilidades')

  const lotes = await p.evaluate((prod) => window.CampoAltoDB.stock_lotes.where('[producto_id+ubicacion_id]').equals([prod, '22222222-2222-2222-2222-222222222222']).toArray(), PROD)
  const saldo = Object.fromEntries(lotes.map((l) => [l.lote_id, l.stock_actual]))
  assert(saldo[LOTE_VENCIDO] === 0 && saldo[LOTE_VIGENTE] === 10, 'El stock por lote local se descuenta para la siguiente venta offline')

  // --- Segunda venta offline: ya no toca el lote vencido ---
  await p.click('#btn-nueva-venta').catch(() => {})
  await p.evaluate(() => document.getElementById('modal-exito').classList.add('hidden'))
  const dialogosAntes = dialogos.length
  await agregarUnidades(p, 1)
  await p.click('#btn-completar-venta')
  await p.waitForFunction(() => !document.getElementById('modal-exito').classList.contains('hidden'), null, { timeout: 5000 })
  cola = await p.evaluate(() => window.CampoAltoDB.sync_queue.orderBy('id').toArray())
  assert(cola.length === 2 && cola[1].payload.items[0].lotes[0].lote_id === LOTE_VIGENTE && cola[0].local_id !== cola[1].local_id,
    'La siguiente venta usa el lote vigente y tiene su propio local_id')
  assert(!dialogos.slice(dialogosAntes).some((m) => /VENCIDO/.test(m)), 'Sin lote vencido no hay advertencia')

  // --- Vuelve la red: la cola sincroniza con los datos originales ---
  await p.evaluate((u) => {
    window.__sesion = u
    window.__online = true
    window.dispatchEvent(new Event('online'))
  }, usuario)
  await esperarQue(p, () => window.CampoAltoDB.sync_queue.where('estado').equals('sincronizado').count().then((n) => n === 2))
  const llamadas = await p.evaluate(() => window.__llamadas.filter((l) => l.nombre === 'registrar_venta_pos'))
  const primera = llamadas.find((l) => l.params.p_local_id === item.local_id)
  assert(llamadas.length === 2 && !!primera, '9. Cada venta se envía una vez, con su local_id como p_local_id')
  assert(primera.params.p_origen === 'offline' && primera.params.p_usuario_origen_id === usuario
    && primera.params.p_device_id === deviceId && primera.params.p_fecha_operacion === item.fecha_operacion,
  'La RPC recibe origen offline, autor, dispositivo y fecha original')
  assert(primera.params.p_items[0].precio_venta === 10 && primera.params.p_items[0].lotes.length === 2,
    '8. La RPC recibe el precio cobrado y los lotes elegidos (no vuelve a consultar el catálogo)')
  assert(!/costo/i.test(JSON.stringify(primera.params)), '18. Nada de costos viaja desde el POS')
  const sincronizada = await p.evaluate((id) => window.CampoAltoDB.sync_queue.where('local_id').equals(id).first(), item.local_id)
  assert(sincronizada.usuario_id === usuario && sincronizada.sincronizado_por === usuario
    && Date.parse(sincronizada.sincronizado_en) >= Date.parse(sincronizada.fecha_operacion),
  '6. Tras sincronizar: autor intacto y fecha de sincronización independiente')
  assert(errores.length === 0, `Sin errores de JavaScript en la página${errores.length ? ': ' + errores.join(' | ') : ''}`)

  await ctx.close()
}

// Venta online: misma construcción, directo a la RPC con modo 'online'.
async function probarVentaOnline(navegador, base) {
  console.log('\n==> cajero-pos.html (con red)')
  const { ctx, p } = await prepararDispositivo(navegador, base, { usuario: CAJERO, rol: 'vendedor' })
  p.on('dialog', (d) => d.accept())
  await p.addInitScript(() => { window.__online = true })
  await p.goto(`${base}/src/cajero-pos.html`)
  await p.evaluate((u) => { window.__sesion = u }, CAJERO)
  // Con red el POS sincroniza el catálogo al cargar; el Supabase falso lo
  // devuelve vacío, así que se vuelve a sembrar en memoria para cobrar.
  await p.waitForFunction(() => window.CampoAltoDB && window.VentaOffline)
  const r = await p.evaluate(async ({ PROD, PRES }) => {
    const venta = await window.VentaOffline.construirVenta({
      carrito: [{ presentacionId: PRES, productoId: PROD, nombreProducto: 'X', nombrePresentacion: 'Y', factorConversion: 1, unidadBase: 'unidad', precioVenta: 10, cantidad: 1, descuentoPorcentaje: 0 }],
      clienteId: null, fincaId: null, tipoPago: 'EFECTIVO',
    })
    const res = await window.VentaOffline.registrarVentaEnLinea(venta, 'sesion')
    return { venta, res, llamadas: window.__llamadas, cola: await window.CampoAltoDB.sync_queue.count() }
  }, { PROD, PRES })
  const llamada = r.llamadas.find((l) => l.nombre === 'registrar_venta_pos')
  assert(!r.res.error && !!llamada && llamada.params.p_origen === 'online' && llamada.params.p_local_id === r.venta.local_id,
    '16. La venta en línea usa la misma construcción y va directo a la RPC (modo online, con su local_id)')
  assert(r.cola === 0, 'La venta en línea no pasa por la cola')
  await ctx.close()
}

// Cola antigua: un ítem con el formato previo a la Fase 1 sigue sincronizando.
async function probarColaAntigua(navegador, base) {
  console.log('\n==> Ítem de cola con formato anterior a la Fase 1')
  const { ctx, p } = await prepararDispositivo(navegador, base, { usuario: ADMIN, rol: 'admin' })
  await p.goto(`${base}/src/cajero-pos.html`).catch(() => {})
  await p.goto(`${base}/sembrar`)
  await p.waitForFunction(() => window.CampoAltoDB)
  await p.evaluate(async () => {
    await window.CampoAltoDB.sync_queue.add({
      tipo: 'venta', local_id: '11111111-1111-4111-8111-111111111111', device_id: 'dev-viejo', usuario_id: null,
      fecha_operacion: '2026-09-01T10:00:00.000Z', created_at: '2026-09-01T10:00:00.000Z',
      payload: { items: [{ presentacion_id: 'p', producto_id: 'x', cantidad: 1, precio_venta: 5, costo_unitario: 0 }], tipo_pago: 'EFECTIVO', total: 5 },
      dependencias: [], estado: 'pendiente', intentos: 0, errores: [],
    })
  })
  await p.addScriptTag({ url: '/src/auth-guard.js' })
  await p.addScriptTag({ content: SUPABASE_FALSO })
  await p.addScriptTag({ url: '/src/sync-queue.js' })
  await p.evaluate(async (u) => {
    window.__sesion = u
    window.__online = true
    await window.SyncQueue.procesarCola()
  }, ADMIN)
  const r = await p.evaluate(async () => ({
    item: await window.CampoAltoDB.sync_queue.get({ local_id: '11111111-1111-4111-8111-111111111111' }),
    llamada: window.__llamadas[0],
  }))
  assert(r.item.estado === 'sincronizado' && r.llamada.params.p_local_id === '11111111-1111-4111-8111-111111111111',
    '17. Una venta encolada con el formato anterior se sincroniza con su local_id')
  assert(r.llamada.params.p_usuario_origen_id === null && !('p_ubicacion_id' in r.llamada.params),
    'Sin autor ni ubicación guardados: el servidor usa la sesión y el Área de Venta, como antes')
  await ctx.close()
}

// Venta ajena: un cajero distinto no la sincroniza; un admin sí.
async function probarAutorAjeno(navegador, base) {
  console.log('\n==> Venta del cajero A con la sesión del cajero B y luego del admin')
  const { ctx, p } = await prepararDispositivo(navegador, base, { usuario: CAJERO, rol: 'vendedor' })
  await p.goto(`${base}/sembrar`)
  await p.addScriptTag({ url: '/src/auth-guard.js' })
  await p.addScriptTag({ content: SUPABASE_FALSO })
  await p.addScriptTag({ url: '/src/sync-queue.js' })
  const localId = await p.evaluate(() => window.SyncQueue.encolar('venta', { items: [], tipo_pago: 'EFECTIVO', total: 1 }))
  const otro = 'aaaaaaaa-0000-4000-8000-0000000000bb'
  await p.evaluate((u) => {
    localStorage.setItem('campo_alto_session', JSON.stringify({ user_id: u, rol: 'vendedor', expira_en: Date.now() + 3600000 }))
    window.__sesion = u
    window.__online = true
  }, otro)
  await p.evaluate(() => window.SyncQueue.procesarCola())
  let item = await p.evaluate((id) => window.CampoAltoDB.sync_queue.get({ local_id: id }), localId)
  let n = await p.evaluate(() => window.__llamadas.length)
  assert(item.estado === 'pendiente' && item.intentos === 0 && n === 0, '4. Otro cajero no sincroniza (ni se apropia de) la venta ajena: queda pendiente')
  await p.evaluate((u) => {
    localStorage.setItem('campo_alto_session', JSON.stringify({ user_id: u, rol: 'admin', expira_en: Date.now() + 3600000 }))
    window.__sesion = u
  }, ADMIN)
  await p.evaluate(() => window.SyncQueue.procesarCola())
  item = await p.evaluate((id) => window.CampoAltoDB.sync_queue.get({ local_id: id }), localId)
  const llamada = await p.evaluate(() => window.__llamadas[0])
  assert(item.estado === 'sincronizado' && item.usuario_id === CAJERO && item.sincronizado_por === ADMIN
    && llamada.params.p_usuario_origen_id === CAJERO, '4. Un admin la sincroniza conservando al cajero como autor')
  await ctx.close()
}

async function main() {
  console.log('==================================================')
  console.log('🧪 EJECUTANDO TEST: FASE 1 — POS offline de extremo a extremo')
  console.log('==================================================')
  const servidor = await iniciarServidor()
  const base = `http://127.0.0.1:${servidor.address().port}`
  const navegador = await chromium.launch()
  try {
    await probarPOS(navegador, base, 'cajero-pos.html', { usuario: CAJERO, rol: 'vendedor' })
    await probarPOS(navegador, base, 'pos.html', { usuario: ADMIN, rol: 'admin' })
    await probarVentaOnline(navegador, base)
    await probarColaAntigua(navegador, base)
    await probarAutorAjeno(navegador, base)
  } finally {
    await navegador.close()
    servidor.close()
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
