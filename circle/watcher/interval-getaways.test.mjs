// The Getaways parser, on trial against a real saved search.
//
// The fixture is one genuine Aruba result page, kept so this can be checked without signing in.
// Interval's sign-in is slow and watched; a parser that needs an account to test is a parser
// nobody tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGetaways, cheapestPerResort, isoDate } from './interval-getaways.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'fixtures-interval-aruba.html'), 'utf8');
const weeks = parseGetaways(html);

test('finds the weeks that are really on the page', () => {
  assert.ok(weeks.length >= 20, `expected a full page of weeks, got ${weeks.length}`);
});

test('every week is tied to a resort code', () => {
  for (const w of weeks) assert.match(w.code, /^[A-Z0-9]{2,6}$/, `bad code on ${JSON.stringify(w)}`);
  // This search was Aruba; these are the resorts it covered.
  const codes = new Set(weeks.map((w) => w.code));
  for (const expected of ['CPV', 'AWA', 'LC2']) assert.ok(codes.has(expected), `missing ${expected}`);
});

test('a price is never shown without the resort it belongs to', () => {
  // Not merely "has text": the first version of this passed while showing "Previous Image" as
  // the resort for eight of ten, because a carousel button is also labelled. A name has to look
  // like a place, and must not be a piece of the page's furniture.
  const chrome = /^(previous|next)\b|image$|^play video|^close$|^open$/i;
  for (const w of weeks) {
    assert.ok(w.resort && w.resort.length > 4, `nameless week: ${JSON.stringify(w)}`);
    assert.ok(!chrome.test(w.resort), `that is a button, not a resort: "${w.resort}"`);
    assert.match(w.resort, /^[A-Z]/, `resort name looks wrong: "${w.resort}"`);
  }
});

test('every resort code maps to exactly one name', () => {
  const byCode = new Map();
  for (const w of weeks) {
    if (byCode.has(w.code)) assert.equal(w.resort, byCode.get(w.code), `${w.code} has two names`);
    else byCode.set(w.code, w.resort);
  }
  assert.equal(new Set(byCode.values()).size, byCode.size, 'two resorts share one name');
});

test('prices are real money, not text', () => {
  for (const w of weeks) {
    assert.equal(typeof w.week, 'number');
    assert.ok(w.week > 50 && w.week < 100000, `implausible week price ${w.week}`);
  }
});

test('dates are sortable and a week is about a week', () => {
  for (const w of weeks) {
    assert.match(w.from, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(w.to, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(w.to > w.from, `${w.from} is not before ${w.to}`);
    assert.ok(w.nights >= 3 && w.nights <= 14, `${w.nights} nights is not a week`);
  }
});

test('cheapest first, which is the whole point', () => {
  for (let i = 1; i < weeks.length; i++) {
    assert.ok(weeks[i].week >= weeks[i - 1].week,
      `out of order: ${weeks[i - 1].week} then ${weeks[i].week}`);
  }
});

test('the same week is not listed twice', () => {
  const keys = weeks.map((w) => `${w.code}|${w.from}|${w.week}|${w.allInclusive}`);
  assert.equal(new Set(keys).size, keys.length, 'a duplicate week got through');
});

test('all-inclusive is read per week, not assumed for the resort', () => {
  assert.ok(weeks.every((w) => typeof w.allInclusive === 'boolean'));
});

test('one line per resort for a short board', () => {
  const best = cheapestPerResort(weeks);
  assert.equal(new Set(best.map((b) => b.code)).size, best.length, 'a resort appeared twice');
  for (const b of best) {
    const cheapest = Math.min(...weeks.filter((w) => w.code === b.code).map((w) => w.week));
    assert.equal(b.week, cheapest, `${b.code} is not showing its cheapest week`);
  }
});

test('month names become dates that sort', () => {
  assert.equal(isoDate('Oct 31 2026'), '2026-10-31');
  assert.equal(isoDate('Nov 7 2026'), '2026-11-07');
  assert.equal(isoDate('not a date'), null);
});

test('an empty or broken page yields nothing rather than throwing', () => {
  assert.deepEqual(parseGetaways(''), []);
  assert.deepEqual(parseGetaways('<html><body>signed out</body></html>'), []);
  assert.deepEqual(parseGetaways(null), []);
});
