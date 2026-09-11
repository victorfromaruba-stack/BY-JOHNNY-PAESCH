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
import * as dealsView from './views/deals.js';
import * as crewsView from './views/crews.js';
import { icon } from './ui/icons.js';

const ROUTES = [
  { path: '/', view: pub.landing, title: `${VOCAB.clubName} — a private travel circle in Aruba`, chrome: false },
  { path: '/rules', view: pub.rules, title: 'How the Circle works' },
  { path: '/sign-in', view: pub.signIn, title: 'Sign in', chrome: false },
  { path: '/join/:code', view: pub.join, title: 'Your invitation', chrome: false },
  { path: '/set-password', view: pub.setPassword, title: 'Choose a password', chrome: false },
  { path: '/home', view: member.home, title: 'Home', auth: true },
  { path: '/pay', view: member.pay, title: 'Send a contribution', auth: true },
  { path: '/ledger', view: member.ledger, title: 'Your ledger', auth: true },
  { path: '/ledger/:month', view: member.ledger, title: 'Statement', auth: true },
  { path: '/card', view: member.card, title: 'Your card', auth: true },
  { path: '/profile', view: member.profile, title: 'Your profile', auth: true },
  { path: '/stays', view: catalog.stays, title: 'Stays', auth: true },
  { path: '/stays/:id', view: catalog.stayDetail, title: 'Stay', auth: true },
  { path: '/cruises', view: catalog.cruises, title: 'Cruises', auth: true },
  { path: '/cruises/:id', view: catalog.stayDetail, title: 'Cruise', auth: true },
  // Trips are on the Cruises tab now; old links and bookmarks still land somewhere.
  { path: '/trips', redirect: '/cruises', title: 'Cruises' },
  { path: '/trips/:id', view: catalog.stayDetail, title: 'Trip', auth: true },
  { path: '/book/:id', view: catalog.book, title: 'Request', auth: true },
  { path: '/requests', view: catalog.requests, title: 'Your requests', auth: true },
  { path: '/requests/:id', view: catalog.requestDetail, title: 'Request', auth: true },
  // Deals ARE the Stays tab now — every live one, cheapest first. Old links still land somewhere.
  { path: '/deals', redirect: '/stays', title: 'Stays' },
  { path: '/live', redirect: '/stays', title: 'Stays' },
  { path: '/watching', view: dealsView.watching, title: 'What you are watching', auth: true },
  { path: '/crews', view: crewsView.crews, title: 'Your crews', auth: true },
  { path: '/crews/:id', view: crewsView.crewDetail, title: 'Crew', auth: true },
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
// The skip link is href="#app", and a hash router reads "#app" as the route "app" — which
// matches nothing and repainted the whole page as "Nothing here", wiping whatever a keyboard
// user had half-filled. The one control that exists to help them was the one that hurt them.
// Move focus and go no further.
document.querySelector('a.skip')?.addEventListener('click', (e) => { e.preventDefault(); app.focus(); });
let store, router, disposer;

// Preview data is for a developer's machine and for anyone who deliberately asks for it.
// On the real address the club is the club: if its server cannot be reached we say so,
// rather than quietly showing invented balances that someone might believe.
const wantsPreview = () => {
  try {
    const q = new URLSearchParams(location.search);
    // ?live forces the real backend from a local checkout, which is the only way to walk
    // the signed-out path a stranger actually meets. ?preview forces the other direction.
    if (q.has('live')) return false;
    if (q.has('preview')) return true;
    return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  } catch { return false; }
};

// Chrome and Edge offer a real one-tap install, but only if the event is caught and kept —
// it fires once, early, and cannot be summoned later. Free, and the nearest thing to a Wallet
// pass without paying Apple $99 a year for a signing certificate.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; });
/** The card screen asks for this. Returns 'accepted', 'dismissed', or null if not offerable. */
window.__huntoInstall = async () => {
  if (!installPrompt) return null;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  if (outcome === 'accepted') installPrompt = null;
  return outcome;
};
window.__huntoCanInstall = () => !!installPrompt;

async function boot() {
  const live = CONFIG.backend === 'supabase' && CONFIG.supabaseUrl && CONFIG.supabaseKey;
  if (live && !wantsPreview()) {
    try {
      const { SupabaseStore, loadSupabaseJs } = await import('./core/supabase-store.js');
      await loadSupabaseJs();
      store = await new SupabaseStore({ url: CONFIG.supabaseUrl, key: CONFIG.supabaseKey }).init();
    } catch (err) {
      console.error(err);
      return offline(err);
    }
  } else {
    store = await localStore();
  }
  window.__hunto = { store };            // test hook: lets the smoke suite switch persona
  document.documentElement.dataset.mode = store.mode;
  store.subscribe((reason) => {
    if (reason === 'partial') {
      // Some tables failed to reload and the last known rows are being shown. Say so, rather
      // than presenting a half-loaded screen as the truth.
      toast(`Some of this could not be refreshed (${(store.partial || []).slice(0, 3).join(', ')}). Showing what was last known.`, { kind: 'bad', timeout: 8000 });
    }
    if (reason !== 'render') render();
  });
  router = new Router({ routes: ROUTES, notFound: NOT_FOUND, onChange: render });
  mountChrome();
  router.start();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // Was there already a worker in charge when this page loaded? If so, the page we are looking
    // at was served from its cache, and a NEW worker taking over means what we are looking at is
    // out of date. Reload once, so a release is one visit away instead of two.
    //
    // Guarded on the existing controller because controllerchange also fires the very first time
    // a worker installs, and reloading a first visit for no reason would be worse than the bug.
    // `reloaded` stops the loop if anything ever makes the new worker hand over twice.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { /* offline extras are optional */ });
  }
}

