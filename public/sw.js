const CACHE_NAME = 'master-hub-v1';
const CORE_ASSETS = ['/', '/?mode=week', '/manifest.webmanifest', '/icon.svg', '/maskable-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  const isNavigation = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');

  // Only handle GET
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Cache same-origin responses
          try {
            const url = new URL(request.url);
            if (url.origin === self.location.origin) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
          } catch {
            // ignore
          }
          return response;
        })
        .catch(async () => {
          if (isNavigation) {
            const week = await caches.match('/?mode=week');
            if (week) return week;
            const fallback = await caches.match('/');
            if (fallback) return fallback;
          }
          if (cached) return cached;
          return new Response('', { status: 504, statusText: 'offline' });
        });
    })
  );
});
