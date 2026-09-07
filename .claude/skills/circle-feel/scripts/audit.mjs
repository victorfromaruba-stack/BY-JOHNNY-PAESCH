#!/usr/bin/env node
// Measure the things that actually decide whether the app feels finished.
// Usage: node audit.mjs [--role member|admin] [--width 390]
import { open, go, ROUTES } from './harness.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const role = arg('--role', 'admin');
const widths = arg('--width') ? [Number(arg('--width'))] : [390, 768, 1440];

for (const width of widths) {
  const height = width < 500 ? 844 : 900;
  const { b, p, errors } = await open({ width, height, role });
  const rows = [];
  for (const route of ROUTES) {
    const before = errors.length;
    await go(p, route);
    const m = await p.evaluate(() => {
      const doc = document.documentElement;
      const main = document.querySelector('main') || document.body;
      // How far down is the first real number or figure the member came for?
      const fig = [...main.querySelectorAll('.num, .hero-figure, .big-figure, .price')]
        .map(e => e.getBoundingClientRect().top + window.scrollY).filter(t => t > 0).sort((a, b2) => a - b2)[0];
      const small = [...main.querySelectorAll('button, a[href], input, select, [role=button]')]
        .filter(e => { const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44); }).length;
      return { overflow: doc.scrollWidth > window.innerWidth + 1,
               tall: Math.round(doc.scrollHeight / window.innerHeight * 10) / 10,
               firstFigure: fig == null ? null : Math.round(fig),
               smallTargets: small,
               text: (main.innerText || '').trim().length };
    });
    rows.push({ route, ...m, errors: errors.length - before });
  }
  await b.close();
  console.log(`\n=== ${width}px, as ${role} ===`);
  console.log('route'.padEnd(22), 'ovf', 'screens', 'to-1st-fig', 'small-tap', 'chars', 'err');
  for (const r of rows) {
    console.log(r.route.padEnd(22),
      (r.overflow ? 'YES' : ' . ').padEnd(3),
      String(r.tall).padStart(6),
      String(r.firstFigure ?? '-').padStart(10),
      String(r.smallTargets).padStart(9),
      String(r.text).padStart(6),
      String(r.errors).padStart(4));
  }
  const bad = rows.filter(r => r.overflow || r.errors);
  console.log(bad.length ? `\n!! ${bad.length} route(s) with overflow or errors` : '\nno overflow, no errors');
}
