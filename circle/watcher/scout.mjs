#!/usr/bin/env node
// The Circle's deal scout, v1. Collect -> judge -> post -> (shadow) e-mail -> learn (data only; no model calls).
//
//   node scout.mjs --collect [--dry] [--only name]   one pass over the sources (cron: 07:15 and 19:15 Aruba)
//   node scout.mjs --digest  [--dry]                 the 08:00 digest of great/good deals (cron)
//   node scout.mjs --score                           write the weekly per-source score file (cron, Mondays)
//
// A 403, 429, challenge page or timeout is a full stop for THAT source for 24 hours, logged, no retry.
// Nothing here signs in to Interval or RedWeek. See research/deal-scout/plan.md.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './dotenv.mjs';
import { Circle } from './circle.mjs';
import { judgeAndPost } from './board.mjs';
import { parseFeed } from './scout-feeds.mjs';
import { judgeItem, judgeListing, arubaToday } from './scout-judge.mjs';
import { digestMail, instantMail, sendMail, VICTOR } from './scout-mail.mjs';
import { pushSupers, supersOf } from './scout-super.mjs';
import { makePusher } from './taps.mjs';
import { runWatchMail, memberMailMode } from './watch-mail.mjs';
import { availability, RESORTS } from '../js/data/vakaymood.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DAY = 864e5;
export const UA = 'InnerHotelCircleScout/1.0';
// Reddit and the two blogs are tips or flights; their feeds are read the same way. Going publishes no feed (mail only).
export const FEEDS = [
  { name: 'travelzoo', url: 'https://www.travelzoo.com/feed/' },
  { name: 'holidaypirates', url: 'https://www.holidaypirates.com/feed' },
  { name: 'secretflying', url: 'https://www.secretflying.com/feed/' },
  { name: 'reddit-aruba', url: 'https://www.reddit.com/r/Aruba/new.rss', tipOnly: true },
  { name: 'reddit-timeshare', url: 'https://www.reddit.com/r/timeshare/new.rss', tipOnly: true },
];
export const SOURCES = [...FEEDS.map((f) => f.name), 'vakaymood'];
const MIN_GAP = 15 * 60e3, MAX_TIPS = 5, MAX_INSTANT = 3;

