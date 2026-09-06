// Interval International: signing in and reading Getaways.
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

const ORIGIN = 'https://www.intervalworld.com';
const UA = process.env.WATCH_UA
  || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** A cookie jar small enough to read, because a session is the whole game here. */
export function jar() {
  const store = new Map();
  return {
    header: () => [...store].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb(res) {
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(';');
        const i = pair.indexOf('=');
        if (i > 0) store.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
    has: (k) => store.has(k),
    size: () => store.size,
  };
}

export class Interval {
  constructor({ username, password, fetchImpl = fetch } = {}) {
    if (!username || !password) throw new Error('Set INTERVAL_USER and INTERVAL_PASS in the environment');
    this.username = username; this.password = password;
    this.jar = jar(); this.fetch = fetchImpl; this.signedIn = false;
  }

  async req(path, { method = 'GET', body = null, redirect = 'manual', hops = 0, timeoutMs = 30000 } = {}) {
    const url = path.startsWith('http') ? path : ORIGIN + path;
    const headers = { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' };
    if (this.jar.size()) headers.cookie = this.jar.header();
    if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
    // A socket that opens and then says nothing would otherwise hang the pass for good. This
    // runs unattended for months; every request gets a clock.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try { res = await this.fetch(url, { method, headers, body, redirect, signal: ctrl.signal }); }
    finally { clearTimeout(timer); }
    this.jar.absorb(res);
    // Follow redirects by hand so cookies are carried across each hop. Bounded, because a site
    // that bounces /a to /b to /a would otherwise recurse until the stack gives out.
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      if (hops >= 10) throw new Error(`Interval redirected more than ten times from ${path}`);
      const to = res.headers.get('location');
      // A redirect after a POST is a GET, which is what a Spring login does on success.
      if (to) return this.req(to.startsWith('http') ? to : new URL(to, url).toString(), { redirect, hops: hops + 1, timeoutMs });
    }
    return res;
  }

  /** Sign in. Throws with the site's own words when it refuses. */
  async signIn() {
    await this.req('/web/my/auth/loginPage');            // establishes the session cookie
    const form = new URLSearchParams({
      j_username: this.username, j_password: this.password, _spring_security_remember_me: 'on',
    });
    const res = await this.req('/web/my/auth/login', { method: 'POST', body: form.toString() });
    const html = await res.text();
    // Spring sends you back to the login page with an error when it does not like you.
    if (/j_password|loginPage|invalid|incorrect|locked/i.test(html) && !/logout|sign ?out/i.test(html)) {
      const msg = (html.match(/class="[^"]*error[^"]*"[^>]*>\s*([^<]{4,120})/i) || [])[1];
      throw new Error(`Interval refused the sign-in${msg ? `: ${msg.trim()}` : ''}`);
    }
    this.signedIn = true;
    return html;
  }

  /**
   * Save what the signed-in session sees, so the Getaway pages can be read properly without
   * anybody's password leaving the VPS. Returns {path: html}.
   */
  async dump(paths = ['/web/my/home', '/web/my/info/benefits/getaways']) {
    if (!this.signedIn) await this.signIn();
    const out = {};
    for (const p of paths) {
      try { out[p] = await (await this.req(p)).text(); }
      catch (err) { out[p] = `<!-- ${err.message} -->`; }
      await new Promise(r => setTimeout(r, 1500));
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
    return parseGetaways(await res.text(), { location });
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
