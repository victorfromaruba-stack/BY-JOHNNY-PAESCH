// Boot: pick the backend, load the data layer, mount the shell, start the router.
import { CONFIG } from '../config.js';
import { Store, LocalAdapter } from './core/store.js';
import { Router } from './core/router.js';
import { seed } from './data/seed.js';
import { VOCAB } from './core/vocab.js';
import { escapeHtml } from './core/util.js';
import { toast } from './ui/components.js';
import { starSvg } from './ui/art.js';
import * as pub from './views/public.js';
import * as member from './views/member.js';
import * as catalog from './views/catalog.js';
import * as officer from './views/officer.js';

const ROUTES = [
  { path: '/', view: pub.landing, title: `${VOCAB.clubName} — a private travel circle in Aruba`, chrome: false },
  { path: '/rules', view: pub.rules, title: 'How the Circle works' },
  { path: '/sign-in', view: pub.signIn, title: 'Sign in', chrome: false },
  { path: '/join/:code', view: pub.join, title: 'Your invitation', chrome: false },
  { path: '/home', view: member.home, title: 'Home', auth: true },
  { path: '/pay', view: member.pay, title: 'Send a contribution', auth: true },
  { path: '/ledger', view: member.ledger, title: 'Your ledger', auth: true },
  { path: '/ledger/:month', view: member.ledger, title: 'Statement', auth: true },
  { path: '/card', view: member.card, title: 'Your card', auth: true },
  { path: '/profile', view: member.profile, title: 'Your profile', auth: true },
  { path: '/stays', view: catalog.stays, title: 'Stays in Aruba', auth: true },
  { path: '/stays/:id', view: catalog.stayDetail, title: 'Stay', auth: true },
  { path: '/trips', view: catalog.trips, title: 'Trips', auth: true },
  { path: '/trips/:id', view: catalog.stayDetail, title: 'Trip', auth: true },
  { path: '/book/:id', view: catalog.book, title: 'Request', auth: true },
  { path: '/requests', view: catalog.requests, title: 'Your requests', auth: true },
  { path: '/requests/:id', view: catalog.requestDetail, title: 'Request', auth: true },
  { path: '/circle', view: officer.circle, title: 'The Circle', auth: true },
  { path: '/pool', view: officer.pool, title: 'The Pool', auth: true },
  { path: '/bank', view: officer.bank, title: 'The Banker’s inbox', auth: true, roles: ['treasurer', 'deputy'] },
  { path: '/bank/close/:month', view: officer.monthClose, title: 'Month close', auth: true, roles: ['treasurer', 'deputy'] },
  { path: '/desk', view: officer.desk, title: 'The Desk', auth: true, roles: ['planner', 'comms', 'admin'] },
  { path: '/settings', view: officer.settings, title: 'Settings', auth: true, roles: ['admin', 'treasurer'] },
];
const NOT_FOUND = { path: '*', view: pub.notFound, title: 'Not found' };

const app = document.getElementById('app');
const liveRegion = document.getElementById('route-live');
let store, router, disposer;

async function boot() {
  if (CONFIG.backend === 'supabase' && CONFIG.supabaseUrl && CONFIG.supabaseKey) {
    try {
      const { SupabaseStore, loadSupabaseJs } = await import('./core/supabase-store.js');
      await loadSupabaseJs();
      store = await new SupabaseStore({ url: CONFIG.supabaseUrl, key: CONFIG.supabaseKey }).init();
    } catch (err) {
      console.error(err);
      toast('Could not reach the club’s server, so this is the local demo.', { kind: 'bad', timeout: 6000 });
      store = await localStore();
    }
  } else {
    store = await localStore();
  }
  window.__hunto = { store };            // demo hook: lets the smoke test switch persona
  document.documentElement.dataset.mode = store.mode;
  store.subscribe((reason) => { if (reason !== 'render') render(); });
  router = new Router({ routes: ROUTES, notFound: NOT_FOUND, onChange: render });
  mountChrome();
  router.start();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { /* offline extras are optional */ });
  }
}

async function localStore() {
  const adapter = new LocalAdapter({ key: 'hunto.v1', seed });
  const s = await new Store(adapter).init();
  adapter.onRemoteChange(() => s.refreshFromAdapter());   // a second tab can be the Banker
  return s;
}

function ctx(current) {
  return {
    store, params: current.params, query: current.query, route: current.route,
    go: (p, o) => router.go(p, o),
    refresh: () => render(),
    toast,
  };
}

