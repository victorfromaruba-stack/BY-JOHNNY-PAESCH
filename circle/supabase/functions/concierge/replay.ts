// Ian's nightly replay: real questions against the real model, every answer checked IN CODE.
//
// Why: the unit tests stub the model, so they cannot say whether a change to learnings.md or
// prompt.ts made Ian better or worse, and every lesson in learnings.md so far was found by hand.
// This replays about 30 questions (the five proof questions, one per lesson, and real member
// questions from concierge_turns) through turn() on claude-haiku-5-5, three trials each, against a
// frozen board whose dates move with the run day, so the 48-hour rule gives the same verdict every
// night. No grader model: each check below is a regex or a look at the tools Ian called.
//
// It is the gate for the coach's proposals (nightly.mjs): a candidate learnings.md is copied into a
// scratch copy of this folder, replayed, and only applied when the pass rate does not drop.
//
//   deno run --allow-read --allow-write --allow-net=api.anthropic.com --allow-env replay.ts \
//     --learnings <candidate.md> --cases <real-cases.json> --out <eval.json> [--cap 0.25] [--trials 3]
//
// Needs ANTHROPIC_API_KEY. Spends at most --cap dollars: refuses up front when the estimate is
// over it (exit 3, {skipped}), and stops mid-run before a turn that would cross it (complete:false).

export type Case = { id: string; kind: 'proof' | 'lesson' | 'member'; text: string; expect: string[] };
type Turn = { reply: string; cards: { action: string }[]; tools: { name: string; input: any }[]; cost: number; error: string | null };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const iso = (now: number, n: number) => new Date(now + n * 864e5).toISOString().slice(0, 10);
const longDate = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** The proof questions (the first live run) and one per lesson in learnings.md. */
export const FIXED: Case[] = [
  { id: 'p1-intro-cheapest', kind: 'proof', text: 'Hi. Who are you, and what is the cheapest week on the board right now?', expect: ['intro'] },
  { id: 'p2-compare', kind: 'proof', text: 'Compare RedWeek and Interval at the Surf Club for {M30}.', expect: ['interval_first'] },
  { id: 'p3-quote-cover', kind: 'proof', text: 'What would 7 nights at the Surf Club from {D45} cost, and can I cover it?', expect: [] },
  { id: 'p4-chip-in', kind: 'proof', text: "Is anyone's booking open for me to chip in to?", expect: [] },
  { id: 'p5-remember', kind: 'proof', text: 'We usually go in late {M30}, four of us, and we like a kitchen.', expect: ['remember_called'] },
  { id: 'l-round-trip', kind: 'lesson', text: 'We fly from Miami. What about flights for the Surf Club week starting {D30}?', expect: ['both_legs'] },
  { id: 'l-own-dates', kind: 'lesson', text: 'Give me two Surf Club options in {M30} with flights from Lima for each one.', expect: ['both_legs', 'own_dates'] },
  { id: 'l-flights-origin', kind: 'lesson', text: 'Can you find us flights for the cheapest Surf Club week?', expect: ['both_legs'] },
  { id: 'l-interval-first', kind: 'lesson', text: 'Which is better value at the Surf Club in {M30}, Interval or RedWeek?', expect: ['interval_first'] },
  { id: 'l-no-invented-price', kind: 'lesson', text: 'How much a night do I save on the cheapest Surf Club week against the public rate?', expect: [] },
  { id: 'l-stale', kind: 'lesson', text: "What's on the board at the Ocean Club?", expect: ['stale_said'] },
  { id: 'l-fresh-look', kind: 'lesson', text: 'The Ocean Club reads look old. Can you get a fresh look?', expect: ['refresh_card'] },
  { id: 'l-misread', kind: 'lesson', text: 'What is the cheapest week anywhere on the board?', expect: ['no_misread_quote'] },
  { id: 'l-not-desk-ian', kind: 'lesson', text: 'Are you Ian from the Desk?', expect: ['not_desk_ian'] },
];

/** {M30} / {D30}-style placeholders, filled from the run day so the fixture's weeks always match. */
export const fill = (text: string, now: number) => text
  .replace(/\{M(\d+)\}/g, (_, n) => MONTHS[Number(iso(now, Number(n)).slice(5, 7)) - 1])
  .replace(/\{D(\d+)\}/g, (_, n) => longDate(iso(now, Number(n))));

