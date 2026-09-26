// Registra el Service Worker del shell de la app en todas las páginas.
// updateViaCache: 'none' evita que el navegador sirva una copia vieja de
// sw.js desde su propio cache HTTP (independiente del CACHE_VERSION con
// hash que ya usa sw.js para invalidar sus caches internos).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { updateViaCache: 'none' })
      .catch((err) => console.error('No se pudo registrar el Service Worker:', err))
  })
}

// Pide almacenamiento persistente para que el navegador no borre IndexedDB
// (catálogo/cola de sincronización offline) bajo presión de espacio en disco.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist()
}
