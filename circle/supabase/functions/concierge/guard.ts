// The number guard: Ian may only say a figure that a tool gave this turn.
//
// Three things make that true rather than approximately true:
//   - Figures are typed. A dollar figure must be a dollar figure some tool gave, a points figure a
//     points figure: "$80,500" does not pass because a week costs 80,500 points.
//   - Only tool results count. Not the member's words, not Ian's earlier answers sent back by the
//     phone, not what Ian wrote into remember() or echoed back through an error.
//   - Where a sentence names one week by its date, its figures must be that week's (or come from no
//     week at all, like a quote). A right price on the wrong week is still wrong.
// Anything that cannot be checked (a figure in words, euros, florins) is never allowed.
// ponytail: dates are matched as "27 Nov" / "Nov 27"; a week named only by place is not paired.

export type Kind = 'usd' | 'pts' | 'pct';
export type Claim = { kind: Kind | 'other'; n: number; raw: string };
type Sets = Record<Kind, Set<number>>;
export type Week = { id: string; from: string; place: string | null; figs: Set<string> };
export type Figures = { all: Sets; loose: Sets; weeks: Week[]; links: Set<string> };

const sets = (): Sets => ({ usd: new Set(), pts: new Set(), pct: new Set() });
export const emptyFigures = (): Figures => ({ all: sets(), loose: sets(), weeks: [], links: new Set() });

const NUM = String.raw`\d[\d,.]*\d|\d`;
/** "1,162" and "1.162" are both eleven hundred and sixty-two: a dot before exactly three digits is a thousands mark. */
export function toNum(s: string) {
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  return Number(s.replace(/,/g, ''));
}
const keys = (kind: string, n: number) => [`${kind}:${Math.round(Math.abs(n))}`, `${kind}:${Math.floor(Math.abs(n))}`];

const NUMWORD = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|few|several|couple';
const RX = {
  usd: new RegExp(String.raw`(?:US\$|\$|\bUSD\s?)\s?(${NUM})(\s?[kK]\b)?`, 'gi'),
  foreign: new RegExp(String.raw`(?:€|£|\bEUR\s?|\bAWG\s?|\bAfl\.?\s?)\s?(${NUM})(\s?[kK]\b)?`, 'gi'),
  unit: new RegExp(String.raw`(?<![$€£\w.,])(${NUM})(\s?[kK])?\s*(dollars|usd|bucks|euros?|eur|florins?|awg|points|pts|point|%|percent)(?![\w])`, 'gi'),
  nightly: new RegExp(String.raw`(?<![$€£\w.,])(${NUM})(\s?[kK])?\s+(?:a|per|/)\s*night\b`, 'gi'),
  words: new RegExp(String.raw`\b(?:(?:a|and)[\s-]+)*(?:${NUMWORD})(?:[\s-]+(?:${NUMWORD}|and|a))*[\s-]+(?:dollars|bucks|points|euros|percent)\b`, 'gi'),
};

/** Every money, points or percent figure a piece of text claims. */
export function claims(text: string): Claim[] {
  const out: Claim[] = [];
  const push = (kind: Claim['kind'], num: string, k: string | undefined, raw: string) => out.push({ kind, n: toNum(num) * (k ? 1000 : 1), raw: raw.trim() });
  for (const m of text.matchAll(RX.usd)) push('usd', m[1], m[2], m[0]);
  for (const m of text.matchAll(RX.foreign)) push('other', m[1], m[2], m[0]);
  for (const m of text.matchAll(RX.unit)) {
    const u = m[3].toLowerCase();
    push(/^(dollars|usd|bucks)$/.test(u) ? 'usd' : /^(points|pts|point)$/.test(u) ? 'pts' : /^(%|percent)$/.test(u) ? 'pct' : 'other', m[1], m[2], m[0]);
  }
  for (const m of text.matchAll(RX.nightly)) push('usd', m[1], m[2], m[0]);      // "500 a night" is money
  for (const m of text.matchAll(RX.words)) out.push({ kind: 'other', n: NaN, raw: m[0] });
  return out;
}

