// The Interval scan a member's tap sets off, on trial — with ZERO real Interval sign-ins, ZERO real
// scans and no real ntfy.
//
// Everything outside this machine is a stand-in:
//   Interval   a local HTTP stub with the pages the real flow meets (login page, a "Please wait" page
//              that clears by itself, a signed-in landing page carrying the Getaways search form, the
//              real 17 Oct Aruba results page, a challenge page, a 403), driven by the REAL browser
//              session class. The browser itself refuses any request that is not 127.0.0.1.
//   Supabase   a local HTTP stub answering the calls circle.mjs makes, so the REAL Circle class and the
//              REAL judgeAndPost() post through the same door the board uses.
//   ntfy       a local HTTP stub, reached by the REAL ntfySend in taps.mjs.
//   alerts     a stand-in alerts module with the same raise/clear/FILE the real one has.
// The first thing this file does is make fetch() refuse every host but 127.0.0.1, the way
// taps.test.mjs does, so a test that forgot to stub something fails loudly instead of leaving the machine.
//
//   node --test interval-scan.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, statSync, unlinkSync, rmSync } from 'node:fs';
import { createCipheriv, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IV_CAPS, INTERVAL_ARUBA, codeFor, emptyIvState, loadIvState, saveIvState, decideScan, noteScan, decideSignIn, noteSignIn,
  useIntervalStopFile, intervalStopped, classify, WALL, weeksFor, toFinds, makeIntervalScanner, makeStopAnnouncer,
  SCAN, planWindow, nextCursor, saturated,
} from './interval-scan.mjs';
import { pageStats, reachedNearby, PAGE_ROWS } from './interval-getaways.mjs';
import { IntervalSession, readBox, UA, launchOptions, contextOptions, isHolding } from './interval-session.mjs';
import { splitProxy } from './interval-browser.mjs';
import { judgeAndPost } from './board.mjs';
import { putCard } from './cards.mjs';
import { handleTaps, makePusher, tellOrHold, flushHeld, emptyState } from './taps.mjs';
import { Circle } from './circle.mjs';
import { readsAsSignedIn } from './interval.mjs';

const realFetch = globalThis.fetch;
const tried = [];
before(() => {
  globalThis.fetch = (url, opts) => {
    const u = String(url);
    if (!u.startsWith('http://127.0.0.1:')) { tried.push(u); throw new Error(`test tried to reach the real network: ${u.slice(0, 70)}`); }
    return realFetch(url, opts);
  };
});
after(() => { globalThis.fetch = realFetch; });

const T0 = Date.parse('2026-10-22T16:00:00Z');
const min = (n) => n * 60e3, hour = (n) => n * 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const results = readFileSync(new URL('./fixtures-interval-aruba.html', import.meta.url), 'utf8');

const RATES = { kind: 'aruba', rate_low_usd: 150, rate_high_usd: 250, rate_peak_usd: 400, retail_usd: 300, min_nights: 3 };
const RBK = { id: 'stay-rbk', name: 'Radisson Blu Aruba', ...RATES };
const EAGLE = { id: 'stay-eagle', name: 'Eagle Aruba Resort', ...RATES };
const SURF = { id: 'stay-surf', name: 'Marriott’s Aruba Surf Club', ...RATES };
const DIVI = { id: 'stay-divi', name: 'Divi Aruba All Inclusive', ...RATES };      // the catalog's Divi; Interval's DP1 is a different name
const HILTON = { id: 'stay-hilton', name: 'Hilton Aruba Caribbean Resort & Casino', ...RATES };
const STAYS = [RBK, EAGLE, SURF, DIVI, HILTON];
const catalog = new Map(STAYS.map((s) => [s.id, s]));

// ================================================================ the caps, as pure decisions
test('one scan per resort per 30 minutes: a tap inside the window is served from the last scan', () => {
  const st = emptyIvState();
  assert.equal(decideScan(st, 'RBK', T0).go, true, 'never scanned: go');
  noteScan(st, 'RBK', T0);
  st.last.RBK = { at: iso(T0), ok: true, covers: { from: '2026-10-22', to: '2026-12-21' } };
  const d = decideScan(st, 'RBK', T0 + min(29));
  assert.deepEqual([d.go, d.covered], [false, true]);
  assert.match(d.why, /scanned 29 min ago — served from that scan/);
  assert.equal(decideScan(st, 'RBK', T0 + min(30)).go, true, 'at thirty it may be scanned again');
  assert.equal(decideScan(st, 'LC2', T0 + min(1)).go, true, 'another resort is its own question');
});

test('a scan that did not complete is not "covered": the window still holds, but the Grab nudge is free to fire', () => {
  const st = emptyIvState();
  noteScan(st, 'RBK', T0); st.last.RBK = { ok: false, why: 'Interval did not sign the watcher in' };
  const d = decideScan(st, 'RBK', T0 + min(5));
  assert.deepEqual([d.go, d.covered], [false, false]);
  assert.match(d.why, /did not complete/);
});

test('ten scans an hour in all, then every tap is served from what there is', () => {
  const st = emptyIvState();
  for (let i = 0; i < 10; i++) { assert.equal(decideScan(st, `R${i}`, T0 + i * 1000).go, true); noteScan(st, `R${i}`, T0 + i * 1000); }
  const d = decideScan(st, 'R99', T0 + min(30));
  assert.equal(d.go, false);
  assert.match(d.why, /10 Interval scans in the last hour \(cap 10\)/);
  assert.equal(decideScan(st, 'R99', T0 + hour(1) + min(1)).go, true, 'an hour later the count has drained');
});

test('three sign-ins in any rolling 24 hours, and never two within 30 minutes', () => {
  const st = emptyIvState();
  assert.equal(decideSignIn(st, T0).go, true);
  noteSignIn(st, T0);
  const gap = decideSignIn(st, T0 + min(10));
  assert.equal(gap.go, false);
  assert.match(gap.why, /signed in 10 min ago — not again for 30 min/);
  noteSignIn(st, T0 + min(31)); noteSignIn(st, T0 + min(62));
  const cap = decideSignIn(st, T0 + hour(5));
  assert.equal(cap.go, false);
  assert.match(cap.why, /3 sign-ins in the last 24 hours \(cap 3\)/);
  assert.equal(decideSignIn(st, T0 + hour(24) + min(1)).go, true, 'the first has aged out of the window');
  assert.equal(decideSignIn(st, T0 + hour(23)).go, false, 'a calendar midnight does not reset it: it is a rolling day');
});

test('the caps are the ones Victor wrote down', () => {
  assert.deepEqual({ ...IV_CAPS }, { resortGapMin: 30, perHour: 10, signInsPerDay: 3, signInGapMin: 30, refusalsToStop: 2 });
});

test('state is private, survives a restart, and an unreadable file FAILS CLOSED rather than counting from zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ivs-'));
  const f = join(dir, 'scan.json');
  assert.deepEqual(loadIvState(f), emptyIvState(), 'no file is a first run');
  const st = emptyIvState(); noteScan(st, 'RBK', T0); noteSignIn(st, T0); st.refusals = 1;
  saveIvState(f, st);
  assert.deepEqual(loadIvState(f), st);
  assert.equal(statSync(f).mode & 0o777, 0o600);
  writeFileSync(f, '{not json');
  const broken = loadIvState(f);
  assert.equal(broken.broken, true);
  const d = decideScan(broken, 'RBK', T0 + hour(5));
  assert.equal(d.go, false);
  assert.match(d.why, /cannot be read/);
  rmSync(dir, { recursive: true });
});

