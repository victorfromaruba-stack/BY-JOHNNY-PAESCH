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

import { Store } from './store.js';
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
    this.state = { settings: { ...DEFAULT_SETTINGS }, members: [], contributions: [], ledger: [], stays: [], redemptions: [], announcements: [], audit: [], session: null };
    this.mode = 'supabase';
  }
  async init() {
    const { data: { session } } = await this.sb.auth.getSession();
    if (session) await this.afterSignIn();
    this.sb.auth.onAuthStateChange(async (_evt, s) => { if (s) { await this.afterSignIn(); } else { this.state.session = null; this.notify('session'); } });
    return this;
  }
  async afterSignIn() {
    const { data: me } = await this.sb.rpc('claim_membership');
    if (me?.id) this.state.session = { memberId: me.id, at: new Date().toISOString() };
    await this.reload();
    this.subscribeRealtime();
  }
  async reload() {
    const tables = ['members', 'contributions', 'ledger', 'stays', 'redemptions', 'pledges', 'announcements', 'audit', 'invitations', 'month_closes', 'promo_deferrals'];
    const results = await Promise.all(tables.map(t => this.sb.from(t).select('*')));
    results.forEach((r, i) => { if (!r.error) this.state[tables[i]] = (r.data || []).map(toCamel); });
    this.state.monthCloses = this.state.month_closes || [];
    this.state.promoDeferrals = this.state.promo_deferrals || [];
    // pledges live in their own table; the views expect them on the redemption
    const byRedemption = {};
    for (const p of this.state.pledges || []) (byRedemption[p.redemptionId] ||= []).push(p);
    this.state.redemptions = this.state.redemptions.map(r => ({ ...r, pledges: byRedemption[r.id] || [] }));
    // stays: fold the three rate columns into the `rates` object the UI and quoteStay() use
    this.state.stays = this.state.stays.map(s => ({ ...s,
      rates: { low: Number(s.rateLowUsd), high: Number(s.rateHighUsd), peak: Number(s.ratePeakUsd) },
      retailUsd: Number(s.retailUsd || 0),
      dates: s.startsOn ? { from: s.startsOn, to: s.endsOn } : undefined }));
    const { data: s } = await this.sb.from('settings').select('*').eq('id', 1).maybeSingle();
    if (s) this.state.settings = { ...DEFAULT_SETTINGS, serviceRate: Number(s.service_rate), pointsPerDollar: Number(s.points_per_dollar), awgPerUsd: Number(s.awg_per_usd), tiers: s.tiers, streakBonuses: s.streak_bonuses, foundingBonus: s.founding_bonus, memberCap: s.member_cap, exitFeeUsd: Number(s.exit_fee_usd), quoteHours: s.quote_hours, bankerSlaHours: s.banker_sla_hours, reserveAccount: s.reserve_account, operatingAccount: s.operating_account, reserveVerified: s.reserve_verified, wallet: s.wallet, clubName: s.club_name };
    this.notify('reload');
  }
  subscribeRealtime() {
    if (this.channel) return;
    this.channel = this.sb.channel('circle-live');
    ['contributions', 'redemptions', 'ledger', 'announcements'].forEach(t => this.channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => this.reload()));
    this.channel.subscribe();
  }
  notify(reason) { this.listeners.forEach(fn => fn(reason, this.state)); }
  async commit(reason) { this.notify(reason); }

  // ---------- auth ----------
  async signInWithEmail(email) {
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw error;
  }
  /** 6-digit code path, for installed home-screen apps on iOS where the link would open Safari. */
  async verifyEmailCode(email, token) {
    const { error } = await this.sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
  }
  async signIn() { throw new Error('Use signInWithEmail in Supabase mode'); }
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
  async requestRedemption({ stayId, checkIn, checkOut, guests = 2, seats = 1, note = '', flexDays = 0, shared = false }) {
    return this.rpc('request_redemption', { p_stay: stayId, p_check_in: checkIn, p_check_out: checkOut, p_guests: guests, p_seats: seats, p_note: note, p_flex: flexDays, p_shared: shared });
  }
  async quoteRedemption(id, _actor, { points, stack = null, terms = '', hotelDeadline = null, note = '' }) {
    return this.rpc('quote_redemption', { p_id: id, p_points: points, p_stack: stack, p_terms: terms, p_deadline: hotelDeadline, p_note: note });
  }
  async acceptQuote(id) { return this.rpc('accept_quote', { p_id: id }); }
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
  async upsertStay(data) {
    const { rates = {}, id, dates, ...rest } = data;
    const row = toSnake({ ...rest, rateLowUsd: rates.low, rateHighUsd: rates.high, ratePeakUsd: rates.peak,
      startsOn: dates?.from, endsOn: dates?.to });
    for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
    if (id && /^[0-9a-f-]{36}$/.test(id)) row.id = id;
    const { error } = await this.sb.from('stays').upsert(row);
    if (error) throw new Error(error.message);
    await this.reload();
  }
  async removeStay(id) { const { error } = await this.sb.from('stays').update({ active: false }).eq('id', id); if (error) throw new Error(error.message); await this.reload(); }
  async postAnnouncement({ authorId, title, body, pinned = false, kind = 'note' }) {
    const { error } = await this.sb.from('announcements').insert({ author_id: authorId, title, body, pinned, kind });
    if (error) throw new Error(error.message); await this.reload();
  }
  async deleteAnnouncement(id) { const { error } = await this.sb.from('announcements').delete().eq('id', id); if (error) throw new Error(error.message); await this.reload(); }
  async updateSettings(patch) {
    const row = {};
    const map = { serviceRate: 'service_rate', pointsPerDollar: 'points_per_dollar', memberCap: 'member_cap',
      quoteHours: 'quote_hours', bankerSlaHours: 'banker_sla_hours', exitFeeUsd: 'exit_fee_usd',
      tiers: 'tiers', reserveAccount: 'reserve_account', operatingAccount: 'operating_account', clubName: 'club_name', wallet: 'wallet' };
    for (const [k, v] of Object.entries(patch)) if (map[k]) row[map[k]] = v;
    const { error } = await this.sb.from('settings').update({ ...row, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) throw new Error(error.message); await this.reload();
  }
  async proofUrl(path) { const { data } = await this.sb.storage.from('proofs').createSignedUrl(path, 600); return data?.signedUrl || null; }

  async rpc(fn, args) {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    await this.reload();
    return data ? toCamel(data) : data;
  }
  log() { /* server writes audit */ }
  async reset() { throw new Error('Reset is only available in local mode'); }
}
