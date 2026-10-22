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

import { normName } from '../js/core/names.js';

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
    if (!res.ok) throw Object.assign(new Error(out?.message || `${fn} failed with ${res.status}`), { status: res.status, code: out?.code });
    return out;
  }

  /**
   * Members who opened a stay since the last call: [{ stay, tapped, from, to }]. A place, a time and the dates
   * the member was looking for (null when their phone sent none) — never a member (take_stay_taps in
   * supabase/migrations/20261022_stay_taps.sql and 20261022_tap_window.sql). Collecting marks them taken, so
   * each tap comes back once.
   */
  async takeTaps() {
    const rows = await this.rpc('take_stay_taps', {});
    return Array.isArray(rows) ? rows.map((r) => ({ stay: r.stay, tapped: r.tapped, from: r.window_from || null, to: r.window_to || null })) : [];
  }

  /** A source stopped answering (`sinceMs`: the last time it did). Idempotent: the first time stands. Needs 20261022_source_outage.sql. */
  async markSourceUnreachable(source, sinceMs = null, why = null) {
    return this.rpc('mark_source_unreachable', { p_source: source, p_since: sinceMs ? new Date(sinceMs).toISOString() : null, p_why: why });
  }
  /** A source answered: close its open outage, if any. */
  async markSourceReachable(source) { return this.rpc('mark_source_reachable', { p_source: source }); }
  /** Outages, for the seven-day clock the watcher counts in its own log: [{ source, since, until }]. */
  async outages() {
    const res = await this.call('/rest/v1/source_outages?select=source,since,until&order=since.desc&limit=50');
    if (!res.ok) throw new Error(`Could not read the outages: ${res.status}`);
    return res.json();
  }

  /**
   * Every live week a machine or a person re-reads (RedWeek, Interval, VakayMood), with what a re-check
   * compares: its price, nights and age. Read as an ordinary member would; nothing here is private.
   */
  async liveRows() {
    const res = await this.call('/rest/v1/deals?select=id,stay_id,source,source_ref,points_total,nights,from_date,to_date,title,seen_at,posted_at'
      + '&status=eq.live&source=in.(redweek,interval,vakaymood)&limit=3000');
    if (!res.ok) throw new Error(`Could not read the live weeks: ${res.status}`);
    return res.json();
  }
  /** Take weeks down because their source no longer shows them. Returns how many moved. Needs 20261022_board_freshness.sql. */
  async retireGone(refs, reason) { return this.rpc('retire_deals_gone', { p_refs: refs, p_reason: reason }); }
  /** Take down every watched week not seen for `days` days. Returns how many moved. */
  async retireStale(days = 7) { return this.rpc('retire_stale_deals', { p_days: days }); }
  /** A week whose price moved: the new all-in points, with the title and note that carry the price. */
  async reprice({ ref, points, title, note }) { return this.rpc('reprice_deal', { p_ref: ref, p_points: points, p_title: title || null, p_note: note || null }); }
  /** The whole board was just re-checked; this is what the top of the Stays list prints. */
  async markBoardChecked({ verified, repriced, retired }) { return this.rpc('mark_board_checked', { p_verified: verified, p_repriced: repriced, p_retired: retired }); }

  /** "RedWeek was read for this place just now" — what the stay page prints as Checked N min ago. */
  async markChecked(stayId) { return this.rpc('mark_redweek_checked', { p_stay: stayId }); }

  /**
   * The newest time any Interval week at this place was seen on a page a person grabbed, or null
   * when the Circle has never held one. That is the only evidence there is of how fresh Interval
   * is here: nothing reads Interval on a timer.
   */
  async intervalLastSeen(stayId = null) {
    // No stay means the whole board (a member opened the Stays list): the newest Interval week anywhere.
    const res = await this.call(`/rest/v1/deals?select=seen_at,posted_at&source=eq.interval${stayId ? `&stay_id=eq.${encodeURIComponent(stayId)}` : ''}&order=seen_at.desc.nullslast&limit=1`);
    if (!res.ok) throw new Error(`Could not read Interval's last grab: ${res.status}`);
    const row = (await res.json())[0];
    return row ? { seenAt: row.seen_at || row.posted_at || null } : null;
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
    const res = await this.call('/rest/v1/deals?select=source_ref,stay_id,from_date,to_date,title');
    if (!res.ok) throw new Error(`Could not read what is already on the board: ${res.status}`);
    const rows = await res.json();
    // Two keys. The source's own reference stops the same listing going up twice; the week key
    // stops the SAME WEEK going up twice from two sources — an owner lists on RedWeek and on
    // VakayMood alike, and the Desk may have put the VakayMood one up by hand. The unit is read
    // back out of the title the watcher itself writes ("place · unit · owner asking …").
    const unitOf = (t) => String(t || '').split(' · ')[1] || '';
    return {
      refs: new Set(rows.map(d => d.source_ref).filter(Boolean)),
      weeks: new Set(rows.map(d => `${d.stay_id}|${d.from_date}|${d.to_date}|${normName(unitOf(d.title))}`)),
    };
  }

  /** The two numbers a post is priced with. Any signed-in member may read them. */
  async settings() {
    const res = await this.call('/rest/v1/settings?select=points_per_dollar,service_rate&id=eq.1');
    if (!res.ok) throw new Error(`Could not read the Circle's settings: ${res.status}`);
    const row = (await res.json())[0];
    if (!row) throw new Error('The Circle has no settings row');
    return { pointsPerDollar: Number(row.points_per_dollar) || 100, serviceRate: Number(row.service_rate) || 0 };
  }

  /**
   * The catalog, so the watcher can tell a bargain from a listing. Without this it would post
   * every open week it finds, which is a hundred a day and tells nobody anything.
   */
  async stays() {
    const res = await this.call('/rest/v1/stays?select=id,name,kind,rate_low_usd,rate_high_usd,rate_peak_usd,retail_usd,min_nights&active=eq.true');
    if (!res.ok) throw new Error(`Could not read the catalog: ${res.status}`);
    return res.json();
  }

  /** Put one find on the board. `sourceRef` is what stops duplicates. */
  async post(find) {
    return this.rpc('post_deal', {
      p_stay: find.stayId,
      p_from: find.from, p_to: find.to,
      // All-in, computed by the judge from the Circle's own settings — never recomputed here.
      p_points: find.pointsTotal ?? Math.round(find.usdTotal * (find.pointsPerDollar || 100)),
      p_nights: find.nights || null,
      p_expires_at: find.expiresAt || null,
      p_title: find.title, p_note: find.note || '',
      p_retail_usd: find.retailUsd || null,
      p_source: find.source, p_source_url: find.url || '', p_source_ref: find.sourceRef,
    });
  }
}
