// The catalog. `rates` are the Circle's ALL-IN member cost per night in USD
// (room + taxes + service charge + resort fee + environmental levy),
// which is also the points price: 100 points = $1.00. Three rates per place, by the dates they
// apply to — Apr 6–Dec 19, Jan 4–Apr 5, and Dec 20–Jan 3 with Carnival week. These are never
// named or shown to a member: they give their dates and quoteStay prices those exact nights.
//
// These are planning bands, not quotes. Victor's negotiated all-in rate is what a
// member actually accepts, and planners edit every number in the Desk.
// `retailUsd` is a typical public all-in winter rate, for the "you save" line.
// `house: true` marks the four places the Circle actually uses most — the Marriott villas
// at the Ocean Club and the Surf Club, the Divi on Druif, and the Renaissance in town.

export const ARUBA_STAYS = [
  { id: 'stay_bucuti', site: 'https://www.bucuti.com/', kind: 'aruba', name: 'Bucuti & Tara Beach Resort', area: 'Eagle Beach', country: 'Aruba', category: 4,
    rates: { low: 560, high: 812, peak: 934 }, retailUsd: 950, minNights: 5, peakMinNights: 7, onSand: true, adultsOnly: true, allInclusive: false, taxesIncluded: true,
    vibe: 'Adults-only, carbon-neutral, the most romantic address on the widest stretch of Eagle Beach.',
    features: ['Adults only', 'Breakfast included', 'Taxes included', 'On the sand'], dealNote: 'Published rates already include taxes and breakfast. Five nights minimum all year.' },
  { id: 'stay_ritz', site: 'https://www.ritzcarlton.com/en/hotels/auart-the-ritz-carlton-aruba/overview/', kind: 'aruba', name: 'The Ritz-Carlton, Aruba', area: 'Palm Beach', country: 'Aruba', category: 4,
    rates: { low: 720, high: 1180, peak: 1416 }, retailUsd: 1341, minNights: 2, peakMinNights: 7, onSand: true, adultsOnly: false, allInclusive: false,
    vibe: 'Big-brand polish at the quiet north end of Palm Beach.',
    features: ['Club level', 'Casino', 'Spa', 'On the sand'], dealNote: 'Resort fee waived on Victor’s corporate rate outside the busy months.' },
  { id: 'stay_oceanvillas', site: 'https://www.arubaoceanvillas.com/', kind: 'aruba', name: 'Aruba Ocean Villas', area: 'Savaneta', country: 'Aruba', category: 4,
    rates: { low: 620, high: 920, peak: 1104 }, retailUsd: 900, minNights: 3, peakMinNights: 5, onSand: true, adultsOnly: true,
    vibe: 'Eight overwater bungalows in a fishing village. Bali meets Aruba, and it sells out months ahead.',
    features: ['Overwater villas', 'Adults only', 'Tree house', 'Meal plans'], dealNote: 'Victor is watching this one — put requests in early.' },
  { id: 'stay_surfclub', site: 'https://www.marriott.com/en-us/hotels/auaac-marriotts-aruba-surf-club/overview/', kind: 'aruba', name: 'Marriott’s Aruba Surf Club', area: 'Palm Beach', country: 'Aruba', category: 4, house: true,
    // Repriced against what Victor can actually book, not against the published rate. An
    // Interval Getaway week here came up at US$90.50 a night in September 2026, against the
    // resort's own $850.
    //
    // Only the cheap-months rate is anchored to that observation, and set above it on purpose —
    // one week of surplus is not a year. The other two are estimates: Getaways thin out and
    // owners on RedWeek ask more, but nobody has watched a winter yet. Replace them with real
    // numbers the first time Victor prices a January week.
    rates: { low: 135, high: 310, peak: 580 }, retailUsd: 850, minNights: 7, peakMinNights: 7, onSand: true, adultsOnly: false, allInclusive: false,
    sources: {
      best: 'interval',
      interval: { seenUsd: 90.50, seenOn: '2026-09-06', nights: 7, note: 'A Getaway week, when one is there' },
      redweek: { fromUsd: 150, seenOn: '2026-09-06', note: '1,725 owner rentals, $150 to $3,600 a night' },
    },
    vibe: 'Aruba’s largest villa resort, at the north end of Palm Beach: 450 villas across the Lighthouse, Compass and Spyglass towers, wrapped around the lazy river, with a side gate onto the restaurant strip.',
    features: ['Villas sleep up to 8', 'Full kitchen', 'Washer-dryer in villa', 'Lazy river', 'On the sand'],
    dealNote: 'One of the four we keep coming back to. Owner weeks rent Saturday to Saturday, so this is a seven-night booking — but a two-bedroom villa sleeps eight, and split three or four ways it is the cheapest good week on Palm Beach. No resort fee, and taxes are already in the price.' },
  { id: 'stay_oceanclub', site: 'https://www.marriott.com/en-us/hotels/auaao-marriotts-aruba-ocean-club/overview/', kind: 'aruba', name: 'Marriott’s Aruba Ocean Club', area: 'Palm Beach', country: 'Aruba', category: 4, house: true,
    // Same repricing, same caveat: the cheap-months rate is anchored to Interval having it at US$167.50 the
    // same week the Surf Club was at $90.50 — which is itself the reason to check both every
    // time. The other two are still estimates.
    rates: { low: 165, high: 340, peak: 620 }, retailUsd: 875, minNights: 7, peakMinNights: 7, onSand: true, adultsOnly: false, allInclusive: false,
    sources: {
      best: 'interval',
      interval: { seenUsd: 167.50, seenOn: '2026-09-10', nights: 7, note: 'A Getaway week, when one is there' },
      redweek: { fromUsd: 150, seenOn: '2026-09-06', note: '607 owner rentals, $150 to $4,800 a night' },
    },
    vibe: 'The original Marriott villas — 218 of them, a quarter the size of the Surf Club next door, quieter, and two minutes from the Stellaris casino and the whole strip.',
    features: ['Villas sleep 4–8', 'Full kitchen', 'Mandara Spa', 'Casino next door', 'On the sand'],
    dealNote: 'One of the four we keep coming back to. Seven nights, Saturday to Saturday, the same as the Surf Club. The 941 sq ft one-bedroom is the sweet spot for two; the 1,335 sq ft two-bedroom sleeps eight. No washer-dryer in the villas here — that is the Surf Club’s trick.' },
  { id: 'stay_marriott', site: 'https://www.marriott.com/en-us/hotels/auaar-aruba-marriott-resort-and-stellaris-casino/overview/', kind: 'aruba', name: 'Aruba Marriott Resort & Stellaris Casino', area: 'Palm Beach', country: 'Aruba', category: 3,
    rates: { low: 420, high: 640, peak: 768 }, retailUsd: 980, minNights: 2, peakMinNights: 7, onSand: true, adultsOnly: false,
    vibe: 'Renovated through 2025, adults-only Tradewinds wing, the largest casino on the island.',
    features: ['Tradewinds Club', 'Adults-only pool', 'Spa', 'Casino'], dealNote: 'Bonvoy points still post to your own account when Victor books in your name.' },
  { id: 'stay_hyatt', site: 'https://www.hyatt.com/hyatt-regency/en-US/aruba-hyatt-regency-aruba-resort-spa-and-casino', kind: 'aruba', name: 'Hyatt Regency Aruba Resort Spa & Casino', area: 'Palm Beach', country: 'Aruba', category: 3,
    rates: { low: 395, high: 610, peak: 732 }, retailUsd: 961, minNights: 2, peakMinNights: 7, onSand: true, adultsOnly: false,
    vibe: 'Twelve acres of lagoon gardens, black swans and macaws, adults-only Trankilo pool.',
    features: ['Regency Club', 'ZoiA Spa', 'Kids club', 'Casino'], dealNote: '' },
  { id: 'stay_renaissance', site: 'https://www.marriott.com/en-us/hotels/auabr-renaissance-wind-creek-aruba-resort/overview/', kind: 'aruba', name: 'Renaissance Wind Creek Aruba Resort', area: 'Oranjestad', country: 'Aruba', category: 3, house: true,
    rates: { low: 420, high: 640, peak: 930 }, retailUsd: 800, minNights: 2, peakMinNights: 5, onSand: false, adultsOnly: false,
    vibe: 'A marina hotel in the middle of the capital with a forty-acre private island: flamingos, iguanas, and a water taxi that leaves from the lobby.',
    features: ['Private island', 'Flamingo Beach', 'Adults-only tower', 'Casino', 'Renaissance Mall'],
    dealNote: 'One of the four we keep coming back to. Marina tower is 18+ (297 rooms); Ocean Suites is the family side (258 one-bedroom suites with kitchenettes). Renaissance Island is free for guests of both — outsiders queue for about thirty day passes a day at $130 a head. The $65 resort fee and taxes are already in our price.' },
  { id: 'stay_manchebo', site: 'https://www.manchebo.com/', kind: 'aruba', name: 'Manchebo Beach Resort & Spa', area: 'Eagle Beach', country: 'Aruba', category: 3,
    rates: { low: 340, high: 510, peak: 612 }, retailUsd: 694, minNights: 3, peakMinNights: 7, onSand: true, adultsOnly: false,
    vibe: 'Barefoot boutique with a yoga pavilion on the sand and not a high-rise in sight.',
    features: ['Spa del Sol', 'Beach yoga', '72 rooms', 'Widest beach'], dealNote: '' },
  { id: 'stay_oceanz', site: 'https://www.oceanzaruba.com/', kind: 'aruba', name: 'Ocean Z Boutique Hotel', area: 'Malmok', country: 'Aruba', category: 3,
    rates: { low: 330, high: 500, peak: 600 }, retailUsd: 780, minNights: 2, peakMinNights: 5, onSand: false, adultsOnly: true,
    vibe: 'Fourteen white-minimalist suites above the Malmok snorkel coast, with a chef-driven restaurant.',
    features: ['Ocean-front infinity pool', 'Adults only', 'Snorkelling at Boca Catalina'], dealNote: '' },
  { id: 'stay_hilton', site: 'https://www.hilton.com/en/hotels/auahhhh-hilton-aruba-caribbean-resort-and-casino/', kind: 'aruba', name: 'Hilton Aruba Caribbean Resort & Casino', area: 'Palm Beach', country: 'Aruba', category: 2,
    rates: { low: 310, high: 470, peak: 564 }, retailUsd: 604, minNights: 2, peakMinNights: 7, onSand: true, adultsOnly: false,
    vibe: 'The island’s first grand resort, opened 1959, on fifteen acres of gardens.',
    features: ['Eforea spa', 'Two pools', 'Beach bar', 'Casino'], dealNote: '' },
  { id: 'stay_riu', site: 'https://www.riu.com/en/hotel/aruba/palmbeach/hotel-riu-palace-antillas', kind: 'aruba', name: 'RIU Palace Antillas', area: 'Palm Beach', country: 'Aruba', category: 'ai',
    rates: { low: 500, high: 700, peak: 805 }, retailUsd: 760, minNights: 3, peakMinNights: 7, onSand: true, adultsOnly: true, allInclusive: true,
    vibe: 'Adults-only 24-hour all-inclusive tower with its own casino.',
    features: ['All inclusive', 'Adults only', 'Casino', '24h bars'], dealNote: 'Rate is all-inclusive for two adults.' },
  { id: 'stay_barcelo', site: 'https://www.barcelo.com/en-us/barcelo-aruba/', kind: 'aruba', name: 'Barceló Aruba', area: 'Palm Beach', country: 'Aruba', category: 'ai',
    rates: { low: 480, high: 660, peak: 759 }, retailUsd: 700, minNights: 3, peakMinNights: 7, onSand: true, adultsOnly: false, allInclusive: true,
    vibe: 'Large family all-inclusive mid-strip, with an upgraded Royal Level wing.',
    features: ['All inclusive', 'Royal Level', 'Kids club', 'Casino'], dealNote: 'Rate is all-inclusive for two adults.' },
  { id: 'stay_tamarijn', site: 'https://www.diviandtamarijnaruba.com/tamarijn-rooms.htm', kind: 'aruba', name: 'Tamarijn Aruba All Inclusive', area: 'Druif Beach', country: 'Aruba', category: 'ai',
    rates: { low: 460, high: 630, peak: 725 }, retailUsd: 680, minNights: 3, peakMinNights: 7, onSand: true, adultsOnly: false, allInclusive: true,
    vibe: 'Every room oceanfront, two floors, toes in the sand. Guests use Divi next door too.',
    features: ['All inclusive', 'Oceanfront rooms', 'Divi access'], dealNote: 'Rate is all-inclusive for two adults.' },
  { id: 'stay_divi', site: 'https://www.diviandtamarijnaruba.com/divi-rooms.htm', kind: 'aruba', name: 'Divi Aruba All Inclusive', area: 'Druif Beach', country: 'Aruba', category: 'ai', house: true,
    rates: { low: 520, high: 700, peak: 950 }, retailUsd: 850, minNights: 3, peakMinNights: 7, onSand: true, adultsOnly: false, allInclusive: true,
    vibe: '203 rooms in low buildings on Druif Beach, five minutes from Oranjestad and ten from the airport; every room has a patio facing the sea or the garden.',
    features: ['All inclusive', '15 restaurants', 'Alhambra casino', 'Tamarijn included'],
    dealNote: 'One of the four we keep coming back to. Rate is all-inclusive for two adults and it buys the Tamarijn next door as well — the two together are fifteen restaurants, twelve bars and eleven pools. On an all-inclusive, tax applies to only part of the package, which is why this looks better against retail than it should.' },
  { id: 'stay_embassy', site: 'https://www.hilton.com/en/hotels/auajmes-embassy-suites-aruba-resort/', kind: 'aruba', name: 'Embassy Suites by Hilton Aruba Resort', area: 'Eagle Beach', country: 'Aruba', category: 2,
    rates: { low: 290, high: 440, peak: 528 }, retailUsd: 600, minNights: 2, peakMinNights: 7, onSand: false, adultsOnly: false,
    vibe: 'New-build all-suite resort: cooked breakfast, evening reception, rooftop pool, beach club across the road.',
    features: ['Two-room suites', 'Breakfast included', 'Rooftop pool', 'Beach club'], dealNote: '' },
  { id: 'stay_radisson', site: 'https://www.bluaruba.com/', kind: 'aruba', name: 'Radisson Blu Aruba', area: 'Palm Beach', country: 'Aruba', category: 2,
    rates: { low: 270, high: 420, peak: 504 }, retailUsd: 540, minNights: 2, peakMinNights: 5, onSand: false, adultsOnly: false,
    vibe: 'Suites with kitchens and the largest adults-only rooftop infinity pool on the strip.',
    features: ['Kitchens', 'Rooftop infinity pool', 'Walk to Paseo Herencia'], dealNote: '' },
  { id: 'stay_holidayinn', site: 'https://www.ihg.com/holidayinnresorts/hotels/us/en/aruba/auaan/hoteldetail', kind: 'aruba', name: 'Holiday Inn Resort Aruba', area: 'Palm Beach', country: 'Aruba', category: 2,
    rates: { low: 260, high: 380, peak: 437 }, retailUsd: 450, minNights: 2, peakMinNights: 5, onSand: true, adultsOnly: false,
    vibe: 'Value family resort at the south end of the strip; children stay and eat free.',
    features: ['Kids free', 'Casino', 'Tennis', 'On the sand'], dealNote: '' },
  { id: 'stay_courtyard', site: 'https://www.marriott.com/en-us/hotels/auacy-courtyard-aruba-resort/overview/', kind: 'aruba', name: 'Courtyard by Marriott Aruba Resort', area: 'Noord', country: 'Aruba', category: 2,
    rates: { low: 250, high: 360, peak: 414 }, retailUsd: 420, minNights: 2, peakMinNights: 5, onSand: false, adultsOnly: false,
    vibe: 'Modern inland resort with a big lagoon pool and a free beach shuttle.',
    features: ['Lagoon pool', 'Beach shuttle', 'Spa'], dealNote: '' },
  { id: 'stay_boardwalk', site: 'https://www.boardwalkaruba.com/', kind: 'aruba', name: 'Boardwalk Boutique Hotel Aruba', area: 'Palm Beach', country: 'Aruba', category: 1,
    rates: { low: 235, high: 330, peak: 380 }, retailUsd: 480, minNights: 3, peakMinNights: 5, onSand: false, adultsOnly: false,
    vibe: 'Casitas with kitchens and hammocks on an old coconut plantation, with its own palapas on Palm Beach.',
    features: ['Kitchens', 'Two pools', 'Family-owned', 'Beach palapas'], dealNote: 'Best value for a week with friends.' },
  { id: 'stay_amsterdam', site: 'https://www.amsterdammanor.com/', kind: 'aruba', name: 'Amsterdam Manor Beach Resort', area: 'Eagle Beach', country: 'Aruba', category: 1,
    rates: { low: 220, high: 310, peak: 357 }, retailUsd: 390, minNights: 3, peakMinNights: 5, onSand: false, adultsOnly: false,
    vibe: 'Dutch-colonial ochre facades, studios with kitchens, and Passions beach bar on the sand.',
    features: ['Kitchens', 'Beach bar', 'Quiet', 'Family-owned'], dealNote: 'The September promotion is passed through to members in full.' },
  { id: 'stay_voco', site: 'https://www.ihg.com/voco/hotels/us/en/aruba/aualb/hoteldetail', kind: 'aruba', name: 'voco Surfside Aruba', area: 'Oranjestad', country: 'Aruba', category: 1,
    rates: { low: 190, high: 270, peak: 311 }, retailUsd: 380, minNights: 2, peakMinNights: 4, onSand: false, adultsOnly: false,
    vibe: 'The old Talk of the Town, reborn in December 2025: retro-modern, beach club across the street, three minutes from the airport.',
    features: ['Beach club', 'Near the airport', 'Retro-modern'], dealNote: 'Good for a landing night before a longer stay.' },
  { id: 'stay_eagle', site: 'https://www.eaglearuba.com/', kind: 'aruba', name: 'Eagle Aruba Resort', area: 'Eagle Beach', country: 'Aruba', category: 1,
    rates: { low: 180, high: 260, peak: 299 }, retailUsd: 330, minNights: 2, peakMinNights: 4, onSand: false, adultsOnly: false,
    vibe: 'Two pools across the road from the world’s third-best beach.',
    features: ['Two pools', 'Walk to Eagle Beach'], dealNote: '' },
];

