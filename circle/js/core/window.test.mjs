// The dates a member is looking for: the chips, the clamp, the overlap test and what a device remembers.
//
// Pure, no clock but the one each test passes in, no network.
//
//   node --test circle/js/core/window.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHIPS, DEFAULT_DAYS, MAX_DAYS, addDays, chipWindow, chipFor, clampWindow, defaultWindow, overlaps, windowWords, loadWindow, saveWindow } from './window.js';

const TODAY = '2026-10-22';

test('with nothing chosen the window is today to two months out', () => {
  assert.equal(DEFAULT_DAYS, 60);
  assert.deepEqual(defaultWindow(TODAY), { from: '2026-10-22', to: '2026-12-21' });
});

test('the four chips, from a Thursday in October', () => {
  assert.deepEqual(CHIPS.map((c) => c.id), ['2w', 'month', '2m', 'xmas']);
  assert.deepEqual(chipWindow('2w', TODAY), { from: '2026-10-22', to: '2026-11-05' });
  assert.deepEqual(chipWindow('month', TODAY), { from: '2026-10-22', to: '2026-11-21' });
  assert.deepEqual(chipWindow('2m', TODAY), { from: '2026-10-22', to: '2026-12-21' });
  assert.deepEqual(chipWindow('xmas', TODAY), { from: '2026-12-20', to: '2027-01-03' });
  assert.equal(chipWindow('nonsense', TODAY), null);
});

test('Christmas is the one coming, or the one that is on now', () => {
  assert.deepEqual(chipWindow('xmas', '2026-01-02'), { from: '2026-01-02', to: '2026-01-03' }, 'on 2 Jan the 2025 Christmas is nearly over: today to the 3rd');
  assert.deepEqual(chipWindow('xmas', '2026-01-04'), { from: '2026-12-20', to: '2027-01-03' }, 'from the 4th it is the coming one');
  assert.deepEqual(chipWindow('xmas', '2026-12-24'), { from: '2026-12-24', to: '2027-01-03' }, 'in the middle of it: from today, never from a day that has gone');
  assert.deepEqual(chipWindow('xmas', '2026-12-20'), { from: '2026-12-20', to: '2027-01-03' });
});

test('a chip is shown pressed only when the dates are exactly its dates', () => {
  assert.equal(chipFor({ from: '2026-10-22', to: '2026-11-21' }, TODAY), 'month');
  assert.equal(chipFor({ from: '2026-10-22', to: '2026-11-22' }, TODAY), null);
});

test('a window is clamped: the past moves to today, backwards is nothing, a year is the most', () => {
  assert.deepEqual(clampWindow({ from: '2026-10-01', to: '2026-11-10' }, TODAY), { from: '2026-10-22', to: '2026-11-10' });
  assert.equal(clampWindow({ from: '2026-10-01', to: '2026-10-21' }, TODAY), null, 'all of it is over');
  assert.equal(clampWindow({ from: '2026-12-10', to: '2026-12-01' }, TODAY), null, 'to before from');
  assert.equal(clampWindow({ from: '', to: '2026-12-01' }, TODAY), null);
  assert.equal(clampWindow({ from: 'soon', to: '2026-12-01' }, TODAY), null);
  assert.equal(clampWindow(null, TODAY), null);
  const long = clampWindow({ from: '2026-10-22', to: '2030-01-01' }, TODAY);
  assert.equal(long.to, addDays('2026-10-22', MAX_DAYS));
  assert.equal(MAX_DAYS, 366);
});

// A week's nights are [from, to): the window [24 Nov, 30 Nov] ...
const win = { from: '2026-11-24', to: '2026-11-30' };
test('weeks overlapping the window are in; weeks that merely touch it from outside are not', () => {
  assert.equal(overlaps({ from: '2026-11-21', to: '2026-11-28' }, win), true, 'starts before, ends inside');
  assert.equal(overlaps({ from: '2026-11-26', to: '2026-12-03' }, win), true, 'starts inside, ends after');
  assert.equal(overlaps({ from: '2026-11-25', to: '2026-11-27' }, win), true, 'wholly inside');
  assert.equal(overlaps({ from: '2026-11-20', to: '2026-12-10' }, win), true, 'wholly around it');
  assert.equal(overlaps({ from: '2026-11-30', to: '2026-12-07' }, win), true, 'checks in on the last day: that night is in the window');
  assert.equal(overlaps({ from: '2026-11-17', to: '2026-11-24' }, win), false, 'checks out on the first day: no night of it is in the window');
  assert.equal(overlaps({ from: '2026-12-01', to: '2026-12-08' }, win), false, 'starts the day after');
  assert.equal(overlaps({ from: '2026-10-30', to: '2026-11-06' }, win), false, 'a week earlier');
});

