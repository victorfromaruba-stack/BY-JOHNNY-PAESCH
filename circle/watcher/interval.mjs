// Interval International over plain HTTP — kept for its parser and its anonymous control
// fetches, NOT because it can sign in. It cannot: see interval-browser.mjs for why.
//
// Victor's account, Victor's machine. Credentials come from the environment on his VPS and
// are never written down anywhere else. Plain HTTP with a cookie jar rather than a browser —
// the site is a Spring application, so signing in is a form POST and the session is a cookie,
// which is lighter on a small VPS and far less fragile than driving Chromium.
//
// The login form was read off the real page:
//   POST /web/my/auth/login   j_username, j_password, _spring_security_remember_me
//
// What sits behind the login could not be read from outside it, so `dump()` saves the pages
// the session actually lands on. Run once with --dump on the VPS and the selectors get
// finished from that HTML — no password ever leaves the machine.

// Where signing in starts. Where it ENDS is not this — see followTo(). Victor's account is
// VIP Gold, and Interval serves VIP members from vip.intervalworld.com; the login answer moves
// the browser there with a line of JavaScript. So this is the front door, not the address.
const ORIGIN = 'https://www.intervalworld.com';
// Only ever Interval. The jar does not scope cookies by domain — it sends what it holds to
// whatever host it is pointed at, which is what carries the session from www to vip — so the
// set of hosts it may be pointed at is the thing that has to be closed. A redirect off this
// list is not followed, because following it would hand Victor's session to a stranger.
const HOSTS = /(^|\.)intervalworld\.com$/i;
// The page asked for to decide whether the session is real. Anything behind the login does;
// this one is small and is where the account's own details live.
const PROBE = process.env.INTERVAL_PROBE_PATH || '/web/my/home';
const UA = process.env.WATCH_UA
  || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/**
 * A cookie jar, scoped the way a browser scopes them.
 *
 * It was keyed on name alone, which was wrong twice over once the session started moving
 * between hosts. Read off the live site, both www and vip set:
 *
 *   JSESSIONID   host-only, path=/web      <- a SEPARATE session per host
 *   serverName   domain=.intervalworld.com <- the only thing genuinely shared
 *   __uzm[a-e]   host-only                 <- Radware Bot Manager
 *   BIGIP-EXT/INT host-only
 *
 * So a name-keyed jar sends www's JSESSIONID to vip, which no browser would do, and then
 * lets vip's JSESSIONID overwrite www's, so neither session survives the round trip. Keyed
 * on name+domain+path instead, and only cookies that match the request are sent.
 */
