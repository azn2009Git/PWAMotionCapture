// Security Motion Capture PWA Service Worker
const CACHE_NAME = 'security-cam-pwa-v1.13';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './index.htm',
  './Page2.htm',
  './style.css',
  './app.js',
  './manifest.json',
  './favicon.ico',
  './apple-touch-icon.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

// Install: Cache core application assets immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching offline assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old cache versions and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Stale-while-revalidate / Cache-first with network fallback
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;
  // API responses are live state, not offline application assets.
  if (new URL(event.request.url).pathname.startsWith('/api/')) return;

  // Serve cached app pages immediately so a sleeping laptop or unavailable
  // network never blocks an installed PWA from opening.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cachedPage = await caches.match(event.request)
        || await caches.match('./index.html')
        || await caches.match('./');
      if (cachedPage) return cachedPage;

      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        return new Response(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline setup needed</title><main style="font:16px system-ui;max-width:34rem;margin:15vh auto;padding:1.5rem;color:#f3f4f6;background:#111827"><h1>Offline copy not ready</h1><p>Connect to the PWA once while the laptop server is running so the app can cache its files. Then reopen it from the Home Screen offline.</p></main>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached asset, but update cache in background if online
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {
          // Offline, cachedResponse already returned
        });
        return cachedResponse;
      }

      // Not in cache: fetch from network and cache for offline
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => undefined);
    })
  );
});