test('a row whose dates were not read is kept, and no window keeps everything', () => {
  assert.equal(overlaps({ from: null, to: null }, win), true);
  assert.equal(overlaps({ from: '2026-01-01', to: '2026-01-08' }, null), true);
});

test('the list: five weeks, and each window shows only the weeks that overlap it', () => {
  const weeks = [['2026-10-24', '2026-10-31'], ['2026-11-07', '2026-11-14'], ['2026-11-21', '2026-11-28'], ['2026-12-05', '2026-12-12'], ['2027-01-09', '2027-01-16']]
    .map(([from, to]) => ({ from, to }));
  const seen = (w) => weeks.filter((d) => overlaps(d, w)).map((d) => d.from);
  assert.deepEqual(seen(chipWindow('2w', TODAY)), ['2026-10-24'], 'the next fortnight ends 5 Nov: the week of the 7th is not in it');
  assert.deepEqual(seen({ from: '2026-12-01', to: '2026-12-31' }), ['2026-12-05']);
  assert.deepEqual(seen(chipWindow('2m', TODAY)), ['2026-10-24', '2026-11-07', '2026-11-21', '2026-12-05'], 'two months: everything up to 21 Dec');
});

test('the window is said in words, the year only when it is not this one', () => {
  assert.equal(windowWords({ from: '2026-10-22', to: '2026-12-21' }, TODAY), '22 Oct – 21 Dec');
  assert.equal(windowWords({ from: '2026-12-20', to: '2027-01-03' }, TODAY), '20 Dec 2026 – 3 Jan 2027');
});

// ---------------------------------------------------------------- remembered per device
const memory = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, raw: m }; };

test('a device with nothing saved opens on the default; a chip is remembered as the chip', () => {
  const s = memory();
  assert.deepEqual(loadWindow(s, TODAY), { from: '2026-10-22', to: '2026-12-21', chip: '2m' });
  saveWindow({ ...chipWindow('month', TODAY), chip: 'month' }, s);
  assert.equal(s.raw['circle.looking'], '{"chip":"month"}');
  assert.deepEqual(loadWindow(s, TODAY), { from: '2026-10-22', to: '2026-11-21', chip: 'month' });
  assert.deepEqual(loadWindow(s, '2026-10-30'), { from: '2026-10-30', to: '2026-11-29', chip: 'month' }, 'next week it is still "next month", not last week\'s dates');
});

test('dates chosen by hand are remembered as dates, and dropped once they are over', () => {
  const s = memory();
  saveWindow({ from: '2026-11-24', to: '2026-12-08', chip: null }, s);
  assert.equal(s.raw['circle.looking'], '{"from":"2026-11-24","to":"2026-12-08"}');
  assert.deepEqual(loadWindow(s, TODAY), { from: '2026-11-24', to: '2026-12-08', chip: null });
  assert.deepEqual(loadWindow(s, '2026-12-09'), { from: '2026-12-09', to: '2027-02-07', chip: '2m' }, 'over: back to the default');
});

test('a saved value that is not a window, or storage that throws, is the default and never an error', () => {
  assert.equal(loadWindow(memory({ 'circle.looking': '{not json' }), TODAY).chip, '2m');
  assert.equal(loadWindow(memory({ 'circle.looking': '{"chip":"fortnight"}' }), TODAY).chip, '2m');
  assert.equal(loadWindow(memory({ 'circle.looking': '{"from":"x","to":"y"}' }), TODAY).chip, '2m');
  const hostile = { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('private mode'); } };
  assert.equal(loadWindow(hostile, TODAY).chip, '2m');
  assert.doesNotThrow(() => saveWindow({ from: TODAY, to: '2026-12-21', chip: '2m' }, hostile));
  assert.equal(loadWindow(null, TODAY).chip, '2m', 'no storage at all');
});
