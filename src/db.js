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

window.CampoAltoDB = db;
