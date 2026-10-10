// Hands a signed-in, active Insider a pass into God's Eye View.
//
// God's Eye View (a live 3D globe of planes, ships, satellites and cameras) runs on Victor's
// hq server and is on the public internet, but behind a door: ai-hq's gods-eye/gate.mjs.
// The door lets a browser in when it brings a pass this function signed. A pass is good for
// two minutes and one use; the door then gives that browser a cookie for 14 days.
//
// Why a function and not a link: the link would sit in this public repository and anyone could
// use it. The secret that signs passes lives here and on hq, nowhere else.
//
// Deploy:  supabase functions deploy gev-pass
// Secrets: supabase secrets set GEV_GATE_SECRET=<the value in /etc/ai-hq/gods-eye.env on hq> \
//            GEV_URL=https://hq.<tailnet>.ts.net:10000
// Until both are set, it answers 503 and the app says God's Eye View is not switched on yet.
//
// The token format is the door's contract, so it is written out here and in gate.mjs:
//   base64url(JSON {m: member id, exp: unix seconds, n: nonce}) + "." +
//   base64url(HMAC-SHA256(secret, "pass." + that first part))

import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

const CORS = {
  'access-control-allow-origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const PASS_SECONDS = 120;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);

  const secret = Deno.env.get('GEV_GATE_SECRET') ?? '';
  const base = (Deno.env.get('GEV_URL') ?? '').replace(/\/+$/, '');
  if (secret.length < 32 || !base.startsWith('https://')) {
    return json({ error: 'God’s Eye View is not switched on yet.' }, 503);
  }

  // The caller is the member: their own token decides who this pass is for.
  const auth = req.headers.get('authorization') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { authorization: auth } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: 'Sign in first.' }, 401);
  const { data: member } = await sb.from('members').select('id, status').eq('auth_user_id', user.id).maybeSingle();
  if (!member) return json({ error: 'You are not an Insider.' }, 403);
  if (member.status !== 'active') return json({ error: 'God’s Eye View is for active Insiders.' }, 403);

  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const body = b64url(new TextEncoder().encode(JSON.stringify({
    m: member.id,
    exp: Math.floor(Date.now() / 1000) + PASS_SECONDS,
    n: b64url(nonce),
  })));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`pass.${body}`))));

  return json({ url: `${base}/__gate?t=${body}.${sig}` });
});
