// Ian, the Circle's concierge: the member asks, Ian reads the board and the places as that member
// and answers, and anything it suggests doing comes back as a card the member taps.
//
// Why a function: the app's CSP lets the browser reach Supabase and nothing else, and the
// Anthropic key has to live somewhere a browser never sees. Same shape as gev-pass: the caller's
// token decides who they are, and every read runs under row-level security as them.
//
// Deploy:  supabase functions deploy concierge   (see DEPLOY.md: learnings.md must go with it)
// Secret:  supabase secrets set ANTHROPIC_API_KEY=...
// Until the key is set it answers 503 and the app says Ian is not switched on yet.
//
// Every turn: concierge_allow() first (club ceiling, 40 a day each, one at a time), then the
// model, then log_concierge_turn() with the tokens, the cost, every tool call and the answer,
// including when it failed. { dryRun: true } returns the exact payload and calls nothing.

import { createClient } from 'npm:@supabase/supabase-js@2.115.0';
import { anthropic, LIMITS, MODELS, turn, type Line } from './ian.ts';
import { dataFor } from './tools.ts';

const CORS = {
  'access-control-allow-origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

function publicKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}');
    const first = keys.default ?? Object.values(keys)[0];
    if (typeof first === 'string' && first) return first;
  } catch { /* not set, or not JSON */ }
  return Deno.env.get('SUPABASE_ANON_KEY') ?? '';
}

const REFUSED: Record<string, string> = {
  ceiling: 'Ian is resting until tomorrow.',
  member_day: 'You have asked Ian a lot today. Ian is back tomorrow.',
  too_fast: 'One at a time. Ask again in a few seconds.',
};

/** The conversation as the phone sends it, cut to size. The last line must be the member's. */
function linesFrom(body: any): Line[] | null {
  const raw = Array.isArray(body?.messages) ? body.messages : null;
  if (!raw?.length) return null;
  const lines = raw.slice(-LIMITS.lines)
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.text === 'string' && m.text.trim())
    .map((m: any) => ({ role: m.role, text: m.text.trim().slice(0, m.role === 'user' ? LIMITS.inputChars : 4000) }));
  while (lines.length && lines[0].role !== 'user') lines.shift();           // the API starts with the member
  return lines.length && lines.at(-1)!.role === 'user' ? lines : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);

  // Two clients, as in gev-pass: the one that checks the token carries no headers of its own.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const url = Deno.env.get('SUPABASE_URL')!;
  const noSession = { persistSession: false, autoRefreshToken: false };
  const { data: { user } } = await createClient(url, publicKey(), { auth: noSession }).auth.getUser(token);
  if (!user) return json({ error: 'Sign in first.' }, 401);
  const sb = createClient(url, publicKey(), { global: { headers: { Authorization: `Bearer ${token}` } }, auth: noSession });
  const { data: member } = await sb.from('members').select('id, name, monthly_usd, status').eq('auth_user_id', user.id).maybeSingle();
  if (!member) return json({ error: 'You are not an Insider.' }, 403);
  if (member.status !== 'active') return json({ error: 'Ian is for active Insiders.' }, 403);

  const body = await req.json().catch(() => null);
  const lines = linesFrom(body);
  if (!lines) return json({ error: 'Say something first.' }, 400);
  const stayId = typeof body?.stay === 'string' ? body.stay : null;
  const data = dataFor(sb, member);

  if (body?.dryRun) {
    const s = await data.settings();
    return json(await turn({ lines, stayId, data, model: s.model, dryRun: true }));
  }

  const key = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!key) return json({ error: 'Ian is not switched on yet.' }, 503);

  const { data: allow, error: allowErr } = await sb.rpc('concierge_allow');
  if (allowErr) return json({ error: 'Ian is not switched on yet.' }, 503);
  if (!allow?.ok) return json({ error: REFUSED[allow?.why] || 'Ian cannot answer right now.', why: allow?.why }, 429);
  const model = MODELS.includes(allow.model) ? allow.model : MODELS[0];

  const out: any = await turn({ lines, stayId, data, model, callModel: anthropic(key) }).catch((e) => ({ error: (e as Error).message }));
  const failure = out?.error || '';

  const u = out?.usage || { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const { error: logErr } = await sb.rpc('log_concierge_turn', {
    p_id: allow.turn_id, p_model: model,
    p_input: u.input, p_cached: u.cacheRead, p_cache_write: u.cacheWrite, p_output: u.output,
    p_cost: out?.cost ?? 0,
    p_prompt: lines.at(-1)!.text, p_reply: out?.reply ?? null,
    p_tools: out?.tools ?? [], p_ok: !failure, p_error: failure || null,
  });
  if (logErr) console.error('concierge: the turn could not be logged', logErr.message);

  if (failure) { console.error('concierge:', failure); return json({ error: 'Ian could not answer just now. Try again in a minute.' }, 502); }
  return json({ reply: out.reply, cards: out.cards, turn_id: allow.turn_id });
});
