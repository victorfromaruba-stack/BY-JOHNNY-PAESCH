#!/usr/bin/env node
// Measure the things that actually decide whether the app feels finished — on a phone.
// Usage: node audit.mjs [--role member|admin] [--width 390]
//
// Per route and width it prints (the first six columns are the old table, unchanged):
//   ovf        the document is wider than the window
//   screens    scrollHeight / innerHeight
//   to-1st-fig px from the top to the first figure the member came for
//   small-tap  controls under 44px in either direction
//   chars      characters of text in main
//   err        page errors and console errors during the route
//   min-ctl    the smallest computed font-size over inputs, selects and textareas on the route
//              AND inside every sheet the audit could open by tapping (test 6: under 16 and iOS zooms)
//   seg        .segmented controls that scroll sideways (test 23: scrollWidth !== clientWidth)
//   act        number of .act-bar elements (test 21: at most one)
//   row        /stays listing rows whose far right edge is NOT the row link (test 19), as bad/all
//   sheets     how many sheets the audit opened on the route
// Then the reachability crawl (test 25) as member and as admin, and the phone-only assertion:
// the 768 and 1440 rows must equal the 390 row on overflow, small taps and to-1st-fig (§3).
// New checks print; they never throw. Exit behaviour is unchanged.
import { open, go, ROUTES } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const role = arg('--role', 'admin');
const widths = arg('--width') ? [Number(arg('--width'))] : [390, 768, 1440];
const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JS = resolve(process.env.CIRCLE_ROOT || resolve(HERE, '../../../..'), 'circle/js/app.js');

// Every button that opens a sheet(), by its label — one per sheet() site in circle/js (grep
// 'sheet(' there when adding one). Labels, not selectors: after a redraw a selector index is a
// different button. Sheets that only open after a network call or a typed reason (the login
// card after a password is made, the hotel penalty after a cancel reason) are not on the list.
const SHEET_TRIGGERS = [
  'Paste a listing', 'By hand', 'paste it',                       // deals: paste, post
  'It is there', 'It is gone', 'Could not tell', 'I rang them instead', // catalog: lookSheet
  'Quote it', 'I booked it', 'Look and price', 'Book it',         // catalog: quote, book
  'Add room photographs',                                        // officer: roomPhotosSheet
  'Start a crew', 'Rename', 'Add someone',                        // crews
  'Watch for something',                                         // deals: addWatchSheet
  'Choose one', 'Change',                                         // member: goalSheet
  'Put Hunto on your home screen', 'Pause for a few months',      // member: install, pause
  'Send a postcard',                                             // postcards
  'Money came in', 'See the screenshot', 'A different amount arrived', // officer: bank
  'Add a stay, trip or cruise', 'Edit',                          // officer: desk editStay, settings edit member
  'Add an Insider', 'New password', 'Give a login', 'Adjust',     // officer: settings
];
const CTL = 'input:not([type=checkbox]):not([type=radio]), select, textarea';

async function measure(p) {
  return p.evaluate((CTL) => {
    const minCtl = (root) => {   // the same five lines live in openSheets: the CSP forbids eval, so no sharing
      const sizes = [...root.querySelectorAll(CTL)].filter(e => e.getClientRects().length && e.type !== 'hidden')
        .map(e => parseFloat(getComputedStyle(e).fontSize)).filter(n => n > 0);
      return sizes.length ? Math.min(...sizes) : null;
    };
    const doc = document.documentElement;
    const main = document.querySelector('main') || document.body;
    // How far down is the first real number or figure the member came for?
    const fig = [...main.querySelectorAll('.num, .hero-figure, .big-figure, .price')]
      .map(e => e.getBoundingClientRect().top + window.scrollY).filter(t => t > 0).sort((a, b2) => a - b2)[0];
    const small = [...main.querySelectorAll('button, a[href], input, select, [role=button]')]
      .filter(e => { const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44); }).length;
    // Test 23: a segmented control never scrolls sideways.
    const segs = [...document.querySelectorAll('.segmented')];
    const segScroll = segs.filter(s => s.scrollWidth !== s.clientWidth).length;
    // Test 19: the far right of every listing row is still the row's own link. elementFromPoint
    // only answers for what is on the screen, so each row is scrolled into view before it is
    // probed; clamping the point to the viewport instead measures the tab bar and fails every
    // row below the fold, which is what this check used to do.
    const rows = [...document.querySelectorAll('.listing-row')];
    const firstY = window.scrollY;
    let rowBad = 0;
    for (const row of rows) {
      const box = row.getBoundingClientRect();
      if (!box.width || !box.height) { rowBad++; continue; }
      row.scrollIntoView({ block: 'center' });
      const r = row.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(r.right - 8), Math.round(r.top + r.height / 2));
      if (hit?.closest('a.listing-row') !== row) rowBad++;
    }
    window.scrollTo(0, firstY);
    return { overflow: doc.scrollWidth > window.innerWidth + 1,
             tall: Math.round(doc.scrollHeight / window.innerHeight * 10) / 10,
             firstFigure: fig == null ? null : Math.round(fig),
             smallTargets: small,
             text: (main.innerText || '').trim().length,
             minCtl: minCtl(document),
             segs: segs.length, segScroll,
             actBars: document.querySelectorAll('.act-bar').length,
             rows: rows.length, rowBad };
  }, CTL);
}

