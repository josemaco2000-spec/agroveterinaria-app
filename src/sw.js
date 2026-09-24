// Service Worker del app shell de Agrovet Campo Alto.
// CACHE_VERSION se genera automáticamente con `npm run build` (ver
// scripts/build-sw.js) a partir de un hash del contenido real de
// SHELL_ASSETS. No lo edites a mano: se sobreescribe en cada build.
const CACHE_VERSION = '45f076d1cb';
const SHELL_CACHE = `campo-alto-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `campo-alto-runtime-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  './index.html',
  './app.js',
  './admin.html',
  './admin.js',
  './pos.html',
  './pos.js',
  './inventario.html',
  './inventario.js',
  './kardex.html',
  './kardex.js',
  './compras.html',
  './compras.js',
  './clientes.html',
  './clientes.js',
  './cierre.html',
  './cierre.js',
  './facturacion.html',
  './facturacion.js',
  './empleados.html',
  './empleados.js',
  './cajero-home.html',
  './cajero-home.js',
  './cajero-pos.html',
  './cajero-pos.js',
  './cajero-clientes.html',
  './cajero-clientes.js',
  './cajero-cierre.html',
  './cajero-cierre.js',
  './pwa-register.js',
  './vendor/supabase.js',
  './vendor/dexie.js',
  './db.js',
  './auth-local.js',
  './auth-guard.js',
  './sync-queue.js',
  './sync-catalogo.js',
  './assets/logo-campo-alto.png',
  './styles/tailwind.css',
  './manifest.json',
  './assets/icons/favicon.ico',
  './assets/icons/favicon-16.png',
  './assets/icons/favicon-32.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-192-maskable.png',
  './assets/icons/icon-512-maskable.png',
  './assets/icons/apple-touch-icon.png',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== SHELL_CACHE && name !== RUNTIME_CACHE)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Nunca interceptar llamadas a Supabase (u otro origen que no sean las
  // fuentes de Google): deben ir directo a la red, o fallar tal cual si no
  // hay conexión — de eso se encarga la cola de sincronización de la app,
  // no el Service Worker.
  if (url.origin !== self.location.origin && !FONT_HOSTS.includes(url.hostname)) {
    return;
  }

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          if (request.mode === 'navigate') return caches.match('./index.html');
        });
    })
  );
});
