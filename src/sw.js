// Service Worker del shell de la app (cachea páginas/JS/CSS propios para que
// abrir el ícono instalado funcione aunque el wifi tarde en conectar).
//
// A propósito NO cachea nada del backend: cualquier request a Supabase
// (auth, REST, storage, realtime) es de otro origen y se ignora explícitamente
// más abajo, y cualquier request que no sea GET (los INSERT/UPDATE que hacen
// las pantallas de venta) tampoco se toca. La cola de ventas offline sigue
// viviendo exclusivamente en localStorage (adnova_pending_sales), tal como
// ya la maneja pos.js / cajero-pos.js — este Service Worker no la lee ni la
// escribe, solo cachea los archivos estáticos de la interfaz.

const CACHE_NAME = 'campo-alto-shell-v1'
const OFFLINE_FALLBACK_URL = 'index.html'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Solo interceptamos GET del mismo origen (páginas, JS, íconos, manifest).
  // Todo lo demás (Supabase, fuentes de Google, Tailwind CDN, POST/PATCH/DELETE)
  // sigue su camino normal, sin pasar por este cache.
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copia = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copia))
        return response
      })
      .catch(() =>
        caches.match(request).then((cacheada) => {
          if (cacheada) return cacheada
          if (request.mode === 'navigate') return caches.match(OFFLINE_FALLBACK_URL)
          return Response.error()
        })
      )
  )
})
