// deno test circle/supabase/functions/concierge/
// The rules Ian is held to, each with the case that would break it.

import { assert, assertEquals } from 'jsr:@std/assert@1';
import { bandNights, cheaperNextDoor, dealFacts, monthsToAfford, ownerAsk, publicTotal, rateBandFor, seasonEdge } from './compare.ts';
import { memberContext } from './redact.ts';
import { runTool, TOOLS, type Data } from './tools.ts';
import { claimedFigures, figuresIn, LASTING, stripStray, turn } from './ian.ts';

const S = { pointsPerDollar: 100, serviceRate: 0.15, tiers: [{ monthlyUsd: 100, bonusRate: 0 }, { monthlyUsd: 200, bonusRate: 0.06 }] };
const surf = { id: 'surf', name: 'Surf Club', rate_low_usd: 135, rate_high_usd: 300, rate_peak_usd: 580, retail_usd: 450, min_nights: 2, peak_min_nights: 7 };
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

// ---------------------------------------------------------------- compare
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
  assertEquals(g.implausible, false);
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
    tap: async () => 'off',
    memory: async () => notes,
    saveMemory: async (n) => { notes = n; },
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
  assert(String(out.weeks[2].implausible).includes('misread'));
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
  assert((await runTool('propose', { action: 'create_crew', name: 'Four', stay_id: 'surf', from: day(30), to: day(37), redemption_id: 'priv' }, c) as any).shown);
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
Deno.test('claimed figures: dollars, thousands, points', () => {
  assertEquals(claimedFigures('From $1,162 all in, or $3k, about 12,500 points (800 pts a night).'), [1162, 3000, 12500, 800]);
  const ok = figuresIn('{"total_usd_all_in":1162,"per_night_usd":166}');
  assertEquals(stripStray('It is $1,162 in all. That saves $400. The ask is $166 a night.', ok), 'It is $1,162 in all. The ask is $166 a night.');
});

Deno.test('digits inside ids, links and dates are not figures anyone gave', () => {
  const ok = figuresIn('{"deal_id":"1feb2854-4db5-464a-a339-f1a6068c6775","listing":"https://www.redweek.com/posting/R1517275","from":"2026-11-27","seen":"2026-10-22T13:50:03.457+00:00","per_night_usd":241}');
  assert(ok.has(241));
  for (const n of [75, 1517275, 2026, 27, 13, 50]) assert(!ok.has(n), `${n} leaked in from an id, a link or a date`);
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
  const out: any = await turn({ lines: [{ role: 'user', text: 'cheapest?' }], data: fakeData(), model: 'claude-haiku-5-5',
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