function render(current = router?.current) {
  if (!current) return;
  const { route } = current;
  if (route.auth && !store.session) { router.go('/sign-in', { replace: true }); return; }
  if (route.roles && !store.hasRole(...route.roles, 'admin')) {
    app.replaceChildren(pub.denied(ctx(current)));
    return;
  }
  disposer?.(); disposer = null;
  const out = route.view(ctx(current));
  const node = out instanceof Node ? out : Object.assign(document.createElement('div'), { innerHTML: String(out) });
  if (typeof out?.dispose === 'function') disposer = out.dispose;
  app.replaceChildren(node);
  document.title = `${route.title} · ${VOCAB.clubName}`;
  if (liveRegion) liveRegion.textContent = route.title;
  updateChrome(current);
  if (!location.hash.includes('#/stays/') || true) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

// ---------- shell ----------
function mountChrome() {
  const bar = document.getElementById('topbar');
  bar.innerHTML = `
    <div class="wrap">
      <a class="brand" href="#/" aria-label="${escapeHtml(VOCAB.clubName)} home">
        <span class="mark" style="color:var(--good)">${starSvg({ size: 22, fill: 'currentColor' })}</span>
        <span><b>${escapeHtml(VOCAB.wordmark)}</b><br><small>${escapeHtml(VOCAB.subtitle)}</small></span>
      </a>
      <nav class="tabs" id="tabs" aria-label="Sections"></nav>
      <div class="bar-actions">
        <button class="icon-btn" id="theme-toggle" aria-label="Switch between light and dark" title="Light or dark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v2m0 14v2m9-9h-2M5 12H3m14.5-6.5-1.4 1.4M7.9 16.1l-1.4 1.4m0-11.9 1.4 1.4m8.2 8.2 1.4 1.4"/><circle cx="12" cy="12" r="3.6"/></svg>
        </button>
        <span id="who"></span>
      </div>
    </div>`;
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  const saved = localStorage.getItem('hunto.theme');
  if (saved) document.documentElement.dataset.theme = saved;

  document.getElementById('botnav').innerHTML = `<ul id="botnav-list"></ul>`;
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  localStorage.setItem('hunto.theme', root.dataset.theme);
}

const NAV = [
  { path: '/home', label: 'Home', icon: 'M4 11.5 12 4l8 7.5M6 10v9h12v-9' },
  { path: '/stays', label: 'Stays', icon: 'M3 20h18M5 20V9l7-5 7 5v11M10 20v-5h4v5' },
  { path: '/pay', label: 'Send', icon: 'M12 19V5m0 0-6 6m6-6 6 6' },
  { path: '/trips', label: 'Trips', icon: 'M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18' },
  { path: '/circle', label: 'Circle', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0' },
];

function updateChrome(current) {
  const me = store.me;
  const tabs = document.getElementById('tabs');
  const who = document.getElementById('who');
  const list = document.getElementById('botnav-list');
  const path = current.path;
  const roleTabs = [];
  if (store.canConfirmMoney()) roleTabs.push({ path: '/bank', label: 'Bank' });
  if (store.hasRole('planner', 'comms', 'admin')) roleTabs.push({ path: '/desk', label: 'Desk' });
  if (store.hasRole('admin', 'treasurer')) roleTabs.push({ path: '/settings', label: 'Settings' });
  const main = me ? [...NAV.map(n => ({ path: n.path, label: n.label })), { path: '/ledger', label: 'Ledger' }, { path: '/pool', label: 'Pool' }, ...roleTabs]
                  : [{ path: '/rules', label: 'How it works' }];
  tabs.innerHTML = main.map(n => `<a href="#${n.path}"${path === n.path ? ' aria-current="page"' : ''}>${escapeHtml(n.label)}</a>`).join('');
  who.innerHTML = me
    ? `<a class="btn ghost sm" href="#/profile">${escapeHtml(me.name.split(' ')[0])}</a>`
    : `<a class="btn sm" href="#/sign-in">Sign in</a>`;
  document.getElementById('botnav').hidden = !me;
  list.innerHTML = me ? NAV.map(n => `<li><a href="#${n.path}"${path === n.path ? ' aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${n.icon}"/></svg>
      ${escapeHtml(n.label)}</a></li>`).join('') : '';
}

boot().catch((err) => {
  console.error(err);
  app.innerHTML = `<div class="wrap sec"><h1>Something went wrong starting the app</h1>
    <p class="lede">${escapeHtml(err.message)}</p>
    <p class="small muted">Reload the page. If it keeps happening, tell Ian and he will pass it on.</p></div>`;
});
