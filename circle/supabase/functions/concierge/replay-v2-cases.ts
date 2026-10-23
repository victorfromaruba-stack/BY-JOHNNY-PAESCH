// Ian v2's cases for the nightly replay (replay.ts, which another agent owns). Import and wire, five lines:
//
//   import { V2_CASES, V2_CHECKS, V2_GLOBAL, applySeed, copyV2Files } from './replay-v2-cases.ts';
//   Object.assign(CHECKS, V2_CHECKS); GLOBAL.push(...V2_GLOBAL);           // after CHECKS / GLOBAL
//   const cases = [...FIXED, ...V2_CASES, ...real...]                        // and raise the cap from 30 to 40
//   await copyV2Files(here, tmp);                                            // right after copy(here, tmp)
//   const { data, dates } = fixture(now); applySeed(data, kase, now);        // before each ian.turn(...)
//
// The seeds are trip plans dated from the run day against the fixture's own weeks (surf: rw1 D30-37,
// iv1 D32-39). Every check is code, like the replay's own.

import type { Case } from './replay.ts';
import { brokenPromises } from './guard.ts';
import { NEVER } from './shared/airline-links.ts';

type Turn = { reply: string; cards: { action: string; note?: string | null }[]; tools: { name: string; input: any }[] };
export type SeededCase = Case & { seed?: (now: number) => { plan?: Record<string, unknown>; notes?: Record<string, string> } };
const iso = (now: number, n: number) => new Date(now + n * 864e5).toISOString().slice(0, 10);
const surfPlan = (now: number) => ({ stay_id: 'surf', from: iso(now, 30), to: iso(now, 37) });

export const V2_CASES: SeededCase[] = [
  // slice 1: the trip plan
  { id: 'pl-start', kind: 'lesson', text: 'Help me plan this.', expect: ['asks_who'], seed: (n) => ({ plan: surfPlan(n) }) },
  { id: 'pl-fill', kind: 'lesson', text: 'Three of us and a baby, flying from Lima.', expect: ['plan_written', 'both_legs'], seed: (n) => ({ plan: surfPlan(n) }) },
  { id: 'pl-no-overwrite', kind: 'lesson', text: 'Make it the week after.', expect: ['plan_change_card'], seed: (n) => ({ plan: { ...surfPlan(n), adults: 2 } }) },
  { id: 'pl-dates', kind: 'lesson', text: 'What flights do we need for our trip?', expect: ['flights_called', 'own_dates', 'both_legs'],
    seed: (n) => ({ plan: { stay_id: 'surf', from: iso(n, 32), to: iso(n, 39), deal_id: 'iv1', adults: 2, origin: 'MIA' } }) },
  // slice 2: actions the member confirms
  { id: 'ac-watch', kind: 'lesson', text: 'Tell me if a cheaper Surf Club week turns up in {M30}.', expect: ['watch_card'] },
  { id: 'ac-interval-daily', kind: 'lesson', text: 'Can you check Interval every day for me?', expect: [] },
  { id: 'ac-package', kind: 'lesson', text: 'Ask Victor for a package with flights from Miami for the {D30} Surf Club week.', expect: ['ask_card_both_legs'] },
  // slice 3: what Ian knows
  { id: 'k-checkin', kind: 'lesson', text: 'What time is check-in at the Surf Club?', expect: ['fact_from_tool', 'says_four_pm'] },
  { id: 'k-unknown', kind: 'lesson', text: "Is there a kids' club at the Surf Club?", expect: ['says_unknown'] },
  { id: 'k-taxi', kind: 'lesson', text: 'How much is a taxi from the airport to the high-rise hotels?', expect: ['fact_from_tool', 'taxi_fare'] },
  // slice 4a: flights both ways
  { id: 'fl-two-options', kind: 'lesson', text: 'Give me two Surf Club options in {M30} with flights from Lima for each one.', expect: ['flights_called', 'own_dates', 'both_legs'] },
];

const WHO = /who(?:'s| is| will be)? (?:travel|coming|going|joining)|how many (?:of you|people|adults|travell?ers|are)|who are you (?:going|travel)/i;
export const V2_CHECKS: Record<string, (t: Turn, c: { now: number; dates: Set<string>; question: string }) => boolean> = {
  // global
  no_empty_promise: (t) => !brokenPromises(t.reply, { cards: t.cards, tools: t.tools }).length,
  airline_direct: (t) => !NEVER.test(t.reply),
  // slice 1
  asks_who: (t) => WHO.test(t.reply),
  plan_written: (t) => t.tools.some((x) => x.name === 'plan' && String(x.input?.adults) === '3' && String(x.input?.infants) === '1' && /^lim$/i.test(String(x.input?.origin))),
  plan_change_card: (t) => t.cards.some((x) => x.action === 'plan_change'),
  flights_called: (t) => t.tools.some((x) => x.name === 'flights'),
  // slice 2
  watch_card: (t) => t.cards.some((x) => x.action === 'watch'),
  ask_card_both_legs: (t) => t.cards.some((x) => x.action === 'ask_dates' && /\b(out|outbound|depart\w*|both ways|round[- ]trip)\b/i.test(x.note || '') && /\b(back|return\w*|both ways|round[- ]trip)\b/i.test(x.note || '')),
  // slice 3
  fact_from_tool: (t) => t.tools.some((x) => x.name === 'places' || x.name === 'facts'),
  says_four_pm: (t) => /\b4(?::00)?\s*(?:pm|p\.m\.)/i.test(t.reply.replace(/\s/gu, ' ')),
  says_unknown: (t) => /not (?:on file|published|listed)|(?:don't|do not) (?:know|have)|no record|nothing on file/i.test(t.reply),
  taxi_fare: (t) => /\$\s?4[01]\b/.test(t.reply),
};
export const V2_GLOBAL = ['no_empty_promise', 'airline_direct'];

/** Put the case's plan and notes on the fixture before the turn. */
export function applySeed(data: any, kase: SeededCase, now: number) {
  const s = kase.seed?.(now) ?? {};
  let plan: unknown = s.plan ?? null;
  data.plan = async () => plan;
  data.savePlan = async (p: unknown) => { plan = p; };
  if (s.notes) { let notes = { ...s.notes }; data.memory = async () => notes; data.saveMemory = async (n: Record<string, string>) => { notes = n; }; }
  return data;
}

/** The non-.ts files Ian reads at boot, into the replay's scratch copy (it copies .ts files only). */
export async function copyV2Files(here: string, tmp: string) {
  for (const f of ['facts.md']) await Deno.copyFile(`${here}/${f}`, `${tmp}/${f}`);
}
