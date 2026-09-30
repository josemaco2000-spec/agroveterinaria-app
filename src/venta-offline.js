// Construcción y registro de una venta del POS, con o sin red — Fase 1.
//
// Compartido por pos.js (admin) y cajero-pos.js: los dos POS siguen
// separados (UI, catálogo, clientes, permisos); aquí solo vive lo que
// define QUÉ es una venta, para que ambos generen exactamente la misma
// operación:
//   - UN solo local_id desde el momento de cobrar: es el id del ticket,
//     de la operación en la cola, el p_local_id de la RPC y ventas.local_id.
//   - el precio que se mostró y cobró (no se vuelve a consultar al
//     sincronizar), descuento, subtotal y total.
//   - lotes por FEFO con los datos locales (stock_lotes) y advertencia si
//     alguno está vencido (se permite vender, pero con confirmación).
// No lee ni envía costos: el costo lo pone el servidor.
const UBICACION_AREA_VENTA_POS = '22222222-2222-2222-2222-222222222222'
const MONEDA = 'GTQ'
const EPSILON = 0.0005

function redondear3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000
}

// Fecha de hoy (YYYY-MM-DD) en la zona horaria del dispositivo: un lote
// vence al terminar su día, igual que se lee en la etiqueta.
function fechaLocalISO(fecha = new Date()) {
  const y = fecha.getFullYear()
  const m = String(fecha.getMonth() + 1).padStart(2, '0')
  const d = String(fecha.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function estaVencido(fechaVencimiento, hoy = fechaLocalISO()) {
  return !!fechaVencimiento && String(fechaVencimiento).slice(0, 10) < hoy
}

// Mismo orden que el servidor: lotes reales por vencimiento más próximo
// y, al final, el stock sin lote.
function compararFEFO(a, b) {
  if (!a.lote_id !== !b.lote_id) return a.lote_id ? -1 : 1
  const fa = String(a.fecha_vencimiento || '9999-12-31')
  const fb = String(b.fecha_vencimiento || '9999-12-31')
  if (fa !== fb) return fa < fb ? -1 : 1
  return String(a.numero_lote || '').localeCompare(String(b.numero_lote || ''))
}

// Reparte cada línea entre los lotes locales por FEFO. Las líneas del
// mismo producto (p.ej. unidad + quintal) consumen el mismo saldo en orden.
// Lo que no alcanza a cubrirse con datos locales queda en sin_asignar: el
// servidor lo resuelve al sincronizar (y si tampoco alcanza, crea conflicto).
async function planificarLotes(lineas, ubicacionId) {
  const saldos = new Map()
  const planes = []

  for (const linea of lineas) {
    if (!saldos.has(linea.producto_id)) {
      const lotes = await window.SyncCatalogo.obtenerLotesLocal(linea.producto_id, ubicacionId)
      saldos.set(linea.producto_id, lotes
        .map((l) => ({ ...l, restante: Number(l.stock_actual) || 0 }))
        .sort(compararFEFO))
    }

    let resto = linea.cantidad_base
    const asignados = []
    for (const lote of saldos.get(linea.producto_id)) {
      if (resto <= EPSILON) break
      if (lote.restante <= EPSILON) continue
      const toma = redondear3(Math.min(resto, lote.restante))
      lote.restante = redondear3(lote.restante - toma)
      resto = redondear3(resto - toma)
      asignados.push({
        lote_id: lote.lote_id || null,
        numero_lote: lote.numero_lote || null,
        fecha_vencimiento: lote.fecha_vencimiento || null,
        cantidad_base: toma,
        vencido: estaVencido(lote.fecha_vencimiento),
      })
    }
    planes.push({ lotes: asignados, sin_asignar: Math.max(0, resto) })
  }
  return planes
}

// carrito: los ítems tal como los manejan pos.js/cajero-pos.js
// ({ presentacionId, productoId, nombreProducto, nombrePresentacion,
//    factorConversion, unidadBase, precioVenta, cantidad, descuentoPorcentaje }).
async function construirVenta({ carrito, clienteId, fincaId, tipoPago, ubicacionId = UBICACION_AREA_VENTA_POS }) {
  const localId = crypto.randomUUID()
  const fechaOperacion = new Date().toISOString()
  const deviceId = await window.CampoAltoDevice.obtenerDeviceId()

  const items = carrito.map((item) => {
    const cantidad = Number(item.cantidad) || 0
    const factor = Number(item.factorConversion) || 1
    const precio = Number(item.precioVenta) || 0
    const descuento = Number(item.descuentoPorcentaje) || 0
    const precioEfectivo = precio * (1 - descuento / 100)
    return {
      detalle_local_id: crypto.randomUUID(),
      presentacion_id: item.presentacionId,
      producto_id: item.productoId,
      nombre_producto: item.nombreProducto,
      nombre_presentacion: item.nombrePresentacion,
      unidad_base: item.unidadBase || null,
      cantidad,
      factor_conversion: factor,
      cantidad_base: redondear3(cantidad * factor),
      // precio_venta = precio de lista que vio y cobró el POS (así lo
      // espera registrar_venta_pos); precio_efectivo = con descuento.
      precio_venta: precio,
      descuento_porcentaje: descuento,
      precio_efectivo: precioEfectivo,
      subtotal_bruto: cantidad * precio,
      subtotal: cantidad * precioEfectivo,
    }
  })

  const planes = await planificarLotes(items, ubicacionId)
  items.forEach((linea, i) => {
    linea.lotes = planes[i].lotes
    linea.cantidad_sin_lote_local = planes[i].sin_asignar
    linea.vencido = planes[i].lotes.some((l) => l.vencido)
  })

  const advertencias = items.flatMap((linea) => linea.lotes
    .filter((l) => l.vencido)
    .map((l) => ({
      tipo: 'LOTE_VENCIDO',
      detalle_local_id: linea.detalle_local_id,
      producto_id: linea.producto_id,
      nombre_producto: linea.nombre_producto,
      lote_id: l.lote_id,
      numero_lote: l.numero_lote,
      fecha_vencimiento: l.fecha_vencimiento,
      cantidad_base: l.cantidad_base,
    })))

  const subtotal = items.reduce((s, l) => s + l.subtotal_bruto, 0)
  const total = items.reduce((s, l) => s + l.subtotal, 0)

  return {
    local_id: localId,
    fecha_operacion: fechaOperacion,
    device_id: deviceId,
    payload: {
      version: 2,
      local_id: localId,
      fecha_operacion: fechaOperacion,
      ubicacion_id: ubicacionId,
      cliente_id: clienteId || null,
      finca_id: fincaId || null,
      tipo_pago: tipoPago,
      moneda: MONEDA,
      subtotal,
      descuento_total: subtotal - total,
      total,
      items,
      advertencias,
    },
  }
}

// Advertencia clara antes de completar si algún lote asignado está
// vencido. No bloquea: devuelve lo que decida el usuario.
function confirmarAdvertencias(venta) {
  const vencidos = venta.payload.advertencias.filter((a) => a.tipo === 'LOTE_VENCIDO')
  if (vencidos.length === 0) return true
  const lineas = vencidos.map((a) =>
    `• ${a.nombre_producto} — lote ${a.numero_lote || 's/n'} (venció ${String(a.fecha_vencimiento).slice(0, 10)})`)
  return confirm(`⚠️ PRODUCTO VENCIDO\n\n${lineas.join('\n')}\n\n¿Deseas completar la venta de todos modos?`)
}

// Sin red: la venta queda en la cola con su identidad completa. El mismo
// local_id es el del ticket.
async function encolarVenta(venta) {
  await window.SyncQueue.encolar('venta', venta.payload, {
    localId: venta.local_id,
    fechaOperacion: venta.fecha_operacion,
  })
  const asignaciones = venta.payload.items.flatMap((linea) =>
    linea.lotes.map((l) => ({ producto_id: linea.producto_id, lote_id: l.lote_id, cantidad_base: l.cantidad_base })))
  await window.SyncCatalogo.descontarLotesLocal(asignaciones, venta.payload.ubicacion_id)
  return venta.local_id
}

// Con red: misma operación, directo a la RPC (modo 'online': precio y
// stock se validan en el momento). Manda el local_id para que un
// reintento no duplique la venta. Si el servidor todavía no tiene la
// migración 35 (o 28), cae a la firma anterior.
function registrarVentaEnLinea(venta, usuarioId) {
  const p = venta.payload
  const legado = {
    p_items: p.items,
    p_cliente_id: p.cliente_id,
    p_finca_id: p.finca_id,
    p_tipo_pago: p.tipo_pago,
    p_usuario_id: usuarioId,
  }
  const conLocalId = { ...legado, p_local_id: venta.local_id }
  const completo = {
    ...conLocalId,
    p_ubicacion_id: p.ubicacion_id,
    p_device_id: venta.device_id,
    p_origen: 'online',
  }
  return window.SyncQueue.llamarRpcConVariantes('registrar_venta_pos', [completo, conLocalId, legado])
}

window.VentaOffline = {
  UBICACION_AREA_VENTA: UBICACION_AREA_VENTA_POS,
  fechaLocalISO,
  estaVencido,
  planificarLotes,
  construirVenta,
  confirmarAdvertencias,
  encolarVenta,
  registrarVentaEnLinea,
}
