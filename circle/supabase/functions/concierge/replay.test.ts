// The replay's checks, on canned answers: each one passes the right answer and fails the wrong one.
// (The replay itself calls the real model; these keep its judgement honest without spending a cent.)
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { allCases, CHECKS, datesIn, FIXED, fill, fixture, GLOBAL, judge, MAX_CASES, memberCase } from './replay.ts';
import { V2_CASES } from './replay-v2-cases.ts';

const now = Date.UTC(2026, 9, 22, 12);
const t = (reply: string, extra: Partial<{ cards: any[]; tools: any[]; error: string | null }> = {}) =>
  ({ reply, cards: [], tools: [], cost: 0, error: null, ...extra });
const ctx = { now, dates: fixture(now).dates, question: '' };

Deno.test('no figure the number guard had to strip; a re-ask it recovered from is fine', () => {
  assert(CHECKS.no_stripped_figure(t('ok', { tools: [{ name: '(number guard)', input: { reprompted: ['$75'] } }] }), ctx));
  assert(!CHECKS.no_stripped_figure(t('ok', { tools: [{ name: '(number guard)', input: { stripped: ['$75'] } }] }), ctx));
});

Deno.test('Interval is named before RedWeek, or RedWeek is not mentioned at all', () => {
  assert(CHECKS.interval_first(t('The Interval Getaway is 805 a night; the RedWeek owner week is 1,610.'), ctx));
  assert(CHECKS.interval_first(t('No Interval Getaways on the board right now. RedWeek has one week.'), ctx));
  assert(!CHECKS.interval_first(t('RedWeek has a week at 230 a night. Interval also has one.'), ctx));
  assert(CHECKS.interval_first(t('Nothing on the board for those dates.'), ctx));
});

Deno.test('flights: both legs named, or the one question worth asking', () => {
  assert(CHECKS.both_legs(t('Flights would go out on 21 November and come back on 28 November.'), ctx));
  assert(CHECKS.both_legs(t('Where will you be flying from?'), ctx));
  assert(!CHECKS.both_legs(t('The flight is on 21 November.'), ctx));
});

Deno.test("flight dates are the option's own dates, never another option's", () => {
  const f = fixture(now);
  const [a, b] = [...f.dates];
  const say = (d: string) => `${Number(d.slice(8))} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(d.slice(5, 7)) - 1]}`;
  assertEquals(datesIn(`out on ${say(a)}, back on ${say(b)}`, now), [a, b]);
  assert(CHECKS.own_dates(t(`Out on ${say(a)} and back on ${say(b)}.`), ctx));
  assert(!CHECKS.own_dates(t('Out on 3 March and back on 10 March.'), ctx));
});

Deno.test('a read older than 48 hours is said to be old; Ian is not the Ian on the Desk', () => {
  assert(CHECKS.stale_said(t('The Ocean Club week was last seen 5 days ago, tap to re-check.'), ctx));
  assert(!CHECKS.stale_said(t('The Ocean Club has a 2BR week for $1,610.'), ctx));
  assert(CHECKS.not_desk_ian(t("No, I'm not him. I'm software, the Circle's concierge."), ctx));
  assert(!CHECKS.not_desk_ian(t('Yes, how can I help?'), ctx));
});

Deno.test('banned words, contact details, and the $9 misread are failures', () => {
  assert(!CHECKS.no_banned_words(t('That week is available.'), ctx));
  assert(!CHECKS.no_contact(t('Write to victor@example.com'), ctx));
  assert(!CHECKS.no_contact(t('Call +297 555 0101'), ctx));
  assert(CHECKS.no_contact(t('161,000 points, $1,610 all in'), ctx));
  assert(!CHECKS.no_misread_quote(t('The cheapest is Barceló at $9 a night.'), ctx));
  assert(CHECKS.no_misread_quote(t('A Barceló week looks wrong, so it is not quoted.'), ctx));
});

Deno.test('a case fails on any global check, and only on the ones it names', () => {
  const k = { id: 'x', kind: 'lesson' as const, text: '', expect: ['refresh_card'] };
  assertEquals(judge(t('Tap to look again.', { cards: [{ action: 'refresh' }] }), k, now, ctx.dates), []);
  // "available" is a banned word to both the replay and Ian's promise guard (Ian v2), so both say so.
  assertEquals(judge(t('It is available.'), k, now, ctx.dates), ['no_banned_words', 'no_empty_promise', 'refresh_card']);
  assertEquals(memberCase({ id: 'm', text: 'Can you find flights from Bogota?' }).expect, ['both_legs']);
});

Deno.test('the cases fill from the run day, and there are about thirty with the members\' questions', () => {
  assert(!FIXED.some((c) => /\{[MD]\d+\}/.test(fill(c.text, now))));
  assert(FIXED.length >= 14 && FIXED.length <= 16);
});

Deno.test("an answer that is not a comparison is not held to Interval-first (the replay's own bug, 22 Oct)", () => {
  // p3-quote-cover, run 1: a quote, then an offer to look at RedWeek. No RedWeek week was put in front of anyone.
  assert(CHECKS.interval_first(t('Seven nights come to 108,675 points, $1,087 all in. I can also check RedWeek owner weeks for this place if you want a cheaper option.'), ctx));
  assert(!CHECKS.interval_first(t('RedWeek has a week at $230 a night. Interval has none.'), ctx), 'a RedWeek week with a figure before Interval still fails');
});

Deno.test("\"where you'd fly from.\" is the one question worth asking (the replay's own bug, 22 Oct)", () => {
  // l-flights-origin, run 2: a right answer the old pattern failed for want of a question mark.
  assert(CHECKS.both_legs(t("To start, I need to know where you'd fly from. Once you tell me the airport, I'll pull up the cheapest week first."), ctx));
  assert(CHECKS.both_legs(t('Which airport are you flying from?'), ctx));
  assert(!CHECKS.both_legs(t('Flights are something I can look at.'), ctx));
});

Deno.test("a night runs Ian v2's cases and checks, up to forty cases in all", () => {
  const real = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, text: 'Any flights from Bogota?' }));
  const cases = allCases(real, now);
  assertEquals(cases.length, MAX_CASES);
  for (const v of V2_CASES) assert(cases.some((c) => c.id === v.id), v.id);
  assert(GLOBAL.includes('no_empty_promise') && GLOBAL.includes('airline_direct'));
  assert(CHECKS.plan_written && CHECKS.watch_card && CHECKS.says_unknown, 'the v2 checks are in the table judge() reads');
  assert(!cases.some((c) => /\{[MD]\d+\}/.test(c.text)));
});
