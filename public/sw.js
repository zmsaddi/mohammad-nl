// Minimal, safe service worker. The app is online-only, so this deliberately
// does NOT cache HTML or /api responses (no staleness risk). It only caches
// Next.js immutable hashed static assets (/_next/static/*), which are safe to
// serve cache-first because each build emits new filenames. Everything else
// goes straight to the network.
const STATIC_CACHE = 'vitesse-static-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      })
    );
  }
  // All other requests (HTML navigations, /api, etc.) → default network handling.
});
