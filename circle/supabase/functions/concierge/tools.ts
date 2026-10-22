// What Ian can look at, and the one thing it can keep.
//
// Every read goes through `Data`, which index.ts builds on a Supabase client carrying the
// member's own token: row-level security decides what Ian sees, exactly as it decides what the
// member's phone sees. No tool books, pledges or moves anything. `propose` returns a card with
// ids on it; the member's tap runs the app's own code. `remember` writes one thing: the member's
// own notes row.
//
// Results are trimmed to ROWS rows and every null is said in words, so "no public rate on file"
// reaches the model as a sentence rather than as a gap it might fill.

import { cheaperNextDoor, dealFacts, LOOKS_WRONG, monthsToAfford, seasonEdge, type Deal, type Settings, type Stay } from './compare.ts';
import { memberContext, personOf } from './redact.ts';
import { flights } from './flights/index.ts';

export const ROWS = 40;
// The board's rows are verbose; past a dozen, Haiku started reading one row's date into another
// (first live run, 22 Oct). Twelve cheapest is what a member reads anyway; filters narrow it.
export const BOARD_ROWS = 12;
export const MEMORY_KEYS = 20;
export const MEMORY_CHARS = 200;

export type Data = {
  settings(): Promise<Settings & { model: string; dailyUsd: number }>;
  me(): Promise<{ id: string; name: string; monthly_usd: number }>;
  stays(): Promise<(Stay & Record<string, unknown>)[]>;
  roomTypes(): Promise<Record<string, unknown>[]>;
  deals(): Promise<(Deal & Record<string, unknown>)[]>;
  quote(stay: string, from: string, to: string, seats: number): Promise<Record<string, unknown>>;
  available(member: string): Promise<number>;
  redemptions(): Promise<any[]>;
  pledges(): Promise<{ redemption_id: string; points: number }[]>;
  crews(): Promise<any[]>;
  crewMembers(): Promise<any[]>;
  watches(): Promise<any[]>;
  members(): Promise<{ id: string; name: string; status: string; bot?: boolean }[]>;
  redweekChecks(): Promise<{ stay_id: string; checked_at: string }[] | null>;
  memory(): Promise<Record<string, string>>;
  saveMemory(notes: Record<string, string>): Promise<void>;
};

export type Card = {
  action: 'create_crew' | 'invite' | 'ask_dates' | 'refresh';
  name: string | null; about: string | null; stay_id: string | null; from: string | null; to: string | null;
  crew_id: string | null; member_id: string | null; deal_id: string | null; redemption_id: string | null;
};

const S = (description: string) => ({ type: ['string', 'null'], description });
// Strict mode allows at most 16 nullable parameters across all tools, so the rarely-used ones are
// plain strings where empty means "not used".
const E = (description: string) => ({ type: 'string', description: `${description}, or empty` });
const obj = (properties: Record<string, unknown>) =>
  ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const DATE = 'YYYY-MM-DD';

