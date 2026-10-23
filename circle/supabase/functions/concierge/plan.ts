// The trip plan: where, when, who, from where, which week. It outlives a conversation (it is on the
// member's own concierge_memory row) and rides in every turn's context block.
//
// The rule, from Prism-Shadow's travel agent and enforced HERE, not in the prompt: Ian may fill a
// blank from what the member said; a value already there is never overwritten by Ian. A change comes
// back as a plan_change card and the member's tap makes it. The member's own edits (the panel on the
// phone) are theirs and go straight in.
//
// The plan holds ids, dates and counts, never a price: figures are read fresh each turn. Flights have
// no dates of their own: out is the week's check-in, back its check-out, for every traveller.

export type Plan = {
  stay_id: string | null; from: string | null; to: string | null;
  adults: number | null; children: number | null; infants: number | null;   // infants: under 2, on a lap
  origin: string | null;                                                     // IATA, where they fly from
  deal_id: string | null;                                                    // the week chosen on the board
  transfer: string | null; todo: string | null; open: string | null;         // airport, things to do, open questions
};
export const FIELDS = ['stay_id', 'from', 'to', 'adults', 'children', 'infants', 'origin', 'deal_id', 'transfer', 'todo', 'open'] as const;
export type Field = typeof FIELDS[number];
export const emptyPlan = (): Plan => Object.fromEntries(FIELDS.map(f => [f, null])) as Plan;

export const MAX_NIGHTS = 28;
export const MAX_MONTHS_AHEAD = 18;
export const TEXT_CHARS = 200;
const FIGURE = /\$\s?\d|\busd\s?\d|\d\s*k?\s*(points|pts|dollars|usd)\b|€\s?\d|\beur\s?\d/i;
const isDay = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x));
export const arubaToday = (now = Date.now()) => new Date(now - 4 * 36e5).toISOString().slice(0, 10);

type Week = { id: string; stay_id: string; from_date: string; to_date: string };
export type Ctx = { resolveStay: (idOrName: string) => Promise<string | null>; deals: Week[]; now?: number };

/** A plan as stored, cleaned: anything malformed is dropped back to blank rather than trusted. */
export function asPlan(raw: unknown): Plan {
  const p = emptyPlan();
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Record<string, unknown>;
  for (const f of FIELDS) {
    const v = r[f];
    if (v == null || v === '') continue;
    if (f === 'adults' || f === 'children' || f === 'infants') { if (Number.isInteger(v)) (p as any)[f] = v; }
    else if (typeof v === 'string') (p as any)[f] = v;
  }
  return p;
}

/**
 * What Ian asked to write, checked and split: blanks it may fill, values it may only propose changing,
 * and what was refused and why. Every value is a string from a strict tool call; empty means "unchanged".
 */
