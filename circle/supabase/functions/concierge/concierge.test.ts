// deno test circle/supabase/functions/concierge/
// The rules Ian is held to, each with the case that would break it.

import { assert, assertEquals } from 'jsr:@std/assert@1';
import { bandNights, cheaperNextDoor, dealFacts, FRESH_HOURS, implausibleWhy, LOOKS_WRONG, monthsToAfford, ownerAsk, publicTotal, rateBandFor, RETIRE_DAYS, seasonEdge, WATCHED_SOURCES } from './compare.ts';
import { memberContext } from './redact.ts';
import { runTool, TOOLS, type Data } from './tools.ts';
import { costUsd, LASTING, PRICES, turn, worstCaseUsd } from './ian.ts';
import { claims, collect, emptyFigures, strays, stripStray, toNum } from './guard.ts';
import { hmac, linesFrom, makeHandler } from './handler.ts';
import { asPlan, emptyPlan, legs, missing, planFrom } from './plan.ts';
import { factsFor, placeFacts, sections } from './knowledge.ts';
import { brokenPromises, stripPromises } from './guard.ts';

const S = { pointsPerDollar: 100, serviceRate: 0.15, tiers: [{ monthlyUsd: 100, bonusRate: 0 }, { monthlyUsd: 200, bonusRate: 0.06 }] };
const surf = { id: 'surf', name: 'Surf Club', rate_low_usd: 135, rate_high_usd: 300, rate_peak_usd: 580, retail_usd: 450, min_nights: 2, peak_min_nights: 7 };
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

// ---------------------------------------------------------------- compare
Deno.test('the calendar is money.js\'s calendar, every day of 2026 to 2029', async () => {
  const money = await import('../../../js/core/money.js');
  for (let t = Date.UTC(2026, 0, 1, 12); t < Date.UTC(2030, 0, 1); t += 864e5) {
    const iso = new Date(t).toISOString().slice(0, 10);
    assertEquals(rateBandFor(iso), money.rateBandFor(`${iso}T12:00:00`), iso);
  }
});

Deno.test('the calendar agrees with money.js: Christmas and Carnival are peak, spring is high', () => {
  assertEquals(rateBandFor('2026-12-24'), 'peak');
  assertEquals(rateBandFor('2027-01-03'), 'peak');
  assertEquals(rateBandFor('2027-01-04'), 'high');
  assertEquals(rateBandFor('2027-02-07'), 'peak');           // Carnival 2027: Ash Wednesday is 10 Feb
  assertEquals(rateBandFor('2026-10-01'), 'low');
  assertEquals(bandNights('2026-12-17', '2026-12-24'), { low: 3, high: 0, peak: 4 });
});

Deno.test('an owner week: the ask from the title, the fee on top, and the fee trap past 10%', () => {
  assertEquals(ownerAsk("Marriott's Aruba Surf Club · Studio · owner asking $166 a night on RedWeek"), 166);
  assertEquals(ownerAsk('A week that came up'), null);
  // Owner total $1,400 for 7 nights at a $166 ask: $238 of fees, 20% on top. All in = 1400 x 1.15.
  const d = { id: 'd1', stay_id: 'surf', from_date: '2026-10-03', to_date: '2026-10-10', nights: 7, points_total: 161000, source: 'redweek', title: 'Surf Club · owner asking $166 a night on RedWeek', seen_at: new Date(Date.now() - 3 * 864e5).toISOString() };
  const f = dealFacts(d, surf, S);
  assertEquals(f.total_usd_all_in, 1610);
  assertEquals(f.owner_total_usd, 1400);
  assertEquals(f.fee_usd, 238);
  assert(f.fee_trap);
  assertEquals(f.per_night_usd, 230);
  assert(f.stale, 'three days old is stale');
  // October is low: public 450 x 135/300 a night = 202.5 x 7 = 1418. We lose, and it says so.
  assertEquals(f.public_total_usd, 1418);
  assertEquals(f.under_public_usd, -192);
});

Deno.test('a week under $40 a night is a misread, and a few dollars over the ask is rounding, not a fee', () => {
  // The Barceló row live on the board on 22 Oct 2026: $71 for seven nights at Christmas, "owner asking $9 a night".
  const f = dealFacts({ id: 'b', stay_id: 'surf', from_date: '2026-12-19', to_date: '2026-12-26', nights: 7, points_total: 7100, source: 'redweek', title: 'Barceló Aruba · owner asking $9 a night on RedWeek' }, surf, S);
  assert(f.implausible);
  const g = dealFacts({ id: 'g', stay_id: 'surf', from_date: '2026-11-27', to_date: '2026-12-04', nights: 7, points_total: 168500, source: 'redweek', title: 'owner asking $209 a night' }, surf, S);
  assertEquals(g.implausible, null);
  assertEquals(g.fee_usd, null, '$2 over seven nights is the title rounding the ask');
});

Deno.test('a fee under 10% is not a trap, and no public rate means no comparison', () => {
  const f = dealFacts({ id: 'd', stay_id: 'x', from_date: '2026-10-03', to_date: '2026-10-10', nights: 7, points_total: Math.round(1200 * 1.15 * 100), source: 'redweek', title: 'owner asking $166 a night' }, { id: 'x', name: 'X' }, S);
  assertEquals(f.fee_usd, 38);
  assertEquals(f.fee_trap, false);
  assertEquals(f.public_total_usd, null);
  assertEquals(f.under_public_usd, null);
  assertEquals(publicTotal(undefined, '2026-10-01', '2026-10-02'), null);
});

Deno.test('a cheaper week next door is the same place, within a week, lower per night', () => {
  const mk = (id: string, stay: string, from: string, ppn: number) => dealFacts({ id, stay_id: stay, from_date: from, to_date: day(400), nights: 7, points_total: ppn * 700, points_per_night: ppn * 100, source: 'interval' }, surf, S);
  const facts = [mk('a', 'surf', '2026-11-07', 200), mk('b', 'surf', '2026-11-12', 150), mk('c', 'surf', '2026-11-30', 100), mk('d', 'other', '2026-11-08', 50)];
  const n = cheaperNextDoor(facts);
  assertEquals(n.a, { deal_id: 'b', from: '2026-11-12', per_night_usd: 150, saves_per_night_usd: 50 });
  assertEquals(n.b, undefined, 'c is too far away and d is another place');
});

Deno.test('season edge finds the nearest dates with no peak night; affordability counts months', () => {
  assertEquals(seasonEdge('2026-12-17', '2026-12-24'), { peak_nights: 4, nights: 7, shift_days: 4, direction: 'earlier', from: '2026-12-13', to: '2026-12-20' });
  assertEquals(seasonEdge('2026-10-03', '2026-10-10'), null);
  assertEquals(monthsToAfford(S, 50000, 100, 20000), 3);      // 30,000 short at 10,000 a month
  assertEquals(monthsToAfford(S, 50000, 200, 20000), 2);      // 21,200 a month at $200
  assertEquals(monthsToAfford(S, 500, 100, 9000), 0);
});