// ================================================================ which place is which resort
test('a catalog stay finds its Interval code by its whole name, and nothing looser', () => {
  assert.equal(codeFor(RBK, catalog), 'RBK');
  assert.equal(codeFor(EAGLE, catalog), 'LC2');
  assert.equal(codeFor(SURF, catalog), 'DCB', 'the apostrophe is not a difference');
  assert.equal(codeFor(DIVI, catalog), null, '"Divi Aruba All Inclusive" is not Interval\'s "Divi Aruba Phoenix Beach Resort" — no code is guessed');
  assert.equal(codeFor(HILTON, catalog), null);
  assert.equal(codeFor({ id: 'x', name: 'Aruba' }, new Map()), null, 'a fragment of a name is nothing');
  for (const code of Object.keys(INTERVAL_ARUBA)) assert.match(code, /^[A-Z0-9]{2,6}$/);
});

// ================================================================ what counts as a full stop
test('the saved 17 Oct results page — a real one — is signed in and carries none of the wall words', () => {
  const text = results.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  assert.equal(WALL.test(text), false, `a normal page tripped the wall: ${(WALL.exec(text) || [])[0]}`);
  assert.deepEqual(classify({ status: 200, title: 'VIP Gold | Destination Units Available for My Getaway', text, html: results }), { signedIn: true });
});

test('a 403, a 429, a captcha, a challenge, a lock, "unusual activity" and a holding page that never clears are each a stop', () => {
  const page = (o) => ({ status: 200, title: 'Interval', text: 'Welcome', html: '<a href="/web/my/auth/logout">Sign Out</a>', ...o });
  const stops = [
    [{ status: 403 }, /403/],
    [{ status: 429 }, /429/],
    [{ captcha: true }, /captcha/],
    [{ text: 'Please complete the CAPTCHA to continue' }, /captcha/],
    [{ title: 'Pardon Our Interruption', text: 'x' }, /pardon our interruption/],
    [{ text: 'We have detected unusual activity from your device.' }, /unusual activity/],
    [{ text: 'Your account has been locked. Call member services.' }, /locked/],
    [{ text: 'This membership is suspended' }, /suspended/],
    [{ text: 'Access denied' }, /access denied/],
    [{ text: 'Are you a robot?' }, /robot/],
    [{ text: 'Too many failed attempts' }, /too many/],
    [{ title: 'Just a moment...', text: 'Checking your browser' }, /just a moment/],
    [{ holding: true, text: 'Please wait', html: '' }, /did not clear/],
  ];
  for (const [o, why] of stops) {
    const v = classify(page(o));
    assert.ok(v.stop, `no stop for ${JSON.stringify(o)}`);
    assert.match(v.stop, why);
  }
});

test('a refused password is not a stop by itself: it is "not signed in", with the site\'s words', () => {
  const loginPage = '<a href="/web/my/auth/loginPage">Sign In</a><input name="j_password">';
  const v = classify({ status: 200, title: 'Sign In', text: 'Invalid username or password', html: loginPage });
  assert.deepEqual(v, { signedIn: false, said: 'Invalid' });
  assert.deepEqual(classify({ status: 200, title: 'Sign In', text: 'Sign In', html: loginPage }), { signedIn: false, said: null });
});

test('a holding page is recognised by being nearly empty, not by the words alone', () => {
  assert.equal(isHolding({ title: 'Please wait...', text: '' }), true);
  assert.equal(isHolding({ title: 'Getaways', text: 'Please wait for confirmation from the resort. ' + 'Lorem ipsum. '.repeat(40) }), false);
});

// ================================================================ weeks, as finds
test('a resort\'s weeks are its own code only — never another resort\'s, never the areas surrounding', () => {
  const rbk = weeksFor(results, 'RBK');
  assert.equal(rbk.length, 3);
  assert.ok(rbk.every((w) => w.code === 'RBK'));
  assert.deepEqual(weeksFor(results, 'AWA'), [], 'AVA Resort Cancun came back under "areas surrounding Aruba"');
  assert.deepEqual(weeksFor('<html>signed out</html>', 'RBK'), []);
});

test('finds carry the Grab path\'s reference, whole-week prices, and where and when they were read', () => {
  const finds = toFinds(weeksFor(results, 'LC2'), EAGLE, T0);
  assert.equal(finds.length, 2);
  const f = finds[0];
  assert.equal(f.source, 'interval');
  assert.equal(f.stayId, 'stay-eagle');
  assert.equal(f.externalId, 'interval:stay-eagle:2026-11-20:2026-11-27', 'the ref ingest-deal writes for the same week: place + dates');
  assert.equal(f.usdTotal, 1740.51, 'the week\'s own price');
  assert.equal(f.nights, 7);
  assert.equal(f.usdNightly, 248.64, 'a night only for the judge\'s floor and ceiling');
  assert.equal(f.url, 'https://vip.intervalworld.com/web/cs?a=1013&resortCode=LC2');
  assert.match(f.seenNote, /Read off Interval's Getaways search at 22\/10 12:00 Aruba time/);
  assert.doesNotMatch(JSON.stringify(f), /availab|confirmed|sold out|verified/i, 'the app never asserts what it has not established');
});

// ================================================================ the locked box and the flow's own settings
test('the locked box round-trips, and the proxy line splits into what Playwright wants', () => {
  const dir = mkdtempSync(join(tmpdir(), 'box-'));
  const key = randomBytes(32); writeFileSync(join(dir, 'key'), key);
  const seal = (name, text) => {
    const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    writeFileSync(join(dir, `${name}.enc`), Buffer.concat([iv, c.getAuthTag(), ct]));
  };
  seal('proxy', 'http://pxuser:p%40ss@res.example.net:8080\n'); seal('interval_user', 'Tagless');
  const opts = { dir, keyFile: join(dir, 'key') };
  assert.equal(readBox('interval_user', opts), 'Tagless');
  assert.deepEqual(splitProxy(readBox('proxy', opts)), { server: 'http://res.example.net:8080', bypass: undefined, username: 'pxuser', password: 'p@ss' });
  assert.throws(() => readBox('../key', opts), /not a locked-box entry/);
  assert.throws(() => readBox('missing', opts));
  rmSync(dir, { recursive: true });
});

test('the browser is set up exactly as iv-login.js sets it up, and nothing is added', { skip: !existsSync('/home/openclaw/premanifest-bot/iv-login.js') }, () => {
  const script = readFileSync('/home/openclaw/premanifest-bot/iv-login.js', 'utf8');
  assert.ok(script.includes(UA), 'the same user agent');
  assert.ok(script.includes("'--disable-blink-features=AutomationControlled'"));
  assert.deepEqual(launchOptions('chromium').args, ['--disable-blink-features=AutomationControlled']);
  assert.equal(launchOptions('firefox').args, undefined, 'the switch is Chromium\'s; no other engine is handed it');
  const c = contextOptions({ proxy: { server: 'http://p:1' } });
  assert.deepEqual(Object.keys(c).sort(), ['locale', 'proxy', 'timezoneId', 'userAgent', 'viewport']);
  assert.deepEqual([c.locale, c.timezoneId], ['en-US', 'America/Aruba']);
  assert.deepEqual(c.viewport, { width: 1280, height: 950 });
  const src = readFileSync(new URL('./interval-session.mjs', import.meta.url), 'utf8');
  const code = src.replace(/\/\/.*$/gm, '');
  assert.ok(!/throughInterstitial|solve|2captcha|stealth|fingerprint/i.test(code), 'nothing here solves anything or hides anything further');
  assert.deepEqual([...code.matchAll(/\.click\(([^)]*)\)/g)].map((m) => m[1]),
    ["'input[type=submit], button[type=submit], #buttonlogin'", '', ''],
    'the only three things ever clicked are Sign In, Find Getaway and the results page\'s own Next Page — never a Continue on a holding page, never a challenge');
  assert.ok(code.includes(".locator('.menu_page_result a', { hasText: 'Next Page' })"), 'and that third click is the pager link and nothing else');
  assert.deepEqual([...src.matchAll(/addInitScript\(([^)]*)\)/g)].map((m) => m[1]), ['HIDE_WEBDRIVER'], 'the one init script iv-login.js has');
});

test('without a proxy line the session refuses to open, rather than going out from the server\'s own address', async () => {
  const s = new IntervalSession({ stateFile: join(tmpdir(), 'never-written.json'), getProxy: () => null });
  await assert.rejects(s.open(), /no proxy line/);
});

