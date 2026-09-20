// The RedWeek reader, on trial against the page we saved.
//
// parseRentals turns every RedWeek resort page into the weeks on the board, and until now it was
// the one parser with nothing watching it. Its own comments record what that cost: a 2,500
// character ceiling in the card regex quietly swallowed the two longest cards on the page, so ten
// of fifty-four bookable weeks never reached a member, and nothing said a word. The fixture beside
// this file was saved for exactly that — two oversized cards among seven ordinary ones — and it was
// referenced by nothing. This is the file that reads it.
//
// No network. `node --test redweek.test.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRentals, ARUBA } from './redweek.mjs';

const SLUG = 'P4872-marriotts-aruba-surf-club';
const HTML = readFileSync(new URL('./fixtures-redweek-surfclub.html', import.meta.url), 'utf8');
const rows = parseRentals(HTML, { slug: SLUG, ourName: ARUBA[SLUG] });
const by = (id) => rows.find(r => r.externalId === id);

// What the saved page prints on each card, copied off the HTML by hand: the posting id, the dates,
// the nights and sleeps, the all-in total in the "$… total" line, and the site's own per-night
// figure. The nightly the reader reports is the total spread across the nights, which is what a
// member pays; it is written out here rather than computed, so a change to that arithmetic is
// something a person has to agree to rather than something the test quietly follows.
const EXPECTED = [
  { id: 'R1503417', from: '2026-09-26', to: '2026-10-03', nights: 7, bedrooms: 2, bathrooms: 2, sleeps: 8, view: 'Oceanside',  unit: '2 Bedroom Villa, Oceanside',  total: 2696, perNight: 350,    nightly: 385.14,  taken: false, protected: true },
  { id: 'R1499724', from: '2026-09-18', to: '2026-09-25', nights: 7, bedrooms: 2, bathrooms: 2, sleeps: 8, view: 'Varies',     unit: '2 Bedroom Villa',             total: 1894, perNight: 245,    nightly: 270.57,  taken: false, protected: true },
  { id: 'R1498532', from: '2026-09-11', to: '2026-09-18', nights: 7, bedrooms: 3, bathrooms: 3, sleeps: 12, view: 'Ocean view', unit: '3 Bedroom Villa, Ocean view', total: 4031, perNight: 525,    nightly: 575.86,  taken: false, protected: true },
  { id: 'R1493294', from: '2026-09-13', to: '2026-09-20', nights: 7, bedrooms: 0, bathrooms: 1, sleeps: 4, view: 'Oceanside',  unit: 'Studio Queen, Oceanside',     total: 1542, perNight: 199,    nightly: 220.29,  taken: false, protected: true },
  { id: 'R1520876', from: '2026-09-15', to: '2026-09-20', nights: 5, bedrooms: 0, bathrooms: 1, sleeps: 4, view: 'Oceanside',  unit: 'Studio Queen, Oceanside',     total: 1248, perNight: 225,    nightly: 249.6,   taken: false, protected: true },
  { id: 'R1468839', from: '2026-09-17', to: '2026-09-24', nights: 7, bedrooms: 2, bathrooms: 2, sleeps: 8, view: 'Ocean view', unit: '2 Bedroom Villa, Ocean view', total: 4903, perNight: 639.29, nightly: 700.43,  taken: false, protected: true },
  { id: 'R1471181', from: '2026-09-17', to: '2026-09-24', nights: 7, bedrooms: 2, bathrooms: 2, sleeps: 8, view: 'Garden',     unit: '2 Bedroom Villa, Garden',     total: 9616, perNight: 1257,   nightly: 1373.71, taken: false, protected: true },
  { id: 'R1460375', from: '2026-09-17', to: '2026-09-24', nights: 7, bedrooms: 2, bathrooms: 2, sleeps: 8, view: 'Varies',     unit: '2 Bedroom Villa',             total: 3840, perNight: 500,    nightly: 548.57,  taken: false, protected: true },
  { id: 'R1514382', from: '2026-09-10', to: '2026-09-17', nights: 7, bedrooms: 1, bathrooms: 1, sleeps: 4, view: 'Varies',     unit: '1 Bedroom Villa',             total: 2085, perNight: 270,    nightly: 297.86,  taken: true,  protected: false },
];

test('every card on the saved page comes back, in the order the page lists them', () => {
  // Counted off the HTML rather than written down, so the test cannot drift from the fixture.
  const cards = (HTML.match(/<div class="[^"]*posting-card/g) || []).length;
  assert.equal(cards, 9);
  assert.equal(rows.length, cards);
  assert.deepEqual(rows.map(r => r.externalId), EXPECTED.map(e => e.id));
});