// ---------------------------------------------------------------- redact
Deno.test('the member Ian is told about carries no email, phone, username, card, household, notes or ledger', () => {
  const secret = { email: 'ana@private.example', phone: '+297 555 0101', username: 'ana_k', card_code: 'HX-9921', household: [{ name: 'Luis' }], notes: 'owes the Banker', ledger: [{ points: 1234567 }] };
  const ctx = memberContext({
    member: { id: 'm1', name: 'Ana Kock', monthly_usd: 150, ...secret },
    available: 31000, pointsPerDollar: 100,
    redemptions: [{ id: 'r1', member_id: 'm1', stay_id: 'surf', check_in: '2026-12-01', check_out: '2026-12-08', nights: 7, status: 'held', note: 'call me on +297 555 0101' },
      { id: 'r2', member_id: 'm2', stay_id: 'surf', check_in: '2026-12-01', check_out: '2026-12-08', nights: 7, status: 'held' }],
    crews: [{ id: 'c1', name: 'October Four' }], crewMembers: [{ crew_id: 'c1', member_id: 'm1', role: 'lead' }, { crew_id: 'c1', member_id: 'm2', role: 'member' }],
    watches: [], memory: { usual_month: 'October' },
    stayName: () => 'Surf Club', memberName: (id) => (id === 'm2' ? 'Luis Ras' : 'Ana Kock'),
  });
  const text = JSON.stringify(ctx);
  for (const [k, v] of Object.entries(secret)) {
    assert(!text.includes(k), `key ${k} leaked`);
    assert(!text.includes(typeof v === 'string' ? v : JSON.stringify(v).slice(2, 12)), `value of ${k} leaked`);
  }
  assert(!text.includes('Kock') && !text.includes('Ras'), 'first names only');
  assertEquals(ctx.bookings.map(b => b.id), ['r1'], 'only their own bookings, even when an officer can read all');
  assertEquals(ctx.crews[0].people, ['Ana', 'Luis']);
});

// ---------------------------------------------------------------- tools
function fakeData(over: Partial<Data> = {}): Data {
  let notes: Record<string, string> = {};
  let tripPlan: any = null;
  return {
    settings: async () => ({ ...S, model: 'claude-haiku-5-5', dailyUsd: 5 }),
    me: async () => ({ id: 'm1', name: 'Ana Kock', monthly_usd: 100 }),
    stays: async () => [surf as any],
    roomTypes: async () => [{ stay_id: 'surf', name: 'Studio', sleeps: 2 }, { stay_id: 'surf', name: 'Two bedroom', sleeps: 6 }],
    deals: async () => [
      { id: 'rw', stay_id: 'surf', from_date: day(30), to_date: day(37), nights: 7, points_total: 161000, source: 'redweek', source_url: 'https://www.redweek.com/posting/R1', title: 'owner asking $166 a night on RedWeek', seen_at: new Date().toISOString() },
      { id: 'iv', stay_id: 'surf', from_date: day(32), to_date: day(39), nights: 7, points_total: 80500, source: 'interval', title: 'Getaway', seen_at: new Date().toISOString() },
    ] as any,
    quote: async () => ({ points: 108675, nights: 7, min_nights: 2, retail_usd: 1418 }),
    available: async () => 20000,
    redemptions: async () => [{ id: 'sh', member_id: 'm2', stay_id: 'surf', check_in: day(60), check_out: day(67), nights: 7, status: 'quoted', shared: true, points: 30000, quoted_points: 90000 },
      { id: 'priv', member_id: 'm3', stay_id: 'surf', check_in: day(60), check_out: day(67), nights: 7, status: 'quoted', shared: false, points: 1, quoted_points: 90000 }],
    pledges: async () => [{ redemption_id: 'sh', points: 10000 }],
    crews: async () => [{ id: 'c1', name: 'Four' }],
    crewMembers: async () => [{ crew_id: 'c1', member_id: 'm1', role: 'lead' }],
    watches: async () => [],
    members: async () => [{ id: 'm1', name: 'Ana Kock', status: 'active' }, { id: 'm2', name: 'Luis Ras', status: 'active' }, { id: 'bot', name: 'Watcher', status: 'active', bot: true }],
    redweekChecks: async () => null,
    memory: async () => notes,
    saveMemory: async (n) => { notes = n; },
    plan: async () => tripPlan,
    savePlan: async (p) => { tripPlan = p; },
    ...over,
  };
}
const ctxOf = (data = fakeData()) => ({ data, cards: [] as any[], cache: new Map() });

Deno.test('strict tools stay under the API\'s 16 nullable parameters (19 was a 400 on the first live call)', () => {
  const unions = TOOLS.flatMap(t => Object.values((t.input_schema as any).properties)).filter((p: any) => Array.isArray(p.type)).length;
  assert(unions <= 16, `${unions} nullable parameters`);
});

Deno.test('every tool is strict, and every schema lists all its properties as required', () => {
  for (const t of TOOLS) {
    assertEquals(t.strict, true, t.name);
    assertEquals((t.input_schema as any).additionalProperties, false, t.name);
    assertEquals(Object.keys((t.input_schema as any).properties).sort(), [...(t.input_schema as any).required].sort(), t.name);
  }
});

Deno.test('board puts RedWeek and Interval side by side, cheapest first, misreads last, with the listing link', async () => {
  const base = fakeData();
  const misread = { id: 'bad', stay_id: 'surf', from_date: day(30), to_date: day(37), nights: 7, points_total: 7100, source: 'redweek', title: 'owner asking $9 a night', seen_at: new Date().toISOString() };
  const out: any = await runTool('board', { stay_id: null, from: null, to: null }, ctxOf({ ...base, deals: async () => [misread as any, ...await base.deals()] }));
  assertEquals(out.weeks.map((w: any) => w.deal_id), ['iv', 'rw', 'bad']);
  assertEquals(out.weeks[2].price, LOOKS_WRONG);
  assert(String(out.weeks[2].why).includes('misread'));
  for (const k of ['per_night_usd', 'total_usd_all_in', 'total_points', 'owner_ask_per_night_usd']) assert(!(k in out.weeks[2]), `a misread carries no ${k}`);
  assertEquals(out.weeks.slice(0, 2).map((w: any) => w.source), ['interval', 'redweek']);
  assertEquals(out.weeks[1].listing, 'https://www.redweek.com/posting/R1');
  assertEquals(out.interval_weeks_matching, 1);
  assert(out.interval_said.includes('Lead with Interval'));
  const none: any = await runTool('board', { stay_id: null, from: null, to: null }, ctxOf({ ...base, deals: async () => [misread as any] }));
  assertEquals(none.interval_said, 'Interval has nothing on the board for this place and these dates right now.');
  assertEquals(out.weeks[1].owner_ask_per_night_usd, 166);
  assertEquals(out.weeks[0].public_total_usd, 1418);
});

Deno.test('shared bookings: only open, only shared, never your own, points still open', async () => {
  const out: any = await runTool('shared_bookings', {}, ctxOf());
  assertEquals(out.open_to_chip_in, [{ booking_id: 'sh', place: 'Surf Club', from: day(60), to: day(67), nights: 7, whose: 'Luis', points_still_open: 50000 }]);
});

