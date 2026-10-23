// The top tier. A "super" deal is a great one that is at least 40% under the like-for-like public rate (and, like every
// great/good, no dearer than the Circle's own price for that room). It is the only tier that taps Victor's phone.
//
//   - seen in the last 24 h, with a working https link, check-in still ahead
//   - at most 3 pushes a day (Aruba date), one per resort + dates EVER
//   - quiet 23:00-07:00: held until 07:00, unless the source says the deal ends sooner (find.endsBy)
// The push is the same ntfy POST and quiet rule as alertPush.js (taps.mjs makePusher). Mail goes out as for any great.

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { flushHeld, tellOrHold } from './taps.mjs';
import { SUPER, baselineFor, arubaToday } from './scout-judge.mjs';

export const DAILY_CAP = 3, FRESH_MS = 24 * 3600e3;
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const SOURCE = { vakaymood: 'VakayMood', interval: 'Interval', travelzoo: 'Travelzoo', holidaypirates: 'HolidayPirates' };

/** Which state items may push right now. */
export function supersOf(items, now = Date.now()) {
  return items.filter((i) => i.super && (i.cls === 'great' || i.cls === 'good') && i.onBoard && !i.goneAt && i.find
    && now - i.last <= FRESH_MS && /^https:\/\/\S+/.test(i.url || i.find.url || '') && i.find.from >= arubaToday(now))
    .sort((a, b) => b.pct - a.pct);
}

/**
 * Interval rows posted by a member's tap. They only count when the row says how many bedrooms it is (the Getaways page text
 * does not today: its icons are images), because without it there is no like-for-like public rate and the push would be a guess.
 */
export function intervalSupers(finds, catalog, rooms, now = Date.now()) {
  const out = [];
  for (const f of finds) {
    if (f.source !== 'interval' || f.bedrooms == null || !f.stayId || !(f.usdTotal > 0) || !f.url) continue;
    const bl = baselineFor(catalog.get(f.stayId), rooms.get(f.stayId), f.bedrooms, f.from, f.nights);
    if (!bl || f.usdTotal > bl.ours) continue;
    const pct = 1 - f.usdTotal / bl.public;
    if (pct >= SUPER) out.push({ src: 'interval', cls: 'great', super: true, pct, onBoard: true, last: f.seenAt ? Date.parse(f.seenAt) : now, url: f.url,
      find: { ...f, retailPrice: bl.public, ourPrice: bl.ours, resortName: f.resortName || catalog.get(f.stayId).name } });
  }
  return out;
}

export function superMessage(i, now = Date.now()) {
  const f = i.find, seen = new Date(i.last - 4 * 3600e3).toISOString().slice(11, 16);
  return {
    title: `Super deal: ${f.resortName}, ${day(f.from)} to ${day(f.to)}`.slice(0, 100),
    body: `${usd(f.usdNightly)} a night, ${usd(f.usdTotal)} total, against ${usd(f.retailPrice)} at the public rate (${Math.round(i.pct * 100)}% under). `
      + `${SOURCE[i.src] || i.src}, last seen ${seen} Aruba. Check it again before acting. ${i.url || f.url}`,
    priority: 4, click: i.url || f.url,
  };
}

const load = (file) => { try { return { sent: {}, day: '', count: 0, held: [], ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { return { sent: {}, day: '', count: 0, held: [] }; } };
const save = (file, s) => { const t = `${file}.${process.pid}.tmp`; writeFileSync(t, JSON.stringify(s, null, 1), { mode: 0o600 }); renameSync(t, file); };

/** True when the deal's own source says it ends before the quiet hours do. */
const endsSooner = (i, now) => { const e = Date.parse(i.find?.endsBy || ''); return Number.isFinite(e) && e - now < 8 * 3600e3 && e > now; };

export async function pushSupers({ items, pusher, file, log = () => {}, dry = false, now = Date.now() }) {
  const st = load(file), out = { sent: 0, held: 0, skipped: 0 };
  const today = arubaToday(now);
  if (st.day !== today) { st.day = today; st.count = 0; }
  if (!dry) await flushHeld(st, pusher, log, new Date(now));
  for (const i of items) {
    const f = i.find, key = `${f.stayId}|${f.from}|${f.to}`;
    if (st.sent[key] || st.count >= DAILY_CAP) { out.skipped++; continue; }
    const msg = superMessage(i, now);
    if (dry) { log(`  would push: ${msg.title} / ${msg.body}`); out.sent++; continue; }
    st.sent[key] = now; st.count++;                         // marked first: a failed send is held and retried, never sent twice
    if (endsSooner(i, now)) { const r = await pusher.send(msg); if (r.ok) out.sent++; else { (st.held ||= []).push(msg); out.held++; } continue; }
    const was = st.held.length;
    const ok = await tellOrHold(st, pusher, msg, log, new Date(now));
    if (ok) out.sent++; else if (st.held.length > was) out.held++;
  }
  if (!dry) save(file, st);
  return out;
}
