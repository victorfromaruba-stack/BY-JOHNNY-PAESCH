#!/usr/bin/env node
//
// The cases that have actually gone wrong on the Circle's board, runnable in one go.
//
//   node .claude/skills/interval-board/scripts/parser-check.mjs
//   node .claude/skills/interval-board/scripts/parser-check.mjs /tmp/a-page-that-misread.txt
//
// Every one of these was a real defect, found either by attacking the parser or by a screen
// recording of the page it could not read. They are here so that fixing the next layout change
// cannot quietly reintroduce one of them — which is the usual way a parser gets worse while
// looking like it got better.
//
// Exits non-zero when anything fails, so it can gate a deploy.
//
// With a file argument it parses that instead and prints what it made of it, which is the fastest
// way to turn "it read this wrong" into a diagnosis. Pass the page TEXT — what the Grab panel read
// — not HTML, and never fetch the page to get it.

import { parseListings } from '../../../../circle/js/data/listing-paste.js';
import { readFileSync } from 'node:fs';

/** The catalog, near enough: the names the parser has to recognise and one it must not. */
const STAYS = [
  { id: 's1', name: "Marriott's Aruba Surf Club", kind: 'aruba' },
  { id: 's2', name: "Marriott's Aruba Ocean Club", kind: 'aruba' },
  { id: 's3', name: 'Renaissance Wind Creek Aruba Resort', kind: 'aruba' },
  { id: 's4', name: 'La Cabana Beach Resort & Casino', kind: 'aruba' },
];

/** The real Interval Getaway results page, as its text reads. */
const REAL_PAGE = `Sort by: Travel Date Resort Name Location Price
Filter by:
Marriott's Aruba Surf Club
Palm Beach , ARUBA - DCB
MSU
Overall Rating
48 Member Ratings
Resort Details & Photos
from
US$90.50
Average Night
Prices include mandatory fees
Weekly
Rate
Sep 17 2026 - Sep 24 2026
US$633.46
Book
Sep 18 2026 - Sep 25 2026
US$633.46
Book
Sep 19 2026 - Sep 26 2026
US$1,172.54
Book
Caribbean Palm Village
Oranjestad , ARUBA - DCB
CPV
Overall Rating
Resort Details & Photos
from
US$144.00
Average Night
Weekly
Rate
Sep 19 2026 - Sep 26 2026
US$1,008.01
Book
Marriott's Aruba Ocean Club
Palm Beach , ARUBA - DCB
MAO
Resort Details & Photos
from
US$167.51
Average Night
Weekly
Rate
Sep 21 2026 - Sep 28 2026
US$1,172.54
Book
Nightly rates are based on per week basis.
All prices are shown in US DOLLARS.`;

