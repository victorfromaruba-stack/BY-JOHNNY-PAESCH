// Can the watcher tell a real session from an anonymous one? No network, no credentials.
//
// This exists because two earlier versions of that check were wrong in the same direction —
// both called a refused login a success — and the cost of that mistake is months of hourly
// runs reporting "nothing free in Aruba", which looks exactly like bad luck.
//
// Run: node session.test.mjs
import http from 'node:http';
import { Interval, readsAsSignedIn, hiddenFields, fieldLimits } from './interval.mjs';

const MEMBERS = `<html><body><h1>Getaways</h1>
  <a href="/web/my/auth/logout">Sign Out</a><div class="unit">members only</div></body></html>`;
// What Interval really serves an anonymous caller: the same URL, 200, public version.
const ANON = `<html><body><h1>Getaways</h1>
  <a href="/web/my/auth/loginPage">Sign In</a></body></html>`;
const LOGIN_FORM = `<html><body><form action="/web/my/auth/login" method="post">
  <input type="hidden" name="_csrf" value="tok-abc-123">
  <input name="j_username"><input type="password" name="j_password"></form>
  <a href="/web/my/auth/loginPage">Sign In</a></body></html>`;

/** A stub Spring app. `accepts` decides whether the password works at all. */
function stub({ cookiesOnLogin, accepts = true, redirectTo = '/web/cs?a=1000', good = 'auth2' }) {
  return http.createServer((req, res) => {
    const jar = Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean)
      .map(p => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
    if (req.url.startsWith('/web/my/auth/loginPage')) {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'JSESSIONID=anon1; Path=/; HttpOnly' });
      return res.end(LOGIN_FORM);
    }
    if (req.url.startsWith('/web/my/auth/login')) {
      // The real site 302s to the same place whether or not the password was right.
      res.writeHead(302, { location: redirectTo, 'set-cookie': accepts ? cookiesOnLogin : ['JSESSIONID=anon1; Path=/'] });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(jar.JSESSIONID === good ? MEMBERS : ANON);
  });
}

const listen = (s) => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));
let failures = 0;
const ok = (cond, msg) => { if (!cond) failures++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); };

// --- the page reader, on its own ---------------------------------------------------------
ok(readsAsSignedIn(MEMBERS) === true, 'a members page reads as signed in');
ok(readsAsSignedIn(ANON) === false, 'the public version of the same page reads as NOT signed in');
ok(readsAsSignedIn('<html><body>nothing either way</body></html>') === null, 'a page with neither affordance says so rather than guessing');
ok(readsAsSignedIn('<script>var x = "Sign In"</script><a href="/logout">Sign Out</a>') === true,
   'a mention inside a script does not count as a way in');

// --- reading the login form ---------------------------------------------------------------
{
  // A real login page: a site-search form first, the login form second, each with hidden
  // fields, and the search form using the same field name as the login form's token.
  const page = `<html><body>
    <form action="/search"><input type="hidden" name="_csrf" value="SEARCH-TOKEN">
      <input type="hidden" name="scope" value="site"><input name="q"></form>
    <form action="/web/my/auth/login" method="post">
      <input type="hidden" name="_csrf" value="LOGIN&amp;TOKEN&#43;1">
      <input type=hidden name=nonce value=unquoted-is-legal-html>
      <input name="j_username"><input type="password" name="j_password"></form>
    <form action="/newsletter"><input type="hidden" name="_csrf" value="NEWS-TOKEN"></form>
  </body></html>`;
  const f = hiddenFields(page);
  ok(f._csrf === 'LOGIN&TOKEN+1', `the token comes from the LOGIN form, decoded (got ${JSON.stringify(f._csrf)})`);
  ok(f.nonce === 'unquoted-is-legal-html', 'an unquoted attribute value is read');
  ok(!('scope' in f), 'fields from the search form are not posted to the login endpoint');
  ok(Object.keys(f).length === 2, `only the login form's own hidden fields are sent (got ${Object.keys(f).join(', ')})`);
}
ok(Object.keys(hiddenFields('<html><body>no forms here</body></html>')).length === 0,
   'a page with no form yields no fields rather than throwing');

