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
    const tables = ['members', 'contributions', 'ledger', 'stays', 'redemptions', 'announcements', 'audit'];
    const results = await Promise.all(tables.map(t => this.sb.from(t).select('*')));
    results.forEach((r, i) => { if (!r.error) this.state[tables[i]] = (r.data || []).map(toCamel); });
    // stays: fold the three rate columns into the `rates` object the UI and quoteStay() use
    this.state.stays = this.state.stays.map(s => ({ ...s, rates: { low: Number(s.rateLowUsd), high: Number(s.rateHighUsd), peak: Number(s.ratePeakUsd) }, retailUsd: Number(s.retailUsd || 0) }));
    const { data: s } = await this.sb.from('settings').select('*').eq('id', 1).maybeSingle();
    if (s) this.state.settings = { ...DEFAULT_SETTINGS, serviceRate: Number(s.service_rate), pointsPerDollar: Number(s.points_per_dollar), awgPerUsd: Number(s.awg_per_usd), tiers: s.tiers, treasurerBank: s.treasurer_bank, clubName: s.club_name };
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
  async addMember(data) { const { data: row, error } = await this.sb.from('members').insert(toSnake({ ...data, status: data.status || 'invited' })).select().single(); if (error) throw error; await this.reload(); return toCamel(row); }
  async updateMember(id, patch) { const { error } = await this.sb.from('members').update(toSnake(patch)).eq('id', id); if (error) throw error; await this.reload(); return this.member(id); }

  // ---------- contributions ----------
  async submitContribution({ memberId, amountUsd, forMonth, method = 'bank', reference = '', note = '', proofFile = null }) {
    let proof_path = null;
    if (proofFile) {
      proof_path = `${memberId}/${Date.now()}-${proofFile.name.replace(/[^\w.-]/g, '_')}`;
      const { error: upErr } = await this.sb.storage.from('proofs').upload(proof_path, proofFile, { upsert: false });
      if (upErr) throw upErr;
    }
    const { data, error } = await this.sb.from('contributions').insert({ member_id: memberId, amount_usd: amountUsd, for_month: forMonth, method, reference, note, proof_path }).select().single();
    if (error) throw error; await this.reload(); return toCamel(data);
  }
  async withdrawContribution(id) { const { error } = await this.sb.from('contributions').update({ status: 'withdrawn' }).eq('id', id); if (error) throw error; await this.reload(); }
  async confirmContribution(id, _actor, { note = '' } = {}) { return this.rpc('confirm_contribution', { p_id: id, p_note: note }); }
  async rejectContribution(id, _actor, reason) { return this.rpc('reject_contribution', { p_id: id, p_reason: reason }); }

  // ---------- redemptions ----------
  async requestRedemption({ stayId, checkIn, checkOut, guests = 2, note = '' }) { return this.rpc('request_redemption', { p_stay: stayId, p_check_in: checkIn, p_check_out: checkOut, p_guests: guests, p_note: note }); }
  async approveRedemption(id, _actor, note = '') { return this.rpc('approve_redemption', { p_id: id, p_note: note }); }
  async confirmRedemption(id, _actor, ref = '') { return this.rpc('confirm_redemption', { p_id: id, p_confirmation_ref: ref }); }
  async completeRedemption(id) { return this.rpc('complete_redemption', { p_id: id }); }
  async declineRedemption(id, _actor, reason) { return this.rpc('decline_redemption', { p_id: id, p_reason: reason }); }
  async cancelRedemption(id, _actor, reason = '') { return this.rpc('cancel_redemption', { p_id: id, p_reason: reason }); }
  async adjustPoints(memberId, points, note) { return this.rpc('adjust_points', { p_member: memberId, p_points: points, p_note: note }); }

  // ---------- catalog / announcements / settings ----------
  async upsertStay(data) {
    const { rates = {}, id, ...rest } = data;
    const row = toSnake({ ...rest, rateLowUsd: rates.low, rateHighUsd: rates.high, ratePeakUsd: rates.peak });
    delete row.rate_low_usd_undefined;
    if (id && !/^stay_|^trip_/.test(id)) row.id = id;
    const { error } = await this.sb.from('stays').upsert(row); if (error) throw error; await this.reload();
  }
  async removeStay(id) { const { error } = await this.sb.from('stays').update({ active: false }).eq('id', id); if (error) throw error; await this.reload(); }
  async postAnnouncement({ authorId, title, body, pinned = false, kind = 'news' }) { const { error } = await this.sb.from('announcements').insert({ author_id: authorId, title, body, pinned, kind }); if (error) throw error; await this.reload(); }
  async deleteAnnouncement(id) { const { error } = await this.sb.from('announcements').delete().eq('id', id); if (error) throw error; await this.reload(); }
  async updateSettings(patch) {
    const row = {};
    if (patch.serviceRate != null) row.service_rate = patch.serviceRate;
    if (patch.pointsPerDollar != null) row.points_per_dollar = patch.pointsPerDollar;
    if (patch.tiers) row.tiers = patch.tiers;
    if (patch.treasurerBank) row.treasurer_bank = patch.treasurerBank;
    if (patch.clubName) row.club_name = patch.clubName;
    const { error } = await this.sb.from('settings').update({ ...row, updated_at: new Date().toISOString() }).eq('id', 1); if (error) throw error; await this.reload();
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
