// Sincronización del catálogo (presentaciones+productos, stock por
// ubicación y clientes) para lectura offline en el POS — Fase 3.
//
// Por qué reemplazo completo y no delta incremental: las tablas
// `productos`, `presentaciones`, `clientes` y `lotes` en Supabase no
// tienen columna `updated_at` (solo `created_at`, que no cambia en un
// UPDATE), y el stock real por ubicación es una vista calculada sobre el
// kardex, no una columna. Agregar eso requeriría una migración de
// esquema en producción. Como esta laptop sincroniza ~1 vez al día (al
// conectarla en casa) y el catálogo de una agroveterinaria es chico,
// bajar todo cada vez es más simple, se autocorrige solo ante cualquier
// cambio que un delta mal calculado podría pasar por alto, y no requiere
// tocar el esquema de Supabase.
const UBICACION_AREA_VENTA = '22222222-2222-2222-2222-222222222222';

async function sincronizarCatalogo(supabase) {
  if (!navigator.onLine) {
    return { ok: false, motivo: 'offline' };
  }

  try {
    const [presentacionesRes, stockRes, clientesRes] = await Promise.all([
      supabase.from('presentaciones').select(`
        id, producto_id, nombre_presentacion, factor_conversion, precio_venta,
        usable_en_compra, usable_en_venta,
        productos!inner ( id, nombre, codigo_barras, categoria, unidad_base, stock_base, imagen_url )
      `),
      supabase.from('v_stock_productos_ubicacion').select('producto_id, ubicacion_id, stock_disponible'),
      supabase.from('clientes').select('*'),
    ]);

    if (presentacionesRes.error) throw presentacionesRes.error;
    if (stockRes.error) throw stockRes.error;
    if (clientesRes.error) throw clientesRes.error;

    const db = window.CampoAltoDB;
    await db.transaction('rw', db.presentaciones, db.stock_ubicacion, db.clientes, db.meta_sync, async () => {
      await db.presentaciones.clear();
      await db.presentaciones.bulkPut(presentacionesRes.data || []);

      await db.stock_ubicacion.clear();
      await db.stock_ubicacion.bulkPut(stockRes.data || []);

      await db.clientes.clear();
      await db.clientes.bulkPut(clientesRes.data || []);

      await db.meta_sync.put({ clave: 'catalogo', sincronizado_en: new Date().toISOString() });
    });

    return { ok: true };
  } catch (err) {
    console.error('Error sincronizando catálogo:', err);
    return { ok: false, motivo: 'error', error: err };
  }
}

// Reconstruye exactamente la forma que ya esperaba pos.js/cajero-pos.js:
// cada presentación con su producto anidado, `stock_base` sobreescrito
// por el stock disponible en esa ubicación, filtrando lo agotado.
async function obtenerCatalogoLocal(ubicacionId = UBICACION_AREA_VENTA) {
  const db = window.CampoAltoDB;
  const [presentaciones, stockRows] = await Promise.all([
    db.presentaciones.toArray(),
    db.stock_ubicacion.where('ubicacion_id').equals(ubicacionId).toArray(),
  ]);

  const stockMap = {};
  stockRows.forEach((s) => {
    stockMap[s.producto_id] = Number(s.stock_disponible) || 0;
  });

  return presentaciones
    .map((p) => {
      const stockPos = stockMap[p.productos.id] ?? Number(p.productos.stock_base);
      return { ...p, productos: { ...p.productos, stock_base: stockPos } };
    })
    .filter((p) => p.productos && Number(p.productos.stock_base) > 0)
    .sort((a, b) => a.nombre_presentacion.localeCompare(b.nombre_presentacion));
}

// Descuenta stock en la caché local (IndexedDB), usado al completar una
// venta offline, para que el catálogo no vuelva a ofrecer como
// disponible algo ya vendido si la página se recarga antes de que la
// venta se sincronice con Supabase (Fase 4).
async function descontarStockLocal(productoId, cantidadBase, ubicacionId = UBICACION_AREA_VENTA) {
  const db = window.CampoAltoDB;
  await db.transaction('rw', db.stock_ubicacion, async () => {
    const actual = await db.stock_ubicacion.get([productoId, ubicacionId]);
    const stockActual = actual ? Number(actual.stock_disponible) || 0 : 0;
    await db.stock_ubicacion.put({
      producto_id: productoId,
      ubicacion_id: ubicacionId,
      stock_disponible: Math.max(0, stockActual - cantidadBase),
    });
  });
}

async function obtenerClientesLocal() {
  const db = window.CampoAltoDB;
  const clientes = await db.clientes.toArray();
  return clientes.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

async function obtenerUltimaSincronizacion() {
  const db = window.CampoAltoDB;
  const meta = await db.meta_sync.get('catalogo');
  return meta ? meta.sincronizado_en : null;
}

window.SyncCatalogo = {
  UBICACION_AREA_VENTA,
  sincronizarCatalogo,
  obtenerCatalogoLocal,
  descontarStockLocal,
  obtenerClientesLocal,
  obtenerUltimaSincronizacion,
};
