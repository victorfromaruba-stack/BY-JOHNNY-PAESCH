// Turns an Interval email into a week on the board.
//
// WHY THIS SHAPE. Interval International's membership terms forbid automated access and there is
// no API, so the Circle does not scrape it and does not hand a login to a robot. What Interval
// DOES send, to its own members, by its own choice, is email: a confirmation for every Getaway
// bought, and — once switched on — a Getaway Alert when new inventory appears. Reading email that
// was sent to you is not automated access to anyone's site. That is the whole trick, and it is
// the only honest way Interval information reaches this app.
//
// The forwarder POSTs the raw message here. It does no parsing: a Gmail filter, a Cloudflare
// Email Worker and a phone shortcut can all forward text, and none of them should have to know
// what an Interval email looks like. The parsing lives here, where it can be fixed in one place.
//
// Auth is a token the forwarder sends in x-ingest-token, checked against a SHA-256 hash in
// ingest_tokens. It lives in the database rather than a function secret so the Desk can rotate it
// without a redeploy — and so that deploying this function is all it takes to have a working pipe.
//
// Deploy: verify_jwt MUST be false. The caller is a mail robot with no Supabase session; this
// function authenticates it itself, against a hash, in constant time.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 1), { status, headers: { 'content-type': 'application/json' } });

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

