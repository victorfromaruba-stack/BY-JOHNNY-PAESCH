// node --test js/core/airline-links.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airlineLinks, NEVER } from './airline-links.js';

const lim = { origin: 'lim', out: '2026-11-13', back: '2026-11-20', adults: 3, children: 0, infants: 1 };

test('Lima: LATAM, Avianca and Copa, each with both legs on the trip\'s own dates and the lap infant', () => {
  const l = airlineLinks(lim);
  assert.deepEqual(l.map(x => x.airline), ['LATAM', 'Avianca', 'Copa']);
  for (const x of l) {
    assert.ok(x.dated, x.airline);
    assert.ok(x.url.includes('2026-11-13') && x.url.includes('2026-11-20'), `${x.airline}: both legs`);
    assert.ok(/[?&](inf=1|inf1=1|infants=1)/.test(x.url), `${x.airline}: the lap infant`);
    assert.ok(/[?&](adt=3|adt1=3|adults=3)/.test(x.url), `${x.airline}: three adults`);
  }
  assert.ok(l[1].url.includes('inf2=1') && l[1].url.includes('origin2=AUA'), 'Avianca names the way back too');
});

test('an origin with no nonstop gets the connecting carriers\' own sites; nothing is ever an aggregator', () => {
  const l = airlineLinks({ ...lim, origin: 'GRU' });
  assert.deepEqual(l.map(x => x.code), ['CM', 'AV', 'AA']);
  assert.ok(l.every(x => !x.serves_their_airport));
  for (const o of ['MIA', 'JFK', 'YYZ', 'AMS', 'GRU', 'LIM']) for (const x of airlineLinks({ ...lim, origin: o })) assert.ok(!NEVER.test(x.url), x.url);
  assert.ok(NEVER.test('https://www.google.com/travel/flights?q=LIM'));
});

test('no link without an origin, both dates and at least one adult', () => {
  assert.equal(airlineLinks({ ...lim, origin: '' }), null);
  assert.equal(airlineLinks({ ...lim, back: null }), null);
  assert.equal(airlineLinks({ ...lim, adults: 0 }), null);
});
