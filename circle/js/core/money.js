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
  // The ladder has to be worth climbing. It used to give $200 the SAME number of open
  // requests as $150 and exactly one more month of booking window — so the top level cost 33%
  // more for almost nothing, which is not a ladder, it is a rounding error.
  //
  // Every one of these is enforced somewhere in the app, not printed and forgotten: holds caps
  // what you can have in front of the Desk, windowMonths caps how far ahead you can ask,
  // guestCerts is counted, firstLookHours gates the board, bonusRate mints points, and
  // slaHours is the promise the Desk is held to.
  //
  // The bonus rates are affordable rather than generous-sounding: the Circle earns 15% when
  // points are spent on a room, so a 6% bonus on a $200 contribution costs $12 against $30
  // earned if that member spends it. promoCapRate still guards the month.
  tiers: [
    { id: 't100', monthlyUsd: 100, bonusRate: 0.00, holds: 1, guestCerts: 2, windowMonths: 9,  firstLookHours: 0,   slaHours: 72 },
    { id: 't150', monthlyUsd: 150, bonusRate: 0.03, holds: 3, guestCerts: 4, windowMonths: 15, firstLookHours: 48,  slaHours: 48 },
    { id: 't200', monthlyUsd: 200, bonusRate: 0.06, holds: 5, guestCerts: 8, windowMonths: 24, firstLookHours: 168, slaHours: 24 },
  ],
  streakBonuses: { 6: 1000, 12: 2500, 24: 5000 },
  foundingBonus: 2000,
  foundingSeats: 20,
  promoCapRate: 0.40,         // promotional points in a month ≤ 40% of that month's share × 100
  bonusExpireMonths: 24,      // promotional points expire; base points never do while active
  quoteHours: 72,             // a quote is locked for 72 hours
  // How long a look is worth something, by how it was made. Stored on each look at the moment
  // it is written, never recomputed, so changing this cannot revive an old look.
  lookHours: { site: 72, phone: 48 },
  minQuoteHours: 12,          // a stale look shortens the quote, but never below this
  looksFrom: null,            // requests older than this predate the gate and are exempt
  slaHours: 72,               // planner answers a request within 72 hours
  bankerSlaHours: 48,         // Banker confirms within 48 hours of money arriving
  undoSeconds: 60,            // a confirmation can be reversed by the same officer for 60 s
  closeToleranceUsd: 5,
  exitFeeUsd: 25,
  memberCap: 40,
  dueDay: 5,
  // The pictures are built and the tables are live, but off until Victor turns them on in
  // Settings. Off is the default in both backends so the two never disagree about it.
  momentsOn: false,
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

/**
 * A cruise is a trip with a ship: fixed dates, a fixed price for a cabin, so many cabins. It is
 * stored as kind 'trip' with a `cruise` record (line, ship, embark, ports, cabin), so every rule
 * that prices, holds and books a seat on a trip prices, holds and books a cabin unchanged.
 */
export const isCruise = (stay) => stay?.kind === 'trip' && !!stay?.cruise;
/** The word for what a member asks for here: a night, a seat, or a cabin. */
export const unitWord = (stay) => (stay?.kind === 'trip' ? (isCruise(stay) ? 'cabin' : 'seat') : 'night');

