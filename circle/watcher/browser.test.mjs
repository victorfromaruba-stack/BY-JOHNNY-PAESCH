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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IntervalBrowser, splitProxy, loadPlaywright, playwrightCandidates, installedEngines } from './interval-browser.mjs';
import { loadEnv } from './dotenv.mjs';

// The same .env the service reads, so WATCH_BROWSER here is the browser the watcher uses.
loadEnv(join(dirname(fileURLToPath(import.meta.url)), '.env'));

let failures = 0;
const ok = (cond, msg) => { if (!cond) failures++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); };

// The same loader the watcher uses, so this suite runs wherever the watcher can — and says
// where it looked when it cannot, rather than skipping in silence.
let pw;
try { pw = await loadPlaywright(); }
catch (err) { console.log(`skipped — ${err.message}`); process.exit(0); }

// Run with the configured engine when it is downloaded, with whatever is downloaded when it is
// not, and say so. On a box with only Firefox a default of chromium used to crash this suite
// in launch() rather than test anything; with nothing downloaded it says what to install.
const have = installedEngines(pw);
const want = process.env.WATCH_BROWSER || 'chromium';
if (!have.length) { console.log(`skipped — Playwright is here but no browser is downloaded: npx playwright install ${want}`); process.exit(0); }
const ENGINE = have.includes(want) ? want : have[0];
console.log(`browser: ${ENGINE}${ENGINE === want ? '' : ` (WATCH_BROWSER=${want} is not downloaded here; ${have.join(', ')} ${have.length === 1 ? 'is' : 'are'})`}`);

// The candidate list itself, without a browser: the running node's own global root comes
// before the fixed system paths, and an explicit PLAYWRIGHT_MODULE comes first of all.
{
  const c = playwrightCandidates({}, '/opt/node22/bin/node');
  ok(c[0] === 'playwright' && c[1] === '/opt/node22/lib/node_modules/playwright/index.mjs', `the running node's global root is second, after the bare import (${c[1]})`);
  const nvm = playwrightCandidates({}, '/root/.nvm/versions/node/v22.9.0/bin/node');
  ok(nvm[1] === '/root/.nvm/versions/node/v22.9.0/lib/node_modules/playwright/index.mjs', 'an nvm node resolves to its own lib/node_modules');
  const set = playwrightCandidates({ PLAYWRIGHT_MODULE: '/x/playwright/index.mjs' }, '/usr/bin/node');
  ok(set[0] === '/x/playwright/index.mjs' && set.includes('/usr/lib/node_modules/playwright/index.mjs'), 'PLAYWRIGHT_MODULE goes first and the distro path is still tried');
}

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
    // With a cookie-consent panel laid over the whole page, exactly as the real site does.
    // Nothing under it is clickable until it is dealt with — which is the point.
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<html><body>
      <div id="cookie-consent-banner" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999">
        <p>We use cookies. This site needs your consent.</p>
        <button id="onetrust-accept-btn-handler"
                onclick="document.getElementById('cookie-consent-banner').remove()">Accept All</button>
      </div>
      <form name="loginForm" action="/web/my/auth/login" method="POST" onsubmit="return true">
      <input name="j_username" type="text" maxlength="33">
      <input name="j_password" type="password" maxlength="14">
      <input name="_spring_security_remember_me" type="checkbox" checked>
      <input type="submit" value="Sign In"></form>
      <a href="/web/my/auth/loginPage">Sign In</a>
      <script>
        // CSRFGuard's shape: the token is not in the served HTML, a script adds it afterwards.
        setTimeout(function () {
          var f = document.forms.loginForm, i = document.createElement('input');
          i.type = 'hidden'; i.name = 'OWASP_CSRFTOKEN'; i.value = '2YPD-Q7M1-STUB';
          f.appendChild(i);
        }, 250);
      </script></body></html>`);
  }
  // The same login page, but with a banner that has no accept button at all — the form has to
  // be submitted directly, or nothing happens.
  if (req.url.includes('/stubborn-banner')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<html><body>
      <div style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999">
        <p>Cookies. No way to dismiss this.</p></div>
      <form name="loginForm" action="/web/my/auth/login" method="POST">
      <input name="j_username"><input name="j_password" type="password">
      <input type="submit" value="Sign In"></form></body></html>`);
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
const iv = new IntervalBrowser({ username: 'victor', password: 'shortpw', origin: `http://127.0.0.1:${wwwPort}`, browser: ENGINE });
const r = await iv.attemptSignIn();

ok(r.limits.j_password === 14 && r.limits.j_username === 33,
   `the browser reads the form's own limits (${JSON.stringify(r.limits)})`);
ok(r.consent === '#onetrust-accept-btn-handler',
   `the cookie-consent panel covering the form was dismissed (${r.consent})`);
ok(r.csrf === true, 'it waited for CSRFGuard to inject OWASP_CSRFTOKEN before submitting');
ok(/clicked/.test(r.submitted || ''), `and the form was then actually submitted (${r.submitted})`);
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

// An ordinary outbound proxy, for a network that requires one. Not a way to change where the
// traffic appears to come from — there is no setting for that, deliberately.
{
  const p = splitProxy('http://user:p%40ss@res.example.net:8080', '<-loopback>');
  ok(p.server === 'http://res.example.net:8080', `credentials are split off the server (${p.server})`);
  ok(p.username === 'user' && p.password === 'p@ss', 'and decoded, so a password with @ in it survives');
  ok(splitProxy('http://res.example.net:8080').password === undefined, 'a proxy with no credentials has none');
  ok(splitProxy('') === null && splitProxy('not a url') === null, 'nothing and nonsense both mean no proxy');
}

// A page where CSRFGuard's script never runs: the token never appears and it must say so
// rather than submitting anyway into a silent drop.
{
  const page = await iv.open();
  await page.setContent('<form name="loginForm"><input name="j_password" type="password"></form>');
  ok(await iv.csrfToken(page, { waitMs: 600 }) === false,
     'a page with no CSRFGuard token reports MISSING rather than assuming one');
}

// A banner with nothing to accept: the click cannot land, so the form itself has to be asked.
{
  const page = await iv.open();
  await page.goto(`http://127.0.0.1:${wwwPort}/stubborn-banner`, { waitUntil: 'domcontentloaded' });
  ok(await iv.dismissConsent(page) === null, 'a banner with no accept button is correctly not dismissed');
  await page.fill('input[name="j_username"]', 'victor');
  await page.fill('input[name="j_password"]', 'shortpw');
  const how = await iv.submitLogin(page);
  ok(/asked the form/.test(how), `so the form was submitted directly instead (${how})`);
  ok(!page.url().includes('/stubborn-banner'), `and the page moved (${page.url()})`);
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
