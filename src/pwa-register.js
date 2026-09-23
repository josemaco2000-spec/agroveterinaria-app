if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('No se pudo registrar el Service Worker:', err);
    });
  });
}

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist();
}
