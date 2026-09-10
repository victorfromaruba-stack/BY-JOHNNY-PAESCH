// Shared harness for auditing the live app. Import or copy.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
export const LOCAL = `export const CONFIG = { backend: 'local', supabaseUrl: '', supabaseKey: '' };`;
export const ROUTES = ['/', '/home', '/stays', '/stays/stay_surfclub', '/trips', '/trips/trip_japan',
  '/deals', '/requests', '/pay', '/ledger', '/pool', '/circle', '/crews', '/watching',
  '/card', '/profile', '/rules', '/desk', '/bank', '/settings', '/sign-in'];
/** Open the app signed in as a member with the given role ('member' | 'planner' | 'admin'). */
export async function open({ width = 1280, height = 900, role = 'admin', scale = 1 } = {}) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
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
  await p.evaluate(async (r) => {
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
  // fullPage screenshots skip loading="lazy" images, and img.complete does not mean decoded.
  // Without this you end up "fixing" a layout that was never broken.
  await p.evaluate(async () => {
    const im = [...document.querySelectorAll('img')];
    im.forEach(i => { i.loading = 'eager'; });
    await Promise.all(im.map(i => i.decode().catch(() => {})));
  });
  await p.waitForTimeout(250);
}