/** Test 6, the sheet half: tap every sheet trigger on the route (in every segmented pane), read
 *  the smallest control font inside the opened dialog, close it, and put the route back. */
async function openSheets(p, route) {
  const opened = [];   // { label, minCtl }
  const tried = new Set();
  const tabs = await p.evaluate(() => Math.max(1, document.querySelectorAll('main .segmented button, main .segmented a').length));
  for (let t = 0; t < tabs; t++) {
    await p.evaluate((i) => document.querySelectorAll('main .segmented button, main .segmented a')[i]?.click(), t).catch(() => {});
    await p.waitForTimeout(150);
    for (const label of SHEET_TRIGGERS) {
      if (tried.has(label)) continue;
      const found = await p.evaluate((label) => {
        const norm = s => s.replace(/\s+/g, ' ').trim();
        const visible = n => n.getClientRects().length && n.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false;
        const btn = [...document.querySelectorAll('main button:not([disabled]), main [role=button], #app button:not([disabled])')]
          .find(b => norm(b.textContent) === label && visible(b));
        if (!btn) return false;
        btn.click();
        return true;
      }, label).catch(() => false);
      if (!found) continue;
      tried.add(label);
      // A sheet can arrive after a dynamic import; give it a moment, then read it.
      let dlg = null;
      for (let i = 0; i < 8 && !dlg; i++) {
        await p.waitForTimeout(150);
        dlg = await p.evaluate((CTL) => {
          const d = document.querySelector('dialog[open]');
          if (!d) return null;
          const sizes = [...d.querySelectorAll(CTL)].filter(e => e.getClientRects().length && e.type !== 'hidden')
            .map(e => parseFloat(getComputedStyle(e).fontSize)).filter(n => n > 0);
          return { title: (d.querySelector('.sheet-title')?.textContent || '').trim().slice(0, 40), minCtl: sizes.length ? Math.min(...sizes) : null };
        }, CTL).catch(() => null);
      }
      if (dlg) {
        opened.push({ label, ...dlg });
        await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close())).catch(() => {});
        await p.waitForTimeout(250);
      }
      // Some closes navigate (closing the watch sheet goes to /watching); put the route back.
      const hash = await p.evaluate(() => location.hash).catch(() => '');
      if (hash !== '#' + route) await go(p, route, 800);
    }
  }
  return opened;
}

// ---------- test 25: reachability ----------
function routeTable() {
  const src = readFileSync(APP_JS, 'utf8');
  const out = [];
  for (const line of src.split('\n')) {
    const m = line.match(/\{\s*path:\s*'([^']+)'.*auth:\s*true/);
    if (!m) continue;
    const roles = line.match(/roles:\s*\[([^\]]*)\]/);
    out.push({ path: m[1], roles: roles ? roles[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean) : [] });
  }
  return out;
}
const matches = (pattern, path) => {
  const a = pattern.split('/'), b = path.split('/');
  return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
};
async function linksOn(p) {
  return p.evaluate(() => {
    const scope = [document.querySelector('main'), document.getElementById('topbar'), document.getElementById('botnav')].filter(Boolean);
    const seen = new Set();
    for (const s of scope) for (const a of s.querySelectorAll('a[href^="#/"]')) {
      const path = a.getAttribute('href').slice(1).split('?')[0].replace(/\/$/, '') || '/';
      seen.add(path);
    }
    return [...seen];
  });
}
async function crawl(crawlRole, width = 390) {
  const { b, p } = await open({ width, height: 844, role: crawlRole });
  const reached = new Set();
  try {
    for (const start of ['/home', '/profile']) {
      await go(p, start, 1000);
      reached.add(start);
      const hop1 = await linksOn(p);
      hop1.forEach(r => reached.add(r));
      for (const r of hop1) {
        if (r === start) continue;
        await go(p, r, 900);
        (await linksOn(p)).forEach(x => reached.add(x));
      }
    }
  } finally { await b.close(); }
  return reached;
}

