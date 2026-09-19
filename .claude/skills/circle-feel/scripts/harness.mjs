// Shared harness for auditing the live app. Import or copy.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
export const LOCAL = `export const CONFIG = { backend: 'local', supabaseUrl: '', supabaseKey: '' };`;
export const ROUTES = ['/', '/home', '/stays', '/stays/stay_surfclub', '/cruises', '/cruises/trip_cruise_abc', '/trips/trip_japan',
  '/postcards', '/requests', '/pay', '/ledger', '/pool', '/circle', '/crews', '/watching',
  '/card', '/profile', '/rules', '/desk', '/bank', '/settings', '/sign-in'];
const FONT_DIR = process.env.CIRCLE_FONTS || '/tmp/claude-0/-home-user-BY-JOHNNY-PAESCH/84807211-e7d2-5336-9e3f-7549cf10be4d/scratchpad';
async function fontShim(p) {
  const { existsSync, readFileSync } = await import('node:fs');
  const css = `${FONT_DIR}/fonts.css`;
  if (!existsSync(css)) return;
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: readFileSync(css, 'utf8') }));
  await p.route('https://fonts.gstatic.com/**', r => {
    const f = `${FONT_DIR}/fonts/${new URL(r.request().url()).pathname.slice(1).replace(/\//g, '_')}`;
    return existsSync(f) ? r.fulfill({ status: 200, contentType: 'font/woff2', body: readFileSync(f) }) : r.abort();
  });
}
/** The phone's status bar and home indicator, as the app reads them: --inset-top / --inset-bottom
 *  on <html>. The router re-renders <main>, never <html>, so setting them once would do — but a
 *  full reload inside a test (the service worker, a `page.goto`) would drop them, so go() applies
 *  them again after every navigation. Pass null to clear. */
export async function applyInsets(p, insets) {
  const set = insets ?? p.__huntoInsets;
  if (!set) return;
  await p.evaluate(({ top = 0, bottom = 0 }) => {
    const s = document.documentElement.style;
    s.setProperty('--inset-top', `${top}px`);
    s.setProperty('--inset-bottom', `${bottom}px`);
  }, set);
}
/** Open the app signed in as a member with the given role ('member' | 'planner' | 'admin');
 *  role: null opens it signed out.
 *  touch: true makes the page a touch device (hasTouch + isMobile) when width < 500, so
 *  focus-on-open and double-tap behaviour are measured as a phone would show them.
 *  insets: { top, bottom } in px sets --inset-top / --inset-bottom on <html>, re-applied by go(). */
export async function open({ width = 1280, height = 900, role = 'admin', scale = 1, touch = false, insets = null } = {}) {
  const b = await chromium.launch();
  const phone = touch && width < 500;
  const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: scale,
    ...(phone ? { hasTouch: true, isMobile: true } : {}) });
  p.__huntoInsets = insets;
  // The real typefaces, from disk. Answering both font hosts from the saved bundle
  // (scratchpad/fonts + fonts.css) keeps every render deterministic and off the network; when a
  // face is added to index.html, add its @font-face blocks and woff2 files to the bundle first or
  // every judgement about type will be about a fallback font.
  await fontShim(p);
  const errors = [];
  p.on('pageerror', e => errors.push(String(e.message)));
  p.on('console', m => { const t = m.text();
    if (m.type() === 'error' && !/ERR_CONNECTION_RESET|fonts\.googleapis|favicon/.test(t)) errors.push('console: ' + t.slice(0, 160)); });
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: LOCAL }));
  // The Deals page and every VakayMood stay page fetch live listings. Answer them from Node via
  // curl, which honours the machine's proxy where the browser cannot, so the live section is
  // populated when the sweep clicks through it rather than showing its "would not reach" line.
  await p.route('https://vakaymood.com/**', async (route) => {
    try {
      const body = execFileSync('curl', ['-sS', '--max-time', '25', route.request().url()], { maxBuffer: 64 << 20 });
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
    } catch { await route.abort(); }
  });
  await p.goto('http://127.0.0.1:8899/circle/#/', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !!window.__hunto, null, { timeout: 25000 });
  await applyInsets(p);
  if (role) await p.evaluate(async (r) => {
    const s = window.__hunto.store;
    // A plain member carries roles ['member'], so "no roles" matches nobody: a plain member is
    // one with no officer role. Without this a "member" run signed in as members[0] — Victor.
    const OFFICER = ['planner', 'comms', 'treasurer', 'admin'];
    const pick = r === 'member'
      ? s.state.members.find(m => m.status === 'active' && !m.bot && !(m.roles||[]).some(x => OFFICER.includes(x)))
      : s.state.members.find(m => (m.roles||[]).some(x => x === r || x === 'admin'));
    if (!pick) throw new Error(`no member for role ${r}`);
    await s.signIn(pick.id);
  }, role);
  return { b, p, errors };
}
export async function go(p, route, wait = 1400) {
  await p.evaluate(r => { location.hash = r; }, route);
  await p.waitForTimeout(wait);
  await applyInsets(p);
  // fullPage screenshots skip loading="lazy" images, and img.complete does not mean decoded.
  // Without this you end up "fixing" a layout that was never broken.
  await p.evaluate(async () => {
    const im = [...document.querySelectorAll('img')];
    im.forEach(i => { i.loading = 'eager'; });
    await Promise.all(im.map(i => i.decode().catch(() => {})));
  });
  await p.waitForTimeout(250);
}
