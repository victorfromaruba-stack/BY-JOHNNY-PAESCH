// Every word the app prints lives here, so the club can be renamed in one file.
//
// Name note for Victor: the design panel's first pick, "Conchi" (the Natural Pool),
// reads as vulgar slang across much of Spanish-speaking Latin America, so it is not
// printed anywhere. "Hunto" is Aruban Papiamento for "together". Alternatives the
// panel liked: "Sotavento" (the leeward side), "The Pool". Change `clubName`,
// `wordmark` and `refPrefix` below and every screen, reference and template follows.
export const VOCAB = {
  clubName: 'Hunto',
  wordmark: 'HUNTO',
  subtitle: 'The Inner Circle · Aruba',
  meaning: 'Papiamento for “together”',
  tagline: 'Every point has a dollar behind it.',
  refPrefix: 'HUNTO',            // transfer reference: HUNTO-VR-2026-09
  circle: 'the Circle',
  member: 'Insider', members: 'Insiders',
  points: 'points', point: 'point', glyph: '✦',
  treasurer: 'the Banker', treasurerTitle: 'Banker of the Circle',
  planner: 'Founder & Curator', comms: 'Founder & Voice of the Circle', desk: 'the Desk',
  contribution: 'contribution',
  share: 'the Circle’s share',
  reserve: 'the Reserve', operating: 'Operating',
  stay: 'Stay', trip: 'Trip', drop: 'Drop',
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
  legal: 'Hunto is a private members’ club for prepaid, club-arranged travel. Points are not deposits and not an investment; there is no interest and no return.',
};
export const tierName = (monthlyUsd) => VOCAB.tiers[monthlyUsd] || `$${monthlyUsd}`;
export const initialsOf = (name = '') => name.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase();
export const refFor = (member, month) => `${VOCAB.refPrefix}-${initialsOf(member.name)}-${month}`;
