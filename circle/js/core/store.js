// The data layer. One public API, two implementations:
//   Store + LocalAdapter   – everything in this browser, seeded demo data.
//   SupabaseStore          – same API; every rule runs server-side (supabase/schema.sql).
// Business rules live here so the demo and the real club produce identical numbers.

import { uid, nowIso, sum, monthKey, fmtMonth } from './util.js';
import { DEFAULT_SETTINGS, splitContribution, tierFor, quoteStay, canReach, reachOf, tierNeededFor, REACH } from './money.js';
import { initialsOf } from './vocab.js';

export const CONTRIBUTION_STATUS = Object.freeze({ pending: 'pending', confirmed: 'confirmed', rejected: 'rejected', withdrawn: 'withdrawn', reversed: 'reversed' });
export const REDEMPTION_STATUS = Object.freeze({ requested: 'requested', quoted: 'quoted', held: 'held', confirmed: 'confirmed', completed: 'completed', declined: 'declined', expired: 'expired', cancelled: 'cancelled' });
export const OPEN_REDEMPTION = [REDEMPTION_STATUS.requested, REDEMPTION_STATUS.quoted, REDEMPTION_STATUS.held];
export const LEDGER_KIND = Object.freeze({ earn: 'earn', bonus: 'bonus', streak: 'streak', founding: 'founding', burn: 'burn', refund: 'refund', adjust: 'adjust', expire: 'expire', reverse: 'reverse' });
export const PROMO_KINDS = [LEDGER_KIND.bonus, LEDGER_KIND.streak, LEDGER_KIND.founding];
export const ROLES = Object.freeze(['member', 'treasurer', 'deputy', 'planner', 'comms', 'admin']);
const COLLECTIONS = ['members', 'contributions', 'ledger', 'stays', 'redemptions', 'announcements', 'audit', 'invitations', 'monthCloses', 'promoDeferrals', 'rulesAcceptances'];

