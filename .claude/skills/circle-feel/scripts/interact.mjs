// Click every control in the app and report the ones where nothing observably happens.
//
// "It looks fine" and "it works" are different claims, and only one of them is testable by
// looking at a screenshot. A control that does nothing when pressed is the single loudest way
// an app feels unfinished, and it is invisible to a layout audit — the button is the right size,
// in the right place, with the right label, and dead.
//
// What counts as "something happened": the route changed, a dialog opened, a toast appeared, a
// file download started, focus moved somewhere meaningful, or the DOM under #app changed. That
// last one is deliberately generous — a filter that redraws a list and a button that only
// toggles aria-pressed both count. We are hunting for zero, not for quality.
//
// localStorage is snapshotted per route and restored before every click, so a destructive action
// cannot poison the controls tested after it.
import { open, go, ROUTES } from './harness.mjs';

const ROLES = ['member', 'planner', 'admin'];
// Controls that are correctly inert, with the reason. Anything not listed here that does nothing
// is a finding.
const EXPECTED_INERT = [
  /^Skip to/,             // skip link: moves focus, which we do detect, but not on every browser
];

const fingerprint = () => ({
  hash: location.hash,
  dialogs: document.querySelectorAll('dialog[open]').length,
  toasts: document.querySelectorAll('.toast, [role=status], [role=alert]').length,
  html: document.querySelector('#app')?.innerHTML.length ?? 0,
  htmlHash: (() => { const s = document.querySelector('#app')?.innerHTML || ''; let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; })(),
  active: document.activeElement?.tagName + ':' + (document.activeElement?.className || ''),
});

const findings = [];
let clicked = 0;

for (const role of ROLES) {
  const { b, p, errors } = await open({ width: 1280, height: 900, role });
  p.on('dialog', d => d.dismiss().catch(() => {}));   // native confirm/alert, if any
  for (const route of ROUTES) {
    await go(p, route, 900);
    const snapshot = await p.evaluate(() => JSON.stringify(localStorage));
    const controls = await p.evaluate(() => {
      const sel = 'button:not([disabled]), a[href]:not([href^="mailto"]), [role=button], summary';
      return [...document.querySelectorAll('#app ' + sel)].map((n, i) => {
        n.setAttribute('data-probe', String(i));
        return { i, tag: n.tagName, label: (n.textContent || n.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 44) };
      });
    });
    for (const c of controls) {
      if (EXPECTED_INERT.some(re => re.test(c.label))) continue;
      // Fresh state, fresh render, then one click.
      await p.evaluate(s => { localStorage.clear(); for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); }, snapshot);
      await go(p, route, 600);
      const before = await p.evaluate(fingerprint);
      const hit = await p.evaluate(i => {
        const n = document.querySelector(`#app [data-probe="${i}"]`);
        if (!n) return false;
        n.scrollIntoView({ block: 'center' });
        n.click();
        return true;
      }, c.i);
      if (!hit) continue;                       // element re-rendered away; not a finding
      clicked++;
      await p.waitForTimeout(700);
      const after = await p.evaluate(fingerprint);
      const changed = before.hash !== after.hash || before.dialogs !== after.dialogs
        || before.toasts !== after.toasts || before.htmlHash !== after.htmlHash
        || before.active !== after.active;
      if (!changed) findings.push({ role, route, label: c.label || `<${c.tag.toLowerCase()}>`, tag: c.tag });
      // Close anything the click opened before moving on.
      await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    }
  }
  if (errors.length) console.log(`console errors as ${role}:`, errors.slice(0, 5));
  await b.close();
}

console.log(`\nclicked ${clicked} controls across ${ROLES.length} roles × ${ROUTES.length} routes`);
if (!findings.length) { console.log('every one of them did something'); }
else {
  console.log(`\n${findings.length} did nothing observable:\n`);
  for (const f of findings) console.log(`  ${f.route.padEnd(24)} ${f.role.padEnd(8)} ${f.tag.padEnd(7)} ${f.label}`);
}