Deno.test('a place by name works where the model has lost the id; an unknown or ambiguous name does not', async () => {
  const two = fakeData({ stays: async () => [surf as any, { id: 'oc', name: 'Marriott\'s Aruba Ocean Club' } as any, { id: 'su', name: 'Marriott’s Aruba Surf Club' } as any] });
  const q: any = await runTool('quote', { stay_id: 'marriotts-aruba-ocean-club', from: day(30), to: day(37), guests: 2 }, ctxOf(two));
  assertEquals(q.place, 'Marriott\'s Aruba Ocean Club');
  assert((await runTool('quote', { stay_id: 'Surf Club', from: day(30), to: day(37), guests: 2 }, ctxOf(two)) as any).error, 'two Surf Clubs: ambiguous');
  assert((await runTool('quote', { stay_id: 'Hyatt', from: day(30), to: day(37), guests: 2 }, ctxOf(two)) as any).error);
});

Deno.test('people are first names and ids, no robots', async () => {
  const out: any = await runTool('people', {}, ctxOf());
  assertEquals(out.people, [{ id: 'm1', first_name: 'Ana' }, { id: 'm2', first_name: 'Luis' }]);
});

Deno.test('propose: a crew needs a place and future dates; invites only from a lead; three cards at most', async () => {
  const c = ctxOf();
  assert((await runTool('propose', { action: 'create_crew', name: 'Four', stay_id: 'surf', from: null, to: null }, c) as any).error);
  assert((await runTool('propose', { action: 'create_crew', name: 'Four', stay_id: 'surf', from: '2020-01-01', to: '2020-01-08' }, c) as any).error, 'past dates');
  assert((await runTool('propose', { action: 'create_crew', name: 'Four for $999', stay_id: 'surf', from: day(30), to: day(37) }, c) as any).error, 'no figure on a card');
  assert((await runTool('propose', { action: 'create_crew', name: 'Four', about: 'a $1,400 week', stay_id: 'surf', from: day(30), to: day(37), redemption_id: 'priv' }, c) as any).shown);
  assertEquals(c.cards[0].about, null, 'a figure in the about line is dropped');
  assertEquals(c.cards[0].redemption_id, null, 'somebody else\'s booking is dropped from the card');
  assert((await runTool('propose', { action: 'invite', crew_id: 'c1', member_id: 'bot' }, c) as any).error, 'no robots');
  assert((await runTool('propose', { action: 'invite', crew_id: 'c1', member_id: 'm2' }, c) as any).shown);
  assert((await runTool('propose', { action: 'ask_dates', stay_id: 'surf', from: day(30), to: day(37), deal_id: 'rw' }, c) as any).shown);
  assert((await runTool('propose', { action: 'ask_dates', stay_id: 'surf', from: day(30), to: day(37), deal_id: null }, c) as any).error, 'a fourth card');
});

Deno.test('remember keeps 20 notes of 200 characters, forgets on empty', async () => {
  const c = ctxOf();
  await runTool('remember', { key: 'Usual Month', value: 'October' }, c);
  assertEquals(await c.data.memory(), { usual_month: 'October' });
  for (let i = 0; i < 25; i++) await runTool('remember', { key: `k${i}`, value: 'x'.repeat(300) }, c);
  const kept = await c.data.memory();
  assertEquals(Object.keys(kept).length, 20);
  assertEquals(kept.k0.length, 200);
  await runTool('remember', { key: 'usual_month', value: '' }, c);
  assert(!('usual_month' in await c.data.memory()));
});

// ---------------------------------------------------------------- the number guard
const dm = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
async function boardFigures() {
  const f = emptyFigures();
  collect(await runTool('board', { stay_id: null, from: null, to: null }, ctxOf()), f);
  return f;      // iv: $115 a night, $805 all in, 80,500 points (11,500 a night). rw: $230 a night, ask $166.
}

Deno.test('the guard reads every way a figure can be written', () => {
  const k = (t: string) => claims(t).map(c => `${c.kind}:${Number.isFinite(c.n) ? c.n : 'words'}`);
  assertEquals(k('From $1,162 all in, or $3k, about 12,500 points (800 pts a night).'), ['usd:1162', 'usd:3000', 'pts:12500', 'pts:800']);
  assertEquals(k('USD 3,500, 3500 dollars, 12k points, 27%, 500 a night.'), ['usd:3500', 'usd:3500', 'pts:12000', 'pct:27', 'usd:500']);
  assertEquals(k('EUR 3,500 or €3,500 or 3,500 euros.'), ['other:3500', 'other:3500', 'other:3500']);
  assertEquals(k('about three thousand dollars, a few hundred points'), ['other:words', 'other:words']);
  assertEquals(k('seven nights for the price, in dollars and points'), [], 'no figure here');
  assertEquals(toNum('1.162'), 1162, '"$1.162" is eleven hundred, never one');
  assertEquals(toNum('165.50'), 165.5);
});

Deno.test('points do not pass as dollars, and nothing unverifiable passes at all', async () => {
  const f = await boardFigures();
  assertEquals(strays('The Getaway is $805 all in, or 80,500 points, $115 a night.', f), []);
  assertEquals(strays('The Getaway is $80,500.', f), ['$80,500']);
  assertEquals(strays('That is $11,500 a night.', f), ['$11,500']);
  assertEquals(strays('That is 11,500 a night.', f), ['11,500 a night'], 'a bare nightly figure is money');
  assertEquals(strays('Only 27% over.', f), ['27%']);
  assertEquals(strays('Roughly EUR 805.', f), ['EUR 805']);
  assertEquals(strays('About three thousand dollars.', f), ['three thousand dollars']);
  assertEquals(strays('Everything is all in: the room plus the 15% share.', f), [], "the 15% is the board's own words");
});

Deno.test('a right price on the wrong week is caught; on the right week it passes', async () => {
  const f = await boardFigures();
  const rw = dm(day(30)), iv = dm(day(32));
  assertEquals(strays(`The ${rw} week is $230 a night, owner asking $166.`, f), []);
  assertEquals(strays(`The ${iv} week is $230 a night.`, f), ['$230'], '$230 is the other week\'s price');
  assertEquals(strays(`The ${iv} week is $115 a night, against $230 for the ${rw} one.`, f), [], 'a sentence naming both weeks may use both');
  assertEquals(stripStray(`The ${iv} Getaway is $805. The ${iv} week is $230 a night.`, f), `The ${iv} Getaway is $805.`);
});

