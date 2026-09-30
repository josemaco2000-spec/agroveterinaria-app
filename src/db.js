// Base de datos local (IndexedDB vía Dexie) para el modo offline.
const db = new Dexie('campo_alto_local');

db.version(1).stores({
  // user_id = id de auth.users en Supabase. email indexado para poder
  // buscar por correo en el formulario de login offline.
  usuarios_cache: 'user_id, email',
});

// Fase 3: catálogo (productos/presentaciones ya vienen anidados tal como
// los devuelve la consulta actual de pos.js), stock por ubicación, y
// clientes -- para que el POS pueda leer sin red. La cola de
// sincronización de ventas/kardex (escritura offline) se agrega en la
// Fase 4.
db.version(2).stores({
  usuarios_cache: 'user_id, email',
  presentaciones: 'id, producto_id, nombre_presentacion',
  stock_ubicacion: '[producto_id+ubicacion_id], producto_id, ubicacion_id',
  clientes: 'id, nombre, nit',
  meta_sync: 'clave',
});

// Fase 4: cola de escrituras hechas offline (ventas y ajustes de
// inventario) pendientes de sincronizar con Supabase. Reemplaza el
// arreglo plano `adnova_pending_sales` en localStorage.
db.version(3).stores({
  usuarios_cache: 'user_id, email',
  presentaciones: 'id, producto_id, nombre_presentacion',
  stock_ubicacion: '[producto_id+ubicacion_id], producto_id, ubicacion_id',
  clientes: 'id, nombre, nit',
  meta_sync: 'clave',
  sync_queue: '++id, tipo, estado, created_at',
});

// Identidad persistente del dispositivo (computadora / teléfonos). Se
// genera una sola vez por navegador+perfil y vive en meta_sync, junto a la
// cola: si alguien borra los datos del sitio se pierden ambos a la vez, y
// el dispositivo vuelve a nacer con otro id (lo ya sincronizado conserva
// el id viejo en el servidor). Todas las pestañas del mismo navegador son
// el MISMO dispositivo y comparten este id.
const CLAVE_DEVICE_ID = 'device_id';

async function leerOCrearDeviceId(tablaMeta) {
  const existente = await tablaMeta.get(CLAVE_DEVICE_ID);
  if (existente?.valor) return existente.valor;
  const nuevo = crypto.randomUUID();
  await tablaMeta.put({ clave: CLAVE_DEVICE_ID, valor: nuevo, creado_en: new Date().toISOString() });
  return nuevo;
}

// Fase 0 (offline multi-dispositivo): cada operación encolada lleva su
// identidad completa desde que se crea -- local_id (único), device_id,
// usuario original, fecha de operación, dependencias, intentos/errores y
// un lease para que dos pestañas del mismo dispositivo no la procesen a la
// vez (ver sync-queue.js). Los ítems ya sincronizados se conservan con
// estado 'sincronizado' (antes se borraban) para poder resolver
// dependencias y auditar localmente.
db.version(4).stores({
  usuarios_cache: 'user_id, email',
  presentaciones: 'id, producto_id, nombre_presentacion',
  stock_ubicacion: '[producto_id+ubicacion_id], producto_id, ubicacion_id',
  clientes: 'id, nombre, nit',
  meta_sync: 'clave',
  sync_queue: '++id, &local_id, tipo, estado, created_at, device_id',
}).upgrade(async (tx) => {
  // Ítems encolados con la versión anterior: se crearon en ESTE
  // dispositivo, pero no guardaron quién los hizo -- usuario_id queda en
  // null (desconocido) en vez de inventarlo.
  const deviceId = await leerOCrearDeviceId(tx.table('meta_sync'));
  await tx.table('sync_queue').toCollection().modify((item) => {
    if (!item.local_id) item.local_id = crypto.randomUUID();
    if (item.device_id === undefined) item.device_id = deviceId;
    if (item.usuario_id === undefined) item.usuario_id = null;
    if (item.fecha_operacion === undefined) item.fecha_operacion = item.created_at || new Date().toISOString();
    if (!Array.isArray(item.dependencias)) item.dependencias = [];
    if (!Array.isArray(item.errores)) item.errores = [];
    if (item.ultimo_error === undefined) item.ultimo_error = null;
    if (item.conflicto === undefined) item.conflicto = null;
    if (item.sincronizado_en === undefined) item.sincronizado_en = null;
    if (item.sincronizado_por === undefined) item.sincronizado_por = null;
    if (item.remote_id === undefined) item.remote_id = null;
    if (item.lease_owner === undefined) item.lease_owner = null;
    if (item.lease_hasta === undefined) item.lease_hasta = null;
  });
});

// Promesa memorizada: todas las llamadas de esta pestaña reciben el mismo
// id. La transacción rw serializa contra otras pestañas que arranquen al
// mismo tiempo, así que nunca nacen dos ids distintos en un dispositivo.
let deviceIdPromesa = null;

function obtenerDeviceId() {
  if (!deviceIdPromesa) {
    deviceIdPromesa = db.transaction('rw', db.meta_sync, () => leerOCrearDeviceId(db.meta_sync))
      .catch((err) => {
        deviceIdPromesa = null;
        throw err;
      });
  }
  return deviceIdPromesa;
}

window.CampoAltoDB = db;
window.CampoAltoDevice = { obtenerDeviceId };
