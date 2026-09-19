// Service worker: makes the app installable and quick on repeat visits.
//
// VERSION is stamped with the commit SHA at deploy time by .github/workflows/pages.yml. Do not
// rely on remembering to bump it by hand — that is exactly what went wrong: it sat at
// 'hunto-v10' through a whole run of changes, so every browser that had ever opened the site
// kept serving its cached hero, CSS and JS and none of the work was visible. The cache name is
// the only thing that evicts the old copies, so it has to change on every deploy, automatically.
const VERSION = 'hunto-dev';
// Every module the app can reach, so a phone that opens a route it has never visited — on the
// bus, in a lobby, with no signal — still finds the file it dynamically imports. Generated from
// `find circle/js -name '*.js'`; add a new module here when you add one.
const APP_SHELL = [
  './', './index.html', './css/app.css', './css/tokens.css', './config.js', './manifest.webmanifest',
  './js/app.js', './js/core/image.js', './js/core/money.js', './js/core/names.js', './js/core/passwords.js',
  './js/core/router.js', './js/core/share.js', './js/core/standing.js', './js/core/store.js',
  './js/core/supabase-store.js', './js/core/util.js', './js/core/vocab.js', './js/data/listing-paste.js',
  './js/data/places.js', './js/data/seed.js', './js/data/stays.js', './js/data/vakaymood.js',
  './js/ui/art.js', './js/ui/charts.js', './js/ui/components.js', './js/ui/icons.js', './js/ui/install.js',
  './js/ui/pieces.js', './js/ui/qr.js', './js/ui/qrcode.js', './js/ui/theme.js', './js/ui/wallet.js',
  './js/views/catalog.js', './js/views/crews.js', './js/views/deals.js', './js/views/live.js',
  './js/views/member.js', './js/views/officer.js', './js/views/postcards.js', './js/views/public.js',
  './js/views/rooms.js', './assets/hero-tall.jpg'
];

self.addEventListener('install', (e) => {
  // One file at a time, and one miss does not void the rest. `addAll` is a single transaction:
  // a renamed asset or a 404 threw the whole list away and precached nothing at all.
  e.waitUntil(caches.open(VERSION)
    .then((c) => Promise.allSettled(APP_SHELL.map((u) => c.add(u))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

/** Fresh if the network answers, cached if it does not. */
async function networkFirst(req) {
  const c = await caches.open(VERSION);
  try {
    const r = await fetch(req);
    if (r.ok) c.put(req, r.clone());
    return r;
  } catch {
    const cached = await c.match(req);
    if (cached) return cached;
    // A navigation with nothing cached for that exact URL still has the shell.
    if (req.mode === 'navigate') {
      const shell = await c.match('./index.html');
      if (shell) return shell;
    }
    throw new Error('offline');
  }
}

/** Cached if we have it, and refreshed in the background for next time. */
async function cacheFirst(req) {
  const c = await caches.open(VERSION);
  const cached = await c.match(req);
  const network = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return; // live data only
  if (/cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    e.respondWith(cacheFirst(e.request));
    return;
  }
  if (url.origin !== location.origin) return;
  // The code and the markup go network-first, so a deploy is visible on the next load rather
  // than the one after it. This used to be `cached || network` for everything, which meant the
  // browser painted the old app and only then fetched the new one into the cache — a change
  // shipped today first appeared on a member's second visit, if they made one.
  const shellLike = e.request.mode === 'navigate'
    || /\.(html|css|js|json|webmanifest)$/i.test(url.pathname);
  e.respondWith(shellLike ? networkFirst(e.request) : cacheFirst(e.request));
});
