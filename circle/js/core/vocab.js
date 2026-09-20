// Every word the app prints lives here — but not quite every one. See the note below the name.
//
// Name note for Victor: the design panel's first pick, "Conchi" (the Natural Pool), reads as
// vulgar slang across much of Spanish-speaking Latin America, so it was never printed anywhere.
// The club then ran as "Hunto" — Aruban Papiamento for "together" — until 2026-09-20, when
// Victor renamed it The Inner Hotel Circle. Alternatives the panel liked: "Sotavento" (the
// leeward side), "The Pool". The new name has no folk etymology and the app claims none.
//
// What `clubName` actually carries: the render sites in circle/js, and nothing else. It does NOT carry
// to index.html, manifest.webmanifest, the Wallet Edge Function (which reads `club_name` from
// the database), tools/grab.js, tools/check-interval.ics, the Gmail forwarder labels, schema.sql
// or the READMEs. Those hold their own literals; a rename means editing them too.
//
// `refPrefix` stays HUNTO on purpose. It is the reference a member types into a bank transfer
// and the Banker matches against the statement, so it is carried by transfers already sent and
// by contributions already in the database. schema.sql builds the same string a second time.
// Changing it is an operational decision for Victor, not part of a rename.
export const VOCAB = {
  clubName: 'The Inner Hotel Circle',
  // The short form the bar, the card face, the Wallet pass and the card PNG all print. It is NOT
  // clubName: the full name does not fit the running head.
  //
  // Measured in the bar at 390px against the worst case the app can produce — the longest first
  // name in the club beside a two-digit urgent badge:
  //     THE CIRCLE              146px, 78px of clearance
  //     THE INNER CIRCLE        213px, 12px of clearance   ← this
  //     THE INNER HOTEL CIRCLE  235px, and it is being clipped to get there
  // Victor asked for the Inner Circle, and it fits with room to spare on every real name in the
  // club: Ana-Lucía is the longest in the preview seed and nobody live is over seven letters.
  // Do not lengthen it without re-measuring — the next word spends the last twelve pixels.
  wordmark: 'THE INNER CIRCLE',
  // Downloads and the .pkpass filename. A slug, because `clubName.toLowerCase()` would put
  // spaces in every filename — and in a Content-Disposition header, where clients cut at one.
  slug: 'the-inner-circle',
  // The name now says "Inner Circle" itself, so the old subtitle only repeated it. This states
  // what the club is and where, both of which the club has established.
  subtitle: 'Private travel club · Aruba',
  // `meaning` is gone. It read 'Papiamento for “together”', which described the word HUNTO and
  // is simply false of this name. Nothing read the field, and there is no etymology to put in
  // its place — inventing one would be the app asserting something it has not established.
  tagline: 'Every point has a dollar behind it.',
  refPrefix: 'HUNTO',            // UNCHANGED on purpose — see the note at the top of this file
  circle: 'the Circle',
  member: 'Insider', members: 'Insiders',
  points: 'points', point: 'point', glyph: '✦',
  treasurer: 'the Banker', treasurerTitle: 'Banker of the Circle',
  planner: 'Founder & Curator', comms: 'Founder & Voice of the Circle', desk: 'the Desk',
  contribution: 'contribution',
  share: 'the Circle’s share',
  reserve: 'the Reserve', operating: 'Operating',
  stay: 'Stay', trip: 'Trip', drop: 'Drop',
  // The photo feed. A postcard is sent from somewhere by someone you know; the one word you can
  // say back is the club's, not a glyph.
  postcard: 'Postcard', postcards: 'Postcards', cheer: 'Cheers',
  tiers: { 100: 'Watapana', 150: 'Fofoti', 200: 'Kibrahacha' },
  tierLean: { 100: 12, 150: 20, 200: 28 },   // degrees the tree glyph leans
  founding: 'Founding Insider · 2026',
  // Exactly four Papiamento phrases, always with English beside them.
  pap: {
    welcome: ['Bon bini', 'Welcome'],
    thanks: ['Masha danki', 'Thank you'],
    congrats: ['Pabien', 'Congratulations'],
    bye: ['Te aworo', 'See you later'],
  },
  legal: 'The Inner Hotel Circle is a private members’ club for prepaid, club-arranged travel. Points are not deposits and not an investment; there is no interest and no return.',
};
export const tierName = (monthlyUsd) => VOCAB.tiers[monthlyUsd] || `$${monthlyUsd}`;
export const initialsOf = (name = '') => name.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase();
export const refFor = (member, month) => `${VOCAB.refPrefix}-${initialsOf(member.name)}-${month}`;
