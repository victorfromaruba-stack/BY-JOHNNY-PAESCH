// Boot: pick the backend, load the data layer, mount the shell, start the router.
import { CONFIG } from '../config.js';
import { Store, LocalAdapter } from './core/store.js';
import { Router } from './core/router.js';
import { seed } from './data/seed.js';
import { VOCAB } from './core/vocab.js';
import { escapeHtml } from './core/util.js';
import { isCruise } from './core/money.js';
import { toast } from './ui/components.js';
import { starSvg } from './ui/art.js';
import { applyTheme } from './ui/theme.js';
import * as pub from './views/public.js';
import * as member from './views/member.js';
import * as catalog from './views/catalog.js';
import * as officer from './views/officer.js';
import * as dealsView from './views/deals.js';
import * as crewsView from './views/crews.js';
import * as postcards from './views/postcards.js';
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
  // "Ask for these dates" is what the button says, so a link that says ask works too.
  { path: '/ask/:id', redirect: (p) => `/book/${p.id}`, title: 'Request' },
  { path: '/requests', view: catalog.requests, title: 'Your requests', auth: true },
  { path: '/requests/:id', view: catalog.requestDetail, title: 'Request', auth: true },
  // Deals ARE the Stays tab now — every live one, cheapest first. Old links still land somewhere.
  { path: '/deals', redirect: '/stays', title: 'Stays' },
  { path: '/live', redirect: '/stays', title: 'Stays' },
  { path: '/watching', view: dealsView.watching, title: 'What you are watching', auth: true },
  { path: '/postcards', view: postcards.feed, title: 'Postcards', auth: true },
  { path: '/postcards/:id', view: postcards.one, title: 'Postcard', auth: true },
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
// A new release arrived while a sheet was open or a field had the cursor. The reload waits for
// the next route change, when nothing half-typed can be lost.
let pendingReload = false;

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
  // The kept appearance, before anything is drawn, so a member who chose dark never sees a
  // light flash while the data loads.
  applyTheme();
  // Shared to the app from the phone's share sheet (manifest share_target): the listing text
  // arrives as ?text=…&url=… on the start URL. Keep it for the paste sheet, then drop it from the
  // address so a reload does not post it twice, and land on Stays with the sheet asked for.
  try {
    const q = new URLSearchParams(location.search);
    if (q.has('text') || q.has('url') || q.has('title')) {
      const raw = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n').trim();
      if (raw) sessionStorage.setItem('hunto.share', raw);
      history.replaceState(null, '', `${location.pathname}#/stays?paste=1`);
    }
  } catch { /* nothing shared, or no storage */ }
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
  const refetch = () => store?.reload?.().catch?.(() => { /* offline: what is shown stays */ });
  // The installed app has no pull-to-refresh, so the moments a phone comes back are the moments
  // the data is asked for again: the connection returning, a page restored from the back-forward
  // cache, and the app coming to the front.
  window.addEventListener('online', refetch);
  window.addEventListener('pageshow', (e) => { if (e.persisted) refetch(); });
  // iOS lays the keyboard over the page rather than shrinking it. The visual viewport says how
  // much is covered; --kb carries that to the sheet actions and the docked bar so a Save is never
  // under the keys while Victor types.
  const vv = window.visualViewport;
  if (vv) {
    const kb = () => document.documentElement.style.setProperty('--kb',
      `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
    vv.addEventListener('resize', kb); vv.addEventListener('scroll', kb); kb();
  }
  router = new Router({ routes: ROUTES, notFound: NOT_FOUND, onChange: (current) => {
    if (pendingReload) { pendingReload = false; location.reload(); return; }
    render(current);
  } });
  mountChrome();
  router.start();
  // A tab left open does not ask again. The browser only re-checks sw.js on a navigation or
  // roughly once a day, so an app opened yesterday and switched back to this morning is
  // yesterday's app — Victor was reading a board from the night before and taking it for the
  // current one. Coming back to the front asks for a new worker after an hour away (which
  // reloads through the handler below if there is one) and, every time, refetches the data
  // behind the screen.
  let reg = null;
  let away = 0;
  const AWAY_ENOUGH = 60e3;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { away = Date.now(); return; }
    const gone = away ? Date.now() - away : 0;
    away = 0;
    if (gone >= AWAY_ENOUGH) reg?.update().catch(() => { /* offline: the old app is the right thing to keep showing */ });
    refetch();
  });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // Was there already a worker in charge when this page loaded? If so, the page we are looking
    // at was served from its cache, and a NEW worker taking over means what we are looking at is
    // out of date. Reload once, so a release is one visit away instead of two.
    //
    // Guarded on the existing controller because controllerchange also fires the very first time
    // a worker installs, and reloading a first visit for no reason would be worse than the bug.
    // `reloaded` stops the loop if anything ever makes the new worker hand over twice. And never
    // while a sheet is open or a field has the cursor: the reload then waits for the next route.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    const typing = () => !!document.querySelector('dialog[open]')
      || !!document.activeElement?.matches?.('input, textarea, select');
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      if (typing()) { pendingReload = true; return; }
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then((r) => { reg = r; })
      .catch(() => { /* offline extras are optional */ });
  }
}

/** The club's server is unreachable. Say so plainly; never fall back to invented numbers. */
function offline(err) {
  document.documentElement.dataset.mode = 'offline';
  app.innerHTML = `<section class="sec"><div class="wrap stack">
      <h1>The Circle is not answering</h1>
      <p class="lede">Your points, the Reserve and every booking live on the club's own server, and this device cannot reach it right now. Nothing is lost — it is almost always the connection.</p>
      <button class="btn block" id="again">Try again</button>
      <a class="link-rule" href="?preview=1#/">Look around the preview instead</a>
      <p class="small muted">The preview is invented data in this browser. Nothing in it is real, and nothing you do there touches the Circle.</p>
      <p class="small muted">${escapeHtml(String(err?.message || err || '').slice(0, 140))}</p>
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
  const { route, params } = current;
  // A member never sees the brochure or the sign-in form: those two are for a stranger, and
  // Home is where a member's own day starts. `replace`, so Back does not bounce off them.
  if (store.me && (route.path === '/' || route.path === '/sign-in')) { router.go('/home', { replace: true }); return; }
  // A route that only exists to send people on. `replace` so Back does not bounce off it; one
  // hop, because the destination has no redirect of its own. A redirect may be a function of
  // the matched params, so /ask/:id can land on /book/:id with the same id.
  if (route.redirect) {
    const to = typeof route.redirect === 'function' ? route.redirect(params) : route.redirect;
    router.go(to, { replace: true }); return;
  }
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
      app.innerHTML = `<section class="sec"><div class="wrap stack">
        <h1>That screen could not be drawn</h1>
        <p class="lede">Nothing is lost — your points and bookings are untouched.</p>
        <a class="btn block" href="#/home">Go to your home screen</a>
        <button class="link-rule" type="button" id="again">Reload this screen</button>
        <p class="small muted">${escapeHtml(String(err?.message || err).slice(0, 140))}</p>
      </div></section>`;
      app.querySelector('#again')?.addEventListener('click', () => location.reload());
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
      <span id="bar-left"></span>
      <div class="bar-actions"><span id="who"></span></div>
    </div>`;

  const nav = document.getElementById('botnav');
  nav.innerHTML = `<ul id="botnav-list"></ul>`;
  // Tapping the tab you are already on takes you back to the top of it, as a phone's own tab
  // bars do. The list is rewritten on every route; the handler sits on the list itself.
  document.getElementById('botnav-list').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a || a.getAttribute('aria-current') !== 'page') return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}

// The five in the thumb bar. Everything else is reached from Home (Send, Statement, your card,
// the Pool, your requests), from the foot of the board (Cruises, Watching, the rules) and from
// the door list at the top of Profile; the bar's left slot carries the way up on every deeper
// page. While Postcards is switched on it takes the third slot from Cruises — five tabs, not
// six: at 390px six labelled tabs crowd the 44px targets, and a feed two taps deep is a dead
// feed. Cruises keeps its route and a link at the foot of the board. While it is off the bar is
// exactly as it was, so the switch in Settings never claims something a member cannot see.
const NAV_OFF = [
  { path: '/home', label: 'Home', icon: 'home' },
  { path: '/stays', label: 'Stays', icon: 'bed', badge: 'deals' },
  { path: '/cruises', label: 'Cruises', icon: 'compass' },
  { path: '/crews', label: 'Crews', icon: 'users', badge: 'crews' },
  { path: '/circle', label: 'Circle', icon: 'globe' },
];
const NAV_ON = [
  { path: '/home', label: 'Home', icon: 'home' },
  { path: '/stays', label: 'Stays', icon: 'bed', badge: 'deals' },
  { path: '/postcards', label: 'Postcards', icon: 'camera', badge: 'postcards' },
  { path: '/crews', label: 'Crews', icon: 'users', badge: 'crews' },
  { path: '/circle', label: 'Circle', icon: 'globe' },
];
const postcardsOn = () => { try { return !!store?.postcardsOn?.(); } catch { return false; } };
const NAV = () => (postcardsOn() ? NAV_ON : NAV_OFF);
// The tab roots: the wordmark sits in the bar's left slot on these, the way up everywhere else.
const TAB_ROOTS = ['/home', '/stays', '/cruises', '/postcards', '/crews', '/circle'];
// The screens with no tab of their own go up to Home, and the Home tab lights under them: Home
// is where the doors to Send, the statement, the card, the requests and the Pool live.
const HOME_ROOTS = ['/pay', '/ledger', '/card', '/requests', '/watching', '/pool', '/rules', '/profile', '/desk', '/bank', '/settings'];

// A detail route belongs to the tab it was opened from: open a cruise and the bar should still
// say Cruises. Comparing the whole path meant every /stays/:id, /cruises/:id and /trips/:id left
// the bottom bar with nothing marked, which reads as the app losing its place. /trips has no
// index of its own, so it answers to Cruises — and when Cruises has left the bar, both answer
// to Stays, where the link to them now lives. The ask form belongs to Stays; the tab-less
// screens belong to Home.
const navRoot = (path) => {
  const seg = '/' + String(path).split('/')[1];
  const parent = {
    ...Object.fromEntries(HOME_ROOTS.map(p => [p, '/home'])),
    '/book': '/stays',
    ...(postcardsOn() ? { '/trips': '/stays', '/cruises': '/stays' } : { '/trips': '/cruises' }),
  };
  return parent[seg] || seg;
};

// A stay's name as the bar can carry it: the chain and the island dropped, the descriptors
// after a comma or an ampersand dropped, and nothing over twenty characters — the bar is 358px
// wide with a name on the right. When nothing short survives, the link says THE STAY.
const stayShort = (stay) => {
  if (!stay) return null;
  let n = String(stay.short || stay.name || '').trim();
  if (!stay.short) {
    n = n.replace(/^(marriott[’']s|the|hotel)\s+/i, '').replace(/^aruba\s+/i, '');
    n = n.replace(/\s*(,|\s&\s|\sby\s).*$/i, '');
    n = n.replace(/(\s+(resort|spa|casino|hotel|aruba|all inclusive|beach resort|boutique hotel))+$/i, '');
  }
  return n && n.length <= 20 ? n : null;
};

// The way up: a deterministic link to the parent route, never history.back(). Null means the
// wordmark takes the slot.
function wayUp(current, me) {
  if (!me) return null;
  const parts = String(current.path).split('/').filter(Boolean);
  const seg = '/' + (parts[0] || '');
  if (parts.length <= 1) return HOME_ROOTS.includes(seg) ? { label: 'Home', href: '#/home' } : null;
  switch (seg) {
    case '/stays': return { label: 'The board', href: '#/stays' };
    case '/cruises':
    case '/trips': return postcardsOn() ? { label: 'The board', href: '#/stays' } : { label: 'Cruises', href: '#/cruises' };
    case '/book': {
      const stay = store.stay(current.params.id);
      const list = isCruise(stay) ? 'cruises' : stay?.kind === 'trip' ? 'trips' : 'stays';
      return { label: stayShort(stay) || 'The stay', href: stay ? `#/${list}/${encodeURIComponent(stay.id)}` : '#/stays' };
    }
    case '/postcards': return { label: 'Postcards', href: '#/postcards' };
    case '/crews': return { label: 'Crews', href: '#/crews' };
    case '/requests': return { label: 'Your requests', href: '#/requests' };
    case '/ledger': return { label: 'Your ledger', href: '#/ledger' };
    case '/bank': return { label: 'The bank', href: '#/bank' };
    default: return null;
  }
}

