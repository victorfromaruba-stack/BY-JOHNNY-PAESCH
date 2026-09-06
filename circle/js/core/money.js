// Money → points. Every function is pure and driven by `settings` so the
// club's rules live in one place (editable from Settings, mirrored in SQL).
//
//   contribution $C  →  Circle's share   C × serviceRate            (→ Operating)
//                    →  backing          C − share                   (→ Reserve, backs points)
//   points           =  backing × 100    (100 points = $1.00, fixed forever)
//   tier bonus       =  % of GROSS, funded by the Circle out of its own share,
//                       only when the full tier amount arrived.

export const DEFAULT_SETTINGS = Object.freeze({
  serviceRate: 0.15,
  pointsPerDollar: 100,
  awgPerUsd: 1.79,
  // Every Insider can ask for every stay and every trip. What a level changes is how
  // fast the points build, and the perks — how far ahead you can book, how many open
  // requests you can hold, guest passes, and first look at a new trip.
  tiers: [
    { id: 't100', monthlyUsd: 100, bonusRate: 0.00, holds: 1, guestCerts: 2, windowMonths: 10, firstLookHours: 0 },
    { id: 't150', monthlyUsd: 150, bonusRate: 0.02, holds: 2, guestCerts: 3, windowMonths: 12, firstLookHours: 48 },
    { id: 't200', monthlyUsd: 200, bonusRate: 0.04, holds: 2, guestCerts: 4, windowMonths: 13, firstLookHours: 72 },
  ],
  streakBonuses: { 6: 1000, 12: 2500, 24: 5000 },
  foundingBonus: 2000,
  foundingSeats: 20,
  promoCapRate: 0.40,         // promotional points in a month ≤ 40% of that month's share × 100
  bonusExpireMonths: 24,      // promotional points expire; base points never do while active
  quoteHours: 72,             // a quote is locked for 72 hours
  slaHours: 72,               // planner answers a request within 72 hours
  bankerSlaHours: 48,         // Banker confirms within 48 hours of money arriving
  undoSeconds: 60,            // a confirmation can be reversed by the same officer for 60 s
  closeToleranceUsd: 5,
  exitFeeUsd: 25,
  memberCap: 40,
  dueDay: 5,
  reserveAccount: { bank: '', holder: '', number: '' },
  operatingAccount: { bank: '', holder: '', number: '' },
  reserveVerified: null,      // { balanceUsd, at, byId } entered by the Banker at Month Close
  whatsappGroupUrl: '',
  wallet: { url: '', token: '' },   // the Edge Function that signs Apple Wallet passes
  rulesVersion: '1.0',
  rulesDate: '2026-09-05',
});

export function tierFor(settings, monthlyUsd) {
  return settings.tiers.find(t => t.monthlyUsd === Number(monthlyUsd)) || settings.tiers[0];
}

// How far a trip goes. This is a label on the trip, not a rule about who may come —
// anyone in the Circle can ask for anything. It is here so the board can be filtered
// and so a member can see at a glance what they are looking at.
export const REACH = Object.freeze({
  aruba: { id: 'aruba', label: 'On the island', blurb: 'A stay here on Aruba' },
  region: { id: 'region', label: 'The region', blurb: 'The other islands and the near mainland' },
  world: { id: 'world', label: 'Long haul', blurb: 'Further afield, wherever the group goes' },
});
export const reachOf = (stay) => (stay?.kind === 'trip' ? (stay.reach || 'region') : 'aruba');

/** Points a level earns in a month, tier bonus included. */
export function pointsPerMonth(settings, monthlyUsd) {
  const t = tierFor(settings, monthlyUsd);
  return Math.round(monthlyUsd * (1 - settings.serviceRate) * settings.pointsPerDollar)
       + Math.round(monthlyUsd * t.bonusRate * settings.pointsPerDollar);
}
/**
 * How long something takes to save for at each level — the honest version of a tier
 * difference. Nobody is turned away; the bigger levels simply get there sooner.
 */
export function monthsToAfford(settings, points, monthlyUsd, alreadyHave = 0) {
  const short = Math.max(0, points - alreadyHave);
  if (!short) return 0;
  return Math.ceil(short / pointsPerMonth(settings, monthlyUsd));
}

/** Split money actually received into share, backing and points. Bonus only on a full tier month. */
export function splitContribution(receivedUsd, settings = DEFAULT_SETTINGS, tier = null) {
  const amt = round2(Number(receivedUsd) || 0);
  const shareUsd = round2(amt * settings.serviceRate);
  const backingUsd = round2(amt - shareUsd);
  const basePoints = Math.round(backingUsd * settings.pointsPerDollar);
  const full = tier ? amt + 0.005 >= tier.monthlyUsd : true;
  const bonusRate = full ? (tier?.bonusRate || 0) : 0;
  const bonusPoints = tier && full ? Math.round(tier.monthlyUsd * bonusRate * settings.pointsPerDollar) : 0;
  const bonusCostUsd = round2(bonusPoints / settings.pointsPerDollar);
  return { amountUsd: amt, shareUsd, backingUsd, basePoints, bonusPoints, points: basePoints + bonusPoints, bonusCostUsd, netToCircleUsd: round2(shareUsd - bonusCostUsd), full };
}