// ---------------------------------------------------------------- what the tools gave
const SKIP = new Set(['remembered', 'noted', 'forgot', 'error', 'say', 'said_before', 'deal_id', 'stay_id', 'booking_id', 'id',
  'crew_id', 'member_id', 'from', 'to', 'plan_from', 'plan_to', 'trip_dates', 'redweek_last_read', 'checked_at', 'seen_at']);
const kindOfKey = (k: string): Kind | null =>
  /usd|price|fee|ask|public|cost/.test(k) ? 'usd' : /points|pts/.test(k) ? 'pts' : /pct|percent/.test(k) ? 'pct' : null;

/** Take the figures out of one tool result, typed by the field they sit in, and kept with their week. */
export function collect(v: unknown, into: Figures, kind: Kind | null = null, week: Week | null = null): void {
  if (v == null) return;
  const note = (k: Kind, n: number) => {
    for (const x of keys(k, n)) { into.all[k].add(Number(x.split(':')[1])); week?.figs.add(x); if (!week) into.loose[k].add(Number(x.split(':')[1])); }
  };
  if (Array.isArray(v)) { for (const x of v) collect(x, into, kind, week); return; }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    let w = week;
    if (!week && typeof o.deal_id === 'string' && typeof o.from === 'string') {
      w = { id: o.deal_id, from: o.from, place: typeof o.place === 'string' ? o.place : null, figs: new Set() };
      into.weeks.push(w);
    }
    for (const [k, x] of Object.entries(o)) {
      if (SKIP.has(k)) continue;
      if (k === 'listing') { if (typeof x === 'string' && /^https:\/\//.test(x)) into.links.add(x); continue; }
      collect(x, into, kindOfKey(k) ?? kind, w);
    }
    return;
  }
  if (typeof v === 'number') { if (kind) note(kind, v); return; }
  if (typeof v === 'string') for (const c of claims(v)) if (c.kind !== 'other' && Number.isFinite(c.n)) note(c.kind, c.n);
}

// ---------------------------------------------------------------- what Ian said
const MON: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const pad = (d: string) => d.padStart(2, '0');
/** The start dates a sentence names, as MM-DD: "27 Nov", "1 to 5 Nov", "Nov 27". */
export function datesIn(s: string) {
  const out: string[] = [];
  for (const m of s.matchAll(/\b(\d{1,2})(?:\s*(?:–|-|to)\s*\d{1,2})?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi)) out.push(`${MON[m[2].toLowerCase()]}-${pad(m[1])}`);
  for (const m of s.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/gi)) out.push(`${MON[m[1].toLowerCase()]}-${pad(m[2])}`);
  return out;
}
const words = (place: string) => place.toLowerCase().replace(/[’']/g, '').split(/\W+/).filter(w => w.length > 3 && !/^(marriotts?|aruba|resort|hotel|casino)$/.test(w));

const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n/);

/** The claims in one sentence that no tool gave, or that belong to another week than the one it names. */
function straysIn(sentence: string, f: Figures): Claim[] {
  const cs = claims(sentence);
  if (!cs.length) return [];
  const days = datesIn(sentence);
  let weeks = days.length ? f.weeks.filter(w => days.includes(w.from.slice(5))) : [];
  const named = weeks.filter(w => w.place && words(w.place).some(x => sentence.toLowerCase().replace(/[’']/g, '').includes(x)));
  if (named.length) weeks = named;
  const pairs = new Set(weeks.flatMap(w => [...w.figs]));
  return cs.filter(c => {
    if (c.kind === 'other' || !Number.isFinite(c.n)) return true;
    const [r, fl] = keys(c.kind, c.n);
    const given = f.all[c.kind].has(Number(r.split(':')[1])) || f.all[c.kind].has(Number(fl.split(':')[1]));
    if (!given) return true;
    if (!weeks.length) return false;
    return !(pairs.has(r) || pairs.has(fl) || f.loose[c.kind].has(Number(r.split(':')[1])));
  });
}

/** Every figure in the answer that may not be said, as written ("$80,500", "27%"). */
export const strays = (reply: string, f: Figures) => [...new Set(sentences(reply).flatMap(s => straysIn(s, f).map(c => c.raw)))];
/** Last resort: drop every sentence or line that still carries one. */
export const stripStray = (reply: string, f: Figures) =>
  sentences(reply).filter(s => !straysIn(s, f).length).join(' ').replace(/\s+\n/g, '\n').trim();