export function jar() {
  const store = new Map();                       // "name\ndomain\npath" -> {name, value, domain, path, hostOnly}
  /** A Set-Cookie that clears the cookie rather than setting one. */
  const isDeletion = (value, attrs) => {
    if (!value) return true;                       // servers clear a cookie by sending it empty
    for (const a of attrs) {
      const [k, v = ''] = a.split('=');
      const key = k.trim().toLowerCase();
      if (key === 'max-age' && Number(v.trim()) <= 0) return true;
      if (key === 'expires') { const t = Date.parse(v.trim()); if (t && t <= Date.parse(SAFE_NOW)) return true; }
    }
    return false;
  };
  /** RFC 6265 domain-match: the exact host, or a subdomain of a Domain= cookie. */
  const domainMatch = (host, c) =>
    (c.hostOnly ? host === c.domain : host === c.domain || host.endsWith(`.${c.domain}`));
  /** RFC 6265 path-match, which is why a /web cookie does not go to /. */
  const pathMatch = (path, cookiePath) =>
    path === cookiePath || (path.startsWith(cookiePath)
      && (cookiePath.endsWith('/') || path[cookiePath.length] === '/'));
  return {
    header(url) {
      // Called without a URL only by the tests and the trace; then it is everything held.
      let host = null, path = '/';
      if (url) { try { const u = new URL(url); host = u.hostname; path = u.pathname || '/'; } catch { /* fall through */ } }
      return [...store.values()]
        .filter(c => !host || (domainMatch(host, c) && pathMatch(path, c.path)))
        .map(c => `${c.name}=${c.value}`).join('; ');
    },
    absorb(res, url) {
      let host = '', base = '/';
      try { const u = new URL(url || res.url); host = u.hostname; base = u.pathname || '/'; } catch { /* no url to scope to */ }
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const [pair, ...attrs] = line.split(';');
        const i = pair.indexOf('=');
        if (i <= 0) continue;
        const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
        let domain = host, hostOnly = true, path = base.replace(/\/[^/]*$/, '') || '/';
        for (const a of attrs) {
          const [k, v = ''] = a.split('=');
          const key = k.trim().toLowerCase();
          if (key === 'domain' && v.trim()) { domain = v.trim().replace(/^\./, '').toLowerCase(); hostOnly = false; }
          if (key === 'path' && v.trim()) path = v.trim();
        }
        // A cookie may not be set for a domain it does not belong to. Interval would never try
        // it, but a jar that accepts Domain=com from anybody is a jar worth not writing.
        if (!hostOnly && host && !(host === domain || host.endsWith(`.${domain}`))) continue;
        const key = `${name}\n${domain}\n${path}`;
        // RFC 6265 says a cleared cookie is REMOVED, not stored as an empty string. Storing it
        // would send `JSESSIONID=` on every later request, which is worse than sending nothing.
        if (isDeletion(value, attrs)) store.delete(key);
        else store.set(key, { name, value, domain, path, hostOnly });
      }
    },
    // Names only, never values — these end up in a dump file that gets sent around.
    names: () => [...new Set([...store.values()].map(c => c.name))],
    has: (name) => [...store.values()].some(c => c.name === name),
    size: () => store.size,
  };
}
// Date.now() is fine here, but keeping the comparison against one fixed reading makes the
// jar's behaviour reproducible inside a single pass.
const SAFE_NOW = new Date().toISOString();

/**
 * Does this page belong to somebody who is signed in?
 *
 * This is the ONLY sound test, and it was learned the hard way. Interval does not bounce an
 * anonymous request to the login page — it answers the very same URL with the public version
 * of the page, 200 and all. Verified against the live site with no credentials at all:
 *
 *   /web/cs?a=1000                  200 -> /web/my/home                  says "Sign In"
 *   /web/my/home                    200 -> /web/my/home                  says "Sign In"
 *   /web/my/info/benefits/getaways  200                                  says "Sign In"
 *
 * So "we did not land back on the login page" is worth nothing: an anonymous stranger does not
 * land there either. What separates the two is which affordance the page offers — a way in, or
 * a way out. Returns true, false, or null when the page says neither.
 */
