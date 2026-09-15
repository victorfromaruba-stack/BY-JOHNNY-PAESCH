// Turns what Interval shows Victor into weeks on the board.
//
// WHY THIS SHAPE. Interval has no API, its terms forbid automated access, and its bot management
// refuses a robot sign-in. So nothing here logs in, crawls, or runs on a schedule against them.
// Two things reach this endpoint instead, and both are Victor acting as himself:
//
//   1. EMAIL. Interval sends its own members confirmations, and Getaway Alerts once switched on.
//      Reading mail that was sent to you is not automated access to anyone's site.
//   2. THE PAGE HE IS ALREADY LOOKING AT. The Grab button (circle/tools/grab.js) runs in Victor's
//      own browser, in his own signed-in session, only when he taps it, and reads the text of the
//      page his browser has already been served. No second login, no crawl, no schedule, no bot:
//      it is his clipboard with the retyping removed.
//
// The caller sends text and this parses it, so a mail forwarder, a phone shortcut and the Grab
// button are all equally dumb and the parsing can be fixed in one place without touching any of
// them.
//
// Auth is a token in x-ingest-token, checked against a SHA-256 hash in ingest_tokens.
// Deploy with verify_jwt false: the callers have no Supabase session and this authenticates them.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-ingest-token',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 1), { status, headers: { 'content-type': 'application/json', ...CORS } });

/** Constant-time compare, so the token cannot be guessed a character at a time. */
function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a), bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const money = (s: string) => Number(String(s).replace(/[^0-9.]/g, '')) || 0;

// ---------------------------------------------------------------- dates, both shapes of them
const MON3: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const MONFULL: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

