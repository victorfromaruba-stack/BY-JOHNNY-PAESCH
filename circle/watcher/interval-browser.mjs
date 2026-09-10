// Interval International, driven by a real browser.
//
// The plain-fetch client in interval.mjs cannot sign in to Interval, and that is not a bug in
// it — it is what Interval is. Four things, each read off the live site rather than guessed:
//
//   1. The login answer carries no Location header. It carries a script:
//        window.location.replace("https://vip.intervalworld.com/web/cs?a=0")
//      A browser runs it. fetch() does not.
//
//   2. JSESSIONID is set host-only with path=/web, separately on www and on vip. So the
//      session established at the front door is NOT the session the VIP host wants; something
//      has to establish one there, and that something runs in the page.
//
//   3. __uzma / __uzmb / __uzmc / __uzmd / __uzme are Radware Bot Manager, minted by a
//      JavaScript challenge. A client that never runs the challenge never earns them.
//
//   4. The site runs OWASP CSRFGuard. `<script src="/web/csrf">` injects OWASP_CSRFTOKEN into
//      every form and link AFTER the page parses — it is nowhere in the served HTML. A post
//      without it is dropped silently, with the signed-out page as the answer. This one is on
//      me: I read the HTML, found no hidden token field, and wrote down that the form has no
//      CSRF token. It has one; JavaScript puts it there.
//
// That third one is no longer an inference. The same credentials were signed in by hand and
// worked, so the password was never the problem and the bot layer is what was turning the
// plain client away — politely, with a 200 and the signed-out page, rather than a 401.
//
// A correct password does not land on the account either. It lands on a "Please wait…" holding
// page while the bot layer finishes; navigating away from it too early leaves the session
// signed out, which looks exactly like a wrong password. See throughInterstitial().
//
// Three of those four need a JavaScript engine. So Interval gets a browser and RedWeek keeps
// plain fetch, which needs no login and already works.
//
// The password lives in the environment on Victor's VPS and is typed into the page. It is
// never written to the trace, the dump, or the log.

import { readsAsSignedIn } from './interval.mjs';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ORIGIN = 'https://www.intervalworld.com';
const HOSTS = /(^|\.)intervalworld\.com$/i;
const PROBE = process.env.INTERVAL_PROBE_PATH || '/web/my/home';

/**
 * Where Playwright might be, in the order worth trying.
 *
 * A global `npm install -g playwright` lands under the *running* node's prefix — `/opt/node22`
 * in the container this was written in, `~/.nvm/versions/node/…` under nvm, `/usr/local` or
 * `/usr` on a distro node — so the prefix is read off `process.execPath` rather than written
 * down. The old code had the container's path in it, which on the VPS meant Interval could not
 * launch a browser at all, and the browser suite quietly skipped itself instead of running.
 * `PLAYWRIGHT_MODULE` names the file outright when none of these fit.
 */
export function playwrightCandidates(env = process.env, execPath = process.execPath) {
  const prefix = dirname(dirname(execPath));
  return [...new Set([
    env.PLAYWRIGHT_MODULE,
    'playwright',                                              // beside the watcher, or on NODE_PATH
    join(prefix, 'lib', 'node_modules', 'playwright', 'index.mjs'),
    '/usr/local/lib/node_modules/playwright/index.mjs',
    '/usr/lib/node_modules/playwright/index.mjs',
  ].filter(Boolean))];
}

/**
 * Playwright, loaded only when it is actually needed.
 *
 * A RedWeek-only pass must not fail because a browser is not installed, and the watcher runs
 * on a small VPS where that is a real possibility. Tries each candidate, then asks npm where
 * its global root is — a spawn, so only when everything else has failed — and says which
 * places it looked when none of them had it.
 */
export async function loadPlaywright() {
  const failures = [];
  for (const where of playwrightCandidates()) {
    try { return await import(where.startsWith('/') ? pathToFileURL(where).href : where); }
    catch (err) { failures.push(`${where}: ${String(err.message).split('\n')[0]}`); }
  }
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (root) return await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);
  } catch (err) { failures.push(`npm root -g: ${String(err.message).split('\n')[0]}`); }
  const e = new Error(`Interval needs Playwright and it could not be loaded — set PLAYWRIGHT_MODULE to its index.mjs, or npm install -g playwright (tried ${failures.join(' | ')})`);
  e.needsBrowser = true;
  throw e;
}
const playwright = loadPlaywright;