/** The frozen board, shaped like concierge.test.ts's fakeData, dated from `now`. */
export function fixture(now = Date.now()) {
  const S = { pointsPerDollar: 100, serviceRate: 0.15, tiers: [{ monthlyUsd: 100, bonusRate: 0 }, { monthlyUsd: 200, bonusRate: 0.06 }] };
  const d = (n: number) => iso(now, n);
  const seen = (daysAgo: number) => new Date(now - daysAgo * 864e5).toISOString();
  const stays = [
    { id: 'surf', name: "Marriott's Aruba Surf Club", rate_low_usd: 135, rate_high_usd: 300, rate_peak_usd: 580, retail_usd: 450, min_nights: 2, peak_min_nights: 7 },
    { id: 'oc', name: "Marriott's Aruba Ocean Club", rate_low_usd: 150, rate_high_usd: 320, rate_peak_usd: 600, retail_usd: 480, min_nights: 2, peak_min_nights: 7 },
    { id: 'barc', name: 'Barceló Aruba', rate_low_usd: 120, rate_high_usd: 260, rate_peak_usd: 500, retail_usd: 380, min_nights: 2, peak_min_nights: 7 },
  ];
  const deals = [
    { id: 'rw1', stay_id: 'surf', from_date: d(30), to_date: d(37), nights: 7, points_total: 161000, source: 'redweek', source_url: 'https://www.redweek.com/posting/R1', title: "Marriott's Aruba Surf Club · Studio · owner asking $166 a night on RedWeek", seen_at: seen(0.2) },
    { id: 'iv1', stay_id: 'surf', from_date: d(32), to_date: d(39), nights: 7, points_total: 80500, source: 'interval', title: 'Interval Getaway · Studio', seen_at: seen(0.3) },
    { id: 'rw2', stay_id: 'surf', from_date: d(44), to_date: d(51), nights: 7, points_total: 140000, source: 'redweek', source_url: 'https://www.redweek.com/posting/R2', title: "Marriott's Aruba Surf Club · 1BR · owner asking $150 a night on RedWeek", seen_at: seen(0.5) },
    { id: 'rwold', stay_id: 'oc', from_date: d(35), to_date: d(42), nights: 7, points_total: 170000, source: 'redweek', source_url: 'https://www.redweek.com/posting/R3', title: "Marriott's Aruba Ocean Club · 2BR · owner asking $180 a night on RedWeek", seen_at: seen(5) },
    { id: 'rwbad', stay_id: 'barc', from_date: d(60), to_date: d(67), nights: 7, points_total: 7100, source: 'redweek', source_url: 'https://www.redweek.com/posting/R4', title: 'Barceló Aruba · owner asking $9 a night on RedWeek', seen_at: seen(0.4) },
  ];
  let notes: Record<string, string> = {};
  const data = {
    settings: async () => ({ ...S, model: 'claude-haiku-5-5', dailyUsd: 5 }),
    me: async () => ({ id: 'm1', name: 'Sam Test', monthly_usd: 100 }),
    stays: async () => stays as any[],
    roomTypes: async () => [{ stay_id: 'surf', name: 'Studio', sleeps: 2 }, { stay_id: 'surf', name: 'One bedroom', sleeps: 4 }, { stay_id: 'oc', name: 'Two bedroom', sleeps: 6 }],
    deals: async () => deals as any[],
    quote: async () => ({ points: 108675, nights: 7, min_nights: 2, retail_usd: 1418 }),
    available: async () => 20000,
    redemptions: async () => [{ id: 'sh', member_id: 'm2', stay_id: 'surf', check_in: d(60), check_out: d(67), nights: 7, status: 'quoted', shared: true, points: 30000, quoted_points: 90000 }],
    pledges: async () => [{ redemption_id: 'sh', points: 10000 }],
    crews: async () => [],
    crewMembers: async () => [],
    watches: async () => [],
    members: async () => [{ id: 'm1', name: 'Sam Test', status: 'active' }, { id: 'm2', name: 'Luis Ras', status: 'active' }, { id: 'bot', name: 'Watcher', status: 'active', bot: true }],
    redweekChecks: async () => null,
    memory: async () => notes,
    saveMemory: async (n: Record<string, string>) => { notes = n; },
  };
  return { data, dates: new Set(deals.flatMap((x) => [x.from_date, x.to_date])) };
}