test('the two cards that ran past the old ceiling are still long, and still read', () => {
  // The guard only guards while the fixture still holds a card longer than the ceiling that broke.
  // Measure the cards the way the page lays them out — one card opening to the next.
  const starts = [...HTML.matchAll(/<div class="[^"]*posting-card/g)].map(m => m.index);
  const lengths = starts.map((s, i) => (i + 1 < starts.length ? starts[i + 1] : HTML.length) - s);
  const oversized = lengths.filter(n => n > 2500);
  assert.equal(oversized.length, 2, 'the fixture must keep two cards past the 2,500 mark');
  assert.ok(Math.min(...oversized) > 5000, 'and they should be the 5kB kind that broke it');
  // Those two are the first two cards; if a ceiling comes back they are what disappears.
  assert.ok(by('R1503417'), 'the longest card must still be read');
  assert.ok(by('R1499724'), 'the second longest card must still be read');
});

test('each card carries the figures the page prints on it', () => {
  for (const want of EXPECTED) {
    const got = by(want.id);
    assert.ok(got, `${want.id} is missing`);
    assert.equal(got.from, want.from, `${want.id} check-in`);
    assert.equal(got.to, want.to, `${want.id} check-out`);
    assert.equal(got.nights, want.nights, `${want.id} nights`);
    assert.equal(got.bedrooms, want.bedrooms, `${want.id} bedrooms`);
    assert.equal(got.bathrooms, want.bathrooms, `${want.id} bathrooms`);
    assert.equal(got.sleeps, want.sleeps, `${want.id} sleeps`);
    assert.equal(got.view, want.view, `${want.id} view`);
    assert.equal(got.unit, want.unit, `${want.id} unit`);
    assert.equal(got.usdTotal, want.total, `${want.id} all-in total`);
    assert.equal(got.usdBeforeFees, want.perNight, `${want.id} the site's own per-night figure`);
    assert.equal(got.usdNightly, want.nightly, `${want.id} nightly`);
    assert.equal(got.taken, want.taken, `${want.id} taken`);
    assert.equal(got.protected, want.protected, `${want.id} protected`);
    assert.equal(got.source, 'redweek');
    assert.equal(got.slug, SLUG);
    assert.equal(got.ourName, "Marriott's Aruba Surf Club");
  }
});

test('the price recorded is the all-in total, not the subtotal in the data attribute', () => {
  // The card's own data-price on the first listing is 2450; the line it prints reads $2,696 total,
  // because RedWeek's service fee sits between the two. A member pays the second one.
  assert.match(HTML, /data-price="2450"/);
  assert.equal(by('R1503417').usdTotal, 2696);
  assert.equal(by('R1503417').usdNightly, Math.round((2696 / 7) * 100) / 100);
});

test('a rented card is marked taken, and "verified" is not protection', () => {
  const gone = by('R1514382');
  assert.equal(gone.taken, true);
  // The card says posting-verified, which RedWeek only ever puts on a listing that is already
  // gone. Reading that as protection is what once made every bookable week claim it had none.
  assert.match(HTML, /posting-card posting-not-available unavailable posting-verified/);
  assert.equal(gone.protected, false);
  assert.equal(rows.filter(r => r.taken).length, 1);
  assert.equal(rows.filter(r => r.protected).length, 8);
});

test('a card with no link of its own falls back to the id on its button, never to its price', () => {
  const gone = by('R1514382');
  assert.doesNotMatch(HTML.slice(HTML.indexOf('data-check_in="20260910"')), /^[^>]*posting-path/);
  assert.equal(gone.url, `https://www.redweek.com/resort/${SLUG}/timeshare-rentals`);
  // Every other card links to its own posting.
  assert.equal(by('R1503417').url, 'https://www.redweek.com/posting/R1503417');
});

test('the collapsed alternatives inside a card do not become weeks of their own', () => {
  // The two long cards each hide two more postings for the same dates behind "View 2 More". The
  // page carries thirteen posting ids; only the nine cards are weeks. Counting the hidden ones
  // would post the same week three times at three prices.
  const ids = (HTML.match(/listing-action" title="(R\d+)"/g) || []).length;
  assert.equal(ids, 13);
  for (const hidden of ['R1503039', 'R1491258', 'R1514206', 'R1487098']) {
    assert.equal(by(hidden), undefined, `${hidden} is an alternative, not a week`);
  }
});

test('nothing readable means nothing posted, rather than a crash', () => {
  assert.deepEqual(parseRentals('', { slug: SLUG }), []);
  assert.deepEqual(parseRentals('<section class="postings"></section>', { slug: SLUG }), []);
  // A card with no price is a card we cannot quote, so it is skipped rather than posted at zero.
  const noPrice = '<div class="posting-card" data-check_in="20260101" data-check_out="20260108"></div>';
  assert.deepEqual(parseRentals(noPrice, { slug: SLUG }), []);
  // A date that is not eight digits is a page we no longer understand; skip it, do not guess.
  const badDate = '<div class="posting-card" data-price_per_night="200" data-check_in="Jan 1" data-check_out="20260108"></div>';
  assert.deepEqual(parseRentals(badDate, { slug: SLUG }), []);
});

test('the slug we ask for is a resort the catalog knows by name', () => {
  assert.equal(ARUBA[SLUG], "Marriott's Aruba Surf Club");
  assert.equal(rows.every(r => r.ourName === ARUBA[SLUG]), true);
});