/**
 * Which of Playwright's engines are actually downloaded on this machine. Playwright knows
 * where each one would be; whether it is there is a separate question, and the answer on a
 * VPS is usually "only the one somebody installed".
 */
export function installedEngines(pw) {
  return ['chromium', 'firefox', 'webkit'].filter(n => {
    try { return existsSync(pw[n].executablePath()); } catch { return false; }
  });
}

/**
 * A proxy URL as Playwright wants it: server without credentials, credentials beside it.
 *
 * This is for an ordinary outbound proxy — a network that requires one — read from HTTPS_PROXY,
 * the same variable everything else on the machine uses. Passing a whole `user:pass@host` string
 * as `server` fails, hence the split. Returns null for no proxy.
 */
// A sign-in Interval turned down, as opposed to a browser that is missing or a page that is
// unset. index.mjs paces the next attempt on this flag and on nothing else.
const refusal = (msg) => Object.assign(new Error(msg), { refused: true });

export function splitProxy(url, bypass) {
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  const out = { server: `${u.protocol}//${u.host}`, bypass };
  if (u.username) out.username = decodeURIComponent(u.username);
  if (u.password) out.password = decodeURIComponent(u.password);
  return out;
}

export class IntervalBrowser {
  constructor({ username, password, browser, headless = true, slowMo = 0, origin = ORIGIN } = {}) {
    if (!username || !password) throw new Error('Set INTERVAL_USER and INTERVAL_PASS in the environment');
    this.username = username; this.password = password;
    // Where the front door is. Only the tests move it, and they move it to a local stub —
    // Playwright will not let a route rewrite change a URL's protocol, so the seam belongs
    // here rather than in a interception hack that only half works.
    this.origin = origin;
    this.browserName = browser || process.env.WATCH_BROWSER || 'chromium';
    this.headless = headless; this.slowMo = slowMo;
    this.signedIn = false;
    this.trace = [];                      // where it went and what it held. Names, never values.
    this._browser = null; this._ctx = null; this._page = null;
  }

  async open() {
    if (this._page) return this._page;
    const pw = await playwright();
    const engine = pw[this.browserName] || pw.chromium;
    // An engine that is not downloaded fails inside launch() with a long note about a missing
    // executable. Say it first, in one line, with the command that fixes it and what is here.
    let exe = null;
    try { exe = engine.executablePath(); } catch { exe = null; }
    if (exe && !existsSync(exe)) {
      const have = installedEngines(pw);
      const e = new Error(`Playwright has no ${engine.name()} downloaded — npx playwright install ${engine.name()}`
        + (have.length ? ` (downloaded here: ${have.join(', ')} — set WATCH_BROWSER to one of those)` : ''));
      e.needsBrowser = true;
      throw e;
    }
    // Whatever proxy the machine already uses, if any. Deliberately NOT a separate setting for
    // Interval: a proxy chosen to make this traffic look like it comes from somewhere else is
    // circumventing bot management rather than using the site, and that is not a line this
    // watcher crosses. Credentials, if the network needs them, are never logged.
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    // NO_PROXY has to be passed on too, or the browser sends even localhost to the proxy.
    // Chromium's bypass list is not NO_PROXY: it does not understand CIDR blocks, and one
    // entry it cannot parse makes it discard the whole list. So the loopback is asked for by
    // name — <-loopback> is Chromium's own token for it — and only plain host patterns from
    // the environment are passed through.
    const fromEnv = (process.env.NO_PROXY || process.env.no_proxy || '')
      .split(',').map(s => s.trim())
      .filter(s => s && !s.includes('/'));          // drop CIDR blocks Chromium chokes on
    const bypass = ['<-loopback>', ...fromEnv].join(',');
    this.proxy = splitProxy(proxy, bypass);
    // What was used, for the dump — the host, never the credentials.
    this.proxyHost = this.proxy ? new URL(proxy).host.replace(/^.*@/, '') : null;
    this._browser = await engine.launch({
      headless: this.headless, slowMo: this.slowMo,
      ...(this.proxy ? { proxy: this.proxy } : {}),
    });
    this._ctx = await this._browser.newContext({
      locale: 'en-US', timezoneId: 'America/Aruba',
      viewport: { width: 1366, height: 900 },
    });
    this._ctx.setDefaultTimeout(45000);
    this._page = await this._ctx.newPage();
    // Every navigation, so a failed pass can be read afterwards. The bot-manager cookies are
    // the interesting ones: if they never appear, the challenge never ran.
    this._page.on('framenavigated', (f) => {
      if (f === this._page.mainFrame()) this.trace.push({ at: f.url() });
    });
    return this._page;
  }

