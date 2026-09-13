// Registra el Service Worker del shell de la app en todas las páginas.
// updateViaCache: 'none' evita que el navegador sirva una copia vieja de
// sw.js desde su propio cache HTTP, ya que este proyecto no usa un build
// con hashes de versión en el nombre de archivo.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js', { updateViaCache: 'none' })
      .catch((err) => console.error('No se pudo registrar el Service Worker:', err))
  })
}
