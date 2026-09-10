import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffMinutes, refused, accepted, due, DAY_MIN } from './pace.mjs';

test('no refusals means no wait; each refusal doubles it, from two passes up to a day', () => {
  assert.equal(backoffMinutes(0, 30), 0);
  assert.equal(backoffMinutes(1, 30), 60);
  assert.equal(backoffMinutes(2, 30), 120);
  assert.equal(backoffMinutes(3, 30), 240);
  assert.equal(backoffMinutes(5, 30), 960);
  assert.equal(backoffMinutes(6, 30), DAY_MIN);
  assert.equal(backoffMinutes(40, 30), DAY_MIN);   // 2**40 minutes is not a schedule
});

test('the cap is a setting, and a pass longer than the cap is still one pass', () => {
  assert.equal(backoffMinutes(9, 30, { maxMin: 360 }), 360);
  assert.equal(backoffMinutes(3, 720, { maxMin: 360 }), 720);
});

test('junk counts as zero rather than as a crash', () => {
  assert.equal(backoffMinutes('x', 30), 0);
  assert.equal(backoffMinutes(-4, 30), 0);
  assert.equal(backoffMinutes(2, 'x'), 4);
});

test('refusals accumulate, and the next try is set from now', () => {
  const t0 = Date.parse('2026-09-08T22:00:00Z');
  const one = refused(accepted(), { everyMin: 30, now: t0, said: 'Sign In' });
  assert.equal(one.refusals, 1);
  assert.equal(one.nextTryAt, '2026-09-08T23:00:00.000Z');
  assert.equal(one.lastSaid, 'Sign In');
  const two = refused(one, { everyMin: 30, now: t0 + 60 * 60_000 });
  assert.equal(two.refusals, 2);
  assert.equal(two.nextTryAt, '2026-09-09T01:00:00.000Z');
  assert.equal(due(two, t0 + 60 * 60_000), false);
  assert.equal(due(two, Date.parse('2026-09-09T01:00:00Z')), true);
});

test('a sign-in that works puts the pace back to every pass', () => {
  assert.equal(due(accepted()), true);
  assert.equal(due(null), true);
  assert.equal(due({ nextTryAt: 'not a date' }), true);
});

test('what was said is kept short — it goes in a log line, not a file of pages', () => {
  const r = refused(accepted(), { everyMin: 30, now: 0, said: 'x'.repeat(1000) });
  assert.equal(r.lastSaid.length, 200);
});