Deno.test('only tool results feed the guard: not the member, not Ian, not remember, not an error echo', async () => {
  const f = emptyFigures();
  collect({ remembered: { budget: '$3,000' }, noted: { budget: '$3,000' }, error: 'No single place matches "Hotel $4,321"', deal_id: 'x1', from: '2026-11-27', listing: 'https://www.redweek.com/posting/R1517275', per_night_usd: 241 }, f);
  assertEquals(strays('$241 a night.', f), []);
  assertEquals(strays('Your budget is $3,000. Hotel $4,321.', f), ['$3,000', '$4,321']);
  assertEquals(strays('$1517275, $2026, $27.', f).length, 3, 'nor digits from ids, links or dates');
  const replies = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'remember', input: { key: 'budget', value: 'about $3,000 a week' } }], usage: {} },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Noted: about $3,000 a week.' }], usage: {} },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Noted: about $3,000 a week, still.' }], usage: {} },
  ];
  let i = 0;
  const out: any = await turn({ lines: [{ role: 'user', text: 'My budget is $3,000 a week.' }], data: fakeData(), model: 'claude-haiku-5-5', callModel: async () => replies[i++] });
  assertEquals(out.reply, '', "a figure Ian wrote into its own notes, or the member typed, is not a source");
});

Deno.test('a figure no tool gave is sent back once, then cut; earlier answers are no source', async () => {
  const replies = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'board', input: { stay_id: null, from: null, to: null } }], usage: { input_tokens: 100, output_tokens: 10 } },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'The Getaway is $805 all in. You would save $999.' }], usage: { input_tokens: 50, cache_read_input_tokens: 1000, output_tokens: 20 } },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'The Getaway is $805 all in. It saves $999 still.' }], usage: { input_tokens: 50, output_tokens: 20 } },
  ];
  const seen: any[] = [];
  const out: any = await turn({ lines: [{ role: 'user', text: 'cheapest?' }, { role: 'assistant', text: 'Earlier I said $999.' }, { role: 'user', text: 'and now?' }], data: fakeData(), model: 'claude-haiku-5-5',
    callModel: async (p) => { seen.push(structuredClone(p)); return replies[seen.length - 1]; } });
  assertEquals(out.reply, 'The Getaway is $805 all in.');
  assertEquals(seen.length, 3);
  assert(String(seen[2].messages.at(-1).content).includes('$999'), 'the re-prompt names the stray figure');
  assertEquals(out.tools.map((t: any) => t.name), ['board', '(number guard)', '(number guard)']);
  assertEquals(out.links, ['https://www.redweek.com/posting/R1'], 'the listing links a tool gave, for the phone to link');
  assertEquals(out.usage, { input: 200, cacheWrite: 0, cacheRead: 1000, output: 50, calls: 3 });
});

// ---------------------------------------------------------------- prices and caps (each number written out: a changed cap fails)
Deno.test('the cost is the API\'s token counts times PRICES, which are the published ones', () => {
  assertEquals(PRICES['claude-haiku-5-5'], { in: 0.10, write: 0.125, read: 0.01, out: 0.50 });
  assertEquals(PRICES['claude-sonnet-5-5'], { in: 2, write: 2.5, read: 0.10, out: 10 });
  assertEquals(costUsd('claude-haiku-5-5', { input: 200, cacheWrite: 4360, cacheRead: 1000, output: 50, calls: 3 }), (200 * 0.10 + 4360 * 0.125 + 1000 * 0.01 + 50 * 0.50) / 1e6);
  assertEquals(worstCaseUsd('claude-haiku-5-5'), (7 * 40000 * 0.10 + 7 * 1500 * 0.50) / 1e6, 'seven calls of 40,000 in and 1,500 out');
});