/** The tool list. Order is part of the cached prefix: change it and the cache starts over once. */
export const TOOLS = [
  { name: 'board', description: 'Weeks on the Circle\'s board right now (RedWeek owner weeks, Interval Getaways and others), cheapest per night first, with every figure worked out: per night and total all in, the owner\'s ask, fees, the public rate, how old the read is, and a cheaper week next door if one exists. Filter by place and/or dates (overlapping).',
    input_schema: obj({ stay_id: S('A place id or name, or null for every place'), from: S(DATE + ' or null'), to: S(DATE + ' or null') }) },
  { name: 'redweek', description: 'Only the RedWeek owner weeks on the board for a place (or all places), owner ask against the public rate, with the listing link, and when RedWeek was last read for that place.',
    input_schema: obj({ stay_id: S('A place id or name, or null') }) },
  { name: 'getaways', description: 'Only the Interval Getaways on the board. A Getaway is sold by the week; per night is the week divided by its nights, never bookable nightly.',
    input_schema: obj({ stay_id: S('A place id or name, or null') }) },
  { name: 'places', description: 'The Circle\'s places: rates per night all in by part of the year, public rate, minimum nights, all-inclusive, and room types when the filter names one to three places.',
    input_schema: obj({ filter: S('Words to match a place name or area, or null for all') }) },
  { name: 'quote', description: 'The Circle\'s indicative all-in price for any dates at a place, the same number the Ask screen prints, with the minimum stay, how many nights fall at the peak rate, whether the member can cover it, and months to save the gap. Victor confirms every price before he books.',
    input_schema: obj({ stay_id: { type: 'string', description: 'A place id, or the place\'s name as the board prints it' }, from: { type: 'string', description: DATE }, to: { type: 'string', description: DATE }, guests: { type: 'integer', description: 'How many people' } }) },
  { name: 'me', description: 'The member you are talking to: points they hold, their level, their bookings, crews and watches.',
    input_schema: obj({}) },
  { name: 'people', description: 'Insiders by first name and id, for inviting someone into a crew.',
    input_schema: obj({}) },
  { name: 'shared_bookings', description: 'Other Insiders\' bookings that are open for the Circle to chip in to, as the app shows them: place, dates, whose, and points still open.',
    input_schema: obj({}) },
  { name: 'refresh_redweek', description: 'Offer the member a fresh look at a place: puts a button on their screen. When they tap it the watcher re-reads RedWeek\'s public page and checks Interval within its own limits, the same as opening the place in the app. Nothing is read until they tap.',
    input_schema: obj({ stay_id: { type: 'string', description: 'A place id or name' } }) },
  { name: 'flights', description: 'Air fares. Not connected yet. Interval is where the Circle finds flights, cars, cruises and packages, through Victor.',
    input_schema: obj({ from: E('Airport code'), to: E('Airport code'), date: E(DATE), pax: { type: 'integer', description: 'Passengers' } }) },
  { name: 'remember', description: 'Keep one thing about this member for next time: usual dates, who they travel with, budget, places they like or dislike, kitchen or not. An empty value forgets the key. Tell the member what you noted.',
    input_schema: obj({ key: { type: 'string', description: 'short_snake_case, e.g. usual_month' }, value: { type: 'string', description: 'At most 200 characters; empty to forget' } }) },
  { name: 'propose', description: 'Put a card in front of the member for them to tap. Nothing happens until they do. create_crew needs name, stay_id, from and to (a crew can start from a plan; redemption_id only if it is their approved booking there). invite needs crew_id (one they lead) and member_id. ask_dates needs stay_id, from and to, and deal_id when it is a week on the board.',
    input_schema: obj({ action: { type: 'string', enum: ['create_crew', 'invite', 'ask_dates'] }, name: E('Crew name'), about: E('One line about the crew'),
      stay_id: E('Place id or name'), from: E(DATE), to: E(DATE), crew_id: E('Crew id'), member_id: E('Member id'), deal_id: E('Board week id'), redemption_id: E('Booking id') }) },
].map(t => ({ ...t, strict: true }));

const FIGURE = /\$\s?\d|\busd\s?\d|\d\s*k?\s*(points|pts|dollars|usd)\b/i;
const isDay = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x));
const today = () => new Date(Date.now() - 4 * 36e5).toISOString().slice(0, 10);     // Aruba, UTC-4, no DST
const first = (n?: string) => String(n || '').trim().split(/\s+/)[0];

export type Ctx = { data: Data; cards: Card[]; cache: Map<string, Promise<unknown>> };

/**
 * A place, by its id or by its name. Only text survives from one turn to the next, so by the third
 * question the model has the place's name and not its id; on the first live run it made one up
 * ("marriotts-aruba-surf-club") and the quote failed. A name that matches one place is that place.
 */
const norm = (x: unknown) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export async function stayIdOf(ctx: Ctx, idOrName: unknown): Promise<string | null> {
  const want = String(idOrName || '').trim();
  if (!want) return null;
  const stays = await once(ctx, 'stays', () => ctx.data.stays());
  if (stays.some(x => x.id === want)) return want;
  const w = norm(want).replace(/\b(marriotts?|aruba|resort|the|and|casino|hotel)\b/g, ' ').split(/\s+/).filter(Boolean);
  const hit = w.length ? stays.filter(x => w.every(t => norm(x.name).includes(t))) : [];
  return hit.length === 1 ? hit[0].id : null;
}
/** One read per turn per table, however many tools ask for it. */
const once = <T>(ctx: Ctx, k: string, f: () => Promise<T>) => {
  if (!ctx.cache.has(k)) ctx.cache.set(k, f());
  return ctx.cache.get(k) as Promise<T>;
};

