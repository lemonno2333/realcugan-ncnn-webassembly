// Service worker for the Real-CUGAN static web app.
//
// Strategy:
// - Navigations: network-first, falling back to the cached shell offline.
// - Same-origin versioned assets (?v=...): cache-first — the query string
//   changes on every deploy, so cached entries are effectively immutable.
//   This covers the JS/CSS bundles, the multi-MB .wasm backends, and models.
// - Everything else (cross-origin fonts, unversioned requests): network,
//   handled by the regular HTTP cache.
//
// The cache name derives from the ?v= the page registered us with
// (navigator.serviceWorker.register('sw.js?v=APP_VERSION')), so every deploy
// automatically gets a fresh cache and activate() prunes the old one — no
// manual bump to forget.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_NAME = 'realcugan-' + VERSION;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.add('./'))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') {
        return;
    }
    const url = new URL(request.url);

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put('./', copy));
                    return response;
                })
                .catch(() => caches.match('./'))
        );
        return;
    }

    if (url.origin === self.location.origin && url.searchParams.has('v')) {
        event.respondWith(
            caches.match(request).then((cached) => {
                if (cached) {
                    return cached;
                }
                return fetch(request).then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return response;
                });
            })
        );
    }
});
