// RPPC Ops service worker: lets the phone screens open without signal.
const CACHE = 'rppc-ops-v1';
const SHELL = ['/field'];

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Build files never change: serve from cache, fill on first use.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }
  // Field screens: fresh when online, last saved copy when offline.
  if (req.mode === 'navigate' && SHELL.some((p) => url.pathname === p)) {
    e.respondWith(fetch(req).then((r) => { if (r.ok && !r.redirected) caches.open(CACHE).then((c) => c.put(url.pathname, r.clone())); return r; })
      .catch(() => caches.match(url.pathname).then((r) => r || new Response('You are offline. Open this screen once with signal first.', { status: 503 }))));
  }
});