const asc = (k) => (a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0);
const desc = (k) => (a, b) => (a[k] < b[k] ? 1 : a[k] > b[k] ? -1 : 0);
export function shiftMonth(yyyyMm, n) { const [y, m] = yyyyMm.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
const addHours = (iso, h) => new Date(new Date(iso).getTime() + h * 3600000).toISOString();
const addMonthsIso = (iso, n) => { const d = new Date(iso); d.setMonth(d.getMonth() + n); return d.toISOString(); };

export class Store {
  constructor(adapter) { this.adapter = adapter; this.listeners = new Set(); this.state = null; this.mode = 'local'; }
  async init() {
    this.state = await this.adapter.load();
    this.normalize();
    return this;
  }
  normalize() {
    this.state.settings = { ...DEFAULT_SETTINGS, ...(this.state.settings || {}) };
    for (const c of COLLECTIONS) this.state[c] ||= [];
    this.state.session ||= this.adapter.loadSession?.() || null;
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify(reason) { this.listeners.forEach(fn => fn(reason, this.state)); }
  async commit(reason) { await this.adapter.save(this.state); this.notify(reason); }
  async refreshFromAdapter() {
    const session = this.state.session;
    this.state = await this.adapter.load();
    this.normalize();
    this.state.session = session;
    this.notify('remote');
  }

  // ---------- session ----------
  get session() { return this.state.session; }
  get me() { return this.state.session ? this.member(this.state.session.memberId) : null; }
  hasRole(...roles) { const m = this.me; return !!m && roles.some(r => m.roles.includes(r)); }
  isOfficer() { return this.hasRole('treasurer', 'deputy', 'planner', 'comms', 'admin'); }
  canConfirmMoney() { return this.hasRole('treasurer', 'deputy'); }
  canPlan() { return this.hasRole('planner', 'admin'); }
  canQuote(redemption) { const s = this.stay(redemption?.stayId); return this.hasRole('planner', 'admin') || (this.hasRole('comms') && s?.kind === 'trip'); }
  async signIn(memberId) {
    const m = this.member(memberId); if (!m) throw new Error('No such member');
    this.state.session = { memberId, at: nowIso() };
    this.adapter.saveSession?.(this.state.session);
    this.notify('session');
    return m;
  }
  async signOut() { this.state.session = null; this.adapter.saveSession?.(null); this.notify('session'); }

  // ---------- lookups ----------
  get settings() { return this.state.settings; }
  member(id) { return this.state.members.find(m => m.id === id) || null; }
  get members() { return this.state.members; }
  activeMembers() { return this.state.members.filter(m => m.status === 'active'); }
  expectedMembers(month) { return this.state.members.filter(m => (m.status === 'active' || (m.status === 'paused' && m.pausedUntil && m.pausedUntil < month)) && (m.joinedAt || '').slice(0, 7) <= month); }
  stay(id) { return this.state.stays.find(s => s.id === id) || null; }
  get stays() { return this.state.stays; }
  arubaStays() { return this.state.stays.filter(s => s.kind === 'aruba' && s.active); }
  trips() { return this.state.stays.filter(s => s.kind === 'trip' && s.active); }
  contribution(id) { return this.state.contributions.find(c => c.id === id) || null; }
  redemption(id) { return this.state.redemptions.find(r => r.id === id) || null; }
  contributionsFor(memberId) { return this.state.contributions.filter(c => c.memberId === memberId).sort(desc('submittedAt')); }
  redemptionsFor(memberId) { this.releaseExpired(); return this.state.redemptions.filter(r => r.memberId === memberId).sort(desc('requestedAt')); }
  ledgerFor(memberId) { return this.state.ledger.filter(l => l.memberId === memberId).sort(desc('at')); }
  pendingContributions() { return this.state.contributions.filter(c => c.status === CONTRIBUTION_STATUS.pending).sort(asc('submittedAt')); }
  openRedemptions() { this.releaseExpired(); return this.state.redemptions.filter(r => OPEN_REDEMPTION.includes(r.status)).sort(asc('requestedAt')); }
  announcements() { return [...this.state.announcements].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (a.at < b.at ? 1 : -1)); }
  audit(limit = 50) { return [...this.state.audit].sort(desc('at')).slice(0, limit); }
  seatsHeld(tripId) { return sum(this.state.redemptions.filter(r => r.stayId === tripId && [...OPEN_REDEMPTION, REDEMPTION_STATUS.confirmed].includes(r.status)), r => r.guests || 1); }
  rosterFor(tripId) { return this.state.redemptions.filter(r => r.stayId === tripId && [...OPEN_REDEMPTION, REDEMPTION_STATUS.confirmed, REDEMPTION_STATUS.completed].includes(r.status)).map(r => this.member(r.memberId)).filter(Boolean); }

  // ---------- balances ----------
  ledgerBalance(memberId) { return sum(this.ledgerFor(memberId), l => l.points); }
  /** Points a member cannot spend twice: their own held booking, plus anything pledged to someone else's. */
  committedPoints(memberId) {
    const own = sum(this.state.redemptions.filter(r => r.memberId === memberId && r.status === REDEMPTION_STATUS.held), r => r.points);
    const pledged = sum(this.state.redemptions.filter(r => [REDEMPTION_STATUS.quoted, REDEMPTION_STATUS.held].includes(r.status)),
      r => sum((r.pledges || []).filter(p => p.memberId === memberId), p => p.points));
    return own + pledged;
  }
  /** Everything covered so far on a booking: the requester's points plus every pledge. */
  coveredPoints(r) { return (r.points || 0) + sum(r.pledges || [], p => p.points); }
  pledgesOn(redemptionId) { return this.redemption(redemptionId)?.pledges || []; }
  /** Can this member ask for this stay or trip at their level? */
  canReachStay(stay, memberId = this.session?.memberId) {
    const m = this.member(memberId); if (!m || !stay) return false;
    return canReach(this.settings, m.monthlyUsd, stay);
  }
  tierNeededFor(stay) { return tierNeededFor(this.settings, stay); }
  /** Bookings anyone in the Circle can still chip in to. */
  openToChipIn() {
    this.releaseExpired();
    return this.state.redemptions
      .filter(r => r.shared && [REDEMPTION_STATUS.quoted, REDEMPTION_STATUS.held].includes(r.status) && this.coveredPoints(r) < (r.quotedPoints || r.indicativePoints || 0))
      .sort(asc('requestedAt'));
  }
  availablePoints(memberId) { return this.ledgerBalance(memberId) - this.committedPoints(memberId); }
  promoPoints(memberId) { return sum(this.ledgerFor(memberId).filter(l => PROMO_KINDS.includes(l.kind)), l => l.points); }
  basePoints(memberId) { return Math.max(0, this.ledgerBalance(memberId) - this.promoPoints(memberId)); }
  lifetime(memberId) {
    const cs = this.state.contributions.filter(c => c.memberId === memberId && c.status === CONTRIBUTION_STATUS.confirmed);
    const led = this.ledgerFor(memberId);
    return {
      paidUsd: sum(cs, c => c.receivedUsd), shareUsd: sum(cs, c => c.shareUsd), backingUsd: sum(cs, c => c.backingUsd),
      promoPoints: sum(led.filter(l => PROMO_KINDS.includes(l.kind)), l => l.points),
      burnedPoints: -sum(led.filter(l => l.kind === LEDGER_KIND.burn), l => l.points),
      expiredPoints: -sum(led.filter(l => l.kind === LEDGER_KIND.expire), l => l.points),
      balance: this.ledgerBalance(memberId), committed: this.committedPoints(memberId), available: this.availablePoints(memberId),
    };
  }
  balanceSeries(memberId) { let bal = 0; return this.ledgerFor(memberId).slice().reverse().map(r => ({ at: r.at, points: (bal += r.points), entry: r })); }
  /**
   * The club-wide money view.
   *
   * The Reserve is tracked from cash facts, not from the points themselves: money
   * allocated to backing when the Banker confirms a transfer, bonus money the Circle
   * moves over from Operating, cash top-ups received, minus what was actually paid to
   * hotels and minus promotional points that expired back to Operating. The liability
   * is the points members hold. The two are computed independently on purpose — if they
   * ever disagree, something is wrong, and the month close catches it against the bank.
   */
  treasury() {
    const s = this.settings, ppd = s.pointsPerDollar;
    const confirmed = this.state.contributions.filter(c => c.status === CONTRIBUTION_STATUS.confirmed);
    const collected = sum(confirmed, c => c.receivedUsd);
    const share = sum(confirmed, c => c.shareUsd);
    const backing = sum(confirmed, c => c.backingUsd);
    const led = this.state.ledger;
    // Promotional points the Circle funded, ignoring any whose contribution was reversed.
    const live = (l) => !(l.refType === 'contribution' && this.contribution(l.refId)?.status === CONTRIBUTION_STATUS.reversed);
    const promoUsd = sum(led.filter(l => PROMO_KINDS.includes(l.kind) && live(l)), l => l.points) / ppd;
    // Money that actually left the Reserve: every booking the club has paid for, including
    // ones later cancelled — whatever the hotel gave back comes in again as a refund line.
    const settled = this.state.redemptions.filter(r => !!r.confirmedAt);
    const paidOutUsd = sum(settled, r => (r.paidUsd == null ? r.points / ppd : r.paidUsd));
    const topUpsUsd = sum(settled.filter(r => r.topUpConfirmed), r => r.topUpUsd || 0);
    const burnedUsd = -sum(led.filter(l => l.kind === LEDGER_KIND.burn), l => l.points) / ppd;
    const refundedUsd = sum(led.filter(l => l.kind === LEDGER_KIND.refund), l => l.points) / ppd;
    const adjustUsd = sum(led.filter(l => l.kind === LEDGER_KIND.adjust), l => l.points) / ppd;
    const expiredUsd = -sum(led.filter(l => l.kind === LEDGER_KIND.expire), l => l.points) / ppd;
    const reserveExpectedUsd = round(backing + promoUsd + topUpsUsd - paidOutUsd + refundedUsd + adjustUsd - expiredUsd);
    const outstandingPoints = sum(this.state.members, m => this.ledgerBalance(m.id));
    const liabilityUsd = round(outstandingPoints / ppd);
    // Coverage is measured against what the ledger says the Reserve holds. Whether the
    // bank agrees is a separate, dated fact: the Banker's verification and its variance.
    const verified = s.reserveVerified;
    const reserveUsd = reserveExpectedUsd;
    const verifiedVarianceUsd = verified ? round(Number(verified.balanceUsd) - reserveExpectedUsd) : null;
    const accountsConfigured = !!(s.reserveAccount?.number && s.operatingAccount?.number && s.reserveAccount.number !== s.operatingAccount.number);
    const thisMonth = monthKey();
    const expected = this.expectedMembers(thisMonth);
    const confirmedThisMonth = expected.filter(m => this.monthStatus(m.id, thisMonth) === 'confirmed').length;
    return {
      collected: round(collected), share: round(share), backing: round(backing), promoUsd: round(promoUsd),
      burnedUsd: round(burnedUsd), paidOutUsd: round(paidOutUsd), topUpsUsd: round(topUpsUsd),
      refundedUsd: round(refundedUsd), expiredUsd: round(expiredUsd),
      operatingUsd: round(share - promoUsd + expiredUsd), reserveExpectedUsd, reserveUsd: round(reserveUsd),
      liabilityUsd, outstandingPoints, coverage: liabilityUsd ? reserveUsd / liabilityUsd : 1,
      verified, verifiedVarianceUsd, accountsConfigured,
      pendingCount: this.pendingContributions().length, pendingUsd: sum(this.pendingContributions(), c => c.expectedUsd),
      membersActive: this.activeMembers().length, monthly: sum(this.activeMembers(), m => m.monthlyUsd),
      expectedThisMonth: expected.length, confirmedThisMonth,
      lastClose: [...this.state.monthCloses].sort(desc('closedAt'))[0] || null,
    };
  }
  monthlySeries(months = 12) {
    const out = []; let m = shiftMonth(monthKey(), -(months - 1));
    for (let i = 0; i < months; i++) {
      const cs = this.state.contributions.filter(c => c.forMonth === m && c.status === CONTRIBUTION_STATUS.confirmed);
      out.push({ month: m, collected: round(sum(cs, c => c.receivedUsd)), backing: round(sum(cs, c => c.backingUsd)), share: round(sum(cs, c => c.shareUsd)), count: cs.length });
      m = shiftMonth(m, 1);
    }
    return out;
  }
  monthsCovered(memberId) { return new Set(this.state.contributions.filter(c => c.memberId === memberId && c.status === CONTRIBUTION_STATUS.confirmed && c.full).map(c => c.forMonth)); }
  monthStatus(memberId, month = monthKey()) {
    const m = this.member(memberId);
    if (m?.status === 'paused' && (!m.pausedUntil || m.pausedUntil >= month)) return 'paused';
    const cs = this.state.contributions.filter(c => c.memberId === memberId && c.forMonth === month);
    if (cs.some(c => c.status === CONTRIBUTION_STATUS.confirmed)) return 'confirmed';
    if (cs.some(c => c.status === CONTRIBUTION_STATUS.pending)) return 'pending';
    return 'due';
  }
  /** Consecutive confirmed months ending at `month`. Paused months are stepped over: a pause freezes a streak, it does not reset it. */
  consecutiveMonthsThrough(memberId, month) {
    const covered = this.monthsCovered(memberId);
    const paused = new Set(this.member(memberId)?.pausedMonths || []);
    const joined = (this.member(memberId)?.joinedAt || '').slice(0, 7);
    let n = 0, m = month;
    while (m >= joined) {
      if (covered.has(m)) { n++; m = shiftMonth(m, -1); continue; }
      if (paused.has(m)) { m = shiftMonth(m, -1); continue; }
      break;
    }
    return n;
  }
  streak(memberId) { let m = monthKey(); if (!this.monthsCovered(memberId).has(m)) m = shiftMonth(m, -1); return this.consecutiveMonthsThrough(memberId, m); }
  nextMilestone(memberId) { const s = this.streak(memberId); const ms = Object.keys(this.settings.streakBonuses).map(Number).sort((a, b) => a - b); return ms.find(x => x > s) || null; }
  openHolds(memberId) { return this.state.redemptions.filter(r => r.memberId === memberId && OPEN_REDEMPTION.includes(r.status)).length; }

  // ---------- members / invitations ----------
  async createInvitation({ email = '', sponsorId, monthlyUsd = 100, name = '' }, actorId) {
    const inv = { code: `${initialsOf(name || email || 'XX') || 'IN'}${Math.random().toString(36).slice(2, 6).toUpperCase()}`, email, name, sponsorId, monthlyUsd, createdAt: nowIso(), expiresAt: addMonthsIso(nowIso(), 1), acceptedMemberId: null };
    this.state.invitations.push(inv);
    this.log(actorId, 'invitation.create', 'invitation', inv.code, { email });
    await this.commit('invitations');
    return inv;
  }
  invitation(code) { return this.state.invitations.find(i => i.code.toUpperCase() === String(code).toUpperCase() && !i.acceptedMemberId) || null; }
  async acceptInvitation(code, { name, email = '', phone = '', monthlyUsd, household = [], preferences = {}, standingOrder = false, showOnRollcall = false }) {
    const inv = this.invitation(code); const isDemo = String(code).toUpperCase() === 'DEMO';
    if (!inv && !isDemo) throw new Error('This invitation code is not valid or was already used');
    if (this.activeMembers().length >= this.settings.memberCap) throw new Error(`The Circle is capped at ${this.settings.memberCap} Insiders`);
    if (!name?.trim()) throw new Error('Your name is needed for the card');
    const m = {
      id: uid('mem'), name: name.trim(), email: email || inv?.email || '', phone, roles: ['member'], status: 'active', monthlyUsd: Number(monthlyUsd || inv?.monthlyUsd || 100),
      hue: Math.floor(Math.random() * 360), home: '', title: '', joinedAt: nowIso(), sponsorId: inv?.sponsorId || null,
      founding: this.state.members.length < this.settings.foundingSeats, cardCode: Math.random().toString(36).slice(2, 8).toUpperCase(),
      household, preferences, standingOrder, showOnRollcall, dreamStayId: this.arubaStays()[0]?.id || null, notes: '',
    };
    this.state.members.push(m);
    if (inv) inv.acceptedMemberId = m.id;
    this.state.rulesAcceptances.push({ memberId: m.id, version: this.settings.rulesVersion, at: nowIso() });
    this.log(m.id, 'member.join', 'member', m.id, { name: m.name, monthlyUsd: m.monthlyUsd, code });
    await this.commit('members');
    await this.signIn(m.id);
    return m;
  }
  async addMember(data, actorId) {
    const m = { id: uid('mem'), roles: ['member'], status: 'invited', joinedAt: nowIso(), hue: Math.floor(Math.random() * 360), founding: false, cardCode: Math.random().toString(36).slice(2, 8).toUpperCase(), ...data };
    this.state.members.push(m); this.log(actorId, 'member.add', 'member', m.id, { name: m.name }); await this.commit('members'); return m;
  }
  async updateMember(id, patch, actorId) {
    const m = this.member(id); if (!m) throw new Error('No such member');
    const before = {}; for (const k of Object.keys(patch)) before[k] = m[k];
    Object.assign(m, patch); this.log(actorId, 'member.update', 'member', id, { before, after: patch }); await this.commit('members'); return m;
  }
  async pauseMember(id, untilMonth, actorId) { return this.updateMember(id, { status: 'paused', pausedUntil: untilMonth }, actorId); }
  async resumeMember(id, actorId) { return this.updateMember(id, { status: 'active', pausedUntil: null }, actorId); }
  exitQuote(memberId) {
    const base = this.basePoints(memberId); const promo = this.promoPoints(memberId); const ppd = this.settings.pointsPerDollar;
    return { basePoints: base, promoPoints: promo, refundUsd: round(Math.max(0, base / ppd - this.settings.exitFeeUsd)), feeUsd: this.settings.exitFeeUsd, windowMonths: 12 };
  }
  async leaveMember(id, actorId) { return this.updateMember(id, { status: 'left', leftAt: nowIso() }, actorId); }

  // ---------- contributions ----------
  async submitContribution({ memberId, amountUsd, forMonth, method = 'bank', bank = '', reference = '', currency = 'USD', note = '', proofName = '', proofDataUrl = '', sentOn = '' }) {
    const m = this.member(memberId); if (!m) throw new Error('No such member');
    if (!(amountUsd > 0)) throw new Error('Amount must be positive');
    if (this.state.contributions.some(c => c.memberId === memberId && c.forMonth === forMonth && [CONTRIBUTION_STATUS.pending, CONTRIBUTION_STATUS.confirmed].includes(c.status))) throw new Error(`${forMonth} already has a sent or confirmed contribution`);
    const c = {
      id: uid('con'), memberId, forMonth, expectedUsd: Number(amountUsd), amountUsd: Number(amountUsd), receivedUsd: null, currency, method, bank, reference, note, proofName, proofDataUrl,
      sentOn: sentOn || nowIso().slice(0, 10), submittedAt: nowIso(), status: CONTRIBUTION_STATUS.pending, reviewedBy: null, reviewedAt: null, reason: '',
      shareUsd: null, backingUsd: null, points: null, basePoints: null, bonusPoints: null, streakPoints: 0, foundingPoints: 0, full: null, reversedOf: null,
    };
    this.state.contributions.push(c);
    this.log(memberId, 'contribution.submit', 'contribution', c.id, { amountUsd: c.expectedUsd, forMonth });
    await this.commit('contributions');
    return c;
  }
  async withdrawContribution(id, actorId) {
    const c = this.contribution(id); if (!c) throw new Error('No such contribution');
    if (c.status !== CONTRIBUTION_STATUS.pending) throw new Error('Only a sent contribution can be withdrawn');
    Object.assign(c, { status: CONTRIBUTION_STATUS.withdrawn, reviewedAt: nowIso(), reviewedBy: actorId });
    this.log(actorId, 'contribution.withdraw', 'contribution', id, {}); await this.commit('contributions'); return c;
  }
  /** The Banker confirms money arrived. Points follow the amount actually received. */
  async confirmContribution(id, actorId, { receivedUsd = null, currency = 'USD', native = null, note = '' } = {}) {
    const c = this.contribution(id); if (!c) throw new Error('No such contribution');
    if (c.status !== CONTRIBUTION_STATUS.pending) throw new Error('This contribution is not waiting for the Banker');
    const m = this.member(c.memberId); const s = this.settings;
    const received = receivedUsd == null ? c.expectedUsd : Number(receivedUsd);
    if (!(received > 0)) throw new Error('Received amount must be positive');
    const tier = tierFor(s, m.monthlyUsd);
    const split = splitContribution(received, s, tier);
    const at = nowIso();
    Object.assign(c, { status: CONTRIBUTION_STATUS.confirmed, reviewedBy: actorId, reviewedAt: at, reason: note, receivedUsd: split.amountUsd, currency, native, shareUsd: split.shareUsd, backingUsd: split.backingUsd, basePoints: split.basePoints, bonusPoints: 0, streakPoints: 0, foundingPoints: 0, points: split.basePoints, full: split.full });
    const push = (kind, points, usd, refType, refId, note, promo = false) => { this.state.ledger.push({ id: uid('led'), memberId: c.memberId, kind, points, usd, refType, refId, note, at, by: actorId, expiresAt: promo ? addMonthsIso(at, s.bonusExpireMonths) : null }); };
    push(LEDGER_KIND.earn, split.basePoints, split.backingUsd, 'contribution', c.id, `${fmtMonth(c.forMonth)} contribution${split.full ? '' : ' · part of it'}`);
    // Promotional points: tier bonus, streak, founding — all funded from the share, capped per month.
    const promoRoom = () => {
      const monthShare = sum(this.state.contributions.filter(x => x.forMonth === c.forMonth && x.status === CONTRIBUTION_STATUS.confirmed), x => x.shareUsd) * s.pointsPerDollar * s.promoCapRate;
      const monthPromo = sum(this.state.ledger.filter(l => PROMO_KINDS.includes(l.kind) && this.contribution(l.refId)?.forMonth === c.forMonth), l => l.points);
      return Math.max(0, Math.floor(monthShare - monthPromo));
    };
    const mint = (kind, points, note) => {
      if (points <= 0) return 0;
      const room = promoRoom();
      if (points > room) { this.state.promoDeferrals.push({ id: uid('def'), memberId: c.memberId, kind, points, reason: 'cap', month: c.forMonth, refId: c.id, mintedAt: null }); return 0; }
      push(kind, points, round(points / s.pointsPerDollar), 'contribution', c.id, note, true);
      return points;
    };
    if (split.bonusPoints > 0) c.bonusPoints = mint(LEDGER_KIND.bonus, split.bonusPoints, `${tierName(s, m.monthlyUsd)} bonus ${Math.round(tier.bonusRate * 100)}% of $${m.monthlyUsd}`);
    if (split.full) {
      const streakNow = this.consecutiveMonthsThrough(c.memberId, c.forMonth);
      const sb = s.streakBonuses?.[streakNow];
      if (sb && !this.state.ledger.some(l => l.memberId === c.memberId && l.kind === LEDGER_KIND.streak && l.note.startsWith(`${streakNow} `))) c.streakPoints = mint(LEDGER_KIND.streak, sb, `${streakNow} consecutive contributions`);
    }
    if (m.founding && s.foundingBonus > 0 && !this.state.ledger.some(l => l.memberId === c.memberId && l.kind === LEDGER_KIND.founding)) c.foundingPoints = mint(LEDGER_KIND.founding, s.foundingBonus, 'Founding Insider · 2026');
    c.points = split.basePoints + c.bonusPoints + c.streakPoints + c.foundingPoints;
    this.log(actorId, 'contribution.confirm', 'contribution', id, { receivedUsd: split.amountUsd, points: c.points, full: split.full });
    await this.commit('contributions');
    return c;
  }
  async rejectContribution(id, actorId, reason) {
    const c = this.contribution(id); if (!c) throw new Error('No such contribution');
    if (c.status !== CONTRIBUTION_STATUS.pending) throw new Error('This contribution is not waiting for the Banker');
    if (!reason?.trim()) throw new Error('A reason is required so the member knows what to fix');
    Object.assign(c, { status: CONTRIBUTION_STATUS.rejected, reviewedBy: actorId, reviewedAt: nowIso(), reason: reason.trim() });
    this.log(actorId, 'contribution.return', 'contribution', id, { reason: c.reason }); await this.commit('contributions'); return c;
  }
  canReverse(c, actorId) { return c?.status === CONTRIBUTION_STATUS.confirmed && c.reviewedBy === actorId && (Date.now() - new Date(c.reviewedAt).getTime()) < this.settings.undoSeconds * 1000; }
  /** Undo a confirmation: reversing ledger rows, contribution reopened as pending. */
  async reverseContribution(id, actorId) {
    const c = this.contribution(id); if (!this.canReverse(c, actorId)) throw new Error('This confirmation can no longer be undone');
    const at = nowIso();
    for (const l of this.state.ledger.filter(l => l.refType === 'contribution' && l.refId === c.id)) {
      this.state.ledger.push({ id: uid('led'), memberId: c.memberId, kind: LEDGER_KIND.reverse, points: -l.points, usd: -(l.usd || 0), refType: 'contribution', refId: c.id, note: `Reversal · ${l.note}`, at, by: actorId });
    }
    this.state.promoDeferrals = this.state.promoDeferrals.filter(d => d.refId !== c.id);
    c.status = CONTRIBUTION_STATUS.reversed;
    const again = { ...c, id: uid('con'), status: CONTRIBUTION_STATUS.pending, reviewedBy: null, reviewedAt: null, reason: '', receivedUsd: null, shareUsd: null, backingUsd: null, points: null, basePoints: null, bonusPoints: null, streakPoints: 0, foundingPoints: 0, full: null, reversedOf: c.id, submittedAt: c.submittedAt };
    this.state.contributions.push(again);
    this.log(actorId, 'contribution.reverse', 'contribution', id, { reopenedAs: again.id }); await this.commit('contributions'); return again;
  }

  // ---------- redemptions: Request → Quote → Hold → Paid(confirmed) → Completed ----------
  releaseExpired() {
    const now = nowIso(); let changed = false;
    for (const r of this.state.redemptions) {
      if (r.status === REDEMPTION_STATUS.quoted && r.quoteExpiresAt && r.quoteExpiresAt < now) { r.status = REDEMPTION_STATUS.expired; r.decidedAt = now; r.decision = 'Quote expired before it was accepted'; changed = true; }
    }
    if (changed) this.adapter.save(this.state);
  }
  async requestRedemption({ memberId, stayId, checkIn, checkOut, guests = 2, seats = 1, note = '', flexDays = 0, maxPoints = null, shared = false }) {
    const stay = this.stay(stayId); if (!stay) throw new Error('No such stay');
    const m = this.member(memberId); const tier = tierFor(this.settings, m.monthlyUsd);
    const isTrip = stay.kind === 'trip';
    const q = quoteStay(stay, isTrip ? stay.dates.from : checkIn, isTrip ? stay.dates.to : checkOut, this.settings, { seats });
    if (!isTrip && q.nights < 1) throw new Error('Check-out must be after check-in');
    if (!q.ok) throw new Error(`Minimum ${q.minNights} nights for these dates`);
    if (!canReach(this.settings, m.monthlyUsd, stay)) {
      const needed = tierNeededFor(this.settings, stay);
      throw new Error(`${stay.name} is a ${tierName(this.settings, needed.monthlyUsd)} trip. Your level covers ${REACH[tier.reach].label}; move up to $${needed.monthlyUsd} a month from your next contribution and you are in.`);
    }
    if (this.openHolds(memberId) >= tier.holds) throw new Error(`${tierName(this.settings, m.monthlyUsd)} allows ${tier.holds} open request${tier.holds > 1 ? 's' : ''} at a time`);
    if (isTrip && this.seatsHeld(stayId) + seats > (stay.seats || 99)) throw new Error('Not enough seats left on this trip');
    if (!isTrip) {
      const maxAhead = new Date(); maxAhead.setMonth(maxAhead.getMonth() + tier.windowMonths);
      if (new Date(checkIn) > maxAhead) throw new Error(`${tierName(this.settings, m.monthlyUsd)} can request up to ${tier.windowMonths} months ahead`);
    }
    const r = {
      id: uid('red'), memberId, stayId, kind: isTrip ? 'trip' : 'stay', checkIn: isTrip ? stay.dates.from : checkIn, checkOut: isTrip ? stay.dates.to : checkOut, nights: q.nights, guests: isTrip ? seats : Number(guests), seats: isTrip ? seats : null, note, flexDays, maxPoints,
      indicativePoints: q.points, seasons: q.breakdown, retailUsd: q.retailUsd, shared: !!shared, pledges: [],
      points: q.points, topUpUsd: 0, quoteStack: null, hotelTerms: '', hotelDeadline: null, quotedBy: null, quotedAt: null, quoteExpiresAt: null,
      status: REDEMPTION_STATUS.requested, requestedAt: nowIso(), decidedBy: null, decidedAt: null, decision: '', heldAt: null, confirmedAt: null, completedAt: null, paidUsd: null, confirmationRef: '',
    };
    this.state.redemptions.push(r);
    this.log(memberId, 'redemption.request', 'redemption', r.id, { stay: stay.name, nights: q.nights, points: q.points });
    await this.commit('redemptions');
    return r;
  }
  /** Planner publishes the binding all-in quote. Top-up = points beyond Available, payable in cash. */
  async quoteRedemption(id, actorId, { points, stack = null, terms = '', hotelDeadline = null, note = '' }) {
    const r = this.redemption(id); if (!r) throw new Error('No such request');
    if (r.status !== REDEMPTION_STATUS.requested) throw new Error('Only an open request can be quoted');
    const pts = Math.round(Number(points)); if (!(pts > 0)) throw new Error('Quote must be positive');
    const pledged = sum(r.pledges || [], p => p.points);
    const available = Math.max(0, this.availablePoints(r.memberId));
    const covered = Math.min(Math.max(0, pts - pledged), available);
    const at = nowIso();
    Object.assign(r, { status: REDEMPTION_STATUS.quoted, points: covered, quotedPoints: pts, topUpUsd: round(Math.max(0, pts - covered - pledged) / this.settings.pointsPerDollar), quoteStack: stack, hotelTerms: terms, hotelDeadline, quotedBy: actorId, quotedAt: at, quoteExpiresAt: addHours(at, this.settings.quoteHours), decision: note });
    this.log(actorId, 'redemption.quote', 'redemption', id, { points: pts, topUpUsd: r.topUpUsd }); await this.commit('redemptions'); return r;
  }
  /** Member accepts → points Committed. */
  async acceptQuote(id, actorId) {
    const r = this.redemption(id); if (!r) throw new Error('No such request');
    this.releaseExpired();
    if (r.status !== REDEMPTION_STATUS.quoted) throw new Error('There is no open quote to accept');
    if (r.memberId !== actorId) throw new Error('Only the member can accept their quote');
    const pledged = sum(r.pledges || [], p => p.points);
    const available = Math.max(0, this.availablePoints(r.memberId));
    if (available < r.points) r.points = available;
    r.topUpUsd = round(Math.max(0, r.quotedPoints - r.points - pledged) / this.settings.pointsPerDollar);
    Object.assign(r, { status: REDEMPTION_STATUS.held, heldAt: nowIso() });
    this.log(actorId, 'redemption.hold', 'redemption', id, { points: r.points, topUpUsd: r.topUpUsd }); await this.commit('redemptions'); return r;
  }
  /**
   * Chip in to someone else's booking. The pledge is committed straight away, so the
   * same points cannot be spent twice, and it is released if the booking falls through.
   */
  async pledgeToRedemption(id, memberId, points) {
    const r = this.redemption(id); if (!r) throw new Error('No such request');
    if (!r.shared) throw new Error('This booking is not open for the Circle to chip in');
    if (![REDEMPTION_STATUS.quoted, REDEMPTION_STATUS.held].includes(r.status)) throw new Error('This booking is not taking contributions right now');
    if (memberId === r.memberId) throw new Error('You are already covering your own share');
    const pts = Math.round(Number(points));
    if (!(pts > 0)) throw new Error('Chip in at least one point');
    const available = this.availablePoints(memberId);
    if (pts > available) throw new Error(`You have ${available.toLocaleString('en-US')} points available`);
    const outstanding = (r.quotedPoints || r.indicativePoints || 0) - this.coveredPoints(r);
    if (outstanding <= 0) throw new Error('This booking is already covered');
    const amount = Math.min(pts, outstanding);
    r.pledges ||= [];
    const existing = r.pledges.find(p => p.memberId === memberId);
    if (existing) existing.points += amount; else r.pledges.push({ id: uid('pld'), memberId, points: amount, at: nowIso() });
    // Once a booking is fully covered, no cash top-up is owed any more.
    r.topUpUsd = round(Math.max(0, (r.quotedPoints || 0) - this.coveredPoints(r)) / this.settings.pointsPerDollar);
    this.log(memberId, 'redemption.pledge', 'redemption', id, { points: amount });
    await this.commit('redemptions');
    return r;
  }
  async withdrawPledge(id, memberId, actorId = memberId) {
    const r = this.redemption(id); if (!r) throw new Error('No such request');
    if (r.status === REDEMPTION_STATUS.confirmed || r.status === REDEMPTION_STATUS.completed) throw new Error('The hotel is already paid');
    const before = (r.pledges || []).length;
    r.pledges = (r.pledges || []).filter(p => p.memberId !== memberId);
    if (r.pledges.length === before) throw new Error('You have not chipped in to this one');
    r.topUpUsd = round(Math.max(0, (r.quotedPoints || 0) - this.coveredPoints(r)) / this.settings.pointsPerDollar);
    this.log(actorId, 'redemption.pledge.withdraw', 'redemption', id, { memberId });
    await this.commit('redemptions');
    return r;
  }

  /** Banker (or planner) pays the hotel: points burn, booking confirmed. */
  async payRedemption(id, actorId, { paidUsd = null, confirmationRef = '' } = {}) {
    const r = this.redemption(id); if (!r) throw new Error('No such request');
    if (r.status !== REDEMPTION_STATUS.held) throw new Error('The member has not accepted a quote yet');
    if (r.topUpUsd > 0 && !r.topUpConfirmed) throw new Error(`Top-up of $${r.topUpUsd.toFixed(2)} has not been confirmed as received`);
    if (this.availablePoints(r.memberId) + r.points < r.points) throw new Error('Member no longer has enough points');
    for (const p of r.pledges || []) {
      if (this.availablePoints(p.memberId) + p.points < p.points) throw new Error(`${this.member(p.memberId)?.name || 'A member'} no longer has the points they chipped in`);
    }
    const stay = this.stay(r.stayId); const at = nowIso();
    Object.assign(r, { status: REDEMPTION_STATUS.confirmed, confirmedAt: at, paidUsd: paidUsd == null ? round(r.quotedPoints / this.settings.pointsPerDollar) : Number(paidUsd), confirmationRef, decidedBy: actorId, decidedAt: at });
    const burn = (memberId, points, note) => this.state.ledger.push({ id: uid('led'), memberId, kind: LEDGER_KIND.burn, points: -points, usd: -round(points / this.settings.pointsPerDollar), refType: 'redemption', refId: r.id, note, at, by: actorId });
    if (r.points > 0) burn(r.memberId, r.points, `${stay?.name || 'Stay'} · ${r.nights} nights`);
    for (const p of r.pledges || []) {
      burn(p.memberId, p.points, `${stay?.name || 'Stay'} · chipped in for ${this.member(r.memberId)?.name.split(' ')[0] || 'an Insider'}`);
    }
    this.log(actorId, 'redemption.pay', 'redemption', id, { points: r.points, paidUsd: r.paidUsd, confirmationRef }); await this.commit('redemptions'); return r;
  }
  async confirmTopUp(id, actorId) { const r = this.redemption(id); if (!r) throw new Error('No such request'); r.topUpConfirmed = true; r.topUpConfirmedAt = nowIso(); this.log(actorId, 'redemption.topup', 'redemption', id, { topUpUsd: r.topUpUsd }); await this.commit('redemptions'); return r; }
  async completeRedemption(id, actorId) {
    const r = this.redemption(id); if (!r) throw new Error('No such request');
    if (r.status !== REDEMPTION_STATUS.confirmed) throw new Error('Only a confirmed stay can be completed');
    Object.assign(r, { status: REDEMPTION_STATUS.completed, completedAt: nowIso() });
    this.log(actorId, 'redemption.complete', 'redemption', id, {}); await this.commit('redemptions'); return r;
  }
  async declineRedemption(id, actorId, reason) {
    const r = this.redemption(id); if (!r) throw new Error('No such request');
    if (![REDEMPTION_STATUS.requested, REDEMPTION_STATUS.quoted].includes(r.status)) throw new Error('This request cannot be declined now');
    if (!reason?.trim()) throw new Error('A reason is required — the member reads it verbatim');
    Object.assign(r, { status: REDEMPTION_STATUS.declined, decidedBy: actorId, decidedAt: nowIso(), decision: reason.trim() });
    this.log(actorId, 'redemption.decline', 'redemption', id, { reason: r.decision }); await this.commit('redemptions'); return r;
  }
  /** Cancel. Before payment: nothing was committed. After payment: hotel ladder → penalty burned, remainder refunded. */
  async cancelRedemption(id, actorId, { reason = '', penaltyPoints = 0 } = {}) {
    const r = this.redemption(id); if (!r) throw new Error('No such request');
    const at = nowIso(); const stay = this.stay(r.stayId);
    if (OPEN_REDEMPTION.includes(r.status)) {
      Object.assign(r, { status: REDEMPTION_STATUS.cancelled, decidedBy: actorId, decidedAt: at, decision: reason });
    } else if (r.status === REDEMPTION_STATUS.confirmed) {
      if (!this.hasRole('planner', 'admin', 'treasurer')) throw new Error('Only the Desk or the Banker can cancel a confirmed booking');
      // The hotel's penalty is shared in proportion to what each person put in.
      const covered = this.coveredPoints(r);
      const penalty = Math.min(Math.round(penaltyPoints), covered);
      Object.assign(r, { status: REDEMPTION_STATUS.cancelled, decidedBy: actorId, decidedAt: at, decision: reason, penaltyPoints: penalty });
      const parts = [{ memberId: r.memberId, points: r.points }, ...(r.pledges || [])].filter(p => p.points > 0);
      let taken = 0;
      parts.forEach((p, i) => {
        const share = i === parts.length - 1 ? penalty - taken : Math.round(penalty * (p.points / covered));
        taken += share;
        const refund = Math.max(0, p.points - share);
        if (refund > 0) this.state.ledger.push({ id: uid('led'), memberId: p.memberId, kind: LEDGER_KIND.refund, points: refund, usd: round(refund / this.settings.pointsPerDollar), refType: 'redemption', refId: r.id, note: `Refund · ${stay?.name || 'Stay'}${share ? ` · after a ${share.toLocaleString('en-US')} point penalty` : ''}`, at, by: actorId });
      });
    } else throw new Error('This request cannot be cancelled');
    this.log(actorId, 'redemption.cancel', 'redemption', id, { reason, penaltyPoints }); await this.commit('redemptions'); return r;
  }

  // ---------- adjustments (admin, with a written reason) ----------
  async adjustPoints(memberId, points, note, actorId) {
    if (!note?.trim()) throw new Error('A written reason is required');
    const pts = Math.round(points); if (!pts) throw new Error('Nothing to adjust');
    this.state.ledger.push({ id: uid('led'), memberId, kind: LEDGER_KIND.adjust, points: pts, usd: round(pts / this.settings.pointsPerDollar), refType: 'adjust', refId: null, note: note.trim(), at: nowIso(), by: actorId });
    this.log(actorId, 'ledger.adjust', 'member', memberId, { points: pts, note }); await this.commit('ledger');
  }

  // ---------- Month Close ----------
  closePreview(month) {
    const expected = this.expectedMembers(month);
    const rows = expected.map(m => { const cs = this.state.contributions.filter(c => c.memberId === m.id && c.forMonth === month); const conf = cs.find(c => c.status === CONTRIBUTION_STATUS.confirmed); const pend = cs.find(c => c.status === CONTRIBUTION_STATUS.pending); return { member: m, expectedUsd: m.monthlyUsd, receivedUsd: conf?.receivedUsd ?? null, status: conf ? 'confirmed' : pend ? 'pending' : 'missing', reference: (conf || pend)?.reference || '', full: conf?.full ?? null }; });
    const t = this.treasury();
    const deferrals = this.state.promoDeferrals.filter(d => !d.mintedAt);
    const expiring = this.state.ledger.filter(l => PROMO_KINDS.includes(l.kind) && l.expiresAt && l.expiresAt.slice(0, 7) <= month);
    return { month, rows, confirmedCount: rows.filter(r => r.status === 'confirmed').length, pendingCount: rows.filter(r => r.status === 'pending').length, missingCount: rows.filter(r => r.status === 'missing').length, grossUsd: round(sum(rows, r => r.receivedUsd || 0)), shareUsd: round(sum(rows, r => (r.receivedUsd || 0) * this.settings.serviceRate)), treasury: t, deferrals, expiring, alreadyClosed: this.state.monthCloses.find(c => c.month === month) || null };
  }
  async closeMonth(month, actorId, { bankBalanceUsd, cosignerId, note = '' }) {
    if (!this.canConfirmMoney()) throw new Error('Only the Banker can close a month');
    const p = this.closePreview(month);
    if (p.alreadyClosed) throw new Error(`${month} is already closed`);
    if (p.pendingCount) throw new Error(`${p.pendingCount} sent contribution${p.pendingCount > 1 ? 's are' : ' is'} still waiting — confirm or return ${p.pendingCount > 1 ? 'them' : 'it'} first`);
    if (!cosignerId || cosignerId === actorId) throw new Error('A second officer must co-sign the close');
    const bal = Number(bankBalanceUsd); if (!(bal >= 0)) throw new Error('Enter the Reserve bank balance');
    const variance = round(bal - p.treasury.reserveExpectedUsd);
    if (variance < -this.settings.closeToleranceUsd) throw new Error(`Reserve is short by $${Math.abs(variance).toFixed(2)} against ${p.treasury.outstandingPoints.toLocaleString('en-US')} points outstanding. Fund it or add a reconciliation line with a reason.`);
    const at = nowIso();
    // expire promotional points past their date
    for (const l of p.expiring) {
      if (this.state.ledger.some(x => x.kind === LEDGER_KIND.expire && x.refId === l.id)) continue;
      this.state.ledger.push({ id: uid('led'), memberId: l.memberId, kind: LEDGER_KIND.expire, points: -l.points, usd: -(l.usd || 0), refType: 'ledger', refId: l.id, note: `Expired · ${l.note}`, at, by: actorId });
    }
    // mint deferred promotional points where room exists this month
    for (const d of p.deferrals) { d.mintedAt = at; this.state.ledger.push({ id: uid('led'), memberId: d.memberId, kind: d.kind, points: d.points, usd: round(d.points / this.settings.pointsPerDollar), refType: 'contribution', refId: d.refId, note: `Deferred ${d.kind} minted at ${month} close`, at, by: actorId, expiresAt: addMonthsIso(at, this.settings.bonusExpireMonths) }); }
    const close = { id: uid('cls'), month, closedBy: actorId, cosignedBy: cosignerId, bankBalanceUsd: bal, ledgerReserveUsd: p.treasury.reserveExpectedUsd, varianceUsd: variance, coverage: p.treasury.coverage, grossUsd: p.grossUsd, shareUsd: p.shareUsd, confirmedCount: p.confirmedCount, missingCount: p.missingCount, note, closedAt: at };
    this.state.monthCloses.push(close);
    this.state.settings.reserveVerified = { balanceUsd: bal, at, byId: actorId };
    this.log(actorId, 'month.close', 'month', month, { bankBalanceUsd: bal, variance, cosignerId });
    await this.commit('close');
    return close;
  }

  // ---------- catalog ----------
  async upsertStay(data, actorId) {
    let s = data.id ? this.stay(data.id) : null;
    if (s) Object.assign(s, data); else { s = { id: uid(data.kind === 'trip' ? 'trip' : 'stay'), active: true, createdAt: nowIso(), ...data }; this.state.stays.push(s); }
    this.log(actorId, 'stay.upsert', 'stay', s.id, { name: s.name }); await this.commit('stays'); return s;
  }
  async removeStay(id, actorId) { const s = this.stay(id); if (!s) return; s.active = false; this.log(actorId, 'stay.retire', 'stay', id, {}); await this.commit('stays'); }

  // ---------- notes from Ian ----------
  async postAnnouncement({ authorId, title, body, pinned = false, kind = 'note' }) {
    const a = { id: uid('ann'), authorId, title, body, pinned, kind, at: nowIso() };
    this.state.announcements.push(a); this.log(authorId, 'note.post', 'announcement', a.id, { title }); await this.commit('announcements'); return a;
  }
  async deleteAnnouncement(id, actorId) { this.state.announcements = this.state.announcements.filter(a => a.id !== id); this.log(actorId, 'note.delete', 'announcement', id, {}); await this.commit('announcements'); }

  /** Where signed Wallet passes come from, if the club has set that up. */
  walletConfig() {
    const w = this.settings.wallet;
    return w?.url ? { url: w.url, token: w.token || '' } : null;
  }

  // ---------- settings ----------
  async updateSettings(patch, actorId) { Object.assign(this.state.settings, patch); this.log(actorId, 'settings.update', 'settings', 'settings', patch); await this.commit('settings'); }

  // ---------- audit ----------
  log(actorId, action, entity, entityId, meta = {}) {
    this.state.audit.push({ id: uid('aud'), actorId: actorId || null, action, entity, entityId, meta, at: nowIso() });
    if (this.state.audit.length > 3000) this.state.audit.splice(0, this.state.audit.length - 3000);
  }

  // ---------- demo helpers ----------
  exportJson() { return JSON.stringify({ ...this.state, session: undefined }, null, 2); }
  async importJson(text) { const parsed = JSON.parse(text); if (!parsed?.members) throw new Error('Not a backup file'); this.state = { ...parsed, session: this.state.session }; this.normalize(); await this.commit('import'); }
  async reset(seedFn) { const fresh = seedFn(); this.state = { ...fresh, session: null }; this.normalize(); this.adapter.saveSession?.(null); await this.commit('reset'); }
}

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
function tierName(settings, monthlyUsd) { return ({ 100: 'Watapana', 150: 'Fofoti', 200: 'Kibrahacha' })[monthlyUsd] || `$${monthlyUsd}`; }

// ---------- LocalAdapter ----------
// Snapshot in localStorage; the persona (session) lives in sessionStorage so each
// browser tab can be a different member — a member in one tab, the Banker in another.
export class LocalAdapter {
  constructor({ key = 'hunto.v1', seed }) {
    this.key = key; this.seed = seed;
    try { this.channel = new BroadcastChannel(key); } catch { this.channel = null; }
  }
  onRemoteChange(fn) { this.channel?.addEventListener('message', (e) => { if (e.data === 'saved') fn(); }); }
  async load() {
    try { const raw = localStorage.getItem(this.key); if (raw) { const parsed = JSON.parse(raw); if (parsed?.members && parsed.version === 2) return parsed; } } catch { /* fall through */ }
    const fresh = this.seed();
    try { localStorage.setItem(this.key, JSON.stringify(fresh)); } catch { /* private mode */ }
    return fresh;
  }
  async save(state) {
    const { session, ...rest } = state;
    try { localStorage.setItem(this.key, JSON.stringify(rest)); this.channel?.postMessage('saved'); } catch (e) { console.warn('Could not persist state', e); }
  }
  loadSession() { try { return JSON.parse(sessionStorage.getItem(`${this.key}.session`) || 'null'); } catch { return null; } }
  saveSession(s) { try { if (s) sessionStorage.setItem(`${this.key}.session`, JSON.stringify(s)); else sessionStorage.removeItem(`${this.key}.session`); } catch { /* ignore */ } }
}
