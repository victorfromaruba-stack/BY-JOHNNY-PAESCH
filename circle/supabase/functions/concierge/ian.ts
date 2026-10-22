// One turn of Ian: the member's line in, up to six rounds of tools, one answer out.
//
// Kept apart from index.ts (which only wires HTTP, auth and the database) so the loop and the
// number guard can be run by a test, or by hand against the live board, with no server.

import { systemBlocks, LEARNINGS } from './prompt.ts';
import { runTool, TOOLS, type Card, type Data } from './tools.ts';

export const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'] as const;
/** USD per million tokens. ponytail: Haiku's >100k-token tier is ignored; Ian's prompts are ~10k. */
export const PRICES: Record<string, { in: number; write: number; read: number; out: number }> = {
  'claude-haiku-5-5': { in: 0.10, write: 0.125, read: 0.01, out: 0.50 },
  'claude-sonnet-5-5': { in: 2, write: 2.5, read: 0.10, out: 10 },
};
export const LIMITS = { inputChars: 2000, lines: 12, rounds: 6, maxTokens: 1500 };

export type Line = { role: 'user' | 'assistant'; text: string };
export type Usage = { input: number; cacheWrite: number; cacheRead: number; output: number; calls: number };
export type ToolCall = { name: string; input: unknown; result_sha: string; ms: number; error?: string };

// ---------------------------------------------------------------- the number guard
const NUM = /\d[\d,]*(?:\.\d+)?/g;
const toNum = (s: string) => Number(s.replace(/,/g, ''));
/** Every figure any source said this turn: tool results, the member's own words, Ian's context. */
export function figuresIn(text: string, into = new Set<number>()) {
  // Ids, links and dates are full of digits that are not figures. Counted, they let an invented
  // "$75" through on the first live run because a 75 sat inside some uuid.
  const clean = String(text)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ' ')
    .replace(/https?:\/\/[^\s"]+/g, ' ')
    .replace(/\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?/g, ' ');
  for (const m of clean.match(NUM) || []) { const n = toNum(m); into.add(Math.round(n)); into.add(Math.floor(n)); }
  return into;
}

/** A line that says how the member travels. Haiku skipped remember twice live; this says it out loud. */
export const LASTING = /\b(usually|always|every (year|time)|we are|we're|there are \d|(two|three|four|five|six|\d) of us|my (wife|husband|partner|kids|family)|budget|prefer|don't like|do not like|hate|love|kitchen)\b/i;
/** The money and points figures in an answer: "$1,162", "$3k", "12,500 points", "800 pts". */
export function claimedFigures(reply: string) {
  const out: number[] = [];
  for (const m of reply.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)(\s?[kK]\b)?/g)) out.push(Math.round(toNum(m[1]) * (m[2] ? 1000 : 1)));
  for (const m of reply.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:points|pts|point)\b/gi)) out.push(Math.round(toNum(m[1])));
  return out;
}
export const strayFigures = (reply: string, allowed: Set<number>) => claimedFigures(reply).filter(n => !allowed.has(n));
/** Last resort: drop every sentence or line that still carries a figure no source gave. */
export function stripStray(reply: string, allowed: Set<number>) {
  return reply.split(/(?<=[.!?])\s+|\n/).filter(s => !strayFigures(s, allowed).length).join(' ').replace(/\s+\n/g, '\n').trim();
}

