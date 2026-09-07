// Service worker: makes the app installable and quick on repeat visits.
//
// VERSION is stamped with the commit SHA at deploy time by .github/workflows/pages.yml. Do not
// rely on remembering to bump it by hand — that is exactly what went wrong: it sat at
// 'hunto-v10' through a whole run of changes, so every browser that had ever opened the site
// kept serving its cached hero, CSS and JS and none of the work was visible. The cache name is
// the only thing that evicts the old copies, so it has to change on every deploy, automatically.
const VERSION = 'hunto-dev';
const APP_SHELL = ['./', './index.html', './css/app.css', './css/tokens.css', './js/app.js', './config.js', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP_SHELL).catch(() => {})).then(() => self.skipWaiting()));
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