async function boardFacts(ctx: Ctx, { stay_id = null, from = null, to = null, source = null }: { stay_id?: string | null; from?: string | null; to?: string | null; source?: string | null }) {
  if (stay_id) { const id = await stayIdOf(ctx, stay_id); if (!id) return { error: `No single place matches "${stay_id}". Use places() for its id.` }; stay_id = id; }
  const [s, stays, deals] = await Promise.all([once(ctx, 's', () => ctx.data.settings()), once(ctx, 'stays', () => ctx.data.stays()), once(ctx, 'deals', () => ctx.data.deals())]);
  const byId = new Map(stays.map(x => [x.id, x]));
  const everything = deals
    .filter(d => !stay_id || d.stay_id === stay_id)
    .filter(d => !source || d.source === source)
    .filter(d => !isDay(from) || d.to_date > from)
    .filter(d => !isDay(to) || d.from_date < to)
    .map(d => dealFacts(d, byId.get(d.stay_id), s))
    // Not seen for 7 days is retired by the database; a row the watcher has not caught up with yet is not offered.
    .filter(f => !f.retired_by_age);
  // Ian recommends only what was seen in the last 48 hours. The rest is shown as old, with the tap that re-checks it.
  const older = everything.filter(f => !f.fresh).sort((a, b) => a.per_night_usd - b.per_night_usd || a.from.localeCompare(b.from));
  const rows = everything
    .filter(f => f.fresh)
    // A misread price is not the cheapest week: it goes last, flagged, never led with. Then Interval above
    // the rest, as the Stays list has it (Victor, 22 Oct), and the cheapest a night within each.
    .sort((a, b) => Number(!!a.implausible) - Number(!!b.implausible) || Number(b.source === 'interval') - Number(a.source === 'interval')
      || a.per_night_usd - b.per_night_usd || a.from.localeCompare(b.from));
  const next = cheaperNextDoor(rows.filter(f => !f.implausible));
  // Interval is the Circle's best source (Victor, 22 Oct). Whether it has anything here is a fact
  // Ian says first, either way.
  const interval = rows.filter(f => f.source === 'interval' && !f.implausible).length;
  // A price that cannot be real reaches Ian with no figures at all, so it cannot be quoted.
  // Twelve real weeks, plus up to three that look wrong, so "nothing looks wrong" is something Ian can know.
  const wrong = rows.filter(f => f.implausible);
  const shown = [...rows.filter(f => !f.implausible).slice(0, BOARD_ROWS), ...wrong.slice(0, 3)].map(f => f.implausible ? {
    deal_id: f.deal_id, stay_id: f.stay_id, place: f.place, source: f.source, from: f.from, to: f.to, nights: f.nights, listing: f.listing,
    price: LOOKS_WRONG, why: `${f.implausible}: almost certainly a misread listing. Never quote it or offer it as a deal; say Victor checks it.`,
  } : ({
    ...f,
    owner_ask_per_night_usd: f.owner_ask_per_night_usd ?? (f.source === 'redweek' ? 'no owner ask in the title' : null),
    public_total_usd: f.public_total_usd ?? 'no public rate on file',
    under_public_usd: f.under_public_usd ?? 'cannot compare: no public rate on file',
    seen_days_ago: f.seen_days_ago ?? 'never recorded',
    cheaper_next_door: next[f.deal_id] ?? null,
  }));
  // Older weeks: where and when, what they said, and how old — never as a recommendation.
  const oldShown = older.slice(0, BOARD_ROWS).map(f => ({
    deal_id: f.deal_id, stay_id: f.stay_id, place: f.place, source: f.source, from: f.from, to: f.to, nights: f.nights,
    per_night_usd_when_seen: f.implausible ? null : f.per_night_usd, total_usd_all_in_when_seen: f.implausible ? null : f.total_usd_all_in,
    last_seen: f.last_seen, listing: f.listing,
    recommend: false, recheck_with: 'refresh_redweek',
  }));
  const fewer = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return { weeks: shown, total_on_board: rows.length + older.length, shown: shown.length, all_in_means: 'the room plus the Circle\'s 15%, what comes off a member\'s points',
    seen_in_last_48_hours: rows.length,
    interval_weeks_matching: interval,
    looks_wrong_on_board: wrong.length,
    ...(older.length ? { older_weeks: oldShown, older_said: `${fewer(older.length, 'week')} here ${older.length === 1 ? 'was' : 'were'} last seen more than 48 hours ago. They are NOT recommendations. Say each one was "last seen N days ago, tap to re-check" and offer refresh_redweek for the place, which is the tap that re-checks it.` } : {}),
    ...(source === 'redweek' ? {} : { interval_said: interval ? `${interval} Interval Getaway${interval === 1 ? '' : 's'} on the board for this. Lead with Interval.` : 'Interval has nothing on the board for this place and these dates right now.' }),
    ...(rows.length ? {} : { said: older.length
      ? `Nothing on the board for this was seen in the last 48 hours. ${fewer(older.length, 'older week')} ${older.length === 1 ? 'is' : 'are'} listed under older_weeks, with when each was last seen.`
      : `Nothing on the board matches${source ? ` from ${source === 'interval' ? 'Interval' : 'RedWeek'}` : ''} right now.` }) };
}

