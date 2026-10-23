// No network: every fetch, VakayMood call and SMTP connection here is a stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from './scout-feeds.mjs';
import { statedDates, statedPrice, judgeItem, judgeListing } from './scout-judge.mjs';
import { sendMail, assertRecipient, digestMail, instantMail, VICTOR } from './scout-mail.mjs';
import { collect, readFeed, emptyState, stopSource, stopped, scores, isoWeek, forDigest, instants, tipText, sendTips } from './scout.mjs';
import { ATOM, RSS, REDDIT, CHALLENGE } from './fixtures-scout-feeds.mjs';

const SURF = 'a1b2c3d4-0000-4000-8000-000000000001';
const catalog = new Map([[SURF, { id: SURF, name: 'Marriott’s Aruba Surf Club', rate_low_usd: 135, rate_high_usd: 310, rate_peak_usd: 580, retail_usd: 850 }]]);
const BEACH = 'a1b2c3d4-0000-4000-8000-000000000002';
catalog.set(BEACH, { id: BEACH, name: 'Test Beach Resort', rate_low_usd: 300, rate_high_usd: 310, rate_peak_usd: 400, retail_usd: 400 });
// Like for like: low-season studio at the Surf Club, 7 nights = public 850 x 135/310 x 7 = 2,591, the Circle's own 945. Beach 1BR: public 2,710, ours 2,100.
const rooms = new Map([[SURF, [{ bedrooms: 0, rate_factor: 1 }, { bedrooms: 0, rate_factor: 1.5 }]], [BEACH, [{ bedrooms: 1, rate_factor: 1 }]]]);
const cfg = { rooms };
const NOW = Date.parse('2026-10-23T14:00:00Z');
const item = (title, summary = '') => ({ id: title, title, summary, link: 'https://x.test/1' });
const judge = (t, s) => judgeItem(item(t, s), { catalog, cfg, now: NOW, source: 'travelzoo' });

test('feeds parse: Atom, RSS and Reddit, entities and emoji intact', () => {
  const a = parseFeed(ATOM); assert.equal(a.length, 2);
  assert.equal(a[0].title, '$719 & up -- Punta Cana: 4-night all-inclusive stay w/air');
  assert.equal(a[0].link, 'https://www.travelzoo.com/direct/vacations/caribbean/-719-up-Punta-Cana-3292335/');
  assert.equal(a[0].published, '2026-10-23T14:01:00.000Z');
  const r = parseFeed(RSS); assert.equal(r[0].id, 'https://www.holidaypirates.com/hotels/nantwich'); assert.match(r[0].summary, /£199/);
  const d = parseFeed(REDDIT); assert.equal(d[0].link, 'https://www.reddit.com/r/Aruba/comments/abc/cheap_week/'); assert.equal(d[0].summary, 'Anyone want a cheap week?');
  assert.deepEqual(parseFeed('<html>not a feed</html>'), []);
});

test('dates and prices are read only as the text states them', () => {
  assert.deepEqual(statedDates('Nov 14-21', NOW), { from: '2026-11-14', to: '2026-11-21', nights: 7 });
  assert.deepEqual(statedDates('Dec 28 - Jan 4', NOW), { from: '2026-12-28', to: '2027-01-04', nights: 7 });
  assert.equal(statedDates('Sept 1-8', NOW).from, '2027-09-01');       // already past this year: the next one
  assert.equal(statedDates('valid through March', NOW), null);
  assert.equal(statedDates('Nov 1-30', NOW), null);                    // 16 nights is not a stay we compare
  assert.equal(statedPrice('$1,299 per person').perPerson, true);
  assert.equal(statedPrice('only £199 a night').usd, false);
  assert.equal(statedPrice('from $129 a night').perNight, true);
  assert.equal(statedPrice('free upgrade'), null);
});

