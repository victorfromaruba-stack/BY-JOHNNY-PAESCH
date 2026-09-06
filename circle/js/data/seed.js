// Seeded demo data. Deterministic (fixed PRNG) so the demo reads the same on every
// device, and it tells a story: nine months of history, four transfers waiting for
// the Banker right now, a partial receipt, a returned transfer that was re-sent,
// a paused member, a completed stay, a live quote and a held trip.
//
// Every person here is fictional apart from the three officers named in the brief,
// and all contact details are placeholders.

import { DEFAULT_SETTINGS, splitContribution, tierFor, quoteStay } from '../core/money.js';
import { ARUBA_STAYS, WORLD_TRIPS } from './stays.js';
import { VOCAB, initialsOf } from '../core/vocab.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const monthKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const iso = (d) => new Date(d).toISOString();
const fmtMonthLocal = (m) => { const [y, mm] = m.split('-').map(Number); return new Date(y, mm - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); };
const shift = (m, n) => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + n, 1); return monthKeyOf(d); };
export const refFor = (member, month) => `${VOCAB.refPrefix}-${initialsOf(member.name)}-${month}`;

const BANKS = ['Aruba Bank', 'Banco di Caribe', 'CMB', 'RBC Royal Bank'];

// story: 'partial' (Aug received short), 'returned' (Mar returned then re-sent),
// 'pendingNow' (September transfer still waiting for the Banker), 'paused', 'lapsed'
const PEOPLE = [
  { id: 'mem_victor', name: 'Victor Rosario', roles: ['planner', 'admin'], tier: 200, since: '2026-01', hue: 208, home: 'Noord', title: 'Founder & Curator', founding: true, story: ['pendingNow'], dream: 'stay_ritz' },
  { id: 'mem_ian', name: 'Ian Hekman', roles: ['comms'], tier: 150, since: '2026-01', hue: 32, home: 'Oranjestad', title: 'Voice of the Circle', founding: true, dream: 'stay_renaissance' },
  { id: 'mem_vishnu', name: 'Vishnu', roles: ['treasurer'], tier: 150, since: '2026-01', hue: 152, home: 'Paradera', title: 'Banker of the Circle', founding: true, dream: 'stay_divi' },
  { id: 'mem_sasha', name: 'Sasha Wever', roles: ['member'], tier: 200, since: '2026-01', hue: 268, home: 'Malmok', founding: true, standingOrder: true, showOnRollcall: true, dream: 'stay_oceanvillas' },
  { id: 'mem_daniela', name: 'Daniela Croes', roles: ['member'], tier: 150, since: '2026-01', hue: 338, home: 'Santa Cruz', founding: true, story: ['paused', 'pendingNow'], dream: 'stay_manchebo' },
  { id: 'mem_marcus', name: 'Marcus Tromp', roles: ['member'], tier: 100, since: '2026-01', hue: 18, home: 'San Nicolas', founding: true, story: ['partial', 'pendingNow'], dream: 'stay_boardwalk' },
  { id: 'mem_ana', name: 'Ana-Lucía Maduro', roles: ['member'], tier: 150, since: '2026-01', hue: 4, home: 'Savaneta', founding: true, story: ['returned', 'notYet'], showOnRollcall: true, dream: 'stay_bucuti' },
  { id: 'mem_jeroen', name: 'Jeroen de Cuba', roles: ['member'], tier: 200, since: '2026-02', hue: 226, home: 'Palm Beach', founding: true, story: ['notYet'], dream: 'stay_oceanclub' },
  { id: 'mem_kimberly', name: 'Kimberly Werleman', roles: ['member'], tier: 100, since: '2026-06', hue: 96, home: 'Piedra Plat', showOnRollcall: true, dream: 'stay_amsterdam' },
  { id: 'mem_ricardo', name: 'Ricardo Lacle', roles: ['member'], tier: 150, since: '2026-01', hue: 190, home: 'Tanki Leendert', founding: true, standingOrder: true, dream: 'stay_surfclub' },
  { id: 'mem_priya', name: 'Priya Nandwani', roles: ['member'], tier: 100, since: '2026-03', hue: 300, home: 'Bubali', story: ['notYet'], dream: 'stay_amsterdam' },
  { id: 'mem_diego', name: 'Diego Arends', roles: ['member'], tier: 200, since: '2026-01', hue: 48, home: 'Pos Chiquito', founding: true, dream: 'stay_bucuti' },
  { id: 'mem_fabian', name: 'Fabian Oduber', roles: ['member'], tier: 150, since: '2026-04', hue: 120, home: 'Sabana Blanco', story: ['pendingNow'], dream: 'stay_divi' },
  { id: 'mem_sharon', name: 'Sharon Kock', roles: ['member'], tier: 100, since: '2026-01', hue: 172, home: 'Noord', founding: true, story: ['lapsed'], dream: 'stay_voco' },
];