// ---------------------------------------------------------------- the checks, all code
const DATE_RX = new RegExp(`\\b(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS.join('|')})|(?:${MONTHS.join('|')}) \\d{1,2}(?:st|nd|rd|th)?)\\b`, 'gi');
/** Every date the reply names, as YYYY-MM-DD in the year that puts it nearest the run day. */
export function datesIn(reply: string, now: number): string[] {
  const out: string[] = [];
  for (const m of reply.matchAll(DATE_RX)) {
    const s = m[1];
    if (/^\d{4}-/.test(s)) { out.push(s); continue; }
    const day = Number((/\d{1,2}/.exec(s) || ['0'])[0]);
    const mon = MONTHS.findIndex((x) => new RegExp(x, 'i').test(s));
    const y = new Date(now).getUTCFullYear();
    const cands = [y - 1, y, y + 1].map((yy) => Date.UTC(yy, mon, day));
    const best = cands.reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
    out.push(new Date(best).toISOString().slice(0, 10));
  }
  return out;
}

const ORIGIN_ASK = /where (are|will|would) you (be )?fly|fly(ing)? (out )?from\?|which (city|airport)|where .{0,20}from\?/i;
export const CHECKS: Record<string, (t: Turn, c: { now: number; dates: Set<string>; question: string }) => boolean> = {
  // Global: run on every answer.
  no_stripped_figure: (t) => !t.tools.some((x) => x.name === '(number guard)' && x.input?.stripped),
  no_banned_words: (t) => !/\b(available|confirmed|sold out|guaranteed)\b/i.test(t.reply),
  no_contact: (t) => !/[\w.+-]+@[\w-]+\.[\w.]+/.test(t.reply) && !/\+\d[\d\s().-]{7,}\d/.test(t.reply),
  interval_first: (t) => {
    const rw = t.reply.search(/redweek|owner week/i);
    if (rw < 0) return true;
    const iv = t.reply.search(/interval|getaway/i);
    return iv >= 0 && iv < rw;
  },
  stale_said: (t) => !/ocean club/i.test(t.reply)
    || /\b\d+ days? ago|last seen|days? old|old(er)? (read|week)|re-?check|not (been )?seen/i.test(t.reply),
  answered: (t) => !t.error && t.reply.trim().length > 0,
  // Per case.
  both_legs: (t) => ORIGIN_ASK.test(t.reply)
    || (/\b(out|outbound|depart\w*|leav\w*|going)\b/i.test(t.reply) && /\b(back|return\w*|home)\b/i.test(t.reply)),
  own_dates: (t, c) => datesIn(t.reply, c.now).every((d) => c.dates.has(d) || d === iso(c.now, 0)),
  refresh_card: (t) => t.cards.some((x) => x.action === 'refresh'),
  remember_called: (t) => t.tools.some((x) => x.name === 'remember'),
  intro: (t) => /\bIan\b/.test(t.reply),
  not_desk_ian: (t) => /\bnot\b[^.]{0,60}\b(him|person|human|desk)\b|\bsoftware\b|\bdifferent\b/i.test(t.reply),
  no_misread_quote: (t) => !/\$\s?(9|71)\b/.test(t.reply)
    && (!/barcel/i.test(t.reply) || /looks? wrong|misread|not quot|odd|error|mistake/i.test(t.reply)),
};
export const GLOBAL = ['answered', 'no_stripped_figure', 'no_banned_words', 'no_contact', 'interval_first', 'stale_said'];

/** Which checks failed for one answer. */
export function judge(t: Turn, kase: Case, now: number, dates: Set<string>): string[] {
  const ids = [...new Set([...GLOBAL, ...kase.expect])];
  const ctx = { now, dates, question: kase.text };
  return ids.filter((id) => !(CHECKS[id] ? CHECKS[id](t, ctx) : false));
}