export async function runTool(name: string, input: any, ctx: Ctx): Promise<unknown> {
  const d = ctx.data;
  switch (name) {
    case 'board': return boardFacts(ctx, input || {});
    case 'redweek': {
      const out: any = await boardFacts(ctx, { stay_id: input?.stay_id, source: 'redweek' });
      const sid = await stayIdOf(ctx, input?.stay_id);
      const checks = await d.redweekChecks().catch(() => null);
      const c = checks?.find(x => x.stay_id === sid);
      return { ...out, redweek_last_read: c ? c.checked_at : 'no record of when RedWeek was last read for this place' };
    }
    case 'getaways': {
      const out: any = await boardFacts(ctx, { stay_id: input?.stay_id, source: 'interval' });
      if (out.error) return out;
      return { ...out, weeks: out.weeks.map((w: any) => ({ ...w, per_night_note: 'the week divided by its nights; sold only as the whole week' })) };
    }
    case 'places': {
      const [s, stays, rooms] = await Promise.all([once(ctx, 's', () => d.settings()), once(ctx, 'stays', () => d.stays()), once(ctx, 'rooms', () => d.roomTypes())]);
      const words = String(input?.filter || '').toLowerCase().split(/\s+/).filter(Boolean);
      const hit = stays.filter(x => !words.length || words.every(w => `${x.name} ${x.area ?? ''} ${x.kind ?? ''}`.toLowerCase().includes(w)));
      const allIn = (usd: unknown) => (Number(usd) > 0 ? Math.round(Number(usd) * (1 + s.serviceRate)) : 'not on file');
      return {
        places: hit.slice(0, ROWS).map(x => ({
          id: x.id, name: x.name, area: x.area ?? null, kind: x.kind,
          per_night_all_in_usd: x.kind === 'trip' ? null : { apr_to_dec: allIn(x.rate_low_usd), jan_to_apr: allIn(x.rate_high_usd), christmas_and_carnival: allIn(x.rate_peak_usd) },
          seat_all_in_points: x.kind === 'trip' && x.points_per_seat ? Math.round(Number(x.points_per_seat) * (1 + s.serviceRate)) : null,
          trip_dates: x.kind === 'trip' ? { from: x.starts_on ?? null, to: x.ends_on ?? null } : null,
          public_rate_per_night_usd: Number(x.retail_usd) > 0 ? Math.round(Number(x.retail_usd)) : 'no public rate on file',
          min_nights: x.min_nights ?? null, min_nights_at_peak: x.peak_min_nights ?? null,
          all_inclusive: !!x.all_inclusive, taxes_included: !!x.taxes_included, one_of_the_four_we_use: !!x.house,
          from_victor: x.deal_note || null,
          rooms: hit.length <= 3 ? rooms.filter(r => r.stay_id === x.id).map(r => ({ name: r.name, sleeps: r.sleeps, bedrooms: r.bedrooms, kitchen: r.kitchen, view: r.view ?? null, sqft: r.sqft ?? null })) : undefined,
        })),
        reviews: 'The Circle keeps no reviews. Say nothing about reviews.',
      };
    }
    case 'quote': {
      const sid = await stayIdOf(ctx, input?.stay_id);
      if (!sid) return { error: `No single place matches "${input?.stay_id}". Use places() for its id.` };
      input = { ...input, stay_id: sid };
      if (!isDay(input?.from) || !isDay(input?.to) || input.to <= input.from) return { error: 'Give a from and a to as YYYY-MM-DD, to after from.' };
      const [s, me] = await Promise.all([once(ctx, 's', () => d.settings()), once(ctx, 'me', () => d.me())]);
      const [q, have, stays, rooms] = await Promise.all([d.quote(input.stay_id, input.from, input.to, 1), d.available(me.id), once(ctx, 'stays', () => d.stays()), once(ctx, 'rooms', () => d.roomTypes())]);
      const pts = Number(q.points) || 0;
      const stay = stays.find(x => x.id === input.stay_id);
      const pub = Number(q.retail_usd) || 0;
      return {
        place: stay?.name ?? null, from: input.from, to: input.to, nights: q.nights,
        all_in_points: pts, all_in_usd: Math.round(pts / s.pointsPerDollar), per_night_all_in_usd: q.nights ? Math.round(pts / s.pointsPerDollar / Number(q.nights)) : null,
        indicative: 'Victor confirms every price before he books',
        public_total_usd: pub > 0 ? Math.round(pub) : 'no public rate on file',
        under_public_usd: pub > 0 ? Math.round(pub - pts / s.pointsPerDollar) : 'cannot compare: no public rate on file',
        min_nights: q.min_nights, below_minimum: Number(q.nights) < Number(q.min_nights),
        season_edge: seasonEdge(input.from, input.to),
        member_holds_points: have, can_cover: have >= pts, short_points: Math.max(0, pts - have),
        months_to_save_gap_at_their_level: monthsToAfford(s, pts, me.monthly_usd, have),
        rooms_sleeping_enough: rooms.filter(r => r.stay_id === input.stay_id && Number(r.sleeps) >= Number(input.guests || 1)).map(r => r.name),
      };
    }
    case 'me': {
      const [s, me] = await Promise.all([once(ctx, 's', () => d.settings()), once(ctx, 'me', () => d.me())]);
      const [available, redemptions, crews, crewMembers, watches, members, stays, memory] = await Promise.all([
        d.available(me.id), once(ctx, 'red', () => d.redemptions()), d.crews(), d.crewMembers(), d.watches(),
        once(ctx, 'members', () => d.members()), once(ctx, 'stays', () => d.stays()), once(ctx, 'memory', () => d.memory())]);
      const stayName = (id?: string | null) => stays.find(x => x.id === id)?.name ?? null;
      const memberName = (id: string) => members.find(m => m.id === id)?.name ?? null;
      return memberContext({ member: me, available, pointsPerDollar: s.pointsPerDollar, redemptions, crews, crewMembers, watches, memory, stayName, memberName });
    }
    case 'people': {
      const members = await once(ctx, 'members', () => d.members());
      return { people: members.filter(m => m.status === 'active' && !m.bot).map(personOf) };
    }
    case 'shared_bookings': {
      const [me, red, pledges, members, stays] = await Promise.all([once(ctx, 'me', () => d.me()), once(ctx, 'red', () => d.redemptions()), d.pledges(), once(ctx, 'members', () => d.members()), once(ctx, 'stays', () => d.stays())]);
      const open = red.filter(r => r.shared && ['quoted', 'held'].includes(r.status) && r.member_id !== me.id).map(r => {
        const price = Number(r.quoted_points || r.indicative_points || 0);
        const covered = Number(r.points || 0) + pledges.filter(p => p.redemption_id === r.id).reduce((n, p) => n + Number(p.points), 0);
        return { booking_id: r.id, place: stays.find(x => x.id === r.stay_id)?.name ?? null, from: r.check_in, to: r.check_out, nights: r.nights,
          whose: first(members.find(m => m.id === r.member_id)?.name), points_still_open: Math.max(0, price - covered) };
      }).filter(r => r.points_still_open > 0);
      return { open_to_chip_in: open.slice(0, ROWS), how: 'Chipping in is done on the booking\'s own page in the app.' };
    }
    case 'refresh_redweek': {
      // The member asks for a fresh read, not Ian: this is a button for them to tap (Victor's watcher,
      // its caps, and Interval's terms are spent on a person's tap, never on a model's guess).
      const sid = await stayIdOf(ctx, input?.stay_id);
      if (!sid) return { error: `No single place matches "${input?.stay_id}".` };
      if (ctx.cards.some(c => c.action === 'refresh' && c.stay_id === sid)) return { shown: true };
      ctx.cards.push({ action: 'refresh', name: null, about: null, stay_id: sid, from: null, to: null, crew_id: null, member_id: null, deal_id: null, redemption_id: null });
      return { shown: true, say: 'A "look again" button is on their screen. Nothing is read until they tap it; then ask again in a minute.' };
    }
    case 'flights': return flights(input);
    case 'remember': {
      const key = String(input?.key || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
      const value = String(input?.value || '').trim().slice(0, MEMORY_CHARS);
      if (!key) return { error: 'Give the note a short key.' };
      const notes = { ...(await once(ctx, 'memory', () => d.memory())) };
      if (!value) delete notes[key];
      else {
        if (!(key in notes) && Object.keys(notes).length >= MEMORY_KEYS) return { error: `Already keeping ${MEMORY_KEYS} notes for this member; forget one first.` };
        notes[key] = value;
      }
      await d.saveMemory(notes);
      ctx.cache.set('memory', Promise.resolve(notes));
      return value ? { noted: { [key]: value }, say: 'Tell the member, in one short line, what you noted.' } : { forgot: key };
    }
    case 'propose': return propose(input, ctx);
    default: return { error: `No tool called ${name}.` };
  }
}

/** Check a card against what the member can actually do before it reaches the phone. */
async function propose(a: any, ctx: Ctx) {
  const d = ctx.data;
  const v = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  const card: Card = { action: a?.action, name: v(a?.name), about: v(a?.about), stay_id: v(a?.stay_id), from: v(a?.from), to: v(a?.to),
    crew_id: v(a?.crew_id), member_id: v(a?.member_id), deal_id: v(a?.deal_id), redemption_id: v(a?.redemption_id) };
  const stays = await once(ctx, 'stays', () => d.stays());
  if (card.stay_id) card.stay_id = await stayIdOf(ctx, card.stay_id);
  const dates = () => isDay(card.from) && isDay(card.to) && card.to! > card.from! && card.from! >= today();
  if (card.action === 'create_crew') {
    const nm = String(card.name || '').trim();
    if (nm.length < 2 || nm.length > 40) return { error: 'A crew name is 2 to 40 characters.' };
    // The guard Victor kept: a crew Ian suggests names a place and the dates, even when a room exists.
    if (!stays.some(x => x.id === card.stay_id) || !dates()) return { error: 'A crew needs a place (stay_id from places) and future dates, from before to.' };
    if (card.redemption_id) {
      // Only their own approved room there; anything else starts the crew from the plan instead.
      const [me, red] = await Promise.all([once(ctx, 'me', () => d.me()), once(ctx, 'red', () => d.redemptions())]);
      const r = red.find(x => x.id === card.redemption_id);
      if (!r || r.member_id !== me.id || r.stay_id !== card.stay_id || !['held', 'confirmed', 'completed'].includes(r.status)) card.redemption_id = null;
    }
    // A card never carries a price: the number guard does not read card text, so no figure goes on one.
    if (FIGURE.test(nm)) return { error: 'A crew name carries no prices or points.' };
    card.name = nm; card.about = card.about && !FIGURE.test(card.about) ? String(card.about).slice(0, 120) : null;
  } else if (card.action === 'invite') {
    const [me, cm, members] = await Promise.all([once(ctx, 'me', () => d.me()), d.crewMembers(), once(ctx, 'members', () => d.members())]);
    if (!cm.some(m => m.crew_id === card.crew_id && m.member_id === me.id && m.role === 'lead')) return { error: 'Only the crew\'s lead can add people, and this member does not lead that crew.' };
    if (!members.some(m => m.id === card.member_id && m.status === 'active' && !m.bot)) return { error: 'No such Insider; use an id from people().' };
    if (cm.some(m => m.crew_id === card.crew_id && m.member_id === card.member_id)) return { error: 'They are already in that crew.' };
  } else if (card.action === 'ask_dates') {
    if (!stays.some(x => x.id === card.stay_id) || !dates()) return { error: 'Asking needs a place and future dates, from before to.' };
    if (card.deal_id) {
      const deals = await once(ctx, 'deals', () => d.deals());
      if (!deals.some(x => x.id === card.deal_id && x.stay_id === card.stay_id)) card.deal_id = null;
    }
  } else return { error: 'action is create_crew, invite or ask_dates.' };
  if (ctx.cards.length >= 3) return { error: 'Three cards is enough for one answer.' };
  ctx.cards.push(card);
  return { shown: true, say: 'The card is on their screen with a button. Do not repeat its details as figures.' };
}

/**
 * `Data` on a Supabase client that carries the member's own token. Officers can read every
 * booking under row-level security; the tools narrow to the member's own where it matters
 * (redact.ts for me(), the shared filter for shared_bookings()).
 */
export function dataFor(sb: any, member: { id: string; name: string; monthly_usd: number }): Data {
  const rows = async (q: PromiseLike<{ data: any; error: any }>) => { const { data, error } = await q; if (error) throw new Error(error.message); return data ?? []; };
  const now = () => new Date().toISOString();
  return {
    settings: async () => {
      const s = await rows(sb.from('settings').select('points_per_dollar, service_rate, tiers, concierge_model, concierge_daily_usd').eq('id', 1).single());
      return { pointsPerDollar: Number(s.points_per_dollar) || 100, serviceRate: Number(s.service_rate) || 0, tiers: s.tiers || [],
        model: s.concierge_model, dailyUsd: Number(s.concierge_daily_usd) };
    },
    me: async () => member,
    stays: () => rows(sb.from('stays').select('id, name, area, kind, rate_low_usd, rate_high_usd, rate_peak_usd, retail_usd, min_nights, peak_min_nights, all_inclusive, taxes_included, house, deal_note, points_per_seat, starts_on, ends_on').eq('active', true)),
    roomTypes: () => rows(sb.from('room_types').select('stay_id, name, sleeps, bedrooms, kitchen, view, sqft').eq('active', true)),
    // What the board shows a member right now: live, past its drop hour, not expired.
    deals: async () => (await rows(sb.from('deals').select('id, stay_id, from_date, to_date, nights, points_total, points_per_night, source, source_url, title, note, seen_at, posted_at, expires_at, drop_at').eq('status', 'live')))
      .filter((d: any) => (!d.drop_at || d.drop_at <= now()) && (!d.expires_at || d.expires_at > now())),
    quote: async (stay, from, to, seats) => { const q = await rows(sb.rpc('quote_points', { p_stay: stay, p_in: from, p_out: to, p_seats: seats })); return Array.isArray(q) ? q[0] : q; },
    // available_points itself is revoked from members; my_available_points() is the same figure for yourself.
    available: async () => Number(await rows(sb.rpc('my_available_points'))) || 0,
    redemptions: () => rows(sb.from('redemptions').select('id, member_id, stay_id, check_in, check_out, nights, status, shared, points, quoted_points, indicative_points')),
    pledges: () => rows(sb.from('pledges').select('redemption_id, points')),
    crews: () => rows(sb.from('crews').select('id, name, redemption_id, stay_id, plan_from, plan_to, archived_at')),
    crewMembers: () => rows(sb.from('crew_members').select('crew_id, member_id, role')),
    watches: () => rows(sb.from('watches').select('member_id, stay_id, from_date, to_date, nights, active').eq('member_id', member.id)),
    members: () => rows(sb.from('members').select('id, name, status, bot')),
    redweekChecks: () => rows(sb.from('redweek_checks').select('stay_id, checked_at')).catch(() => null),
    memory: async () => (await rows(sb.from('concierge_memory').select('notes').eq('member_id', member.id).maybeSingle()))?.notes || {},
    saveMemory: async (notes) => { await rows(sb.from('concierge_memory').upsert({ member_id: member.id, notes, updated_at: now() })); },
  };
}
