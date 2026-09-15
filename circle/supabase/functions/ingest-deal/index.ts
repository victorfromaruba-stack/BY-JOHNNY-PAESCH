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
  const got = readDates(text);
  // A week must be at least one night. Anything else is a misreading, not a short stay.
  return got && nightsBetween(got.from, got.to) > 0 ? got : null;
}
function readDates(text: string): { from: string; to: string } | null {
  const t = text.replace(/[‐-―]/g, '-').replace(/\s+/g, ' ');
  let m = t.match(/\b([A-Za-z]{3,4})\.?\s+(\d{1,2})\s*-\s*(\d{1,2}),?\s*(\d{4})/);
  if (m && MON3[m[1].toLowerCase()] !== undefined) {
    const mo = MON3[m[1].toLowerCase()], y = +m[4];
    return { from: iso(y, mo, +m[2]), to: iso(y, mo, +m[3]) };
  }
  m = t.match(/\b([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s*(\d{4})?\s*-\s*([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s*(\d{4})/);
  if (m && MON3[m[1].toLowerCase()] !== undefined && MON3[m[4].toLowerCase()] !== undefined) {
    const m1 = MON3[m[1].toLowerCase()], m2 = MON3[m[4].toLowerCase()];
    const y2 = +m[6];
    // Only one year printed, and the week ends in an earlier month than it starts: a week over
    // New Year, so the start is the year before. Reading both as 2027 turned a seven-night week
    // into minus three hundred and fifty-eight.
    const y1 = m[3] ? +m[3] : (m2 < m1 ? y2 - 1 : y2);
    return { from: iso(y1, m1, +m[2]), to: iso(y2, m2, +m[5]) };
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
 * Interval prints a TABLE, not a list of listings, and the difference broke every row.
 *
 * What the real Getaway results page says (read off Victor's own screen, September 2026):
 *
 *   Marriott's Aruba Surf Club        <- the resort, named once
 *   Palm Beach , ARUBA - DCB          <- always under it: town, REGION - code
 *   MSU / Overall Rating / 48 Member Ratings / Resort Details & Photos
 *   from US$90.50 Average Night       <- the CHEAPEST week here, not any particular one
 *   Weekly Rate                       <- the column the figures below sit in
 *   Sep 17 2026 - Sep 24 2026   US$633.46    Book     <- three weeks under one resort
 *   Sep 18 2026 - Sep 25 2026   US$633.46    Book
 *   Sep 19 2026 - Sep 26 2026   US$1,172.54  Book
 *
 * ONE RESORT, MANY WEEKS. Cutting the page into one chunk per date range left weeks two and three
 * with no resort name above them, so they were dropped — or worse, inherited the NEXT resort's
 * name. The resort is carried forward from its header and changes only at the next header.
 *
 * THE FIGURE ON A ROW IS A WEEK, NOT A NIGHT. Read as a nightly rate, US$633.46 goes on the board
 * at seven times the real price. Three sums off the same screen confirm the reading:
 * 633.46/7 = 90.49 against the header's "from US$90.50"; 1,008.01/7 = 144.00; 1,172.54/7 = 167.51.
 *
 * THE HEADER'S PRICE IS NOT THE ROW'S. "from US$90.50" is the cheapest week at that resort, so
 * only money after a row's dates, and before the next row's, belongs to that row.
 */
/**
 * The line printed under every resort's name, and the only mark of where one resort's block ends
 * and the next begins that does not require knowing the resort. That last part is the point:
 * matching on names we recognise leaves a resort we do not stock invisible, and its weeks then
 * inherit the name of the resort above them — a real price on the wrong hotel.
 *
 * An ALL-CAPS region after a comma or a dot is what makes it a place line: "Palm Beach , ARUBA -
 * DCB" and "Palm Beach · ARUBA · DCB" both qualify, while "Studio Queen, Oceanside" and
 * "Sleeps: 12, Building: Compass" do not.
 */
const PLACE_LINE = /[,\u00b7]\s*[A-Z]{3,}\b/;
const MONEY_RE = /(?:US)?\$\s*[\d,]+(?:\.\d{1,2})?/gi;

/** The line above a place line is the resort's name — unless it is plainly something else. */
function looksLikeName(ln: string): boolean {
  const s = String(ln || '').trim();
  return s.length > 2 && s.length < 70 && /[a-z]/.test(s) && /[A-Za-z]{3}/.test(s)
    && !/\$|\d{4}/.test(s) && !PLACE_LINE.test(s);
}

function parseListings(text: string, stays: Stay[]): Listing[] {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const lines = clean.split('\n').map((l) => l.trim());
  // Does this page price by the week? Believing what the page says beats guessing from the size
  // of the number: $633 could be a week at one resort or two nights at another.
  const weekly = /weekly[\s\u00a0]*\n?[\s\u00a0]*rate/i.test(clean)
    || /nightly rates are based on per week/i.test(clean);

  const out: Listing[] = [];
  let resortLine: string | null = null;
  let row: { dates: { from: string; to: string }; lines: string[]; money: string[] } | null = null;

  const close = () => {
    const r = row;
    if (!r) return;
    row = null;
    const chunk = `${resortLine ?? ''}\n${r.lines.join('\n')}`.trim();
    out.push(buildListing(chunk, resortLine, r.dates,
      weekly && r.money.length ? money(r.money[0]) : 0, stays));
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln) continue;
    if (PLACE_LINE.test(ln) && i > 0 && !parseDates(ln) && looksLikeName(lines[i - 1])) {
      close(); resortLine = lines[i - 1]; continue;
    }
    const d = parseDates(ln);
    if (d) { close(); row = { dates: d, lines: [ln], money: [] }; continue; }
    // A short line naming a place in the catalog IS a header, wherever it falls. Neither site
    // prints a resort's name inside one of its own rows, and without this a page whose place line
    // carries no comma put every week in the whole table under the first resort on it.
    if (ln.length < 70 && matchStay(ln, stays)) { close(); resortLine = ln; continue; }
    if (row) {
      row.lines.push(ln);
      const m = ln.match(MONEY_RE);
      if (m) row.money.push(...m);
    }
  }
  close();
  if (out.length) return out;
  const one = parseOne(clean, stays);
  return one ? [one] : [];
}

/** One row of the table, priced and named. */
function buildListing(chunk: string, nameText: string | null, dates: { from: string; to: string }, weekTotal: number, stays: Stay[]): Listing {
  const nights = nightsBetween(dates.from, dates.to);
  // Labels beat column headers beat guessing. A row that says "Average Night" or "Weekly Rate" on
  // itself is answering outright; a row carrying a bare figure falls back to the Weekly Rate
  // column the page puts it in; only a page with neither is left guessing.
  const read = parsePrice(chunk, nights);
  const price = (read.total && !read.guessed) ? read
    : weekTotal ? { nightly: nights ? Math.round((weekTotal / nights) * 100) / 100 : 0, total: weekTotal, guessed: false }
    : read;
  // Once a resort's header has been seen it is the ONLY thing that names these rows. Reading the
  // row's own text as a fallback filed one resort's week under the next one's name, because the
  // next resort's name lands in the previous resort's last row.
  const stay = nameText ? matchStay(nameText, stays) : matchStay(chunk, stays);
  const missing: string[] = [];
  if (!price.total) missing.push('the price');
  if (!stay) missing.push('which place it is');
  const taken = looksTaken(chunk);
  return {
    stay, from: dates.from, to: dates.to, nights: nights || null,
    unit: parseUnit(chunk), sleeps: parseSleeps(chunk), usdTotal: price.total, guessed: price.guessed,
    taken, missing, ok: missing.length === 0 && !taken,
  };
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

/**
 * Is this mail telling us a Getaway is OFF?
 *
 * It matters because Interval quotes the same confirmation number when it cancels as when it
 * confirms, so a cancellation read as a confirmation would put a week the Circle no longer holds
 * on the board under the words "The Circle holds this week" — and leave it there, since the
 * second arrival of a number already on the board reads as a duplicate and is skipped.
 *
 * The test is deliberately narrow. Every ordinary confirmation carries a CANCELLATION POLICY in
 * its small print, and treating that as a cancellation would take live weeks down. So: the word
 * in the SUBJECT, where Interval puts it and where no policy paragraph reaches, or one of the
 * whole phrases a cancellation notice actually uses.
 */
const CANCELLED = (subject: string, text: string) =>
  /\bcancell?(ed|ation)\b/i.test(subject)
  || /\b(getaway|reservation|booking)\s+(has been|was|is)\s+cancell?ed\b/i.test(text)
  || /\bwe have cancell?ed\b/i.test(text);

/**
 * Which site a page came off — established, not assumed.
 *
 * Page mode used to stamp every row `interval` whatever the text was, which is the one thing the
 * Circle must never do: a week filed as an Interval Getaway when it is an owner's RedWeek rental
 * is a lie told to somebody about to spend points, and the two are not the same product at the
 * same price. The browser knows the answer for certain — it is the host it is sitting on — so the
 * Grab button says so and this trusts that over any guess made from the words on the page.
 *
 * With no host given the caller is the mail forwarder, which only reads mail from Interval's own
 * senders; that is its own kind of certainty, so it keeps `interval`. Anything else is refused
 * rather than filed under a source nobody can stand behind.
 */
/** What a member reads. VakayMood weeks are owners renting, and are never called Interval. */
const SAY: Record<string, string> = { interval: 'Interval', redweek: 'RedWeek', vakaymood: 'VakayMood' };
const SITES: [RegExp, string][] = [
  [/(^|\.)intervalworld\.com$|(^|\.)intervalintl\.com$/i, 'interval'],
  [/(^|\.)redweek\.com$/i, 'redweek'],
  [/(^|\.)vakaymood\.com$/i, 'vakaymood'],
];
function sourceOf(host: string): string | null {
  const h = String(host || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!h) return null;
  for (const [re, name] of SITES) if (re.test(h)) return name;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const given = req.headers.get('x-ingest-token') ?? '';
  if (!given) return json({ error: 'no token' }, 401);
  const { data: tok } = await sb.from('ingest_tokens').select('id, token_sha256').eq('id', 'mail').maybeSingle();
  if (!tok?.token_sha256) return json({ error: 'ingest is not set up' }, 503);
  if (!safeEqual(tok.token_sha256, await sha256Hex(given))) return json({ error: 'no' }, 401);

  const now = new Date().toISOString();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Body must be JSON' }, 400); }
  const subject = String(body.subject ?? '');
  const text = String(body.text ?? body.body ?? body.plain ?? '');
  const dry = body.dryRun === true;
  const host = String(body.origin ?? '');

  // Taking weeks DOWN is its own call, and it is always a person's. The Desk sees which weeks
  // were not on the page it just read and decides; nothing here retires anything on its own,
  // because a page is one page — Interval paginates, and absence from page one is not proof.
  if (Array.isArray(body.retire) && body.retire.length) {
    const ids = (body.retire as unknown[]).map(String).slice(0, 200);
    const { data: done, error } = await sb.from('deals')
      .update({ status: 'gone', retired_at: now,
                retired_reason: 'Not on the page when the Desk last looked.' })
      .in('id', ids).eq('status', 'live').select('id, title');
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, mode: 'retire', retired: (done ?? []).length, titles: (done ?? []).map((d) => d.title) });
  }

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
    // A cancellation takes the week DOWN. Interval saying the booking is off is as good an
    // answer as the Circle can get about a week it holds, so this is the one place a message may
    // retire something on its own: the source is the seller, not a page that might be paginated.
    if (CANCELLED(subject, text)) {
      const ref = `interval:${conf.conf}`;
      const { data: gone, error } = await sb.from('deals')
        .update({ status: 'gone', retired_at: now,
                  retired_reason: `Interval cancelled Getaway #${conf.conf}.` })
        .eq('source_ref', ref).eq('status', 'live').select('id, title');
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, mode: 'cancellation', conf: conf.conf,
        retired: (gone ?? []).length, titles: (gone ?? []).map((d) => d.title),
        why: (gone ?? []).length ? undefined : 'that Getaway was not on the board' });
    }
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
    await sb.from('ingest_tokens').update({ last_used_at: now }).eq('id', 'mail');
    return json({ ok: true, mode: 'confirmation', dealId: deal.id, conf: c.conf, place: stay.name, pointsTotal });
  }

  // ---------------------------------------------------------------- a page of listings
  // A caller that named its host must have named one we recognise; one that named none is the
  // mail forwarder, whose senders are already restricted to Interval.
  const source = host ? sourceOf(host) : 'interval';
  if (!source) {
    return json({ ok: false, skipped: true, why: `the Circle does not read weeks off ${host} \u2014 it could not say where they came from` }, 200);
  }
  const found = parseListings(text, catalog);
  if (!found.length) return json({ ok: false, skipped: true, why: 'nothing on that page read as a week' }, 200);

  // Every row carries the same fields whatever happened to it, so the Grab button can show the
  // Desk exactly what was read — including the ones it could not read — before anything is posted.
  const results: Record<string, unknown>[] = [];
  const refsOnPage = new Set<string>();
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
    const sourceRef = `${source}:${m.stay.id}:${m.from}:${m.to}`;
    refsOnPage.add(sourceRef);
    const { data: seen } = await sb.from('deals').select('id, status').eq('source_ref', sourceRef).maybeSingle();
    if (seen) {
      // Seeing it again IS the news. Without this the board could only say when a week was first
      // posted, which after a few days stops answering the one question a member has on their own.
      //
      // And a week that comes back is back: one taken down as vanished goes live again when the
      // page carries it once more, because the reason it was taken down has stopped being true.
      // A week the Circle has BOOKED is not revived by anything — it is not a listing any more.
      const revive = seen.status === 'gone';
      if (!dry && (seen.status === 'live' || revive)) {
        await sb.from('deals').update(revive
          ? { seen_at: now, status: 'live', retired_at: null, retired_reason: null }
          : { seen_at: now }).eq('id', seen.id);
      }
      results.push({ ...seenAs, state: revive ? 'back' : seen.status === 'live' ? 'refreshed' : 'already', dealId: seen.id });
      continue;
    }
    const pointsTotal = Math.round(m.usdTotal * ppd * (1 + svc));
    const pointsPerNight = Math.round(pointsTotal / m.nights);
    const row = {
      stay_id: m.stay.id, kind: m.stay.kind === 'trip' ? 'trip' : 'aruba',
      title: [m.stay.name, m.unit].filter(Boolean).join(' · '),
      from_date: m.from, to_date: m.to, nights: m.nights,
      points_total: pointsTotal, points_per_night: pointsPerNight,
      retail_usd: null, source, source_url: null, source_ref: sourceRef,
      note: `Seen on ${SAY[source] ?? source} by the Desk — $${m.usdTotal.toFixed(2)} for ${m.nights} nights`
        + `${m.sleeps ? `, sleeps ${m.sleeps}` : ''}.`
        + `${m.guessed ? ' The page showed one figure and no label, so it was read as the nightly rate.' : ''}`
        + ' Victor confirms it is still there before he quotes anyone.',
      status: 'live', expires_at: endOfCheckInDay(m.from), posted_by: poster, seen_at: now,
    };
    if (dry) { ready++; results.push({ ...seenAs, state: 'would-post', pointsPerNight }); continue; }
    const { data: deal, error } = await sb.from('deals').insert(row).select('id').single();
    if (error) { results.push({ ...seenAs, state: 'failed', why: error.message }); continue; }
    posted++;
    results.push({ ...seenAs, state: 'posted', dealId: deal.id, pointsPerNight });
  }
  // Weeks the Circle is showing that this page did not carry. Scoped hard — same source, same
  // resorts, and a check-in inside the span the page actually covered — because a search for
  // September says nothing about November. Reported, never acted on: see the retire branch.
  const stayIds = [...new Set(found.filter((f) => f.stay).map((f) => f.stay!.id))];
  const ok = found.filter((f) => f.ok);
  // The window the page vouches for is the period it DISPLAYED: the first check-in through the
  // last check-out. Bounding it by check-in days alone made a page showing one week vouch for one
  // day, so a week that had vanished could never surface — which is the whole point of looking.
  const first = ok.map((f) => f.from).sort()[0];
  const last = ok.map((f) => f.to).sort().slice(-1)[0];
  let missing: Record<string, unknown>[] = [];
  if (stayIds.length && first && last) {
    const { data: onBoard } = await sb.from('deals')
      .select('id, title, from_date, to_date, points_per_night, source_ref, seen_at')
      .eq('source', source).eq('status', 'live').in('stay_id', stayIds)
      .gte('from_date', first).lte('from_date', last);
    missing = (onBoard ?? []).filter((d) => !refsOnPage.has(d.source_ref ?? ''))
      .map((d) => ({ dealId: d.id, title: d.title, from: d.from_date, to: d.to_date,
                     pointsPerNight: d.points_per_night, lastSeen: d.seen_at }));
  }

  if (!dry && posted) await sb.from('ingest_tokens').update({ last_used_at: now }).eq('id', 'mail');
  return json({ ok: true, mode: 'page', source, sourceLabel: SAY[source] ?? source, dryRun: dry || undefined,
    read: found.length, ready, posted, results, missing });
});