// ---------------------------------------------------------------- the call
export type CallModel = (payload: Record<string, unknown>) => Promise<any>;
export const anthropic = (key: string): CallModel => async (payload) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${body?.error?.message || 'no message'}`);
  return body;
};

export const costUsd = (model: string, u: Usage) => {
  const p = PRICES[model] || PRICES['claude-sonnet-5-5'];
  return (u.input * p.in + u.cacheWrite * p.write + u.cacheRead * p.read + u.output * p.out) / 1e6;
};

async function sha(x: unknown) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(x) ?? '')));
  return [...b.slice(0, 8)].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** The tool list with the cache breakpoint on its last entry. */
const toolsCached = () => TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t));

/** What Ian is told about this member, after the cached prefix. */
async function contextBlock(data: Data, stayId: string | null, first: boolean, lasting: boolean) {
  const [me, memory, stays] = await Promise.all([data.me(), data.memory(), stayId ? data.stays() : Promise.resolve([])]);
  const stay = stayId ? stays.find(s => s.id === stayId) : null;
  const today = new Date(Date.now() - 4 * 36e5).toISOString().slice(0, 10);
  return [
    `Today in Aruba is ${today}.`,
    `You are talking to ${String(me.name || '').trim().split(/\s+/)[0] || 'an Insider'}.`,
    `What you have noted about them before: ${Object.keys(memory || {}).length ? JSON.stringify(memory) : 'nothing yet'}.`,
    stay ? `They opened you from the page of ${stay.name} (stay_id ${stay.id}).` : '',
    // Asked for in the prompt and skipped by Haiku on the first live run; said here, it happens.
    first ? 'This is their first message to you: begin your answer with one short line saying you are Ian, the Circle\'s concierge.' : '',
    lasting ? 'Their last message says something lasting about how they travel: call remember for it first, and say in one line what you noted.' : '',
  ].filter(Boolean).join('\n');
}

export async function turn({ lines, stayId = null, data, model, callModel, dryRun = false }: {
  lines: Line[]; stayId?: string | null; data: Data; model: string; callModel?: CallModel; dryRun?: boolean;
}) {
  const ctx = { data, cards: [] as Card[], cache: new Map<string, Promise<unknown>>() };
  const context = await contextBlock(data, stayId, lines.filter(l => l.role === 'user').length === 1, LASTING.test(lines.at(-1)?.text || ''));
  const messages: any[] = lines.map(l => ({ role: l.role, content: l.text }));
  const payload: Record<string, unknown> = {
    model, max_tokens: LIMITS.maxTokens,
    system: [...systemBlocks(), { type: 'text', text: context }],
    tools: toolsCached(),
    tool_choice: { type: 'auto' },
    output_config: { effort: 'low' },
    // Haiku can switch thinking off, which is most of the saving; Sonnet 5.5 refuses "disabled".
    ...(model.startsWith('claude-haiku') ? { thinking: { type: 'disabled' } } : {}),
    messages,
  };
  if (dryRun) return { payload, learnings_chars: LEARNINGS.length };
  if (!callModel) throw new Error('No model to call.');

  const usage: Usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, calls: 0 };
  const tools: ToolCall[] = [];
  const allowed = figuresIn(context);
  // The member's own words, and Ian's earlier answers: those figures passed this guard when said.
  for (const l of lines) figuresIn(l.text, allowed);
  const call = async () => {
    const res = await callModel(payload);
    usage.calls++;
    usage.input += res.usage?.input_tokens || 0;
    usage.cacheWrite += res.usage?.cache_creation_input_tokens || 0;
    usage.cacheRead += res.usage?.cache_read_input_tokens || 0;
    usage.output += res.usage?.output_tokens || 0;
    return res;
  };
  const textOf = (res: any) => (res.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();

  let reply = '';
  let guarded = false;
  try {
  for (let round = 0; ; round++) {
    if (round >= LIMITS.rounds) { reply = 'I looked at too much at once to answer that well. Ask me something narrower?'; break; }
    const res = await call();
    if (res.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: res.content });
      const results = [];
      for (const b of res.content.filter((x: any) => x.type === 'tool_use')) {
        const t0 = Date.now();
        let out: unknown;
        try { out = await runTool(b.name, b.input, ctx); }
        catch (e) { out = { error: `That read failed: ${(e as Error).message}` }; }
        const text = JSON.stringify(out);
        figuresIn(text, allowed);
        tools.push({ name: b.name, input: b.input, result_sha: await sha(out), ms: Date.now() - t0, ...((out as any)?.error ? { error: (out as any).error } : {}) });
        results.push({ type: 'tool_result', tool_use_id: b.id, content: text });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }
    reply = textOf(res);
    const stray = strayFigures(reply, allowed);
    if (!stray.length) break;
    if (guarded) { reply = stripStray(reply, allowed); tools.push({ name: '(number guard)', input: { stripped: stray }, result_sha: '', ms: 0 }); break; }
    // Once: say which figures came from nowhere and let it answer again.
    guarded = true;
    tools.push({ name: '(number guard)', input: { reprompted: stray }, result_sha: '', ms: 0 });
    messages.push({ role: 'assistant', content: res.content });
    messages.push({ role: 'user', content: `Check: ${stray.map(n => n.toLocaleString('en-US')).join(', ')} appear in no tool result. Write your whole answer again without those figures, saying you do not know them where it matters. Keep everything else that answers the question.` });
  }
  } catch (e) {
    // What was spent before the failure is still spent: it goes in the log and counts to the ceiling.
    return { reply: '', cards: [], usage, tools, cost: costUsd(model, usage), error: (e as Error).message };
  }
  return { reply, cards: ctx.cards, usage, tools, cost: costUsd(model, usage), error: null as string | null };
}