/** A real member question becomes a case: flights questions are held to both legs. */
export function memberCase(q: { id: string; text: string }): Case {
  return { id: q.id, kind: 'member', text: q.text, expect: /\bflights?\b|\bfly\b|\bairfare|\bfares?\b/i.test(q.text) ? ['both_legs'] : [] };
}

async function sha(s: string) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

async function main() {
  const arg = (k: string, dflt?: string) => { const i = Deno.args.indexOf(`--${k}`); return i >= 0 ? Deno.args[i + 1] : dflt; };
  const out = arg('out')!;
  const cap = Number(arg('cap', '0.25'));
  const trials = Number(arg('trials', '3'));
  const perTurn = Number(arg('estimate', '0.0013'));
  const model = 'claude-haiku-5-5';
  const now = Date.now();
  const learnings = await Deno.readTextFile(arg('learnings')!);
  const real: { id: string; text: string }[] = arg('cases') ? JSON.parse(await Deno.readTextFile(arg('cases')!).catch(() => '[]')) : [];
  const cases = [...FIXED, ...real.slice(0, 30 - FIXED.length).map(memberCase)].map((c) => ({ ...c, text: fill(c.text, now) }));
  const base = { date: new Date(now - 4 * 36e5).toISOString().slice(0, 10), model, trials, candidateSha: await sha(learnings), learningsChars: learnings.length };
  const write = (o: unknown) => Deno.writeTextFile(out, JSON.stringify(o, null, 1));

  const estimate = cases.length * trials * perTurn;
  if (estimate > cap) {
    await write({ ...base, skipped: `estimate $${estimate.toFixed(3)} is over the $${cap} cap`, complete: false });
    console.log(`skipped: estimate $${estimate.toFixed(3)} > cap $${cap}`);
    Deno.exit(3);
  }
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');

  // A scratch copy of this folder with the candidate learnings.md, so prompt.ts reads THAT at import.
  const here = new URL('.', import.meta.url).pathname;
  const tmp = await Deno.makeTempDir({ prefix: 'ian-replay-' });
  const copy = async (from: string, to: string) => {
    for await (const e of Deno.readDir(from)) {
      if (e.isDirectory) { await Deno.mkdir(`${to}/${e.name}`); await copy(`${from}/${e.name}`, `${to}/${e.name}`); } else if (/\.ts$/.test(e.name)) await Deno.copyFile(`${from}/${e.name}`, `${to}/${e.name}`);
    }
  };
  await copy(here, tmp);
  await Deno.writeTextFile(`${tmp}/learnings.md`, learnings);
  const ian = await import(`file://${tmp}/ian.ts`);
  const callModel = ian.anthropic(key);

  let spent = 0; let turns = 0; let complete = true;
  const results = [];
  for (const kase of cases) {
    const runs = [];
    for (let i = 0; i < trials; i++) {
      if (spent + (turns ? spent / turns : perTurn) > cap) { complete = false; break; }
      const { data, dates } = fixture(now);
      const t = await ian.turn({ lines: [{ role: 'user', text: kase.text }], data, model, callModel }) as Turn;
      spent += t.cost || 0; turns++;
      const failed = judge(t, kase, now, dates);
      runs.push({ pass: !failed.length, failed, cost: Number((t.cost || 0).toFixed(6)), reply: t.reply.slice(0, 600), tools: t.tools.map((x) => x.name), error: t.error });
    }
    if (!complete) break;
    const pass = runs.filter((r) => r.pass).length * 2 > runs.length;       // majority of the trials
    results.push({ id: kase.id, kind: kase.kind, text: kase.text, pass, runs });
  }
  await Deno.remove(tmp, { recursive: true });
  const passed = results.filter((r) => r.pass).length;
  await write({ ...base, complete, cases: results, passed, total: results.length, passRate: results.length ? Number((passed / results.length).toFixed(4)) : 0, costUsd: Number(spent.toFixed(4)), turns });
  console.log(`${complete ? 'complete' : 'STOPPED AT THE CAP'}: ${passed}/${results.length} cases pass, ${turns} turns, $${spent.toFixed(4)}`);
}

if (import.meta.main) await main();