// ---------- the sweep ----------
const byWidth = {};
for (const width of widths) {
  const height = width < 500 ? 844 : 900;
  const { b, p, errors } = await open({ width, height, role });
  const rows = [];
  for (const route of ROUTES) {
    const before = errors.length;
    await go(p, route);
    const m = await measure(p);
    let sheets = [];
    try { sheets = await openSheets(p, route); } catch (e) { errors.push('audit: ' + String(e.message).slice(0, 120)); }
    const mins = [m.minCtl, ...sheets.map(s => s.minCtl)].filter(n => n != null);
    rows.push({ route, ...m, sheets, minAll: mins.length ? Math.min(...mins) : null, errors: errors.length - before });
  }
  await b.close();
  byWidth[width] = rows;
  console.log(`\n=== ${width}px, as ${role} ===`);
  console.log('route'.padEnd(22), 'ovf', 'screens', 'to-1st-fig', 'small-tap', 'chars', 'err', 'min-ctl', 'seg', 'act', 'row', 'sheets');
  for (const r of rows) {
    console.log(r.route.padEnd(22),
      (r.overflow ? 'YES' : ' . ').padEnd(3),
      String(r.tall).padStart(6),
      String(r.firstFigure ?? '-').padStart(10),
      String(r.smallTargets).padStart(9),
      String(r.text).padStart(6),
      String(r.errors).padStart(4),
      String(r.minAll == null ? '-' : r.minAll < 16 ? `${r.minAll}!` : r.minAll).padStart(7),
      String(r.segs ? (r.segScroll ? `${r.segScroll}!` : '.') : '-').padStart(3),
      String(r.actBars > 1 ? `${r.actBars}!` : r.actBars).padStart(3),
      String(r.rows ? `${r.rowBad}/${r.rows}${r.rowBad ? '!' : ''}` : '-').padStart(5),
      String(r.sheets.length).padStart(6));
  }
  const bad = rows.filter(r => r.overflow || r.errors);
  console.log(bad.length ? `\n!! ${bad.length} route(s) with overflow or errors` : '\nno overflow, no errors');
  // The detail behind the new columns, so a "!" can be traced to a control.
  const zoomers = rows.flatMap(r => [
    ...(r.minCtl != null && r.minCtl < 16 ? [`${r.route}: page control at ${r.minCtl}px`] : []),
    ...r.sheets.filter(s => s.minCtl != null && s.minCtl < 16).map(s => `${r.route}: sheet "${s.title}" (via "${s.label}") at ${s.minCtl}px`)]);
  console.log(zoomers.length ? `!! test 6, controls under 16px (iOS zooms):\n   ${zoomers.join('\n   ')}` : 'test 6: every control 16px or more');
  const segBad = rows.filter(r => r.segScroll).map(r => r.route);
  console.log(segBad.length ? `!! test 23, segmented controls that scroll: ${segBad.join(' ')}` : 'test 23: no segmented control scrolls');
  const actBad = rows.filter(r => r.actBars > 1).map(r => `${r.route} (${r.actBars})`);
  console.log(actBad.length ? `!! test 21, more than one .act-bar: ${actBad.join(' ')}` : 'test 21: at most one .act-bar per route');
  const rowBad = rows.filter(r => r.rowBad).map(r => `${r.route} ${r.rowBad}/${r.rows}`);
  console.log(rowBad.length ? `!! test 19, listing rows whose right edge is not the row link: ${rowBad.join(' ')}` : 'test 19: every listing row is tappable edge to edge');
  const unopened = rows.filter(r => r.sheets.length === 0).length;
  console.log(`sheets opened: ${rows.reduce((n, r) => n + r.sheets.length, 0)} across ${rows.length - unopened} route(s)`);
}

// ---------- test 25 ----------
console.log('\n=== reachability (two hops from /home and /profile, 390px) ===');
const table = routeTable();
for (const crawlRole of ['member', 'admin']) {
  try {
    const reached = await crawl(crawlRole);
    const expected = crawlRole === 'member' ? table.filter(r => !r.roles.length) : table;
    const missing = expected.filter(r => ![...reached].some(path => matches(r.path, path))).map(r => r.path);
    console.log(`as ${crawlRole}: ${reached.size} link targets reached; ` +
      (missing.length ? `NOT reached: ${missing.join(' ')}` : 'every route reached'));
  } catch (e) { console.log(`as ${crawlRole}: crawl failed — ${String(e.message).slice(0, 140)}`); }
}

// ---------- §3: the laptop shows the phone ----------
// The wider windows must agree with the phone on overflow and small taps at every route. The
// first-figure position is compared only between the wider windows themselves: they are 900 tall
// and the column is 430 wide there, so a line wraps differently than at 390 by 844 and the same
// figure sits a few pixels lower; that is the phone layout, not a laptop one.
if (byWidth[390] && widths.length > 1) {
  const base = Object.fromEntries(byWidth[390].map(r => [r.route, r]));
  const wide = widths.filter(x => x !== 390);
  const wideBase = wide.length > 1 ? Object.fromEntries(byWidth[wide[0]].map(r => [r.route, r])) : null;
  const differ = [];
  for (const w of wide) {
    for (const r of byWidth[w]) {
      const b0 = base[r.route]; if (!b0) continue;
      const why = [];
      if (r.overflow !== b0.overflow) why.push('ovf');
      if (r.smallTargets !== b0.smallTargets) why.push(`small-tap ${b0.smallTargets}→${r.smallTargets}`);
      const w0 = wideBase && w !== wide[0] ? wideBase[r.route] : null;
      if (w0 && r.firstFigure !== w0.firstFigure) why.push(`to-1st-fig ${w0.firstFigure ?? '-'}@${wide[0]}→${r.firstFigure ?? '-'}`);
      if (why.length) differ.push(`${r.route} @${w}: ${why.join(', ')}`);
    }
  }
  console.log('\n=== phone-only ===');
  console.log(differ.length ? `${differ.length} row(s) differ from the phone:\n   ${differ.join('\n   ')}` : 'phone-only: same at all widths');
}