test('judge classes: great, good, tip, drop, reject', () => {
  const great = judge('Aruba: Marriott’s Aruba Surf Club studio, Nov 14-21, $800 total', 'Hotel only.');
  assert.equal(great.cls, 'great'); assert.equal(great.find.usdTotal, 800); assert.equal(great.find.retailPrice, 2591.13); assert.equal(great.find.ourPrice, 945); assert.equal(great.find.stayId, SURF);
  assert.equal(judge('Aruba: Test Beach Resort 1 bedroom, Nov 14-21, $2,065 total').cls, 'good');       // 24% under 2,710 and under the Circle's 2,100
  assert.equal(judge('Aruba: Test Beach Resort 1 bedroom, Nov 14-21, $2,300 total').cls, 'drop');       // 15% under public but dearer than the Circle's own
  assert.equal(judge("Marriott's Aruba Surf Club studio, Nov 14-21, $1,200 total").cls, 'drop');  // 54% under public, but the Circle's own is $945
  assert.equal(judge("Marriott's Aruba Surf Club studio, Nov 14-21, $6,500 total").cls, 'drop');
  assert.equal(judge("Marriott's Aruba Surf Club studio, Nov 14-21, $2,500 total").cls, 'drop');
  assert.equal(judge("Marriott's Aruba Surf Club 2 bedroom, Nov 14-21, $800 total").cls, 'tip');   // no 2-bedroom in the catalog: no baseline
  assert.equal(judge("Marriott's Aruba Surf Club, Nov 14-21, $800 total").cls, 'tip');             // room size not stated
  assert.equal(judge('Aruba: 7 nights at Marriott’s Aruba Surf Club studio, $71 total, Nov 14-21').cls, 'reject');   // the $71 Barceló week: $10 a night
  assert.equal(judge("Marriott's Aruba Surf Club studio, Nov 14-21, $1,900 a night").cls, 'reject');
  assert.equal(judge("Marriott's Aruba Surf Club studio, Nov 14-21, $1,400 per person total").cls, 'tip');
  assert.equal(judge("Marriott's Aruba Surf Club studio 7 nights w/air from $1,100").cls, 'tip');
  assert.equal(judge("Marriott's Aruba Surf Club studio, $800 total").cls, 'tip');                 // no dates stated: never guessed
  assert.equal(judge('Aruba resort week, Nov 14-21, $800 total').cls, 'tip');
  assert.equal(judge("Marriott's Aruba Surf Club studio, Nov 14-21, £800 total").cls, 'tip');
  assert.equal(judge('Paris hotel $99 a night').cls, 'drop');
  assert.equal(judge('Aruba all-inclusive, no price in sight').cls, 'drop');
  assert.equal(judge('Punta Cana all-inclusive from Miami, 4 nights $799').cls, 'tip');
  assert.equal(judge('Punta Cana all-inclusive from Chicago, 4 nights $499').cls, 'drop');
  assert.equal(judge("Marriott's Aruba Surf Club studio $110 a night, Nov 14-21").cls, 'great');   // 770 vs 2,591
});

test('forum posts are tips only, and only when the title smells like a deal', () => {
  const t = (title) => judgeItem(item(title, 'Aruba'), { catalog, cfg, now: NOW, source: 'reddit-aruba', tipOnly: true });
  assert.equal(t('Cheap timeshare week deal for Aruba').cls, 'tip');
  assert.equal(t('Best beach?').cls, 'drop');
  assert.equal(t('Cheap timeshare week deal for Aruba').find, undefined);              // never posted to the board
});

test('listings: like-for-like public rate AND no dearer than the Circle\'s own, with the same floor and ceiling', () => {
  const l = (o) => ({ externalId: 'VK1', resortName: 'Marriott’s Aruba Surf Club', unitType: 'Studio', from: '2026-11-14', to: '2026-11-21', nights: 7, usdTotal: 800, bookingUrl: 'https://v.test/1', ...o });
  const J = (o, now) => judgeListing(l(o), { catalog, cfg, now });
  assert.equal(J().cls, 'great');
  assert.equal(J({ usdTotal: 1500 }).cls, 'drop');            // 42% under public, but dearer than the Circle's $945
  assert.equal(J({ usdTotal: 2400 }).cls, 'drop');
  assert.equal(J({ unitType: '2 Bedroom' }).cls, 'tip');      // no comparable room
  assert.equal(J({ unitType: 'Studio', bedrooms: 1 }).cls, 'tip');
  assert.equal(J({ usdTotal: 71 }).cls, 'reject');
  assert.equal(J({ usdTotal: 63346 }).cls, 'reject');
  assert.equal(J({ from: '2026-10-16', to: '2026-10-23' }, NOW).cls, 'drop');          // check-in already past
  assert.equal(J({ nights: 5 }).cls, 'reject');
  assert.equal(judgeListing(l({ resortName: 'Divi Village' }), { catalog, cfg }).cls, 'drop');
  // The flat headline figure (850 x 7 = 5,950) would have called a $2,000 studio "66% under". It is dearer than the Circle's own $945.
  assert.equal(J({ usdTotal: 2000 }).cls, 'drop');
});

test('a wall is a full stop for that source: 403, challenge page, timeout; and it is not asked again for 24 h', async () => {
  const res = (status, body) => async () => ({ status, ok: status < 400, text: async () => body });
  assert.deepEqual(await readFeed({ url: 'x' }, res(403, '')), { ok: false, why: 'HTTP 403' });
  assert.equal((await readFeed({ url: 'x' }, res(200, CHALLENGE))).why, 'challenge page');
  assert.equal((await readFeed({ url: 'x' }, async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); })).why, 'timeout');
  assert.equal((await readFeed({ url: 'x' }, res(200, ATOM))).items.length, 2);
  let calls = 0; const state = emptyState(); const logs = [];
  const fetchFn = async () => { calls++; return { status: 403, ok: false, text: async () => '' }; };
  const run = (now) => collect({ state, catalog, cfg: {}, now, log: (l) => logs.push(l), only: 'secretflying', fetchFn });
  await run(NOW); assert.equal(calls, 1); assert.ok(stopped(state, 'secretflying', NOW + 3600e3));
  await run(NOW + 3600e3); assert.equal(calls, 1);                                      // still stopped
  await run(NOW + 25 * 3600e3); assert.equal(calls, 2);                                 // a day later: one more look
  assert.ok(logs.some((l) => /403 -> full stop/.test(l)));
});

