// The data layer. One public API, two implementations:
//   Store + LocalAdapter   – everything in this browser, seeded demo data.
//   SupabaseStore          – same API; every rule runs server-side (supabase/schema.sql).
// Business rules live here so the demo and the real club produce identical numbers.

import { uid, nowIso, sum, monthKey, fmtMonth, nightsBetween, safeUrl } from './util.js';
import { DEFAULT_SETTINGS, splitContribution, tierFor, quoteStay, monthsToAfford, fromPoints, seatPoints, pointsPerMonth, hotelOwedUsd } from './money.js';
import { initialsOf, refFor } from './vocab.js';
import { standingFrom, rankFor, RANKS, effectiveTier } from './standing.js';

export const CONTRIBUTION_STATUS = Object.freeze({ pending: 'pending', confirmed: 'confirmed', rejected: 'rejected', withdrawn: 'withdrawn', reversed: 'reversed' });
export const REDEMPTION_STATUS = Object.freeze({ requested: 'requested', quoted: 'quoted', held: 'held', confirmed: 'confirmed', completed: 'completed', declined: 'declined', expired: 'expired', cancelled: 'cancelled' });
export const OPEN_REDEMPTION = [REDEMPTION_STATUS.requested, REDEMPTION_STATUS.quoted, REDEMPTION_STATUS.held];
export const LEDGER_KIND = Object.freeze({ earn: 'earn', bonus: 'bonus', streak: 'streak', founding: 'founding', burn: 'burn', refund: 'refund', adjust: 'adjust', expire: 'expire', reverse: 'reverse', badge: 'badge' });
export const PROMO_KINDS = [LEDGER_KIND.bonus, LEDGER_KIND.streak, LEDGER_KIND.founding];
export const ROLES = Object.freeze(['member', 'treasurer', 'deputy', 'planner', 'comms', 'admin']);
export const COLLECTIONS = ['members', 'badgeCatalog', 'memberBadges', 'contributions', 'ledger', 'stays', 'redemptions', 'announcements', 'audit', 'invitations', 'monthCloses', 'promoDeferrals', 'rulesAcceptances', 'watches', 'deals', 'roomTypes', 'pledges', 'looks', 'standings', 'crews', 'crewMembers', 'crewMessages', 'moments', 'momentReactions'];
/**
 * A complete, empty state. Every adapter starts from this — a missing collection is not a
 * missing feature, it is `[...undefined]` the first time any screen asks for it, which is
 * how the whole app came down for anyone not signed in.
 */
export const emptyState = () => ({
  ...Object.fromEntries(COLLECTIONS.map(k => [k, []])),
  settings: null, credentials: {}, session: null,
});

/** id → name for the bundled catalog, so stayLike() can match across backends. */
export const CATALOG_NAMES = Object.freeze({
  'stay_bucuti': 'Bucuti & Tara Beach Resort',
  'stay_ritz': 'The Ritz-Carlton, Aruba',
  'stay_oceanvillas': 'Aruba Ocean Villas',
  'stay_surfclub': 'Marriott’s Aruba Surf Club',
  'stay_oceanclub': 'Marriott’s Aruba Ocean Club',
  'stay_marriott': 'Aruba Marriott Resort & Stellaris Casino',
  'stay_hyatt': 'Hyatt Regency Aruba Resort Spa & Casino',
  'stay_renaissance': 'Renaissance Wind Creek Aruba Resort',
  'stay_manchebo': 'Manchebo Beach Resort & Spa',
  'stay_oceanz': 'Ocean Z Boutique Hotel',
  'stay_hilton': 'Hilton Aruba Caribbean Resort & Casino',
  'stay_riu': 'RIU Palace Antillas',
  'stay_barcelo': 'Barceló Aruba',
  'stay_tamarijn': 'Tamarijn Aruba All Inclusive',
  'stay_divi': 'Divi Aruba All Inclusive',
  'stay_embassy': 'Embassy Suites by Hilton Aruba Resort',
  'stay_radisson': 'Radisson Blu Aruba',
  'stay_holidayinn': 'Holiday Inn Resort Aruba',
  'stay_courtyard': 'Courtyard by Marriott Aruba Resort',
  'stay_boardwalk': 'Boardwalk Boutique Hotel Aruba',
  'stay_amsterdam': 'Amsterdam Manor Beach Resort',
  'stay_voco': 'voco Surfside Aruba',
  'stay_eagle': 'Eagle Aruba Resort & Casino',
  'trip_samana': 'Samaná, whale season',
  'trip_oaxaca': 'Mexico City & Oaxaca',
  'trip_japan': 'Kyoto & Tokyo, early December',
});