// ------------------------------------------------------------------ state: one small file, git-ignored
export const emptyState = () => ({ sources: {}, items: {}, stats: {}, lastDigest: 0 });
export function loadState(file) { try { return { ...emptyState(), ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { return emptyState(); } }
export function saveState(file, s) { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(s, null, 1), { mode: 0o600 }); renameSync(tmp, file); }

/** Full stop for one source: 24 hours, the reason kept. */
export function stopSource(state, name, why, now) {
  const s = (state.sources[name] ||= {});
  s.backoffUntil = now + DAY; s.why = why; s.stoppedAt = now;
}
export const stopped = (state, name, now) => (state.sources[name]?.backoffUntil || 0) > now;

/** Fetch one feed. Never throws: { ok, items } or { ok:false, why }. A wall of any kind is a stop, not a retry. */
export async function readFeed(feed, fetchFn = fetch) {
  try {
    const res = await fetchFn(feed.url, { headers: { 'user-agent': UA, accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
    const body = await res.text();
    if (res.status === 403 || res.status === 429 || res.status === 503) return { ok: false, why: `HTTP ${res.status}` };
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    if (/just a moment|captcha|unusual activity|access denied|are you a human/i.test(body.slice(0, 4000)) && !/<(rss|feed)\b/i.test(body.slice(0, 600))) return { ok: false, why: 'challenge page' };
    return { ok: true, items: parseFeed(body) };
  } catch (e) { return { ok: false, why: e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : e.message }; }
}

const bump = (state, name, k, n = 1, now = Date.now()) => {
  const wk = isoWeek(now);
  const o = ((state.stats[name] ||= {})[wk] ||= { runs: 0, seen: 0, great: 0, good: 0, tip: 0, reject: 0, drop: 0 });
  o[k] = (o[k] || 0) + n;
};
export function isoWeek(ms) {
  const d = new Date(ms - 4 * 3600e3); d.setUTCHours(12);
  const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd + 3);
  const y = d.getUTCFullYear(), jan4 = new Date(Date.UTC(y, 0, 4, 12));
  return `${y}-W${String(1 + Math.round((d - jan4) / (7 * DAY) + ((jan4.getUTCDay() + 6) % 7 - 3) / 7)).padStart(2, '0')}`;
}

/**
 * Record one judged thing. New items are counted once; items seen again just move their clock.
 * Returns the state item (new or old).
 */
export function note(state, name, key, j, extra, now) {
  const old = state.items[key];
  if (old) { old.last = now; return old; }
  bump(state, name, 'seen', 1, now); bump(state, name, j.cls, 1, now);
  return (state.items[key] = { src: name, first: now, last: now, cls: j.cls, why: j.why, pct: j.pct, super: !!j.super, find: j.find, ...extra });
}

// ------------------------------------------------------------------ the pass
export async function collect({ state, catalog, cfg, now = Date.now(), log, only = null, fetchFn = fetch, vakay = availability }) {
  const fresh = [];
  for (const feed of FEEDS) {
    if (only && only !== feed.name) continue;
    const st = (state.sources[feed.name] ||= {});
    if (stopped(state, feed.name, now)) { log(`${feed.name}: stopped until ${new Date(st.backoffUntil).toISOString().slice(0, 16)}Z (${st.why})`); continue; }
    if (now - (st.lastFetch || 0) < MIN_GAP) { log(`${feed.name}: read ${Math.round((now - st.lastFetch) / 6e4)} min ago, not again`); continue; }
    st.lastFetch = now;
    const r = await readFeed(feed, fetchFn);
    if (!r.ok) { stopSource(state, feed.name, r.why, now); log(`${feed.name}: ${r.why} -> full stop, back off 24 h`); continue; }
    if (!r.items.length) {
      st.parseFails = (st.parseFails || 0) + 1;
      if (st.parseFails >= 2) { stopSource(state, feed.name, 'no items parsed twice in a row', now); log(`${feed.name}: no items twice -> stopped until a person looks`); } else log(`${feed.name}: answered but no items parsed`);
      continue;
    }
    st.parseFails = 0; st.lastOk = now; bump(state, feed.name, 'runs', 1, now);
    const c = { items: r.items.length, new: 0, great: 0, good: 0, tip: 0, reject: 0, drop: 0 };
    for (const it of r.items) {
      const key = `${feed.name}:${it.id}`;
      if (state.items[key]) { state.items[key].last = now; continue; }
      const j = judgeItem(it, { catalog, cfg, now, source: feed.name, tipOnly: feed.tipOnly });
      // Dropped items are counted but not kept: the state file would otherwise grow by a feed a day.
      if (j.cls === 'drop') { bump(state, feed.name, 'seen', 1, now); bump(state, feed.name, 'drop', 1, now); c.new++; c.drop++; continue; }
      const item = note(state, feed.name, key, j, { title: it.title, url: it.link, price: j.price?.amount, nights: j.nights }, now);
      c.new++; c[j.cls]++; fresh.push(item);
      if (j.cls === 'reject') log(`  rejected ${feed.name}: "${it.title.slice(0, 70)}" ${j.why}`);
    }
    log(`${feed.name}: ${c.items} items, ${c.new} new -> great ${c.great}, good ${c.good}, tip ${c.tip}, rejected ${c.reject}, not ours ${c.drop}`);
  }
  if (!only || only === 'vakaymood') await collectVakay({ state, catalog, cfg, now, log, fresh, vakay });
  return fresh;
}

async function collectVakay({ state, catalog, cfg, now, log, fresh, vakay }) {
  const st = (state.sources.vakaymood ||= {});
  if (stopped(state, 'vakaymood', now)) { log(`vakaymood: stopped until ${new Date(st.backoffUntil).toISOString().slice(0, 16)}Z (${st.why})`); return; }
  if (now - (st.lastFetch || 0) < MIN_GAP) { log('vakaymood: read a moment ago, not again'); return; }
  st.lastFetch = now;
  const c = { listings: 0, new: 0, great: 0, good: 0, tip: 0, reject: 0, drop: 0 };
  const LIMIT = 20, seenNow = new Set();
  for (const r of RESORTS.filter((x) => x.stayId)) {
    let res;
    try { res = await vakay({ slug: r.slug, sort: 'price_asc', limit: LIMIT }); }
    catch (e) { stopSource(state, 'vakaymood', e.message, now); log(`vakaymood: ${e.message} -> full stop, back off 24 h`); return; }
    c.listings += res.deals.length;
    const dearest = Math.max(0, ...res.deals.map((d) => d.usdTotal));
    for (const l of res.deals) {
      const key = `vakaymood:${l.externalId}`; seenNow.add(key);
      if (state.items[key]) { state.items[key].last = now; continue; }
      const j = judgeListing(l, { catalog, cfg, now });
      c.new++; c[j.cls]++;
      // A VakayMood listing with no comparable room is not a tip: there is nothing to say about it. Counted, not kept.
      if (j.cls === 'drop' || j.cls === 'tip') { bump(state, 'vakaymood', 'seen', 1, now); bump(state, 'vakaymood', 'drop', 1, now); continue; }
      fresh.push(note(state, 'vakaymood', key, j, { title: `${l.resortName} ${l.from}`, slug: l.slug, url: l.bookingUrl, nights: l.nights, price: l.usdTotal }, now));
      if (j.cls === 'reject') log(`  rejected vakaymood ${l.externalId}: ${j.why}`);
    }
    // A listing is only "gone" if the cheapest-first page was complete enough to have shown it.
    (st.pages ||= {})[r.slug] = { all: res.deals.length < LIMIT, dearest };
  }
  st.lastOk = now; st.parseFails = 0; bump(state, 'vakaymood', 'runs', 1, now);
  // Vanished: a great/good listing this pass did not return, from a page that would have shown it.
  for (const [k, it] of Object.entries(state.items)) {
    if (it.src !== 'vakaymood' || !['great', 'good'].includes(it.cls) || it.goneAt || seenNow.has(k)) continue;
    const page = st.pages?.[it.slug];
    if (page && (page.all || it.find.usdTotal <= page.dearest)) it.goneAt = now;
  }
  log(`vakaymood: ${c.listings} listings, ${c.new} new -> great ${c.great}, good ${c.good}, tip ${c.tip}, rejected ${c.reject}, under 15% off ${c.drop}`);
}

// ------------------------------------------------------------------ post + tips + mail
export async function post({ circle, catalog, cfg, state, fresh, log, dry }) {
  const worth = fresh.filter((i) => (i.cls === 'great' || i.cls === 'good') && i.find);
  if (!worth.length) { log('post: nothing great or good this pass'); return; }
  const scoutCfg = { ...cfg, mustBeatOurs: true, beatBy: 0.15, maxPerResortMonth: 3 };
  const copies = worth.map((i) => ({ ...i.find, seenNote: `Scout: ${i.src}, seen ${new Date(i.last).toISOString().slice(0, 16)}Z; check again before acting` }));
  const res = await judgeAndPost({ circle, found: copies, catalog, cfg: scoutCfg, log, dry });
  worth.forEach((i, n) => { if (copies[n].ourPrice) i.find.ourPrice = copies[n].ourPrice; });
  if (dry || !circle) return;
  const refs = (await circle.knownRefs()).refs;
  for (const i of worth) {
    const ext = String(i.find.externalId), ref = ext.startsWith(`${i.find.source}:`) ? ext : `${i.find.source}:${ext}`;
    if (refs.has(ref)) { i.onBoard = true; i.ref = ref; i.postedAt ||= Date.now(); }
  }
  log(`post: ${res.posted} new on the board, ${worth.filter((i) => i.onBoard).length} of ${worth.length} great/good are there`);
}

export function tipText(i) {
  const price = i.price ? ` $${Math.round(i.price)}${i.nights ? ` for ${i.nights} nights` : ''}.` : '';
  return `Tip, not checked: ${i.title}.${price} Source ${i.src}, seen ${new Date(i.last).toISOString().slice(0, 16).replace('T', ' ')}Z. ${i.why}, so there is no public rate to measure it against. ${i.url}`;
}
export function sendTips({ state, fresh, log, dry, run = (args) => execFileSync('/root/bin/room.js', args, { encoding: 'utf8', timeout: 30000 }) }) {
  const tips = fresh.filter((i) => i.cls === 'tip' && !i.tipped).sort((a, b) => (b.price ? 1 : 0) - (a.price ? 1 : 0)).slice(0, MAX_TIPS);
  for (const i of tips) {
    const text = tipText(i);
    if (dry) { log(`  would post to #deals: ${text.slice(0, 160)}`); continue; }
    try { run(['post', 'deals', text, '--as', 'Deal scout']); i.tipped = Date.now(); }
    catch (e) { log(`  #deals refused or failed: ${String(e.message).split('\n')[0].slice(0, 160)}`); }
  }
  log(`tips: ${tips.length} ${dry ? 'would go' : 'sent'} to #deals (${fresh.filter((i) => i.cls === 'tip').length} tip-only found, cap ${MAX_TIPS})`);
}

export function boxSecret(name) {
  const v = execFileSync('sudo', ['-u', 'openclaw', 'node', '-e', `process.stdout.write(require('/home/openclaw/premanifest-bot/webapp/doors.js').secretRead(${JSON.stringify(name)})||'')`], { encoding: 'utf8' });
  if (!v) throw new Error(`the locked box has no '${name}' secret`);
  return v.replace(/\s+/g, '');
}
export const appPassword = () => boxSecret('circle');

/** Mail `list` (state items) with `compose`; mark them with `flag`. Shadow mode sends Victor only. */
async function mail({ list, compose, flag, state, cfg, log, dry, send = sendMail }) {
  if (!list.length) return [];
  const sent = [];
  let pass = null;
  for (const m of compose(list)) {
    if (dry) { log(`  would e-mail ${VICTOR}: ${m.subject}`); continue; }
    pass ||= appPassword();
    const r = await send({ to: VICTOR, subject: m.subject, text: m.text, pass, shadow: cfg.shadow });
    sent.push(r); log(`  e-mailed ${VICTOR}: ${r.subject}`); for (const l of r.log) log(`    smtp ${l}`);
    for (const i of m.items) i[flag] = Date.now();
  }
  return sent;
}
export const instants = (items) => items.filter((i) => i.cls === 'great' && i.onBoard && !i.mailedInstant && !i.goneAt && i.find.from >= arubaToday()).sort((a, b) => b.pct - a.pct).slice(0, MAX_INSTANT);
export const forDigest = (state, now = Date.now()) => Object.values(state.items).filter((i) => (i.cls === 'great' || i.cls === 'good') && i.onBoard && !i.mailedDigest && !i.mailedInstant && !i.goneAt && i.find.from >= arubaToday(now) && now - i.last < 2 * DAY).sort((a, b) => b.pct - a.pct).slice(0, 10);

/**
 * Re-judge every scout row on the board with the current rules; retire those that no longer qualify (robot RPC retire_deals_gone).
 * Only rows the scout itself posted (state.items with a ref), never a Desk or RedWeek row.
 */
export async function rejudge({ state, catalog, cfg, circle, log, dry, now = Date.now() }) {
  const mine = Object.values(state.items).filter((i) => i.onBoard && i.ref && (i.cls === 'great' || i.cls === 'good') && !i.goneAt);
  const drop = [];
  for (const i of mine) {
    const f = i.find;
    const j = judgeListing({ externalId: f.externalId, resortName: f.resortName, unitType: f.unit, sleeps: f.sleeps, from: f.from, to: f.to, nights: f.nights, usdTotal: f.usdTotal, bookingUrl: f.url, usdFees: f.fees }, { catalog, cfg, now });
    if (j.cls === 'great' || j.cls === 'good') { i.cls = j.cls; i.pct = j.pct; i.super = !!j.super; i.find = { ...f, ...j.find, source: f.source, externalId: f.externalId }; continue; }
    drop.push(i); log(`  retire ${f.resortName} ${f.unit || ''} ${f.from}: ${j.why}`);
  }
  if (drop.length && !dry) {
    await circle.retireGone(drop.map((i) => i.ref), 're-judged: not under the public rate');
    for (const i of drop) { i.goneAt = now; i.cls = 'rejudged'; }
  }
  return { before: mine.length, keep: mine.length - drop.length, retired: drop.length };
}

// ------------------------------------------------------------------ learn (data only)
export function scores(state, week, { liveStatus = {}, taps = [] } = {}) {
  const out = {};
  for (const name of SOURCES) {
    const s = state.stats[name]?.[week] || {};
    const mine = Object.values(state.items).filter((i) => i.src === name && i.onBoard);
    const tapped = mine.reduce((n, i) => n + taps.filter((t) => t.stay === i.find?.stayId && Date.parse(t.at) >= i.postedAt).length, 0);
    const quick = mine.filter((i) => (i.goneAt && i.goneAt - i.first < 2 * DAY) || (liveStatus[i.ref]?.retired && Date.parse(liveStatus[i.ref].retired) - i.postedAt < 2 * DAY)).length;
    out[name] = { runs: s.runs || 0, items_seen: s.seen || 0, great: s.great || 0, good: s.good || 0, tip: s.tip || 0, rejected_implausible: s.reject || 0, not_ours_or_no_price: s.drop || 0,
      on_board: mine.length, stay_taps_after_posting: tapped, retired_within_48h: quick,
      hit_rate: s.seen ? Math.round(((s.great || 0) + (s.good || 0)) / s.seen * 1000) / 1000 : null,
      stopped: stopped(state, name, Date.now()) ? state.sources[name].why : null };
  }
  return out;
}

// ------------------------------------------------------------------ main
async function main() {
  const args = process.argv.slice(2), has = (a) => args.includes(a);
  const DRY = has('--dry'), only = args[args.indexOf('--only') + 1] && has('--only') ? args[args.indexOf('--only') + 1] : null;
  loadEnv(join(HERE, '.env'));
  const STATE = process.env.SCOUT_STATE || join(HERE, '.scout-state.json');
  const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);
  const cfg = { minNightly: 40, maxPlausibleNightly: 1500, pointsPerUsd: Number(process.env.CIRCLE_POINTS_PER_DOLLAR) || 100,
    shadow: !/^(false|no|0|off)$/i.test(process.env.SCOUT_SHADOW || '') };
  const state = loadState(STATE), now = Date.now();
  const circle = new Circle({ url: process.env.CIRCLE_URL, key: process.env.CIRCLE_KEY, username: process.env.CIRCLE_USER, password: process.env.CIRCLE_PASS });
  const catalog = new Map((await circle.stays()).map((r) => [r.id, r]));
  // Rooms by stay, for like-for-like baselines (scout-judge.mjs baselineFor).
  const rr = await circle.call('/rest/v1/room_types?select=stay_id,bedrooms,rate_factor&active=eq.true&limit=1000');
  if (!rr.ok) throw new Error(`Could not read the room types: ${rr.status}`);
  cfg.rooms = new Map(); for (const r of await rr.json()) (cfg.rooms.get(r.stay_id) || cfg.rooms.set(r.stay_id, []).get(r.stay_id)).push(r);
  log(`scout: ${has('--digest') ? 'digest' : has('--score') ? 'score' : has('--watch-mail') ? 'watch mail' : has('--rejudge') ? 'rejudge' : 'collect'}${DRY ? ' (dry run)' : ''}, shadow mail ${cfg.shadow ? 'on' : 'OFF'}, ${catalog.size} places in the catalog`);

  try {
  if (has('--collect')) {
    const fresh = await collect({ state, catalog, cfg, now, log, only });
    await post({ circle, catalog, cfg, state, fresh, log, dry: DRY });
    if (!has('--no-tips')) sendTips({ state, fresh, log, dry: DRY });
    const p = await pushSupers({ items: supersOf(Object.values(state.items)), pusher: makePusher(), file: join(HERE, '.scout-super.json'), log, dry: DRY });
    log(`super: ${p.sent} pushed, ${p.held} held for the night, ${p.skipped} skipped (already sent or over the day's cap)`);
    await mail({ list: instants(Object.values(state.items)), compose: (l) => l.map((i) => ({ ...instantMail(i), items: [i] })), flag: 'mailedInstant', state, cfg, log, dry: DRY });
    if (!DRY) { try { const n = await circle.retireStale(7); if (n) log(`retired ${n} stale weeks`); } catch (e) { log(`retire_stale_deals: ${e.message}`); } }
  }
  if (has('--rejudge')) {
    const r = await rejudge({ state, catalog, cfg, circle, log, dry: DRY, now });
    log(`rejudge: ${r.before} scout rows on the board, ${r.keep} still great/good, ${r.retired} ${DRY ? 'would be ' : ''}retired`);
  }
  if (has('--watch-mail')) {
    const mode = memberMailMode(process.env.SCOUT_MEMBER_MAIL);
    const targets = await circle.rpc('watch_mail_targets', {}), sent = await circle.rpc('watch_mail_sent', {});
    log(`watch mail (${mode}): ${targets.length} watches ask for e-mail`);
    const items = Object.values(state.items);
    const planned = await runWatchMail({ targets, items, sent, state, mode, key: DRY ? 'dry' : boxSecret('watchmailkey'),
      pass: DRY ? null : appPassword(), logSent: (id, keys) => circle.rpc('log_watch_mail', { p_member: id, p_keys: keys }),
      send: DRY ? async (m) => log(`  would send "${m.subject}" to ${m.to === VICTOR ? 'Victor' : 'a member'}`) : sendMail, log });
    log(`watch mail: ${planned.length} member mail${planned.length === 1 ? '' : 's'} ${DRY ? 'would go' : 'sent'}`);
  }
  if (has('--digest')) {
    await pushSupers({ items: [], pusher: makePusher(), file: join(HERE, '.scout-super.json'), log, dry: DRY });   // only lets a night's held pushes go
    const list = forDigest(state, now);
    log(`digest: ${list.length} great/good deals not yet in a digest`);
    if (list.length) await mail({ list, compose: (l) => [{ ...digestMail(l, now), items: l }], flag: 'mailedDigest', state, cfg, log, dry: DRY });
  }
  if (has('--score')) {
    const week = isoWeek(now);
    const refs = Object.values(state.items).filter((i) => i.ref).map((i) => i.ref);
    const liveStatus = {};
    if (refs.length) {
      const res = await circle.call(`/rest/v1/deals?select=source_ref,status,retired_at&source_ref=in.(${encodeURIComponent(refs.map((r) => JSON.stringify(r)).join(','))})`);
      if (res.ok) for (const d of await res.json()) liveStatus[d.source_ref] = { status: d.status, retired: d.retired_at };
    }
    let taps = []; try { taps = JSON.parse(readFileSync(join(HERE, '.taps-state.json'), 'utf8')).tapLog || []; } catch {}
    const file = JSON.stringify({ week, written: new Date(now).toISOString(), note: 'counts only; no model was asked', sources: scores(state, week, { liveStatus, taps }) }, null, 1);
    const dir = process.env.SCOUT_SCORES_DIR || '/home/openclaw/premanifest-bot/reports/scout', path = join(dir, `scores-${week}.json`);
    if (DRY) console.log(file);
    else { execFileSync('sudo', ['-u', 'openclaw', 'sh', '-c', `mkdir -p '${dir}' && cat > '${path}'`], { input: file }); log(`score file: ${path}`); }
  }
  } finally { if (!DRY) saveState(STATE, state); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error('scout failed:', e.message); process.exit(1); });