// ================================================================ the whole path, against stand-ins
const CHALLENGE = '<html><head><title>Pardon Our Interruption</title></head><body><h1>Pardon Our Interruption</h1><p>We have detected unusual activity from your device. Please complete the security check.</p></body></html>';
const HOLD = (go) => `<html><head><title>Please wait...</title></head><body><p>Please wait while we verify your browser.</p>${go ? "<script>setTimeout(function(){location.replace('/web/cs?a=0')},400)</script>" : ''}</body></html>`;
const LOGIN = (said = '') => `<html><head><title>Sign In</title></head><body><input type="text" name="siteSearch" id="q">
  <form name="loginForm" action="/web/my/auth/login" method="POST">${said ? `<div class="error">${said}</div>` : ''}
  <input name="j_username" type="text" maxlength="33"><input name="j_password" type="password" maxlength="14">
  <input type="submit" value="Sign In"></form><a href="/web/my/auth/loginPage">Sign In</a></body></html>`;
const ANON = '<html><head><title>Interval</title></head><body><a href="/web/my/auth/loginPage">Sign In</a></body></html>';
const LANDING = `<html><head><title>VIP Gold</title></head><body><a href="/web/my/auth/logout">Sign Out</a><h1>Find a Getaway</h1>
  <form name="SearchForm" method="post" action="/web/cs?a=1001">
    <label><input name="searchType" type="radio" value="CitySearch" checked>Single Destination</label>
    <label><input name="searchType" type="radio" value="ResortSearch">Resort Name or Code</label>
    <label><input name="searchType" type="radio" value="AllSearch">Search All Destinations</label>
    <input id="searchCriteria" name="searchCriteria" value="Aruba, ANT" type="text">
    <input id="fromDate" name="fromDate" value="10/24/2026" type="text"><input id="toDate" name="toDate" value="04/15/2027" type="text">
    <input type="hidden" name="numberOfAdults" value="2"><input type="hidden" name="numberOfChildren" value="0">
    <input class="button_col1" value="Find Getaway" type="submit"><input type="hidden" name="getawaySearchFormType" value="3">
  </form></body></html>`;