const asc = (k) => (a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0);
const desc = (k) => (a, b) => (a[k] < b[k] ? 1 : a[k] > b[k] ? -1 : 0);
export function shiftDays(iso, n) { const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
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
    this.state.credentials ||= {};
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
  // The board is the Voice's job as much as the Planner's, and post_deal on the server has
  // always said so. The client said planner-or-admin, so Ian was refused here for something
  // the database would have allowed him.
  canPostDeals() { return this.hasRole('planner', 'comms', 'admin'); }
  canQuote(redemption) { const s = this.stay(redemption?.stayId); return this.hasRole('planner', 'admin') || (this.hasRole('comms') && s?.kind === 'trip'); }
  async signIn(memberId) {
    const m = this.member(memberId); if (!m) throw new Error('No such member');
    this.state.session = { memberId, at: nowIso() };
    this.adapter.saveSession?.(this.state.session);
    this.notify('session');
    return m;
  }
  async signOut() { this.state.session = null; this.adapter.saveSession?.(null); this.notify('session'); }

  // ---------- passwords, for the browser-only backend ----------
  // With Supabase connected this is all handled server-side; these exist so that preview
  // mode is a real lock instead of an open door, and so a first password can be generated
  // without it ever being written down in the repository.
  credentials() { return (this.state.credentials ||= {}); }
  hasPassword(memberId) { return !!this.credentials()[memberId]; }
  memberByEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    return this.state.members.find(m => (m.email || '').toLowerCase() === e && m.status !== 'left') || null;
  }
  /** The signed-in member changing their own. Mirrors the live backend's setPassword(). */
  async setPassword(password) {
    const me = this.me; if (!me) throw new Error('Sign in first.');
    await this.setPasswordFor(me.id, password);
    if (me.mustChangePassword) await this._writeMember(me.id, { mustChangePassword: false }, me.id);
  }
  async setPasswordFor(memberId, password) {
    const { hashPassword, passwordStrength } = await import('./passwords.js');
    const s = passwordStrength(password);
    if (!s.ok) throw new Error('Use at least twelve characters');
    this.credentials()[memberId] = { ...(await hashPassword(password)), setAt: nowIso() };
    this.log(memberId, 'auth.password_set', 'member', memberId, {});
    await this.commit('credentials');
  }
  /** Sign in by email and password. Wrong either way gives the same answer, on purpose. */
  /**
   * Preview equivalent of the real backend's username login. The live one derives an email
   * from the username and lets Supabase check the password; here the hash is in this browser.
   */
  async signInWithUsername(username, password) {
    const u = String(username || '').trim().toLowerCase();
    const m = this.state.members.find(x => (x.username || '').toLowerCase() === u);
    if (!m) throw new Error('That username and password do not go together.');
    const { verifyPassword } = await import('./passwords.js');
    const rec = this.credentials()[m.id];
    if (!rec || !(await verifyPassword(password, rec))) throw new Error('That username and password do not go together.');
    await this.signIn(m.id);
    return m;
  }
  async setMemberLogin(memberId, username, password, actorId) {
    if (!this.hasRole('admin')) throw new Error('Only an admin can hand out a login');
    const u = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/.test(u)) throw new Error('A username is 3 to 30 characters, letters and numbers, and may contain . _ or -');
    if (String(password || '').length < 12) throw new Error('That password is too short — twelve characters at least');
    const clash = this.state.members.find(x => x.id !== memberId && (x.username || '').toLowerCase() === u);
    if (clash) throw new Error(`Someone else already uses the username ${u}`);
    await this.setPasswordFor(memberId, password);
    // A robot has nobody to choose a new password, and signs in over the API where no screen
    // could ask it to. Same rule as admin_set_login().
    const isBot = !!this.member(memberId)?.bot;
    return this._writeMember(memberId, { username: u, mustChangePassword: !isBot, status: 'active' }, actorId);
  }
  async signInWithPassword(email, password) {
    const { verifyPassword } = await import('./passwords.js');
    const m = this.memberByEmail(email);
    const rec = m ? this.credentials()[m.id] : null;
    // Do the work either way so a missing account is not distinguishable by timing.
    const ok = await verifyPassword(password, rec || { hash: 'AAAA', salt: 'AAAA' });
    if (!m || !rec || !ok) throw new Error('That email and password do not match.');
    return this.signIn(m.id);
  }

  // ---------- lookups ----------
  get settings() { return this.state.settings; }
  member(id) { return this.state.members.find(m => m.id === id) || null; }
  get members() { return this.state.members; }
  // Everyone the club counts as a person. The watcher that runs on the VPS is a member row like
  // any other — it has to be, to sign in and post a deal — but it holds no seat, owes nothing,
  // and must never turn up in a seat count, a co-signer list, or on the front page. Anything
  // about people uses this; only Settings, where Victor manages the thing, sees every row.
  people() { return this.state.members.filter(m => !m.bot); }

  /**
   * What is waiting for THIS person because of a role they hold.
   *
   * The officers are members first. Victor, Ian and Vishnu each hold one seat, contribute like
   * everybody else, and happen to have jobs on top — so the app is the member's app and the
   * jobs surface inside it, rather than a second application bolted alongside with its own
   * tabs. This is what feeds that: a short list of things that actually need them today, empty
   * for a member with no role and empty for an officer with nothing outstanding.
   */
  officerWork() {
    const out = [];
    const me = this.me;
    if (!me) return out;

    if (this.canConfirmMoney()) {
      const waiting = this.pendingContributions();
      if (waiting.length) {
        out.push({ id: 'bank', href: '#/bank', count: waiting.length, urgent: true,
          what: `${waiting.length} transfer${waiting.length === 1 ? '' : 's'} waiting to be confirmed`,
          why: 'Nobody has points until you match the money to the statement.' });
      }
      const month = monthKey();
      if (!this.state.monthCloses.some(c => c.month === month)) {
        const last = shiftMonth(month, -1);
        if (!this.state.monthCloses.some(c => c.month === last)
            && this.state.contributions.some(c => c.forMonth === last && c.status === CONTRIBUTION_STATUS.confirmed)) {
          out.push({ id: 'close', href: `#/bank/close/${last}`, count: null,
            what: `${fmtMonth(last)} is not closed yet`,
            why: 'A second officer co-signs it, and the Reserve is checked against the bank.' });
        }
      }
    }

    if (this.hasRole('planner', 'comms', 'admin')) {
      const asked = this.state.redemptions.filter(r => r.status === 'requested');
      if (asked.length) {
        out.push({ id: 'quote', href: '#/desk', count: asked.length, urgent: true,
          what: `${asked.length} request${asked.length === 1 ? '' : 's'} waiting for a price`,
          why: (() => {
            const tightest = Math.min(...asked.map(r => tierFor(this.settings, this.member(r.memberId)?.monthlyUsd)?.slaHours
              ?? this.settings?.slaHours ?? 72));
            return `The tightest promise outstanding is ${tightest} hours.`;
          })() });
      }
    }

    if (this.hasRole('admin')) {
      const noLogin = this.people().filter(m => m.status !== 'left' && !m.username);
      if (noLogin.length) {
        out.push({ id: 'logins', href: '#/settings', count: noLogin.length,
          what: `${noLogin.length} Insider${noLogin.length === 1 ? '' : 's'} cannot sign in yet`,
          why: 'They need a username and a password from you — nothing is emailed.' });
      }
    }
    return out;
  }

  // ---------- crews ----------
  // A crew is who you actually travel with: the four who split a villa, the family group, the
  // ones who always go in October. It is named by the people in it and it has its own thread.
  // Deliberately not the same thing as chipping in — a pledge is money on one booking, a crew
  // outlives any week.
  crews() { return (this.state.crews || []).filter(c => !c.archivedAt); }
  crew(id) { return (this.state.crews || []).find(c => c.id === id) || null; }
  crewRoster(crewId) {
    return (this.state.crewMembers || []).filter(m => m.crewId === crewId)
      .map(m => ({ ...m, member: this.member(m.memberId) }))
      .filter(m => m.member);
  }
  /** The crews this person is in, most recently spoken in first. */
  crewsFor(memberId) {
    const mine = new Set((this.state.crewMembers || []).filter(m => m.memberId === memberId).map(m => m.crewId));
    return this.crews().filter(c => mine.has(c.id))
      .map(c => ({ ...c, lastAt: this.crewThread(c.id).at(-1)?.createdAt || c.createdAt }))
      .sort(desc('lastAt'));
  }
  isInCrew(crewId, memberId = this.me?.id) {
    return (this.state.crewMembers || []).some(m => m.crewId === crewId && m.memberId === memberId);
  }
  leadsCrew(crewId, memberId = this.me?.id) {
    return (this.state.crewMembers || []).some(m => m.crewId === crewId && m.memberId === memberId && m.role === 'lead');
  }
  /**
   * Crews with something said since you last looked.
   *
   * Kept in this browser rather than on the server: a read marker is per-device by nature and
   * a table for it would be a row written on every screen open. The cost is that it does not
   * follow you to another phone, which for a badge on a nav icon is the right trade.
   */
  unreadCrews(memberId = this.me?.id) {
    if (!memberId) return [];
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem('hunto.crewSeen') || '{}'); } catch { /* private mode */ }
    return this.crewsFor(memberId).filter((c) => {
      const last = this.crewThread(c.id).filter(m => m.memberId !== memberId).at(-1);
      return last && (!seen[c.id] || last.createdAt > seen[c.id]);
    });
  }
  /** Opening a crew is reading it. */
  markCrewSeen(crewId) {
    try {
      const seen = JSON.parse(localStorage.getItem('hunto.crewSeen') || '{}');
      seen[crewId] = new Date().toISOString();
      localStorage.setItem('hunto.crewSeen', JSON.stringify(seen));
    } catch { /* nothing to remember on a browser that will not store */ }
  }

  /** Oldest first, the way a conversation reads. Deleted lines keep their place as a tombstone. */
  crewThread(crewId) {
    return (this.state.crewMessages || []).filter(m => m.crewId === crewId).sort(asc('createdAt'));
  }

  /**
   * A circle forms around a room, not around a name.
   *
   * Victor: "you can't make A circle without the room being approved." Before this, createCrew
   * took a name and nothing else, so a circle was a title with a thread attached and had no
   * connection to any room anyone was going to sleep in. Now it hangs off a booking you own
   * that the Desk has already approved — held, confirmed or completed, which means the points
   * are committed and the room is really yours. Anything earlier is a request, not a room.
   *
   * The same rule is enforced in SQL by create_crew(), because the local adapter is a
   * convenience and the database is the one that has to be right.
   */
  approvedRoomsFor(memberId = this.session?.memberId) {
    const ok = [REDEMPTION_STATUS.held, REDEMPTION_STATUS.confirmed, REDEMPTION_STATUS.completed];
    return this.state.redemptions
      .filter(r => r.memberId === memberId && ok.includes(r.status))
      .filter(r => !(this.state.crews || []).some(c => c.redemptionId === r.id))
      .sort((a, b) => String(b.checkIn || '').localeCompare(String(a.checkIn || '')));
  }

  async createCrew({ name, about = '', redemptionId = null }) {
    const me = this.me; if (!me) throw new Error('Sign in first');
    const clean = String(name || '').trim();
    if (clean.length < 2) throw new Error('A circle needs a name');
    if (clean.length > 40) throw new Error('That name is too long — 40 characters at most');
    if (!redemptionId) throw new Error('Start a circle from a room the Desk has approved — that is what the circle is for');
    const r = this.redemption(redemptionId);
    if (!r) throw new Error('No such booking');
    if (r.memberId !== me.id) throw new Error('That booking is not yours');
    if (![REDEMPTION_STATUS.held, REDEMPTION_STATUS.confirmed, REDEMPTION_STATUS.completed].includes(r.status)) {
      throw new Error(r.status === REDEMPTION_STATUS.quoted
        ? 'Accept the quote first — once the points are committed the room is yours and the circle can start.'
        : `That room is not approved yet — it is ${r.status}. Once the Desk quotes it and you accept, you can start the circle around it.`);
    }
    const c = { id: uid('crw'), name: clean, about: String(about || '').trim() || null,
      redemptionId, coverPath: null, createdBy: me.id, createdAt: nowIso(), archivedAt: null };
    (this.state.crews ||= []).push(c);
    // Naming it and being in it are one act. Splitting them is what made this unusable on the
    // server for everybody but an admin.
    (this.state.crewMembers ||= []).push({ crewId: c.id, memberId: me.id, role: 'lead', joinedAt: nowIso() });
    this.log(me.id, 'crew.create', 'crew', c.id, { name: clean });
    await this.commit('crews', 'crewMembers');
    return c;
  }
  async addToCrew(crewId, memberId) {
    const me = this.me; if (!me) throw new Error('Sign in first');
    if (!this.crew(crewId)) throw new Error('No such crew');
    if (!this.leadsCrew(crewId, me.id) && !this.hasRole('admin')) throw new Error('Only the crew’s lead can add people');
    if (!this.member(memberId)) throw new Error('No such member');
    if (this.isInCrew(crewId, memberId)) return null;
    const row = { crewId, memberId, role: 'member', joinedAt: nowIso() };
    (this.state.crewMembers ||= []).push(row);
    this.log(me.id, 'crew.add', 'crew', crewId, { memberId });
    await this.commit('crewMembers');
    return row;
  }
  /** Leaving is always yours to do. The last lead has to hand it on first. */
  async leaveCrew(crewId, memberId = this.me?.id) {
    const me = this.me; if (!me) throw new Error('Sign in first');
    if (memberId !== me.id && !this.leadsCrew(crewId, me.id) && !this.hasRole('admin')) {
      throw new Error('That is not yours to do');
    }
    const roster = this.crewRoster(crewId);
    const leads = roster.filter(m => m.role === 'lead');
    if (leads.length === 1 && leads[0].memberId === memberId && roster.length > 1) {
      throw new Error('Make somebody else the lead first');
    }
    this.state.crewMembers = (this.state.crewMembers || []).filter(m => !(m.crewId === crewId && m.memberId === memberId));
    this.log(me.id, 'crew.leave', 'crew', crewId, { memberId });
    await this.commit('crewMembers');
  }
  async renameCrew(crewId, patch) {
    const me = this.me; if (!me) throw new Error('Sign in first');
    if (!this.leadsCrew(crewId, me.id) && !this.hasRole('admin')) throw new Error('Only the crew’s lead can change this');
    const c = this.crew(crewId); if (!c) throw new Error('No such crew');
    if (patch.name !== undefined) {
      const clean = String(patch.name).trim();
      if (clean.length < 2 || clean.length > 40) throw new Error('A name is between 2 and 40 characters');
      c.name = clean;
    }
    if (patch.about !== undefined) c.about = String(patch.about).trim() || null;
    this.log(me.id, 'crew.rename', 'crew', crewId, patch);
    await this.commit('crews');
    return c;
  }
  async sendCrewMessage(crewId, body) {
    const me = this.me; if (!me) throw new Error('Sign in first');
    if (!this.isInCrew(crewId, me.id)) throw new Error('You are not in that crew');
    const text = String(body || '').trim();
    if (!text) throw new Error('Say something first');
    if (text.length > 4000) throw new Error('That is too long for one message');
    const m = { id: uid('msg'), crewId, memberId: me.id, body: text, momentId: null,
      createdAt: nowIso(), editedAt: null, deletedAt: null };
    (this.state.crewMessages ||= []).push(m);
    await this.commit('crewMessages');
    return m;
  }
  /** Your own words are yours to take back. Nobody else's are. */
  async deleteCrewMessage(id) {
    const me = this.me; if (!me) throw new Error('Sign in first');
    const m = (this.state.crewMessages || []).find(x => x.id === id);
    if (!m) throw new Error('No such message');
    if (m.memberId !== me.id && !this.hasRole('admin')) throw new Error('Those are not your words');
    m.deletedAt = nowIso(); m.body = null;
    await this.commit('crewMessages');
    return m;
  }

  // ---------- badges ----------
  // Three kinds, and the difference matters. `earned` are facts the club already records, so
  // nobody awards or withholds them. `founder` are held by name — three of them, and there will
  // never be a fourth. `bought` cost points, which means they cost hotel: the app says the
  // dollar figure beside every price so nobody spends a night by accident.
  badgeCatalog() { return (this.state.badgeCatalog || []).filter(b => b.active !== false).sort(asc('sort')); }
  badge(key) { return (this.state.badgeCatalog || []).find(b => b.key === key) || null; }
  badgesOf(memberId) {
    return (this.state.memberBadges || []).filter(b => b.memberId === memberId)
      .map(b => ({ ...b, badge: this.badge(b.badgeKey) })).filter(b => b.badge);
  }
  hasBadge(key, memberId = this.me?.id) {
    return (this.state.memberBadges || []).some(b => b.memberId === memberId && b.badgeKey === key);
  }
  /** The three a member chose to show, in their order, falling back to whatever they hold. */
  pinnedBadges(memberId) {
    const m = this.member(memberId); if (!m) return [];
    const held = this.badgesOf(memberId);
    const pins = (m.badgePins || []).map(k => held.find(h => h.badgeKey === k)).filter(Boolean);
    return pins.length ? pins : held.slice(0, 3);
  }
  /** What is for sale that this member does not already have. */
  badgeShop(memberId = this.me?.id) {
    return this.badgeCatalog().filter(b => b.kind === 'bought' && !this.hasBadge(b.key, memberId));
  }

  async buyBadge(key) {
    const me = this.me; if (!me) throw new Error('Sign in first');
    const b = this.badge(key);
    if (!b) throw new Error('No such badge');
    if (b.kind !== 'bought') throw new Error(`${b.name} is not for sale — it is ${b.kind === 'founder' ? 'held by name' : 'earned'}`);
    if (this.hasBadge(key, me.id)) throw new Error(`You already have ${b.name}`);
    const lt = this.lifetime(me.id);
    if (lt.available < b.pricePoints) throw new Error(`That is ${b.pricePoints} points and you have ${lt.available} available`);
    (this.state.ledger ||= []).push({ id: uid('lg'), memberId: me.id, kind: LEDGER_KIND.badge, points: -b.pricePoints,
      usd: -b.pricePoints / this.settings.pointsPerDollar, refType: 'badge', note: b.name, by: me.id, at: nowIso() });
    (this.state.memberBadges ||= []).push({ memberId: me.id, badgeKey: key, paidPoints: b.pricePoints, at: nowIso() });
    await this.commit('ledger', 'memberBadges');
    return b;
  }
  async pinBadges(keys) {
    const me = this.me; if (!me) throw new Error('Sign in first');
    if (keys.length > 3) throw new Error('Three at most');
    for (const k of keys) if (!this.hasBadge(k, me.id)) throw new Error('You do not have that badge');
    me.badgePins = keys;
    await this.commit('members');
    return me;
  }

  // ---------- standing ----------
  /**
   * Where a member stands. Named standingOf() because standing() was already taken, further
   * down, by the balance-and-streak summary — and a silent collision there had the crest
   * quietly reading a rank off an object that has never had one.
   * On the real backend this is read from standing_v, which answers for
   * everybody without handing over anybody's money; in preview it is worked out from what this
   * browser holds. Either way the shape is the same and the ladder is the same.
   */
  standingOf(memberId = this.session?.memberId) {
    const id = memberId || this.session?.memberId;
    if (!id) return null;
    const fromServer = this.state.standings?.find(x => x.memberId === id);
    if (fromServer) return { ...fromServer, badges: fromServer.badges || [] };
    return standingFrom({
      member: this.member(id), contributions: this.state.contributions, ledger: this.state.ledger,
      redemptions: this.state.redemptions, pledges: this.state.pledges, deals: this.state.deals,
      invitations: this.state.invitations, monthCloses: this.state.monthCloses,
      members: this.state.members, settings: this.settings || {},
    });
  }
  /** The rung itself, with its blurb and what it unlocks. */
  rank(memberId) { const st = this.standingOf(memberId); return st ? RANKS[st.rankIndex] || RANKS[0] : RANKS[0]; }
  activeMembers() { return this.people().filter(m => m.status === 'active'); }
  expectedMembers(month) { return this.people().filter(m => (m.status === 'active' || (m.status === 'paused' && m.pausedUntil && m.pausedUntil < month)) && (m.joinedAt || '').slice(0, 7) <= month); }
  stay(id) { return this.state.stays.find(s => s.id === id) || null; }
  get stays() { return this.state.stays; }
  arubaStays() { return this.state.stays.filter(s => s.kind === 'aruba' && s.active); }
  trips() { return this.state.stays.filter(s => s.kind === 'trip' && s.active); }
  contribution(id) { return this.state.contributions.find(c => c.id === id) || null; }
  /** Where to find a transfer screenshot. Here it is on the row; Supabase signs a URL. */
  async proofUrl(_path) { return null; }
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
  /** How many months of contributions this would still take, at each level. */
  monthsToAfford(points, memberId = this.session?.memberId) {
    const m = this.member(memberId); if (!m) return null;
    const have = Math.max(0, this.availablePoints(m.id));
    return this.settings.tiers.map(t => ({ tier: t, months: monthsToAfford(this.settings, points, t.monthlyUsd, have), mine: t.monthlyUsd === m.monthlyUsd }));
  }
  /** Bookings anyone in the Circle can still chip in to. */
  openToChipIn() {
    this.releaseExpired();
    return this.state.redemptions
      .filter(r => r.shared && [REDEMPTION_STATUS.quoted, REDEMPTION_STATUS.held].includes(r.status) && this.coveredPoints(r) < (r.quotedPoints || r.indicativePoints || 0))
      .sort(asc('requestedAt'));
  }
  /**
   * The one thing a member can book TODAY, in nights.
   *
   * The home screen opened on "✦ 28,850", which is a five-digit number nobody can convert in
   * their head into anything they want. A member does not save points, they save nights, and
   * the app knew the answer all along — it just never said it. This is the sentence it should
   * have opened with, and it comes back as data so the screen can also say it when the answer
   * is "not yet, and here is how far off".
   *
   * The pick is their own dream stay when they can cover its minimum, and otherwise the
   * DEAREST place they can still cover: "3 nights at the Ritz-Carlton" is a truer picture of
   * what the points are worth than "nineteen nights at the cheapest place on the list".
   *
   * Priced at each place's cheapest night, because this screen has no dates on it — the member
   * has not chosen any yet. The screen says "from" so the number is never read as a promise.
   */
  canBookNow(memberId = this.session?.memberId) {
    const m = this.member(memberId);
    if (!m) return null;
    const avail = Math.max(0, this.availablePoints(memberId));
    const per = (st) => fromPoints(st, this.settings);
    const list = this.stays.filter(x => x.active !== false && x.kind !== 'trip' && per(x) > 0);
    if (!list.length) return null;
    const nightsAt = (st) => Math.floor(avail / per(st));
    const affordable = list.filter(st => nightsAt(st) >= (st.minNights || 1));
    if (affordable.length) {
      const dream = this.stay(m.dreamStayId);
      // The dearest place you can cover, but only among the ones that give you a stay rather
      // than a night: "2 nights at the Renaissance" is a worse answer than "5 nights on Eagle
      // Beach" when you could have either. Below three nights it is not a trip, it is a stop.
      const dearest = (xs) => xs.reduce((a, b) => (per(b) > per(a) ? b : a));
      const real = affordable.filter(st => nightsAt(st) >= Math.max(3, st.minNights || 1));
      const pick = dream && affordable.includes(dream) ? dream
        : dearest(real.length ? real : affordable);
      // Capped: past a fortnight the number stops being a plan and starts being a boast.
      const nights = Math.min(nightsAt(pick), 14);
      return { can: true, stay: pick, nights, capped: nightsAt(pick) > 14, from: true,
        perNight: per(pick), points: nights * per(pick), available: avail };
    }
    // Nearest by what it takes to WALK IN, not by the nightly rate. The Surf Club is the
    // cheapest per night on the island and the furthest away, because it is a villa that only
    // comes by the week: 135 a night times a seven-night minimum is not a short walk.
    const total = (st) => (st.minNights || 1) * per(st);
    const nearest = list.reduce((a, b) => (total(b) < total(a) ? b : a));
    const nights = nearest.minNights || 1;
    const need = total(nearest);
    return { can: false, stay: nearest, nights, perNight: per(nearest), from: true,
      points: need, short: Math.max(0, need - avail), available: avail,
      months: monthsToAfford(this.settings, need, m.monthlyUsd, avail) };
  }

  /**
   * What a member is saving for, and how far off it is. A goal is a stay and a number of
   * nights, or a seat on a trip. Nothing is reserved by setting one — it is the thing that
   * makes a contribution feel like it moved something.
   *
   * Goals saved before the seasons went carry a `season` key. It is ignored rather than
   * migrated: every goal in the database has one, none of them can be re-asked for, and a
   * target priced from the cheapest night is the right answer for a goal with no dates on it.
   */
  goalFor(memberId = this.session?.memberId) {
    const m = this.member(memberId); const g = m?.goal;
    if (!g?.stayId) return null;
    const stay = this.stay(g.stayId); if (!stay || stay.active === false) return null;
    const isTrip = stay.kind === 'trip';
    const nights = isTrip ? stay.nights : Math.max(Number(g.nights) || 0, stay.minNights || 1);
    const target = isTrip ? seatPoints(stay, this.settings) : fromPoints(stay, this.settings) * nights;
    const have = Math.max(0, this.availablePoints(memberId));
    const short = Math.max(0, target - have);
    const perMonth = pointsPerMonth(this.settings, m.monthlyUsd);
    return {
      stay, isTrip, nights, target, have, short, from: !isTrip,
      pct: target ? Math.min(1, have / target) : 1,
      months: monthsToAfford(this.settings, target, m.monthlyUsd, have),
      perMonth, topUpUsd: round(short / this.settings.pointsPerDollar),
      // What each of the three ways out of the gap would do.
      ways: this.settings.tiers.map(t => ({ monthlyUsd: t.monthlyUsd, mine: t.monthlyUsd === m.monthlyUsd,
        months: monthsToAfford(this.settings, target, t.monthlyUsd, have) })),
    };
  }
  async setGoal(memberId, goal, actorId = memberId) {
    if (goal && !this.stay(goal.stayId)) throw new Error('That place is no longer on the list');
    return this.updateMember(memberId, { goal: goal || null }, actorId);
  }
  /** Everything the member needs to see their own progress on one screen. */
  standing(memberId = this.session?.memberId) {
    const m = this.member(memberId); if (!m) return null;
    const month = monthKey();
    const perMonth = pointsPerMonth(this.settings, m.monthlyUsd);
    const streak = this.streak(memberId);
    const nextStreak = Object.keys(this.settings.streakBonuses || {}).map(Number)
      .filter(n => n > streak).sort((a, b) => a - b)[0] || null;
    return {
      balance: this.ledgerBalance(memberId), committed: this.committedPoints(memberId),
      available: this.availablePoints(memberId), perMonth, streak, nextStreak,
      nextStreakBonus: nextStreak ? this.settings.streakBonuses[nextStreak] : 0,
      monthStatus: this.monthStatus(memberId, month), month,
      openMonths: this.openMonthsFor(memberId),
      goal: this.goalFor(memberId),
    };
  }
  availablePoints(memberId) { return this.ledgerBalance(memberId) - this.committedPoints(memberId); }
  /**
   * Promotional points this member holds, net of the lines that cancelled them — twin of the
   * treasury's own reckoning. The naive sum counted a bonus that had since EXPIRED, or whose
   * contribution was REVERSED, as if it were still there; basePoints is balance minus this, so
   * a founding member who booked nothing was told at the door that $20 of their own cash was
   * a bonus and kept it back, having already lost that bonus once when it expired.
   */
  promoPoints(memberId) {
    const led = this.ledgerFor(memberId);
    const reversed = (l) => l.refType === 'contribution' && this.contribution(l.refId)?.status === CONTRIBUTION_STATUS.reversed;
    const promo = led.filter(l => PROMO_KINDS.includes(l.kind) && !reversed(l));
    const promoIds = new Set(promo.map(l => l.id));
    const minted = sum(promo, l => l.points);
    const expired = sum(led.filter(l => l.kind === LEDGER_KIND.expire && l.refType === 'ledger' && promoIds.has(l.refId)), l => l.points);
    return Math.max(0, minted + expired);
  }
  basePoints(memberId) { return Math.max(0, this.ledgerBalance(memberId) - this.promoPoints(memberId)); }
  /**
   * Promotional room left in a month — twin of promo_room() in SQL, and the ONE place the
   * budget is reckoned. It is a fraction of that month's confirmed contributions, less what has
   * already been minted against them. Two things it deliberately does not count: an extra,
   * which has no month and used to be swept into whichever month its confirmation landed in
   * (raising that month's ceiling by 3,000 points for $500 of cash the server never counted),
   * and promo whose contribution was reversed, which the reverse line has already handed back.
   */
  promoRoom(month) {
    const s = this.settings;
    const monthShare = sum(this.state.contributions.filter(x => x.forMonth === month && x.status === CONTRIBUTION_STATUS.confirmed), x => x.receivedUsd)
      * s.serviceRate * s.pointsPerDollar * s.promoCapRate;
    const monthPromo = sum(this.state.ledger.filter(l => PROMO_KINDS.includes(l.kind) && l.refType === 'contribution'
      && this.contribution(l.refId)?.forMonth === month && this.contribution(l.refId)?.status !== CONTRIBUTION_STATUS.reversed), l => l.points);
    return Math.max(0, Math.floor(monthShare - monthPromo));
  }
  /**
   * What being in the Circle has actually been worth to this member, in dollars.
   *
   * Victor: "I want people to see their savings real price vs what on the page so they
   * appreciate being a member." This is that number, and it is only credible if it is built the
   * hard way — from bookings that really happened, against the public rate for the SAME nights.
   *
   * Two things it deliberately refuses to do. It does not count a booking that has not been
   * paid for, because a saving you have not taken is not a saving. And it does not clamp at
   * zero: where the Circle was DEARER than booking direct — which happens, at the Ritz — that
   * booking subtracts. A total that can only go up is an advertisement, and a member can check
   * any line of this against the site they would have used.
   */
  savingsFor(memberId = this.session?.memberId) {
    const mine = this.state.redemptions.filter(r => r.memberId === memberId
      && [REDEMPTION_STATUS.confirmed, REDEMPTION_STATUS.completed].includes(r.status));
    const lines = [];
    for (const r of mine) {
      // What we charged: the points that actually burned, at face value.
      const oursUsd = round((r.points ?? r.indicativePoints ?? 0) / this.settings.pointsPerDollar);
      // What the same nights cost booked alone. Stored on the row at request time, so it is the
      // public rate as it stood then rather than a number re-derived today.
      const publicUsd = round(r.retailUsd || 0);
      if (!oursUsd || !publicUsd) continue;
      const stay = this.stay(r.stayId);
      lines.push({
        redemptionId: r.id, stayName: stay?.name || 'A stay', nights: r.nights || 0,
        when: r.completedAt || r.confirmedAt || r.requestedAt,
        oursUsd, publicUsd, savedUsd: round(publicUsd - oursUsd),
      });
    }
    lines.sort((a, b) => String(b.when || '').localeCompare(String(a.when || '')));
    const savedUsd = round(lines.reduce((a, l) => a + l.savedUsd, 0));
    const publicUsd = round(lines.reduce((a, l) => a + l.publicUsd, 0));
    const oursUsd = round(lines.reduce((a, l) => a + l.oursUsd, 0));
    // Against what they have put in — the number that answers "was this worth joining".
    const paidIn = round(this.state.contributions
      .filter(c => c.memberId === memberId && c.status === 'confirmed')
      .reduce((a, c) => a + (Number(c.amountUsd) || 0), 0));
    return {
      lines, savedUsd, publicUsd, oursUsd, paidIn,
      trips: lines.length,
      pct: publicUsd ? Math.round((savedUsd / publicUsd) * 100) : 0,
    };
  }

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
    // What the Banker actually received; a row confirmed before the field existed falls back to
    // what was owed at the time.
    const topUpsUsd = sum(settled, r => (r.topUpReceivedUsd ?? (r.topUpConfirmed ? r.topUpUsd || 0 : 0)));
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
      // The Circle's income, now that nothing is taken at the door. Defined as what the Reserve
      // holds over and above what it owes — which is what it is, and which needs no assumption
      // about how any particular quote was priced. Every booking hands back more in points than
      // it takes out in cash, and the difference settles here.
      serviceEarnedUsd: round(reserveExpectedUsd - liabilityUsd),
      // What Operating actually holds: that margin, less the bonuses the Circle fronted against
      // it. Negative until the first booking, which is the true position, not a bug to round away.
      operatingUsd: round(reserveExpectedUsd - liabilityUsd - promoUsd + expiredUsd),
      reserveExpectedUsd, reserveUsd: round(reserveUsd),
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
      const cs = this.state.contributions.filter(c => (c.forMonth || c.reviewedAt?.slice(0, 7)) === m && c.status === CONTRIBUTION_STATUS.confirmed);
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
      founding: this.people().length < this.settings.foundingSeats, cardCode: Math.random().toString(36).slice(2, 8).toUpperCase(),
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
  /** The same guards the SQL applies, so the two backends refuse the same things. */
  async addMember(data, actorId) {
    if (!this.hasRole('admin')) throw new Error('Only an admin can add a member');
    const name = String(data.name || '').trim();
    if (!name) throw new Error('They need a name');
    const email = String(data.email || '').trim();
    if (email && this.memberByEmail(email)) throw new Error('Someone is already on the list with that email');
    // A machine account does not sit in one of the forty seats, so the cap does not apply to it.
    if (!data.bot && this.people().filter(x => ['active', 'paused'].includes(x.status)).length >= this.settings.memberCap) {
      throw new Error(`The Circle is capped at ${this.settings.memberCap} Insiders`);
    }
    const roles = (Array.isArray(data.roles) && data.roles.length ? data.roles : ['member']);
    for (const r of roles) if (!ROLES.includes(r)) throw new Error(`${r} is not a role`);
    const m = { id: uid('mem'), status: 'invited', joinedAt: nowIso(), hue: Math.floor(Math.random() * 360),
      founding: false, cardCode: Math.random().toString(36).slice(2, 8).toUpperCase(),
      ...data, name, email, roles, monthlyUsd: Number(data.monthlyUsd) || 100 };
    this.state.members.push(m);
    this.log(actorId, 'member.add', 'member', m.id, { name: m.name, roles });
    await this.commit('members');
    return m;
  }
  // What a person may change about themselves, and nothing more. This is the same list the
  // backend's update_my_profile() writes; email is not on it, because email is what ties the
  // row to the sign-in account and handing that to the account holder hands them the row.
  static SELF_FIELDS = ['name', 'phone', 'preferences', 'household', 'showOnRollcall', 'standingOrder', 'dreamStayId', 'goal', 'monthlyUsd'];

  async updateMember(id, patch, actorId) {
    if (!this.hasRole('admin')) {
      if (id !== this.session?.memberId) throw new Error('Only an admin can change someone else');
      const over = Object.keys(patch).filter(k => !Store.SELF_FIELDS.includes(k));
      if (over.length) throw new Error(`Only an admin can change ${over.join(' and ')}`);
    }
    return this._writeMember(id, patch, actorId);
  }
  /** No guard: for the paths that carry their own, like pausing yourself. */
  async _writeMember(id, patch, actorId) {
    const m = this.member(id); if (!m) throw new Error('No such member');
    const before = {}; for (const k of Object.keys(patch)) before[k] = m[k];
    Object.assign(m, patch); this.log(actorId, 'member.update', 'member', id, { before, after: patch }); await this.commit('members'); return m;
  }
  // Pausing and leaving are your own to do; being made inactive by someone else is not.
  async pauseMember(id, untilMonth, actorId) { this.assertSelfOrAdmin(id); return this._writeMember(id, { status: 'paused', pausedUntil: untilMonth }, actorId); }
  async resumeMember(id, actorId) { this.assertSelfOrAdmin(id); return this._writeMember(id, { status: 'active', pausedUntil: null }, actorId); }
  assertSelfOrAdmin(id) { if (id !== this.session?.memberId && !this.hasRole('admin')) throw new Error('That is not yours to change'); }
  exitQuote(memberId) {
    const base = this.basePoints(memberId); const promo = this.promoPoints(memberId); const ppd = this.settings.pointsPerDollar;
    return { basePoints: base, promoPoints: promo, refundUsd: round(Math.max(0, base / ppd - this.settings.exitFeeUsd)), feeUsd: this.settings.exitFeeUsd, windowMonths: 12 };
  }
  async leaveMember(id, actorId) { this.assertSelfOrAdmin(id); return this._writeMember(id, { status: 'left', leftAt: nowIso() }, actorId); }

  // ---------- contributions ----------
  async submitContribution({ memberId, amountUsd, forMonth, method = 'bank', bank = '', reference = '', currency = 'USD', note = '', proofFile = null, proofName = '', proofDataUrl = '', sentOn = '' }) {
    if (proofFile) {
      proofName = proofName || proofFile.name || 'screenshot';
      proofDataUrl = proofDataUrl || await new Promise((res) => {
        const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => res(''); fr.readAsDataURL(proofFile);
      });
    }
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
    // An extra — money on top of the monthly, or cash handed over — buys points at the
    // plain rate. It earns no tier bonus and no streak, and it never covers a month.
    const full = c.extra ? false : split.full;
    Object.assign(c, { status: CONTRIBUTION_STATUS.confirmed, reviewedBy: actorId, reviewedAt: at, reason: note, receivedUsd: split.amountUsd, currency, native, shareUsd: split.shareUsd, backingUsd: split.backingUsd, basePoints: split.basePoints, bonusPoints: 0, streakPoints: 0, foundingPoints: 0, points: split.basePoints, full });
    const push = (kind, points, usd, refType, refId, note, promo = false) => { this.state.ledger.push({ id: uid('led'), memberId: c.memberId, kind, points, usd, refType, refId, note, at, by: actorId, expiresAt: promo ? addMonthsIso(at, s.bonusExpireMonths) : null }); };
    push(LEDGER_KIND.earn, split.basePoints, split.backingUsd, 'contribution', c.id,
      c.extra ? (c.note?.trim() || 'Extra contribution') : `${fmtMonth(c.forMonth)} contribution${split.full ? '' : ' · part of it'}`);
    // Promotional points: tier bonus, streak, founding — all funded from the share, capped per month.
    const promoRoom = () => this.promoRoom(c.forMonth);
    const mint = (kind, points, note) => {
      if (points <= 0) return 0;
      const room = promoRoom();
      if (points > room) { this.state.promoDeferrals.push({ id: uid('def'), memberId: c.memberId, kind, points, reason: 'cap', month: c.forMonth, refId: c.id, mintedAt: null }); return 0; }
      push(kind, points, round(points / s.pointsPerDollar), 'contribution', c.id, note, true);
      return points;
    };
    if (!c.extra && split.bonusPoints > 0) c.bonusPoints = mint(LEDGER_KIND.bonus, split.bonusPoints, `${tierName(s, m.monthlyUsd)} bonus ${Math.round(tier.bonusRate * 100)}% of $${m.monthlyUsd}`);
    if (full) {
      const streakNow = this.consecutiveMonthsThrough(c.memberId, c.forMonth);
      const sb = s.streakBonuses?.[streakNow];
      // A reversed confirmation leaves its promo line in the append-only ledger, cancelled by a
      // reverse line. The guard used to see the cancelled line and refuse to mint again, so an
      // undo inside the sixty-second window cost the member the bonus for good.
      const stillStands = (l) => this.contribution(l.refId)?.status !== CONTRIBUTION_STATUS.reversed;
      if (sb && !this.state.ledger.some(l => l.memberId === c.memberId && l.kind === LEDGER_KIND.streak && l.note.startsWith(`${streakNow} `) && stillStands(l))) c.streakPoints = mint(LEDGER_KIND.streak, sb, `${streakNow} consecutive contributions`);
    }
    if (!c.extra && m.founding && s.foundingBonus > 0 && !this.state.ledger.some(l => l.memberId === c.memberId && l.kind === LEDGER_KIND.founding && this.contribution(l.refId)?.status !== CONTRIBUTION_STATUS.reversed)) c.foundingPoints = mint(LEDGER_KIND.founding, s.foundingBonus, 'Founding Insider · 2026');
    c.points = split.basePoints + c.bonusPoints + c.streakPoints + c.foundingPoints;
    this.log(actorId, 'contribution.confirm', 'contribution', id, { receivedUsd: split.amountUsd, points: c.points, full: split.full });
    await this.commit('contributions');
    return c;
  }
  /**
   * Money that arrived outside the queue: cash in the Banker's hand, a transfer he spotted
   * on the statement himself, or someone catching up a month they missed. Recorded and
   * confirmed in one step so the ledger, the Reserve and the month all stay true.
   *
   * With `forMonth` set it IS that month's contribution and earns everything a normal one
   * does. With `forMonth` null it is an extra: base points only, and it covers no month.
   */
  async recordDirectContribution({ memberId, amountUsd, forMonth = null, method = 'cash', currency = 'USD', note = '', sentOn = '' }, actorId) {
    if (!this.canConfirmMoney()) throw new Error('Only the Banker can record money that arrived');
    const m = this.member(memberId); if (!m) throw new Error('No such member');
    const usd = round(amountUsd);
    if (!(usd > 0)) throw new Error('Enter the amount that actually arrived');
    const extra = !forMonth;
    if (!extra && this.state.contributions.some(c => c.memberId === memberId && c.forMonth === forMonth
      && [CONTRIBUTION_STATUS.pending, CONTRIBUTION_STATUS.confirmed].includes(c.status)))
      throw new Error(`${fmtMonth(forMonth)} already has a sent or confirmed contribution — confirm that one instead`);
    if (extra && !note?.trim()) throw new Error('Say what this money was for — members read it on their ledger');
    const c = {
      id: uid('con'), memberId, forMonth: extra ? null : forMonth, extra, expectedUsd: usd, amountUsd: usd, receivedUsd: null,
      currency, method, bank: '', reference: extra ? '' : refFor(m, forMonth),
      note: note.trim(), proofName: '', proofDataUrl: '', sentOn: sentOn || nowIso().slice(0, 10), submittedAt: nowIso(),
      status: CONTRIBUTION_STATUS.pending, reviewedBy: null, reviewedAt: null, reason: '', shareUsd: null, backingUsd: null,
      points: null, basePoints: null, bonusPoints: null, streakPoints: 0, foundingPoints: 0, full: null, reversedOf: null,
      recordedBy: actorId,
    };
    this.state.contributions.push(c);
    this.log(actorId, 'contribution.record', 'contribution', c.id, { memberId, amountUsd: usd, forMonth: c.forMonth, method });
    return this.confirmContribution(c.id, actorId, { receivedUsd: usd, currency, note: note.trim() });
  }
  /** What the Banker would mint for a given amount, before he commits to it. */
  previewDirect(memberId, amountUsd, { forMonth = null, currency = 'USD' } = {}) {
    const m = this.member(memberId); const s = this.settings;
    const usd = currency === 'AWG' ? round(Number(amountUsd) / s.awgPerUsd) : round(amountUsd);
    const split = splitContribution(usd, s, tierFor(s, m?.monthlyUsd || 100));
    const extra = !forMonth;
    const bonus = extra ? 0 : split.bonusPoints;
    return { usd, extra, shareUsd: split.shareUsd, backingUsd: split.backingUsd, basePoints: split.basePoints,
      bonusPoints: bonus, points: split.basePoints + bonus, full: extra ? false : split.full };
  }
  /** Months this member could still be recorded against: missed, or the one running now. */
  openMonthsFor(memberId, back = 6) {
    const out = []; let m = shiftMonth(monthKey(), -back);
    for (let i = 0; i <= back; i++) {
      const st = this.monthStatus(memberId, m);
      if (st === 'due' && (this.member(memberId)?.joinedAt || '').slice(0, 7) <= m) out.push(m);
      m = shiftMonth(m, 1);
    }
    return out;
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
    // Called from getters that run on every render, so it must never write through a
    // backend that has no local adapter — SupabaseStore has none, and this threw a
    // TypeError out of the member home the moment any quote lapsed. There the server's
    // release_expired_quotes() is authoritative; this only keeps the screen honest.
    if (changed) this.adapter?.save(this.state);
  }
  async requestRedemption({ memberId, stayId, checkIn, checkOut, guests = 2, seats = 1, note = '', flexDays = 0, maxPoints = null, shared = false, sourceUrl = '', sourceLabel = '' }) {
    const stay = this.stay(stayId); if (!stay) throw new Error('No such stay');
    const m = this.member(memberId); const tier = tierFor(this.settings, m.monthlyUsd);
    const isTrip = stay.kind === 'trip';
    const q = quoteStay(stay, isTrip ? stay.dates.from : checkIn, isTrip ? stay.dates.to : checkOut, this.settings, { seats });
    if (!isTrip && q.nights < 1) throw new Error('Check-out must be after check-in');
    if (!q.ok) throw new Error(`Minimum ${q.minNights} nights for these dates`);
    // Standing counts here, not just on the home screen. Anchor promises one more open request
    // than your level allows and the Desk was refusing it — the cap read tier.holds alone.
    const allow = effectiveTier(tier, this.standing(memberId));
    if (this.openHolds(memberId) >= allow.holds) {
      throw new Error(allow.fromStanding.extraHolds
        ? `That is ${allow.holds} open requests — ${tier.holds} for ${tierName(this.settings, m.monthlyUsd)} and ${allow.fromStanding.extraHolds} for your standing. Close one and ask again.`
        : `${tierName(this.settings, m.monthlyUsd)} allows ${tier.holds} open request${tier.holds > 1 ? 's' : ''} at a time`);
    }
    if (isTrip && this.seatsHeld(stayId) + seats > (stay.seats || 99)) throw new Error('Not enough seats left on this trip');
    if (!isTrip) {
      const maxAhead = new Date(); maxAhead.setMonth(maxAhead.getMonth() + tier.windowMonths);
      if (new Date(checkIn) > maxAhead) throw new Error(`${tierName(this.settings, m.monthlyUsd)} can request up to ${tier.windowMonths} months ahead`);
    }
    const r = {
      id: uid('red'), memberId, stayId, kind: isTrip ? 'trip' : 'stay', checkIn: isTrip ? stay.dates.from : checkIn, checkOut: isTrip ? stay.dates.to : checkOut, nights: q.nights, guests: isTrip ? seats : Number(guests), seats: isTrip ? seats : null, note, flexDays, maxPoints,
      indicativePoints: q.points, seasons: q.breakdown, retailUsd: q.retailUsd, shared: !!shared, pledges: [],
      // The listing they were looking at when they asked. This is the whole of Victor's "I need
      // to know the source, I need a link to even be able to book it" — and it was being dropped
      // on the floor: the caller passed it, this signature did not name it, so whereToBook()'s
      // top-ranked "the listing they were looking at" row could never fire for a real request.
      sourceUrl: safeUrl(sourceUrl) || '', sourceLabel: String(sourceLabel || '').slice(0, 60),
      points: q.points, topUpUsd: 0, quoteStack: null, hotelTerms: '', hotelDeadline: null, quotedBy: null, quotedAt: null, quoteExpiresAt: null,
      status: REDEMPTION_STATUS.requested, requestedAt: nowIso(), decidedBy: null, decidedAt: null, decision: '', heldAt: null, confirmedAt: null, completedAt: null, paidUsd: null, confirmationRef: '',
    };
    this.state.redemptions.push(r);
    this.log(memberId, 'redemption.request', 'redemption', r.id, { stay: stay.name, nights: q.nights, points: q.points });
    await this.commit('redemptions');
    return r;
  }
  /**
   * A look: a named person opened a named page at a named time and wrote down what they saw.
   *
   * This is the only availability fact the app holds. Nothing checks a hotel — there is no API,
   * and every chain refuses a scripted request — so the app never says a room is available. It
   * says who looked, where, when, and what they found. Append-only: a second look is a second
   * row, so a change of story is visible rather than overwritten.
   */
  async recordLook({ stayId, checkIn, checkOut, found, channel = 'site', url = '', label = '', priceUsd = null, roomLabel = '', note = '', redemptionId = null, byRobot = false }, actorId) {
    if (!this.stay(stayId)) throw new Error('No such stay');
    if (!(Date.parse(checkOut) > Date.parse(checkIn))) throw new Error('Check-out must be after check-in');
    const clean = safeUrl(url);
    if (channel === 'site' && !clean && found !== 'booked') throw new Error('A look at a page needs the link to that page');
    if (['unclear', 'different'].includes(found) && !String(note).trim()) {
      throw new Error('Say what you saw — that is the whole point of writing it down');
    }
    const hours = (this.settings.lookHours || { site: 72, phone: 48 })[channel] ?? 48;
    const at = nowIso();
    const l = {
      id: uid('look'), stayId, redemptionId, checkIn, checkOut, found, channel,
      url: clean || '', label: String(label || '').slice(0, 60), priceUsd: priceUsd == null ? null : Number(priceUsd),
      roomLabel: String(roomLabel || '').slice(0, 80), note: String(note || '').slice(0, 400),
      lookedBy: actorId, byRobot: !!byRobot, lookedAt: at, goodUntil: addHours(at, hours),
    };
    (this.state.looks ||= []).push(l);
    if (redemptionId) { const r = this.redemption(redemptionId); if (r) r.lastLookId = l.id; }
    this.log(actorId, 'look.record', 'look', l.id, { stay: stayId, found, robot: !!byRobot, url: clean });
    await this.commit('looks', 'redemptions');
    return l;
  }
  /** The newest HUMAN look whose nights contain these ones. A robot find never counts. */
  lookFor(stayId, checkIn, checkOut, since = null) {
    return (this.state.looks || [])
      .filter(l => l.stayId === stayId && !l.byRobot
        && Date.parse(l.checkIn) <= Date.parse(checkIn)
        && Date.parse(l.checkOut) >= Date.parse(checkOut)
        && (!since || Date.parse(l.lookedAt) >= Date.parse(since)))
      .sort((a, b) => Date.parse(b.lookedAt) - Date.parse(a.lookedAt))[0] || null;
  }
  looksFor(redemptionId) {
    return (this.state.looks || []).filter(l => l.redemptionId === redemptionId)
      .sort((a, b) => Date.parse(b.lookedAt) - Date.parse(a.lookedAt));
  }
  /** Requests that predate the gate are exempt, so it does not brick the open queue. */
  needsLook(r) {
    const stay = this.stay(r?.stayId);
    if (!r || !stay || stay.kind === 'trip') return false;
    const from = this.settings.looksFrom;
    return !!from && Date.parse(r.requestedAt) >= Date.parse(from);
  }
  /** Planner publishes the binding all-in quote. Top-up = points beyond Available, payable in cash. */
  async quoteRedemption(id, actorId, { points, stack = null, terms = '', hotelDeadline = null, note = '', lookId = null }) {
    const r = this.redemption(id); if (!r) throw new Error('No such request');
    if (r.status !== REDEMPTION_STATUS.requested) throw new Error('Only an open request can be quoted');
    const pts = Math.round(Number(points)); if (!(pts > 0)) throw new Error('Quote must be positive');
    // The Circle's share has to be IN the quote, because every screen tells the member it is and
    // because it is the club's only income. The composer once published the hotel's cash exactly
    // and nobody noticed for months, so the arithmetic is checked here rather than trusted: when
    // a stack is given, the points must equal the hotel lines plus the share on top. Mirrored in
    // quote_redemption() — a rule enforced in one backend is not enforced.
    if (stack && typeof stack === 'object') {
      const hotel = Object.entries(stack)
        .filter(([k]) => k !== 'share')
        .reduce((sum, [, v]) => sum + (Number(v) || 0), 0);
      if (hotel > 0) {
        const want = Math.round(hotel * (1 + this.settings.serviceRate) * this.settings.pointsPerDollar);
        // A dollar of slack: the sheet rounds the share to cents before adding it.
        if (Math.abs(pts - want) > this.settings.pointsPerDollar) {
          const n = (x) => Math.round(x).toLocaleString('en-US');
          throw new Error(`That quote leaves out the Circle's share: ${n(hotel * this.settings.pointsPerDollar)} points of hotel should be quoted at ${n(want)}.`);
        }
      }
    }
    // The gate. Mirrors quote_redemption() in SQL exactly — if these two disagree, the demo
    // teaches a rule the server does not enforce, which is the failure this whole app is about.
    let look = null;
    if (this.needsLook(r)) {
      look = lookId ? (this.state.looks || []).find(l => l.id === lookId) : this.lookFor(r.stayId, r.checkIn, r.checkOut);
      if (lookId) {
        if (!look) throw new Error('No such look');
        if (look.stayId !== r.stayId) throw new Error('That look is for a different property');
        if (look.byRobot) throw new Error('That is the watcher’s find, not a look. Open it yourself first.');
        if (Date.parse(look.checkIn) > Date.parse(r.checkIn) || Date.parse(look.checkOut) < Date.parse(r.checkOut)) {
          throw new Error('That look does not cover these nights');
        }
      }
      if (!look) throw new Error('Open the link and say what you saw before you price it. A quote with nothing behind it is the thing we are getting rid of.');
      if (look.found === 'gone') throw new Error('The last look says that week was gone. Look again, or decline it.');
      if (look.found === 'unclear') throw new Error('The last look says it was not clear. Ring them, or look again.');
    }
    const pledged = sum(r.pledges || [], p => p.points);
    const available = Math.max(0, this.availablePoints(r.memberId));
    const covered = Math.min(Math.max(0, pts - pledged), available);
    const at = nowIso();
    // A quote cannot outlive the look it was made against — but a stale look never dead-ends the
    // Desk, it costs the member acceptance time instead, down to a floor. A hard recency refusal
    // on a man with a job produces invented looks, and an invented look is worse than an old one.
    const full = addHours(at, this.settings.quoteHours);
    const floor = addHours(at, this.settings.minQuoteHours ?? 12);
    const capped = look?.goodUntil && Date.parse(look.goodUntil) < Date.parse(full) ? look.goodUntil : full;
    const expires = Date.parse(capped) < Date.parse(floor) ? floor : capped;
    Object.assign(r, { status: REDEMPTION_STATUS.quoted, points: covered, quotedPoints: pts, topUpUsd: round(Math.max(0, pts - covered - pledged) / this.settings.pointsPerDollar), quoteStack: stack, hotelTerms: terms, hotelDeadline, quotedBy: actorId, quotedAt: at, quoteLookId: look?.id || null, quoteExpiresAt: expires, decision: note });
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
    const outstanding = (r.quotedPoints || r.indicativePoints || 0) - this.coveredPoints(r);
    if (outstanding <= 0) throw new Error('This booking is already covered');
    // Cap at what the booking still needs before checking the balance, so offering more
    // than is wanted puts in what is wanted rather than being refused.
    const amount = Math.min(pts, outstanding);
    const available = this.availablePoints(memberId);
    if (amount > available) throw new Error(`You have ${available.toLocaleString('en-US')} points available`);
    r.pledges ||= [];
    const existing = r.pledges.find(p => p.memberId === memberId);
    if (existing) existing.points += amount; else r.pledges.push({ id: uid('pld'), memberId, points: amount, at: nowIso() });
    // Once a booking is fully covered, no cash top-up is owed any more.
    r.topUpUsd = round(Math.max(0, (r.quotedPoints || 0) - this.coveredPoints(r)) / this.settings.pointsPerDollar);
    // What was received is a fact; whether it still covers what is owed is not.
    if (r.topUpReceivedUsd != null) r.topUpConfirmed = r.topUpReceivedUsd >= r.topUpUsd;
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
    // What was received is a fact; whether it still covers what is owed is not.
    if (r.topUpReceivedUsd != null) r.topUpConfirmed = r.topUpReceivedUsd >= r.topUpUsd;
    this.log(actorId, 'redemption.pledge.withdraw', 'redemption', id, { memberId });
    await this.commit('redemptions');
    return r;
  }

  /** Banker (or planner) pays the hotel: points burn, booking confirmed. */
  async payRedemption(id, actorId, { paidUsd = null, confirmationRef = '' } = {}) {
    const r = this.redemption(id); if (!r) throw new Error('No such request');
    if (r.status !== REDEMPTION_STATUS.held) throw new Error('The member has not accepted a quote yet');
    if ((r.topUpUsd || 0) > (r.topUpReceivedUsd ?? 0)) throw new Error(`The top-up of $${(r.topUpUsd || 0).toFixed(2)} has not been received — the Banker has $${(r.topUpReceivedUsd ?? 0).toFixed(2)}`);
    // The gate on the quote protects what the member expects. THIS one protects the money: this
    // is the irreversible act — points burn here, the pledgers' points burn here, and paid_usd
    // leaves the club here. Days pass between a member accepting and the Desk booking, and a week
    // can go in that time. Requiring a look made since they accepted costs nothing in practice,
    // because at this moment the Desk is on the booking page doing the booking.
    if (this.needsLook(r)) {
      const l = this.lookFor(r.stayId, r.checkIn, r.checkOut, r.heldAt);
      if (!l) throw new Error(`Look at it once more before you pay. Nobody has looked at these nights since ${this.member(r.memberId)?.name.split(' ')[0] || 'the member'} accepted.`);
      if (['gone', 'unclear'].includes(l.found)) throw new Error(`The last look says that week was ${l.found}. Do not pay for it.`);
    }
    if (this.availablePoints(r.memberId) + r.points < r.points) throw new Error('Member no longer has enough points');
    for (const p of r.pledges || []) {
      if (this.availablePoints(p.memberId) + p.points < p.points) throw new Error(`${this.member(p.memberId)?.name || 'A member'} no longer has the points they chipped in`);
    }
    const stay = this.stay(r.stayId); const at = nowIso();
    Object.assign(r, { status: REDEMPTION_STATUS.confirmed, confirmedAt: at, paidUsd: paidUsd == null ? hotelOwedUsd(r, this.settings) : Number(paidUsd), confirmationRef, decidedBy: actorId, decidedAt: at });
    const burn = (memberId, points, note) => this.state.ledger.push({ id: uid('led'), memberId, kind: LEDGER_KIND.burn, points: -points, usd: -round(points / this.settings.pointsPerDollar), refType: 'redemption', refId: r.id, note, at, by: actorId });
    if (r.points > 0) burn(r.memberId, r.points, `${stay?.name || 'Stay'} · ${r.nights} nights`);
    for (const p of r.pledges || []) {
      burn(p.memberId, p.points, `${stay?.name || 'Stay'} · chipped in for ${this.member(r.memberId)?.name.split(' ')[0] || 'an Insider'}`);
    }
    // The booking is the last and best look: the one moment somebody did not just see the room,
    // they took it. Recorded so the history does not end on a maybe.
    (this.state.looks ||= []).push({
      id: uid('look'), stayId: r.stayId, redemptionId: r.id, checkIn: r.checkIn, checkOut: r.checkOut,
      found: 'booked', channel: 'site', url: safeUrl(r.sourceUrl) || safeUrl(stay?.site) || '',
      label: 'Booked', priceUsd: null, roomLabel: '', note: confirmationRef || '',
      lookedBy: actorId, byRobot: false, lookedAt: at, goodUntil: addHours(at, 24 * 3650),
    });
    r.lastLookId = this.state.looks[this.state.looks.length - 1].id;
    this.log(actorId, 'redemption.pay', 'redemption', id, { points: r.points, paidUsd: r.paidUsd, confirmationRef }); await this.commit('redemptions', 'looks'); return r;
  }
  async confirmTopUp(id, actorId) {
    const r = this.redemption(id); if (!r) throw new Error('No such request');
    if (![REDEMPTION_STATUS.quoted, REDEMPTION_STATUS.held].includes(r.status)) throw new Error('A top-up is only owed on a live quote');
    if (!(r.topUpUsd > 0)) throw new Error('No top-up is owed on this booking');
    // Recorded as a fact, at the moment the Banker says he has it. A later pledge changes what
    // is owed, never what was received — and confirming again can only ever raise it: a second
    // tap while less is owed must not erase the record of cash already in hand. Mirrors
    // confirm_top_up().
    r.topUpConfirmed = true; r.topUpConfirmedAt = nowIso();
    r.topUpReceivedUsd = Math.max(r.topUpReceivedUsd ?? 0, r.topUpUsd);
    this.log(actorId, 'redemption.topup', 'redemption', id, { topUpUsd: r.topUpUsd, receivedUsd: r.topUpReceivedUsd });
    await this.commit('redemptions'); return r;
  }
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

  // ---------- room types ----------
  // What you can actually be given at a property: a studio, a one-bedroom villa, an
  // oceanfront room. `rateFactor` is what that type costs relative to the cheapest one,
  // so one seasonal rate per property still prices every room in it.
  roomTypes() { return (this.state.roomTypes || []).filter(r => r.active !== false); }
  roomTypesFor(stayId) { return this.roomTypes().filter(r => r.stayId === stayId).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || (a.rateFactor || 1) - (b.rateFactor || 1)); }
  roomType(id) { return id ? (this.state.roomTypes || []).find(r => r.id === id) || null : null; }

  /**
   * Everywhere the Desk could go to book this request, best first.
   *
   * The member's own listing comes first because it is the one they were actually looking at —
   * that price, that week. After it come the standing sources for the property, so there is
   * always something to click even when somebody just browsed the catalog and picked dates.
   */
  whereToBook(redemptionId) {
    const r = this.redemption(redemptionId); if (!r) return [];
    const stay = this.stay(r.stayId);
    const out = [];
    if (r.sourceUrl) out.push({ label: r.sourceLabel || 'What they were looking at', url: r.sourceUrl, exact: true });
    const src = stay?.sources || {};
    if (src.interval?.url) out.push({ label: 'Interval', url: src.interval.url, seenOn: src.interval.seenOn });
    if (src.redweek?.url) out.push({ label: 'RedWeek', url: src.redweek.url, seenOn: src.redweek.seenOn });
    if (stay?.site) out.push({ label: `${stay.name} direct`, url: stay.site });
    return out;
  }
  /**
   * What a night in this particular room costs at its cheapest, in points.
   *
   * Renamed from roomPoints(stayId, roomTypeId, season). JS discards a surplus positional
   * argument in silence, so keeping the old name would have left both call sites passing a
   * dead season variable and rendering plausible numbers forever.
   */
  roomPointsFrom(stayId, roomTypeId) {
    const stay = this.stay(stayId); if (!stay) return 0;
    const base = fromPoints(stay, this.settings);
    const rt = this.roomType(roomTypeId);
    return Math.round(base * (rt?.rateFactor || 1));
  }
  async upsertRoomType(data, actorId) {
    if (!this.canPlan()) throw new Error('Only a planner can edit the rooms');
    if (!data.stayId || !this.stay(data.stayId)) throw new Error('Which property is this room in?');
    if (!data.name?.trim()) throw new Error('Give the room type its name');
    this.state.roomTypes ||= [];
    let r = data.id ? this.roomType(data.id) : null;
    if (r) Object.assign(r, data);
    else { r = { id: uid('rt'), active: true, sortOrder: this.roomTypesFor(data.stayId).length, rateFactor: 1, ...data }; this.state.roomTypes.push(r); }
    this.log(actorId, 'roomType.upsert', 'roomType', r.id, { name: r.name });
    await this.commit('roomTypes');
    return r;
  }
  async removeRoomType(id, actorId) {
    const r = this.roomType(id); if (!r) return;
    if (!this.canPlan()) throw new Error('Only a planner can edit the rooms');
    r.active = false;
    this.log(actorId, 'roomType.retire', 'roomType', id, {}); await this.commit('roomTypes');
  }

  // ---------- the watch list, and deals that turn up ----------
  //
  // A watch is a standing want: "a one-bedroom at the Ocean Club, some week in March,
  // and I will not pay more than 200,000 points for it." Nothing is reserved by it.
  //
  // A deal is a real thing that became available — Victor saw it on Interval, Ian got the
  // email, a hotel came back with a rate. Posting one matches it against every open watch
  // and puts it in front of the people who asked for exactly that.
  watches() { return (this.state.watches || []).filter(w => w.active !== false).sort(desc('createdAt')); }
  watchesFor(memberId) { return this.watches().filter(w => w.memberId === memberId); }
  watch(id) { return (this.state.watches || []).find(w => w.id === id) || null; }

  async addWatch({ memberId, stayId = null, roomTypeId = null, kind = 'aruba', from, to, nights = 3, flexDays = 3, guests = 2, maxPoints = null, note = '' }) {
    if (!this.member(memberId)) throw new Error('No such member');
    if (!from || !to) throw new Error('Say roughly when you would go');
    if (from > to) throw new Error('Those dates are the wrong way round');
    if (!(nights > 0)) throw new Error('How many nights?');
    if (stayId && !this.stay(stayId)) throw new Error('That place is no longer on the list');
    const dup = this.watchesFor(memberId).find(w => w.stayId === stayId && w.roomTypeId === roomTypeId && w.from === from && w.to === to);
    if (dup) throw new Error('You are already watching for exactly that');
    const w = { id: uid('wch'), memberId, stayId, roomTypeId, kind, from, to, nights: Math.round(nights),
      flexDays: Math.max(0, Math.round(flexDays)), guests: Math.round(guests) || 1,
      maxPoints: maxPoints ? Math.round(maxPoints) : null, note: note.trim(), active: true,
      createdAt: nowIso(), lastSeenAt: null };
    (this.state.watches ||= []).push(w);
    this.log(memberId, 'watch.add', 'watch', w.id, { stayId, from, to, nights });
    await this.commit('watches');
    return w;
  }
  async removeWatch(id, actorId) {
    const w = this.watch(id); if (!w) throw new Error('No such watch');
    if (w.memberId !== actorId && !this.canPlan()) throw new Error('That is not your watch');
    w.active = false; w.endedAt = nowIso();
    this.log(actorId, 'watch.remove', 'watch', id, {}); await this.commit('watches'); return w;
  }
  /** Mark every match on this member's watches as seen, so the bell stops ringing. */
  /**
   * Find a catalog entry by the id it has in the bundled catalog. On the local backend that
   * IS the id; on Supabase every row has a fresh uuid, so fall back to matching the name the
   * bundled catalog gives that id. Copy that names a specific hotel needs this — reading
   * store.stay('stay_surfclub') straight off the live backend returns undefined, and the
   * landing page then called seasonPoints(undefined) and took the whole page down.
   * Returns undefined rather than throwing when the catalog has no such place.
   */
  stayLike(seedId) {
    const direct = this.stay(seedId);
    if (direct) return direct;
    const name = CATALOG_NAMES[seedId];
    if (!name) return undefined;
    return this.state.stays.find(x => x.name === name);
  }

  async markWatchesSeen(memberId) {
    const stale = this.watchesFor(memberId).filter(w => this.matchesForMember(memberId)
      .some(m => m.watch.id === w.id && (!w.lastSeenAt || m.deal.postedAt > w.lastSeenAt)));
    if (!stale.length) return;            // nothing new: do not commit, do not re-render
    const at = nowIso();
    for (const w of stale) w.lastSeenAt = at;
    await this.commit('watches');
  }

  deals() { return (this.state.deals || []).slice().sort(desc('postedAt')); }
  deal(id) { return (this.state.deals || []).find(d => d.id === id) || null; }
  /** Deals still worth looking at: not expired, not taken. */
  liveDeals() {
    const now = nowIso();
    return this.deals().filter(d => d.status === 'live' && (!d.expiresAt || d.expiresAt > now));
  }
  async postDeal({ stayId, roomTypeId = null, title = '', from, to, nights = null, pointsTotal = null, pointsPerNight = null,
                   retailUsd = null, source = 'other', sourceUrl = '', sourceRef = '', units = 1, expiresAt = null, note = '' }, actorId) {
    if (!this.canPostDeals()) throw new Error('Only Victor or Ian can post a deal');
    const stay = this.stay(stayId); if (!stay) throw new Error('Pick a place from the catalog');
    if (!from || !to) throw new Error('A deal needs the dates it is for');
    if (from > to) throw new Error('Those dates are the wrong way round');
    const n = nights || nightsBetween(from, to) || 1;
    const total = pointsTotal != null ? Math.round(pointsTotal)
      : pointsPerNight != null ? Math.round(pointsPerNight) * n : null;
    if (!(total > 0)) throw new Error('What does it cost in points?');
    const d = { id: uid('del'), stayId, roomTypeId, kind: stay.kind === 'trip' ? 'trip' : 'aruba',
      title: title.trim() || stay.name, from, to, nights: n, pointsTotal: total,
      pointsPerNight: Math.round(total / n), retailUsd: retailUsd != null ? round(retailUsd) : null,
      source, sourceUrl: sourceUrl.trim(), sourceRef: sourceRef.trim(), units: Math.max(1, Math.round(units)),
      note: note.trim(), status: 'live', postedBy: actorId, postedAt: nowIso(), expiresAt, claimedBy: [] };
    (this.state.deals ||= []).push(d);
    this.log(actorId, 'deal.post', 'deal', d.id, { stayId, from, to, pointsTotal: total, source });
    await this.commit('deals');
    return d;
  }
  async retireDeal(id, actorId, reason = '') {
    const d = this.deal(id); if (!d) throw new Error('No such deal');
    if (!this.canPostDeals()) throw new Error('Only Victor or Ian can take a deal down');
    d.status = 'gone'; d.retiredAt = nowIso(); d.retiredReason = reason;
    this.log(actorId, 'deal.retire', 'deal', id, { reason }); await this.commit('deals'); return d;
  }

  /**
   * Does this deal answer that watch? Deliberately generous on dates — a watch is a rough
   * want, not a booking — and strict on the two things a member actually said no to:
   * a different property, and more points than they are willing to spend.
   */
  dealMatchesWatch(deal, watch) {
    if (!deal || !watch || watch.active === false) return null;
    if (deal.status !== 'live') return null;
    if (watch.stayId && watch.stayId !== deal.stayId) return null;
    if (watch.roomTypeId && deal.roomTypeId && watch.roomTypeId !== deal.roomTypeId) return null;
    if (!watch.stayId && watch.kind !== 'any' && watch.kind !== deal.kind) return null;
    if (watch.maxPoints && deal.pointsTotal > watch.maxPoints) return null;
    const flex = watch.flexDays || 0;
    const wantFrom = shiftDays(watch.from, -flex), wantTo = shiftDays(watch.to, flex);
    const start = deal.from > wantFrom ? deal.from : wantFrom;
    const end = deal.to < wantTo ? deal.to : wantTo;
    const overlap = nightsBetween(start, end);
    if (overlap < Math.min(watch.nights, deal.nights)) return null;
    const affordable = this.availablePoints(watch.memberId) >= deal.pointsTotal;
    return { deal, watch, overlap, affordable,
      short: Math.max(0, deal.pointsTotal - Math.max(0, this.availablePoints(watch.memberId))) };
  }
  /** Everyone who asked for something this deal answers. */
  matchesForDeal(dealId) {
    const d = this.deal(dealId); if (!d) return [];
    return this.watches().map(w => this.dealMatchesWatch(d, w)).filter(Boolean);
  }
  /** Live deals that answer anything this member is watching for. */
  matchesForMember(memberId = this.session?.memberId) {
    const mine = this.watchesFor(memberId);
    const out = [];
    for (const d of this.liveDeals()) {
      for (const w of mine) { const m = this.dealMatchesWatch(d, w); if (m) { out.push(m); break; } }
    }
    return out.sort((a, b) => (a.deal.postedAt < b.deal.postedAt ? 1 : -1));
  }
  /** Matches this member has not looked at yet — what the bell counts. */
  unseenMatches(memberId = this.session?.memberId) {
    return this.matchesForMember(memberId).filter(m => !m.watch.lastSeenAt || m.deal.postedAt > m.watch.lastSeenAt);
  }
  /** For the Desk: what the Circle is waiting for, most-wanted first. */
  demand() {
    const rows = {};
    for (const w of this.watches()) {
      const key = `${w.stayId || 'any'}|${w.roomTypeId || 'any'}`;
      (rows[key] ||= { stayId: w.stayId, roomTypeId: w.roomTypeId, watches: [], members: new Set() });
      rows[key].watches.push(w); rows[key].members.add(w.memberId);
    }
    return Object.values(rows)
      .map(r => ({ ...r, stay: r.stayId ? this.stay(r.stayId) : null, count: r.members.size,
        matched: this.liveDeals().some(d => r.watches.some(w => this.dealMatchesWatch(d, w))) }))
      .sort((a, b) => b.count - a.count);
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
    return { month, rows, confirmedCount: rows.filter(r => r.status === 'confirmed').length, pendingCount: rows.filter(r => r.status === 'pending').length, missingCount: rows.filter(r => r.status === 'missing').length, grossUsd: round(sum(rows, r => r.receivedUsd || 0)), shareUsd: 0, treasury: t, deferrals, expiring, alreadyClosed: this.state.monthCloses.find(c => c.month === month) || null };
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
    // Deferred promotional points are minted only where the month has room for them — the twin
    // of the loop in close_month(). They were deferred BECAUSE the cap was hit; this loop used
    // to hand every one of them over at close, minting exactly the points the cap had refused,
    // and teaching the Banker that a close always clears the backlog when the server's does not.
    for (const d of p.deferrals) {
      if (d.points > this.promoRoom(month)) break;
      d.mintedAt = at; this.state.ledger.push({ id: uid('led'), memberId: d.memberId, kind: d.kind, points: d.points, usd: round(d.points / this.settings.pointsPerDollar), refType: 'contribution', refId: d.refId, note: `Deferred ${d.kind} minted at ${month} close`, at, by: actorId, expiresAt: addMonthsIso(at, this.settings.bonusExpireMonths) });
    }
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