export async function planFrom(current: Plan, input: Record<string, unknown>, ctx: Ctx) {
  const want: Partial<Plan> = {};
  const refused: string[] = [];
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '');
  const today = arubaToday(ctx.now);

  if (str('place')) {
    const id = await ctx.resolveStay(str('place'));
    if (id) want.stay_id = id; else refused.push(`no single place matches "${str('place')}"`);
  }
  for (const k of ['from', 'to'] as const) {
    const v = str(k);
    if (!v) continue;
    if (!isDay(v)) refused.push(`${k} must be YYYY-MM-DD`);
    else if (v < today) refused.push(`${k} has passed`);
    else want[k] = v;
  }
  for (const k of ['adults', 'children', 'infants'] as const) {
    const v = str(k);
    if (!v) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < (k === 'adults' ? 1 : 0) || n > 12) refused.push(`${k} must be a whole number${k === 'adults' ? ' from 1' : ' from 0'} to 12`);
    else want[k] = n;
  }
  if (str('origin')) {
    const v = str('origin').toUpperCase();
    if (!/^[A-Z]{3}$/.test(v) || v === 'AUA') refused.push('origin must be the three-letter code of the airport they fly from (not AUA)');
    else want.origin = v;
  }
  for (const k of ['transfer', 'todo', 'open'] as const) {
    const v = str(k);
    if (!v) continue;
    if (FIGURE.test(v)) refused.push(`${k} cannot carry a price: the plan holds no figures`);
    else want[k] = v.slice(0, TEXT_CHARS);
  }
  if (str('deal_id')) {
    const w = ctx.deals.find(d => d.id === str('deal_id'));
    const place = want.stay_id ?? current.stay_id;
    if (!w) refused.push('that week is not on the board');
    else if (place && w.stay_id !== place) refused.push('that week is at another place than the plan');
    else {
      want.deal_id = w.id;
      // Choosing a week brings its place and dates; they follow the same rule as any other field.
      want.stay_id ??= w.stay_id; want.from ??= w.from_date; want.to ??= w.to_date;
    }
  }

  // The whole plan as it would be, checked as a whole: dates that run, a stay that is not too long or
  // too far, no more lap infants than adults.
  const merged = { ...current, ...Object.fromEntries(Object.entries(want).filter(([k]) => current[k as Field] == null)) } as Plan;
  const proposed = { ...current, ...want } as Plan;
  for (const [label, p] of [['', merged], [' (as proposed)', proposed]] as const) {
    if (p.from && p.to) {
      const nights = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 864e5);
      if (nights <= 0) refused.push(`the dates run backwards${label}`);
      else if (nights > MAX_NIGHTS) refused.push(`a plan is at most ${MAX_NIGHTS} nights${label}`);
      const far = new Date(Date.parse(today)); far.setUTCMonth(far.getUTCMonth() + MAX_MONTHS_AHEAD);
      if (p.from > far.toISOString().slice(0, 10)) refused.push(`a plan starts within ${MAX_MONTHS_AHEAD} months${label}`);
    }
    if (p.infants != null && p.infants > (p.adults ?? 0)) refused.push(`there cannot be more lap infants than adults${label}`);
  }
  if (refused.length) return { plan: current, filled: [] as Field[], change: null as Partial<Plan> | null, refused: [...new Set(refused)] };

  // The rule: a blank may be filled; a value already there is only ever proposed.
  const filled: Field[] = [];
  const change: Partial<Plan> = {};
  const next = { ...current };
  for (const [k, v] of Object.entries(want) as [Field, any][]) {
    if (current[k] == null) { (next as any)[k] = v; filled.push(k); }
    else if (current[k] !== v) (change as any)[k] = v;
  }
  // A week whose place or dates differ from the plan's is part of that change, never filled ahead of it.
  if (want.deal_id && (change.stay_id || change.from || change.to) && filled.includes('deal_id')) {
    next.deal_id = current.deal_id; filled.splice(filled.indexOf('deal_id'), 1); change.deal_id = want.deal_id;
  }
  return { plan: next, filled, change: Object.keys(change).length ? change : null, refused };
}

/** What the plan still needs, in the order Ian asks for it. */
export function missing(p: Plan): string[] {
  const out: string[] = [];
  if (!p.stay_id || !p.from || !p.to) out.push('place and dates');
  if (!p.adults) out.push('who is travelling (adults, children, lap infants)');
  if (!p.origin) out.push('where they fly from');
  if (!p.deal_id) out.push('which week on the board');
  if (!p.transfer) out.push('getting from the airport');
  return out;
}

/** The two legs, from the chosen week's own dates (or the plan's when no week is chosen). Never other dates. */
export function legs(p: Plan, week?: { from_date: string; to_date: string } | null) {
  const out = week?.from_date ?? p.from, back = week?.to_date ?? p.to;
  if (!out || !back) return null;
  return { out, back, origin: p.origin, adults: p.adults ?? 0, children: p.children ?? 0, infants: p.infants ?? 0 };
}