function updateChrome(current) {
  const me = store.me;
  const left = document.getElementById('bar-left');
  const who = document.getElementById('who');
  const list = document.getElementById('botnav-list');
  const path = current.path;
  const seg = '/' + String(path).split('/')[1];
  // How many deals answer something this member asked for and has not looked at yet.
  const unseen = me ? (() => { try { return store.unseenMatches(me.id).length; } catch { return 0; } })() : 0;
  const up = wayUp(current, me);
  left.innerHTML = up
    ? `<a class="back" href="${escapeHtml(up.href)}">${icon('chevronRight', { size: 16, stroke: 1.75 })}${escapeHtml(up.label)}</a>`
    : `<a class="brand" href="${me ? '#/home' : '#/'}" aria-label="${escapeHtml(VOCAB.clubName)} home">
        <span class="mark">${starSvg({ size: 22, fill: 'currentColor' })}</span><b>${escapeHtml(VOCAB.wordmark)}</b></a>`;
  // A job that needs doing shows on the name in the bar, so an officer sees it from any screen
  // without a tab sitting there all day saying nothing. Signed out, the right slot offers the
  // door in — except on the three screens that are the door.
  const jobs = me ? (() => { try { return store.officerWork(); } catch { return []; } })() : [];
  const urgent = jobs.filter(j => j.urgent).length;
  who.innerHTML = me
    ? `<a class="btn quiet sm" href="#/profile">${escapeHtml(me.name.split(' ')[0])}${
        urgent ? `<span class="nav-badge">${urgent > 9 ? '9+' : urgent}</span><span class="sr-only">, ${urgent} thing${urgent === 1 ? '' : 's'} waiting for you</span>` : ''}</a>`
    : ['/sign-in', '/join', '/set-password'].includes(seg) ? '' : `<a class="link-rule" href="#/sign-in">Sign in</a>`;
  document.getElementById('botnav').hidden = !me;
  list.innerHTML = me ? NAV().map(n => {
    const count = n.badge === 'deals' ? unseen
      : n.badge === 'crews' ? (() => { try { return store.unreadCrews().length; } catch { return 0; } })()
      : n.badge === 'postcards' ? (() => { try { return store.unseenPostcards().length; } catch { return 0; } })() : 0;
    return `<li><a href="#${n.path}"${navRoot(path) === n.path ? ' aria-current="page"' : ''}>
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
