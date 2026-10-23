// One tap, no sign-in: the "stop these e-mails" link at the foot of a watch e-mail.
//   GET /functions/v1/watch-unsub?t=<memberId>.<hmac>   switches off e-mail on every watch of that member.
// The token is an HMAC of the member id under WATCH_MAIL_KEY (the same key the scout signs with, watcher/watch-token.mjs).
// It can switch e-mail OFF and nothing else; the member turns it back on under What you are watching.
// Answered as plain text: Supabase serves a function's HTML as text/plain anyway.

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function sign(id: string, key: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(`watch-unsub:${id}`))).slice(0, 40);
}
const same = (a: string, b: string) => a.length === b.length && [...a].reduce((n, c, i) => n | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;
const say = (text: string, status = 200) => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

Deno.serve(async (req) => {
  const key = Deno.env.get('WATCH_MAIL_KEY'), url = Deno.env.get('SUPABASE_URL'), svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key || !url || !svc) return say('This link is not switched on yet.', 503);
  const t = new URL(req.url).searchParams.get('t') || '';
  const [id, mac] = t.split('.');
  if (!/^[0-9a-f-]{36}$/.test(id || '') || !mac || !same(mac, await sign(id, key))) return say('That link is not valid. Open the Circle and go to What you are watching to change your e-mails.', 400);
  const r = await fetch(`${url}/rest/v1/watches?member_id=eq.${id}&active=eq.true`, {
    method: 'PATCH', headers: { apikey: svc, authorization: `Bearer ${svc}`, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify({ email_me: false }),
  });
  if (!r.ok) return say('That did not go through. Open the Circle, go to What you are watching, and switch the e-mails off there.', 502);
  return say('Done. The Circle will not e-mail you about your watches any more. You can turn it back on under What you are watching.');
});
