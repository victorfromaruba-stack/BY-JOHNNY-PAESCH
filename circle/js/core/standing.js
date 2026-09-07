/**
 * Standing — what you get for staying.
 *
 * The levels ($100 / $150 / $200) are speed: they set how fast points build. Standing is time,
 * and the two are deliberately kept apart, because a ladder you can buy on the first of the
 * month is not a ladder. A $100 Pillar outranks a $200 Seated. That is the whole point of it.
 *
 * The ladder here is the same one rank_ladder() returns in SQL, and the rules for reaching a
 * rung are the same rules standing_of() applies. Two copies exist because the app runs against
 * two backends; standingCheck in the test suite compares them rung for rung so they cannot
 * drift apart quietly.
 */

export const RANKS = Object.freeze([
  { i: 0, name: 'Seated',    months: 0,  blurb: 'Forty seats, and one of them has your name on it.',
    unlocks: 'Everything is open from the first day. Standing changes what you are offered first, never what you are allowed.' },
  { i: 1, name: 'Steady',    months: 3,  blurb: 'Three months in, nothing outstanding.',
    unlocks: 'Your standing is printed under your name on the card and beside you wherever the Circle lists people.' },
  { i: 2, name: 'Anchor',    months: 9,  blurb: 'Nine months. The Circle can count on your line in the book.',
    unlocks: 'One more open request than your level allows — two things in front of the Desk at once instead of one.' },
  { i: 3, name: 'Old Guard', months: 18, blurb: 'A year and a half. You were here before most of them.',
    unlocks: 'Twelve hours of first look on anything new, on top of whatever your level already gives you.' },
  { i: 4, name: 'Pillar',    months: 36, blurb: 'Three years. Forty people hold this up, and you are one.',
    unlocks: 'A guest pass a year beyond your level, and you may put a name forward when a seat comes free.' },
]);

/**
 * What standing actually adds to your level, as numbers rather than as a sentence.
 *
 * The three unlocks above were printed on every member's home screen and enforced nowhere: the
 * hold cap read tier.holds alone, the first-look gate read tier.firstLookHours alone, and
 * guestCerts was only ever displayed, never counted. Anchor has been promising "two things in
 * front of the Desk at once instead of one" to anybody nine months in, and the Desk has been
 * refusing the second one.
 *
 * Keeping it here, beside the strings that promise it, is the point — the next person to edit
 * an `unlocks` line can see there is a number under it that has to move too. Mirrored by
 * rank_perks() in SQL for the same reason the ladder is.
 */
export function rankPerks(rankIndex = 0) {
  const i = Math.max(0, Math.min(RANKS.length - 1, Number(rankIndex) || 0));
  return {
    extraHolds:          i >= 2 ? 1 : 0,    // Anchor
    extraFirstLookHours: i >= 3 ? 12 : 0,   // Old Guard
    extraGuestCerts:     i >= 4 ? 1 : 0,    // Pillar
  };
}

/** A member's real allowance: what they pay for, plus what they have earned by staying. */
export function effectiveTier(tier, standing) {
  const p = rankPerks(standing?.rankIndex ?? 0);
  return {
    ...tier,
    holds: (tier?.holds || 1) + p.extraHolds,
    firstLookHours: (tier?.firstLookHours || 0) + p.extraFirstLookHours,
    guestCerts: (tier?.guestCerts || 0) + p.extraGuestCerts,
    fromStanding: p,
  };
}

/**
 * Badges are the other half: things done, not time served. Every one of them is a fact the
 * club already records, so none of them is anybody's to award or withhold.
 */
export const BADGES = Object.freeze({
  founding:        { name: 'Founding Insider', earned: 'One of the first twenty seats.' },
  autopilot:       { name: 'On Autopilot',     earned: 'A standing order, running six months or more.' },
  twelve:          { name: 'Twelve Straight',  earned: 'Twelve consecutive contributions.' },
  twentyfour:      { name: 'Twenty-four Straight', earned: 'Twenty-four consecutive contributions.' },
  earlybird:       { name: 'Before the Fifth', earned: 'Six contributions sent before they were due.' },
  morethanasked:   { name: 'More Than Asked',  earned: 'Three contributions beyond the monthly amount.' },
  chippedin:       { name: 'Chipped In',       earned: 'Points put into three different Insiders’ bookings.' },
  together:        { name: 'Booked It Together', earned: 'A booking of yours that two or more people chipped into.' },
  sponsor:         { name: 'Sponsor',          earned: 'You put a name forward and they are still here.' },
  foundit:         { name: 'Found It First',   earned: 'A deal you posted that the Circle went on to book.' },
  fiveplaces:      { name: 'Five Places',      earned: 'Stays completed at five different places.' },
  longhaul:        { name: 'Long Haul',        earned: 'You left the island with the Circle.' },
  secondsignature: { name: 'Second Signature', earned: 'Six months co-signed shut.' },
});