// Trips Victor and Ian organize. A seat covers the hotels, every internal transfer and
// whatever is listed — flights to and from Aruba are extra unless the note says otherwise;
// two sharing a double. Three countries this cycle: the Dominican Republic, Mexico, Japan.
//
// `reach` says how far a trip goes. It does not gate anyone: every Insider can ask for
// every trip at every level. What the level changes is how fast the points build.
// Guests pay `guestCashUsd` to the Banker (no 15% on that).
export const WORLD_TRIPS = [
  { id: 'trip_samana', kind: 'trip', reach: 'region', name: 'Samaná, whale season', area: 'Santo Domingo & Las Terrenas', country: 'Dominican Republic', dates: { from: '2027-03-07', to: '2027-03-14' }, nights: 7,
    pointsPerSeat: 125000, guestCashUsd: 1250, retailUsd: 1950, seats: 14, holdDeadline: '2026-12-15', isDrop: true,
    vibe: 'Two nights inside the walls of the Zona Colonial, then the drive up the Boulevard Turístico to Las Terrenas — five nights on Playa Cosón with the humpbacks in Samaná Bay.',
    features: ['Group trip', 'Whale watching', 'Seven nights', 'Fourteen seats'],
    dealNote: 'Arajet flies Aruba–Santo Domingo nonstop in about an hour and a half, Wednesdays and Sundays, so this is a Sunday-to-Sunday week. Flights are extra, around $300–450 return. March is the driest month in Las Terrenas and the last of the whale season — the boats run to 25 March and no later. Two-bedroom residences at Sublime sleep four, which is what makes the per-head number work; chip in with someone and it drops again.' },
  { id: 'trip_oaxaca', kind: 'trip', reach: 'world', name: 'Mexico City & Oaxaca', area: 'Ciudad de México & Oaxaca', country: 'Mexico', dates: { from: '2027-02-18', to: '2027-02-27' }, nights: 9,
    pointsPerSeat: 175000, guestCashUsd: 1750, retailUsd: 2550, seats: 12, holdDeadline: '2026-12-15', isDrop: false,
    vibe: 'The anti-beach trip. Four nights in Roma Norte and Condesa, Teotihuacán before the buses arrive, then the short hop south for five nights of mezcal, mole and Monte Albán.',
    features: ['Group trip', 'Two cities', 'Nine nights', 'Dry season'],
    dealNote: 'Copa via Panama, about eight and a half hours in the air; flights are extra, roughly $480–650 return. The Mexico City–Oaxaca hop is inside the seat price. Late February is dry season in Oaxaca and misses both the Day of the Dead and Guelaguetza premiums — Day of the Dead triples the centro rates and books a year out.' },
  { id: 'trip_japan', kind: 'trip', reach: 'world', name: 'Kyoto & Tokyo, early December', area: 'Kyoto & Tokyo', country: 'Japan', dates: { from: '2027-12-02', to: '2027-12-12' }, nights: 10,
    pointsPerSeat: 210000, guestCashUsd: 2100, retailUsd: 2975, seats: 8, holdDeadline: '2027-06-30', isDrop: false,
    vibe: 'The far one. Five nights in Kyoto with the maples still turning and the illuminations lit, five in Tokyo, in apartments with kitchens rather than hotel rooms. Open-jaw: into Osaka, out of Haneda, so nobody backtracks.',
    features: ['The far one', 'Ten nights', 'Open-jaw', 'Apartments'],
    dealNote: 'Be honest with yourself about the journey: there is no same-day connection from Aruba to Japan. Every Aruba departure lands at its hub after the day’s transpacific flights have gone. We route Aruba–Amsterdam–Osaka so both overnights happen in a seat instead of a hotel — two days out, two days back, fourteen days door to door. Early December is the one window where Kyoto still has colour, the crowds have gone and the rooms cost about half of what they do in November. Hotels, the shinkansen between the two cities and every transfer are in the seat; flights are extra. Eight seats, and Victor needs the names by 30 June 2027.' },
  // A cruise is a trip with a ship: a cabin instead of a seat, a port instead of a hotel. This one
  // is the demo's example of the shape; on the real Circle, Victor posts what Interval has.
  { id: 'trip_cruise_abc', kind: 'trip', reach: 'region', name: 'Seven nights, the ABC islands and Cartagena', area: 'Oranjestad', country: 'Aruba', dates: { from: '2027-01-24', to: '2027-01-31' }, nights: 7,
    pointsPerSeat: 189000, guestCashUsd: 1890, retailUsd: 2640, seats: 4, holdDeadline: '2026-11-30', isDrop: false,
    cruise: { line: 'Celebrity', ship: 'Celebrity Beyond', embark: 'Oranjestad', ports: ['Oranjestad', 'Willemstad', 'Kralendijk', 'Cartagena', 'Oranjestad'], cabin: 'Balcony cabin, two people', ref: '' },
    vibe: 'Walk on in Oranjestad, sleep on the water, wake up in Curaçao. A balcony cabin for two, all meals aboard, the Circle’s block of four cabins on one deck.',
    features: ['Cruise', 'Balcony cabin', 'Seven nights', 'Sails from Aruba'],
    dealNote: 'A cabin is for two, and the price is for the cabin — split it with whoever you bring. Interval trades a deposited week for a cabin like this; Victor confirms the sailing and the deck before he quotes anyone.' },
];
