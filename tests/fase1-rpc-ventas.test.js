/**
 * Suite de Pruebas FASE 1 (servidor): registrar_venta_pos offline/online.
 * Ejecución: node tests/fase1-rpc-ventas.test.js
 *
 * Aplica TODAS las migraciones reales de supabase/ (01 → 35) sobre un
 * Postgres en memoria (PGlite) y llama a la RPC como lo haría PostgREST:
 * rol 'authenticated' con auth.uid() = usuario de la sesión.
 */
const { crearBase, consultarComo } = require('./helpers/pg-supabase')

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

const AREA_VENTA = '22222222-2222-2222-2222-222222222222'
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const CAJERO_A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const CAJERO_B = 'aaaaaaaa-0000-4000-8000-00000000000b'
const DEVICE_PC = 'dddddddd-0000-4000-8000-000000000001'
const DEVICE_TEL1 = 'dddddddd-0000-4000-8000-000000000002'
const DEVICE_TEL2 = 'dddddddd-0000-4000-8000-000000000003'
const uuid = () => crypto.randomUUID()

// Firma completa, con parámetros nombrados como los manda PostgREST.
const SQL_VENTA = `SELECT registrar_venta_pos(
  p_items => $1::jsonb, p_cliente_id => $2::uuid, p_finca_id => NULL, p_tipo_pago => $3,
  p_usuario_id => NULL, p_ubicacion_id => '${AREA_VENTA}', p_local_id => $4::uuid,
  p_device_id => $5::uuid, p_usuario_origen_id => $6::uuid, p_fecha_operacion => $7::timestamptz,
  p_origen => $8) AS id`

async function venta(db, sesion, { items, local = uuid(), device = null, autor = null, fecha = null, origen = 'offline', pago = 'EFECTIVO', cliente = null }) {
  const r = await consultarComo(db, sesion, SQL_VENTA,
    [JSON.stringify(items), cliente, pago, local, device, autor, fecha, origen])
  return { id: r.rows[0].id, local }
}

async function intentar(fn) {
  try {
    return { ok: true, valor: await fn() }
  } catch (e) {
    return { ok: false, error: e }
  }
}

const uno = async (db, sql, params = []) => (await db.query(sql, params)).rows[0]
const stock = (db, producto) => uno(db, `SELECT COALESCE(SUM(stock_actual),0)::float AS s FROM v_stock_lotes_ubicacion WHERE producto_id = $1 AND ubicacion_id = '${AREA_VENTA}'`, [producto])

