// Watch e-mail: twice a day, each member hears about the deals that fit the dates and guests they are watching for.
// Judged by the scout (great/good, like-for-like baseline, no dearer than the Circle's own price), seen in the last 24 h,
// never the same deal twice, nothing when there is nothing, at most 2 mails a member a day.
//
// memberMail 'shadow' (the default; only the exact word 'live' changes it, and only Victor's word flips it):
// each member's would-be mail goes ONLY to Victor, first name in the subject, and is NOT written to the sent log,
// so going live later does not leave members out of deals they never actually got.

import { VICTOR, sendMail } from './scout-mail.mjs';
import { signMember } from './watch-token.mjs';
import { arubaToday } from './scout-judge.mjs';

export const APP = 'https://victorfromaruba-stack.github.io/BY-JOHNNY-PAESCH/circle/';
export const UNSUB = 'https://cdkopyphjvfxjqhasrae.supabase.co/functions/v1/watch-unsub';
export const MAX_PER_DAY = 2, FRESH_MS = 24 * 3600e3;
export const memberMailMode = (v) => (String(v || '').trim() === 'live' ? 'live' : 'shadow');

const DAY = 864e5;
const d = (iso) => Date.parse(`${iso}T12:00:00Z`);
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const short = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', ...(iso.slice(0, 4) === new Date().toISOString().slice(0, 4) ? {} : { year: 'numeric' }), timeZone: 'UTC' });
export const dealKey = (i) => `${i.src}:${i.find.externalId}`;

/** Does this scout item fit this watch? Same overlap rule as the database's deal_matches_watch, plus guests. */
export function fits(i, w, now = Date.now()) {
  const f = i.find;
  if (!f || !(i.cls === 'great' || i.cls === 'good') || !i.onBoard || i.goneAt) return false;
  if (now - i.last > FRESH_MS || !/^https:\/\/\S+/.test(i.url || f.url || '') || f.from < arubaToday(now)) return false;
  if (w.kind && w.kind !== 'aruba' && w.kind !== 'any') return false;
  if (w.stay_id && w.stay_id !== f.stayId) return false;
  if (!(f.sleeps >= w.guests)) return false;                       // sleeps not stated: not claimed to fit
  const lo = Math.max(d(f.from), d(w.from_date) - w.flex_days * DAY), hi = Math.min(d(f.to), d(w.to_date) + w.flex_days * DAY);
  return (hi - lo) / DAY >= Math.min(w.nights, f.nights);
}

/** Per member: { first, email, deals: [items], watches: [watch] } — new deals only, best first. */
export function plan({ targets, items, sent, now = Date.now(), shadowSeen = {} }) {
  const done = new Set(sent.map((s) => `${s.member_id}|${s.deal_key}`));
  const by = new Map();
  for (const w of targets) {
    const m = by.get(w.member_id) || by.set(w.member_id, { id: w.member_id, first: w.first_name || 'there', email: w.email, deals: new Map(), watches: [] }).get(w.member_id);
    m.watches.push(w);
    for (const i of items) {
      const k = dealKey(i);
      if (done.has(`${w.member_id}|${k}`) || shadowSeen[`${w.member_id}|${k}`] || !fits(i, w, now)) continue;
      m.deals.set(k, i);
    }
  }
  return [...by.values()].map((m) => ({ ...m, deals: [...m.deals.values()].sort((a, b) => b.pct - a.pct).slice(0, 6) })).filter((m) => m.deals.length);
}

const stamp = (ms) => new Date(ms - 4 * 3600e3).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

export function compose(m, { key, mode, now = Date.now() }) {
  const n = m.deals.length;
  const blocks = m.deals.map((i) => {
    const f = i.find;
    return [
      `${f.resortName}${f.unit ? `, ${f.unit}` : ''}, ${short(f.from)} to ${short(f.to)}`,
      `${usd(f.usdNightly)} a night, ${usd(f.usdTotal)} for the ${f.nights} nights. The public rate for that room is ${usd(f.retailPrice)}, so this is ${Math.round(i.pct * 100)}% under.`,
      `What you get: the room${f.sleeps ? `, sleeps ${f.sleeps}` : ''}${f.src === 'vakaymood' || i.src === 'vakaymood' ? ', rented by its owner' : ''}.`,
      f.fees > 0 ? `Includes ${usd(f.fees)} of fees. Resort fees paid at the desk can still add to it.` : 'Taxes and resort fees paid at the desk may not be in that price.',
      `Last seen ${stamp(i.last)} Aruba time. Nobody has re-checked it since, so it has to be checked again before anyone acts on it.`,
      `Open it in the Circle: ${APP}#/stays/${f.stayId}`,
    ].join('\n');
  });
  const unsub = `${UNSUB}?t=${signMember(m.id, key)}`;
  const text = [
    `Hi ${m.first},`, '',
    `${n === 1 ? 'One week' : `${n} weeks`} that fit${n === 1 ? 's' : ''} the dates you are watching for.`, '',
    blocks.join('\n\n'), '',
    'Victor confirms every booking himself. Nothing here is held for you.', '',
    `Stop these e-mails, one tap: ${unsub}`,
    `Manage my watches: ${APP}#/watching`, '',
  ].join('\n');
  const subject = `Circle: ${n === 1 ? 'a week' : `${n} weeks`} for your dates in Aruba`;
  return mode === 'live'
    ? { subject, text, unsub }
    : { subject: `[shadow -> ${m.first}] ${subject}`.replace(/[^\x20-\x7e]/g, ''), text: `Shadow copy. This is what ${m.first} would have received. It has gone to you only.\n\n${text}`, unsub };
}

/**
 * One pass. `send` and `logSent` are injected. Returns [{ first, n, mailed }] — never an address.
 * Shadow mode can only ever address Victor (sendMail refuses anyone else), and writes nothing to the sent log.
 */
export async function runWatchMail({ targets, items, sent, state, mode = 'shadow', key, pass, send = sendMail, logSent = async () => {}, now = Date.now(), log = () => {} }) {
  const wm = (state.watchMail ||= { days: {}, shadow: {} });
  const today = arubaToday(now), out = [];
  for (const m of plan({ targets, items, sent, now, shadowSeen: wm.shadow })) {
    const dayRec = wm.days[m.id] = wm.days[m.id]?.date === today ? wm.days[m.id] : { date: today, n: 0 };
    if (dayRec.n >= MAX_PER_DAY) { log(`  ${m.first}: already had ${MAX_PER_DAY} today, ${m.deals.length} wait`); continue; }
    const mail = compose(m, { key, mode, now });
    const to = mode === 'live' ? m.email : VICTOR;
    await send({ to, subject: mail.subject, text: mail.text, pass, shadow: mode !== 'live' });
    dayRec.n++;
    const keys = m.deals.map(dealKey);
    if (mode === 'live') await logSent(m.id, keys); else for (const k of keys) wm.shadow[`${m.id}|${k}`] = now;
    log(`  ${mode === 'live' ? 'mailed' : 'shadow-mailed'} ${m.first}: ${m.deals.length} deal${m.deals.length === 1 ? '' : 's'}`);
    out.push({ first: m.first, n: m.deals.length, mailed: true });
  }
  return out;
}
