// Turns an alert email into a deal on the board.
//
// WHY THIS SHAPE. Interval International's membership terms forbid automated access, and
// RedWeek's terms of service carry an explicit anti-scraping clause (they even publish an
// llms.txt saying so). Neither has an API. So the club does NOT scrape them and does NOT
// hand anyone's login to a robot. What it does instead is the sanctioned thing: Victor and
// Ian switch on the alerts those sites already offer —
//
//   · Interval "Getaway Alerts" in the Interval To Go app (push, 7+ nights, Getaways only)
//   · RedWeek "Posting Alerts" by email
//   · Marriott Vacation Club / Abound waitlist emails
//   · Iberostar and hotel newsletters
//
// — and forward those emails to a club address. A Cloudflare Email Worker (free) parses the
// message and POSTs it here. The deal is on every Insider's phone seconds after the email
// lands, which is as fast as any of this can legitimately go.
//
// For Interval EXCHANGE inventory the right tool is Interval's own Ongoing Search: it is
// their product for "keep looking until it appears", it runs nightly, and it books for you.
// Nothing here can beat it, so the app does not pretend to.
//
// Deploy:  supabase functions deploy ingest-deal --no-verify-jwt
// Secrets: INGEST_SECRET (a long random string, shared with the email worker)
//          DEAL_POSTER_MEMBER_ID (the members.id the deals are attributed to)

import { createClient } from 'jsr:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Constant-time compare, so the secret cannot be guessed a character at a time. */
function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a), bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

const SOURCES = new Set(['interval', 'redweek', 'iberostar', 'airbnb', 'vrbo', 'hotel', 'member', 'other']);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const secret = Deno.env.get('INGEST_SECRET') ?? '';
  const given = req.headers.get('x-ingest-secret') ?? '';
  if (!secret || !safeEqual(secret, given)) return json({ error: 'no' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Body must be JSON' }, 400); }

  const {
    property, roomType = null, from, to, points = null, usd = null,
    source = 'other', sourceUrl = '', note = '', nights: nightsIn = null, retailUsd = null,
  } = body as Record<string, any>;

  if (!property || !from || !to) return json({ error: 'property, from and to are required' }, 400);
  if (!SOURCES.has(String(source))) return json({ error: `source must be one of ${[...SOURCES].join(', ')}` }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Match the property by name. Deliberately fuzzy on one side only: an alert email says
  // "Marriott's Aruba Surf Club" and the catalog says the same, but punctuation drifts.
  const clean = String(property).replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim();
  const { data: stays, error: stayErr } = await sb
    .from('stays').select('id, name, kind, rate_low_usd, min_nights').eq('active', true);
  if (stayErr) return json({ error: stayErr.message }, 500);

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const target = norm(clean);
  const stay = stays?.find((s) => norm(s.name) === target)
    ?? stays?.find((s) => norm(s.name).includes(target) || target.includes(norm(s.name)));
  if (!stay) return json({ error: `No property in the catalog matches "${property}"`, known: stays?.map(s => s.name) }, 422);

  const nights = Number(nightsIn) || Math.max(1, Math.round(
    (Date.parse(String(to)) - Date.parse(String(from))) / 86400000));

  // Points are the club's unit. An email that only quotes dollars is converted at the
  // club's own rate, which is the same 100-points-to-the-dollar members see everywhere.
  const { data: settings } = await sb.from('settings').select('points_per_dollar').eq('id', 1).maybeSingle();
  const ppd = Number(settings?.points_per_dollar) || 100;
  const pointsTotal = points != null ? Math.round(Number(points))
    : usd != null ? Math.round(Number(usd) * ppd)
    : Math.round(Number(stay.rate_low_usd || 0) * ppd * nights);
  if (!(pointsTotal > 0)) return json({ error: 'Could not work out a price — send points or usd' }, 400);

  let roomTypeId: string | null = null;
  if (roomType) {
    const { data: rts } = await sb.from('room_types').select('id, name').eq('stay_id', stay.id).eq('active', true);
    const rt = rts?.find((r) => norm(r.name) === norm(String(roomType)))
      ?? rts?.find((r) => norm(r.name).includes(norm(String(roomType))));
    roomTypeId = rt?.id ?? null;
  }

  const { data: deal, error } = await sb.from('deals').insert({
    stay_id: stay.id,
    room_type_id: roomTypeId,
    kind: stay.kind === 'trip' ? 'trip' : 'aruba',
    title: stay.name,
    from_date: from, to_date: to, nights,
    points_total: pointsTotal,
    points_per_night: Math.round(pointsTotal / nights),
    retail_usd: retailUsd ?? null,
    source, source_url: sourceUrl || null,
    source_ref: 'email-ingest',
    note: note || null,
    posted_by: Deno.env.get('DEAL_POSTER_MEMBER_ID') || null,
  }).select().single();
  if (error) return json({ error: error.message }, 500);

  // Tell the caller who this will reach, so a forwarding rule can be tuned or switched off.
  const { data: watches } = await sb.from('watches').select('id, member_id').eq('active', true);
  return json({ ok: true, dealId: deal.id, property: stay.name, nights, pointsTotal, watchesOpen: watches?.length ?? 0 });
});
