// The browser-driven Interval client, against a stub that behaves the way Interval does.
//
// What this proves without any credentials and without touching Interval: the browser fills
// the real form's fields, submits it, FOLLOWS THE JAVASCRIPT REDIRECT on its own (the thing a
// fetch client cannot do), carries the session the browser way, and judges the result by a
// page behind the login rather than by the URL it landed on.
//
// What it cannot prove is the Radware challenge, which only the real site issues. That is why
// the first real run still has to happen on Victor's VPS.
//
// Run: node browser.test.mjs        (skips itself if Playwright is not installed)
import http from 'node:http';
import { IntervalBrowser } from './interval-browser.mjs';

let failures = 0;
const ok = (cond, msg) => { if (!cond) failures++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); };

try { await import('/opt/node22/lib/node_modules/playwright/index.mjs'); }
catch { console.log('skipped — Playwright is not installed here'); process.exit(0); }

const MEMBERS = `<html><head><title>VIP Gold</title></head><body>
  <a href="/web/my/auth/logout">Sign Out</a><div class="unit">Aruba weeks</div></body></html>`;
const ANON = `<html><head><title>Interval</title></head><body>
  <a href="/web/my/auth/loginPage">Sign In</a></body></html>`;

// The second "host". A browser follows a script redirect here on its own.
let vipPort = 0;
const vip = http.createServer((req, res) => {
  const jar = Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean)
    .map(p => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
  // The VIP host mints its own session the first time it is visited with a handoff token,
  // which is the part a plain fetch client could never reach — it never got here.
  if (req.url.includes('/web/cs') && jar.handoff === 'yes') {
    res.writeHead(302, { location: '/web/my/home', 'set-cookie': 'VIPSESSION=good; Path=/' });
    return res.end();
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(jar.VIPSESSION === 'good' ? MEMBERS : ANON);
});
vipPort = await new Promise(r => vip.listen(0, '127.0.0.1', () => r(vip.address().port)));

const www = http.createServer((req, res) => {
  if (req.url.includes('/auth/loginPage')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<html><body><form name="loginForm" action="/web/my/auth/login" method="POST">
      <input name="j_username" type="text" maxlength="33">
      <input name="j_password" type="password" maxlength="14">
      <input name="_spring_security_remember_me" type="checkbox" checked>
      <input type="submit" value="Sign In"></form>
      <a href="/web/my/auth/loginPage">Sign In</a></body></html>`);
  }
  if (req.url.includes('/auth/login')) {
    // The real shape, found on the VPS: a CORRECT password lands on a "Please wait…" holding
    // page, not on the account. This one moves only when its Continue is pressed, which is the
    // harder of the two cases — navigating away instead leaves the session signed out, and
    // that is indistinguishable from a refused password.
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'handoff=yes; Path=/' });
    return res.end(`<html><head><title>Please wait...</title></head><body>
      <p>Please wait while we verify your browser.</p>
      <button onclick="window.location.replace('http://127.0.0.1:${vipPort}/web/cs?a=0')">Continue</button>
      </body></html>`);
  }
  // The commoner shape: a holding page that moves on by itself.
  if (req.url.includes('/waits-then-goes')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<html><head><title>Please wait...</title></head><body><p>One moment.</p>
      <script>setTimeout(function(){ location.replace('/web/my/home'); }, 500);</script></body></html>`);
  }
  // And the one that must never hang the pass: it waits forever and offers nothing to press.
  if (req.url.includes('/waits-forever')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<html><head><title>Please wait...</title></head><body><p>Just a moment.</p></body></html>`);
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(ANON);
});
const wwwPort = await new Promise(r => www.listen(0, '127.0.0.1', () => r(www.address().port)));

// Point the client at the stub. Only the front door moves; everything else is the real class,
// exercised the way the VPS will exercise it.
const iv = new IntervalBrowser({ username: 'victor', password: 'shortpw', origin: `http://127.0.0.1:${wwwPort}` });
const r = await iv.attemptSignIn();

ok(r.limits.j_password === 14 && r.limits.j_username === 33,
   `the browser reads the form's own limits (${JSON.stringify(r.limits)})`);
ok(r.interstitial === true, 'the "Please wait…" holding page was recognised');
ok(r.interstitialCleared === true, 'and it was cleared by pressing Continue rather than navigated away from');
ok(r.landedOn.includes(String(vipPort)),
   `the browser came out the other side, on the other host (${r.landedOn})`);
ok(r.ok === true, 'and reports signed in, judged by a page behind the login');
ok(r.probeSays === true, 'the probe page is the one that decided it, not the URL');

const all = Object.values(await iv.cookieNames()).flat();
ok(all.includes('VIPSESSION'), `the second host's own session was minted (${all.join(', ')})`);

// Refusing to be walked off Interval, the same guard the fetch client has.
ok(iv.allows('vip.intervalworld.com') && !iv.allows('evil.example'),
   'it will not be sent to a host that is neither Interval nor the configured origin');

// And the dump reads as the answer rather than the start of another guess.
const out = await iv.dump(['/web/my/info/benefits/getaways']);
const note = out['02-what-happened'];
ok(/signed in:\s+true/.test(note), 'the dump records that it got in');
ok(/Radware bot-manager cookies:/.test(note), 'and says whether the bot-manager challenge ran');
ok(/anonymous fetch|NOT signed in/.test(note), 'and carries the anonymous control to compare against');
ok(!JSON.stringify(out).includes('shortpw'), 'the password appears in none of the dumped files');

// The other two shapes of holding page.
{
  const page = await iv.open();
  await page.goto(`http://127.0.0.1:${wwwPort}/waits-then-goes`, { waitUntil: 'domcontentloaded' });
  ok(await iv.isWaitingRoom(page) === true, 'a self-moving holding page is recognised as one');
  ok(await iv.throughInterstitial(page) === true, 'and waiting is enough — no button needed');
  ok(page.url().includes('/web/my/home'), `it ends up on the real page (${page.url()})`);

  await page.goto(`http://127.0.0.1:${wwwPort}/waits-forever`, { waitUntil: 'domcontentloaded' });
  const started = process.hrtime.bigint();
  const cleared = await iv.throughInterstitial(page, { rounds: 2, patienceMs: 700 });
  const tookMs = Number(process.hrtime.bigint() - started) / 1e6;
  ok(cleared === false, 'a page that never moves and offers nothing is reported as NOT cleared');
  ok(tookMs < 5000, `and it gives up rather than hanging the pass (${Math.round(tookMs)}ms)`);
}

// A real page that merely contains the words is not a holding page.
{
  const page = await iv.open();
  await page.setContent(`<html><head><title>Getaways</title></head><body>
    <a href="/logout">Sign Out</a>
    <p>Please wait for confirmation from the resort before booking flights. ${'Lorem ipsum. '.repeat(40)}</p>
    </body></html>`);
  ok(await iv.isWaitingRoom(page) === false, 'a real page that happens to say "please wait" is not mistaken for one');
}

await iv.close(); www.close(); vip.close();
console.log(`\n${failures ? `${failures} failing` : 'all good'}`);
process.exit(failures ? 1 : 0);