  async close() {
    try { await this._ctx?.close(); } finally { await this._browser?.close(); }
    this._browser = this._ctx = this._page = null;
  }

  /**
   * May the browser be sent to this host? Interval and its subdomains, plus whatever origin
   * this instance was pointed at (which in production IS Interval, and in the tests is a
   * local stub). Everything else is refused: the session travels with the browser.
   */
  allows(hostname) {
    if (HOSTS.test(hostname)) return true;
    try { return hostname === new URL(this.origin).hostname; } catch { return false; }
  }

  /**
   * Sit through the "Please wait…" page.
   *
   * A correct password does not land on the account. It lands on an interstitial that holds the
   * browser while the bot layer finishes, and only then moves on — usually by itself, sometimes
   * only when its Continue button is pressed. Navigating away too early interrupts it, and then
   * every page after that is the signed-out one, which looks exactly like a refused password.
   *
   * So: wait for it to move on its own; if it does not, press the button; repeat a few times.
   * Bounded, because this runs unattended and a page that never settles must not hang the pass.
   */
  async throughInterstitial(page, { rounds = 4, patienceMs = 12000 } = {}) {
    for (let i = 0; i < rounds; i++) {
      if (!(await this.isWaitingRoom(page))) return true;
      const before = page.url();
      // Give it the time it asked for. Most of these move on their own.
      const moved = await page.waitForURL((u) => u.toString() !== before, { timeout: patienceMs })
        .then(() => true).catch(() => false);
      if (moved) { await page.waitForLoadState('domcontentloaded').catch(() => {}); continue; }

      // It did not. Press whatever it is offering — a link, a button, or a submit input,
      // matched on its words rather than on a selector we would have to guess at.
      const pressed = await page.evaluate(() => {
        const wanted = /continue|proceed|click here|enter|go on/i;
        const els = [...document.querySelectorAll('a,button,input[type=submit],input[type=button]')];
        const hit = els.find(el => wanted.test(el.value || el.textContent || ''));
        if (!hit) return false;
        hit.click(); return true;
      }).catch(() => false);
      if (!pressed) return false;                    // nothing to press and it will not move
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
    }
    return !(await this.isWaitingRoom(page));
  }

  /**
   * Get the cookie-consent panel out of the way.
   *
   * These are fixed-position overlays. A person clicks Accept without thinking about it; an
   * automated click on the button underneath either hits the banner instead or is refused as
   * intercepted, and either way the form is never submitted — which looks like a wrong
   * password, because everything downstream is the signed-out page.
   *
   * Known handlers first, then the words on the button. The word list is deliberately narrow
   * and does NOT include "continue": that is the interstitial's button, and pressing it here
   * would be pressing the wrong thing at the wrong time.
   */
  async dismissConsent(page) {
    const KNOWN = [
      '#onetrust-accept-btn-handler',                 // OneTrust
      '#truste-consent-button',                       // TrustArc
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',  // Cookiebot
      '.cc-allow', '.cookie-accept', '[data-testid="accept-all"]',
    ];
    for (const sel of KNOWN) {
      const hit = page.locator(sel).first();
      if (await hit.count().catch(() => 0)) {
        if (await hit.isVisible().catch(() => false)) {
          await hit.click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(250);
          return sel;
        }
      }
    }
    // Nothing known. Look for a button whose words are an acceptance, inside something that
    // says it is about cookies or privacy — so an ordinary "I agree" on a real form is safe.
    return page.evaluate(() => {
      const yes = /^\s*(accept|accept all|allow all|agree|i agree|got it|i understand|ok)\s*$/i;
      const about = /cookie|consent|privacy|gdpr/i;
      const els = [...document.querySelectorAll('button,a,input[type=button],input[type=submit]')];
      for (const el of els) {
        const words = (el.value || el.textContent || '').trim();
        if (!yes.test(words)) continue;
        const box = el.closest('[id],[class]');
        const context = `${box?.id || ''} ${box?.className || ''} ${box?.getAttribute('aria-label') || ''}`;
        if (!about.test(context) && !about.test(document.body.innerText.slice(0, 600))) continue;
        el.click();
        return words;
      }
      return null;
    }).catch(() => null);
  }

