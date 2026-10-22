// The browser half of the Interval scan: one headless Chromium, driven the way iv-login.js and
// iv-map.js drive it, and nothing more.
//
// Victor's permission of 22 Oct 2026 (the interval-board skill, "The line") is for that flow:
// the VIP host's own login page, the proxy from the locked box, the launch switch, user agent
// and init script those two scripts already use, and fixed patient waits. It says in so many
// words "add no new evasion beyond what that flow already does", so this file adds none:
//
//   - it never presses Continue on a holding page, and never clicks through a captcha or any
//     other challenge. A "Please wait" page is waited on, passively, for a few seconds — which
//     is all iv-login.js does with its fixed sleeps — and if it has not cleared by then it is
//     handed back as what it is, and the caller stops.
//   - it never retries. One call is one try; what to make of the answer is classify()'s job in
//     interval-scan.mjs.
//   - it never goes anywhere but Interval (allows()), and never types the password into a page
//     that is not on an Interval host.
//
// The sign-in, the proxy line and the saved session are all this file touches of Victor's
// account. The password is read from the locked box at the moment it is typed and is in no log,
// no trace, no error message and no file; the saved session is cookies only, mode 0600.

import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { join } from 'node:path';
import { loadPlaywright, splitProxy } from './interval-browser.mjs';

export const ORIGIN = 'https://vip.intervalworld.com';
const HOSTS = /(^|\.)intervalworld\.com$/i;
const LANDING = '/web/cs?a=0';        // where the sign-in itself lands, and where "Start Search Over" goes
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the locked box
// AES-256-GCM, 12-byte iv, 16-byte tag, then the ciphertext — the format iv-login.js reads. The key
// is openclaw's; the watcher runs as root, which can read it. LOCKED_BOX_* only let the tests point
// at a box of their own making.
export function readBox(name, { dir = process.env.LOCKED_BOX_DIR || '/home/openclaw/premanifest-bot/credentials',
                                keyFile = process.env.LOCKED_BOX_KEY || '/home/openclaw/.premanifest-secret.key' } = {}) {
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error('not a locked-box entry name');
  const b = readFileSync(join(dir, `${name}.enc`));
  const d = createDecipheriv('aes-256-gcm', readFileSync(keyFile), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8').trim();
}

// ---------------------------------------------------------------- exactly iv-login.js
// The same user agent, the same viewport family, the same switch, the same one-line init script.
// These are asserted against the scripts' own values in interval-scan.test.mjs so they cannot
// drift into something the permission did not cover.
export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const launchOptions = (engine, executablePath = null) => ({
  headless: true,
  ...(engine === 'chromium' ? { args: ['--disable-blink-features=AutomationControlled'] } : {}),
  ...(executablePath ? { executablePath } : {}),
});
export const contextOptions = ({ proxy = null, storageState = null } = {}) => ({
  viewport: { width: 1280, height: 950 }, locale: 'en-US', timezoneId: 'America/Aruba', userAgent: UA,
  ...(proxy ? { proxy } : {}),
  ...(storageState ? { storageState } : {}),
});
const HIDE_WEBDRIVER = () => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); };

/** The patience of the flow, in ms: 4 s on the login page, 8 s after Sign In (iv-login.js: 6 s / 8 s). */
export const WAITS = Object.freeze({ afterLoginPage: 4000, afterSubmit: 8000, settle: 4000, holding: 8000, idle: 30000, nav: 60000 });

/** A page that is only the bot layer's "Please wait". Real pages that happen to say it are long. */
export function isHolding({ title = '', text = '' } = {}) {
  const waiting = /please\s*wait|one\s*moment|just a moment|checking your browser|verifying/i;
  return waiting.test(title) || (waiting.test(text) && text.length < 400);
}

/** Playwright's chromium lives in openclaw's cache, not root's: same file, found by its relative path. */
function elsewhere(exe) {
  const rel = String(exe).split('/ms-playwright/')[1];
  const dir = process.env.PLAYWRIGHT_ALT_CACHE || '/home/openclaw/.cache/ms-playwright';
  return rel && existsSync(join(dir, rel)) ? join(dir, rel) : null;
}

