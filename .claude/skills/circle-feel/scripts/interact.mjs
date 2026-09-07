// Click every control in the app and report the ones where nothing observably happens.
//
// "It looks right" and "it works" are different claims, and only one of them is testable from a
// screenshot. A control that does nothing when pressed is the loudest way an app feels
// unfinished, and a layout audit is blind to it: the button is the right size, in the right
// place, correctly labelled, and dead.
//
// What counts as "something happened": the route changed, a dialog opened, a toast appeared,
// focus moved, the DOM under #app changed, a download started, the print dialog opened, or a new
// tab was opened. Deliberately generous — a filter redrawing a list and a button that only flips
// aria-pressed both pass. We are hunting for zero.
//
// Those last three matter more than they look. Print, Export CSV, Share and every "book direct"
// link change nothing a DOM diff can see, because what they do happens outside the page — so the
// first version of this script called all of them dead, which is nine false accusations and no
// real ones. Excusing them by name would have been the easy fix and the wrong one: a genuine
// regression in any of them would then go unnoticed for good. They are detected instead.
//
// A control that is already selected is a separate case: pressing the tab you are on SHOULD do
// nothing, so aria-pressed / aria-current is read before the click and those are not findings.
//
// Two passes. The sweep resets the screen between clicks — cheaply, by bouncing the hash rather
// than reloading and re-decoding every image — because without it a click that redraws a panel
// shifts every index after it and two thirds of the controls get skipped or mis-probed. Anything
// the sweep calls dead is then re-tested alone on a freshly loaded page, so state drift can cost
// a slow run but can never produce a false accusation.
//
// Controls are addressed by label, not by index, for the same reason: after a redraw, index 7 is
// a different button.
//
//   node interact.mjs                 every route, three roles
//   node interact.mjs /desk admin     one route, one role
import { open, go, ROUTES } from './harness.mjs';

const argv = process.argv.slice(2);
const roles = argv.filter(a => /^(member|planner|admin|treasurer)$/.test(a));
const only = argv.filter(a => a.startsWith('/'));
const ROLES = roles.length ? roles : ['member', 'planner', 'admin'];
const RUN = only.length ? only : ROUTES;

// Controls that are correctly inert, with the reason.
const EXPECTED_INERT = [[/^Skip to/, 'a skip link only moves focus, and not observably everywhere']];

// Every clause needs the scope prefix. `'#app ' + 'button, a[href]'` scopes the button and then
// matches EVERY link on the page — so this swept in the topbar and the bottom nav, could not
// find them again under #app, and quietly skipped three quarters of what it claimed to test.
const SCOPE = '#app';
const SEL = ['button:not([disabled])', 'a[href]:not([href^="mailto"])', '[role=button]', 'summary']
  .map(s => `${SCOPE} ${s}`).join(', ');

/** Tag every control fresh. A click can redraw the list its neighbours lived in, and a stale
 *  index silently probes the wrong element — which would read as a finding. */
function tagAll(sel) {
  // Only what a person could actually press. A control inside a hidden pane, or one the app
  // keeps in the DOM and reveals later, is still matched by querySelectorAll and still takes a
  // .click() — and reports as dead, because it is not there to react.
  const visible = (n) => !!(n.getClientRects().length && n.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false);
  const found = [...document.querySelectorAll(sel)].filter(visible);
  found.forEach((n, i) => n.setAttribute('data-probe', String(i)));
  return found.map((n, i) => ({ i, tag: n.tagName,
    on: n.getAttribute('aria-pressed') === 'true' || n.hasAttribute('aria-current'),
    label: (n.textContent || n.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 44) }));
}

function fingerprint() {
  const s = document.querySelector('#app')?.innerHTML || '';
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return [location.hash, document.querySelectorAll('dialog[open]').length,
    document.querySelectorAll('.toast, [role=status], [role=alert]').length, h,
    document.activeElement?.tagName + '.' + (document.activeElement?.className || ''),
    window.__printed || 0].join('|');
}

/** Count print dialogs and downloads, which a DOM diff cannot see.
 *  The stub deliberately does not call through: a real window.print() blocks the page on a
 *  dialog the harness would then have to dismiss. addInitScript covers later navigations;
 *  the evaluate covers the document that is already open when we get here. */
const PRINT_STUB = () => { window.__printed = 0; window.print = () => { window.__printed++; }; };
async function instrument(p) {
  await p.addInitScript(PRINT_STUB);
  await p.evaluate(PRINT_STUB);
  const state = { downloads: 0, popups: 0 };
  p.on('download', (d) => { state.downloads++; d.delete().catch(() => {}); });
  // Share falls back to window.open, and every "book direct" link is target=_blank. Close them
  // straight away: an external page left open costs a real network fetch on every probe.
  p.on('popup', (pop) => { state.popups++; pop.close().catch(() => {}); });
  return state;
}

function clickProbe(i) {
  const n = document.querySelector(`[data-probe="${i}"]`);
  if (!n) return false;
  n.scrollIntoView({ block: 'center' });
  n.click();
  return true;
}

const tidy = (p) => p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

