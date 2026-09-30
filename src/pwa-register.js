if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('No se pudo registrar el Service Worker:', err);
    });
  });
}

// Pide que el navegador no borre IndexedDB (cola de ventas sin
// sincronizar) si le falta espacio. Es solo una solicitud: si la rechaza o
// falla, la app sigue funcionando igual.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