// The real form's shape, copied from the live page: no CSRF token, and short boxes.
{
  const real = `<form name='loginForm' action="/web/my/auth/login" method='POST'>
    <input name="j_username" type="text" size="16" maxlength="33" class="inputField">
    <input name="j_password" type="password" size="16" maxlength="14" class="inputField">
    <input id="rememberMe" name="_spring_security_remember_me" type="checkbox" checked="checked"/>
    <input type="hidden" name="" value=""/></form>`;
  const lim = fieldLimits(real);
  ok(lim.j_password === 14 && lim.j_username === 33, `the form's own limits are read (${JSON.stringify(lim)})`);
  ok(Object.keys(hiddenFields(real)).length === 0, 'the nameless hidden input is not posted back as a field');
}

// --- the client, against a stub that behaves like the real site ---------------------------
// The `expect` column is what a BROWSER would end up with, because matching a browser is the
// whole job. Where a response contradicts itself — setting a cookie and then clearing it — a
// browser applies both in order and ends up cleared, so the honest answer is "not signed in".
// What matters in those rows is not that the session survives but that the client SAYS it did
// not, instead of reporting success and then quietly reading anonymous pages for months.
const CASES = [
  { name: 'the password is accepted', accepts: true, expect: true,
    cookies: ['JSESSIONID=auth2; Path=/; HttpOnly'] },
  { name: 'the password is REFUSED but the site still 302s to a normal page', accepts: false, expect: false,
    cookies: ['JSESSIONID=auth2; Path=/; HttpOnly'] },
  { name: 'session fixation done the polite way: cleared, then the new one set', accepts: true, expect: true,
    cookies: ['JSESSIONID=; Path=/; Max-Age=0', 'JSESSIONID=auth2; Path=/; HttpOnly'] },
  { name: 'a response that sets a session and then clears it, as a browser would read it', accepts: true, expect: false,
    cookies: ['JSESSIONID=auth2; Path=/; HttpOnly', 'JSESSIONID=; Path=/; Max-Age=0'] },
  { name: 'an expired duplicate arriving last also clears it, as in a browser', accepts: true, expect: false,
    cookies: ['JSESSIONID=auth2; Path=/; HttpOnly', 'JSESSIONID=dead; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'] },
];

for (const c of CASES) {
  const s = stub({ cookiesOnLogin: c.cookies, accepts: c.accepts });
  const port = await listen(s);
  const base = `http://127.0.0.1:${port}`;
  const realFetch = globalThis.fetch;
  const iv = new Interval({ username: 'u', password: 'p' });
  iv.fetch = (url, opts) => realFetch(String(url).replace('https://www.intervalworld.com', base), opts);
  const r = await iv.attemptSignIn();
  ok(r.ok === c.expect, `${c.name} -> reports ${r.ok ? 'signed in' : 'not signed in'}`);
  // Whatever the verdict, the trace must be readable and must never carry a cookie value.
  ok(iv.trace.length > 0 && iv.trace.every(t => typeof t.status === 'number'), `   ${c.name}: every hop is recorded`);
  ok(!JSON.stringify(iv.trace).includes('auth2'), `   ${c.name}: no cookie value is written down`);
  s.close();
}

// A cleared cookie must be removed, not stored as an empty string.
{
  const s = stub({ cookiesOnLogin: ['JSESSIONID=; Path=/; Max-Age=0'], accepts: true });
  const port = await listen(s);
  const realFetch = globalThis.fetch;
  const iv = new Interval({ username: 'u', password: 'p' });
  iv.fetch = (url, opts) => realFetch(String(url).replace('https://www.intervalworld.com', `http://127.0.0.1:${port}`), opts);
  await iv.attemptSignIn();
  ok(!iv.jar.header().includes('JSESSIONID='), 'a cleared cookie is dropped, not sent back as an empty value');
  s.close();
}

console.log(`\n${failures ? `${failures} failing` : 'all good'}`);
process.exit(failures ? 1 : 0);
