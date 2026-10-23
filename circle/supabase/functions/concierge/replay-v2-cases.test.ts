// deno test -A replay-v2-cases.test.ts — the v2 cases' checks, and Ian imported from a scratch copy the
// way replay.ts makes one (.ts files only), so the night's run cannot fail at import.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { applySeed, copyV2Files, V2_CASES, V2_CHECKS } from './replay-v2-cases.ts';
import { fixture } from './replay.ts';

const ctx = { now: Date.now(), dates: new Set<string>(), question: '' };
const turn = (o: Partial<{ reply: string; cards: any[]; tools: any[] }>) => ({ reply: '', cards: [], tools: [], ...o });

Deno.test('the v2 checks pass what they should and fail what they should', () => {
  assert(V2_CHECKS.plan_written(turn({ tools: [{ name: 'plan', input: { adults: '3', infants: '1', origin: 'LIM' } }] }), ctx));
  assert(!V2_CHECKS.plan_written(turn({ tools: [{ name: 'remember', input: {} }] }), ctx));
  assert(V2_CHECKS.asks_who(turn({ reply: 'Who is travelling with you?' }), ctx));
  assert(V2_CHECKS.ask_card_both_legs(turn({ cards: [{ action: 'ask_dates', note: 'Interval package with flights out from MIA on the 13th and back on the 20th' }] }), ctx));
  assert(!V2_CHECKS.ask_card_both_legs(turn({ cards: [{ action: 'ask_dates', note: 'flights from MIA' }] }), ctx));
  assert(!V2_CHECKS.no_empty_promise(turn({ reply: "I'll let you know when it drops." }), ctx));
  assert(V2_CHECKS.no_empty_promise(turn({ reply: "I'll let you know when it drops.", cards: [{ action: 'watch' }] }), ctx));
  assert(!V2_CHECKS.airline_direct(turn({ reply: 'See https://www.google.com/travel/flights' }), ctx));
  assert(V2_CHECKS.says_four_pm(turn({ reply: 'Check-in is at 4:00 pm.' }), ctx));
  assert(V2_CHECKS.taxi_fare(turn({ reply: 'About $41 to the high-rise north.' }), ctx));
});

Deno.test("Ian loads from the replay's scratch copy, with facts and places, and a seeded plan reaches the context", async () => {
  const here = new URL('.', import.meta.url).pathname;
  const tmp = await Deno.makeTempDir({ prefix: 'ian-replay-test-' });
  const copy = async (from: string, to: string) => {                     // replay.ts's own copy rule
    for await (const e of Deno.readDir(from)) {
      if (e.isDirectory) { await Deno.mkdir(`${to}/${e.name}`); await copy(`${from}/${e.name}`, `${to}/${e.name}`); } else if (/\.ts$/.test(e.name)) await Deno.copyFile(`${from}/${e.name}`, `${to}/${e.name}`);
    }
  };
  try {
    await copy(here, tmp);
    await Deno.writeTextFile(`${tmp}/learnings.md`, '# test');
    await copyV2Files(here, tmp);
    const ian = await import(`file://${tmp}/ian.ts`);
    const now = Date.now();
    const kase = V2_CASES.find(c => c.id === 'pl-dates')!;
    const { data } = fixture(now);
    applySeed(data, kase, now);
    const out = await ian.turn({ lines: [{ role: 'user', text: kase.text }], data, model: 'claude-haiku-5-5', dryRun: true });
    assertEquals(out.places_on_file, 14);
    assert(out.facts_chars > 1000, 'facts.md came along');
    assert(out.payload.system[1].text.includes('"origin":"MIA"'));
  } finally { await Deno.remove(tmp, { recursive: true }); }
});