/** Interval as a stand-in. `S.mode` picks what it does; `S.hits` is every request it ever got. */
async function startInterval() {
  const S = { mode: 'ok', hits: [], sessions: new Set(), searches: [], logins: [], nexts: [], n: 0, k: 0 };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    S.hits.push(`${req.method} ${u.pathname}${u.search}`);
    const cookies = Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
    const authed = S.sessions.has(cookies.IVSESS);
    const send = (code, body, h = {}) => { res.writeHead(code, { 'content-type': 'text/html', ...h }); res.end(body); };
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const a = u.searchParams.get('a');
      if (u.pathname === '/web/my/auth/loginPage') {
        if (S.mode === 'forbidden-login') return send(403, '<h1>Forbidden</h1>');
        if (S.mode === 'challenge-login') return send(200, CHALLENGE);
        if (S.mode === 'wall-over-form') return send(200, LOGIN().replace('<form name', '<p>We have detected unusual activity. Complete the captcha below.</p><form name'));
        if (S.mode === 'badge') return send(200, LOGIN().replace('</body>', '<div class="grecaptcha-badge" style="width:70px;height:60px"><iframe src="/recaptcha/api2/anchor" width="70" height="60"></iframe></div></body>'));
        return send(200, LOGIN());
      }
      if (u.pathname === '/web/my/auth/login' && req.method === 'POST') {
        S.logins.push(Object.fromEntries(new URLSearchParams(body)));
        if (S.mode === 'refuse') return send(200, LOGIN('Invalid username or password'));
        const id = `sess${++S.n}`; S.sessions.add(id);
        return send(200, HOLD(S.mode !== 'hold-forever'), { 'set-cookie': `IVSESS=${id}; Path=/` });
      }
      if (u.pathname === '/web/cs' && a === '0') { S.k = 0; return send(200, authed ? LANDING : ANON); }       // a new scan starts at the landing page
      if (u.pathname === '/web/cs' && a === '1001' && req.method === 'POST') {
        if (!authed) return send(200, ANON);
        S.searches.push(Object.fromEntries(new URLSearchParams(body)));
        if (S.mode === 'challenge-search') return send(200, CHALLENGE);
        if (S.mode === 'forbidden-search') return send(403, 'Forbidden');
        // The first search of a scan gets the real 17 Oct page (or the page the test set); a later one, for later
        // dates, gets a page with no resorts on it unless the test says what it should carry.
        const n = S.k++;
        return send(200, S.pages?.[n] ?? (n === 0 ? results : LANDING));
      }
      if (u.pathname === '/web/cs' && a === '1014') { S.nexts.push(u.searchParams.get('p')); return send(200, authed ? (S.pager?.[u.searchParams.get('p')] ?? LANDING) : ANON); }
      res.writeHead(404); res.end();               // an asset of the saved page
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { S, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

/** Supabase as a stand-in: just what circle.mjs asks, recording every post and every clock moved. */
async function startSupabase({ intervalSeen = {} } = {}) {
  const S = { posts: [], seenMoves: [], deals: [], tokens: 0 };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = u.pathname, sel = u.searchParams.get('select') || '';
      if (p === '/auth/v1/token') { S.tokens++; return json({ access_token: 'tok' }); }
      if (p === '/rest/v1/stays') return json(STAYS);
      if (p === '/rest/v1/settings') return json([{ points_per_dollar: 100, service_rate: 0.15 }]);
      if (p === '/rest/v1/rpc/post_deal') {
        const b = JSON.parse(body); S.posts.push(b);
        S.deals.push({ source_ref: b.p_source_ref, stay_id: b.p_stay, from_date: b.p_from, to_date: b.p_to, title: b.p_title });
        return json({});
      }
      if (p === '/rest/v1/deals' && req.method === 'PATCH') {
        const refs = JSON.parse(`[${/^in\.\((.*)\)$/.exec(u.searchParams.get('source_ref'))[1]}]`);
        const rows = S.deals.filter((d) => refs.includes(d.source_ref));
        S.seenMoves.push(...rows.map((r) => r.source_ref));
        return json(rows.map((r) => ({ source_ref: r.source_ref })));
      }
      if (p === '/rest/v1/deals' && sel.startsWith('seen_at')) {
        const stay = /^eq\.(.*)$/.exec(u.searchParams.get('stay_id') || '')?.[1];
        return json(intervalSeen[stay] ? [{ seen_at: intervalSeen[stay], posted_at: intervalSeen[stay] }] : []);
      }
      if (p === '/rest/v1/deals') return json(S.deals);
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { S, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

async function startNtfy() {
  const S = { pushes: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { S.pushes.push(JSON.parse(body)); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"stub1"}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { S, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

// Which browser to drive the stub with: Chromium (what iv-login.js uses) when this box can launch it, else Firefox.
const FAST = { afterLoginPage: 0, afterSubmit: 0, settle: 100, holding: 3000, idle: 3000, nav: 15000 };
let ENGINE = null;
for (const b of ['chromium', 'firefox']) {
  const s = new IntervalSession({ stateFile: join(tmpdir(), 'probe-never.json'), browser: b, requireProxy: false, getProxy: () => null, waits: FAST });
  try { await s.open(); ENGINE = b; break; } catch { /* try the next */ } finally { await s.close().catch(() => {}); }
}
const e2e = { skip: ENGINE ? false : 'no Playwright browser is downloaded here' };
if (ENGINE) console.log(`# browser for the stand-in Interval: ${ENGINE}`);

const WORLD_CFG = { onlyOurStays: true, mustBeatOurs: true, beatBy: 0.15, maxPerResortMonth: 3, pointsPerUsd: 100, maxPlausibleNightly: 1500 };
const OLD = iso(T0 - hour(24 * 32));                  // the newest Interval week the stand-in Circle holds is 32 days old

/** One watcher, wired the way index.mjs wires it, with every outside thing a stand-in. */
async function world({ mode = 'ok', armed = true, quiet = false, seen = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ivw-'));
  const iv = await startInterval(); iv.S.mode = mode;
  const sb = await startSupabase({ intervalSeen: seen ? Object.fromEntries(STAYS.map((s) => [s.id, OLD])) : {} });
  const ntfy = await startNtfy();
  const cfgFile = join(dir, 'alert-push.json');
  writeFileSync(cfgFile, JSON.stringify({ ntfy: { server: ntfy.url, topic: 'topic-for-tests' } }));
  // The alerts module, as a stand-in with the real one's shape: raise(key, title, detail, {since}), clear(key), FILE.
  const cardsFile = join(dir, 'needs-human.json');
  writeFileSync(join(dir, 'alerts-stub.cjs'), `const fs=require('fs');const FILE=${JSON.stringify(cardsFile)};
    const rd=()=>{try{return JSON.parse(fs.readFileSync(FILE,'utf8'))}catch{return{}}};
    module.exports={FILE,raise(k,t,d,o){const j=rd();j[k]={title:t,detail:d,since:o&&o.since};fs.writeFileSync(FILE,JSON.stringify(j))},clear(k){const j=rd();delete j[k];fs.writeFileSync(FILE,JSON.stringify(j))}};`);
  process.env.ALERTS_MODULE = join(dir, 'alerts-stub.cjs');

  const clock = { t: Date.now() };
  const lines = [];
  const log = (l) => { lines.push(`${new Date().toISOString().slice(11, 19)} ${l}`); };
  const flag = { quiet };
  const circle = new Circle({ url: sb.url, key: 'k', username: 'watcher', password: 'p' });
  const pusher = makePusher({ cfgFile, inQuiet: () => flag.quiet });
  const tapState = emptyState();
  const stopFile = join(dir, '.interval-stop.json'), stateFile = join(dir, '.interval-scan.json'), sessionFile = join(dir, '.interval-session.json');
  useIntervalStopFile(stopFile);
  const mk = (canSignIn = true) => makeIntervalScanner({
    armed: () => armed, stateFile, now: () => clock.t, log, canSignIn,
    makeSession: () => new IntervalSession({ origin: iv.url, stateFile: sessionFile, browser: ENGINE, requireProxy: false, getProxy: () => null,
      getCreds: () => ({ user: 'stub-user', pass: 'stub-pass' }), onlyHosts: ['127.0.0.1'], waits: FAST }),
    post: ({ finds, catalog: c }) => judgeAndPost({ circle, found: finds, catalog: c, cfg: WORLD_CFG, log }),
    onStop: makeStopAnnouncer({ putCard: (k, c) => putCard(k, c, log), tell: (m) => tellOrHold(tapState, pusher, m, log) }),
    onGood: () => putCard('interval-watcher', null, log),
  });
  const scanner = mk(true);
  const tap = (stay, afterMs = 0, window = null) => {
    clock.t += afterMs;
    return handleTaps({
      taps: [{ stay: stay.id, tapped: iso(clock.t), from: window?.from || null, to: window?.to || null }], catalog, state: tapState, now: () => clock.t,
      deps: { log, pusher, intervalLastSeen: (id) => circle.intervalLastSeen(id),
        scanInterval: (stay2, win) => scanner(stay2, catalog, win) },
    });
  };
  const cards = () => { try { return JSON.parse(readFileSync(cardsFile, 'utf8')); } catch { return {}; } };
  const stopPushes = () => ntfy.S.pushes.filter((p) => /Interval stopped/.test(p.title));
  const nudges = () => ntfy.S.pushes.filter((p) => /A member is looking at/.test(p.title));
  const ivHits = (re) => iv.S.hits.filter((h) => re.test(h)).length;
  const close = () => { iv.close(); sb.close(); ntfy.close(); rmSync(dir, { recursive: true, force: true }); };
  return { dir, iv, sb, ntfy, lines, clock, flag, tap, mk, scanner, catalog, cards, stopPushes, nudges, ivHits, close, stopFile, stateFile, sessionFile, tapState, pusher, circle };
}

test('ONE TAP -> ONE SCAN; a second tap inside 30 minutes is served from it; a third after 30 reuses the session', e2e, async () => {
  const w = await world();
  try {
    // 1. A member opens the Radisson. The saved session does not exist, so the watcher signs in once, searches once, posts.
    const [row1] = await w.tap(RBK);
    assert.equal(row1.scan.ran, true);
    assert.equal(row1.scan.covered, true);
    assert.equal(w.ivHits(/POST \/web\/my\/auth\/login$/), 1, 'one sign-in');
    assert.equal(w.ivHits(/POST \/web\/cs\?a=1001/), 2, 'the Radisson showed a full page of three, so the scan searched once more for later dates — one scan, two searches');
    assert.equal(w.iv.S.searches.length, 2);
    assert.deepEqual(w.iv.S.searches[0].searchType, 'ResortSearch');
    assert.equal(w.iv.S.searches[0].searchCriteria, 'RBK', 'it asked for the one resort, by its code');
    assert.equal(w.iv.S.logins[0].j_username, 'stub-user');
    assert.ok(existsSync(w.sessionFile), 'the session was saved');
    assert.equal(statSync(w.sessionFile).mode & 0o777, 0o600, 'private');
    assert.equal(statSync(w.stateFile).mode & 0o777, 0o600);

    // The weeks reached the board through post_deal, with where they came from and when.
    // The page had three RBK rows; two share a check-in week, so the board takes the cheaper of those and the other.
    assert.equal(row1.scan.rows, 3);
    assert.equal(row1.scan.posted, 2);
    const posts = w.sb.S.posts;
    assert.equal(posts.length, 2);
    assert.ok(posts.every((p) => p.p_stay === 'stay-rbk' && p.p_source === 'interval'), 'the Radisson\'s weeks only, none of the 12 other weeks on the page');
    assert.deepEqual(posts.map((p) => p.p_source_ref).sort(), ['interval:stay-rbk:2026-11-01:2026-11-08', 'interval:stay-rbk:2026-11-06:2026-11-13']);
    assert.equal(posts[0].p_source_url, 'https://vip.intervalworld.com/web/cs?a=1013&resortCode=RBK', 'provenance: the resort\'s own Interval page');
    assert.match(posts[0].p_note, /Read off Interval's Getaways search at \d\d\/\d\d \d\d:\d\d Aruba time/);
    assert.equal(posts[0].p_points, Math.round(2309 * 100 * 1.15), 'priced as the whole week, all-in, like every other week');
    assert.equal(posts[0].p_nights, 7);
    assert.equal(w.nudges().length, 0, 'Interval was just read: no nudge to go and look');
    const hitsAfterFirst = w.iv.S.hits.length;

    // 2. Five minutes later another member opens it: no request to Interval at all.
    const [row2] = await w.tap(RBK, min(5));
    assert.equal(row2.scan.ran, false);
    assert.equal(row2.scan.covered, true);
    assert.match(row2.scan.why, /scanned 5 min ago — served from that scan/);
    assert.equal(w.iv.S.hits.length, hitsAfterFirst, 'the stub saw nothing');
    assert.equal(w.sb.S.posts.length, 2);
    assert.equal(w.nudges().length, 0);

    // 3. Thirty-one minutes after the first: scanned again, on the SAVED session — no sign-in.
    const [row3] = await w.tap(RBK, min(26));
    assert.equal(row3.scan.ran, true);
    assert.equal(w.ivHits(/POST \/web\/my\/auth\/login$/), 1, 'still one sign-in: the session was reused');
    assert.equal(w.ivHits(/GET \/web\/my\/auth\/loginPage/), 1, 'and the login page was not even opened again');
    assert.equal(w.ivHits(/POST \/web\/cs\?a=1001/), 4, 'and the second scan made its own two searches');
    assert.equal(row3.scan.posted, 0, 'nothing new to post');
    assert.equal(w.sb.S.posts.length, 2, 'the same weeks are not posted twice');
    assert.equal(row3.scan.refreshed, 2, 'but the two on the board had their last-seen clocks moved');
    assert.deepEqual([...new Set(w.sb.S.seenMoves)].sort(), ['interval:stay-rbk:2026-11-01:2026-11-08', 'interval:stay-rbk:2026-11-06:2026-11-13']);
    assert.equal(intervalStopped(), null);
    console.log('# transcript of the three taps\n' + w.lines.map((l) => `#   ${l}`).join('\n'));
  } finally { w.close(); }
});

test('a place with no Interval code on file, and a scan switched off, both leave the Grab nudge exactly as it was', e2e, async () => {
  const off = await world({ armed: false });
  try {
    const [row] = await off.tap(RBK);
    assert.equal(row.scan.ran, false);
    assert.match(row.scan.why, /switched off/);
    assert.equal(off.iv.S.hits.length, 0, 'not one request to Interval');
    assert.equal(off.nudges().length, 1, 'the nudge went');
    assert.match(off.nudges()[0].message, /Interval last grabbed 32 days ago/);
  } finally { off.close(); }

  const on = await world();
  try {
    const [row] = await on.tap(HILTON);
    assert.match(row.scan.why, /no Interval resort code/);
    assert.equal(on.iv.S.hits.length, 0);
    assert.equal(on.nudges().length, 1);
  } finally { on.close(); }
});

test('A CHALLENGE PAGE: the stop flag, the card and ONE push — and nothing asks Interval again', e2e, async () => {
  const w = await world({ mode: 'challenge-search' });
  try {
    const [row] = await w.tap(RBK);
    assert.equal(row.scan.stopped, true);
    assert.match(row.scan.why, /pardon our interruption/);
    // 1. the flag, private, with the reason
    assert.ok(existsSync(w.stopFile));
    assert.equal(statSync(w.stopFile).mode & 0o777, 0o600);
    assert.match(JSON.parse(readFileSync(w.stopFile, 'utf8')).why, /pardon our interruption/);
    // 2. the card, through the alerts module
    assert.match(w.cards()['interval-watcher'].title, /Interval stopped the watcher/);
    assert.match(w.cards()['interval-watcher'].detail, /\.interval-stop\.json is deleted/);
    // 3. one push saying it stopped and why
    assert.equal(w.stopPushes().length, 1);
    assert.match(w.stopPushes()[0].message, /pardon our interruption/);
    assert.match(w.stopPushes()[0].message, /delete \.interval-stop\.json/);
    assert.equal(w.stopPushes()[0].topic, 'topic-for-tests');
    // 4. the Grab nudge still fires on that very tap
    assert.equal(w.nudges().length, 1, 'the fallback is intact');
    // 5. never again: a restart still knows, and a tap at another stay later does not touch Interval
    const hits = w.iv.S.hits.length;
    useIntervalStopFile(w.stopFile);                       // a restart: memory gone, the file remains
    assert.match(intervalStopped().why, /pardon our interruption/);
    const [row2] = await w.tap(EAGLE, hour(2));
    assert.equal(row2.scan.ran, false);
    assert.match(row2.scan.why, /stopped since .* delete \.interval-stop\.json/);
    assert.equal(w.iv.S.hits.length, hits, 'not one more request to Interval');
    assert.equal(w.stopPushes().length, 1, 'and no second stop push');
    assert.equal(w.nudges().length, 2, 'while the Grab nudge keeps working for the next place');
    // 6. only a person lets it go: delete the flag, and the next tap scans again and clears the card
    w.iv.S.mode = 'ok';
    unlinkSync(w.stopFile);
    assert.equal(intervalStopped(), null);
    const [row3] = await w.tap(RBK, hour(1));
    assert.equal(row3.scan.covered, true, row3.scan.why);
    assert.equal(w.cards()['interval-watcher'], undefined, 'a scan that works takes the card down');
  } finally { w.close(); }
});

test('a 403 is a full stop, whichever page it comes on', e2e, async () => {
  for (const mode of ['forbidden-login', 'forbidden-search']) {
    const w = await world({ mode });
    try {
      const [row] = await w.tap(RBK);
      assert.equal(row.scan.stopped, true, mode);
      assert.match(row.scan.why, /403/);
      assert.ok(existsSync(w.stopFile));
      assert.equal(w.stopPushes().length, 1);
      assert.ok(w.cards()['interval-watcher']);
    } finally { w.close(); }
  }
});

test('a captcha wall at the login page stops before a password is typed', e2e, async () => {
  const w = await world({ mode: 'challenge-login' });
  try {
    const [row] = await w.tap(RBK);
    assert.equal(row.scan.stopped, true);
    assert.equal(w.iv.S.logins.length, 0, 'the login form was never posted');
  } finally { w.close(); }
});

test('a wall laid over a login form that is still there: the password is never typed; an invisible badge is not a wall', e2e, async () => {
  const w = await world({ mode: 'wall-over-form' });
  try {
    const [row] = await w.tap(RBK);
    assert.equal(row.scan.stopped, true);
    assert.match(row.scan.why, /unusual activity|captcha/);
    assert.equal(w.iv.S.logins.length, 0, 'nothing was posted to the login form');
  } finally { w.close(); }
  const badge = await world({ mode: 'badge' });
  try {
    const [row] = await badge.tap(RBK);
    assert.equal(row.scan.covered, true, row.scan.why);
  } finally { badge.close(); }
});

test('a "Please wait" page that clears by itself is waited on, not pressed; one that never clears is a stop', e2e, async () => {
  const ok = await world();
  try {
    const [row] = await ok.tap(RBK);                      // the stub's login answer is a holding page for 400 ms
    assert.equal(row.scan.covered, true, row.scan.why);
  } finally { ok.close(); }
  const stuck = await world({ mode: 'hold-forever' });
  try {
    const [row] = await stuck.tap(RBK);
    assert.equal(row.scan.stopped, true);
    assert.match(row.scan.why, /"Please wait" page that did not clear/);
    assert.equal(stuck.ivHits(/POST \/web\/cs\?a=1001/), 0, 'it never went on to search');
  } finally { stuck.close(); }
});

test('TWO REFUSED SIGN-INS IN A ROW stop it; one refusal is only a refusal, and the window holds in between', e2e, async () => {
  const w = await world({ mode: 'refuse' });
  try {
    const [row1] = await w.tap(RBK);
    assert.equal(row1.scan.stopped, undefined);
    assert.equal(row1.scan.covered, false);
    assert.match(row1.scan.why, /did not sign the watcher in \(it said "Invalid"\); a second refusal in a row stops/);
    assert.equal(existsSync(w.stopFile), false, 'one refusal is not a stop');
    assert.equal(w.nudges().length, 1, 'and the Grab nudge went, as the scan did not');
    // A tap on another resort five minutes later is inside the sign-in gap: it must not try again.
    const [row2] = await w.tap(EAGLE, min(5));
    assert.equal(row2.scan.ran, false, 'no search was made');
    assert.match(row2.scan.why, /signed in 5 min ago — not again for 30 min/);
    assert.equal(w.ivHits(/POST \/web\/my\/auth\/login$/), 1, 'no second sign-in so soon');
    assert.equal(w.ivHits(/GET \/web\/my\/auth\/loginPage/), 1, 'and the login page was not opened again');
    // Past the gap, the second refusal is the stop.
    const [row3] = await w.tap(RBK, min(40));
    assert.equal(row3.scan.stopped, true);
    assert.match(row3.scan.why, /refused the sign-in 2 times in a row/);
    assert.equal(w.ivHits(/POST \/web\/my\/auth\/login$/), 2);
    assert.ok(existsSync(w.stopFile));
    assert.equal(w.stopPushes().length, 1);
    assert.ok(w.cards()['interval-watcher']);
  } finally { w.close(); }
});

test('THE SIGN-IN CAP: three sign-ins in a day, and the fourth is refused before it reaches Interval', e2e, async () => {
  const w = await world();
  try {
    const results4 = [];
    for (let i = 0; i < 4; i++) {
      w.iv.S.sessions.clear();                            // Interval forgets the session between taps, so each one needs a sign-in
      const [row] = await w.tap(RBK, i === 0 ? 0 : min(31));
      results4.push(row.scan);
    }
    assert.deepEqual(results4.slice(0, 3).map((r) => r.covered), [true, true, true], 'three sign-ins, three scans');
    assert.equal(w.ivHits(/POST \/web\/my\/auth\/login$/), 3);
    assert.equal(results4[3].ran, false);
    assert.match(results4[3].why, /needs a sign-in, and 3 sign-ins in the last 24 hours \(cap 3\)/);
    assert.equal(w.ivHits(/POST \/web\/my\/auth\/login$/), 3, 'the fourth never posted a password');
    assert.equal(w.ivHits(/GET \/web\/my\/auth\/loginPage/), 3, 'and never opened the login page');
    assert.equal(existsSync(w.stopFile), false, 'a cap is not a stop');
    assert.equal(w.nudges().length, 1, 'the capped tap falls back to the Grab nudge');
  } finally { w.close(); }
});

test('the stop push is held through the night and goes once after seven', e2e, async () => {
  const w = await world({ mode: 'challenge-search', quiet: true });
  try {
    const [row] = await w.tap(RBK);
    assert.equal(row.scan.stopped, true);
    assert.ok(w.cards()['interval-watcher'], 'the card goes up at once');
    assert.equal(w.ntfy.S.pushes.length, 0, 'no push between 23:00 and 07:00');
    assert.equal(w.tapState.held.length, 1);
    assert.equal(await flushHeld(w.tapState, w.pusher, () => {}), false, 'still night: still held');
    w.flag.quiet = false;
    assert.equal(await flushHeld(w.tapState, w.pusher, () => {}), true);
    assert.equal(w.stopPushes().length, 1);
    assert.equal(await flushHeld(w.tapState, w.pusher, () => {}), false, 'and not twice');
  } finally { w.close(); }
});

test('a page whose search form is missing is said plainly, costs the cap, and is not a stop', e2e, async () => {
  const w = await world();
  try {
    w.iv.S.mode = 'ok';
    // Interval answers the landing with a signed-in page that has no SearchForm.
    const s = new IntervalSession({ origin: w.iv.url, stateFile: join(w.dir, 'x.json'), browser: ENGINE, requireProxy: false, getProxy: () => null, onlyHosts: ['127.0.0.1'], waits: FAST });
    await s.open();
    await s.page.setContent('<a href="/web/my/auth/logout">Sign Out</a><form name="Other"></form>');
    await assert.rejects(s.search('RBK'), (e) => e.noForm === true && /forms there: Other/.test(e.message));
    await s.close();
  } finally { w.close(); }
});

test('the posting door is the board\'s own: a nonsense price from the page never reaches post_deal', e2e, async () => {
  const w = await world();
  try {
    const find = { ...toFinds(weeksFor(results, 'RBK'), RBK, T0)[0], usdTotal: 63346, usdNightly: 9049.43 };
    const lines = [];
    const out = await judgeAndPost({ circle: w.circle, found: [find], catalog, cfg: WORLD_CFG, log: (l) => lines.push(l) });
    assert.equal(out.posted, 0);
    assert.equal(w.sb.S.posts.length, 0);
    const cheap = { ...find, usdTotal: 71, usdNightly: 10.14 };
    assert.equal((await judgeAndPost({ circle: w.circle, found: [cheap], catalog, cfg: WORLD_CFG, log: () => {} })).posted, 0, 'and the $71 week stays out too');
  } finally { w.close(); }
});

test('THE STAYS LIST: one Getaways search for Aruba, the weeks at places the Circle has are posted, the rest are named and not', e2e, async () => {
  const w = await world();
  try {
    const r = await w.scanner.aruba(catalog);
    assert.equal(r.ran, true);
    assert.equal(r.covered, true);
    assert.equal(w.iv.S.searches.length, 2, 'one search for the whole island, and one more for later dates because resorts showed a full page — one scan');
    assert.equal(w.iv.S.searches[0].searchType, 'CitySearch', '"Single Destination", as the form comes');
    assert.equal(w.iv.S.searches[0].searchCriteria, 'Aruba, ANT');
    assert.equal(r.rows, 15, 'the fifteen Aruba weeks on the page — not the twelve under "areas surrounding Aruba"');
    // Radisson (RBK) 3 rows -> 2 weeks, Eagle (LC2) 2 -> 2 weeks; Caribbean Palm Village, the two Divi Villages and Divi Phoenix are not in this catalog.
    assert.equal(w.sb.S.posts.length, 4);
    assert.deepEqual([...new Set(w.sb.S.posts.map((p) => p.p_stay))].sort(), ['stay-eagle', 'stay-rbk']);
    assert.ok(w.sb.S.posts.every((p) => p.p_source === 'interval' && /resortCode=(RBK|LC2)$/.test(p.p_source_url)));
    assert.equal(r.unplaced, 10, 'ten weeks at places not in the catalog');
    const said = w.lines.find((l) => /places not in the catalog/.test(l));
    assert.match(said, /Caribbean Palm Village \(CPV\)/);
    assert.match(said, /Divi Dutch Village Beach Resort \(TD4\)/);
    assert.doesNotMatch(w.sb.S.posts.map((p) => p.p_title).join('|'), /Cancun|Fives/);
    // Ten members opening the list is one read: the second is served from it.
    w.clock.t += min(3);
    const again = await w.scanner.aruba(catalog);
    assert.deepEqual([again.ran, again.covered], [false, true]);
    assert.match(again.why, /scanned 3 min ago — served from that scan/);
    assert.equal(w.iv.S.searches.length, 2, 'and asked Interval nothing more');
  } finally { w.close(); }
});

test('a run that does not sign in reuses a saved session, and with none says so and goes nowhere near Interval', e2e, async () => {
  const w = await world();
  try {
    const nosignin = w.mk(false);
    const none = await nosignin.aruba(catalog);
    assert.equal(none.noSession, true);
    assert.match(none.why, /no usable saved Interval session, and this run does not sign in/);
    assert.equal(w.iv.S.hits.length, 0, 'no request at all: not the login page, not the landing page');
    assert.equal(existsSync(w.stopFile), false, 'having no session is not a stop');
    // Somebody else signs in and saves a session (here: an ordinary scan does); the next run reuses it.
    w.clock.t += min(31);
    const [row] = await w.tap(RBK);
    assert.equal(row.scan.covered, true);
    assert.equal(w.ivHits(/POST \/web\/my\/auth\/login$/), 1);
    w.clock.t += min(31);
    const reuse = await nosignin.aruba(catalog);
    assert.equal(reuse.covered, true, reuse.why);
    assert.equal(w.ivHits(/POST \/web\/my\/auth\/login$/), 1, 'still one sign-in: the saved session was used');
    // And an expired one stops it there, without signing in.
    w.iv.S.sessions.clear(); w.clock.t += min(31);
    const expired = await nosignin.aruba(catalog);
    assert.equal(expired.noSession, true);
    assert.equal(w.ivHits(/POST \/web\/my\/auth\/login$/), 1, 'no sign-in on an expired session either');
  } finally { w.close(); }
});

// ================================================================ the dates: the planner, and one scan with several searches
// Victor, 22 Oct 2026: "I'd like to see a month or two in advance." A tap carries the dates; the scan searches for
// them. Interval shows three rows a resort per results page, soonest first (read off the saved 17 Oct page), so a
// search over two months shows the next three weeks and stops: the scan goes on from where each full page ended.
test('the window a scan searches: the member\'s, from no earlier than today, no longer than a year; none given is today + 60 days', () => {
  const now = Date.parse('2026-10-22T16:00:00Z');           // noon in Aruba, 22 Oct
  assert.deepEqual(planWindow({ from: '2026-12-20', to: '2027-01-03' }, now), { from: '2026-12-20', to: '2027-01-03', asked: true });
  assert.deepEqual(planWindow({ from: '2026-10-01', to: '2026-11-10' }, now), { from: '2026-10-22', to: '2026-11-10', asked: true }, 'a start in the past moves to today');
  assert.deepEqual(planWindow(null, now), { from: '2026-10-22', to: '2026-12-21', asked: false }, 'no dates: two months, the same as the app\'s own default');
  for (const bad of [{ from: '2026-12-10', to: '2026-12-01' }, { from: '2026-09-01', to: '2026-10-01' }, { from: 'soon', to: 'later' }, { from: '2026-12-01' }]) {
    assert.equal(planWindow(bad, now).asked, false, JSON.stringify(bad));
  }
  assert.equal(planWindow({ from: '2026-11-01', to: '2031-01-01' }, now).to, '2027-11-02', 'cut to a year');
  assert.equal(planWindow({ from: '2026-10-21', to: '2026-10-25' }, Date.parse('2026-10-23T02:00:00Z')).from, '2026-10-22', 'Aruba\'s day, not the UTC one: 22:00 on the 22nd is still the 22nd');
  assert.deepEqual({ ...SCAN }, { defaultDays: 60, maxDays: 366, maxSearches: 5, maxPages: 3 });
});

const stat = (code, rows, lastCheckIn, nearby = false) => ({ code, nearby, rows, lastCheckIn });
test('the next search starts where the earliest full page ended; a page that was not full needs no more', () => {
  assert.equal(PAGE_ROWS, 3);
  // RBK showed three rows up to 15 Nov, LC2 showed two (all it has): search again from the 15th.
  assert.equal(nextCursor([stat('RBK', 3, '2026-11-15'), stat('LC2', 2, '2026-11-22')], '2026-10-22', '2026-12-21'), '2026-11-15');
  // Two full pages: nothing is missing before the EARLIER of their last dates.
  assert.equal(nextCursor([stat('RBK', 3, '2026-11-15'), stat('DV2', 3, '2026-11-08')], '2026-10-22', '2026-12-21'), '2026-11-08');
  assert.equal(nextCursor([stat('RBK', 2, '2026-11-15')], '2026-10-22', '2026-12-21'), null, 'not full: everything is shown');
  assert.equal(nextCursor([], '2026-10-22', '2026-12-21'), null);
  assert.equal(nextCursor([stat('RBK', 3, '2026-12-19')], '2026-10-22', '2026-12-18'), null, 'past the end of the window');
  assert.equal(nextCursor([stat('FVS', 3, '2026-11-15', true)], '2026-10-22', '2026-12-21'), null, 'a resort under "areas surrounding" is not the place asked for');
  assert.equal(nextCursor([stat('LCB', 3, '2026-11-15')], '2026-10-22', '2026-12-21', (c) => c === 'RBK'), null, 'nor one this scan is not about');
  // Always forward: three rows all on the cursor's own day still moves on.
  assert.equal(nextCursor([stat('RBK', 3, '2026-10-22')], '2026-10-22', '2026-12-21'), '2026-10-23');
  assert.equal(nextCursor([stat('RBK', 3, '2026-10-10')], '2026-10-22', '2026-12-21'), '2026-10-23', 'even when the page says something older');
});

test('the real 17 Oct page, read as a page: ten resorts, never more than three rows each, and the twelve nearby weeks are after the marker', () => {
  const stats = pageStats(results);
  assert.equal(stats.length, 10);
  assert.ok(stats.every((s) => s.rows <= PAGE_ROWS));
  const rbk = stats.find((s) => s.code === 'RBK');
  assert.deepEqual([rbk.rows, rbk.lastCheckIn, rbk.nearby], [3, '2026-11-06', false]);
  assert.deepEqual(stats.filter((s) => s.nearby).map((s) => s.code), ['AWA', 'FVE', 'FVD', 'FVS']);
  assert.deepEqual(saturated(stats, (c) => c in INTERVAL_ARUBA).map((s) => s.code).sort(), ['CPV', 'DV2', 'RBK', 'TD4'], 'the Aruba resorts that showed a full page; LC2 (2 rows) and DP1 (1) showed all they have');
  assert.equal(reachedNearby(results), true);
  assert.equal(reachedNearby(LANDING), false);
});

/** A results page in the markup the parser reads: the form (a person changes the dates from it), the resorts, the pager. */
const row = (a, b, price, id = 'resortallInclusive_false') => `<tr class="bottom_border ${id}"><td><div class="avail_dates">${a} - ${b}</div></td><td>US$${price}</td></tr>`;
const gw = (resorts, { nearby = false, next = false } = {}) => LANDING.replace('</body>',
  resorts.map(([code, name, rows]) => `<div class="resort_header_row_2 ${code}"><img class="results_thumbnail" alt="${name}"><table>${rows.map((r) => row(...r)).join('')}</table></div>`).join('')
  + (nearby ? '<h2 id="resorts_nearby">Areas Surrounding Aruba</h2>' : '')
  + (next ? '<div class="menu_page_result"><ul><li><a href="/web/cs?a=1014&amp;p=2">Next Page</a></li></ul></div>' : '') + '</body>');
const RBK_NAME = 'Radisson Blu Aruba';
const RBK_P1 = gw([['RBK', RBK_NAME, [['Nov 01 2026', 'Nov 08 2026', '1,500.00'], ['Nov 08 2026', 'Nov 15 2026', '1,520.00'], ['Nov 15 2026', 'Nov 22 2026', '1,540.00']]]]);
const RBK_P2 = gw([['RBK', RBK_NAME, [['Nov 15 2026', 'Nov 22 2026', '1,540.00'], ['Nov 22 2026', 'Nov 29 2026', '1,560.00']]]]);

test('A TAP WITH DATES: the Getaways form gets those dates, and a resort that showed a full page is searched again from where it ended — one scan, two searches, one sign-in', e2e, async () => {
  const w = await world();
  w.iv.S.pages = [RBK_P1, RBK_P2];
  try {
    const t0 = w.clock.t;
    const row1 = (await w.tap(RBK, 0, { from: '2026-11-01', to: '2026-12-15' }))[0];
    assert.equal(row1.scan.ran, true, row1.scan.why);
    assert.equal(w.ivHits(/POST \/web\/my\/auth\/login$/), 1, 'one sign-in');
    assert.equal(w.iv.S.searches.length, 2, 'two searches in the one scan');
    assert.deepEqual([w.iv.S.searches[0].fromDate, w.iv.S.searches[0].toDate], ['11/01/2026', '12/15/2026'], 'the member\'s dates, typed the way the form takes them');
    assert.deepEqual([w.iv.S.searches[1].fromDate, w.iv.S.searches[1].toDate], ['11/15/2026', '12/15/2026'], 'then from the check-in date the full page ended on');
    assert.ok(w.iv.S.searches.every((s) => s.searchType === 'ResortSearch' && s.searchCriteria === 'RBK'));
    // Every week from both pages reached the board, through post_deal, once: 15 Nov was on both pages.
    assert.deepEqual(w.sb.S.posts.map((p) => p.p_from).sort(), ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22']);
    assert.equal(row1.scan.posted, 4);
    assert.deepEqual(row1.scan.window, { from: '2026-11-01', to: '2026-12-15' });
    assert.ok(w.lines.some((l) => /searching RBK for 2026-11-01 to 2026-12-15$/.test(l)));
    assert.ok(w.lines.some((l) => /may be more weeks — searching again from 2026-11-15/.test(l)));
    // What the scan covered is written down, and a tap for dates inside it is served from it.
    const st = JSON.parse(readFileSync(w.stateFile, 'utf8'));
    assert.deepEqual(st.last.RBK.covers, { from: '2026-11-01', to: '2026-12-15' });
    assert.equal(st.last.RBK.searches, 2);
    const inside = (await w.tap(RBK, min(5), { from: '2026-11-10', to: '2026-12-01' }))[0];
    assert.deepEqual([inside.scan.ran, inside.scan.covered], [false, true], 'dates inside what was searched: served from the scan');
    // Dates that reach beyond it are NOT covered by it, and Interval is not asked again inside the 30 minutes.
    const hits = w.iv.S.hits.length;
    const beyond = (await w.tap(RBK, min(5), { from: '2026-11-10', to: '2027-02-01' }))[0];
    assert.deepEqual([beyond.scan.ran, beyond.scan.covered], [false, false]);
    assert.match(beyond.scan.why, /scanned 10 min ago for 2026-11-01 to 2026-12-15; 2026-11-10 to 2027-02-01 reaches beyond that — not asking Interval again before 30 minutes are up/);
    assert.equal(w.iv.S.hits.length, hits, 'not one request');
    assert.equal(w.nudges().length, 1, 'and so the Grab nudge fires for that tap, as it always does when Interval was not read for it');
    void t0;
  } finally { w.close(); }
});

test('no dates sent (an older phone): the scan searches today to two months on, and says so', e2e, async () => {
  const w = await world();
  try {
    const row1 = (await w.tap(RBK))[0];
    assert.equal(row1.scan.ran, true, row1.scan.why);
    const today = new Date(w.clock.t - 4 * 3600e3).toISOString().slice(0, 10);
    const us = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
    assert.equal(w.iv.S.searches[0].fromDate, us(today));
    assert.ok(w.lines.some((l) => /searching RBK for .* \(no dates were given\)/.test(l)));
  } finally { w.close(); }
});

test('ONE SCAN IS AT MOST FIVE SEARCHES: when every page is full it stops, says how far the weeks are known, and covers no further than that', e2e, async () => {
  const w = await world();
  // Every search shows a full page that ends a week later than the last one did.
  const page = (k) => gw([['RBK', RBK_NAME, [0, 1, 2].map((i) => {
    const d = (n) => new Date(Date.parse('2026-11-01T12:00:00Z') + (k * 7 + n) * 864e5).toISOString().slice(0, 10);
    const w2 = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }).replace(',', '');
    return [w2(d(i * 7)), w2(d(i * 7 + 7)), `${1500 + k * 10 + i}.00`];
  })]]);
  w.iv.S.pages = [0, 1, 2, 3, 4, 5, 6, 7].map(page);
  try {
    const row1 = (await w.tap(RBK, 0, { from: '2026-11-01', to: '2027-10-01' }))[0];
    assert.equal(row1.scan.ran, true, row1.scan.why);
    assert.equal(w.iv.S.searches.length, SCAN.maxSearches, 'five and no more');
    assert.ok(w.lines.some((l) => /5 searches is the most one scan makes — weeks are known up to \d{4}-\d\d-\d\d, not to 2027-10-01/.test(l)));
    const st = JSON.parse(readFileSync(w.stateFile, 'utf8'));
    assert.ok(st.last.RBK.covers.to < '2027-10-01' && st.last.RBK.covers.to > '2026-11-01', `covers up to ${st.last.RBK.covers.to}, not the whole year`);
    // The count against the caps is ONE scan.
    assert.equal(st.scanLog.length, 1);
    assert.equal(Object.keys(st.scans).length, 1);
    assert.equal(w.ivHits(/POST \/web\/my\/auth\/login$/), 1);
  } finally { w.close(); }
});

test('--interval-read makes ONE search, as it always did, however many full pages there are', e2e, async () => {
  const w = await world();
  try {
    const one = w.mk(false);                                    // canSignIn false: it needs a saved session
    const solo = makeIntervalScanner({ armed: () => true, canSignIn: true, maxSearches: 1, stateFile: w.stateFile, now: () => w.clock.t, log: () => {},
      makeSession: () => new IntervalSession({ origin: w.iv.url, stateFile: w.sessionFile, browser: ENGINE, requireProxy: false, getProxy: () => null,
        getCreds: () => ({ user: 'u', pass: 'p' }), onlyHosts: ['127.0.0.1'], waits: FAST }),
      post: ({ finds, catalog: c }) => judgeAndPost({ circle: w.circle, found: finds, catalog: c, cfg: WORLD_CFG, log: () => {} }),
      onStop: async () => {} });
    void one;
    const r = await solo(RBK, catalog);
    assert.equal(r.ran, true, r.why);
    assert.equal(w.iv.S.searches.length, 1, 'RBK showed a full page; with maxSearches 1 the scan still stops after the first search');
  } finally { w.close(); }
});

test('THE STAYS LIST with dates: the island search follows the pager while the places are still Aruba, and never into "areas surrounding"', e2e, async () => {
  const w = await world();
  const p1 = gw([['RBK', RBK_NAME, [['Nov 01 2026', 'Nov 08 2026', '1,500.00']]]], { next: true });          // not full, no nearby: a second page exists
  const p2 = gw([['LC2', 'Eagle Aruba Resort', [['Nov 20 2026', 'Nov 27 2026', '1,600.00']]]], { nearby: true, next: true });   // reaches the surrounding areas: stop
  w.iv.S.pages = [p1]; w.iv.S.pager = { 2: p2, 3: gw([['TD4', 'Divi Dutch Village Beach Resort', [['Nov 21 2026', 'Nov 28 2026', '1,700.00']]]]) };
  try {
    const r = await w.scanner.aruba(catalog, { from: '2026-11-01', to: '2026-12-15' });
    assert.equal(r.ran, true, r.why);
    assert.deepEqual(w.iv.S.nexts, ['2'], 'page two was asked for; page three was not, because page two had reached the areas surrounding Aruba');
    assert.deepEqual(w.sb.S.posts.map((p) => p.p_stay).sort(), ['stay-eagle', 'stay-rbk'], 'weeks from both pages reached the board');
    assert.equal(w.iv.S.searches.length, 1, 'neither page was full, so no later dates were searched');
    assert.deepEqual([w.iv.S.searches[0].fromDate, w.iv.S.searches[0].toDate], ['11/01/2026', '12/15/2026']);
    assert.equal(w.iv.S.searches[0].searchType, 'CitySearch');
  } finally { w.close(); }
});

test('the pager is followed at most three pages deep', e2e, async () => {
  const w = await world();
  const more = (code, name) => gw([[code, name, [['Nov 01 2026', 'Nov 08 2026', '1,500.00']]]], { next: true });
  w.iv.S.pages = [more('RBK', RBK_NAME)];
  w.iv.S.pager = { 2: more('LC2', 'Eagle Aruba Resort'), 3: more('TD4', 'Divi Dutch Village Beach Resort'), 4: more('DV2', 'Divi Village Golf and Beach Resort') };
  try {
    const r = await w.scanner.aruba(catalog);
    assert.equal(r.ran, true, r.why);
    assert.equal(w.iv.S.nexts.length, SCAN.maxPages - 1, 'three pages in all: the search and two Next Page presses');
  } finally { w.close(); }
});

test('a wall on a LATER search stops everything, the same as on the first', e2e, async () => {
  const w = await world();
  w.iv.S.pages = [RBK_P1, CHALLENGE];
  try {
    const r = (await w.tap(RBK, 0, { from: '2026-11-01', to: '2026-12-15' }))[0];
    assert.equal(r.scan.stopped, true);
    assert.ok(existsSync(w.stopFile));
    assert.equal(w.iv.S.searches.length, 2, 'it asked once more, met the wall, and stopped');
    assert.equal(w.stopPushes().length, 1);
    const hits = w.iv.S.hits.length;
    await w.tap(RBK, min(40), { from: '2026-11-01', to: '2026-12-15' });
    assert.equal(w.iv.S.hits.length, hits, 'and nothing asks Interval again');
  } finally { w.close(); }
});

test('nothing in this file reached a real host', () => {
  assert.deepEqual(tried, []);
});
