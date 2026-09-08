// SupabaseStore — the same public API as Store, but every rule runs on the
// server (see supabase/schema.sql). Rows are loaded into `state` under RLS,
// so getters/balances in Store keep working unchanged.
//
// Enable it from circle/config.js:
//   export const CONFIG = { backend: 'supabase', supabaseUrl: 'https://xxxx.supabase.co', supabaseKey: 'sb_publishable_...' }
// The pinned UMD build is loaded lazily (demo mode makes zero network requests).
export const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.min.js';
export function loadSupabaseJs() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = SUPABASE_JS_URL; s.async = true;
    s.onload = () => resolve(window.supabase); s.onerror = () => reject(new Error('Could not load supabase-js'));
    document.head.appendChild(s);
  });
}

import { Store, emptyState } from './store.js';
import { DEFAULT_SETTINGS } from './money.js';

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const snake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const toCamel = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));
const toSnake = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [snake(k), v]));

export class SupabaseStore extends Store {
  constructor({ url, key, client }) {
    super(null);
    // Implicit flow: tokens arrive in the URL fragment and are consumed before the hash router starts.
    this.sb = client || window.supabase.createClient(url, key, { auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true } });
    this.state = { ...emptyState(), settings: { ...DEFAULT_SETTINGS } };
    this.mode = 'supabase';
  }
  async init() {
    const { data: { session } } = await this.sb.auth.getSession();
    if (session) await this.afterSignIn();
    else await this.reload().catch(() => {});
    this.sb.auth.onAuthStateChange(async (_evt, s) => { if (s) { await this.afterSignIn(); } else { this.state.session = null; this.notify('session'); } });
    return this;
  }
  /**
   * Everything that has to happen once a session exists.
   *
   * Latched, because onAuthStateChange fires for the very sign-in that called this: without it
   * every real sign-in runs the whole thing twice, at the same time — two reloads of twenty
   * tables racing each other, and signInWithPassword's session check reading half-written
   * state and telling a member who is perfectly on the list that they are not on it.
   */
  async afterSignIn() {
    if (!this._afterSignIn) {
      this._afterSignIn = this._runAfterSignIn().finally(() => { this._afterSignIn = null; });
    }
    return this._afterSignIn;
  }
  async _runAfterSignIn() {
    // Quotes lapse on the clock, so somebody has to notice. Once per session, not per
    // render — releaseExpired() runs inside getters and would loop if it called out.
    //
    // try/catch, not .catch(). sb.rpc() hands back a Postgrest query builder, which is a
    // thenable — it has .then() so `await` works — but it is not a Promise and has no .catch.
    // Calling it threw before the sign-in could finish, so every member on the real backend
    // met "The Circle is not answering" while the Circle was answering perfectly well.
    try { await this.sb.rpc('release_expired_quotes'); } catch { /* a lapsed quote can wait */ }
    const { data: me, error } = await this.sb.rpc('claim_membership');
    // supabase-js resolves a FAILED fetch into { data: null, error } — it does not throw. Without
    // reading `error`, a blip on hotel wifi left `me` null and the code below signed the member
    // out with "not on the Circle's list". A transport failure is a transport failure: say so,
    // keep the session, and let init()'s catch show "The Circle is not answering".
    if (error) throw new Error('The Circle is not answering right now. Check the connection and try again.');
    if (me?.id) { this.state.session = { memberId: me.id, at: new Date().toISOString() }; this.strandedEmail = null; }
    else this.strandedEmail = (await this.sb.auth.getUser())?.data?.user?.email || 'that account';
    await this.reload();
    this.subscribeRealtime();
  }
  async reload() {
    const tables = ['members', 'contributions', 'ledger', 'stays', 'redemptions', 'pledges', 'looks', 'announcements', 'audit', 'invitations', 'month_closes', 'promo_deferrals', 'room_types', 'watches', 'deals',
      'standings', 'crews', 'crew_members', 'crew_messages', 'moments', 'moment_reactions',
      'badge_catalog', 'member_badges'];
    // members comes from a view that leaves out auth_user_id and the officer's private notes;
    // it is security_invoker, so the members_read policy still decides which rows come back.
    // standing_v answers for everybody — months held, a rank and a list of badges, and nothing
    // else. It carried months_paid and owing until the audit caught it: that was the late list
    // the club promises never to show, readable by anyone from the console.
    const source = { members: 'members_v', standings: 'standing_v' };
    const fetch1 = (t) => this.sb.from(source[t] || t).select('*');
    let results = await Promise.all(tables.map(fetch1));
    // A table that fails to load used to stay silently empty: a member three years in was shown
    // "0 points · No lines yet" as fact, and a missing settings row priced every screen off the
    // defaults. Failures are retried once; on the FIRST load any that still fail abort the load,
    // so init() falls through to the honest "not answering" screen; on a later reload the last
    // known rows are kept and the app is told which tables are stale.
    const failedOnce = tables.map((t, i) => (results[i].error ? i : -1)).filter(i => i >= 0);
    if (failedOnce.length) {
      const again = await Promise.all(failedOnce.map(i => fetch1(tables[i])));
      failedOnce.forEach((i, k) => { results[i] = again[k]; });
    }
    const failed = tables.filter((t, i) => results[i].error);
    if (failed.length && !this._loadedOnce) {
      throw new Error(`The Circle is not answering right now (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}).`);
    }
    results.forEach((r, i) => { if (!r.error) this.state[tables[i]] = (r.data || []).map(toCamel); });
    this.partial = failed;
    this.state.monthCloses = this.state.month_closes || this.state.monthCloses || [];
    this.state.promoDeferrals = this.state.promo_deferrals || this.state.promoDeferrals || [];
    this.state.roomTypes = this.state.room_types || this.state.roomTypes || [];
    this.state.crewMembers = this.state.crew_members || this.state.crewMembers || [];
    this.state.crewMessages = this.state.crew_messages || this.state.crewMessages || [];
    this.state.momentReactions = this.state.moment_reactions || this.state.momentReactions || [];
    this.state.badgeCatalog = this.state.badge_catalog || this.state.badgeCatalog || [];
    this.state.memberBadges = this.state.member_badges || this.state.memberBadges || [];
    // The database calls them from_date/to_date because `from` and `to` are awkward in SQL;
    // the rest of the app calls them from/to. Bridge it here rather than everywhere else.
    // Column names the screens do not use: full_amount is read as `full`, the stored proof
    // path is what tells the Banker a screenshot exists, and amount_usd never existed.
    this.state.contributions = this.state.contributions.map(c => ({ ...c,
      full: c.fullAmount ?? c.full ?? null,
      proofName: c.proofName || (c.proofPath ? String(c.proofPath).split('/').pop() : ''),
      amountUsd: c.amountUsd ?? c.receivedUsd ?? c.expectedUsd ?? null }));
    this.state.ledger = this.state.ledger.map(l => ({ ...l, by: l.byId ?? l.by ?? null }));
    const dated = (r) => ({ ...r, from: r.fromDate, to: r.toDate });
    this.state.watches = (this.state.watches || []).map(dated);
    this.state.deals = (this.state.deals || []).map(dated);
    // pledges live in their own table; the views expect them on the redemption
    const byRedemption = {};
    for (const p of this.state.pledges || []) (byRedemption[p.redemptionId] ||= []).push(p);
    this.state.redemptions = this.state.redemptions.map(r => ({ ...r, pledges: byRedemption[r.id] || [] }));
    // stays: fold the three rate columns into the `rates` object the UI and quoteStay() use
    this.state.stays = this.state.stays.map(s => ({ ...s,
      rates: { low: Number(s.rateLowUsd), high: Number(s.rateHighUsd), peak: Number(s.ratePeakUsd) },
      retailUsd: Number(s.retailUsd || 0),
      // What the public sites were asking, and when. toCamel does not recurse, so the nested
      // keys arrive exactly as stored. Defaulted so every reader can assume an object.
      sources: (s.sources && typeof s.sources === 'object') ? s.sources : {},
      // The Desk's photograph, as a public URL. photoFor() prefers it over anything bundled.
      photoUrl: s.photoPath ? this.sb.storage.from('stay-photos').getPublicUrl(s.photoPath).data.publicUrl : null,
      dates: s.startsOn ? { from: s.startsOn, to: s.endsOn } : undefined }));
    // Nobody signed in can read the stays table — every policy is `to authenticated`, on
    // purpose. But the public page still has to show what the Circle is for, and the same
    // catalog is already inside the JavaScript this browser just downloaded, so falling
    // back to it exposes nothing new and keeps the front page from being a blank frame.
    // Recomputed on every reload, never latched: signing in must lift it, or a member who
    // arrived at the front page first keeps being shown the stranger's copy.
    this.publicOnly = !this.state.session && !this.state.stays.length;
    if (this.publicOnly) {
      const { ARUBA_STAYS, WORLD_TRIPS } = await import('../data/stays.js');
      this.state.stays = [...ARUBA_STAYS, ...WORLD_TRIPS].map(x => ({ ...x, active: true }));
    }
    const { data: s, error: sErr } = await this.sb.from('settings').select('*').eq('id', 1).maybeSingle();
    if (sErr && !this._loadedOnce) throw new Error('The Circle is not answering right now (settings).');
    if (sErr) this.partial = [...(this.partial || []), 'settings'];
    if (s) this.state.settings = { ...DEFAULT_SETTINGS, serviceRate: Number(s.service_rate), pointsPerDollar: Number(s.points_per_dollar), awgPerUsd: Number(s.awg_per_usd), tiers: s.tiers, streakBonuses: s.streak_bonuses, foundingBonus: s.founding_bonus, memberCap: s.member_cap, exitFeeUsd: Number(s.exit_fee_usd), quoteHours: s.quote_hours, lookHours: s.look_hours || DEFAULT_SETTINGS.lookHours, minQuoteHours: s.min_quote_hours ?? 12, looksFrom: s.looks_from || null, bankerSlaHours: s.banker_sla_hours, reserveAccount: s.reserve_account, operatingAccount: s.operating_account, reserveVerified: s.reserve_verified, wallet: s.wallet, clubName: s.club_name, momentsOn: !!s.moments_on };
    this._loadedOnce = true;
    this.notify(this.partial?.length ? 'partial' : 'reload');
  }
  subscribeRealtime() {
    if (this.channel) return;
    this.channel = this.sb.channel('circle-live');
    // Deals are the whole point of the live channel: a deal posted at eleven at night has
    // to be on everyone's phone without them refreshing.
    // crew_messages is here for the same reason: a thread that only updates when you reload
    // is not a conversation. Row-level security still decides what comes back on the reload,
    // so listening for the event tells this browser nothing it could not already read.
    ['contributions', 'redemptions', 'ledger', 'announcements', 'deals', 'watches', 'crew_messages', 'crew_members']
      .forEach(t => this.channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => this.reload()));
    this.channel.subscribe();
  }
  notify(reason) { this.listeners.forEach(fn => fn(reason, this.state)); }
  async commit(reason) { this.notify(reason); }

  // ---------- auth ----------
  // Where Supabase sends you back to after an email link. It must be an exact match for one
  // of the Redirect URLs configured on the project, so it is built from the app's own URL.
  get authRedirect() { return `${location.origin}${location.pathname}#/set-password`; }

  /**
   * First time in. The email must already be on the members list — Victor or Ian put it
   * there — and the account is linked to that row by claim_membership() the moment it
   * exists. An email nobody invited gets an account with nothing behind it and no way in.
   */
  async signUpWithPassword(email, password) {
    const clean = String(email).trim().toLowerCase();
    const { data, error } = await this.sb.auth.signUp({ email: clean, password, options: { emailRedirectTo: this.authRedirect } });
    if (error) throw new Error(this.authMessage(error));
    // With email confirmation on there is no session yet: they have to open the link first.
    if (!data.session) return { confirmNeeded: true };
    const m = await this.rpc('claim_membership', {});
    if (!m) { await this.sb.auth.signOut(); throw new Error('That email is not on the Circle’s list. Ask Ian to add it first.'); }
    await this.afterSignIn();
    return { confirmNeeded: false };
  }
  /** Is this email one the club is expecting, and does it already have an account? */
  async lookupInvite(email) {
    const clean = String(email).trim().toLowerCase();
    const { data, error } = await this.sb.from('members_v').select('id, name, claimed').ilike('email', clean).maybeSingle();
    // Signed-out visitors cannot read members at all, which is the point — so a failure
    // here is expected and simply means "we cannot tell you".
    if (error) return null;
    return data ? { name: data.name, claimed: !!data.claimed } : null;
  }
  /**
   * Sign in with a username. Supabase authenticates against an email address, so one is
   * derived from the username — victor becomes victor@members.hunto.aw — and nothing is ever
   * sent there. Members never see it and never type it.
   */
  static LOGIN_DOMAIN = '@members.hunto.aw';
  async signInWithUsername(username, password) {
    const u = String(username || '').trim().toLowerCase();
    if (!u) throw new Error('Put your username in.');
    try {
      await this.signInWithPassword(u + SupabaseStore.LOGIN_DOMAIN, password);
    } catch (err) {
      // Never say which half was wrong — that tells a stranger which usernames exist. But only
      // for a genuine credential refusal: /password/ used to match "That password is right, but
      // you are not on the Circle's list", turning the one message that says exactly what to do
      // into the one that says nothing. Anything else keeps its own words.
      if (/invalid login|invalid credentials|not on the Circle's list/i.test(err.message)) {
        throw new Error('That username and password do not go together. Ask Victor or Ian if you are stuck.');
      }
      throw err;
    }
  }
  /** Change your own password. Supabase requires a live session, which is the proof it is you. */
  async setPassword(password) {
    if (String(password).length < 12) throw new Error('Use at least twelve characters');
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw new Error(this.authMessage(error));
    await this.rpc('password_changed', {});
  }
  async setMemberLogin(memberId, username, password) {
    return this.rpc('admin_set_login', { p_member: memberId, p_username: username, p_password: password });
  }
  async signInWithPassword(email, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password });
    if (error) throw new Error(this.authMessage(error));
    await this.afterSignIn();
    if (!this.state.session) {
      await this.sb.auth.signOut();
      throw new Error(`That password is right, but ${this.strandedEmail} is not on the Circle's list. Ask Victor or Ian to add that exact address.`);
    }
  }
  /** Send the reset email. Deliberately silent about whether the address is one of ours. */
  async sendPasswordReset(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(String(email).trim().toLowerCase(), { redirectTo: this.authRedirect });
    if (error && !/not found|invalid/i.test(error.message)) throw new Error(this.authMessage(error));
  }
  /** True when the page was opened from a password-reset link and can set a new one. */
  async inRecovery() {
    const { data: { session } } = await this.sb.auth.getSession();
    return !!session;
  }
  async signInWithEmail(email) {
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: this.authRedirect } });
    if (error) throw new Error(this.authMessage(error));
  }
  /** 6-digit code path, for installed home-screen apps on iOS where the link would open Safari. */
  async verifyEmailCode(email, token) {
    const { error } = await this.sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw new Error(this.authMessage(error));
  }
  /** Supabase's messages are for developers. These are for Insiders. */
  authMessage(error) {
    const m = String(error?.message || '');
    if (/invalid login credentials/i.test(m)) return 'That email and password do not match. Try again, or reset your password below.';
    if (/email not confirmed/i.test(m)) return 'Your email is not confirmed yet — open the link Ian sent you first.';
    if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a minute and go again.';
    if (/should be different/i.test(m)) return 'That is the password you already had. Pick a different one.';
    if (/weak|at least/i.test(m)) return 'That password is too easy. Use at least twelve characters.';
    if (/failed to fetch|network/i.test(m)) return 'Could not reach the Circle. Check your connection and try again.';
    return m || 'Something went wrong signing you in.';
  }
  async signIn() { throw new Error('Sign in with your email and password'); }
  async signOut() { await this.sb.auth.signOut(); this.state.session = null; this.notify('session'); }

  // ---------- members ----------
  // A member never writes their own row: roles, status and founding are not theirs to change.
  async addMember(data) { return this.rpc('admin_add_member', { p_patch: data }); }
  async updateMember(id, patch) {
    const mine = id === this.state.session?.memberId;
    if (mine && !('roles' in patch) && !('status' in patch) && !('founding' in patch)) return this.rpc('update_my_profile', { p_patch: patch });
    return this.rpc('admin_update_member', { p_id: id, p_patch: patch });
  }
  async pauseMember(id, untilMonth) { return this.rpc('set_my_status', { p_status: 'paused', p_paused_until: untilMonth }); }
  async resumeMember() { return this.rpc('set_my_status', { p_status: 'active' }); }
  async leaveMember() { return this.rpc('set_my_status', { p_status: 'left' }); }
  async createInvitation({ email = '', name = '', sponsorId, monthlyUsd = 100 }) {
    const code = `${(name || email || 'IN').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'IN'}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const { error } = await this.sb.from('invitations').insert({ code, email, name, sponsor_id: sponsorId, monthly_usd: monthlyUsd });
    if (error) throw new Error(error.message);
    await this.reload();
    return { code, email, name, monthlyUsd };
  }

  // ---------- contributions ----------
  async submitContribution({ memberId, amountUsd, forMonth, method = 'bank', bank = '', reference = '', currency = 'USD', note = '', sentOn = '', proofFile = null }) {
    let proof_path = null;
    if (proofFile) {
      proof_path = `${memberId}/${Date.now()}-${proofFile.name.replace(/[^\w.-]/g, '_')}`;
      const { error: upErr } = await this.sb.storage.from('proofs').upload(proof_path, proofFile, { upsert: false });
      if (upErr) throw new Error(upErr.message);
    }
    const { error } = await this.sb.from('contributions').insert({
      member_id: memberId, for_month: forMonth, expected_usd: amountUsd, currency, method, bank, reference, note,
      sent_on: sentOn || new Date().toISOString().slice(0, 10), proof_path,
    });
    if (error) throw new Error(error.message);
    await this.reload();
  }
  async withdrawContribution(id) { return this.rpc('withdraw_contribution', { p_id: id }); }
  async confirmContribution(id, _actor, { receivedUsd = null, currency = 'USD', native = null, note = '' } = {}) {
    return this.rpc('confirm_contribution', { p_id: id, p_received_usd: receivedUsd, p_currency: currency, p_native: native, p_note: note });
  }
  async rejectContribution(id, _actor, reason) { return this.rpc('reject_contribution', { p_id: id, p_reason: reason }); }
  async reverseContribution(id) { return this.rpc('reverse_contribution', { p_id: id }); }

  // ---------- redemptions ----------
  async requestRedemption({ stayId, checkIn, checkOut, guests = 2, seats = 1, note = '', flexDays = 0, shared = false, sourceUrl = '', sourceLabel = '' }) {
    return this.rpc('request_redemption', { p_stay: stayId, p_check_in: checkIn, p_check_out: checkOut, p_guests: guests, p_seats: seats, p_note: note, p_flex: flexDays, p_shared: shared, p_source_url: sourceUrl || null, p_source_label: sourceLabel || null });
  }
  async quoteRedemption(id, _actor, { points, stack = null, terms = '', hotelDeadline = null, note = '', lookId = null }) {
    return this.rpc('quote_redemption', { p_id: id, p_points: points, p_stack: stack, p_terms: terms, p_deadline: hotelDeadline, p_note: note, p_look: lookId });
  }
  /** A named person opened a named page and wrote down what they saw. Desk only, server-side. */
  async recordLook({ stayId, checkIn, checkOut, found, channel = 'site', url = '', label = '', priceUsd = null, roomLabel = '', note = '', redemptionId = null }) {
    const l = await this.rpc('record_look', { p_stay: stayId, p_check_in: checkIn, p_check_out: checkOut,
      p_found: found, p_channel: channel, p_url: url || null, p_label: label || null,
      p_price: priceUsd, p_room_label: roomLabel || null, p_note: note || null, p_redemption: redemptionId });
    await this.reload();
    return l;
  }
  async acceptQuote(id) {
    // A lapsed quote comes back as the expired row rather than an exception, because raising
    // would roll back the write that records the expiry. The message belongs here.
    const r = await this.rpc('accept_quote', { p_id: id });
    if (r?.status === 'expired') throw new Error('That quote has expired — ask the Desk to quote it again.');
    return r;
  }
  async pledgeToRedemption(id, _memberId, points) { return this.rpc('pledge_to_redemption', { p_id: id, p_points: points }); }
  async withdrawPledge(id, memberId) { return this.rpc('withdraw_pledge', { p_id: id, p_member: memberId }); }
  async confirmTopUp(id) { return this.rpc('confirm_top_up', { p_id: id }); }
  async payRedemption(id, _actor, { paidUsd = null, confirmationRef = '' } = {}) {
    return this.rpc('pay_redemption', { p_id: id, p_paid_usd: paidUsd, p_confirmation: confirmationRef });
  }
  async completeRedemption(id) { return this.rpc('complete_redemption', { p_id: id }); }
  async declineRedemption(id, _actor, reason) { return this.rpc('decline_redemption', { p_id: id, p_reason: reason }); }
  async cancelRedemption(id, _actor, { reason = '', penaltyPoints = 0 } = {}) {
    return this.rpc('cancel_redemption', { p_id: id, p_reason: reason, p_penalty_points: penaltyPoints });
  }
  async adjustPoints(memberId, points, note) { return this.rpc('adjust_points', { p_member: memberId, p_points: points, p_reason: note }); }
  async closeMonth(month, _actor, { bankBalanceUsd, cosignerId, note = '' }) {
    return this.rpc('close_month', { p_month: month, p_bank_balance_usd: bankBalanceUsd, p_cosigner: cosignerId, p_note: note });
  }

  // ---------- catalog, notes, settings ----------
  /**
   * Create or edit a place; optionally put a photograph on it or take one off. The row is
   * written first, so a NEW stay has the uuid its photo is filed under, then the object goes to
   * the bucket and the four photo columns are set. If the second half fails the first has
   * already happened, and the error says exactly that.
   */
  async upsertStay(data) {
    const { rates = {}, id, dates, photoFile = null, photoRemove = false, photoNote, photoUrl, photoBy, photoAt, ...rest } = data;
    if (photoFile && !String(photoNote || '').trim()) throw new Error('Say where the photograph came from before saving it.');
    const row = toSnake({ ...rest, rateLowUsd: rates.low, rateHighUsd: rates.high, ratePeakUsd: rates.peak,
      startsOn: dates?.from, endsOn: dates?.to });
    for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
    if (id && /^[0-9a-f-]{36}$/.test(id)) row.id = id;
    // A note edited on its own is fine while a photo is there; the constraint only insists that
    // a path never sits without one.
    if (!photoFile && !photoRemove && photoNote !== undefined && String(photoNote).trim()) row.photo_note = String(photoNote).trim();
    const { data: saved, error } = await this.sb.from('stays').upsert(row).select('id, photo_path').single();
    if (error) throw new Error(error.message);
    const stayId = saved.id;
    const old = saved.photo_path || null;
    try {
      if (photoFile) {
        const { shrinkImage } = await import('./image.js');
        const blob = await shrinkImage(photoFile);
        const path = `stays/${stayId}/${Date.now()}.jpg`;
        const { error: upErr } = await this.sb.storage.from('stay-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (upErr) throw new Error(upErr.message);
        const { error: setErr } = await this.sb.from('stays')
          .update({ photo_path: path, photo_note: String(photoNote).trim(), photo_by: this.me?.id || null, photo_at: new Date().toISOString() })
          .eq('id', stayId);
        if (setErr) throw new Error(setErr.message);
        if (old && old !== path) await this.sb.storage.from('stay-photos').remove([old]).catch(() => {});
      } else if (photoRemove && old) {
        const { error: clrErr } = await this.sb.from('stays')
          .update({ photo_path: null, photo_note: null, photo_by: null, photo_at: null }).eq('id', stayId);
        if (clrErr) throw new Error(clrErr.message);
        await this.sb.storage.from('stay-photos').remove([old]).catch(() => {});
      }
    } catch (err) {
      await this.reload();
      throw new Error(`The stay was saved, but the photograph was not: ${err.message}`);
    }
    await this.reload();
    return stayId;
  }
  // ---------- room types, the watch list and deals ----------
  // Without these the base class would happily mutate its own copy of the state and never
  // tell the server, which looks like it worked until the next reload.
  async upsertRoomType(data) { return this.rpc('upsert_room_type', { p_patch: data }); }
  async removeRoomType(id) { return this.rpc('upsert_room_type', { p_patch: { id, active: false } }); }

  async addWatch({ stayId = null, roomTypeId = null, kind = 'aruba', from, to, nights = 3, flexDays = 3, guests = 2, maxPoints = null, note = '' }) {
    const w = await this.rpc('add_watch', { p_stay: stayId, p_from: from, p_to: to, p_nights: nights,
      p_room_type: roomTypeId, p_kind: kind, p_flex: flexDays, p_guests: guests, p_max_points: maxPoints, p_note: note });
    return w ? { ...w, from: w.fromDate, to: w.toDate } : w;
  }
  async removeWatch(id) { return this.rpc('remove_watch', { p_id: id }); }
  async markWatchesSeen() { return this.rpc('mark_watches_seen', {}); }

  async postDeal({ stayId, roomTypeId = null, from, to, pointsTotal = null, pointsPerNight = null, nights = null,
                   title = '', retailUsd = null, source = 'other', sourceUrl = '', sourceRef = '', units = 1, expiresAt = null, note = '' }) {
    const n = nights || null;
    const points = pointsTotal != null ? pointsTotal : (pointsPerNight != null && n ? pointsPerNight * n : null);
    const d = await this.rpc('post_deal', { p_stay: stayId, p_from: from, p_to: to, p_points: points,
      p_room_type: roomTypeId, p_title: title, p_nights: n, p_retail_usd: retailUsd, p_source: source,
      p_source_url: sourceUrl, p_source_ref: sourceRef, p_units: units, p_expires_at: expiresAt, p_note: note });
    return d ? { ...d, from: d.fromDate, to: d.toDate } : d;
  }
  async retireDeal(id, _actorId, reason = '') { return this.rpc('retire_deal', { p_id: id, p_reason: reason }); }

  // ---------- crews ----------
  // These are ordinary table writes: row-level security decides who may do what, so there is
  // nothing here to enforce twice. The one exception is making a crew, which has to insert the
  // crew and its first lead together — a half-made crew has no lead, and then nobody can add
  // one, which is exactly the hole create_crew() exists to close.
  async createCrew({ name, about = '', redemptionId = null }) {
    const id = await this.rpc('create_crew', { p_name: name, p_about: about || null, p_redemption: redemptionId });
    await this.reload();
    return this.crew(id) || { id, name, about };
  }
  async addToCrew(crewId, memberId) {
    const { error } = await this.sb.from('crew_members').insert({ crew_id: crewId, member_id: memberId, role: 'member' });
    if (error) throw new Error(/row-level security/i.test(error.message)
      ? 'Only the crew’s lead can add people' : error.message);
    await this.reload();
  }
  async leaveCrew(crewId, memberId = this.me?.id) {
    const roster = this.crewRoster(crewId);
    const leads = roster.filter(m => m.role === 'lead');
    if (leads.length === 1 && leads[0].memberId === memberId && roster.length > 1) {
      throw new Error('Make somebody else the lead first');
    }
    const { error } = await this.sb.from('crew_members').delete().eq('crew_id', crewId).eq('member_id', memberId);
    if (error) throw new Error(error.message);
    await this.reload();
  }
  async renameCrew(crewId, patch) {
    const row = {};
    if (patch.name !== undefined) row.name = String(patch.name).trim();
    if (patch.about !== undefined) row.about = String(patch.about).trim() || null;
    const { error } = await this.sb.from('crews').update(row).eq('id', crewId);
    if (error) throw new Error(/row-level security/i.test(error.message)
      ? 'Only the crew’s lead can change this' : error.message);
    await this.reload();
  }
  async sendCrewMessage(crewId, body) {
    const text = String(body || '').trim();
    if (!text) throw new Error('Say something first');
    const { error } = await this.sb.from('crew_messages')
      .insert({ crew_id: crewId, member_id: this.me.id, body: text });
    if (error) throw new Error(/row-level security/i.test(error.message)
      ? 'You are not in that crew' : error.message);
    await this.reload();
  }
  async deleteCrewMessage(id) {
    // The row stays, so the conversation keeps its shape; only the words go.
    const { error } = await this.sb.from('crew_messages')
      .update({ body: null, deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(/row-level security/i.test(error.message)
      ? 'Those are not your words' : error.message);
    await this.reload();
  }

  // Badges. Buying burns points and writes the ledger, so it has to be the server's decision;
  // pinning is checked there too, or a member could display a badge they do not hold.
  async buyBadge(key) { return this.rpc('buy_badge', { p_key: key }); }
  async pinBadges(keys) { return this.rpc('pin_badges', { p_keys: keys }); }
  async grantBadge(memberId, key) { return this.rpc('grant_badge', { p_member: memberId, p_key: key }); }

  async setGoal(_memberId, goal) { return this.rpc('set_my_goal', { p_goal: goal }); }
  async recordDirectContribution({ memberId, amountUsd, forMonth = null, method = 'cash', currency = 'USD', note = '' }) {
    return this.rpc('record_direct_contribution', { p_member: memberId, p_amount: amountUsd,
      p_for_month: forMonth, p_method: method, p_currency: currency, p_note: note });
  }

  async removeStay(id) { const { error } = await this.sb.from('stays').update({ active: false }).eq('id', id); if (error) throw new Error(error.message); await this.reload(); }
  async postAnnouncement({ authorId, title, body, pinned = false, kind = 'note' }) {
    const { error } = await this.sb.from('announcements').insert({ author_id: authorId, title, body, pinned, kind });
    if (error) throw new Error(error.message); await this.reload();
  }
  async deleteAnnouncement(id) { const { error } = await this.sb.from('announcements').delete().eq('id', id); if (error) throw new Error(error.message); await this.reload(); }
  // The settings row holds two different kinds of thing. The Banker owns the account details;
  // the Admin owns everything that prices a point. The database enforces that with a column
  // grant, so send each half down the path it is allowed to take.
  static RULE_FIELDS = ['serviceRate', 'pointsPerDollar', 'awgPerUsd', 'memberCap', 'quoteHours', 'bankerSlaHours', 'exitFeeUsd', 'tiers', 'clubName'];
  async updateSettings(patch) {
    const rules = Object.fromEntries(Object.entries(patch).filter(([k]) => SupabaseStore.RULE_FIELDS.includes(k)));
    if (Object.keys(rules).length) await this.rpc('update_club_rules', { p_patch: rules });

    const row = {};
    const map = { reserveAccount: 'reserve_account', operatingAccount: 'operating_account', wallet: 'wallet', momentsOn: 'moments_on' };
    for (const [k, v] of Object.entries(patch)) if (map[k]) row[map[k]] = v;
    if (!Object.keys(row).length) { await this.reload(); return; }
    const { error } = await this.sb.from('settings').update({ ...row, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) throw new Error(error.message); await this.reload();
  }
  async proofUrl(path) { const { data } = await this.sb.storage.from('proofs').createSignedUrl(path, 600); return data?.signedUrl || null; }

  async rpc(fn, args) {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    await this.reload();
    // Only a row gets its keys camel-cased. A function that returns a bare value — create_crew
    // returns a uuid, season_for returns text — must come back as that value: Object.entries on
    // a string gives {0:'3', 1:'f', …}, so the caller got an object of single characters and
    // every use of it read "[object Object]". Creating a crew made the crew and then sent the
    // member to #/crews/[object Object], which answers "Not your crew" — the club's own
    // "you cannot make a circle".
    if (data === null || data === undefined) return data;
    if (Array.isArray(data)) return data.map(r => (r && typeof r === 'object' ? toCamel(r) : r));
    return typeof data === 'object' ? toCamel(data) : data;
  }
  log() { /* server writes audit */ }
  async reset() { throw new Error('Reset is only available in local mode'); }
  // Restoring a JSON backup rewrites the local copy only, and the next reload throws it
  // away. Saying "Restored." while nothing happened is worse than refusing.
  async importJson() {
    throw new Error('Restoring a backup has to be done in Supabase, not from here. The file you downloaded is a record, not a restore point.');
  }
  // There is no way to accept an invitation from a signed-out browser: the invitations
  // table is readable by admins only, by design. Someone joins by being put on the list
  // and then setting their own password, which is what the sign-in screen offers.
  async acceptInvitation() {
    throw new Error('Ask Victor or Ian for a username and a password — they hand it to you directly, nothing is emailed.');
  }
}
