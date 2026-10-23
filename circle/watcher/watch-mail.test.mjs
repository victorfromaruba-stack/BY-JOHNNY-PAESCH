import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fits, plan, compose, runWatchMail, memberMailMode, MAX_PER_DAY } from './watch-mail.mjs';
import { signMember, verifyToken } from './watch-token.mjs';
import { sendMail, VICTOR } from './scout-mail.mjs';

const NOW = Date.parse('2026-10-23T14:00:00Z'), KEY = 'k'.repeat(64), SURF = 's1', ANA = 'ana-id', LUIS = 'luis-id';
const deal = (o = {}, f = {}) => ({ src: 'vakaymood', cls: 'great', pct: 0.69, onBoard: true, last: NOW - 3600e3, url: 'https://v.test/1',
  find: { externalId: 'VK1', stayId: SURF, resortName: 'Marriott’s Aruba Surf Club', unit: 'Studio', sleeps: 4, from: '2026-11-14', to: '2026-11-21', nights: 7, usdTotal: 800, usdNightly: 114.29, retailPrice: 2591, fees: 0, ...f }, ...o });
const watch = (o = {}) => ({ watch_id: 'w1', member_id: ANA, first_name: 'Ana', email: 'ana@example.com', stay_id: null, kind: 'aruba', from_date: '2026-11-10', to_date: '2026-11-25', nights: 5, flex_days: 0, guests: 2, ...o });

test('matching: dates overlap enough, guests fit, place, freshness', () => {
  const w = watch();
  assert.equal(fits(deal(), w, NOW), true);
  assert.equal(fits(deal(), watch({ stay_id: SURF }), NOW), true);
  assert.equal(fits(deal(), watch({ stay_id: 'other' }), NOW), false);
  assert.equal(fits(deal(), watch({ guests: 5 }), NOW), false);                          // sleeps 4
  assert.equal(fits(deal({}, { sleeps: undefined }), w, NOW), false);                    // sleeps not stated: not claimed to fit
  assert.equal(fits(deal({}, { from: '2026-12-01', to: '2026-12-08' }), w, NOW), false);  // outside the window
  assert.equal(fits(deal({}, { from: '2026-11-22', to: '2026-11-29' }), w, NOW), false);  // only 3 nights inside, they want 5
  assert.equal(fits(deal({}, { from: '2026-11-22', to: '2026-11-29' }), watch({ flex_days: 3 }), NOW), true);   // flexibility widens it
  assert.equal(fits(deal({ last: NOW - 25 * 3600e3 }), w, NOW), false);                  // not seen in the last 24 h
  assert.equal(fits(deal({ cls: 'drop' }), w, NOW), false);
  assert.equal(fits(deal({ goneAt: NOW }), w, NOW), false);
  assert.equal(fits(deal({ url: 'http://x' }), w, NOW), false);
  assert.equal(fits(deal(), watch({ kind: 'trip' }), NOW), false);
});

test('de-dup: not the same deal twice to the same member, and a different member still gets it', () => {
  const targets = [watch(), watch({ watch_id: 'w2', member_id: LUIS, first_name: 'Luis' })];
  assert.equal(plan({ targets, items: [deal()], sent: [], now: NOW }).length, 2);
  const p = plan({ targets, items: [deal()], sent: [{ member_id: ANA, deal_key: 'vakaymood:VK1' }], now: NOW });
  assert.deepEqual(p.map((m) => m.first), ['Luis']);
  const two = plan({ targets: [watch(), watch({ watch_id: 'w3', from_date: '2026-11-12' })], items: [deal()], sent: [], now: NOW });
  assert.equal(two[0].deals.length, 1);                                                  // two watches, one deal, one line
});

test('no empty mail: nothing new, nothing sent', async () => {
  const sends = [];
  const r = await runWatchMail({ targets: [watch()], items: [deal({ cls: 'drop' })], sent: [], state: {}, key: KEY, send: async (m) => sends.push(m), now: NOW });
  assert.deepEqual(r, []); assert.equal(sends.length, 0);
});

