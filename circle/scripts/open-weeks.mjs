#!/usr/bin/env node
// The Circle's own copy of what is open on VakayMood.
//
// A member's phone in Aruba could not reach vakaymood.com at all — every call from Safari on
// mobile data failed, twice — and a Deals page that depends on a third party answering every
// phone is a Deals page that is sometimes empty. So GitHub fetches the listings on a schedule
// (.github/workflows/open-weeks.yml, every half hour) and publishes them with the site as
// data/open-weeks.json. The page asks VakayMood live first, and falls back to this copy — from
// its own address, which a phone can always reach — saying plainly when the copy was taken.
//
// Only the five resorts the catalog carries, only the cheapest sixty at each, only the fields
// the cards read. Raw listing objects, so the same toDeal() prices them on the way in.
//
//   node circle/scripts/open-weeks.mjs            writes circle/data/open-weeks.json
//   node circle/scripts/open-weeks.mjs --stdout   prints it instead

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESORTS } from '../js/data/vakaymood.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://vakaymood.com/api/v1';
const PER_RESORT = 60;
const KEEP = ['listingId', 'unitType', 'sleeps', 'bedrooms', 'checkin', 'checkout', 'nights', 'flexibleDates', 'lastBookableCheckin', 'pricing', 'bookingUrl'];

async function page(slug) {
  const url = `${BASE}/availability?resort=${encodeURIComponent(slug)}&sort=price_asc&limit=${PER_RESORT}`;
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'HuntoCircle/1.0 (+https://victorfromaruba-stack.github.io/BY-JOHNNY-PAESCH/) open-weeks' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${slug}`);
  const body = await res.json();
  return {
    total: body.pagination?.total ?? 0,
    generatedAt: body.generatedAt || null,
    listings: (body.results || []).map(l => ({ ...Object.fromEntries(KEEP.map(k => [k, l[k]])), resort: { name: l.resort?.name, slug: l.resort?.slug } })),
  };
}

const out = { generatedAt: new Date().toISOString(), source: BASE, perResort: PER_RESORT, resorts: {} };
let failed = 0;
for (const r of RESORTS.filter(x => x.stayId)) {
  try {
    out.resorts[r.slug] = await page(r.slug);
    console.error(`${r.name}: ${out.resorts[r.slug].listings.length} of ${out.resorts[r.slug].total}`);
  } catch (err) { failed++; console.error(`${r.name}: ${err.message}`); }
  await new Promise(res => setTimeout(res, 1000));   // 60 a minute is their limit; nobody is in a hurry
}
if (!Object.keys(out.resorts).length) { console.error('nothing fetched — leaving the previous copy in place'); process.exit(1); }
const json = JSON.stringify(out);
if (process.argv.includes('--stdout')) { process.stdout.write(json); }
else {
  const file = join(HERE, '..', 'data', 'open-weeks.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, json);
  console.error(`wrote ${file} (${(json.length / 1024).toFixed(0)} KB, ${failed ? `${failed} resort(s) failed` : 'all resorts'})`);
}
