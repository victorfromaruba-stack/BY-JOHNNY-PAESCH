import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judgeListing } from './scout-judge.mjs';
import { supersOf, pushSupers, superMessage, intervalSupers, DAILY_CAP } from './scout-super.mjs';

const BEACH = 'b1';
const catalog = new Map([[BEACH, { id: BEACH, name: 'Test Beach Resort', rate_low_usd: 300, rate_high_usd: 310, rate_peak_usd: 400, retail_usd: 400 }]]);
const rooms = new Map([[BEACH, [{ bedrooms: 1, rate_factor: 1 }]]]);     // 1BR, 7 low nights: public 2,709.68, the Circle's own 2,100
const NOW = Date.parse('2026-10-23T14:00:00Z');
const J = (total, o = {}) => judgeListing({ externalId: `VK${total}`, resortName: 'Test Beach Resort', unitType: '1 Bedroom', from: '2026-11-14', to: '2026-11-21', nights: 7, usdTotal: total, bookingUrl: 'https://v.test/1', ...o }, { catalog, cfg: { rooms }, now: NOW });
const item = (j, o = {}) => ({ src: 'vakaymood', cls: j.cls, pct: j.pct, super: j.super, find: j.find, url: j.find.url, onBoard: true, last: NOW - 3600e3, ...o });
const pusher = (quiet = false) => { const sent = []; return { sent, quiet: () => quiet, send: async (m) => { sent.push(m); return { ok: true }; } }; };
const file = () => join(mkdtempSync(join(tmpdir(), 'super-')), 's.json');

test('tier boundaries: 40% under the like-for-like public rate, and never dearer than the Circle\'s own price', () => {
  assert.equal(J(1620).super, true);              // 40.2% under 2,709.68
  assert.equal(J(1640).super, false);             // 39.5%
  assert.equal(J(1640).cls, 'great');             // still great
  assert.equal(J(2000).cls, 'great'); assert.equal(J(2000).super, false);
  assert.equal(J(2150).super, false);             // dearer than the Circle's own 2,100: not even good
  assert.equal(J(2150).cls, 'drop');
});

test('only fresh, linked, ahead-of-us, on-the-board supers may push', () => {
  const s = item(J(1500));
  assert.equal(supersOf([s], NOW).length, 1);
  assert.equal(supersOf([{ ...s, last: NOW - 25 * 3600e3 }], NOW).length, 0);          // older than 24 h
  assert.equal(supersOf([{ ...s, url: 'http://x.test' }], NOW).length, 0);              // not a working https link
  assert.equal(supersOf([{ ...s, url: '', find: { ...s.find, url: '' } }], NOW).length, 0);
  assert.equal(supersOf([{ ...s, onBoard: false }], NOW).length, 0);
  assert.equal(supersOf([item(J(1640))], NOW).length, 0);                                // great, not super
});

test('message: title, per night, total vs public, source, link', () => {
  const m = superMessage(item(J(1500)), NOW);
  assert.equal(m.title, 'Super deal: Test Beach Resort, Nov 14 to Nov 21');
  for (const re of [/\$214 a night/, /\$1,500 total/, /\$2,710 at the public rate/, /45% under/, /VakayMood/, /https:\/\/v\.test\/1/]) assert.match(m.body, re);
});

test('one per resort and dates ever; three a day; a new day lifts the cap but not the repeat', async () => {
  const f = file(), p = pusher();
  const mk = (from, id) => item(J(1500, { from, to: new Date(Date.parse(`${from}T12:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10), externalId: id }));
  const a = mk('2026-11-14', 'A');
  assert.deepEqual(await pushSupers({ items: [a], pusher: p, file: f, now: NOW }), { sent: 1, held: 0, skipped: 0 });
  const again = item(J(1400, { externalId: 'OTHER-LISTING-SAME-WEEK' }));
  assert.equal((await pushSupers({ items: [a, again], pusher: p, file: f, now: NOW + 3600e3 })).skipped, 2);   // same resort + dates, even as another listing
  assert.equal(p.sent.length, 1);
  const more = ['2026-11-21', '2026-11-28', '2026-12-05'].map((d, n) => mk(d, `B${n}`));
  const r = await pushSupers({ items: more, pusher: p, file: f, now: NOW + 7200e3 });
  assert.equal(r.sent, DAILY_CAP - 1); assert.equal(r.skipped, 1); assert.equal(p.sent.length, DAILY_CAP);
  const tomorrow = await pushSupers({ items: [more[2], mk('2026-12-12', 'C')], pusher: p, file: f, now: NOW + 24 * 3600e3 });
  assert.equal(tomorrow.sent, 2); assert.equal(p.sent.length, DAILY_CAP + 2);       // the held-back one is not "sent ever", so it may go
});

test('quiet hours hold the push until seven, unless the source says it ends sooner', async () => {
  const f = file(), p = pusher(true), a = item(J(1500)), b = item(J(1500, { from: '2026-11-21', to: '2026-11-28' }), { find: { ...J(1500, { from: '2026-11-21', to: '2026-11-28' }).find, endsBy: new Date(NOW + 3 * 3600e3).toISOString() } });
  const r = await pushSupers({ items: [a, b], pusher: p, file: f, now: NOW });
  assert.deepEqual(r, { sent: 1, held: 1, skipped: 0 });                           // b ends in 3 h: goes now; a waits
  assert.equal(p.sent.length, 1); assert.match(p.sent[0].title, /Nov 21/);
  const morning = pusher(false);
  await pushSupers({ items: [], pusher: morning, file: f, now: NOW + 9 * 3600e3 });
  assert.equal(morning.sent.length, 1); assert.match(morning.sent[0].title, /Nov 14/);
});

test('a member-tap Interval row counts only when it says the room size', () => {
  const row = { source: 'interval', stayId: BEACH, bedrooms: 1, from: '2026-11-14', to: '2026-11-21', nights: 7, usdTotal: 1500, url: 'https://vip.intervalworld.com/x' };
  assert.equal(intervalSupers([row], catalog, rooms, NOW).length, 1);
  assert.equal(intervalSupers([{ ...row, bedrooms: undefined }], catalog, rooms, NOW).length, 0);
  assert.equal(intervalSupers([{ ...row, usdTotal: 1800 }], catalog, rooms, NOW).length, 0);
});