export function seed(now = new Date('2026-09-05T14:20:00Z')) {
  const rand = rng(20260905);
  const settings = {
    ...DEFAULT_SETTINGS,
    reserveAccount: { bank: 'Aruba Bank', holder: `${VOCAB.clubName} Reserve — held by Vishnu on behalf of the Circle`, number: '6001 2233 4455' },
    operatingAccount: { bank: 'Aruba Bank', holder: `${VOCAB.clubName} Operating — held by Vishnu on behalf of the Circle`, number: '6001 2233 4460' },
    whatsappGroupUrl: '',
  };
  const thisMonth = monthKeyOf(now);
  let n = 0; const uid = (p) => `${p}_s${(++n).toString(36).padStart(4, '0')}`;

  const members = PEOPLE.map(p => ({
    id: p.id, name: p.name, email: `${p.name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')}@example.aw`,
    phone: `+297 000 ${String(1000 + Math.floor(rand() * 8999))}`, roles: p.roles, status: 'active', monthlyUsd: p.tier,
    hue: p.hue, home: p.home, title: p.title || '', joinedAt: iso(new Date(`${p.since}-05T12:00:00Z`)),
    founding: !!p.founding, cardCode: initialsOf(p.name) + String(1000 + Math.floor(rand() * 8999)),
    household: [], preferences: {}, standingOrder: !!p.standingOrder, showOnRollcall: !!p.showOnRollcall, pausedMonths: [],
    dreamStayId: p.dream, sponsorId: p.id === 'mem_victor' ? null : 'mem_victor', notes: '',
  }));
  const byId = Object.fromEntries(members.map(m => [m.id, m]));

  const contributions = [], ledger = [], redemptions = [], audit = [], announcements = [], monthCloses = [], promoDeferrals = [], rulesAcceptances = [];
  const log = (actorId, action, entity, entityId, meta, at) => audit.push({ id: uid('aud'), actorId, action, entity, entityId, meta, at });

  for (const p of PEOPLE) {
    const m = byId[p.id]; const story = p.story || [];
    rulesAcceptances.push({ memberId: m.id, version: settings.rulesVersion, at: m.joinedAt });
    const tier = tierFor(settings, m.monthlyUsd);
    let streak = 0; let mk = p.since;
    let foundingMinted = false;
    while (mk <= thisMonth) {
      const paused = story.includes('paused') && (mk === '2026-07' || mk === '2026-08');
      if (paused) m.pausedMonths = [...(m.pausedMonths || []), mk];
      const lapsed = story.includes('lapsed') && mk >= '2026-07';
      if (paused || lapsed) { if (!paused) streak = 0; mk = shift(mk, 1); continue; }
      const current = mk === thisMonth;
      const pendingThisMonth = current && story.includes('pendingNow');
      // Contributions are due on the 5th; today IS the 5th, so this month is a real mix:
      // some confirmed, some sent and waiting for the Banker, some not sent yet.
      if (current && story.includes('notYet')) break;
      let day = Math.min(28, 2 + Math.floor(rand() * 6));
      if (current) day = Math.min(day, Math.max(1, now.getUTCDate() - (pendingThisMonth ? 1 : 2)));
      const sentAt = new Date(Date.UTC(Number(mk.slice(0, 4)), Number(mk.slice(5)) - 1, day, 9 + Math.floor(rand() * 8), Math.floor(rand() * 60)));
      if (current && sentAt > now) { break; }
      if (sentAt > now) { mk = shift(mk, 1); continue; }
      const base = {
        id: uid('con'), memberId: m.id, forMonth: mk, expectedUsd: m.monthlyUsd, amountUsd: m.monthlyUsd, receivedUsd: null, currency: 'USD',
        method: rand() < 0.2 ? 'ipago' : 'bank', bank: BANKS[Math.floor(rand() * BANKS.length)], reference: refFor(m, mk), note: '',
        proofName: rand() < 0.45 ? 'transfer.png' : '', proofDataUrl: '', sentOn: sentAt.toISOString().slice(0, 10), submittedAt: iso(sentAt),
        status: 'pending', reviewedBy: null, reviewedAt: null, reason: '', shareUsd: null, backingUsd: null, points: null,
        basePoints: null, bonusPoints: 0, streakPoints: 0, foundingPoints: 0, full: null, reversedOf: null,
      };
      const pendingNow = pendingThisMonth;
      const returned = story.includes('returned') && mk === '2026-03';
      const partial = story.includes('partial') && mk === '2026-08';

      if (returned) {
        const c = { ...base, status: 'rejected', reference: '', reviewedBy: 'mem_vishnu', reviewedAt: iso(new Date(sentAt.getTime() + 20 * 36e5)),
          reason: `No transfer with this reference is on the statement yet. Check the description field and resend with ${refFor(m, mk)}.` };
        contributions.push(c);
        log('mem_vishnu', 'contribution.return', 'contribution', c.id, { reason: c.reason }, c.reviewedAt);
        const again = { ...base, id: uid('con'), submittedAt: iso(new Date(sentAt.getTime() + 30 * 36e5)) };
        confirm(again, new Date(sentAt.getTime() + 40 * 36e5), m.monthlyUsd);
        contributions.push(again); streak++;
      } else if (pendingNow) {
        contributions.push(base);
        log(m.id, 'contribution.submit', 'contribution', base.id, { amountUsd: base.expectedUsd, forMonth: mk }, base.submittedAt);
      } else if (partial) {
        confirm(base, new Date(sentAt.getTime() + 26 * 36e5), 90);
        contributions.push(base); streak = 0;   // a short month does not extend the streak
      } else {
        confirm(base, new Date(sentAt.getTime() + (3 + Math.floor(rand() * 30)) * 36e5), m.monthlyUsd);
        contributions.push(base); streak++;
      }
      mk = shift(mk, 1);
    }

    function confirm(c, at, receivedUsd) {
      const split = splitContribution(receivedUsd, settings, tier);
      const atIso = iso(at);
      Object.assign(c, { status: 'confirmed', reviewedBy: 'mem_vishnu', reviewedAt: atIso, receivedUsd: split.amountUsd,
        shareUsd: split.shareUsd, backingUsd: split.backingUsd, basePoints: split.basePoints, full: split.full });
      const push = (kind, points, usd, note, promo = false) => ledger.push({
        id: uid('led'), memberId: c.memberId, kind, points, usd, refType: 'contribution', refId: c.id, note, at: atIso, by: 'mem_vishnu',
        expiresAt: promo ? iso(new Date(at.getTime() + settings.bonusExpireMonths * 30.44 * 864e5)) : null });
      push('earn', split.basePoints, split.backingUsd, `${fmtMonthLocal(c.forMonth)} contribution${split.full ? '' : ' · part of it'}`);
      if (split.bonusPoints > 0) { push('bonus', split.bonusPoints, split.bonusCostUsd, `${VOCAB.tiers[m.monthlyUsd]} bonus ${Math.round(tier.bonusRate * 100)}% of $${m.monthlyUsd}`, true); c.bonusPoints = split.bonusPoints; }
      if (split.full) {
        const sNow = streak + 1; const sb = settings.streakBonuses[sNow];
        if (sb) { push('streak', sb, sb / settings.pointsPerDollar, `${sNow} consecutive contributions`, true); c.streakPoints = sb; }
      }
      if (m.founding && !foundingMinted) { push('founding', settings.foundingBonus, settings.foundingBonus / settings.pointsPerDollar, VOCAB.founding, true); c.foundingPoints = settings.foundingBonus; foundingMinted = true; }
      c.points = split.basePoints + (c.bonusPoints || 0) + (c.streakPoints || 0) + (c.foundingPoints || 0);
      log('mem_vishnu', 'contribution.confirm', 'contribution', c.id, { receivedUsd: split.amountUsd, points: c.points }, atIso);
    }
  }
  byId.mem_daniela.status = 'active';           // paused Jul–Aug, back this month (transfer pending)
  byId.mem_sharon.status = 'paused'; byId.mem_sharon.pausedUntil = '2026-11';

  const stays = [...ARUBA_STAYS.map(s => ({ ...s })), ...WORLD_TRIPS.map(t => ({ ...t }))]
    .map(s => ({ ...s, active: s.draft ? false : true, createdAt: '2026-01-10T12:00:00Z', curatedBy: 'mem_victor' }));
  const stayById = Object.fromEntries(stays.map(s => [s.id, s]));

  // --- requests -------------------------------------------------------------
  const add = (r) => { redemptions.push(r); log(r.memberId, 'redemption.request', 'redemption', r.id, { stay: stayById[r.stayId]?.name }, r.requestedAt); return r; };
  const quoteOf = (stayId, ci, co, seats = 1) => quoteStay(stayById[stayId], ci, co, settings, { seats });

  // Diego stayed at Manchebo in August: burned, completed, with a voucher.
  {
    const q = quoteOf('stay_manchebo', '2026-08-10', '2026-08-13');
    const r = add({ id: uid('red'), memberId: 'mem_diego', stayId: 'stay_manchebo', kind: 'stay', checkIn: '2026-08-10', checkOut: '2026-08-13', nights: q.nights,
      guests: 2, seats: null, note: 'Anniversary.', flexDays: 0, maxPoints: null, shared: false, pledges: [], indicativePoints: q.points, seasons: q.breakdown, retailUsd: q.retailUsd,
      points: q.points, quotedPoints: q.points, topUpUsd: 0, topUpConfirmed: true, quoteStack: { room: 810, levy: 101.25, service: 89, resort: 0, env: 18 },
      hotelTerms: 'Free cancellation up to 30 days before arrival; one night inside 30 days.', hotelDeadline: '2026-07-11',
      quotedBy: 'mem_victor', quotedAt: '2026-06-02T15:10:00Z', quoteExpiresAt: '2026-06-05T15:10:00Z',
      status: 'completed', requestedAt: '2026-06-01T18:40:00Z', decidedBy: 'mem_victor', decidedAt: '2026-06-02T15:10:00Z',
      decision: 'Beachfront room, upgraded at no extra points.', heldAt: '2026-06-02T19:02:00Z', confirmedAt: '2026-06-04T10:15:00Z',
      completedAt: '2026-08-15T11:00:00Z', paidUsd: q.usd, confirmationRef: 'BT-2026-4471' });
    ledger.push({ id: uid('led'), memberId: 'mem_diego', kind: 'burn', points: -q.points, usd: -q.usd, refType: 'redemption', refId: r.id,
      note: `Manchebo Beach Resort & Spa · ${q.nights} nights`, at: '2026-06-04T10:15:00Z', by: 'mem_vishnu' });
    log('mem_vishnu', 'redemption.pay', 'redemption', r.id, { points: q.points }, '2026-06-04T10:15:00Z');
  }
  // Jeroen accepted a quote for the Hyatt in November: points are Committed.
  {
    const q = quoteOf('stay_hyatt', '2026-11-12', '2026-11-15');
    add({ id: uid('red'), memberId: 'mem_jeroen', stayId: 'stay_hyatt', kind: 'stay', checkIn: '2026-11-12', checkOut: '2026-11-15', nights: q.nights,
      guests: 2, seats: null, note: '', flexDays: 1, maxPoints: null, shared: false, pledges: [], indicativePoints: q.points, seasons: q.breakdown, retailUsd: q.retailUsd,
      points: q.points, quotedPoints: q.points, topUpUsd: 0, quoteStack: { room: 900, levy: 112.5, service: 112.5, resort: 60, env: 12 },
      hotelTerms: 'Free cancellation up to 7 days before arrival.', hotelDeadline: '2026-11-05',
      quotedBy: 'mem_victor', quotedAt: '2026-09-01T16:00:00Z', quoteExpiresAt: '2026-09-04T16:00:00Z',
      status: 'held', requestedAt: '2026-08-31T20:12:00Z', decidedBy: 'mem_victor', decidedAt: '2026-09-01T16:00:00Z',
      decision: 'Lagoon view, high floor.', heldAt: '2026-09-02T08:30:00Z', confirmedAt: null, completedAt: null, paidUsd: null, confirmationRef: '' });
  }
  // Kimberly has a live quote for Amsterdam Manor over New Year. It is more than she holds,
  // so she opened it to the Circle and two friends have already put points in.
  {
    const q = quoteOf('stay_amsterdam', '2026-11-20', '2026-11-23');
    const quoted = q.points;
    add({ id: uid('red'), memberId: 'mem_kimberly', stayId: 'stay_amsterdam', kind: 'stay', checkIn: '2026-11-20', checkOut: '2026-11-23', nights: q.nights,
      guests: 4, seats: null, note: 'Long weekend on Eagle Beach — anyone who wants to come, chip in.', flexDays: 0, maxPoints: null, indicativePoints: quoted, seasons: q.breakdown, retailUsd: q.retailUsd,
      points: 25000, quotedPoints: quoted, topUpUsd: 0, shared: true,
      pledges: [
        { id: uid('pld'), memberId: 'mem_diego', points: 24000, at: iso(new Date(now.getTime() - 12 * 36e5)) },
        { id: uid('pld'), memberId: 'mem_priya', points: 8000, at: iso(new Date(now.getTime() - 6 * 36e5)) },
      ],
      quoteStack: { room: 510, levy: 64, service: 51, resort: 27, env: 18 },
      hotelTerms: 'Free cancellation up to 14 days before arrival.', hotelDeadline: '2026-11-06',
      quotedBy: 'mem_victor', quotedAt: iso(new Date(now.getTime() - 17 * 36e5)), quoteExpiresAt: iso(new Date(now.getTime() + 55 * 36e5)),
      status: 'quoted', requestedAt: iso(new Date(now.getTime() - 40 * 36e5)), decidedBy: null, decidedAt: null,
      decision: 'Two rooms next to each other at the studio rate — put the rest of the Circle in the second one.', heldAt: null, confirmedAt: null, completedAt: null, paidUsd: null, confirmationRef: '' });
  }
  // Priya asked about Manchebo two days ago — Victor's 72-hour clock is running.
  {
    const q = quoteOf('stay_manchebo', '2026-11-06', '2026-11-09');
    add({ id: uid('red'), memberId: 'mem_priya', stayId: 'stay_manchebo', kind: 'stay', checkIn: '2026-11-06', checkOut: '2026-11-09', nights: q.nights,
      guests: 2, seats: null, note: 'Flexible either side by a day.', flexDays: 1, maxPoints: null, shared: false, pledges: [], indicativePoints: q.points, seasons: q.breakdown, retailUsd: q.retailUsd,
      points: q.points, quotedPoints: null, topUpUsd: 0, quoteStack: null, hotelTerms: '', hotelDeadline: null, quotedBy: null, quotedAt: null, quoteExpiresAt: null,
      status: 'requested', requestedAt: iso(new Date(now.getTime() - 50 * 36e5)), decidedBy: null, decidedAt: null, decision: '', heldAt: null, confirmedAt: null, completedAt: null, paidUsd: null, confirmationRef: '' });
  }
  // Sasha's Carnival-week request was declined, with the reason members read verbatim.
  {
    const q = quoteOf('stay_ritz', '2027-02-05', '2027-02-08');
    add({ id: uid('red'), memberId: 'mem_sasha', stayId: 'stay_ritz', kind: 'stay', checkIn: '2027-02-05', checkOut: '2027-02-08', nights: q.nights,
      guests: 2, seats: null, note: '', flexDays: 0, maxPoints: null, shared: false, pledges: [], indicativePoints: q.points, seasons: q.breakdown, retailUsd: q.retailUsd,
      points: q.points, quotedPoints: null, topUpUsd: 0, quoteStack: null, hotelTerms: '', hotelDeadline: null, quotedBy: null, quotedAt: null, quoteExpiresAt: null,
      status: 'declined', requestedAt: '2026-07-20T15:00:00Z', decidedBy: 'mem_victor', decidedAt: '2026-07-21T09:30:00Z',
      decision: 'Carnival week needs seven nights at the negotiated rate and the Ritz-Carlton has none left. 14–17 February is open at Winter points.',
      heldAt: null, confirmedAt: null, completedAt: null, paidUsd: null, confirmationRef: '' });
  }
  // Two seats held outright on the Samaná drop, and one that Ian opened to the Circle.
  for (const [i, memberId] of ['mem_victor', 'mem_sasha'].entries()) {
    const t = stayById.trip_samana; const q = quoteOf('trip_samana', t.dates.from, t.dates.to, 1);
    add({ id: uid('red'), memberId, stayId: 'trip_samana', kind: 'trip', checkIn: t.dates.from, checkOut: t.dates.to, nights: t.nights,
      guests: 1, seats: 1, note: '', flexDays: 0, maxPoints: null, shared: false, pledges: [], indicativePoints: q.points, seasons: q.breakdown, retailUsd: q.retailUsd,
      points: q.points, quotedPoints: q.points, topUpUsd: 0, quoteStack: null, hotelTerms: 'Seat released if the hold deadline passes.', hotelDeadline: t.holdDeadline,
      quotedBy: 'mem_ian', quotedAt: `2026-08-2${i}T12:00:00Z`, quoteExpiresAt: `2026-08-2${i + 3}T12:00:00Z`,
      status: 'held', requestedAt: `2026-08-2${i}T10:00:00Z`, decidedBy: 'mem_ian', decidedAt: `2026-08-2${i}T12:00:00Z`, decision: 'Seat held.',
      heldAt: `2026-08-2${i}T13:00:00Z`, confirmedAt: null, completedAt: null, paidUsd: null, confirmationRef: '' });
  }
  // Ian is 10,000 short of a seat and said so out loud. Vishnu and Ricardo have already put points in.
  {
    const t = stayById.trip_samana; const q = quoteOf('trip_samana', t.dates.from, t.dates.to, 1);
    add({ id: uid('red'), memberId: 'mem_ian', stayId: 'trip_samana', kind: 'trip', checkIn: t.dates.from, checkOut: t.dates.to, nights: t.nights,
      guests: 1, seats: 1, note: 'Ten thousand short. If two of you come in on this I will do all the driving.', flexDays: 0, maxPoints: null,
      indicativePoints: q.points, seasons: q.breakdown, retailUsd: q.retailUsd,
      points: 70000, quotedPoints: q.points, topUpUsd: 0, shared: true,
      pledges: [
        { id: uid('pld'), memberId: 'mem_vishnu', points: 30000, at: iso(new Date(now.getTime() - 30 * 36e5)) },
        { id: uid('pld'), memberId: 'mem_ricardo', points: 15000, at: iso(new Date(now.getTime() - 9 * 36e5)) },
      ],
      quoteStack: null, hotelTerms: 'Seat released if the hold deadline passes.', hotelDeadline: t.holdDeadline,
      quotedBy: 'mem_victor', quotedAt: iso(new Date(now.getTime() - 34 * 36e5)), quoteExpiresAt: iso(new Date(now.getTime() + 38 * 36e5)),
      status: 'quoted', requestedAt: iso(new Date(now.getTime() - 46 * 36e5)), decidedBy: null, decidedAt: null,
      decision: 'One of the fourteen seats, two nights at the Billini and five at Sublime. Whale boat is in.',
      heldAt: null, confirmedAt: null, completedAt: null, paidUsd: null, confirmationRef: '' });
  }

  // --- Notes from Ian -------------------------------------------------------
  const note = (title, body, at, pinned = false, authorId = 'mem_ian') => announcements.push({ id: uid('ann'), authorId, title, body, pinned, kind: 'note', at });
  note('August is closed and sealed', 'Bon dia, Circle. Vishnu closed August on the 31st and Victor co-signed it. Every confirmed transfer is matched, coverage is at 100.0%, and your statement is in Ledger → August. Masha danki to everyone who used their reference — matching took eleven minutes this month.', '2026-09-01T17:30:00Z', true);
  note('Samaná is open — fourteen seats', 'Bon dia, Circle. Seven nights in the Dominican Republic, 7–14 March: two inside the walls of the Zona Colonial, then up the Boulevard Turístico to Las Terrenas for five on Playa Cosón. 125,000 points a seat, everything on the ground included, whale boat in Samaná Bay included. Flights are yours — Arajet goes nonstop from Aruba in about an hour and a half, Wednesdays and Sundays, which is why it is Sunday to Sunday. Kibrahacha can hold now, Fofoti from tomorrow, everyone from Thursday. Fourteen seats and Victor holds the block until 15 December. Short? Ask anyway and open it to the Circle — Ian just did.', '2026-08-30T09:00:00Z');
  note('Dushi season: September to November', 'Bon dia, Circle. The island is quiet, the rates are the lowest of the year, and Aruba sits outside the hurricane belt — so low-season points carry almost no weather risk. Every Aruba stay is at Summer points until 19 December.', '2026-08-28T09:15:00Z');
  note('Setting a standing order (it is free)', 'Bon dia, Circle. Banco di Caribe and Aruba Bank both do standing orders online at no charge. Set the amount, set the 5th, and put your reference in the description once — it carries over every month. Then you never think about it again.', '2026-08-14T11:00:00Z');
  note('Japan is on the board for next December', 'Bon dia, Circle. Victor has been asked about it enough times, so: Kyoto and Tokyo, 2–12 December 2027, ten nights, eight seats. Read the trip page before you get excited — there is no same-day connection from Aruba to Japan and there never has been, so it is fourteen days door to door with two of them in a seat over Amsterdam. 210,000 points. At $200 a month that is about eleven months of contributions, so the people who want it should start now.', '2026-08-25T19:00:00Z');
  note('Contributions are due on the 5th', 'Bon dia, Circle. A reminder that contributions are due on the 5th. Transfer to the Reserve account, put your reference in the description, then tap “I sent it” so Vishnu can match it. If a month is tight, pause with one tap — your points stay yours and your streak freezes rather than resets.', '2026-08-02T08:30:00Z');

  // --- the August close -----------------------------------------------------
  const confirmedThroughAug = contributions.filter(c => c.status === 'confirmed' && c.forMonth <= '2026-08');
  const backingAug = confirmedThroughAug.reduce((s, c) => s + c.backingUsd, 0);
  const promoAug = ledger.filter(l => ['bonus', 'streak', 'founding'].includes(l.kind) && l.at <= '2026-09-01').reduce((s, l) => s + l.points, 0) / settings.pointsPerDollar;
  const burnedAug = -ledger.filter(l => l.kind === 'burn').reduce((s, l) => s + l.points, 0) / settings.pointsPerDollar;
  const reserveAug = Math.round((backingAug + promoAug - burnedAug) * 100) / 100;
  monthCloses.push({ id: uid('cls'), month: '2026-08', closedBy: 'mem_vishnu', cosignedBy: 'mem_ian', bankBalanceUsd: reserveAug,
    ledgerReserveUsd: reserveAug, varianceUsd: 0, coverage: 1, grossUsd: contributions.filter(c => c.forMonth === '2026-08' && c.status === 'confirmed').reduce((s, c) => s + c.receivedUsd, 0),
    shareUsd: contributions.filter(c => c.forMonth === '2026-08' && c.status === 'confirmed').reduce((s, c) => s + c.shareUsd, 0),
    confirmedCount: contributions.filter(c => c.forMonth === '2026-08' && c.status === 'confirmed').length, missingCount: 2,
    note: 'All August transfers matched.', closedAt: '2026-08-31T18:40:00Z' });
  // Vishnu checked the bank yesterday: the Reserve holds exactly what the ledger says it should.
  const backingAll = contributions.filter(c => c.status === 'confirmed').reduce((s2, c) => s2 + c.backingUsd, 0);
  const promoAll = ledger.filter(l => ['bonus', 'streak', 'founding'].includes(l.kind)).reduce((s2, l) => s2 + l.points, 0) / settings.pointsPerDollar;
  const burnedAll = -ledger.filter(l => l.kind === 'burn').reduce((s2, l) => s2 + l.points, 0) / settings.pointsPerDollar;
  settings.reserveVerified = { balanceUsd: Math.round((backingAll + promoAll - burnedAll) * 100) / 100, at: '2026-09-04T18:00:00Z', byId: 'mem_vishnu' };

  return { version: 2, seededAt: iso(now), settings, members, contributions, ledger, stays, redemptions, announcements, audit, invitations: [], monthCloses, promoDeferrals, rulesAcceptances, session: null };
}