  /**
   * Submit the login form, and be sure it actually went.
   *
   * A plain click is what a person does, so it is tried first — but a click can be swallowed by
   * an overlay that is still in the way. requestSubmit() is the fallback because it goes through
   * the form's own onsubmit handler (Interval's form has `onSubmit="return submitOnce(this)"`,
   * which form.submit() would skip entirely).
   */
  async submitLogin(page) {
    const before = page.url();
    const clicked = await page.click('input[type="submit"], button[type="submit"]', { timeout: 6000 })
      .then(() => true).catch(() => false);
    const moved = await page.waitForURL((u) => u.toString() !== before, { timeout: 8000 })
      .then(() => true).catch(() => false);
    if (moved) return clicked ? 'clicked' : 'submitted';

    // It did not go. Ask the form itself.
    const asked = await page.evaluate(() => {
      const form = document.querySelector('form[name="loginForm"]')
        || document.querySelector('input[name="j_password"]')?.form;
      if (!form) return false;
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
      return true;
    }).catch(() => false);
    if (!asked) return clicked ? 'clicked, went nowhere' : 'could not submit at all';
    await page.waitForURL((u) => u.toString() !== before, { timeout: 10000 }).catch(() => {});
    return clicked ? 'clicked, then asked the form' : 'asked the form directly';
  }

  /**
   * Has CSRFGuard put its token on the form yet?
   *
   * Interval runs OWASP CSRFGuard. The login page loads `<script src="/web/csrf">`, and that
   * script injects OWASP_CSRFTOKEN into every form and link AFTER the page has parsed. It is
   * not in the served HTML at all — which is why reading the HTML and reporting "no CSRF token
   * on this form" was wrong, and why the plain client could never have signed in no matter what
   * else was fixed: it posted three fields, CSRFGuard saw no token, and dropped the
   * authentication without a word.
   *
   * A browser gets it for free, but only once that script has actually run. Worth checking
   * rather than assuming, because submitting a moment too early fails the same silent way.
   */
  async csrfToken(page, { waitMs = 8000 } = {}) {
    const found = await page.waitForFunction(() => {
      const onForm = document.querySelector('input[name="OWASP_CSRFTOKEN"]');
      if (onForm?.value) return onForm.value.length;
      // CSRFGuard also rewrites links, so a token on any href is proof the script ran.
      const onLink = [...document.querySelectorAll('a[href*="OWASP_CSRFTOKEN"]')][0];
      return onLink ? 1 : false;
    }, null, { timeout: waitMs }).then(() => true).catch(() => false);
    return found;
  }

  /** Is this the holding page rather than a real one? */
  async isWaitingRoom(page) {
    return page.evaluate(() => {
      const waiting = /please\s*wait|one\s*moment|just a moment|checking your browser|redirecting|verifying/i;
      const title = document.title || '';
      const text = (document.body?.innerText || '').slice(0, 500);
      // A real page that happens to say "please wait" somewhere is not an interstitial: these
      // are nearly empty, which is the tell worth using alongside the words.
      return waiting.test(title) || (waiting.test(text) && text.length < 400);
    }).catch(() => false);
  }

  /** Cookie names the context is holding, per host. Names only. */
  async cookieNames() {
    const all = await this._ctx.cookies();
    const byHost = {};
    for (const c of all) (byHost[c.domain] ||= []).push(c.name);
    return byHost;
  }