const CASES = [
  {
    name: 'the real Interval page: one resort carries three weeks',
    text: REAL_PAGE,
    check: (rows) => {
      const surf = rows.filter((r) => r.stay?.id === 's1');
      if (surf.length !== 3) return `expected 3 Surf Club weeks, got ${surf.length}`;
      return null;
    },
  },
  {
    name: 'a row figure is a WEEK, so the nightly rate matches the page header',
    text: REAL_PAGE,
    check: (rows) => {
      const r = rows.find((x) => x.from === '2026-09-17');
      if (!r) return 'the 17 Sept week was not read at all';
      // The page's own "from US$90.50" is the cheapest week here. 633.46 / 7 = 90.49.
      if (Math.abs(r.usdNightly - 90.49) > 0.02) return `read $${r.usdNightly} a night, the page says about $90.50`;
      return null;
    },
  },
  {
    name: 'a resort we do not stock is refused, never given the name above it',
    text: REAL_PAGE,
    check: (rows) => {
      const orphan = rows.find((r) => r.from === '2026-09-19' && r.usdTotal === 1008.01);
      if (!orphan) return 'the Caribbean Palm Village week was not read';
      if (orphan.stay) return `filed under ${orphan.stay.name} — it is not one of ours and must stay unnamed`;
      return null;
    },
  },
  {
    name: 'a week over New Year with one year printed is seven nights, not minus 358',
    text: `Marriott's Aruba Ocean Club
Palm Beach , ARUBA - DCB
Weekly
Rate
Dec 28 - Jan 4, 2027
US$1,172.54`,
    check: (rows) => {
      const r = rows[0];
      if (!r) return 'nothing read';
      if (r.from !== '2026-12-28' || r.to !== '2027-01-04') return `read ${r.from} to ${r.to}`;
      if (r.nights !== 7) return `read ${r.nights} nights`;
      return null;
    },
  },
  {
    name: 'a row carrying BOTH a nightly and a weekly figure trusts the labels',
    text: `Marriott's Aruba Surf Club
Palm Beach · ARUBA · DCB      MSU
Sep 20 2026 - Sep 27 2026
2 Bedroom Villa
Sleeps: 8
US$90.50 Average Night        Weekly Rate US$633.50`,
    check: (rows) => {
      const r = rows[0];
      if (!r) return 'nothing read';
      if (Math.abs(r.usdNightly - 90.5) > 0.02) return `read $${r.usdNightly} a night, the row says $90.50`;
      if (Math.abs(r.usdTotal - 633.5) > 0.02) return `read $${r.usdTotal} for the week, the row says $633.50`;
      return null;
    },
  },
  {
    name: 'one RedWeek listing pasted on its own still reads',
    text: `Marriott's Aruba Surf Club
Sep 11-18, 2026  7 Nights
3 Bedroom Villa, Ocean view
Sleeps: 12
$525/night        $4,031 total`,
    check: (rows) => {
      const r = rows[0];
      if (!r) return 'nothing read';
      if (r.stay?.id !== 's1') return `filed under ${r.stay?.name ?? 'nobody'}`;
      if (Math.abs(r.usdTotal - 4031) > 0.5) return `read $${r.usdTotal} for the week`;
      return null;
    },
  },
  {
    // From the adversarial review: `total(?:\s*price)?\s*:?[^$\d]{0,24}\$?\s*([\d.]+)` made the
    // dollar sign optional and [^$\d] matched newlines, so "Total\nSleeps 8" read 8 as the price.
    name: 'a bare number after the word "total" is not a price',
    text: `Marriott's Aruba Surf Club
Palm Beach , ARUBA - DCB
Sep 20 2026 - Sep 27 2026
Total
Sleeps 8
Guests 4`,
    check: (rows) => {
      const r = rows[0];
      if (!r) return 'nothing read';
      if (r.usdTotal) return `read $${r.usdTotal} for the week from an occupancy figure`;
      if (r.ok) return 'posted a week with no price on it';
      return null;
    },
  },
  {
    // A lone unlabelled figure is a number and a coin toss: read as a night it is 7x wrong.
    name: 'a figure with no label is refused, not quoted as a nightly rate',
    text: `Marriott's Aruba Ocean Club
Palm Beach , ARUBA - DCB
Sep 26 2026 - Oct 3 2026
US$1,172.54`,
    check: (rows) => {
      const r = rows[0];
      if (!r) return 'nothing read';
      if (Math.abs(r.usdNightly - 1172.54) < 1) return 'read the week as a NIGHT — seven times over';
      if (r.ok) return 'put an unlabelled figure on the board';
      if (!r.missing.some((m) => /night or a week/.test(m))) return `skipped, but for the wrong reason: ${r.missing.join(', ')}`;
      return null;
    },
  },
  {
    // A brand word in a header or footer must not name the week.
    name: 'a brand in the page furniture does not file the week at that brand',
    text: `Interval International
Getaways
Some Resort Nobody Stocks
Oranjestad , ARUBA - XYZ
Sep 20 2026 - Sep 27 2026
US$700.00 Total
Marriott Vacation Club is a registered trademark`,
    check: (rows) => {
      const r = rows[0];
      if (!r) return 'nothing read';
      if (r.stay) return `filed at ${r.stay.name} on a brand word in the page furniture`;
      return null;
    },
  },
  {
    name: 'no row ever carries a night count of zero or less',
    text: REAL_PAGE,
    check: (rows) => {
      const bad = rows.filter((r) => r.nights !== null && r.nights <= 0);
      return bad.length ? `${bad.length} row(s) with a non-positive night count` : null;
    },
  },
];

const show = (rows) => rows.map((r) => [
  r.ok ? 'ok ' : 'no ',
  (r.stay?.name ?? '(not one of ours)').padEnd(36),
  `${r.from}..${r.to}`.padEnd(24),
  `$${r.usdTotal}`.padEnd(11),
  `${r.nights}n`.padEnd(5),
  r.usdNightly ? `$${r.usdNightly}/night` : '',
  r.priceGuessed ? ' PRICE UNLABELLED' : '',
  r.missing.length ? ` missing: ${r.missing.join(', ')}` : '',
].join(' ')).join('\n');

const file = process.argv[2];
if (file) {
  const rows = parseListings(readFileSync(file, 'utf8'), { stays: STAYS });
  console.log(`${rows.length} row${rows.length === 1 ? '' : 's'} read from ${file}\n`);
  console.log(rows.length ? show(rows) : '  nothing on that page read as a week');
  console.log('\nCompare each line against the page it came from. A row that is merely MISSING '
    + 'something is cheap;\na row with a confident WRONG price or the wrong resort is the one to fix first.');
  process.exit(0);
}

let failed = 0;
for (const c of CASES) {
  let why = null;
  try {
    why = c.check(parseListings(c.text, { stays: STAYS }));
  } catch (err) {
    why = `threw: ${err.message}`;
  }
  if (why) failed++;
  console.log(`${why ? 'FAIL' : 'ok  '}  ${c.name}${why ? `\n      ${why}` : ''}`);
}
console.log(failed
  ? `\n${failed} of ${CASES.length} failed. Fix before deploying — each of these was a real defect once.`
  : `\nall ${CASES.length} pass. Remember the edge function carries its OWN copy of this parser: `
    + `apply the same change there,\nand dry-run the live endpoint before deploying.`);
process.exit(failed ? 1 : 0);