export class IntervalSession {
  /**
   * `stateFile` is the saved session. `getProxy` / `getCreds` are called only when needed and only
   * here; the defaults read the locked box. `onlyHosts` is for the tests: every request to any other
   * host is aborted in the browser itself, so a test cannot reach Interval even by mistake.
   */
  constructor({ origin = ORIGIN, stateFile, browser = 'chromium', waits = WAITS, onlyHosts = null, requireProxy = true,
                getProxy = () => splitProxy(readBox('proxy')),
                getCreds = () => ({ user: readBox('interval_user'), pass: readBox('interval_pass') }) } = {}) {
    if (!stateFile) throw new Error('IntervalSession needs somewhere to keep the session');
    Object.assign(this, { origin, stateFile, browserName: browser, waits, onlyHosts, requireProxy, getProxy, getCreds });
    this.page = this.ctx = this.browser = null;
    this.hadState = false;
    this.bad = null; this.last = null;     // the status of the page just navigated to
  }

  allows(hostname) {
    if (HOSTS.test(hostname)) return true;
    try { return hostname === new URL(this.origin).hostname; } catch { return false; }
  }
  hasSaved() { return this.hadState; }

  async open() {
    if (this.page) return this.page;
    // The proxy first, and no way around it: Interval turns the server's own address away at the
    // sign-in, so going direct would not be a more careful option, only a refused one.
    const proxy = await this.getProxy();
    if (!proxy && this.requireProxy) throw new Error('the locked box has no proxy line — not signing in from the server\'s own address');
    const pw = await loadPlaywright();
    const engine = pw[this.browserName];
    let exe = null; try { exe = engine.executablePath(); } catch { /* unknown engine */ }
    let executablePath = null;
    if (exe && !existsSync(exe)) {
      executablePath = elsewhere(exe);
      if (!executablePath) throw Object.assign(new Error(`Playwright has no ${this.browserName} downloaded — npx playwright install ${this.browserName}`), { needsBrowser: true });
    }
    let storageState = null;
    if (existsSync(this.stateFile)) {
      try { storageState = JSON.parse(readFileSync(this.stateFile, 'utf8')); } catch { this.forget(); }
    }
    this.hadState = !!storageState;
    this.browser = await engine.launch(launchOptions(this.browserName, executablePath));
    this.ctx = await this.browser.newContext(contextOptions({ proxy, storageState }));
    await this.ctx.addInitScript(HIDE_WEBDRIVER);
    this.ctx.setDefaultTimeout(45000);
    if (this.onlyHosts) {
      await this.ctx.route('**/*', (r) => {
        let host = ''; try { host = new URL(r.request().url()).hostname; } catch { /* about:blank etc. */ }
        return !host || this.onlyHosts.includes(host) ? r.continue() : r.abort();
      });
    }
    this.page = await this.ctx.newPage();
    this.page.on('response', (r) => {
      if (!r.request().isNavigationRequest() || r.frame() !== this.page.mainFrame()) return;
      this.last = r.status();
      if (r.status() === 403 || r.status() === 429) this.bad ??= r.status();
    });
    return this.page;
  }

  async close() {
    try { await this.ctx?.close(); } finally { await this.browser?.close(); }
    this.page = this.ctx = this.browser = null;
  }