test('a full pass over fixtures and a stub VakayMood: counts per class, tips, nothing posted by itself', async () => {
  const state = emptyState(); const logs = [];
  const fetchFn = async (url) => ({ status: 200, ok: true, text: async () => (/travelzoo/.test(url) ? ATOM : /holiday/.test(url) ? RSS : /reddit/.test(url) ? REDDIT : CHALLENGE) });
  const vakay = async ({ slug }) => ({ deals: /surf-club/.test(slug) ? [{ externalId: 'VK1', resortName: 'Marriott’s Aruba Surf Club', slug, unitType: 'Studio', from: '2026-11-14', to: '2026-11-21', nights: 7, usdTotal: 800, bookingUrl: 'https://v.test/1' }] : [] });
  const fresh = await collect({ state, catalog, cfg, now: NOW, log: (l) => logs.push(l), fetchFn, vakay });
  assert.deepEqual(fresh.map((i) => i.cls).sort(), ['great', 'great', 'tip', 'tip', 'tip']);
  assert.equal(Object.values(state.stats.travelzoo)[0].great, 1);
  assert.equal(Object.values(state.stats.vakaymood)[0].great, 1);
  const again = await collect({ state, catalog, cfg, now: NOW + 3600e3, log: () => {}, fetchFn, vakay });
  assert.equal(again.length, 0);                                                        // seen items are not new
  const sent = []; sendTips({ state, fresh, log: () => {}, dry: false, run: (a) => sent.push(a) });
  assert.equal(sent.length, 3); assert.deepEqual(sent[0].slice(0, 2), ['post', 'deals']); assert.equal(sent[0][3], '--as'); assert.equal(sent[0][4], 'Deal scout');
  assert.match(sent[0][2], /not checked/);
  assert.doesNotMatch(tipText(fresh.find((i) => i.cls === 'tip')), /available|confirmed|sold out|verified/i);
});

test('mail: shadow mode refuses any other recipient before it connects; a ghost of a connection is never opened', async () => {
  assert.throws(() => assertRecipient('someone@example.com'), /shadow mode/);
  assert.throws(() => assertRecipient([VICTOR, 'someone@example.com']), /shadow mode/);
  assert.doesNotThrow(() => assertRecipient('VictorFromAruba@gmail.com'));
  const connect = () => { throw new Error('connected'); };
  await assert.rejects(sendMail({ to: 'someone@example.com', subject: 's', text: 't', pass: 'x', connect }), /shadow mode/);
  await assert.rejects(sendMail({ to: VICTOR, subject: 'bad\nBcc: x@y.z', text: 't', pass: 'x', connect }), /plain ASCII/);
  await assert.rejects(sendMail({ to: VICTOR, subject: 's', text: 't', pass: 'x', connect }), /connected/);   // allowed past the guard
});

test('mail says when it was seen and never claims availability; carries the price, the public rate and the trap', () => {
  const state = emptyState();
  const j = judgeListing({ externalId: 'VK1', resortName: 'Marriott’s Aruba Surf Club', unitType: 'Studio', from: '2026-11-14', to: '2026-11-21', nights: 7, usdTotal: 800, bookingUrl: 'https://v.test/1', usdFees: 0 }, { catalog, cfg });
  state.items.a = { src: 'vakaymood', first: NOW, last: NOW, cls: j.cls, pct: j.pct, find: j.find, url: 'https://v.test/1', onBoard: true };
  const m = digestMail(forDigest(state, NOW), NOW);
  assert.match(m.subject, /^Circle deal scout: 1 worth a look/);
  for (const re of [/\$800/, /\$2,591/, /69% under/, /last seen/, /checked again/, /https:\/\/v\.test\/1/, /stop/]) assert.match(m.text, re);
  assert.doesNotMatch(m.text, /\bavailable\b|\bconfirmed\b|sold out|verified/i);
  assert.match(instantMail(state.items.a).subject, /69% under public/);
  assert.equal(instants([state.items.a]).length, 1);
  state.items.a.mailedInstant = 1; assert.equal(instants([state.items.a]).length, 0);
});

test('score file counts per source and the ISO week', () => {
  const state = emptyState(); state.stats.travelzoo = { [isoWeek(NOW)]: { runs: 2, seen: 10, great: 1, good: 1, tip: 2 } };
  state.items.a = { src: 'travelzoo', first: NOW, last: NOW, cls: 'great', find: { stayId: SURF }, onBoard: true, postedAt: NOW, ref: 'other:travelzoo:a', goneAt: NOW + 3600e3 };
  const s = scores(state, isoWeek(NOW), { taps: [{ stay: SURF, at: new Date(NOW + 60e3).toISOString() }, { stay: 'other', at: new Date(NOW + 60e3).toISOString() }] }).travelzoo;
  assert.equal(s.stay_taps_after_posting, 1); assert.equal(s.retired_within_48h, 1); assert.equal(s.hit_rate, 0.2);
  assert.equal(isoWeek(Date.parse('2026-10-23T14:00:00Z')), '2026-W43');
});