Deno.test('six rounds of tools, then it stops', async () => {
  let calls = 0;
  const out: any = await turn({ lines: [{ role: 'user', text: 'everything' }], data: fakeData(), model: 'claude-haiku-5-5',
    callModel: async () => { calls++; return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${calls}`, name: 'people', input: {} }], usage: {} }; } });
  assertEquals(calls, 6);
  assert(out.reply.includes('too much'));
});

Deno.test('one call over 40,000 input tokens ends the turn', async () => {
  let calls = 0;
  const out: any = await turn({ lines: [{ role: 'user', text: 'everything' }], data: fakeData(), model: 'claude-haiku-5-5',
    callModel: async () => { calls++; return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'people', input: {} }], usage: { input_tokens: 30000, cache_read_input_tokens: 10001 } }; } });
  assertEquals(calls, 1);
  assert(out.reply.includes('too much'));
});

Deno.test('the board shows twelve weeks, places forty', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, stay_id: 'surf', from_date: day(30 + i), to_date: day(37 + i), nights: 7, points_total: 100000 + i * 100, source: 'redweek', title: 'owner asking $120 a night', seen_at: new Date().toISOString() }));
  const b: any = await runTool('board', { stay_id: null, from: null, to: null }, ctxOf({ ...fakeData(), deals: async () => many as any }));
  assertEquals([b.weeks.length, b.shown, b.total_on_board, b.looks_wrong_on_board], [12, 12, 30, 0]);
  const bad = { id: 'bad', stay_id: 'surf', from_date: day(30), to_date: day(37), nights: 7, points_total: 7100, source: 'redweek', title: 'owner asking $9 a night', seen_at: new Date().toISOString() };
  const w: any = await runTool('board', { stay_id: null, from: null, to: null }, ctxOf({ ...fakeData(), deals: async () => [...many, bad] as any }));
  assertEquals([w.weeks.length, w.looks_wrong_on_board, w.weeks.at(-1).price], [13, 1, LOOKS_WRONG], 'a misread past the twelfth is still seen, as one');
  const stays = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, name: `Place ${i}`, kind: 'aruba' }));
  const p: any = await runTool('places', { filter: null }, ctxOf({ ...fakeData(), stays: async () => stays as any }));
  assertEquals(p.places.length, 40);
});

Deno.test('the phone\'s conversation is cut to twelve lines, 2,000 characters a question, 4,000 an answer', () => {
  const msgs = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: (i % 2 ? 'a' : 'u').repeat(9000) }));
  msgs.push({ role: 'user', text: 'last' });
  const l = linesFrom({ messages: msgs })!;
  assertEquals(l.length, 11, 'the last twelve, less the answer at the front: the API starts with the member');
  assertEquals(l[0].role, 'user');
  assertEquals(linesFrom({ messages: Array.from({ length: 20 }, (_, i) => ({ role: 'user', text: `q${i}` })) })!.length, 12, 'twelve, however many are sent');
  assertEquals(Math.max(...l.filter(x => x.role === 'user').map(x => x.text.length)), 2000);
  assertEquals(Math.max(...l.filter(x => x.role === 'assistant').map(x => x.text.length)), 4000);
  assertEquals(linesFrom({ messages: [{ role: 'assistant', text: 'hi' }] }), null, 'the member speaks last');
});

// ---------------------------------------------------------------- the request
const KEYV = 'k'.repeat(40);
function fakeServer({ member = { id: 'm1', name: 'Ana Kock', monthly_usd: 100, status: 'active', roles: ['member'] } as any,
  allow = { ok: true, model: 'claude-haiku-5-5', turn_id: 't-1' } as any, logFails = 0, env = {} as Record<string, string> } = {}) {
  const rpcs: [string, any][] = [];
  let logTries = 0;
  const memberClient = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: member }) }) }) }),
    rpc: async (name: string, args: any) => {
      rpcs.push([name, args]);
      if (name === 'concierge_allow') return { data: allow, error: null };
      if (name === 'log_concierge_turn') return ++logTries <= logFails ? { error: { message: 'refused' } } : { error: null };
      return { data: null, error: null };
    },
  };
  const handler = makeHandler({
    createClient: (_u: string, _k: string, opts: any) => (opts?.global ? memberClient : { auth: { getUser: async (t: string) => ({ data: { user: t === 'good' ? { id: 'u1' } : null } }) } }),
    env: (k) => ({ SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'anon', ANTHROPIC_API_KEY: 'sk-test', CONCIERGE_LOG_KEY: KEYV, ...env } as Record<string, string>)[k],
    callModel: () => async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hello.' }], usage: { input_tokens: 10, output_tokens: 5 } }),
    dataFor: () => fakeData(),
  });
  const post = (body: unknown, token = 'good') => handler(new Request('http://x/', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
  return { post, rpcs };
}
const ask = { messages: [{ role: 'user', text: 'hi' }] };

Deno.test('who may ask: signed in, an Insider, active', async () => {
  assertEquals((await fakeServer().post(ask, 'bad')).status, 401);
  assertEquals((await fakeServer({ member: null }).post(ask)).status, 403);
  assertEquals((await fakeServer({ member: { id: 'm1', name: 'A', status: 'paused', roles: [] } }).post(ask)).status, 403);
  assertEquals((await fakeServer().post({ messages: [] })).status, 400);
});

Deno.test('the gate is signed with this minute, and "off" or a missing key means not switched on', async () => {
  const s = fakeServer();
  assertEquals((await s.post(ask)).status, 200);
  const sig = s.rpcs.find(([n]) => n === 'concierge_allow')![1].p_sig;
  const now = Math.floor(Date.now() / 60e3);
  assert(sig === await hmac(KEYV, `allow:m1:${now}`) || sig === await hmac(KEYV, `allow:m1:${now - 1}`));
  assertEquals((await fakeServer({ allow: { ok: false, why: 'off' } }).post(ask)).status, 503);
  assertEquals((await fakeServer({ env: { CONCIERGE_LOG_KEY: 'short' } }).post(ask)).status, 503);
  assertEquals((await fakeServer({ allow: { ok: false, why: 'ceiling' } }).post(ask)).status, 429);
});

Deno.test('a turn that cannot be logged is tried twice, then left at its provisional cost and cannot be rated', async () => {
  const s = fakeServer({ logFails: 2 });
  const res = await s.post(ask);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.reply, 'Hello.');
  assertEquals(body.turn_id, undefined, 'no Helped / Not it on a turn that is not on the record');
  assertEquals(s.rpcs.filter(([n]) => n === 'log_concierge_turn').length, 2);
  assert(!s.rpcs.some(([n, a]) => n === 'log_concierge_turn' && a.p_cost === 0 && a.p_ok), 'nothing zeroes the charge');
  const ok = fakeServer({ logFails: 1 });
  assertEquals((await (await ok.post(ask)).json()).turn_id, 't-1', 'the retry with the cost alone lands, so it is on the record');
});

Deno.test('the dry run is for the Desk', async () => {
  assertEquals((await fakeServer().post({ ...ask, dryRun: true })).status, 403);
  const desk = await fakeServer({ member: { id: 'm1', name: 'Victor R', monthly_usd: 200, status: 'active', roles: ['planner', 'admin'] } }).post({ ...ask, dryRun: true });
  assertEquals(desk.status, 200);
  assert((await desk.json()).payload.tools.length > 0);
});

// ---------------------------------------------------------------- the high side, and taps
Deno.test('a price can be impossible on the high side too, or far outside what the place charges', () => {
  assertEquals(implausibleWhy(9049, surf), 'over $1,500 a night', 'a lost decimal point: $633 read as $63,346');
  assertEquals(implausibleWhy(1499, { id: 'x', name: 'X' }), null, 'no band on file: only the absolute ceiling');
  assertEquals(implausibleWhy(800, { id: 'c', name: 'Cheap', rate_low_usd: 100, rate_high_usd: 150, rate_peak_usd: 200 }), 'more than three times the dearest night this place charges');
  assertEquals(implausibleWhy(60, { id: 'd', name: 'Dear', rate_low_usd: 300, rate_high_usd: 400, rate_peak_usd: 600 }), 'under a quarter of the cheapest night this place charges');
  assertEquals(implausibleWhy(230, surf), null);
  const f = dealFacts({ id: 'h', stay_id: 'surf', from_date: '2026-11-01', to_date: '2026-11-08', nights: 7, points_total: 6334600, source: 'interval', title: 'Getaway' }, surf, S);
  assertEquals(f.implausible, 'over $1,500 a night');
});

Deno.test('a fresh look is a button for the member, never a read Ian starts', async () => {
  const c = ctxOf();
  const out: any = await runTool('refresh_redweek', { stay_id: 'Surf Club' }, c);
  assert(out.shown);
  assertEquals(c.cards.map((x: any) => [x.action, x.stay_id]), [['refresh', 'surf']]);
  assert(!('tap' in fakeData()), 'the data layer has no way to tap at all');
});

Deno.test('a line about how they travel asks Ian to remember it', async () => {
  assert(LASTING.test('We usually go in late November, four of us.'));
  assert(!LASTING.test('What is the cheapest week?'));
  const out: any = await turn({ lines: [{ role: 'user', text: 'We usually go in October' }], data: fakeData(), model: 'claude-haiku-5-5', dryRun: true });
  assert(out.payload.system[1].text.includes('call remember'));
});

Deno.test('a figure no tool gave is sent back once, then cut', async () => {
  const replies = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'board', input: { stay_id: null, from: null, to: null } }], usage: { input_tokens: 100, output_tokens: 10 } },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'The Getaway is $805 all in. You would save $999.' }], usage: { input_tokens: 50, cache_read_input_tokens: 1000, output_tokens: 20 } },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'The Getaway is $805 all in. It saves $999 still.' }], usage: { input_tokens: 50, output_tokens: 20 } },
  ];
  const seen: any[] = [];
  const out: any = await turn({ lines: [{ role: 'user', text: 'cheapest?' }, { role: 'assistant', text: 'Earlier I said $999.' }, { role: 'user', text: 'and now?' }], data: fakeData(), model: 'claude-haiku-5-5',
    callModel: async (p) => { seen.push(structuredClone(p)); return replies[seen.length - 1]; } });
  assertEquals(out.reply, 'The Getaway is $805 all in.');
  assertEquals(seen.length, 3);
  assert(String(seen[2].messages.at(-1).content).includes('999'), 'the re-prompt names the stray figure');
  assertEquals(out.tools.map((t: any) => t.name), ['board', '(number guard)', '(number guard)']);
  assertEquals(out.usage, { input: 200, cacheWrite: 0, cacheRead: 1000, output: 50, calls: 3 });
  assertEquals(out.cost, (200 * 0.10 + 1000 * 0.01 + 50 * 0.50) / 1e6);
});

Deno.test('the dry run is the exact payload: strict tools, cache on the prefix, the member after it', async () => {
  const out: any = await turn({ lines: [{ role: 'user', text: 'hi' }], stayId: 'surf', data: fakeData(), model: 'claude-haiku-5-5', dryRun: true });
  const p = out.payload;
  assertEquals(p.tool_choice, { type: 'auto' });
  assertEquals(p.tools.at(-1).cache_control, { type: 'ephemeral' });
  assertEquals(p.system[0].cache_control, { type: 'ephemeral' });
  assert(!p.system[1].cache_control && p.system[1].text.includes('Ana') && !p.system[1].text.includes('Kock'));
  assert(p.system[1].text.includes('Surf Club (stay_id surf)'));
  assert(out.learnings_chars > 0, 'learnings.md is read');
});

// ---------------------------------------------------------------- 48 hours, and 7 days
// Victor, 22 Oct 2026: a Barceló week "owner asking $9 a night", seen 16 Oct, sat at No. 1 on Stays. Ian only
// recommends a week seen in the last 48 hours; an older one is shown as "last seen N days ago, tap to re-check";
// and a watched row not seen for 7 days is retired by the database, so Ian never offers one.
const HOURS = 36e5;
const seenAgo = (h: number) => new Date(Date.now() - h * HOURS).toISOString();
const oneWeek = (id: string, source: string, hoursAgo: number, usdNight: number, over: Record<string, unknown> = {}) => ({
  id, stay_id: 'surf', from_date: day(30), to_date: day(37), nights: 7, points_total: Math.round(usdNight * 7 * 100 * 1.15), source,
  title: source === 'redweek' ? `Surf Club · owner asking $${usdNight} a night on RedWeek` : 'Getaway', seen_at: seenAgo(hoursAgo), ...over,
});

Deno.test('Ian recommends only weeks seen in the last 48 hours; the rest come back as old, with the tap that re-checks them', async () => {
  const deals = [
    oneWeek('fresh-iv', 'interval', 5, 250), oneWeek('fresh-rw', 'redweek', 47, 180),
    oneWeek('old-rw', 'redweek', 49, 120),           // cheaper, but 49 hours old
    oneWeek('older-iv', 'interval', 4 * 24, 90),     // the cheapest, four days old
    oneWeek('gone-rw', 'redweek', 8 * 24, 60),       // past 7 days: the database retires it; Ian never offers it
  ];
  const out: any = await runTool('board', { stay_id: null, from: null, to: null }, ctxOf(fakeData({ deals: async () => deals as any })));
  assertEquals(out.weeks.map((w: any) => w.deal_id), ['fresh-iv', 'fresh-rw'], 'only what was seen in the last 48 hours is a recommendation');
  assertEquals(out.seen_in_last_48_hours, 2);
  assertEquals(out.older_weeks.map((w: any) => w.deal_id), ['older-iv', 'old-rw'], 'cheapest first among the older ones, the 8-day-old week not among them');
  assertEquals(out.older_weeks[0].last_seen, 'last seen 4 days ago, tap to re-check');
  assertEquals(out.older_weeks[1].last_seen, 'last seen 2 days ago, tap to re-check');
  for (const w of out.older_weeks) { assertEquals(w.recommend, false); assertEquals(w.recheck_with, 'refresh_redweek'); }
  assert(out.older_said.includes('NOT recommendations'));
  assertEquals(out.total_on_board, 4, 'the 8-day-old row is not on the board any more');
  assert(!JSON.stringify(out).includes('gone-rw'));
  assertEquals(out.interval_weeks_matching, 1, 'an old Interval week does not count as Interval having something');
  assert(!out.weeks.some((w: any) => w.last_seen.startsWith('last seen')));
});

Deno.test('nothing seen lately is said first, and the old weeks are listed as old — never led with', async () => {
  const deals = [oneWeek('old-rw', 'redweek', 3 * 24, 120), oneWeek('old-iv', 'interval', 5 * 24, 90)];
  const out: any = await runTool('board', { stay_id: null, from: null, to: null }, ctxOf(fakeData({ deals: async () => deals as any })));
  assertEquals(out.weeks, []);
  assert(out.said.startsWith('Nothing on the board for this was seen in the last 48 hours. 2 older weeks'));
  assertEquals(out.older_weeks.length, 2);
  assertEquals(out.interval_said, 'Interval has nothing on the board for this place and these dates right now.');
  const rw: any = await runTool('redweek', { stay_id: null }, ctxOf(fakeData({ deals: async () => deals as any })));
  assertEquals(rw.weeks, []);
  assertEquals(rw.older_weeks.map((w: any) => w.deal_id), ['old-rw']);
});

Deno.test('a $9 week from 16 October is never a recommendation: not fresh, and a price nobody should be quoted', async () => {
  const deals = [oneWeek('nine', 'redweek', 6 * 24 + 4, 9, { title: 'Barceló Aruba · owner asking $9 a night on RedWeek' })];
  const out: any = await runTool('board', { stay_id: null, from: null, to: null }, ctxOf(fakeData({ deals: async () => deals as any })));
  assertEquals(out.weeks, []);
  assertEquals(out.older_weeks[0].per_night_usd_when_seen, null, 'a misread figure is not even printed beside the old week');
});

Deno.test('Ian\'s 48 hours and 7 days are the app\'s: the same verdict for every age, from js/core/freshness.js', async () => {
  const f = await import('../../../js/core/freshness.js');
  assertEquals([f.FRESH_HOURS, f.RETIRE_AFTER_DAYS], [FRESH_HOURS, RETIRE_DAYS]);
  assertEquals([...f.WATCHED_SOURCES], WATCHED_SOURCES);
  const now = Date.now();
  for (const source of ['redweek', 'interval', 'vakaymood', 'iberostar']) {
    for (const h of [0.5, 5, 47, 48, 49, 100, 167, 168, 169, 400]) {
      const seen = new Date(now - h * HOURS).toISOString();
      const deal = oneWeek('x', source, h, 200);
      const facts = dealFacts(deal as any, surf, S, now);
      const app = { source, seenAt: seen, postedAt: seen };
      assertEquals(facts.fresh, f.isFresh(app, now), `${source} ${h}h fresh`);
      assertEquals(facts.retired_by_age, f.isStale(app, now), `${source} ${h}h retired by age`);
    }
  }
});

// ---------------------------------------------------------------- Ian v2, slice 1: the trip plan
const planCtx = (deals: any[] = []) => ({ resolveStay: async (x: string) => (/surf/i.test(x) ? 'surf' : /ocean/i.test(x) ? 'oc' : null), deals });

Deno.test('the plan: a blank is filled, a value is never overwritten, a change is only proposed', async () => {
  const r1 = await planFrom(emptyPlan(), { place: 'Surf Club', from: day(30), to: day(37), adults: '3', infants: '1', origin: 'lim' }, planCtx());
  assertEquals(r1.refused, []);
  assertEquals([r1.plan.stay_id, r1.plan.adults, r1.plan.infants, r1.plan.origin], ['surf', 3, 1, 'LIM']);
  assertEquals(r1.change, null);
  const r2 = await planFrom(r1.plan, { from: day(37), to: day(44), adults: '3' }, planCtx());
  assertEquals([r2.plan.from, r2.plan.to], [day(30), day(37)], 'the dates they gave stand');
  assertEquals(r2.change, { from: day(37), to: day(44) }, 'the new ones only as a proposal');
  assertEquals(r2.filled, []);
});

Deno.test('the plan refuses what cannot be true', async () => {
  const bad = async (input: Record<string, string>, cur = emptyPlan(), deals: any[] = []) => (await planFrom(cur, input, planCtx(deals))).refused.join(' | ');
  assert((await bad({ origin: 'LIMA' })).includes('three-letter'));
  assert((await bad({ origin: 'AUA' })).includes('three-letter'));
  assert((await bad({ from: day(9), to: day(3) })).includes('backwards'));
  assert((await bad({ from: day(-5), to: day(2) })).includes('passed'));
  assert((await bad({ adults: '1', infants: '2' })).includes('more lap infants than adults'));
  assert((await bad({ place: 'Surf Club', deal_id: 'x1' }, emptyPlan(), [{ id: 'x1', stay_id: 'oc', from_date: day(30), to_date: day(37) }])).includes('another place'));
  assert((await bad({ todo: 'a boat trip for $120' })).includes('cannot carry a price'));
  assert((await bad({ place: 'Hyatt' })).includes('no single place'));
  assert((await bad({ from: day(30), to: day(60) })).includes('at most 28 nights'));
});

Deno.test('choosing a week brings its place and dates, and a week on other dates waits for the member', async () => {
  const deals = [{ id: 'w1', stay_id: 'surf', from_date: day(30), to_date: day(37) }];
  const r = await planFrom(emptyPlan(), { deal_id: 'w1' }, planCtx(deals));
  assertEquals([r.plan.deal_id, r.plan.stay_id, r.plan.from, r.plan.to], ['w1', 'surf', day(30), day(37)]);
  const dated = { ...emptyPlan(), stay_id: 'surf', from: day(20), to: day(27) };
  const r2 = await planFrom(dated, { deal_id: 'w1' }, planCtx(deals));
  assertEquals(r2.plan.deal_id, null, 'not filled ahead of its dates');
  assertEquals(r2.change, { from: day(30), to: day(37), deal_id: 'w1' });
});

Deno.test('what is missing comes in order, and the flights are the week\'s own dates for everyone', () => {
  const p = { ...emptyPlan(), stay_id: 'surf', from: day(30), to: day(37) };
  assertEquals(missing(p)[0], 'who is travelling (adults, children, lap infants)');
  assertEquals(missing({ ...p, adults: 2 })[0], 'where they fly from');
  assertEquals(missing({ ...p, adults: 2, origin: 'LIM' })[0], 'which week on the board');
  assertEquals(legs({ ...p, adults: 3, infants: 1, origin: 'LIM' }, { from_date: day(32), to_date: day(39) }), { out: day(32), back: day(39), origin: 'LIM', adults: 3, children: 0, infants: 1 });
  assertEquals(asPlan({ adults: '3', origin: 7, junk: 1 }).adults, null, 'a stored plan is cleaned, not trusted');
});

Deno.test('the plan tool writes blanks, turns a change into a card, and refuses with reasons', async () => {
  const c = ctxOf();
  const w: any = await runTool('plan', { place: 'Surf Club', from: day(30), to: day(37), adults: '3', infants: '1', origin: 'LIM', children: '', deal_id: '', transfer: '', todo: '', open: '' }, c);
  assertEquals(w.written.sort(), ['adults', 'from', 'infants', 'origin', 'stay_id', 'to']);
  assertEquals(w.still_missing[0], 'which week on the board');
  const again: any = await runTool('plan', { from: day(44), to: day(51) }, c);
  assertEquals(again.written, []);
  assertEquals(c.cards.map((x: any) => [x.action, x.plan]), [['plan_change', { from: day(44), to: day(51) }]]);
  assertEquals((await c.data.plan!() as any).from, day(30), 'nothing was overwritten');
  assert(((await runTool('plan', { origin: 'Lima' }, ctxOf())) as any).error.includes('three-letter'));
});

Deno.test("the plan rides in Ian's context with what is missing and both legs", async () => {
  const data = fakeData();
  await data.savePlan!({ ...emptyPlan(), stay_id: 'surf', from: day(30), to: day(37), adults: 3, infants: 1, origin: 'LIM' } as any);
  const out: any = await turn({ lines: [{ role: 'user', text: 'help me plan this' }], data, model: 'claude-haiku-5-5', dryRun: true });
  const t = out.payload.system[1].text;
  assert(t.includes('"origin":"LIM"') && t.includes('"place":"Surf Club"'));
  assert(t.includes('Still missing, in this order: which week on the board'));
  assert(t.includes(`out ${day(30)} from LIM to AUA, back ${day(37)}, for every traveller including lap infants`));
  assert(out.places_on_file === 14 && out.facts_chars > 0, 'the dry run says what the deploy carried');
});

// ---------------------------------------------------------------- slice 2: actions the member confirms
Deno.test('a watch card needs a place and future dates; an ask carries who and a note with no price', async () => {
  const c = ctxOf();
  assert((await runTool('propose', { action: 'watch', stay_id: 'Surf Club', from: '', to: '' }, c) as any).error);
  assert((await runTool('propose', { action: 'watch', stay_id: 'Surf Club', from: day(30), to: day(37), guests: '4' }, c) as any).shown);
  assertEquals([c.cards[0].action, c.cards[0].nights, c.cards[0].guests], ['watch', 7, 4]);
  const note = '3 adults and a lap infant; please check an Interval package with flights from LIM, out and back on these dates';
  assert((await runTool('propose', { action: 'ask_dates', stay_id: 'surf', from: day(30), to: day(37), guests: '4', note }, c) as any).shown);
  assertEquals([c.cards[1].guests, c.cards[1].note], [4, note]);
  assert((await runTool('propose', { action: 'ask_dates', stay_id: 'surf', from: day(30), to: day(37), note: 'around $900 if possible' }, ctxOf()) as any).error.includes('no prices'));
  assert((await runTool('propose', { action: 'ask_dates', stay_id: 'surf', from: day(30), to: day(37), note: 'x'.repeat(601) }, ctxOf()) as any).error);
  assert((await runTool('propose', { action: 'watch', stay_id: 'surf', from: day(30), to: day(37), guests: '0' }, ctxOf()) as any).error);
});

Deno.test('the promise guard: a promise needs the card or tool that keeps it; "booked" and the banned words never pass', () => {
  const none = { cards: [], tools: [] };
  assertEquals(brokenPromises("I'll let you know when a cheaper week turns up.", none), ["I'll let you know"]);
  assertEquals(brokenPromises("I'll let you know when a cheaper week turns up.", { cards: [{ action: 'watch' }], tools: [] }), []);
  assertEquals(brokenPromises('Noted: four of you, from Lima.', none), ['Noted']);
  assertEquals(brokenPromises('Noted: four of you, from Lima.', { cards: [], tools: [{ name: 'plan' }] }), []);
  assertEquals(brokenPromises("I've booked the Surf Club week for you.", { cards: [{ action: 'watch' }], tools: [{ name: 'plan' }] }), ["I've booked the"]);
  assertEquals(brokenPromises('That week is still available.', none), ['available']);
  assertEquals(brokenPromises('Victor confirms every price before he books.', none), [], '"confirms" is not "confirmed"');
  assertEquals(stripPromises("Here is the week. I'll email you if it drops.", none), 'Here is the week.');
});

Deno.test('a promise with nothing behind it is sent back once, without a meta-line, then cut', async () => {
  const replies = [
    { stop_reason: 'end_turn', content: [{ type: 'text', text: "I'm Ian, the Circle's concierge. I'll keep an eye on the Surf Club for you." }], usage: {} },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: "I'm Ian, the Circle's concierge. I will keep checking every day." }], usage: {} },
  ];
  const seen: any[] = [];
  const out: any = await turn({ lines: [{ role: 'user', text: 'watch it' }], data: fakeData(), model: 'claude-haiku-5-5', callModel: async (p) => { seen.push(structuredClone(p)); return replies[seen.length - 1]; } });
  assertEquals(out.reply, "I'm Ian, the Circle's concierge.");
  const ask = String(seen[1].messages.at(-1).content);
  assert(ask.startsWith('[System check, not from the member]') && ask.includes('Do not mention this check') && ask.includes('keep your opening line'));
  assertEquals(out.tools.map((t: any) => t.name), ['(promise guard)', '(promise guard)']);
});

// ---------------------------------------------------------------- slice 3: what Ian knows
Deno.test("facts: the right section with its source; nothing on file said as such", () => {
  const taxi: any = factsFor('taxi from the airport');
  assertEquals(taxi.found[0].topic, 'Getting from the airport to the hotels (taxi)');
  assert(taxi.found[0].facts.includes('Oranjestad $26') && taxi.found[0].listing.startsWith('https://www.aruba.com/'));
  assertEquals((factsFor('kids club ghost') as any).found, []);
  assertEquals((factsFor('kids club ghost') as any).said, 'Nothing on file about that. Say it is not on file; never guess.');
  assert((factsFor('Can I take my points out?') as any).found[0].facts.includes('$25 exit fee'));
  for (const s of sections()) assert(/^.+\. Checked \d{1,2} \w+ \d{4}\.$/.test(s.source), `${s.title}: every section names its source and date`);
});

Deno.test("facts.md's rules are the app's rules: a new rules version without a facts.md change fails", async () => {
  const money = await import('../../../js/core/money.js');
  const md = Deno.readTextFileSync(new URL('./facts.md', import.meta.url));
  assertEquals(md.match(/Rules version: ([\d.]+)/)?.[1], money.DEFAULT_SETTINGS.rulesVersion);
});

Deno.test("places carries what a place publishes, with the page it was read from as its only link", async () => {
  const one: any = await runTool('places', { filter: 'surf' }, ctxOf({ ...fakeData(), stays: async () => [{ ...surf, name: "Marriott's Aruba Surf Club" }] as any }));
  const p = one.places[0].published;
  const sp = (x: string) => x.replace(/\s/gu, ' ');      // places.js writes "4:00 pm" with a narrow no-break space
  assertEquals([sp(p.check_in), sp(p.check_out), p.children_welcome], ['4:00 pm', '10:00 am', true]);
  assert(p.source[0].listing.startsWith('https://vakaymood.com/'));
  const f = emptyFigures(); collect(one, f);
  assertEquals([...f.links], [p.source[0].listing]);
  const none: any = await runTool('places', { filter: 'surf' }, ctxOf());
  assert(String(none.places[0].published).includes('not on file'), 'a place with no published facts says so');
  assertEquals(placeFacts('Nowhere Inn'), null);
});

// ---------------------------------------------------------------- slice 4a: flights both ways
Deno.test('flights follow one option\'s own dates, every traveller, airline-direct links only', async () => {
  const data = fakeData();
  await data.savePlan!({ ...emptyPlan(), stay_id: 'surf', from: day(30), to: day(37), adults: 3, infants: 1, origin: 'LIM' } as any);
  const byWeek: any = await runTool('flights', { option: 'iv' }, ctxOf(data));
  assertEquals([byWeek.legs.out.date, byWeek.legs.back.date], [day(32), day(39)], "the Getaway's own dates, not the plan's");
  assertEquals(byWeek.airlines.map((a: any) => a.airline), ['LATAM', 'Avianca', 'Copa']);
  assert(byWeek.airlines.every((a: any) => a.listing.includes(day(32)) && a.listing.includes(day(39))));
  const byPlan: any = await runTool('flights', { option: 'plan' }, ctxOf(data));
  assertEquals([byPlan.legs.out.date, byPlan.legs.back.date, byPlan.travellers.lap_infants], [day(30), day(37), 1]);
  assert((await runTool('flights', { option: 'nope' }, ctxOf(data)) as any).error);
  const f = emptyFigures(); collect(byWeek, f);
  assertEquals(f.links.size, 3, 'the phone links these, and nothing else');
  assert(![...f.links].some(u => /google|kayak|skyscanner|expedia/.test(u)));
});

// ---------------------------------------------------------------- the first nightly replay's failures
Deno.test("a fee comes with its own percentage and sentence; a saving with its per-night figure", async () => {
  const f = dealFacts({ id: 'd1', stay_id: 'surf', from_date: '2026-10-03', to_date: '2026-10-10', nights: 7, points_total: 161000, source: 'redweek', title: 'owner asking $166 a night', seen_at: new Date().toISOString() }, surf, S);
  assertEquals([f.fee_pct, f.under_public_per_night_usd], [20, -27]);
  assertEquals(f.fee_said, "fees add $238 on top of the owner's ask of $1,162 for the nights, 20%: more than the 10% worth pointing out");
  const g = emptyFigures(); collect(f, g);
  assertEquals(strays('Fees add $238, 20% on top of the ask: more than the 10% worth pointing out. That is $27 a night over the public rate.', g), []);
});

Deno.test('a fresh-look button comes with how old the newest read there is', async () => {
  const out: any = await runTool('refresh_redweek', { stay_id: 'surf' }, ctxOf());
  assert(/^seen \d+ (min|hours?) ago$/.test(out.newest_read_here), out.newest_read_here);
  assert(out.say.includes('newest read here was seen'));
});

Deno.test("the shared copies are the app's own modules, byte for byte (run shared/sync.ts after changing one)", async () => {
  const { SHARED, render } = await import('./shared/sync.ts');
  for (const [src, dst] of SHARED) assertEquals(await Deno.readTextFile(new URL(`./shared/${dst}`, import.meta.url)), await render(src), `${dst} has drifted from circle/${src}`);
});