/** Points a level earns in a month, tier bonus included. */
export function pointsPerMonth(settings, monthlyUsd) {
  const t = tierFor(settings, monthlyUsd);
  // Face value. Nothing is taken on the way in any more — the Circle's share is charged when
  // points are spent on a room, so a dollar contributed is a dollar's worth of points held.
  return Math.round(monthlyUsd * settings.pointsPerDollar)
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

/**
 * What money received turns into. Bonus only on a full tier month.
 *
 * `shareUsd` is zero and stays in the shape on purpose: the Circle takes nothing when points
 * are bought, only when they are spent (see quoteStay). Screens that used to draw a split bar
 * here should say that every dollar backs a point, because now it does.
 */
export function splitContribution(receivedUsd, settings = DEFAULT_SETTINGS, tier = null) {
  const amt = round2(Number(receivedUsd) || 0);
  const shareUsd = 0;
  const backingUsd = amt;
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
// What a night costs, by the date.
//
// There used to be a "season" system here — Summer, Winter, Peak, Carnival — with a picker on
// the goal sheet, a toggle on the room table, four photographs on the landing page and a
// two-column table of bands. Victor: "I am not sure what season have to do with our system
// winter, summer etc. no need for that." He is right about all of it, and none of it was ever
// the member's problem: you do not want to learn a vocabulary, you want to know what YOUR
// nights cost.
//
// So the words are gone and the arithmetic stayed. It had to. Measured against the live
// catalog, a night at Marriott's Aruba Surf Club is $135 in September and $580 at Christmas —
// 4.3x — and across all 23 Aruba stays the dear half of the year averages 1.53x and the
// fortnight around Christmas 1.96x. One flat number would be either a summer rate that gives
// away half of every winter booking, or a blend that overcharges everyone in September. The
// hotels price by date; so do we. We simply never make anybody read a season name to find out.
//
// Nothing below is exported under a season name, and no screen prints one. `RATE_BANDS` is
// internal: three stored rates keyed by when they apply, and `rateBandFor(date)` says which.
// ---------------------------------------------------------------------
const RATE_BANDS = Object.freeze({
  low: { id: 'low', from: 'Apr 6', to: 'Dec 19' },
  high: { id: 'high', from: 'Jan 4', to: 'Apr 5' },
  peak: { id: 'peak', from: 'Dec 20', to: 'Jan 3' },
});
/** For the Desk's rate editor, which is the only screen that sets three numbers. */
export const RATE_BAND_LIST = Object.freeze(Object.values(RATE_BANDS).map(b => Object.freeze({ ...b })));
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
/**
 * Which of a stay's three stored rates applies on a given night. Internal — the id it returns
 * is a column name, not a word anybody reads. Mirrored by season_for() in schema.sql, which
 * keeps its old name because SQL is not a screen; the two must agree to the day or the
 * two backends quote different prices for the same week.
 */
export function rateBandFor(dateLike) {
  const d = new Date(dateLike); const md = (d.getMonth() + 1) * 100 + d.getDate();
  if (md >= 1220 || md <= 103) return 'peak';
  const cw = carnivalWeek(d.getFullYear());
  if (d >= cw.start && d < cw.end) return 'peak';
  if (md >= 104 && md <= 405) return 'high';
  return 'low';
}

/**
 * What one night costs, all in — the room and the Circle's share together, because that is the
 * number that comes off a member's balance. This is the same arithmetic quote_points() does in
 * the database, a night at a time, so nightly × nights is exactly the quote and a member can
 * check it by multiplying.
 */
const allIn = (usd, settings) => Math.round((Number(usd) || 0) * settings.pointsPerDollar * (1 + settings.serviceRate));
/**
 * Out of an all-in quote, what the HOTEL is owed — the figure that actually leaves the Reserve.
 *
 * quotedPoints includes the Circle's 15%, so paying the whole of it to the hotel books the
 * club's own income as money handed over: serviceEarned reads ~$0 for ever and the Reserve
 * looks 15% emptier than it is, on every booking. Prefer the quote's own stack, which carries
 * the hotel lines the Desk typed; fall back to taking the share back out arithmetically.
 */
export function hotelOwedUsd(r, settings = DEFAULT_SETTINGS) {
  const stack = r?.quoteStack || r?.quote_stack;
  if (stack && typeof stack === 'object') {
    const hotel = Object.entries(stack)
      .filter(([k]) => k !== 'share')
      .reduce((sum, [, v]) => sum + (Number(v) || 0), 0);
    if (hotel > 0) return round2(hotel);
  }
  const pts = Number(r?.quotedPoints ?? r?.quoted_points) || 0;
  return round2(pts / (1 + settings.serviceRate) / settings.pointsPerDollar);
}

/** The room on its own, without the Circle's share. For showing the split, never for charging. */
export const roomOnlyPoints = (usd, settings = DEFAULT_SETTINGS) => Math.round((Number(usd) || 0) * settings.pointsPerDollar);

/**
 * What one night costs on a given date, all in. This is the function nearly every screen wants.
 *
 * It replaces seasonPoints(stay, season, settings), and it is a RENAME rather than a changed
 * signature on purpose. The old one read `stay.rates?.[season] ?? 0`, so a caller that lost its
 * middle argument in the refactor would have looked up `stay.rates[settingsObject]`, found
 * nothing, and charged the member ZERO — a free room, rendered without an error, in a screen
 * that looks entirely normal. A new name turns every one of those into an import error at load
 * instead, which is a bad afternoon rather than a bad month.
 */
export function nightPoints(stay, dateLike, settings = DEFAULT_SETTINGS) {
  return allIn(stay?.rates?.[rateBandFor(dateLike)] ?? 0, settings);
}

/**
 * The cheapest a place ever is, for the screens that have no dates yet — a card in the list, a
 * filter, a goal. Always shown as "from", because that is what it is, and because quoting the
 * dearest or an average would make every card a small lie in one direction or the other.
 */
export function fromPoints(stay, settings = DEFAULT_SETTINGS) {
  const r = stay?.rates || {};
  const known = [r.low, r.high, r.peak].map(Number).filter(n => Number.isFinite(n) && n > 0);
  return known.length ? allIn(Math.min(...known), settings) : 0;
}

/**
 * What a seat on a trip actually costs a member — `nightPoints`' opposite number for trips.
 *
 * `pointsPerSeat` is stored the same way `rates` is: the room, before the Circle's share. Only
 * quoteStay applied the 15%, so every screen that printed `pointsPerSeat` was quoting a member
 * a price 15% below the one they would be charged, and the trip page printed it under the words
 * "all-in". The savings line then subtracted that same understated figure from the public price
 * and overstated the saving by the whole of the share. One helper, used everywhere a member
 * sees a seat, so the card, the page, the goal and the quote cannot disagree again.
 */
export function seatPoints(stay, settings = DEFAULT_SETTINGS) {
  return Math.round((stay?.pointsPerSeat || 0) * (1 + settings.serviceRate));
}

/**
 * The "from" price of anything on the board: the cheapest night of the year, or a seat.
 * A trip has one price and always did, so this is where the two shapes finally meet.
 */
export function unitPoints(stay, settings = DEFAULT_SETTINGS) {
  return stay?.kind === 'trip' ? seatPoints(stay, settings) : fromPoints(stay, settings);
}

/**
 * Us against the published rate, told straight — including when we lose.
 *
 * The old line was `Math.max(0, retail − ourRate)`, which cannot print anything but a win: at
 * the Ritz our all-in Winter night is $1,357 against a published $1,341, and the page said
 * "you save $0.00" rather than "booking direct is cheaper this week". A number that can only
 * ever flatter us is not a price comparison, it is an advertisement, and the whole point of
 * showing what Interval and RedWeek are asking is that a member can check us.
 *
 * `same` is a 50-cent band, because two all-in rates that land within a coin of each other are
 * the same rate and calling either one a saving is noise.
 */
export function versusPublic(publicUsd, ourUsd) {
  const pub = round2(publicUsd), ours = round2(ourUsd);
  if (!pub || !ours) return null;
  const diff = round2(pub - ours);
  return {
    publicUsd: pub, ourUsd: ours, diffUsd: Math.abs(diff),
    pct: Math.round((Math.abs(diff) / pub) * 100),
    same: Math.abs(diff) <= 0.5,
    better: diff > 0.5,
  };
}

/**
 * Quote for a stay over a date range, or a trip for N seats.
 * Indicative: Victor's binding quote may differ and is what the member accepts.
 */
export function quoteStay(stay, checkIn, checkOut, settings = DEFAULT_SETTINGS, { seats = 1 } = {}) {
  const seatsN = Math.max(1, seats);
  if (stay.kind === 'trip') {
    const nights = stay.nights || Math.max(1, Math.round((new Date(stay.dates.to) - new Date(stay.dates.from)) / 86400000));
    const basePoints = (stay.pointsPerSeat || 0) * seatsN;
    const points = seatPoints(stay, settings) * seatsN;
    const usd = points / settings.pointsPerDollar;
    const retail = (stay.retailUsd || 0) * seatsN;
    return { nights, points, basePoints, servicePoints: points - basePoints, usd: round2(usd),
      breakdown: { low: 0, high: 0, peak: 0 }, minNights: nights, ok: true, retailUsd: retail,
      savingsPct: retail ? Math.round((1 - usd / retail) * 100) : 0, seats: seatsN };
  }
  const start = new Date(checkIn), end = new Date(checkOut);
  const nights = Math.max(0, Math.round((end - start) / 86400000));
  const breakdown = { low: 0, high: 0, peak: 0 };
  // Night by night, exactly as quote_points() does it in the database. `points` is what comes
  // off the balance; `basePoints` is the room alone, so a screen can show what the Circle took.
  let points = 0, basePoints = 0, usd = 0, retail = 0;
  // The public rate has to move with the calendar the same way ours does, or the comparison is
  // theatre. `retailUsd` is a DEAR-season figure — stays.js calls it "a typical public all-in
  // winter rate" — so holding it flat across a September week compared a cheap week of ours
  // against a Christmas week of theirs and printed "82% off" on a real screen. Scaling it by
  // the same band ratio our own rates carry makes it like-for-like using data already on the
  // row; the Surf Club goes from a fictional 82% to a defensible 58%.
  const anchor = Number(stay.rates?.high) || 0;
  for (let i = 0; i < nights; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const s = rateBandFor(d); breakdown[s]++;
    const rate = stay.rates?.[s] ?? stay.rates?.high ?? 0;
    usd += rate;
    basePoints += roomOnlyPoints(rate, settings);
    points += allIn(rate, settings);
    retail += anchor > 0 ? (stay.retailUsd || 0) * (rate / anchor) : (stay.retailUsd || 0);
  }
  retail = round2(retail);
  // The longer minimum still applies over Christmas and Carnival — that is the hotels' rule,
  // not ours, and 21 of the 26 catalog rows carry one. It is no longer called a Peak minimum
  // anywhere a member reads: quoteStay just returns the minimum for THESE dates, and the screen
  // says "7 nights minimum for those dates". Losing this when the seasons went would have
  // silently flipped q.ok from false to true on every Christmas week in the catalog.
  const minNights = breakdown.peak > 0 ? Math.max(stay.minNights || 1, stay.peakMinNights || stay.minNights || 1) : (stay.minNights || 1);
  return { nights, points, basePoints, servicePoints: points - basePoints, usd: round2(usd), breakdown, minNights,
    ok: nights >= minNights && nights > 0, retailUsd: retail,
    savingsPct: retail ? Math.round((1 - usd / retail) * 100) : 0 };
}


