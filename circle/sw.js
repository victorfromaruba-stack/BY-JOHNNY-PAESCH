// Service worker: makes the app installable and instant on repeat visits.
// Same-origin app files → stale-while-revalidate. CDN scripts/fonts → cache-first.
// Anything to Supabase → network only (never cache money).
const VERSION = 'hunto-v10';
const APP_SHELL = ['./', './index.html', './css/app.css', './css/tokens.css', './js/app.js', './config.js', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP_SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return; // live data only
  const isCdn = /cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.hostname);
  if (isCdn) {
    e.respondWith(caches.open(VERSION).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const cached = await c.match(e.request);
      const network = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => cached);
      return cached || network;
    }));
  }
});