/** Whole months between two dates — the same arithmetic age() does in Postgres. */
export function monthsBetween(fromIso, to = new Date()) {
  const a = new Date(fromIso);
  if (Number.isNaN(a.getTime())) return 0;
  let n = (to.getFullYear() - a.getFullYear()) * 12 + (to.getMonth() - a.getMonth());
  if (to.getDate() < a.getDate()) n -= 1;
  return Math.max(0, n);
}

/** The rung those months and that record reach. Mirrors standing_of() exactly. */
export function rankFor(monthsHeld, owing = 0) {
  let best = RANKS[0];
  for (const r of RANKS) if (r.months <= monthsHeld && (r.i === 0 || owing === 0)) best = r;
  return best;
}

/** What is left to climb, for the line under a profile. Null once there is nothing above. */
export function nextRank(monthsHeld) {
  return RANKS.find(r => r.months > monthsHeld) || null;
}

/**
 * Standing worked out from what this browser holds. The Supabase adapter reads standing_v
 * instead — it can see everyone's, because the database answers with the rank and nothing
 * else. This one is for the preview backend, where every row is already local.
 */
export function standingFrom({ member, contributions = [], ledger = [], redemptions = [], pledges = [],
                               deals = [], invitations = [], monthCloses = [], members = [], settings = {} }) {
  if (!member) return null;
  const mine = (rows) => rows.filter(r => r.memberId === member.id);
  const held = monthsBetween(member.joinedAt);
  const paid = mine(contributions).filter(c => c.status === 'confirmed' && !c.extra).length;
  const owing = Math.max(0, held - paid - (member.pausedMonths?.length || 0));
  const rank = rankFor(held, owing);

  const has = [];
  const add = (k, cond) => { if (cond) has.push(k); };
  const confirmed = mine(contributions).filter(c => c.status === 'confirmed');
  const dueDay = settings.dueDay || 5;
  add('founding', member.founding);
  add('autopilot', member.standingOrder && paid >= 6);
  add('twelve', mine(ledger).some(l => l.kind === 'streak' && l.note === '12 consecutive contributions'));
  add('twentyfour', mine(ledger).some(l => l.kind === 'streak' && l.note === '24 consecutive contributions'));
  add('earlybird', confirmed.filter(c => c.sentOn && new Date(c.sentOn).getDate() <= dueDay).length >= 6);
  add('morethanasked', confirmed.filter(c => c.extra).length >= 3);
  const settled = (id) => redemptions.find(r => r.id === id && r.confirmedAt);
  const helped = new Set(pledges.filter(p => p.memberId === member.id)
    .map(p => settled(p.redemptionId)).filter(r => r && r.memberId !== member.id).map(r => r.memberId));
  add('chippedin', helped.size >= 3);
  add('together', mine(redemptions).some(r => r.shared && r.confirmedAt
    && pledges.filter(p => p.redemptionId === r.id && p.memberId !== member.id).length >= 2));
  add('sponsor', invitations.some(i => i.sponsorId === member.id
    && members.find(m => m.id === i.acceptedMemberId)?.status === 'active'));
  add('foundit', deals.some(d => d.postedBy === member.id && d.status === 'booked'));
  add('fiveplaces', new Set(mine(redemptions).filter(r => r.status === 'completed').map(r => r.stayId)).size >= 5);
  add('longhaul', mine(redemptions).some(r => r.status === 'completed' && r.kind === 'trip'));
  add('secondsignature', monthCloses.filter(c => c.cosignedBy === member.id).length >= 6);

  return { memberId: member.id, monthsHeld: held, monthsPaid: paid, owing,
           rankIndex: rank.i, rankName: rank.name, badges: has };
}