export function readsAsSignedIn(html = '') {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
  const wayOut = /href=["'][^"']*(?:\/logout|\/signout|sign-?out)/i.test(text)
    || />\s*(?:sign\s*out|log\s*out)\s*</i.test(text);
  const wayIn = /href=["'][^"']*\/auth\/(?:login|loginPage)/i.test(text)
    || /name=["']j_password["']/i.test(text)
    || />\s*(?:sign\s*in|log\s*in)\s*</i.test(text);
  if (wayOut && !wayIn) return true;
  if (wayIn && !wayOut) return false;
  return null;                                   // both or neither: say so rather than guess
}

/**
 * The hidden fields on the LOGIN form — not on every form on the page.
 *
 * A login page also carries a site-search box, a locale picker and a newsletter sign-up, each
 * with hidden fields of its own. Scooping up the lot and posting them meant sending the login
 * endpoint fields it never asked for, and — worse — a duplicate name from a later form silently
 * overwrote the login form's own token. So: find the form that has the password box, and read
 * only that one.
 *
 * Values are decoded, because a CSRF token containing &amp; or &#43; posted back verbatim is a
 * different token, and the refusal that follows looks exactly like a wrong password.
 */
export function hiddenFields(html = '') {
  const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form>/gi)].map(m => m[0]);
  const login = forms.find(f => /name\s*=\s*["']?j_password["']?/i.test(f))
    || forms.find(f => /type\s*=\s*["']?password["']?/i.test(f))
    || html;                                   // no form found: fall back to the whole page
  const out = {};
  for (const m of login.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/type\s*=\s*["']?hidden["']?/i.test(tag)) continue;
    const name = attr(tag, 'name');
    if (name) out[name] = attr(tag, 'value') ?? '';
  }
  return out;
}

/**
 * What the login form says it will accept, read off the form itself.
 *
 * Interval's real password box carries maxlength="14" and its login ID box maxlength="33". A
 * browser silently truncates as you type, so a longer password typed into the site becomes a
 * shorter one — and nobody ever sees that happen. A watcher posting the full-length string is
 * then sending something the site has never been told, and the refusal looks like a wrong
 * password rather than a length limit. Read off the page rather than hard-coded, so it stays
 * true if Interval changes it.
 */
export function fieldLimits(html = '') {
  const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form>/gi)].map(m => m[0]);
  const login = forms.find(f => /name\s*=\s*["']?j_password/i.test(f)) || html;
  const out = {};
  for (const m of login.matchAll(/<input\b[^>]*>/gi)) {
    const name = attr(m[0], 'name'), max = Number(attr(m[0], 'maxlength'));
    if (name && max > 0) out[name] = max;
  }
  return out;
}

/**
 * Where a page sends the browser next WITHOUT an HTTP redirect.
 *
 * Interval's login answer is a 200 carrying a script:
 *
 *   function doRedirect() { window.location.replace("https://vip.intervalworld.com/web/cs?a=0"); }
 *
 * A browser runs that and moves. A fetch() client does not, and there is no Location header to
 * follow, so the session stays on www while the account actually lives on vip — which is why
 * every page afterwards came back as the logged-out version. Meta refresh is handled too,
 * because it is the same trick without the script.
 *
 * Returns an absolute URL on an Interval host, or null. Anything off Interval is ignored
 * rather than followed: the jar sends its cookies to whatever host it is given.
 */
export function followTo(html = '', from = ORIGIN) {
  const patterns = [
    /(?:window\.)?location\s*\.\s*(?:replace|assign)\s*\(\s*["']([^"']+)["']/i,
    /(?:window\.)?location(?:\s*\.\s*href)?\s*=\s*["']([^"']+)["']/i,
    /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"';]+)/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    let url;
    try { url = new URL(m[1].trim(), from); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || !HOSTS.test(url.hostname)) continue;
    return url.toString();
  }
  return null;
}

/** One attribute off a tag, quoted or not, with entities decoded. */
function attr(tag, key) {
  const m = tag.match(new RegExp(`\\b${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  if (!m) return null;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? '');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (ENTITIES[code.toLowerCase()]) return ENTITIES[code.toLowerCase()];
    if (/^#x/i.test(code)) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (/^#/.test(code)) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return whole;
  });
}

export class Interval {
  constructor({ username, password, fetchImpl = fetch } = {}) {
    if (!username || !password) throw new Error('Set INTERVAL_USER and INTERVAL_PASS in the environment');
    this.username = username; this.password = password;
    this.jar = jar(); this.fetch = fetchImpl; this.signedIn = false;
    // Where a bare path is resolved against. It starts at the front door and moves to wherever
    // signing in actually puts the session — vip.intervalworld.com, for a VIP account. Asking
    // www for a page the session lives on at vip returns the logged-out page, cheerfully, 200.
    this.origin = ORIGIN;
    // Every hop, so a failed pass can be read afterwards without a password and without
    // guessing. Values are never recorded — only cookie NAMES.
    this.trace = [];
  }

  async req(path, { method = 'GET', body = null, redirect = 'manual', hops = 0, timeoutMs = 30000, referer = null } = {}) {
    const url = path.startsWith('http') ? path : this.origin + path;
    const headers = { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' };
    const cookie = this.jar.header(url);
    if (cookie) headers.cookie = cookie;
    // A browser posting a form always says where the form was. Sending it costs nothing and
    // removes one more way for this to look like something other than a person at a keyboard.
    if (referer) { headers.referer = referer; headers.origin = new URL(referer).origin; }
    if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
    // A socket that opens and then says nothing would otherwise hang the pass for good. This
    // runs unattended for months; every request gets a clock.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try { res = await this.fetch(url, { method, headers, body, redirect, signal: ctrl.signal }); }
    finally { clearTimeout(timer); }
    const setCookies = (res.headers.getSetCookie?.() ?? []).map(l => l.split('=')[0].trim());
    this.jar.absorb(res, url);
    this.trace.push({ method, url: url.replace(ORIGIN, ''), status: res.status,
      to: (res.headers.get('location') || '').replace(ORIGIN, ''),
      setCookies, jarAfter: this.jar.names() });
    // Follow redirects by hand so cookies are carried across each hop. Bounded, because a site
    // that bounces /a to /b to /a would otherwise recurse until the stack gives out.
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      if (hops >= 10) throw new Error(`Interval redirected more than ten times from ${path}`);
      const to = res.headers.get('location');
      // A redirect after a POST is a GET, which is what a Spring login does on success.
      if (to) {
        const next = to.startsWith('http') ? to : new URL(to, url).toString();
        // Never carry the jar off Interval: it sends whatever it holds to whatever host it is
        // pointed at, so an open redirect would be a way to walk off with the session.
        if (!HOSTS.test(new URL(next).hostname)) {
          this.trace.push({ method: 'GET', url: next, status: 0, to: '', setCookies: [],
            jarAfter: this.jar.names(), note: 'not followed — off Interval' });
          return res;
        }
        return this.req(next, { redirect, hops: hops + 1, timeoutMs, referer: url });
      }
    }
    return res;
  }

  /**
   * Go where a page's own JavaScript would have gone, and stay there.
   *
   * Returns the final response, or null if the page was not moving anywhere. Bounded, because a
   * pair of pages pointing at each other would otherwise loop until the stack gives out.
   */
  async followScript(html, from, max = 3) {
    let res = null, page = html, at = from;
    for (let i = 0; i < max; i++) {
      const to = followTo(page, at);
      if (!to || to === at) break;
      res = await this.req(to);
      at = res.url || to;
      // The session lives on whichever host it was sent to, so everything asked for afterwards
      // is asked of that host rather than the front door. The origin moves only to an Interval
      // host: the same guard as the redirect itself, applied to where we actually ended up,
      // because a hop can land somewhere other than where it was pointed.
      const landed = (() => { try { return new URL(at); } catch { return null; } })();
      this.origin = landed && HOSTS.test(landed.hostname) ? landed.origin : new URL(to).origin;
      page = await res.clone().text();
    }
    return res;
  }

  /**
   * Try to sign in and report what happened, without throwing.
   *
   * Whether it worked is decided by fetching a page behind the login and looking at what that
   * page offers — a way out (signed in) or a way in (not). Two earlier versions of this check
   * were wrong in the same direction, both calling a failure a success:
   *
   *   · "does the answer contain the word logout" — written without ever having seen a real
   *     signed-in page, so it was a hope about markup rather than a fact about the response.
   *   · "did we land somewhere other than the login page" — which sounds like a fact, and is
   *     worthless: an anonymous request lands on /web/my/home too. Interval serves the public
   *     version of a page instead of bouncing you, so the URL never tells you anything.
   *
   * Getting this wrong the optimistic way is the expensive one. The watcher then runs every
   * hour for months reporting "no Getaways in Aruba", which is indistinguishable from bad luck.
   */
  async attemptSignIn() {
    // Always begin at the front door. A second sign-in — after a session was lost mid-pass —
    // would otherwise be posted to whatever host the FIRST one ended on, which is not where
    // signing in starts.
    this.origin = ORIGIN;
    const pageRes = await this.req('/web/my/auth/loginPage');   // establishes the session cookie
    const loginPage = await pageRes.text();

    // Some Spring setups carry a CSRF token in a hidden field on the login form. If one is
    // there, send it back; posting without it is refused in a way that looks like a bad password.
    const hidden = hiddenFields(loginPage);

    // If what we hold is longer than the box the site gives a person, the site has never been
    // shown this string and never will be. Worth saying out loud rather than reporting a
    // wrong password.
    const limits = fieldLimits(loginPage);
    const tooLong = [
      limits.j_username && this.username.length > limits.j_username
        ? `the login ID is ${this.username.length} characters and the form accepts ${limits.j_username}` : null,
      limits.j_password && this.password.length > limits.j_password
        ? `the password is ${this.password.length} characters and the form accepts ${limits.j_password}` : null,
    ].filter(Boolean);

    const form = new URLSearchParams({
      ...hidden,
      j_username: this.username, j_password: this.password, _spring_security_remember_me: 'on',
    });
    const res = await this.req('/web/my/auth/login', { method: 'POST', body: form.toString(),
                                                       referer: ORIGIN + '/web/my/auth/loginPage' });
    const html = await res.text();
    const landedOn = res.url || '';
    const said = (html.match(/class="[^"]*(?:error|alert|message)[^"]*"[^>]*>\s*([^<]{4,160})/i) || [])[1];

    // The login answer does not redirect with a header — it redirects with a line of script,
    // to a host that is not the one we signed in at. Go where it says.
    const movedTo = followTo(html, landedOn || ORIGIN);
    let after = null;
    if (movedTo) {
      try {
        const r2 = await this.followScript(html, landedOn || ORIGIN);
        if (r2) after = await r2.text();
      } catch { /* not being able to follow is not evidence of a good session either */ }
    }

    // The answer to the POST is not the evidence — ask for something behind the login and read
    // what comes back. If the probe page cannot say either way, fall back to the login answer;
    // if neither can say, report not-signed-in, because the costly mistake is the hopeful one.
    let probe = null, probeSays = null;
    try {
      const pr = await this.req(PROBE);
      probe = await pr.text();
      probeSays = readsAsSignedIn(probe);
    } catch { /* the probe failing is itself not evidence of a good session */ }
    const verdict = probeSays ?? readsAsSignedIn(after ?? '') ?? readsAsSignedIn(html) ?? false;

    this.signedIn = verdict === true;
    return { ok: this.signedIn, status: res.status, landedOn, html, loginPage, probe, after,
             movedTo, origin: this.origin,
             probePath: PROBE, probeSays, answerSays: readsAsSignedIn(html),
             hidden: Object.keys(hidden), limits, tooLong, said: said && said.trim() };
  }

  /** Sign in. Throws with the site's own words when it refuses. */
  async signIn() {
    const r = await this.attemptSignIn();
    if (!r.ok) {
      if (r.tooLong?.length) throw new Error(`Interval cannot accept what is set: ${r.tooLong.join('; ')}`);
      throw new Error(`Interval did not sign the watcher in${r.said ? `: ${r.said}`
        : ` — ${r.probePath} still offers a way in, so the session is anonymous`}`);
    }
    return r.probe || r.html;
  }

  /**
   * Save what the signed-in session sees, so the Getaway pages can be read properly without
   * anybody's password leaving the VPS. Returns {path: html}.
   */
  async dump(paths = ['/web/my/home', '/web/my/info/benefits/getaways']) {
    const out = {};
    let r = null;
    const control = {};

    try {
      r = await this.attemptSignIn();
      out['00-login-form'] = r.loginPage;
      out['01-login-answer'] = r.html;
      if (r.after) out['01a-where-the-script-sent-us'] = r.after;
      if (r.probe) out['01b-probe-page'] = r.probe;
      const say = (v) => (v === true ? 'signed in' : v === false ? 'NOT signed in' : 'cannot tell');

      // The control, run AFTER signing in and against the host the session ended up on, so the
      // two runs differ in one thing only: whether there is a session. Comparing a vip page
      // against a www page would have been comparing two different things.
      try {
        const anon = new Interval({ username: 'x', password: 'x', fetchImpl: this.fetch });
        anon.origin = this.origin;
        for (const p of [PROBE, ...paths]) {
          const html = await (await anon.req(p)).text();
          control[p] = { bytes: html.length, signedIn: readsAsSignedIn(html) };
          out[`anon${p}`] = html;
          await new Promise((wait) => setTimeout(wait, 1200));
        }
      } catch (err) { out['04-control-failed'] = `<!-- ${err.message} -->`; }

      out['02-what-happened'] = [
        '<!--', `  signed in:      ${r.ok}`, `  http status:    ${r.status}`,
        `  landed on:      ${r.landedOn}`,
        `     (landing here proves nothing — an anonymous caller lands here too)`,
        `  script moved us: ${r.movedTo || '(the answer carried no javascript redirect)'}`,
        `  now asking:     ${r.origin}${r.origin !== ORIGIN ? '   <-- NOT the host we signed in at' : ''}`,
        `  probe page:     ${r.probePath} -> ${say(r.probeSays)}`,
        `  login answer:   ${say(r.answerSays)}`,
        `  the site said:  ${r.said || '(nothing)'}`,
        `  hidden fields:  ${r.hidden.join(', ') || '(none on the form)'}`,
        `  form accepts:   ${Object.entries(r.limits).map(([k, v]) => `${k} up to ${v}`).join(', ') || '(no limits given)'}`,
        ...(r.tooLong.length ? ['', '  !! WHAT IS SET IS TOO LONG FOR THE FORM:',
          ...r.tooLong.map(t => `     ${t}`),
          '     The site has never seen this string, so it cannot accept it.'] : []),
        `  cookies held:   ${this.jar.size()} (${this.jar.names().join(', ') || 'none'})`,
        `  JSESSIONID set: ${this.jar.has('JSESSIONID')}`,
        '',
        '  Every hop, in order:',
        ...this.trace.map(t => `    ${String(t.status).padEnd(3)} ${t.method.padEnd(4)} ${t.url}${t.to ? `  ->  ${t.to}` : ''}${t.setCookies.length ? `   [set: ${t.setCookies.join(', ')}]` : ''}`),
        '',
        '  The same pages with NO login, for comparison:',
        ...Object.entries(control).map(([p, c]) => `    ${p}  ${c.bytes} bytes  ${say(c.signedIn)}`),
        '  If the signed-in sizes match these, the password was not accepted.',
        '-->',
      ].join('\n');
    } catch (err) {
      out['00-could-not-reach-the-login'] = `<!-- ${err.message} -->`;
    }
    // Follow what the site actually offers rather than guessing at URLs. The session lands
    // somewhere after signing in (a 302 to /web/cs?a=1000, in Victor's case), and that page's
    // own links are the truth about where Getaways live — a guessed path just returns a 404 and
    // costs another round trip to the VPS and back.
    const found = [];
    if (r?.ok) {
      const seen = new Set(paths);
      // The probe page is what a signed-in session actually sees, so its links are the ones
      // worth following; the login answer is a redirect target and often carries none.
      for (const m of `${r.probe || ''}${r.html || ''}`.matchAll(/href=["']([^"'#]+)["']/gi)) {
        const href = m[1];
        if (!/getaway|vacation|search|exchange|resort/i.test(href)) continue;
        const abs = href.startsWith('http') ? href : new URL(href, ORIGIN).pathname + (href.includes('?') ? '?' + href.split('?')[1] : '');
        if (!abs.startsWith('/') || seen.has(abs)) continue;
        seen.add(abs); found.push(abs);
        if (found.length >= 6) break;
      }
      out['03-links-worth-following'] = `<!--\n${found.map(f => '  ' + f).join('\n') || '  (none on the landing page)'}\n-->`;
    }

    // Ask for the pages either way. Signed out they come back as the public version of the same
    // page — which is exactly what the control run above captured, so the pair is the evidence.
    const sizes = [];
    for (const p of [...paths, ...found]) {
      try {
        const html = await (await this.req(p)).text();
        out[p] = html;
        sizes.push(`    ${p}  ${html.length} bytes  ${readsAsSignedIn(html) === true ? 'signed in'
          : readsAsSignedIn(html) === false ? 'NOT signed in' : 'cannot tell'}${
          control[p] ? (control[p].bytes === html.length ? '   <-- IDENTICAL to the anonymous fetch' : '   (differs from anonymous)') : ''}`);
      } catch (err) { out[p] = `<!-- ${err.message} -->`; }
      await new Promise((wait) => setTimeout(wait, 1500));
    }
    if (out['02-what-happened']) {
      out['02-what-happened'] = out['02-what-happened'].replace(/-->$/,
        ['', '  What the signed-in run got for each page:', ...sizes, '-->'].join('\n'));
    }
    return out;
  }

  /**
   * Getaway weeks for a place and a travel window.
   *
   * The search form lives behind the login and could not be read from outside it, so the
   * request shape is set from `INTERVAL_SEARCH_PATH` and `INTERVAL_SEARCH_FIELDS` rather than
   * guessed at in code. Run `--dump` once, send the HTML, and these get filled in for good.
   */
  async getaways({ from, to, guests = 2, location = 'Aruba' } = {}) {
    if (!this.signedIn) await this.signIn();
    const path = process.env.INTERVAL_SEARCH_PATH;
    if (!path) {
      const e = new Error('The Getaway search path is not set yet. Run the watcher once with --dump and send the saved HTML.');
      e.needsDump = true; throw e;
    }
    const tpl = process.env.INTERVAL_SEARCH_FIELDS || 'checkIn={from}&checkOut={to}&guests={guests}&location={location}';
    const body = tpl.replace('{from}', from).replace('{to}', to)
                    .replace('{guests}', String(guests)).replace('{location}', encodeURIComponent(location));
    const res = await this.req(path, { method: 'POST', body });
    const html = await res.text();
    // A results page served to an anonymous caller parses to zero rows, and zero rows is
    // indistinguishable from "nothing free in Aruba this week". Say which it is: a watcher that
    // reports nothing for months because it quietly lost its session is the failure that costs
    // the most, precisely because it never looks like a failure.
    if (readsAsSignedIn(html) === false) {
      this.signedIn = false;
      throw new Error('The session was signed out by the time the Getaway search ran — no results were read.');
    }
    return parseGetaways(html, { location });
  }
}

/**
 * Read a Getaway results page. Written against what the results actually show — resort name,
 * a unit code, a date range, an average night and a weekly rate — and kept tolerant, because
 * the exact markup is confirmed from the first dump.
 */
export function parseGetaways(html, { location = 'Aruba' } = {}) {
  const out = [];
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ');
  // Rows carry a date range and at least one US$ figure.
  const rowRe = /([A-Z][a-z]{2}\s+\d{1,2}\s+\d{4})\s*[-–]\s*([A-Z][a-z]{2}\s+\d{1,2}\s+\d{4})([\s\S]{0,600}?)(?=[A-Z][a-z]{2}\s+\d{1,2}\s+\d{4}\s*[-–]|$)/g;
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const iso = (s) => { const [mo, d, y] = s.split(/\s+/); const m = MONTHS[mo];
    return m === undefined ? null : `${y}-${String(m + 1).padStart(2, '0')}-${String(+d).padStart(2, '0')}`; };
  let m;
  while ((m = rowRe.exec(text))) {
    const from = iso(m[1]), to = iso(m[2]);
    if (!from || !to) continue;
    const chunk = m[3].replace(/<[^>]+>/g, ' ').replace(/&nbsp;?/g, ' ');
    const nightly = (chunk.match(/US?\$\s*([\d,]+\.?\d*)\s*(?:average\s*night)?/i) || [])[1];
    const weekly = (chunk.match(/(?:weekly[^$]{0,20})US?\$\s*([\d,]+\.?\d*)/i) || [])[1];
    const nights = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5);
    const per = nightly ? Number(nightly.replace(/,/g, '')) : 0;
    const tot = weekly ? Number(weekly.replace(/,/g, '')) : (per && nights ? Math.round(per * nights * 100) / 100 : 0);
    if (!per && !tot) continue;
    out.push({
      source: 'interval', location, from, to, nights,
      resortName: (chunk.match(/([A-Z][A-Za-z'’&.\- ]{6,50}(?:Club|Resort|Village|Villas|Beach|Suites))/) || [])[1]?.trim() || '',
      unitCode: (chunk.match(/\b([A-Z]{3})\b/) || [])[1] || '',
      usdNightly: per, usdTotal: tot,
      externalId: `interval:${from}:${to}:${per || tot}`,
    });
  }
  return out;
}