/** Every date range the two sites print. */
function parseDates(text: string): { from: string; to: string } | null {
  const t = text.replace(/[‐-―]/g, '-').replace(/\s+/g, ' ');
  let m = t.match(/\b([A-Za-z]{3,4})\.?\s+(\d{1,2})\s*-\s*(\d{1,2}),?\s*(\d{4})/);
  if (m && MON3[m[1].toLowerCase()] !== undefined) {
    const mo = MON3[m[1].toLowerCase()], y = +m[4];
    return { from: iso(y, mo, +m[2]), to: iso(y, mo, +m[3]) };
  }
  m = t.match(/\b([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s*(\d{4})?\s*-\s*([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s*(\d{4})/);
  if (m && MON3[m[1].toLowerCase()] !== undefined && MON3[m[4].toLowerCase()] !== undefined) {
    const y2 = +m[6], y1 = m[3] ? +m[3] : y2;
    return { from: iso(y1, MON3[m[1].toLowerCase()], +m[2]), to: iso(y2, MON3[m[4].toLowerCase()], +m[5]) };
  }
  m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { from: iso(+m[3], +m[1] - 1, +m[2]), to: iso(+m[6], +m[4] - 1, +m[5]) };
  return null;
}

function parseUnit(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) =>
    /\b(studio|\d\s*bedroom|one|two|three|four)\b/i.test(l) && /\b(villa|suite|studio|unit|room|queen|king)\b/i.test(l)
    && l.length < 70 && !/^\$/.test(l));
  return line ? line.replace(/\s+/g, ' ').replace(/[·|]+$/, '').trim() : '';
}
const parseSleeps = (text: string) => { const m = text.match(/sleeps:?\s*(\d{1,2})/i); return m ? +m[1] : null; };
const looksTaken = (text: string) => /\bRENTED!?\b|\bSOLD\b|sold out|no longer available/i.test(text);

function parsePrice(text: string, nights: number | null) {
  const t = text.replace(/,/g, '');
  // "US$ 132.71 Average Night", "$150/night", "132.71 USD nightly", "Average Night US$132.71".
  const per = t.match(/(?:us)?\$\s*([\d.]+)\s*(?:usd\s*)?(?:\/\s*night|per\s*night|average\s*night|avg\.?\s*night|a night|nightly)/i)
           || t.match(/(?:average|avg\.?|per)\s*night[^$\d]{0,24}(?:us)?\$?\s*([\d.]+)/i);
  // "$1050 total", "$929 USD Total", "Weekly US$ 929.00", "Total: 929".
  const tot = t.match(/(?:us)?\$\s*([\d.]+)\s*(?:usd\s*)?(?:total|for the week|weekly|\/\s*week)/i)
           || t.match(/(?:weekly(?:\s*rate)?|total(?:\s*price)?)\s*:?[^$\d]{0,24}(?:us)?\$?\s*([\d.]+)/i);
  let nightly = per ? money(per[1]) : 0;
  let total = tot ? money(tot[1]) : 0;
  // A card carrying exactly one money figure and no label at all is showing its price: there is
  // nothing else it could be. Read it as the nightly rate, but say so — a figure read without a
  // label is the one the Desk should look at twice before it goes in front of anybody.
  let guessed = false;
  if (!nightly && !total) {
    const alone = t.match(/(?:us)?\$\s*[\d.]+/gi) || [];
    if (alone.length === 1) { nightly = money(alone[0]); guessed = true; }
  }
  if (!total && nightly && nights) total = Math.round(nightly * nights * 100) / 100;
  if (!nightly && total && nights) nightly = Math.round((total / nights) * 100) / 100;
  return { nightly, total, guessed };
}

type Stay = { id: string; name: string; kind: string };
const WORDS: [string, string][] = [
  ['surf club', 'Surf Club'], ['ocean club', 'Ocean Club'], ['la cabana', 'La Cabana'],
  ['costa linda', 'Costa Linda'], ['playa linda', 'Playa Linda'], ['divi', 'Divi'],
  ['renaissance', 'Renaissance'], ['casa del mar', 'Casa del Mar'], ['eagle aruba', 'Eagle Aruba'],
  ['barcel', 'Barcel'], ['tamarijn', 'Tamarijn'], ['riu', 'RIU'], ['marriott', 'Marriott'],
];
function matchStay(text: string, stays: Stay[]): Stay | null {
  const hay = text.toLowerCase().replace(/[’'`]/g, "'");
  const hit = stays.filter((s) => s.kind !== 'trip')
    .map((s) => ({ s, name: s.name.toLowerCase().replace(/[’'`]/g, "'") }))
    .filter(({ name }) => hay.includes(name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (hit) return hit.s;
  for (const [needle, label] of WORDS) {
    if (!hay.includes(needle)) continue;
    const s = stays.find((x) => x.kind !== 'trip' && x.name.toLowerCase().includes(label.toLowerCase()));
    if (s) return s;
  }
  return null;
}

type Listing = {
  stay: Stay | null; from: string; to: string; nights: number | null;
  unit: string; sleeps: number | null; usdTotal: number; guessed: boolean;
  taken: boolean; missing: string[]; ok: boolean;
};
function parseOne(text: string, stays: Stay[]): Listing | null {
  const clean = text.trim();
  if (!clean) return null;
  const dates = parseDates(clean);
  const nights = dates ? nightsBetween(dates.from, dates.to) : null;
  const price = parsePrice(clean, nights);
  const stay = matchStay(clean, stays);
  const missing: string[] = [];
  if (!dates) missing.push('the dates');
  if (!price.total) missing.push('the price');
  if (!stay) missing.push('which place it is');
  const taken = looksTaken(clean);
  return {
    stay, from: dates?.from ?? '', to: dates?.to ?? '', nights: nights ?? null,
    unit: parseUnit(clean), sleeps: parseSleeps(clean), usdTotal: price.total, guessed: price.guessed,
    taken, missing, ok: missing.length === 0 && !taken,
  };
}

/**
 * Every listing on a results page, not just the first. Split on the one thing each listing has
 * exactly once — its date range — and run each chunk down to its OWN price line, which sits
 * below its dates. Cutting on the dates alone put every price a row too low.
 */
function parseListings(text: string, stays: Stay[]): Listing[] {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const lines = clean.split('\n');
  const dated = lines.map((ln, i) => (parseDates(ln) ? i : -1)).filter((i) => i >= 0);
  if (dated.length <= 1) { const one = parseOne(clean, stays); return one ? [one] : []; }
  const hasMoney = (ln: string) => /\d/.test(ln) && /\$|\bUSD\b/i.test(ln);
  const out: Listing[] = [];
  let prevEnd = -1;
  for (let k = 0; k < dated.length; k++) {
    const nextDate = k + 1 < dated.length ? dated[k + 1] : lines.length;
    let end = dated[k];
    for (let i = dated[k]; i < nextDate; i++) if (hasMoney(lines[i])) end = i;
    const chunk = lines.slice(prevEnd + 1, end + 1).join('\n').trim();
    prevEnd = end;
    const got = chunk ? parseOne(chunk, stays) : null;
    if (got) out.push(got);
  }
  return out;
}

// ---------------------------------------------------------------- a Getaway confirmation email
const isoFull = (s?: string | null) => {
  const m = /(\w+)\s+(\d{1,2}),\s*(\d{4})/.exec(String(s ?? ''));
  if (!m) return null;
  const mm = MONFULL[m[1].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${String(mm).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
};
function parseConfirmation(subject = '', text = '') {
  const t = String(text).replace(/\r/g, '');
  const conf = /Confirmation\s+Number:\s*(\d{4,})/i.exec(t)?.[1] ?? null;
  if (!conf) return null;
  let resort: string | null = /-\s*to\s+(.+?)\s*$/i.exec(String(subject).trim())?.[1] ?? null;
  if (!resort) {
    const after = t.split(/Confirmation\s+Date:.*\n/i)[1] ?? '';
    resort = after.split('\n').map((x) => x.trim()).filter((x) => x && !/^resort image$/i.test(x))[0] ?? null;
  }
  const from = isoFull(/Check-?in\s*\n\s*(.+)/i.exec(t)?.[1]);
  const to = isoFull(/Check-?out\s*\n\s*(.+)/i.exec(t)?.[1]);
  const unit = (/Unit\s+Details\s*\n\s*(.+)/i.exec(t)?.[1] ?? '').trim() || null;
  const paid = /Total\s+paid\s+to\s+Interval\s+International\s+([\d.,]+)\s*USD/i.exec(t)?.[1];
  const fees = /Resort\s+Fees\s+Due\s+at\s+Resort\s+([\d.,]+)\s*USD/i.exec(t)?.[1];
  const grand = /\nTotal\s+([\d.,]+)\s*USD/i.exec(t)?.[1];
  const paidN = paid ? money(paid) : null, feesN = fees ? money(fees) : null;
  const allInUsd = grand ? money(grand) : (paidN == null && feesN == null ? null : (paidN ?? 0) + (feesN ?? 0));
  if (!resort || !from || !to) return { conf, bad: `could not read ${[!resort && 'the resort', !from && 'the check-in', !to && 'the check-out'].filter(Boolean).join(', ')}` };
  const nights = Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
  if (!(nights > 0)) return { conf, bad: 'check-out is not after check-in' };
  return { conf, resort, from, to, nights, unit, paidUsd: paidN, feesUsd: feesN, allInUsd };
}

const endOfCheckInDay = (day: string) => new Date(Date.parse(`${day}T23:59:59-04:00`)).toISOString();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const given = req.headers.get('x-ingest-token') ?? '';
  if (!given) return json({ error: 'no token' }, 401);
  const { data: tok } = await sb.from('ingest_tokens').select('id, token_sha256').eq('id', 'mail').maybeSingle();
  if (!tok?.token_sha256) return json({ error: 'ingest is not set up' }, 503);
  if (!safeEqual(tok.token_sha256, await sha256Hex(given))) return json({ error: 'no' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Body must be JSON' }, 400); }
  const subject = String(body.subject ?? '');
  const text = String(body.text ?? body.body ?? body.plain ?? '');
  const dry = body.dryRun === true;
  if (!text.trim()) return json({ error: 'Send it as {subject, text}' }, 400);

  const { data: stays, error: stayErr } = await sb.from('stays').select('id, name, kind, active').eq('active', true);
  if (stayErr) return json({ error: stayErr.message }, 500);
  const catalog = (stays ?? []) as Stay[];

  const { data: settings } = await sb.from('settings').select('points_per_dollar, service_rate').eq('id', 1).maybeSingle();
  const ppd = Number(settings?.points_per_dollar) || 100;
  const svc = Number(settings?.service_rate) || 0;
  const { data: iset } = await sb.from('ingest_settings').select('poster_member_id').eq('id', 1).maybeSingle();
  const poster = iset?.poster_member_id ?? null;

  // ---------------------------------------------------------------- a confirmation email
  const conf = parseConfirmation(subject, text);
  if (conf) {
    if ('bad' in conf && conf.bad) return json({ ok: false, skipped: true, why: conf.bad, conf: conf.conf }, 200);
    const c = conf as { conf: string; resort: string; from: string; to: string; nights: number; unit: string | null; paidUsd: number | null; feesUsd: number | null; allInUsd: number | null };
    const target = norm(c.resort);
    const stay = catalog.find((s) => norm(s.name) === target) ?? catalog.find((s) => norm(s.name).includes(target) || target.includes(norm(s.name)));
    if (!stay) return json({ ok: false, skipped: true, why: `no place in the catalog is called "${c.resort}"`, conf: c.conf }, 200);
    const sourceRef = `interval:${c.conf}`;
    const { data: seen } = await sb.from('deals').select('id, status').eq('source_ref', sourceRef).maybeSingle();
    if (seen) return json({ ok: true, already: true, dealId: seen.id, conf: c.conf }, 200);
    if (!(c.allInUsd && c.allInUsd > 0)) return json({ ok: false, skipped: true, why: 'could not read a price', conf: c.conf }, 200);
    const pointsTotal = Math.round(c.allInUsd * ppd * (1 + svc));
    const row = {
      stay_id: stay.id, kind: stay.kind === 'trip' ? 'trip' : 'aruba',
      title: [stay.name, c.unit].filter(Boolean).join(' · '),
      from_date: c.from, to_date: c.to, nights: c.nights,
      points_total: pointsTotal, points_per_night: Math.round(pointsTotal / c.nights),
      retail_usd: null, source: 'interval', source_url: null, source_ref: sourceRef,
      note: `The Circle holds this week — Interval Getaway #${c.conf}, paid.`
        + `${c.paidUsd != null ? ` $${c.paidUsd.toFixed(2)} to Interval` : ''}`
        + `${c.feesUsd ? ` plus $${c.feesUsd.toFixed(2)} in resort fees at check-in` : ''}.`,
      status: 'live', expires_at: endOfCheckInDay(c.from), posted_by: poster,
    };
    if (dry) return json({ ok: true, dryRun: true, mode: 'confirmation', wouldPost: row });
    const { data: deal, error } = await sb.from('deals').insert(row).select('id').single();
    if (error) return json({ error: error.message, row }, 500);
    await sb.from('ingest_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', 'mail');
    return json({ ok: true, mode: 'confirmation', dealId: deal.id, conf: c.conf, place: stay.name, pointsTotal });
  }

  // ---------------------------------------------------------------- a page of Getaways
  const found = parseListings(text, catalog);
  if (!found.length) return json({ ok: false, skipped: true, why: 'nothing on that page read as a week' }, 200);

  // Every row carries the same fields whatever happened to it, so the Grab button can show the
  // Desk exactly what was read — including the ones it could not read — before anything is posted.
  const results: Record<string, unknown>[] = [];
  let posted = 0, ready = 0;
  const perNight = (x: Listing) => (x.usdTotal && x.nights ? x.usdTotal / x.nights : 9e9);
  // Cheapest first among the ones that can go up; everything unreadable after them, however
  // small its figure — a row nobody can place is not a bargain, it is a row to look at.
  const order = (a: Listing, b: Listing) => (a.ok ? 0 : 1) - (b.ok ? 0 : 1) || perNight(a) - perNight(b);
  for (const m of found.sort(order)) {
    const seenAs = {
      place: m.stay?.name ?? null, from: m.from || null, to: m.to || null, nights: m.nights,
      unit: m.unit || null, sleeps: m.sleeps, usdTotal: m.usdTotal || null,
      usdNightly: m.usdTotal && m.nights ? Math.round((m.usdTotal / m.nights) * 100) / 100 : null,
      guessedPrice: m.guessed || undefined,
    };
    if (!m.ok || !m.stay || !m.nights) {
      results.push({ ...seenAs, state: 'skipped', why: m.taken ? 'the page says it is gone' : `could not read ${m.missing.join(' or ')}` });
      continue;
    }
    // The same week grabbed twice is the same week: its place and its nights are its identity.
    const sourceRef = `interval:${m.stay.id}:${m.from}:${m.to}`;
    const { data: seen } = await sb.from('deals').select('id').eq('source_ref', sourceRef).maybeSingle();
    if (seen) { results.push({ ...seenAs, state: 'already', dealId: seen.id }); continue; }
    const pointsTotal = Math.round(m.usdTotal * ppd * (1 + svc));
    const pointsPerNight = Math.round(pointsTotal / m.nights);
    const row = {
      stay_id: m.stay.id, kind: m.stay.kind === 'trip' ? 'trip' : 'aruba',
      title: [m.stay.name, m.unit].filter(Boolean).join(' · '),
      from_date: m.from, to_date: m.to, nights: m.nights,
      points_total: pointsTotal, points_per_night: pointsPerNight,
      retail_usd: null, source: 'interval', source_url: null, source_ref: sourceRef,
      note: `Seen on Interval by the Desk — $${m.usdTotal.toFixed(2)} for ${m.nights} nights`
        + `${m.sleeps ? `, sleeps ${m.sleeps}` : ''}.`
        + `${m.guessed ? ' The page showed one figure and no label, so it was read as the nightly rate.' : ''}`
        + ' Victor confirms it is still there before he quotes anyone.',
      status: 'live', expires_at: endOfCheckInDay(m.from), posted_by: poster,
    };
    if (dry) { ready++; results.push({ ...seenAs, state: 'would-post', pointsPerNight }); continue; }
    const { data: deal, error } = await sb.from('deals').insert(row).select('id').single();
    if (error) { results.push({ ...seenAs, state: 'failed', why: error.message }); continue; }
    posted++;
    results.push({ ...seenAs, state: 'posted', dealId: deal.id, pointsPerNight });
  }
  if (!dry && posted) await sb.from('ingest_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', 'mail');
  return json({ ok: true, mode: 'page', dryRun: dry || undefined, read: found.length, ready, posted, results });
});