/** The club's server is unreachable. Say so plainly; never fall back to invented numbers. */
function offline(err) {
  document.documentElement.dataset.mode = 'offline';
  app.innerHTML = `<section class="sec"><div class="wrap" style="max-width:540px;text-align:center">
      <h1 style="margin-top:40px">The Circle is not answering</h1>
      <p class="lede" style="margin-top:14px">Your points, the Reserve and every booking live on the club's own server, and this device cannot reach it right now. Nothing is lost — it is almost always the connection.</p>
      <div class="row" style="justify-content:center;margin-top:24px">
        <button class="btn" id="again">Try again</button>
        <a class="btn ghost" href="?preview=1#/">Look around the preview instead</a>
      </div>
      <p class="small muted" style="margin-top:22px">The preview is invented data in this browser. Nothing in it is real, and nothing you do there touches the Circle.</p>
      <p class="small muted" style="margin-top:10px">${String(err?.message || err || '').slice(0, 140)}</p>
    </div></section>`;
  app.querySelector('#again')?.addEventListener('click', () => location.reload());
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
  // A route that only exists to send people on. `replace` so Back does not bounce off it; one
  // hop, because the destination has no redirect of its own.
  if (route.redirect) { router.go(route.redirect, { replace: true }); return; }
  if (route.auth && !store.session) { router.go('/sign-in', { replace: true }); return; }
  // A password somebody else chose is a password somebody else knows. No screen opens until it
  // has been replaced — including by the back button.
  //
  // Being plain about what this is: it is the app refusing to show anything, not the database
  // refusing to answer. Somebody holding a handed-out password and willing to call the API
  // directly is not stopped by it. That is a fair line here — the password is a fresh random
  // one that reaches the person and nobody else, and it is replaced the first time they open
  // the app — but it is a nudge with teeth, not a lock.
  if (store.session && store.me?.mustChangePassword && current.path !== '/set-password') {
    router.go('/set-password', { replace: true }); return;
  }
  if (route.roles && !store.hasRole(...route.roles, 'admin')) {
    app.replaceChildren(pub.denied(ctx(current)));
    return;
  }
  const paint = () => {
    disposer?.(); disposer = null;
    let out;
    try { out = route.view(ctx(current)); }
    catch (err) {
      // A view that throws used to leave the LAST screen up, frozen, with nothing said — and
      // inside a view transition the rejection was swallowed entirely. Say so instead, and keep
      // the way home open. It is this screen that failed, not the member's money.
      console.error(err);
      const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      app.innerHTML = `<section class="sec"><div class="wrap" style="max-width:540px">
        <h1>That screen could not be drawn</h1>
        <p class="lede" style="margin-top:12px">Nothing is lost — your points and bookings are untouched. <a href="#/home">Go to your home screen</a>, or reload.</p>
        <p class="small muted" style="margin-top:14px">${esc(String(err?.message || err).slice(0, 140))}</p>
      </div></section>`;
      document.title = `${route.title} · ${VOCAB.clubName}`;
      updateChrome(current);
      return;
    }
    const node = out instanceof Node ? out : Object.assign(document.createElement('div'), { innerHTML: String(out) });
    if (typeof out?.dispose === 'function') disposer = out.dispose;
    app.replaceChildren(node);
    document.title = `${route.title} · ${VOCAB.clubName}`;
    if (liveRegion) liveRegion.textContent = route.title;
    updateChrome(current);
    // This used to read `if (!location.hash.includes('#/stays/') || true)` — the `|| true` made
    // the test dead code, so it always scrolled anyway. Say what it does.
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  // A cross-fade between screens, where the browser offers one. It is the difference between a
  // page being replaced and a screen changing, and it costs nothing: no library, no animation
  // to maintain, and browsers without it simply swap as before. Never for somebody who asked
  // for less motion. If the view throws, the swap still has to happen — a transition that never
  // resolves would leave the member looking at a frozen snapshot of the screen they just left.
  const smooth = typeof document.startViewTransition === 'function'
    && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!smooth) { paint(); return; }
  try { document.startViewTransition(paint); }
  catch { paint(); }
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

// The five that live in the thumb bar. Everything else is in the top bar.
const NAV = [
  { path: '/home', label: 'Home', icon: 'home' },
  { path: '/stays', label: 'Stays', icon: 'bed', badge: 'deals' },
  { path: '/cruises', label: 'Cruises', icon: 'compass' },
  { path: '/crews', label: 'Crews', icon: 'users', badge: 'crews' },
  { path: '/circle', label: 'Circle', icon: 'globe' },
];

function updateChrome(current) {
  const me = store.me;
  const tabs = document.getElementById('tabs');
  const who = document.getElementById('who');
  const list = document.getElementById('botnav-list');
  const path = current.path;
  // How many deals answer something this member asked for and has not looked at yet.
  const unseen = me ? (() => { try { return store.unseenMatches(me.id).length; } catch { return 0; } })() : 0;
  // One set of tabs, the same for everybody. Victor, Ian and Vishnu hold seats like everyone
  // else and happen to have jobs on top, so their jobs live inside the member's own screens —
  // on Home when something is waiting, and always under their profile — rather than as three
  // extra tabs that only three people can open.
  const main = me ? [{ path: '/home', label: 'Home' }, { path: '/stays', label: 'Stays', badge: unseen }, { path: '/cruises', label: 'Cruises' },
                     { path: '/pay', label: 'Send' },
                     { path: '/circle', label: 'Circle' }, { path: '/crews', label: 'Crews' }, { path: '/ledger', label: 'Ledger' }, { path: '/pool', label: 'Pool' }]
                  : [{ path: '/rules', label: 'How it works' }];
  tabs.innerHTML = main.map(n => `<a href="#${n.path}"${path === n.path ? ' aria-current="page"' : ''}>${escapeHtml(n.label)}${
    n.badge ? `<span class="nav-badge">${n.badge > 9 ? '9+' : n.badge}</span>` : ''}</a>`).join('');
  // A job that needs doing shows on the name in the bar, so an officer sees it from any screen
  // without a tab sitting there all day saying nothing.
  const jobs = me ? (() => { try { return store.officerWork(); } catch { return []; } })() : [];
  const urgent = jobs.filter(j => j.urgent).length;
  who.innerHTML = me
    ? `<a class="btn ghost sm" href="#/profile">${escapeHtml(me.name.split(' ')[0])}${
        urgent ? `<span class="nav-badge">${urgent > 9 ? '9+' : urgent}</span><span class="sr-only">, ${urgent} thing${urgent === 1 ? '' : 's'} waiting for you</span>` : ''}</a>`
    : `<a class="btn sm" href="#/sign-in">Sign in</a>`;
  document.getElementById('botnav').hidden = !me;
  list.innerHTML = me ? NAV.map(n => {
    const count = n.badge === 'deals' ? unseen
      : n.badge === 'crews' ? (() => { try { return store.unreadCrews().length; } catch { return 0; } })() : 0;
    return `<li><a href="#${n.path}"${path === n.path ? ' aria-current="page"' : ''}>
      <span class="botnav-ico">${icon(n.icon, { size: 22, stroke: 1.6 })}${count ? `<span class="nav-dot" aria-hidden="true"></span>` : ''}</span>
      ${escapeHtml(n.label)}${count ? `<span class="sr-only">, ${count} new</span>` : ''}</a></li>`;
  }).join('') : '';
}

boot().catch((err) => {
  console.error(err);
  app.innerHTML = `<div class="wrap sec"><h1>Something went wrong starting the app</h1>
    <p class="lede">${escapeHtml(err.message)}</p>
    <p class="small muted">Reload the page. If it keeps happening, tell Ian and he will pass it on.</p></div>`;
});
