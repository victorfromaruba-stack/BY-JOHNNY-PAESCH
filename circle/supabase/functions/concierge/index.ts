// Ian, the Circle's concierge: the member asks, Ian reads the board and the places as that member
// and answers, and anything it suggests doing comes back as a card the member taps.
//
// Why a function: the app's CSP lets the browser reach Supabase and nothing else, and the
// Anthropic key has to live somewhere a browser never sees. Same shape as gev-pass: the caller's
// token decides who they are, and every read runs under row-level security as them.
//
// Deploy:  supabase functions deploy concierge   (see DEPLOY.md: learnings.md must go with it)
// Secrets: ANTHROPIC_API_KEY, and CONCIERGE_LOG_KEY (the same value as the concierge_key row; see DEPLOY.md).
// Until both are set it answers 503 and the app says Ian is not switched on yet.
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

async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))].map(b => b.toString(16).padStart(2, '0')).join('');
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
  const { data: member } = await sb.from('members').select('id, name, monthly_usd, status, roles').eq('auth_user_id', user.id).maybeSingle();
  if (!member) return json({ error: 'You are not an Insider.' }, 403);
  if (member.status !== 'active') return json({ error: 'Ian is for active Insiders.' }, 403);

  const body = await req.json().catch(() => null);
  const lines = linesFrom(body);
  if (!lines) return json({ error: 'Say something first.' }, 400);
  const stayId = typeof body?.stay === 'string' ? body.stay : null;
  const data = dataFor(sb, member);

  // The exact payload, for the Desk only: it carries the whole prompt and the learnings.
  if (body?.dryRun) {
    if (!(member.roles || []).includes('admin')) return json({ error: 'The dry run is for the Desk.' }, 403);
    const s = await data.settings();
    return json(await turn({ lines, stayId, data, model: s.model, dryRun: true }));
  }

  const key = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  const logKey = Deno.env.get('CONCIERGE_LOG_KEY') ?? '';
  if (!key || logKey.length < 32) return json({ error: 'Ian is not switched on yet.' }, 503);

  const { data: allow, error: allowErr } = await sb.rpc('concierge_allow');
  if (allowErr) return json({ error: 'Ian is not switched on yet.' }, 503);
  if (!allow?.ok) return json({ error: REFUSED[allow?.why] || 'Ian cannot answer right now.', why: allow?.why }, 429);
  const model = MODELS.includes(allow.model) ? allow.model : MODELS[0];

  const out: any = await turn({ lines, stayId, data, model, callModel: anthropic(key) }).catch((e) => ({ error: (e as Error).message }));
  const failure = out?.error || '';
  // A turn that produced neither words nor a card is a failure the member should not have to rate.
  const empty = !failure && !out.reply && !out.cards?.length;

  const u = out?.usage || { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const sig = await hmac(logKey, allow.turn_id);
  const noNul = (x: unknown) => (typeof x === 'string' ? x.replace(/\u0000/g, '') : x ?? null);   // Postgres refuses NUL in text
  const row = {
    p_id: allow.turn_id, p_sig: sig, p_model: model,
    p_input: u.input, p_cached: u.cacheRead, p_cache_write: u.cacheWrite, p_output: u.output,
    p_cost: out?.cost ?? 0,
    p_prompt: noNul(lines.at(-1)!.text), p_reply: noNul(out?.reply),
    p_tools: out?.tools ?? [], p_ok: !failure && !empty, p_error: failure || (empty ? 'empty answer' : null),
  };
  let { error: logErr } = await sb.rpc('log_concierge_turn', row);
  // Whatever went wrong with the words, the cost must still count toward the ceiling.
  if (logErr) ({ error: logErr } = await sb.rpc('log_concierge_turn', { ...row, p_prompt: null, p_reply: null, p_tools: [], p_ok: false, p_error: `logged without words: ${logErr.message}`.slice(0, 500) }));
  if (logErr) console.error('concierge: the turn could not be logged', logErr.message);

  if (failure) { console.error('concierge:', failure); return json({ error: 'Ian could not answer just now. Try again in a minute.' }, 502); }
  if (empty) return json({ reply: 'I could not put an answer together that time. Ask me again, perhaps a little differently.', cards: [] });
  return json({ reply: out.reply, cards: out.cards, turn_id: allow.turn_id });
});
