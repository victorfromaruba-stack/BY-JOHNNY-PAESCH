// Posting what the watcher found onto the Circle's board.
//
// It signs in with a username and a password like anybody else and calls the same post_deal
// the Desk calls. No service key on the VPS.
//
// It holds NO role. The first version gave it the Voice, which is how the Desk posts deals —
// but stays_write and announcements_write are both `all` to comms, so that password, sitting
// in a plain file on a rented machine, could have re-priced the whole catalog or rewritten the
// club's announcements. post_deal now lets a `bot` member through on its own account, so the
// role came off. What is left if this account is ever taken: it can post a deal, read the
// catalog and the board, read the member list, and file a contribution in its own name that a
// human still has to confirm. It cannot mint a point, move money, change a member, or touch
// the catalog.

const REST = (url, path) => `${url.replace(/\/$/, '')}${path}`;

/** Every call gets a clock. This runs unattended for months; a hung socket must not stall it. */
async function ask(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

export class Circle {
  constructor({ url, key, username, password }) {
    if (!url || !key) throw new Error('Set CIRCLE_URL and CIRCLE_KEY');
    if (!username || !password) throw new Error('Set CIRCLE_USER and CIRCLE_PASS');
    Object.assign(this, { url, key, username, password });
    this.token = null;
  }

  async signIn() {
    const res = await ask(REST(this.url, '/auth/v1/token?grant_type=password'), {
      method: 'POST',
      headers: { apikey: this.key, 'content-type': 'application/json' },
      // Usernames map to a login address that is never shown or sent to; see admin_set_login.
      body: JSON.stringify({ email: `${this.username.toLowerCase()}@members.hunto.aw`, password: this.password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw new Error(`The Circle refused the watcher's sign-in: ${body.error_description || body.msg || res.status}`);
    this.token = body.access_token;
    return this.token;
  }

  /**
   * Every call to the Circle goes through here, and every one of them can sign in again.
   *
   * A Supabase access token lasts about an hour. The first version only retried a 401 inside
   * rpc(), so a watcher started at nine o'clock read the board and the catalog happily until
   * ten and then quietly stopped being able to — which on a machine nobody is looking at is
   * the same as it having died.
   */
  async call(path, opts = {}) {
    if (!this.token) await this.signIn();
    const go = () => ask(REST(this.url, path), {
      ...opts,
      headers: { apikey: this.key, authorization: `Bearer ${this.token}`, ...(opts.headers || {}) },
    });
    let res = await go();
    if (res.status === 401 || res.status === 403) { this.token = null; await this.signIn(); res = await go(); }
    return res;
  }

  async rpc(fn, args) {
    const res = await this.call(`/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args),
    });
    const out = await res.json().catch(() => null);
    if (!res.ok) throw new Error(out?.message || `${fn} failed with ${res.status}`);
    return out;
  }

  /**
   * Every week already on the board, so the same one is never posted twice.
   *
   * Two things this gets right that the first version did not. It reads deals of EVERY status,
   * not only live ones: a deal Victor takes down is a deal he does not want, and looking only at
   * live rows meant the watcher put it straight back thirty minutes later, and again, forever.
   * And it throws rather than returning an empty set when the read fails — an empty set reads as
   * "nothing is on the board yet", which would repost the lot.
   */
  async knownRefs() {
    const res = await this.call('/rest/v1/deals?select=source_ref');
    if (!res.ok) throw new Error(`Could not read what is already on the board: ${res.status}`);
    return new Set((await res.json()).map(d => d.source_ref).filter(Boolean));
  }

  /**
   * The catalog, so the watcher can tell a bargain from a listing. Without this it would post
   * every open week it finds, which is a hundred a day and tells nobody anything.
   */
  async stays() {
    const res = await this.call('/rest/v1/stays?select=id,name,kind,rate_low_usd,rate_high_usd,rate_peak_usd,min_nights&active=eq.true');
    if (!res.ok) throw new Error(`Could not read the catalog: ${res.status}`);
    return res.json();
  }

  /** Put one find on the board. `sourceRef` is what stops duplicates. */
  async post(find) {
    return this.rpc('post_deal', {
      p_stay: find.stayId,
      p_from: find.from, p_to: find.to,
      p_points: Math.round(find.usdTotal * (find.pointsPerDollar || 100)),
      p_nights: find.nights || null,
      p_title: find.title, p_note: find.note || '',
      p_retail_usd: find.retailUsd || null,
      p_source: find.source, p_source_url: find.url || '', p_source_ref: find.sourceRef,
    });
  }
}