/** Some controls end the session — /profile has a Sign out button. Left unhandled it poisons
 *  every route swept after it: the run reported /settings as three controls because it was
 *  looking at a signed-out page. Cheap to check, and only pays for itself when it fires. */
async function keepSignedIn(p, id) {
  const out = await p.evaluate(() => !window.__hunto?.store?.me);
  if (!out) return false;
  await p.evaluate(async (mid) => { await window.__hunto.store.signIn(mid); }, id);
  await p.waitForTimeout(250);
  return true;
}

/** Put the screen back the way it started. A hash router does not re-render when you set the
 *  hash it is already on, so bounce off another route and come back. */
async function reset(p, route) {
  await p.evaluate(async (r) => {
    location.hash = r === '#/home' ? '#/stays' : '#/home';
    await new Promise(res => setTimeout(res, 110));
    location.hash = r;
  }, route);
  await p.waitForTimeout(320);
}

/** One click, reported as changed / unchanged / gone. */
async function probe(p, i, dl, wait = 320) {
  const before = await p.evaluate(fingerprint) + `|${dl.downloads}|${dl.popups}`;
  const hit = await p.evaluate(clickProbe, i);
  if (!hit) return 'gone';
  await p.waitForTimeout(wait);
  const after = await p.evaluate(fingerprint) + `|${dl.downloads}|${dl.popups}`;
  await tidy(p);
  return before === after ? 'unchanged' : 'changed';
}

const suspects = [], confirmed = [];
let clicked = 0, skipped = 0;
const t0 = Date.now();

for (const role of ROLES) {
  const { b, p, errors } = await open({ width: 1280, height: 900, role });
  p.on('dialog', d => d.dismiss().catch(() => {}));
  const dl = await instrument(p);
  const whoami = await p.evaluate(() => window.__hunto.store.me.id);

  for (const route of RUN) {
    await go(p, route, 700);
    const hash = '#' + route;
    // Address by label + which one of that label, so a redraw cannot slide us onto a neighbour.
    const seen = new Map();
    const keys = (await p.evaluate(tagAll, SEL)).map(c => {
      const k = `${c.tag}\u0000${c.label}`;
      const nth = (seen.get(k) || 0); seen.set(k, nth + 1);
      return { ...c, key: k, nth };
    });
    let dead = 0;
    for (const c of keys) {
      if (EXPECTED_INERT.some(([re]) => re.test(c.label))) { skipped++; continue; }
      // Pressing the tab you are already on is meant to do nothing.
      if (c.on) { skipped++; continue; }
      await reset(p, hash);
      const found = await p.evaluate(([sel, key, nth]) => {
        const all = [...document.querySelectorAll(sel)];
        let seenHere = 0;
        for (const n of all) {
          const k = `${n.tagName}\u0000${(n.textContent || n.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 44)}`;
          if (k !== key) continue;
          if (seenHere++ !== nth) continue;
          n.setAttribute('data-probe', '__t'); return true;
        }
        return false;
      }, [SEL, c.key, c.nth]);
      if (!found) { skipped++; continue; }
      const verdict = await probe(p, '__t', dl);
      if (verdict === 'gone') { skipped++; continue; }
      clicked++;
      if (verdict === 'unchanged') { dead++; suspects.push({ role, route, ...c }); }
      if (await keepSignedIn(p, whoami)) await reset(p, hash);
    }
    process.stdout.write(`${route.padEnd(24)} ${role.padEnd(8)} ${String(keys.length).padStart(3)} controls${dead ? ` · ${dead} suspect` : ''}\n`);
  }
  if (errors.length) console.log(`console errors as ${role}: ${errors.slice(0, 4).join(' | ')}`);
  await b.close();
}

// Second pass: every suspect alone, on a page loaded from scratch, so nothing another click
// did can be what silenced it.
if (suspects.length) {
  console.log(`\nre-testing ${suspects.length} suspect(s) on a clean page…`);
  for (const s of suspects) {
    const { b, p } = await open({ width: 1280, height: 900, role: s.role });
    p.on('dialog', d => d.dismiss().catch(() => {}));
    const dl = await instrument(p);
    await go(p, s.route, 800);
    const list = await p.evaluate(tagAll, SEL);
    const match = list.find(x => x.label === s.label && x.tag === s.tag);
    if (!match) { console.log(`  only reachable from another tab, not re-testable here: ${s.route} "${s.label}"`); await b.close(); continue; }
    const verdict = await probe(p, match.i, dl, 800);
    if (verdict === 'unchanged') { confirmed.push(s); console.log(`  CONFIRMED DEAD  ${s.route} · ${s.role} · "${s.label}"`); }
    else console.log(`  works on a clean page (drift): ${s.route} "${s.label}"`);
    await b.close();
  }
}

console.log(`\nclicked ${clicked} controls (${skipped} skipped) across ${ROLES.length} role(s) × ${RUN.length} route(s) in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
if (!confirmed.length) console.log('every one of them did something.');
else {
  console.log(`\n${confirmed.length} confirmed dead:\n`);
  for (const f of confirmed) console.log(`  ${f.route.padEnd(24)} ${f.role.padEnd(9)} ${f.tag.padEnd(7)} ${f.label}`);
}
