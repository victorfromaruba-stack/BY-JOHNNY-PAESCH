import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worthPosting, asDeal, resolveStay, capPerResortMonth, dedupeKey, ourPrice, retailPrice } from './judge.mjs';

const SURF = 'a1b2c3d4-0000-4000-8000-000000000001';
const catalog = new Map([[SURF, { id: SURF, name: 'Marriott’s Aruba Surf Club', rate_low_usd: 135, rate_high_usd: 310, rate_peak_usd: 580, retail_usd: 850 }]]);
const noRetail = new Map([[SURF, { id: SURF, name: 'Marriott’s Aruba Surf Club', rate_low_usd: 135, rate_high_usd: 310, rate_peak_usd: 580, retail_usd: null }]]);
const cfg = { minNights: 0, maxNightly: 0, mustBeatOurs: true, beatBy: 0.15, pointsPerUsd: 100 };
// A September week: low band all seven nights, so ours = 7 × 135 = 945 and retail = 7 × 850 = 5,950.
const week = { from: '2026-09-26', to: '2026-10-03', nights: 7 };
const find = (o) => ({ ...week, stayId: SURF, externalId: `x-${Math.random()}`, ...o });

test('pricing helpers', () => {
  assert.equal(ourPrice(catalog.get(SURF), week.from, 7), 945);
  assert.equal(retailPrice(catalog.get(SURF), 7), 5950);
  assert.equal(retailPrice(noRetail.get(SURF), 7), null);
});

test('an Interval week at a catalog stay posts whatever it costs — even above the public rate', () => {
  assert.equal(worthPosting(find({ source: 'interval', usdTotal: 7000, usdNightly: 1000 }), catalog, cfg), true);
});

test('an unpriced Interval week still posts, at our own rate, and the note says so', () => {
  const f = find({ source: 'interval', usdTotal: 0, usdNightly: 0, unitCode: 'MSU' });
  assert.equal(worthPosting(f, catalog, cfg), true);
  const d = asDeal(f, cfg, { pointsPerDollar: 100, serviceRate: 0.15 });
  assert.equal(d.usdTotal, 945);
  assert.match(d.note, /Interval showed no price/);
  assert.equal(d.pointsTotal, Math.round(945 * 100 * 1.15));
});

test('an unpriced Interval week at a stay with no rates cannot post', () => {
  const bare = new Map([[SURF, { id: SURF, name: 'x', retail_usd: 850 }]]);
  assert.equal(worthPosting(find({ source: 'interval', usdTotal: 0 }), bare, cfg), false);
});

test('RedWeek posts only when well under the PUBLIC rate, not our Getaway-anchored one', () => {
  // 20% under retail (5,950 × 0.8 = 4,760) — posts, although it is far above ours (945).
  assert.equal(worthPosting(find({ source: 'redweek', usdTotal: 4760, usdNightly: 680 }), catalog, cfg), true);
  // 10% under — does not.
  assert.equal(worthPosting(find({ source: 'redweek', usdTotal: 5355, usdNightly: 765 }), catalog, cfg), false);
  // No public rate on file — nothing honest to compare with.
  assert.equal(worthPosting(find({ source: 'redweek', usdTotal: 1165, usdNightly: 166 }), noRetail, cfg), false);
  // Filter off — posts regardless.
  assert.equal(worthPosting(find({ source: 'redweek', usdTotal: 5355, usdNightly: 765 }), catalog, { ...cfg, mustBeatOurs: false }), true);
});

test('nothing posts without a catalog stay, whatever the source', () => {
  for (const source of ['interval', 'redweek', 'vakaymood']) {
    assert.equal(worthPosting(find({ source, stayId: null, usdTotal: 100, usdNightly: 15 }), catalog, cfg), false);
  }
  assert.equal(worthPosting(find({ source: 'redweek', taken: true, usdTotal: 100, usdNightly: 15 }), catalog, cfg), false);
});

test('points are all-in: the owner’s ask, times points to the dollar, plus the Circle’s share', () => {
  const d = asDeal(find({ source: 'redweek', usdTotal: 1165, usdNightly: 166.43, unit: 'Studio Queen, Oceanside' }), cfg, { pointsPerDollar: 100, serviceRate: 0.15 });
  assert.equal(d.pointsTotal, Math.round(1165 * 100 * 1.15));
  assert.equal(d.expiresAt, '2026-09-26T12:00:00Z');
  assert.match(d.title, /owner asking \$166 a night on RedWeek/);
  assert.doesNotMatch(d.title, /sav/i);
});

test('retail_usd on the posted deal is the public rate for those nights, so "under the public rate" is true', () => {
  const f = find({ source: 'redweek', usdTotal: 1165, usdNightly: 166.43 });
  worthPosting(f, catalog, cfg);
  assert.equal(asDeal(f, cfg, {}).retailUsd, 5950);
});

test('the cap keeps the cheapest three owner weeks per resort per month and never caps Interval', () => {
  const rw = [1, 2, 3, 4, 5].map(n => find({ source: 'redweek', usdNightly: 100 * n, usdTotal: 700 * n }));
  const iv = [1, 2, 3, 4].map(n => find({ source: 'interval', usdNightly: 50 * n, usdTotal: 350 * n }));
  const other = find({ source: 'redweek', from: '2026-11-07', to: '2026-11-14', usdNightly: 900, usdTotal: 6300 });
  const kept = capPerResortMonth([...rw, ...iv, other], 3);
  assert.equal(kept.filter(f => f.source === 'interval').length, 4);
  const sept = kept.filter(f => f.source === 'redweek' && f.from.startsWith('2026-09'));
  assert.deepEqual(sept.map(f => f.usdNightly), [100, 200, 300]);
  assert.equal(kept.includes(other), true);
});

test('a find is placed in the catalog by name however the site spells it', () => {
  assert.equal(resolveStay({ ourName: "Marriott's Aruba Surf Club" }, catalog), SURF);
  assert.equal(resolveStay({ resortName: 'Aruba Surf Club' }, catalog), SURF);
  assert.equal(resolveStay({ resortName: 'Aruba' }, catalog), null);
  assert.equal(resolveStay({ resortName: 'Surf' }, catalog), null);
  assert.equal(resolveStay({ resortName: 'Surf Club', text: 'Marriott\'s Aruba Surf Club Palm Beach · ARUBA · DCB MSU' }, catalog), SURF);
  assert.equal(resolveStay({ ourName: 'Eagle Aruba Resort & Casino' }, new Map([['e', { id: 'e', name: 'Eagle Aruba Resort' }]])), 'e');
  assert.equal(resolveStay({ stayId: 'kept' }, catalog), 'kept');
});

test('the same week from two sources is one week', () => {
  const a = { stayId: SURF, from: week.from, to: week.to, unit: 'Studio Queen, Oceanside' };
  const b = { stayId: SURF, from: week.from, to: week.to, unit: 'studio queen oceanside' };
  assert.equal(dedupeKey(a), dedupeKey(b));
});