async function sembrar(db) {
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${ADMIN}', 'admin@x'), ('${CAJERO_A}', 'a@x'), ('${CAJERO_B}', 'b@x');
    INSERT INTO perfiles (id, rol, nombre_completo) VALUES
      ('${ADMIN}', 'admin', 'Admin'), ('${CAJERO_A}', 'vendedor', 'Cajero A'), ('${CAJERO_B}', 'vendedor', 'Cajero B')
      ON CONFLICT (id) DO UPDATE SET rol = EXCLUDED.rol;
  `)
}

// Producto con dos lotes en el Área de Venta: L1 (vencido) y L2 (vigente).
async function crearProducto(db, { nombre, precio = 10, l1 = 5, l2 = 10, sinLote = 0 }) {
  const prod = uuid()
  const pres = uuid()
  const caja = uuid()
  const lote1 = uuid()
  const lote2 = uuid()
  await db.exec(`
    INSERT INTO productos (id, nombre, unidad_base, stock_base) VALUES ('${prod}', '${nombre}', 'unidad', ${l1 + l2 + sinLote});
    INSERT INTO presentaciones (id, producto_id, nombre_presentacion, factor_conversion, precio_venta)
      VALUES ('${pres}', '${prod}', 'Unidad', 1, ${precio}), ('${caja}', '${prod}', 'Caja x2', 2, ${precio * 2});
    INSERT INTO productos_costos (producto_id, precio_costo) VALUES ('${prod}', 4);
    INSERT INTO lotes (id, producto_id, numero_lote, fecha_vencimiento, stock_inicial, stock_actual) VALUES
      ('${lote1}', '${prod}', 'L1-VENCIDO', '2026-01-31', ${l1}, ${l1}),
      ('${lote2}', '${prod}', 'L2', '2027-06-30', ${l2}, ${l2});
    INSERT INTO movimientos_inventario (producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad) VALUES
      ('${prod}', '${lote1}', '${AREA_VENTA}', 'ENTRADA_COMPRA', ${l1}),
      ('${prod}', '${lote2}', '${AREA_VENTA}', 'ENTRADA_COMPRA', ${l2});
  `)
  if (sinLote > 0) {
    await db.exec(`INSERT INTO movimientos_inventario (producto_id, lote_id, ubicacion_id, tipo_movimiento, cantidad)
      VALUES ('${prod}', NULL, '${AREA_VENTA}', 'ENTRADA_COMPRA', ${sinLote})`)
  }
  return { prod, pres, caja, lote1, lote2 }
}

function item(p, { cantidad, precio = 10, pres = p.pres, factor = 1, lotes, vencido = false, descuento = 0 }) {
  return {
    detalle_local_id: uuid(), presentacion_id: pres, producto_id: p.prod, cantidad,
    precio_venta: precio, descuento_porcentaje: descuento, factor_conversion: factor,
    lotes, vencido,
  }
}

async function main() {
  console.log('==================================================')
  console.log('🧪 EJECUTANDO TEST: FASE 1 — RPC registrar_venta_pos (Postgres real)')
  console.log('==================================================')

  const db = await crearBase()
  await sembrar(db)

  // --- Firma única y permisos ---
  console.log('\n[0] Migración 35: firma única y permisos')
  {
    const firmas = await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'registrar_venta_pos'`)
    assert(firmas.rows[0].n === 1, 'Existe una sola firma de registrar_venta_pos (sin overloads ambiguos)')
    const anon = await intentar(() => consultarComo(db, null, `SELECT registrar_venta_pos('[]'::jsonb)`))
    assert(!anon.ok && /permission denied/i.test(anon.error.message), 'anon (sin sesión) no puede ejecutar registrar_venta_pos')
    const interna = await intentar(() => consultarComo(db, CAJERO_A,
      `SELECT consumir_stock_venta_offline(gen_random_uuid(), 1, NULL, NULL, NULL, '${AREA_VENTA}', NULL, NULL, NULL)`))
    assert(!interna.ok && /permission denied/i.test(interna.error.message), 'consumir_stock_venta_offline no es invocable directamente')
  }

  // --- 3-7: autor, sincronizador, fechas y dispositivo ---
  console.log('\n[3-7] Autor original, sincronizador, fechas y device_id')
  {
    const p = await crearProducto(db, { nombre: 'Prod Autor' })
    const ayer = '2026-09-28T15:30:00.000Z'
    const v = await venta(db, ADMIN, { items: [item(p, { cantidad: 2 })], device: DEVICE_TEL1, autor: CAJERO_A, fecha: ayer })
    const fila = await uno(db, `SELECT * FROM ventas WHERE id = $1`, [v.id])
    assert(fila.usuario_id === CAJERO_A, '3. El autor de la venta es el cajero original')
    assert(fila.sincronizado_por === ADMIN, '4. El admin que sincroniza queda como sincronizado_por, NO como autor')
    assert(new Date(fila.fecha_venta).toISOString() === ayer, '5. fecha_venta = fecha_operacion original')
    assert(new Date(fila.sincronizado_en) > new Date(fila.fecha_venta), '6. sincronizado_en es distinta y posterior a la operación')
    assert(fila.device_id === DEVICE_TEL1 && fila.origen === 'offline', '7. device_id y origen offline se conservan en la venta')
    assert(fila.local_id === v.local, 'La venta remota guarda el local_id de la operación')
    const movs = await db.query(`SELECT * FROM movimientos_inventario WHERE referencia_id = $1`, [v.id])
    assert(movs.rows.length > 0 && movs.rows.every((m) => m.usuario_id === CAJERO_A && m.device_id === DEVICE_TEL1
      && new Date(m.fecha_operacion).toISOString() === ayer && m.sincronizado_por === ADMIN),
    'Los movimientos de inventario también conservan autor, dispositivo y fecha original')

    const ajena = await intentar(() => venta(db, CAJERO_B, { items: [item(p, { cantidad: 1 })], device: DEVICE_TEL1, autor: CAJERO_A }))
    assert(!ajena.ok && ajena.error.code === '42501', 'Un cajero NO puede registrar una venta a nombre de otro (42501)')
    const propia = await intentar(() => venta(db, CAJERO_A, { items: [item(p, { cantidad: 1 })], device: DEVICE_TEL1, autor: CAJERO_A }))
    assert(propia.ok, 'El propio autor sí puede sincronizar su venta')
  }

  // --- 8: precio offline ---
  console.log('\n[8] Precio cobrado offline vs cambio de precio remoto')
  {
    const p = await crearProducto(db, { nombre: 'Prod Precio', precio: 10 })
    await db.query(`UPDATE presentaciones SET precio_venta = 13 WHERE id = $1`, [p.pres])
    const v = await venta(db, CAJERO_A, { items: [item(p, { cantidad: 3, precio: 10 })], autor: CAJERO_A, device: DEVICE_PC })
    const cab = await uno(db, `SELECT total::float FROM ventas WHERE id = $1`, [v.id])
    const det = await uno(db, `SELECT precio_unitario::float, precio_catalogo::float, subtotal::float FROM detalle_ventas WHERE venta_id = $1`, [v.id])
    assert(cab.total === 30 && det.subtotal === 30, '8. La venta offline conserva el precio cobrado (Q10 x 3 = Q30) aunque el vigente sea Q13')
    assert(det.precio_unitario === 10 && det.precio_catalogo === 13, 'Queda trazado el precio cobrado (10) y el de catálogo al sincronizar (13)')
    const online = await intentar(() => venta(db, CAJERO_A, { items: [item(p, { cantidad: 1, precio: 10 })], origen: 'online' }))
    assert(!online.ok && /cambió/.test(online.error.message), 'En línea se mantiene la validación de precio vigente (migración 33)')
    const desc = await venta(db, CAJERO_A, { items: [item(p, { cantidad: 2, precio: 10, descuento: 10 })], autor: CAJERO_A })
    const detDesc = await uno(db, `SELECT subtotal::float, descuento_porcentaje::float FROM detalle_ventas WHERE venta_id = $1`, [desc.id])
    assert(detDesc.subtotal === 18 && detDesc.descuento_porcentaje === 10, 'El descuento aplicado offline se conserva (2 x Q10 - 10% = Q18)')
  }

  // --- 9-10: idempotencia y varios dispositivos ---
  console.log('\n[9-10] Idempotencia por local_id y ventas de varios dispositivos')
  {
    const p = await crearProducto(db, { nombre: 'Prod Idem' })
    const local = uuid()
    const args = { items: [item(p, { cantidad: 2 })], local, autor: CAJERO_A, device: DEVICE_TEL1 }
    const a = await venta(db, CAJERO_A, args)
    const b = await venta(db, CAJERO_A, args)
    const c = await venta(db, ADMIN, args)
    const n = await uno(db, `SELECT count(*)::int AS n FROM ventas WHERE local_id = $1`, [local])
    const movs = await uno(db, `SELECT COALESCE(SUM(cantidad),0)::float AS s FROM movimientos_inventario WHERE referencia_id = $1`, [a.id])
    assert(a.id === b.id && b.id === c.id && n.n === 1, '9. Reintentar la misma venta (3 veces, 2 sesiones) devuelve la misma y no duplica')
    assert(movs.s === 2 && (await stock(db, p.prod)).s === 13, 'El reintento no vuelve a descontar stock')

    const tel1 = await venta(db, CAJERO_A, { items: [item(p, { cantidad: 1 })], autor: CAJERO_A, device: DEVICE_TEL1 })
    const tel2 = await venta(db, CAJERO_B, { items: [item(p, { cantidad: 1 })], autor: CAJERO_B, device: DEVICE_TEL2 })
    const pc = await venta(db, ADMIN, { items: [item(p, { cantidad: 1 })], autor: ADMIN, device: DEVICE_PC })
    const devs = await db.query(`SELECT device_id FROM ventas WHERE id = ANY($1::uuid[])`, [[tel1.id, tel2.id, pc.id]])
    assert(new Set([tel1.id, tel2.id, pc.id]).size === 3 && new Set(devs.rows.map((r) => r.device_id)).size === 3,
      '10. Computadora y 2 teléfonos sincronizan ventas distintas, cada una con su device_id')
  }

  // --- 11: stock suficiente ---
  console.log('\n[11] Stock suficiente: venta + movimientos correctos')
  {
    const p = await crearProducto(db, { nombre: 'Prod Suficiente', l1: 5, l2: 10 })
    const v = await venta(db, CAJERO_A, { items: [item(p, { cantidad: 7 })], autor: CAJERO_A })
    const movs = await db.query(`SELECT lote_id, cantidad::float FROM movimientos_inventario WHERE referencia_id = $1 AND tipo_movimiento = 'SALIDA_VENTA' ORDER BY cantidad DESC`, [v.id])
    const conf = await uno(db, `SELECT count(*)::int AS n FROM conflictos_inventario WHERE venta_id = $1`, [v.id])
    const cab = await uno(db, `SELECT conflicto_stock FROM ventas WHERE id = $1`, [v.id])
    assert(movs.rows.length === 2 && movs.rows[0].lote_id === p.lote1 && movs.rows[0].cantidad === 5
      && movs.rows[1].lote_id === p.lote2 && movs.rows[1].cantidad === 2, 'FEFO del servidor: 5 del lote que vence antes + 2 del siguiente')
    assert((await stock(db, p.prod)).s === 8 && conf.n === 0 && cab.conflicto_stock === false, '11. Stock queda en 8, sin conflicto')
    const lotes = await db.query(`SELECT id, stock_actual::float FROM lotes WHERE producto_id = $1 ORDER BY numero_lote`, [p.prod])
    const base = await uno(db, `SELECT stock_base::float FROM productos WHERE id = $1`, [p.prod])
    assert(lotes.rows[0].stock_actual === 0 && lotes.rows[1].stock_actual === 8 && base.stock_base === 8,
      'Los campos redundantes (lotes.stock_actual, productos.stock_base) siguen coherentes')
  }

  // --- 12-13: stock insuficiente entre dos dispositivos ---
  console.log('\n[12-13] Stock insuficiente: A vende 10 y B vende 8 offline con stock 15')
  {
    const p = await crearProducto(db, { nombre: 'Prod Escaso', l1: 5, l2: 10 })
    const fechaA = '2026-09-28T10:00:00.000Z'
    const fechaB = '2026-09-28T10:05:00.000Z'
    const itB = item(p, { cantidad: 8, lotes: [{ lote_id: p.lote1, cantidad_base: 5 }, { lote_id: p.lote2, cantidad_base: 3 }] })
    const a = await venta(db, CAJERO_A, { items: [item(p, { cantidad: 10 })], autor: CAJERO_A, device: DEVICE_TEL1, fecha: fechaA })
    const b = await venta(db, ADMIN, { items: [itB], autor: CAJERO_B, device: DEVICE_TEL2, fecha: fechaB })

    const ventas = await db.query(`SELECT id, total::float, conflicto_stock FROM ventas WHERE id = ANY($1::uuid[]) ORDER BY total DESC`, [[a.id, b.id]])
    assert(ventas.rows.length === 2 && ventas.rows[0].total === 100 && ventas.rows[1].total === 80,
      '12. Ambas ventas quedan registradas completas (Q100 y Q80), ninguna se borra ni se rechaza')
    assert(ventas.rows[0].conflicto_stock === false && ventas.rows[1].conflicto_stock === true, 'Solo la venta que no alcanzó queda marcada con conflicto')
    const salidaB = await uno(db, `SELECT COALESCE(SUM(cantidad),0)::float AS s FROM movimientos_inventario WHERE referencia_id = $1`, [b.id])
    assert(salidaB.s === 5, 'De la venta B solo se descuenta lo que realmente existía (5)')
    const st = await stock(db, p.prod)
    const neg = await uno(db, `SELECT count(*)::int AS n FROM v_stock_lotes_ubicacion WHERE producto_id = $1 AND stock_actual < 0`, [p.prod])
    const base = await uno(db, `SELECT stock_base::float FROM productos WHERE id = $1`, [p.prod])
    assert(st.s === 0 && neg.n === 0 && base.stock_base === 0, 'No se crea stock negativo (ni en lotes ni en stock_base)')

    const c = await uno(db, `SELECT * FROM conflictos_inventario WHERE venta_id = $1`, [b.id])
    const det = await uno(db, `SELECT id FROM detalle_ventas WHERE venta_id = $1`, [b.id])
    assert(!!c && Number(c.deficit) === 3 && Number(c.cantidad_solicitada) === 8 && Number(c.cantidad_cubierta) === 5
      && Number(c.cantidad_disponible) === 5, '13. Conflicto: solicitado 8, disponible 5, cubierto 5, déficit 3')
    assert(c.local_id === b.local && c.device_id === DEVICE_TEL2 && c.usuario_origen_id === CAJERO_B && c.sincronizado_por === ADMIN,
      'El conflicto conserva local_id, device_id, autor original y quién sincronizó')
    assert(new Date(c.fecha_operacion).toISOString() === fechaB && new Date(c.sincronizado_en) > new Date(c.fecha_operacion),
      'El conflicto conserva fecha de operación y fecha de sincronización')
    assert(c.producto_id === p.prod && c.presentacion_id === p.pres && c.ubicacion_id === AREA_VENTA && c.detalle_venta_id === det.id,
      'El conflicto referencia producto, presentación, ubicación y la línea de venta')
    assert(c.lote_id === p.lote1 && Array.isArray(c.lotes_sugeridos) && c.estado === 'pendiente' && c.unidad_base === 'unidad',
      'Registra el lote que el POS eligió y no se pudo cubrir, en estado pendiente')
    assert(c.resuelto_por === null && c.fecha_resolucion === null && /faltante 3/.test(c.detalle),
      'No se inventa ninguna resolución; el detalle técnico describe el faltante')
  }

  // --- 14-15: vencido y FEFO local ---
  console.log('\n[14-15] Producto vencido y lote elegido por FEFO local')
  {
    const p = await crearProducto(db, { nombre: 'Prod FEFO', l1: 5, l2: 10 })
    const v = await venta(db, CAJERO_A, {
      items: [item(p, { cantidad: 2, lotes: [{ lote_id: p.lote1, numero_lote: 'L1-VENCIDO', fecha_vencimiento: '2026-01-31', cantidad_base: 2, vencido: true }], vencido: true })],
      autor: CAJERO_A,
    })
    const det = await uno(db, `SELECT advertencia_vencimiento, lotes_sugeridos FROM detalle_ventas WHERE venta_id = $1`, [v.id])
    const mov = await uno(db, `SELECT lote_id, cantidad::float FROM movimientos_inventario WHERE referencia_id = $1`, [v.id])
    assert(det.advertencia_vencimiento === true && mov.lote_id === p.lote1, '14. Venta de lote vencido permitida y queda registrada la advertencia')

    const v2 = await venta(db, CAJERO_A, {
      items: [item(p, { cantidad: 4, lotes: [{ lote_id: p.lote2, cantidad_base: 4 }] })],
      autor: CAJERO_A,
    })
    const movs2 = await db.query(`SELECT lote_id, cantidad::float FROM movimientos_inventario WHERE referencia_id = $1`, [v2.id])
    assert(movs2.rows.length === 1 && movs2.rows[0].lote_id === p.lote2 && movs2.rows[0].cantidad === 4,
      '15. El servidor respeta el lote que el POS asignó por FEFO local')
    const caja = await venta(db, CAJERO_A, { items: [item(p, { cantidad: 2, pres: p.caja, precio: 20, factor: 2 })], autor: CAJERO_A })
    const movCaja = await uno(db, `SELECT SUM(cantidad)::float AS s FROM movimientos_inventario WHERE referencia_id = $1`, [caja.id])
    assert(movCaja.s === 4, 'La conversión de presentación se respeta (2 cajas x 2 = 4 unidades base)')
  }

  // --- 16: venta online sigue igual ---
  console.log('\n[16] Venta online (firma anterior de 5 parámetros)')
  {
    const p = await crearProducto(db, { nombre: 'Prod Online', l1: 1, l2: 2 })
    const r = await consultarComo(db, CAJERO_A,
      `SELECT registrar_venta_pos($1::jsonb, NULL, NULL, 'EFECTIVO', NULL) AS id`,
      [JSON.stringify([{ presentacion_id: p.pres, producto_id: p.prod, cantidad: 2, precio_venta: 10 }])])
    const fila = await uno(db, `SELECT usuario_id, origen, sincronizado_en, conflicto_stock FROM ventas WHERE id = $1`, [r.rows[0].id])
    assert(fila.usuario_id === CAJERO_A && fila.origen === 'online' && fila.sincronizado_en === null,
      '16. La llamada online existente funciona: autor = sesión, origen online, sin fecha de sincronización')
    const antes = await uno(db, `SELECT count(*)::int AS n FROM ventas`)
    const sinStock = await intentar(() => consultarComo(db, CAJERO_A,
      `SELECT registrar_venta_pos($1::jsonb, NULL, NULL, 'EFECTIVO', NULL)`,
      [JSON.stringify([{ presentacion_id: p.pres, producto_id: p.prod, cantidad: 5, precio_venta: 10 }])]))
    const despues = await uno(db, `SELECT count(*)::int AS n FROM ventas`)
    assert(!sinStock.ok && /Stock insuficiente/.test(sinStock.error.message) && antes.n === despues.n,
      'En línea, stock insuficiente sigue rechazando la venta completa (aún no se entregó)')
  }

  // --- 17: operaciones antiguas de la cola ---
  console.log('\n[17] Operación antigua de la cola (sin autor, dispositivo ni fecha)')
  {
    const p = await crearProducto(db, { nombre: 'Prod Legado' })
    const legado = [{ presentacion_id: p.pres, producto_id: p.prod, cantidad: 1, precio_venta: 10,
      descuento_porcentaje: 0, factor_conversion: 1, costo_unitario: 0 }]
    const v = await venta(db, CAJERO_A, { items: legado })
    const fila = await uno(db, `SELECT usuario_id, device_id, origen FROM ventas WHERE id = $1`, [v.id])
    assert(fila.usuario_id === CAJERO_A && fila.device_id === null && fila.origen === 'offline',
      '17. Un ítem encolado antes de la Fase 1 se registra (autor = sesión, como antes)')
    const r7 = await consultarComo(db, CAJERO_A,
      `SELECT registrar_venta_pos(p_items => $1::jsonb, p_tipo_pago => 'EFECTIVO', p_local_id => $2::uuid) AS id`,
      [JSON.stringify(legado), uuid()])
    assert(!!r7.rows[0].id, 'La firma de la migración 28/33 (con p_local_id, sin parámetros nuevos) sigue funcionando')
  }

  // --- 18: el cajero no recibe costos ni conflictos ---
  console.log('\n[18] Datos sensibles fuera del alcance del cajero')
  {
    const conf = await consultarComo(db, CAJERO_A, `SELECT count(*)::int AS n FROM conflictos_inventario`)
    const confAdmin = await consultarComo(db, ADMIN, `SELECT count(*)::int AS n FROM conflictos_inventario`)
    assert(conf.rows[0].n === 0 && confAdmin.rows[0].n > 0, '18. El cajero no puede leer conflictos de inventario; el admin sí')
    const costos = await consultarComo(db, CAJERO_A, `SELECT count(*)::int AS n FROM productos_costos`)
    assert(costos.rows[0].n === 0, 'El cajero no puede leer productos_costos (RLS existente)')
    const insert = await intentar(() => consultarComo(db, CAJERO_A,
      `INSERT INTO conflictos_inventario (cantidad_solicitada, deficit) VALUES (1, 1)`))
    assert(!insert.ok, 'El cajero no puede crear conflictos a mano (solo la RPC)')
    const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'conflictos_inventario' AND column_name ILIKE '%costo%'`)
    assert(cols.rows.length === 0, 'La tabla de conflictos no guarda costos')
  }

  // --- Crédito offline: comportamiento documentado ---
  console.log('\n[extra] Crédito offline sigue validando el límite')
  {
    const p = await crearProducto(db, { nombre: 'Prod Credito' })
    const cli = uuid()
    await db.query(`INSERT INTO clientes (id, nombre, limite_credito, saldo_actual) VALUES ($1, 'Cliente', 50, 45)`, [cli])
    const r = await intentar(() => venta(db, CAJERO_A, { items: [item(p, { cantidad: 1 })], autor: CAJERO_A, pago: 'CREDITO', cliente: cli }))
    assert(!r.ok && /Límite de crédito/.test(r.error.message), 'Una venta offline a crédito que excede el límite se rechaza (cae en conciliación)')
  }

  await db.close()
  console.log('--------------------------------------------------')
  console.log(`RESULTADOS FINAL: ${pasados} Pasados, ${fallados} Fallados.`)
  console.log('==================================================')
  if (fallados > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
