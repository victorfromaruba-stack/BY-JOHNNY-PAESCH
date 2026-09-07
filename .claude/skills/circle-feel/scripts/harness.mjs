// Shared harness for auditing the live app. Import or copy.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
export const LOCAL = `export const CONFIG = { backend: 'local', supabaseUrl: '', supabaseKey: '' };`;
export const ROUTES = ['/', '/home', '/stays', '/stays/stay_surfclub', '/trips', '/trips/trip_japan',
  '/deals', '/live', '/requests', '/pay', '/ledger', '/pool', '/circle', '/crews', '/watching',
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
  await p.goto('http://127.0.0.1:8899/circle/#/', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !!window.__hunto, null, { timeout: 25000 });
  await p.evaluate(async (r) => {
    const s = window.__hunto.store;
    const pick = r === 'member'
      ? s.state.members.find(m => m.status === 'active' && !m.bot && !(m.roles||[]).length)
      : s.state.members.find(m => (m.roles||[]).some(x => x === r || x === 'admin'));
    await s.signIn((pick || s.state.members[0]).id);
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