// ---------------------------------------------------------------- the Interval parser
const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const money = (s?: string | null) => {
  if (s == null) return null;
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
/** "Friday, September 4, 2026" → "2026-09-04". Interval writes dates one way and only one way. */
const isoDate = (s?: string | null) => {
  const m = /(\w+)\s+(\d{1,2}),\s*(\d{4})/.exec(String(s ?? ''));
  if (!m) return null;
  const mm = MONTHS[m[1].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${String(mm).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
};

type Parsed = {
  ok: boolean; why?: string;
  conf?: string; resort?: string; from?: string; to?: string; nights?: number;
  unit?: string | null; sleeps?: number | null;
  paidUsd?: number | null; feesUsd?: number | null; allInUsd?: number | null;
};

/**
 * A Getaway confirmation. Every field below was read off a real one; nothing is guessed, and a
 * message missing the resort or either date is refused rather than half-posted.
 *
 * The price that matters is the ALL-IN: Interval bills the Getaway, the resort bills occupancy tax
 * and the environmental levy at check-in, and a member comparing this against an owner's rental
 * has to be comparing the same thing. The standalone "Total" line is that number; where it is
 * missing the two halves are added instead.
 */
export function parseIntervalConfirmation(subject = '', text = ''): Parsed {
  const t = String(text).replace(/\r/g, '');
  const conf = /Confirmation\s+Number:\s*(\d{4,})/i.exec(t)?.[1] ?? null;
  if (!conf) return { ok: false, why: 'no Interval confirmation number in the message' };

  // The subject states the resort most cleanly: "… - to Marriott's Aruba Surf Club".
  let resort: string | null = /-\s*to\s+(.+?)\s*$/i.exec(String(subject).trim())?.[1] ?? null;
  if (!resort) {
    const after = t.split(/Confirmation\s+Date:.*\n/i)[1] ?? '';
    resort = after.split('\n').map((x) => x.trim())
      .filter((x) => x && !/^resort image$/i.test(x))[0] ?? null;
  }

  const from = isoDate(/Check-?in\s*\n\s*(.+)/i.exec(t)?.[1]);
  const to = isoDate(/Check-?out\s*\n\s*(.+)/i.exec(t)?.[1]);
  const unit = (/Unit\s+Details\s*\n\s*(.+)/i.exec(t)?.[1] ?? '').trim() || null;
  const sleeps = Number(/Sleeps\s+(\d+)\s+Total/i.exec(t)?.[1]) || null;

  const paid = money(/Total\s+paid\s+to\s+Interval\s+International\s+([\d.,]+)\s*USD/i.exec(t)?.[1]);
  const fees = money(/Resort\s+Fees\s+Due\s+at\s+Resort\s+([\d.,]+)\s*USD/i.exec(t)?.[1]);
  const grand = money(/\nTotal\s+([\d.,]+)\s*USD/i.exec(t)?.[1]);
  const summed = paid == null && fees == null ? null : (paid ?? 0) + (fees ?? 0);
  const allInUsd = grand ?? summed;

  const missing = [!resort && 'the resort', !from && 'the check-in', !to && 'the check-out'].filter(Boolean);
  if (missing.length) return { ok: false, why: `could not read ${missing.join(', ')}`, conf };

  const nights = Math.round((Date.parse(to!) - Date.parse(from!)) / 864e5);
  if (!(nights > 0)) return { ok: false, why: 'check-out is not after check-in', conf };
  return { ok: true, conf, resort: resort!, from: from!, to: to!, nights, unit, sleeps, paidUsd: paid, feesUsd: fees, allInUsd };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ---- who is calling
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
  if (!text.trim()) return json({ error: 'Send the message as {subject, text}' }, 400);

  const read = parseIntervalConfirmation(subject, text);
  if (!read.ok) return json({ ok: false, skipped: true, why: read.why, conf: read.conf ?? null }, 200);

  // ---- which place is it
  const { data: stays, error: stayErr } = await sb
    .from('stays').select('id, name, kind, active').eq('active', true);
  if (stayErr) return json({ error: stayErr.message }, 500);
  const target = norm(read.resort!);
  const stay = stays?.find((s) => norm(s.name) === target)
    ?? stays?.find((s) => norm(s.name).includes(target) || target.includes(norm(s.name)));
  if (!stay) {
    return json({ ok: false, skipped: true, why: `no place in the catalog is called "${read.resort}"`, conf: read.conf }, 200);
  }

  // ---- has it already been posted? The confirmation number is Interval's own id for the week,
  // so the same message forwarded twice, or resent by Interval, can never double-post.
  const sourceRef = `interval:${read.conf}`;
  const { data: seen } = await sb.from('deals').select('id, status').eq('source_ref', sourceRef).maybeSingle();
  if (seen) return json({ ok: true, already: true, dealId: seen.id, status: seen.status, conf: read.conf }, 200);

  // ---- the price, in the club's unit, on the club's own arithmetic
  const { data: settings } = await sb.from('settings').select('points_per_dollar, service_rate').eq('id', 1).maybeSingle();
  const ppd = Number(settings?.points_per_dollar) || 100;
  const svc = Number(settings?.service_rate) || 0;
  if (!(read.allInUsd && read.allInUsd > 0)) {
    return json({ ok: false, skipped: true, why: 'could not read a price from the message', conf: read.conf }, 200);
  }
  const pointsTotal = Math.round(read.allInUsd * ppd * (1 + svc));
  const perNight = Math.round(pointsTotal / read.nights!);

  const { data: iset } = await sb.from('ingest_settings').select('poster_member_id').eq('id', 1).maybeSingle();

  const title = [stay.name, read.unit].filter(Boolean).join(' · ');
  const note = `The Circle holds this week — Interval Getaway #${read.conf}, paid. `
    + `${read.paidUsd != null ? `$${read.paidUsd.toFixed(2)} to Interval` : 'Paid to Interval'}`
    + `${read.feesUsd ? ` plus $${read.feesUsd.toFixed(2)} in resort fees at check-in` : ''}.`;

  const row = {
    stay_id: stay.id,
    kind: stay.kind === 'trip' ? 'trip' : 'aruba',
    title,
    from_date: read.from, to_date: read.to, nights: read.nights,
    points_total: pointsTotal,
    points_per_night: perNight,
    retail_usd: null as number | null,
    source: 'interval',
    source_url: null as string | null,
    source_ref: sourceRef,
    note,
    status: 'live',
    // A week is on the board until the end of the day it checks in, in Aruba, the same rule the
    // rest of the board follows.
    expires_at: new Date(Date.parse(`${read.from}T23:59:59-04:00`)).toISOString(),
    posted_by: iset?.poster_member_id ?? null,
  };

  if (dry) return json({ ok: true, dryRun: true, wouldPost: row, read });

  const { data: deal, error } = await sb.from('deals').insert(row).select('id').single();
  if (error) return json({ error: error.message, row }, 500);

  await sb.from('ingest_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', 'mail');

  const { count } = await sb.from('watches').select('id', { count: 'exact', head: true }).eq('active', true);
  return json({
    ok: true, dealId: deal.id, conf: read.conf, place: stay.name, unit: read.unit,
    from: read.from, to: read.to, nights: read.nights,
    allInUsd: read.allInUsd, pointsTotal, pointsPerNight: perNight,
    watchesOpen: count ?? 0,
  });
});