  async go(path) {
    const url = new URL(path, this.origin);
    if (!this.allows(url.hostname)) throw new Error(`Refusing to visit ${url.hostname} — not Interval`);
    await this.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: this.waits.nav });
  }

  /** What the page says right now: enough for classify() to judge, and nothing about who is signed in. */
  async snap() {
    const page = this.page;
    const [title, text, html, captcha] = await Promise.all([
      page.title().catch(() => ''),
      page.evaluate(() => (document.body?.innerText || '').slice(0, 6000)).catch(() => ''),
      page.content().catch(() => ''),
      // A captcha the page is SHOWING: a widget with size on screen. The invisible badge some sites carry on every
      // page (.grecaptcha-badge) asks nothing of anyone and is not a challenge.
      page.evaluate(() => [...document.querySelectorAll('iframe[src*="captcha" i], .g-recaptcha, .h-captcha, #px-captcha')]
        .some((el) => !el.closest('.grecaptcha-badge') && el.offsetWidth > 1 && el.offsetHeight > 1)).catch(() => false),
    ]);
    const status = this.bad ?? this.last; this.bad = null;
    return { status, url: page.url(), title, text, html, captcha, holding: isHolding({ title, text }) };
  }

  /** snap(), and while it is only a "Please wait" page, look again once a second — waiting, nothing else. */
  async watch() {
    let s = await this.snap();
    for (let t = 0; s.holding && t < this.waits.holding; t += 1000) { await sleep(1000); s = await this.snap(); }
    return s;
  }
  async settled() {
    await this.page.waitForLoadState('networkidle', { timeout: this.waits.idle }).catch(() => {});
    await sleep(this.waits.settle);
    return this.watch();
  }

  /** The VIP landing page — the one the sign-in itself lands on, and the one that carries the search form. */
  async landing() {
    await this.open();
    if (!/\/web\/cs\?a=0(?:&|$)/.test(this.page.url())) await this.go(LANDING);
    return this.settled();
  }

  /**
   * Sign in the way iv-map.js does: the VIP host's login page, wait, the first non-search text box
   * and the password box, click Sign In, wait. `noForm` comes back true when the page had no form to
   * fill — which is a holding page or a wall, and classify() reads it as one — and nothing is typed.
   * `guard(snap)` is asked about the login page BEFORE anything is typed; true means a wall is up (a
   * captcha, a challenge) and the form is left alone — the snapshot comes back `blocked`.
   */
  async signIn({ guard = () => false } = {}) {
    await this.open();
    await this.go('/web/my/auth/loginPage');
    await sleep(this.waits.afterLoginPage);
    const page = this.page;
    const before = await this.watch();
    if (guard(before)) return { ...before, blocked: true };
    const u = await page.$('input[type=text]:not([name*=search i]):not([id*=search i])');
    const pw = await page.$('input[type=password]');
    if (!u || !pw || !this.allows(new URL(page.url()).hostname)) return { ...before, noForm: true };
    const { user, pass } = await this.getCreds();
    await u.fill(user); await pw.fill(pass);
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: this.waits.idle }).catch(() => {}),
      page.click('input[type=submit], button[type=submit], #buttonlogin').catch(() => {}),
    ]);
    await sleep(this.waits.afterSubmit);
    return this.watch();
  }

  /**
   * Type a resort's code into the Getaways search the way a person does — "Resort Name or Code" — or,
   * with `city`, ask for the island ("Single Destination", Aruba, as the form's own default has it), and
   * press Find Getaway. The dates are left as the form offers them. Throws `noForm` (not a stop)
   * when this page has no such form, and says which forms it does have.
   */
  async search(code, { city = false } = {}) {
    const page = this.page;
    const form = page.locator('form[name="SearchForm"]').first();
    if (!(await form.count())) {
      const forms = await page.evaluate(() => [...document.forms].map((f) => f.name || f.id || '(unnamed)')).catch(() => []);
      throw Object.assign(new Error(`the Getaways search form is not on ${new URL(page.url()).pathname}${new URL(page.url()).search} (forms there: ${forms.join(', ') || 'none'})`), { noForm: true });
    }
    // "Single Destination" with Aruba in the box is how the form comes; "Resort Name or Code" is a person typing a code.
    const radio = form.locator(`input[name="searchType"][value="${city ? 'CitySearch' : 'ResortSearch'}"]`);
    if (!(await radio.count())) throw Object.assign(new Error(`the search form has no ${city ? '"Single Destination"' : '"Resort Name or Code"'} choice`), { noForm: true });
    await radio.check();
    await form.locator('input[name="searchCriteria"]').fill(city ? 'Aruba, ANT' : code);
    // Empty date boxes get a window; the ones the form pre-filled (it does) are not touched.
    const day = (ms) => { const d = new Date(ms - 4 * 3600e3); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`; };
    for (const [name, ms] of [['fromDate', Date.now()], ['toDate', Date.now() + 180 * 864e5]]) {
      const box = form.locator(`input[name="${name}"]`);
      if ((await box.count()) && !(await box.inputValue())) await box.fill(day(ms));
    }
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: this.waits.nav }).catch(() => null),
      form.locator('input[type=submit]').first().click(),
    ]);
    return this.settled();
  }

  /** Keep the session: cookies only, written whole, private. */
  async save() {
    const st = await this.ctx.storageState();
    const tmp = `${this.stateFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(st), { mode: 0o600 });
    renameSync(tmp, this.stateFile);
  }
  /** Throw away a session that no longer works. */
  forget() { try { unlinkSync(this.stateFile); } catch { /* already gone */ } this.hadState = false; }
}