/** Project a member's points over n months at a tier (streaks included, founding excluded). */
export function projectPoints(monthlyUsd, months, settings = DEFAULT_SETTINGS) {
  const tier = tierFor(settings, monthlyUsd);
  const one = splitContribution(monthlyUsd, settings, tier);
  let streak = 0;
  for (const [n, pts] of Object.entries(settings.streakBonuses)) if (months >= Number(n)) streak += pts;
  const points = one.points * months + streak;
  return { months, paidUsd: round2(one.amountUsd * months), shareUsd: round2(one.shareUsd * months), backingUsd: round2(one.backingUsd * months), streakPoints: streak, points, perMonth: one, effectiveBacking: points / settings.pointsPerDollar / (one.amountUsd * months) };
}

export const pointsToUsd = (points, settings = DEFAULT_SETTINGS) => round2((Number(points) || 0) / settings.pointsPerDollar);
export const usdToPoints = (usd, settings = DEFAULT_SETTINGS) => Math.round((Number(usd) || 0) * settings.pointsPerDollar);
export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// ---------------------------------------------------------------------
// Seasons. Aruba's hotel year splits at Dec 20 / Apr 5. Peak = Christmas–New
// Year and Carnival week (from Easter); both carry 7-night minimums.
// Three published levels, never dynamic.
// ---------------------------------------------------------------------
export const SEASONS = Object.freeze({
  low: { id: 'low', label: 'Summer', range: 'Apr 6 – Dec 19' },
  high: { id: 'high', label: 'Winter', range: 'Jan 4 – Apr 5' },
  peak: { id: 'peak', label: 'Peak', range: 'Dec 20 – Jan 3 · Carnival week' },
});
export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
export function ashWednesday(year) { const d = easterSunday(year); d.setDate(d.getDate() - 46); return d; }
/** Carnival week: from the Sunday before the Grand Parade through Ash Wednesday. */
export function carnivalWeek(year) {
  const ash = ashWednesday(year); const parade = new Date(ash); parade.setDate(ash.getDate() - 3);
  const start = new Date(parade); start.setDate(parade.getDate() - 7);
  const end = new Date(ash); end.setDate(ash.getDate() + 1);
  return { start, end, parade, ash };
}
export function seasonFor(dateLike) {
  const d = new Date(dateLike); const md = (d.getMonth() + 1) * 100 + d.getDate();
  if (md >= 1220 || md <= 103) return 'peak';
  const cw = carnivalWeek(d.getFullYear());
  if (d >= cw.start && d < cw.end) return 'peak';
  if (md >= 104 && md <= 405) return 'high';
  return 'low';
}
export const isDushiSeason = (dateLike) => { const m = new Date(dateLike).getMonth() + 1; return m >= 9 && m <= 11; };

export function nightlyPoints(stay, dateLike, settings = DEFAULT_SETTINGS) {
  const s = seasonFor(dateLike);
  const usd = stay.rates?.[s] ?? stay.rates?.high ?? stay.rates?.low ?? 0;
  return Math.round(usd * settings.pointsPerDollar);
}
export function seasonPoints(stay, season, settings = DEFAULT_SETTINGS) {
  return Math.round((stay.rates?.[season] ?? 0) * settings.pointsPerDollar);
}

/**
 * Quote for a stay over a date range, or a trip for N seats.
 * Indicative: Victor's binding quote may differ and is what the member accepts.
 */
export function quoteStay(stay, checkIn, checkOut, settings = DEFAULT_SETTINGS, { seats = 1 } = {}) {
  if (stay.kind === 'trip') {
    const nights = stay.nights || Math.max(1, Math.round((new Date(stay.dates.to) - new Date(stay.dates.from)) / 86400000));
    const points = (stay.pointsPerSeat || 0) * Math.max(1, seats);
    const usd = points / settings.pointsPerDollar;
    const retail = (stay.retailUsd || 0) * Math.max(1, seats);
    return { nights, points, usd: round2(usd), breakdown: { low: 0, high: 0, peak: 0 }, minNights: nights, ok: true, retailUsd: retail, savingsPct: retail ? Math.round((1 - usd / retail) * 100) : 0, seats };
  }
  const start = new Date(checkIn), end = new Date(checkOut);
  const nights = Math.max(0, Math.round((end - start) / 86400000));
  const breakdown = { low: 0, high: 0, peak: 0 };
  let points = 0, usd = 0;
  for (let i = 0; i < nights; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const s = seasonFor(d); breakdown[s]++;
    const rate = stay.rates?.[s] ?? stay.rates?.high ?? 0;
    usd += rate; points += Math.round(rate * settings.pointsPerDollar);
  }
  const minNights = breakdown.peak > 0 ? Math.max(stay.minNights || 1, stay.peakMinNights || stay.minNights || 1) : (stay.minNights || 1);
  const retail = nights * (stay.retailUsd || 0);
  return { nights, points, usd: round2(usd), breakdown, minNights, ok: nights >= minNights && nights > 0, retailUsd: retail, savingsPct: retail ? Math.round((1 - usd / retail) * 100) : 0 };
}

/** "You are 1.4 nights from Bucuti in Summer" */
export function nightsAway(points, stay, season = 'low', settings = DEFAULT_SETTINGS) {
  const per = stay.kind === 'trip' ? stay.pointsPerSeat : seasonPoints(stay, season, settings);
  if (!per) return null;
  const nights = points / per;
  const need = Math.max(0, (stay.minNights || 1) * per - points);
  return { nightsCoverable: Math.floor(nights * 10) / 10, perNight: per, need, months: null };
}