test('shadow gate: goes only to Victor, first name in the subject, never logged as sent; live needs the exact word', async () => {
  assert.equal(memberMailMode(undefined), 'shadow'); assert.equal(memberMailMode('Live'), 'shadow'); assert.equal(memberMailMode(' live '), 'live');
  const sends = [], logged = [], state = {};
  const run = (mode, extra = {}) => runWatchMail({ targets: [watch()], items: [deal()], sent: [], state, mode, key: KEY, pass: 'x', send: async (m) => sends.push(m), logSent: async (...a) => logged.push(a), now: NOW, ...extra });
  await run('shadow');
  assert.equal(sends.length, 1); assert.equal(sends[0].to, VICTOR); assert.equal(sends[0].shadow, true);
  assert.match(sends[0].subject, /^\[shadow -> Ana\] Circle: a week for your dates in Aruba$/);
  assert.equal(logged.length, 0);
  assert.deepEqual(await run('shadow'), []);                                              // shadow does not repeat itself to Victor
  assert.doesNotMatch(JSON.stringify(sends), /ana@example\.com/);                         // her address is nowhere in the shadow mail
  const live = [], st2 = {};
  await runWatchMail({ targets: [watch()], items: [deal()], sent: [], state: st2, mode: 'live', key: KEY, pass: 'x', send: async (m) => live.push(m), logSent: async (...a) => logged.push(a), now: NOW });
  assert.equal(live[0].to, 'ana@example.com'); assert.equal(live[0].shadow, false); assert.deepEqual(logged[0], [ANA, ['vakaymood:VK1']]);
});

test('the real sender refuses any non-Victor recipient while shadow is on', async () => {
  const connect = () => { throw new Error('connected'); };
  await assert.rejects(sendMail({ to: 'ana@example.com', subject: 's', text: 't', pass: 'x', shadow: true, connect }), /shadow mode/);
});

test('at most 2 mails a member a day', async () => {
  const state = {}, sends = [];
  for (let n = 1; n <= 3; n++) {
    await runWatchMail({ targets: [watch()], items: [deal({}, { externalId: `VK${n}` })], sent: [], state, mode: 'live', key: KEY, send: async (m) => sends.push(m), now: NOW + n * 3600e3 });
  }
  assert.equal(sends.length, MAX_PER_DAY);
  await runWatchMail({ targets: [watch()], items: [deal({ last: NOW + 23 * 3600e3 }, { externalId: 'VK9' })], sent: [], state, mode: 'live', key: KEY, send: async (m) => sends.push(m), now: NOW + 24 * 3600e3 });
  assert.equal(sends.length, MAX_PER_DAY + 1);                                            // next day
});

test('unsubscribe token: signed, verifiable without login, tamper-proof', () => {
  const t = signMember(ANA, KEY);
  assert.equal(verifyToken(t, KEY), ANA);
  assert.equal(verifyToken(t, 'other-key'), null);
  assert.equal(verifyToken(`${LUIS}.${t.split('.')[1]}`, KEY), null);                     // another member's id with Ana's signature
  assert.equal(verifyToken('nonsense', KEY), null);
  assert.equal(t.split('.')[1].length, 40);
});

test('the mail: voice, price vs public, trap line, links, Victor books, one-tap unsubscribe; no address in it', () => {
  const [m] = plan({ targets: [watch()], items: [deal()], sent: [], now: NOW });
  const mail = compose(m, { key: KEY, mode: 'live', now: NOW });
  for (const re of [/^Hi Ana,/, /\$114 a night, \$800 for the 7 nights/, /\$2,591/, /69% under/, /sleeps 4/, /may not be in that price/, /#\/stays\/s1/, /Victor confirms every booking/,
    /Stop these e-mails, one tap: https:\/\/cdkopyphjvfxjqhasrae\.supabase\.co\/functions\/v1\/watch-unsub\?t=ana-id\./, /#\/watching/, /checked again/]) assert.match(mail.text, re);
  assert.doesNotMatch(mail.text, /\bavailable\b|\bconfirmed\b|sold out|verified|ana@example/i);
  assert.match(mail.subject, /^Circle: a week for your dates in Aruba$/);
});
