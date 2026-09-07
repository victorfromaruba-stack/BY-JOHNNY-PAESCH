// Interval International, driven by a real browser.
//
// The plain-fetch client in interval.mjs cannot sign in to Interval, and that is not a bug in
// it — it is what Interval is. Three things, each read off the live site rather than guessed:
//
//   1. The login answer carries no Location header. It carries a script:
//        window.location.replace("https://vip.intervalworld.com/web/cs?a=0")
//      A browser runs it. fetch() does not.
//
//   2. JSESSIONID is set host-only with path=/web, separately on www and on vip. So the
//      session established at the front door is NOT the session the VIP host wants; something
//      has to establish one there, and that something runs in the page.
//
//   3. __uzma / __uzmb / __uzmc / __uzmd / __uzme are Radware Bot Manager, normally minted by
//      a JavaScript challenge. A client that never runs the challenge never earns them — which
//      fits the symptom exactly: a polite 200 carrying the signed-out page, rather than a 401.
//
// Two of those three need a JavaScript engine. So Interval gets a browser and RedWeek keeps
// plain fetch, which needs no login and already works.
//
// The password lives in the environment on Victor's VPS and is typed into the page. It is
// never written to the trace, the dump, or the log.

import { readsAsSignedIn } from './interval.mjs';

const ORIGIN = 'https://www.intervalworld.com';
const HOSTS = /(^|\.)intervalworld\.com$/i;
const PROBE = process.env.INTERVAL_PROBE_PATH || '/web/my/home';

/**
 * Playwright, loaded only when it is actually needed.
 *
 * A RedWeek-only pass must not fail because a browser is not installed, and the watcher runs
 * on a small VPS where that is a real possibility. Tries the ordinary import first, then the
 * global install path used on the VPS and in this container.
 */
async function playwright() {
  const tries = ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'];
  const failures = [];
  for (const where of tries) {
    try { return await import(where); } catch (err) { failures.push(`${where}: ${err.message.split('\n')[0]}`); }
  }
  const e = new Error(`Interval needs Playwright and it could not be loaded (${failures.join(' | ')})`);
  e.needsBrowser = true;
  throw e;
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
    // Node's fetch reads HTTPS_PROXY on its own; a browser has to be told. Unset on Victor's
    // VPS, which is the normal case — this only matters where something sits in the middle.
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
    this._browser = await engine.launch({
      headless: this.headless, slowMo: this.slowMo,
      ...(proxy ? { proxy: { server: proxy, bypass } } : {}),
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

    await page.fill('input[name="j_username"]', this.username);
    await page.fill('input[name="j_password"]', this.password);
    // Submitting and then waiting for things to settle, rather than waiting for one particular
    // navigation: the answer moves the page with script, so there is more than one hop.
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      page.click('input[type="submit"], button[type="submit"]'),
    ]);
    await page.waitForLoadState('networkidle').catch(() => {});
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
      answerSays: readsAsSignedIn(answer), limits, tooLong, said: said && said.trim(),
      cookies: await this.cookieNames(),
    };
  }

  async signIn() {
    const r = await this.attemptSignIn();
    if (!r.ok) {
      if (r.tooLong.length) throw new Error(`Interval cannot accept what is set: ${r.tooLong.join('; ')}`);
      throw new Error(`Interval did not sign the watcher in — ${r.probePath} still offers a way in${r.said ? `: ${r.said}` : ''}`);
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
      `  browser:        ${this.browserName}`,
      `  signed in:      ${r?.ok ?? 'could not get that far'}`,
      `  landed on:      ${r?.landedOn || '(nowhere)'}`,
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
      throw new Error('The session was signed out by the time the Getaway search ran — no results were read.');
    }
    const { parseGetaways } = await import('./interval.mjs');
    return parseGetaways(html, { location });
  }
}