  /** Fetch a page as the signed-in browser and return its HTML. */
  async html(path) {
    const page = await this.open();
    // Resolve a bare path against wherever the browser currently is, so a session that has
    // moved to the VIP host keeps being asked there — the browser does that move itself.
    const target = path.startsWith('http') ? new URL(path) : new URL(path, this._page.url() || this.origin);
    if (!this.allows(target.hostname)) throw new Error(`Refusing to visit ${target.hostname} — not Interval`);
    await page.goto(target.toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* a long-polling page is fine */ });
    return page.content();
  }

  /**
   * Sign in by typing into the form, and judge the result the same way the fetch client does:
   * by what a page behind the login offers. Never by the URL — an anonymous caller reaches
   * /web/my/home too.
   */
  async attemptSignIn() {
    const page = await this.open();
    await page.goto(`${this.origin}/web/my/auth/loginPage`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    const loginPage = await page.content();

    // The real form, read off the live page: j_username, j_password, and a remember-me box.
    // maxlength="14" on the password, which a browser enforces as you type — so if what is
    // set is longer, the site literally cannot be shown it.
    const limits = await page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll('input[name]')) {
        if (el.maxLength > 0) out[el.name] = el.maxLength;
      }
      return out;
    });
    const tooLong = [
      limits.j_username && this.username.length > limits.j_username
        ? `the login ID is ${this.username.length} characters and the form accepts ${limits.j_username}` : null,
      limits.j_password && this.password.length > limits.j_password
        ? `the password is ${this.password.length} characters and the form accepts ${limits.j_password}` : null,
    ].filter(Boolean);

    // The consent panel goes first. It is a fixed overlay, and with it still up the click on
    // the submit button lands on the banner instead — the form is never submitted, and every
    // page after that is the signed-out one.
    const consent = await this.dismissConsent(page);

    // CSRFGuard adds its token with JavaScript after the page parses. Submitting before it has
    // done so fails silently — the server drops the authentication and answers with the
    // signed-out page, which by now is a very familiar disguise.
    const csrf = await this.csrfToken(page);

    await page.fill('input[name="j_username"]', this.username);
    await page.fill('input[name="j_password"]', this.password);
    const submitted = await this.submitLogin(page);
    await page.waitForLoadState('networkidle').catch(() => {});
    // Whatever came back may raise its own banner.
    await this.dismissConsent(page);
    // A right password lands on a holding page, not on the account. Sit through it before
    // reading anything — asking for a page while it is still working interrupts it, and
    // everything after that comes back signed out.
    const waited = await this.isWaitingRoom(page);
    const cleared = waited ? await this.throughInterstitial(page) : true;
    const answer = await page.content();
    const landedOn = page.url();

    // The evidence: a page behind the login, fetched as this browser.
    let probe = null, probeSays = null;
    try {
      probe = await this.html(PROBE);
      probeSays = readsAsSignedIn(probe);
    } catch { /* not reaching it is not evidence of a good session */ }

    const said = (answer.match(/class="[^"]*(?:error|alert|message)[^"]*"[^>]*>\s*([^<]{4,160})/i) || [])[1];
    this.signedIn = (probeSays ?? readsAsSignedIn(answer) ?? false) === true;
    return {
      ok: this.signedIn, landedOn, loginPage, answer, probe, probePath: PROBE, probeSays,
      interstitial: waited, interstitialCleared: cleared, consent, submitted, csrf,
      answerSays: readsAsSignedIn(answer), limits, tooLong, said: said && said.trim(),
      cookies: await this.cookieNames(),
    };
  }

  async signIn() {
    const r = await this.attemptSignIn();
    if (!r.ok) {
      if (r.tooLong.length) throw new Error(`Interval cannot accept what is set: ${r.tooLong.join('; ')}`);
      throw refusal(`Interval did not sign the watcher in — ${r.probePath} still offers a way in${r.said ? `: ${r.said}` : ''}`);
    }
    return r.probe || r.answer;
  }

  /**
   * Save what the signed-in browser sees, alongside the same pages fetched with no login at
   * all. The pair is the evidence: Interval serves an anonymous caller the public version of
   * the same URL, so a page on its own proves nothing. Identical means it did not get in.
   */
  async dump(paths = ['/web/my/home', '/web/my/info/benefits/getaways']) {
    const out = {};
    const control = {};
    let r = null;
    try {
      r = await this.attemptSignIn();
      out['00-login-form'] = r.loginPage;
      out['01-login-answer'] = r.answer;
      if (r.probe) out['01b-probe-page'] = r.probe;
    } catch (err) {
      out['00-could-not-sign-in'] = `<!-- ${err.message} -->`;
    }

    // The signed-in run.
    const mine = {};
    for (const p of paths) {
      try { const h = await this.html(p); out[p] = h; mine[p] = { bytes: h.length, signedIn: readsAsSignedIn(h) }; }
      catch (err) { out[p] = `<!-- ${err.message} -->`; }
    }

    // The control: a second, entirely separate browser context. No login, nothing shared.
    try {
      const anon = await this._browser.newContext({ locale: 'en-US', viewport: { width: 1366, height: 900 } });
      const ap = await anon.newPage();
      for (const p of [PROBE, ...paths]) {
        await ap.goto(this.origin + p, { waitUntil: 'domcontentloaded' });
        await ap.waitForLoadState('networkidle').catch(() => {});
        const h = await ap.content();
        control[p] = { bytes: h.length, signedIn: readsAsSignedIn(h) };
        out[`anon${p}`] = h;
      }
      await anon.close();
    } catch (err) { out['04-control-failed'] = `<!-- ${err.message} -->`; }

    const say = (v) => (v === true ? 'signed in' : v === false ? 'NOT signed in' : 'cannot tell');
    const cookies = r?.cookies || (this._ctx ? await this.cookieNames() : {});
    const uzm = Object.values(cookies).flat().filter(n => /^__uzm/.test(n));
    out['02-what-happened'] = ['<!--',
      `  browser:        ${this.browserName}${this.proxyHost ? ` via ${this.proxyHost}` : ' (direct, no proxy)'}`,
      `  signed in:      ${r?.ok ?? 'could not get that far'}`,
      `  landed on:      ${r?.landedOn || '(nowhere)'}`,
      `  consent panel:  ${r?.consent ? `dismissed via ${r.consent}` : 'none in the way'}`,
      `  CSRF token:     ${r?.csrf ? 'CSRFGuard put one on the form' : 'MISSING — /web/csrf never ran, the post will be dropped'}`,
      `  the form was:   ${r?.submitted || '(never reached)'}`,
      `  waiting room:   ${r?.interstitial ? (r.interstitialCleared ? 'yes, and it cleared' : 'YES, AND IT NEVER CLEARED') : 'none'}`,
      `  probe page:     ${PROBE} -> ${say(r?.probeSays)}`,
      `  login answer:   ${say(r?.answerSays)}`,
      `  the site said:  ${r?.said || '(nothing)'}`,
      `  form accepts:   ${Object.entries(r?.limits || {}).map(([k, v]) => `${k} up to ${v}`).join(', ') || '(none given)'}`,
      ...(r?.tooLong?.length ? ['', '  !! WHAT IS SET IS TOO LONG FOR THE FORM:',
        ...r.tooLong.map(t => `     ${t}`)] : []),
      '',
      '  Cookies held, by host (names only):',
      ...Object.entries(cookies).map(([host, names]) => `    ${host}  ${names.join(', ')}`),
      `  Radware bot-manager cookies: ${uzm.length ? uzm.join(', ') : 'NONE — the challenge did not run'}`,
      '',
      '  Where the browser went:',
      ...this.trace.map(t => `    ${t.at}`),
      '',
      '  The same pages with NO login, for comparison:',
      ...Object.entries(control).map(([p, c]) => `    ${p}  ${c.bytes} bytes  ${say(c.signedIn)}`),
      '',
      '  What the signed-in run got:',
      ...Object.entries(mine).map(([p, c]) => `    ${p}  ${c.bytes} bytes  ${say(c.signedIn)}${
        control[p] && control[p].bytes === c.bytes ? '   <-- IDENTICAL to the anonymous fetch' : ''}`),
      '  Identical sizes mean the password was not accepted.',
      '-->'].join('\n');
    return out;
  }

  /**
   * Getaway weeks. The search lives behind the login and has not been seen yet, so this asks
   * for the page and says plainly that the selectors are still missing rather than returning
   * an empty list that reads like a quiet week.
   */
  async getaways({ from, to, guests = 2, location = 'Aruba' } = {}) {
    if (!this.signedIn) await this.signIn();
    const path = process.env.INTERVAL_SEARCH_PATH;
    if (!path) {
      const e = new Error('The Getaway search page is not set yet. Run the watcher once with --dump and send dump/.');
      e.needsDump = true; throw e;
    }
    const html = await this.html(path);
    if (readsAsSignedIn(html) === false) {
      this.signedIn = false;
      throw refusal('The session was signed out by the time the Getaway search ran — no results were read.');
    }
    const { parseGetaways } = await import('./interval.mjs');
    return parseGetaways(html, { location });
  }
}
