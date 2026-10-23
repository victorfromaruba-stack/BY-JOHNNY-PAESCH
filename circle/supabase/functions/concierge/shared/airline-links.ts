// @ts-nocheck
// GENERATED from circle/js/core/airline-links.js by shared/sync.ts. Do not edit here: edit the source and run the sync.
// Flights both ways, on the airline's own site: links with the trip's own dates and travellers filled in.
//
// Victor, 22 Oct 2026: a trip is a round trip, out on check-in and back on check-out, for every
// traveller including a lap infant, and flights follow each option's own dates. Airline-direct only,
// never Google Flights or an aggregator. Nothing here reads a fare: the member taps and the airline
// shows it (airline sites block this server; research/flights/airlines-aua.md).
//
// Pure, no imports: the Ask Ian panel and Ian's `flights` tool both use it.
// Link formats: research/flights/lim-aua-deeplinks.md (22 Oct 2026; "inferred" from several public
// examples, none documented by the airlines). Routes: research/flights/airlines-aua.md section 1
// (Wikipedia's AUA table, read 22 Oct 2026). A carrier without a known link format gets its search page.

export const NEVER = /google\.[a-z.]+\/(travel|flights)|kayak\.|skyscanner\.|expedia\.|momondo\.|cheapflights\.|priceline\.|orbitz\.|travelocity\.|kiwi\.com|hopper\.|trip\.com/i;

const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

/** Carriers serving AUA. `deep` builds a date-filled round trip; without it, the airline's own search page. */
export const CARRIERS = Object.freeze({
  LA: { name: 'LATAM', site: 'https://www.latamairlines.com/pe/es',
    deep: (t) => `https://www.latamairlines.com/pe/es/ofertas-vuelos?origin=${t.from}&destination=${t.to}&outbound=${t.out}T12%3A00%3A00.000Z&inbound=${t.back}T12%3A00%3A00.000Z&${q({ adt: t.adults, chd: t.children, inf: t.infants })}&trip=RT&cabin=Economy&redemption=false&sort=RECOMMENDED` },
  AV: { name: 'Avianca', site: 'https://www.avianca.com/es/',
    deep: (t) => `https://www.avianca.com/es/booking/select/?${q({ origin1: t.from, destination1: t.to, departure1: t.out, adt1: t.adults, tng1: 0, chd1: t.children, inf1: t.infants,
      origin2: t.to, destination2: t.from, departure2: t.back, adt2: t.adults, tng2: 0, chd2: t.children, inf2: t.infants })}` },
  CM: { name: 'Copa', site: 'https://www.copaair.com/',
    deep: (t) => `https://shopping.copaair.com/?${q({ roundtrip: 'true', adults: t.adults, children: t.children, infants: t.infants, date1: t.out, date2: t.back, promocode: '', area1: t.from, area2: t.to, advanced_air_search: 'false', flexible_dates_v2: 'false' })}` },
  B6: { name: 'JetBlue', site: 'https://www.jetblue.com/',
    deep: (t) => `https://www.jetblue.com/booking/flights?${q({ from: t.from, to: t.to, depart: t.out, return: t.back, isMultiCity: 'false', noOfRoute: 1, adults: t.adults, children: t.children, infants: t.infants, roundTripFaresFlag: 'false', sharedMarket: 'false', usePoints: 'false' })}` },
  DM: { name: 'Arajet', site: 'https://www.arajet.com/en-us/home',
    deep: (t) => `https://www.arajet.com/en-us/booking?${q({ origin: t.from, destination: t.to, from: t.out, to: t.back, adt: t.adults, chd: t.children, inf: t.infants, currency: 'USD' })}` },
  AA: { name: 'American', site: 'https://www.aa.com/' },
  DL: { name: 'Delta', site: 'https://www.delta.com/' },
  UA: { name: 'United', site: 'https://www.united.com/' },
  AC: { name: 'Air Canada', site: 'https://www.aircanada.com/' },
  WS: { name: 'WestJet', site: 'https://www.westjet.com/' },
  PD: { name: 'Porter', site: 'https://www.flyporter.com/' },
  TS: { name: 'Air Transat', site: 'https://www.airtransat.com/' },
  KL: { name: 'KLM', site: 'https://www.klm.com/' },
  OR: { name: 'TUI fly', site: 'https://www.tui.nl/' },
  WN: { name: 'Southwest', site: 'https://www.southwest.com/' },
  SY: { name: 'Sun Country', site: 'https://www.suncountry.com/' },
  AR: { name: 'Aerolíneas Argentinas', site: 'https://www.aerolineas.com.ar/' },
  P5: { name: 'Wingo', site: 'https://www.wingo.com/' },
});

/** Who flies each origin to AUA nonstop (and LIM's one-stops), from the AUA table. */
export const ROUTES = Object.freeze({
  LIM: ['LA', 'AV', 'CM'], BOG: ['AV', 'P5', 'LA'], BAQ: ['P5'], MDE: ['P5'], PTY: ['CM'], EZE: ['AR'],
  SDQ: ['DM'], PUJ: ['DM'],
  MIA: ['AA'], CLT: ['AA'], PHL: ['AA'], ORD: ['AA', 'UA'], DFW: ['AA'], LGA: ['AA'],
  ATL: ['DL'], JFK: ['DL', 'B6'], BOS: ['B6', 'DL'], FLL: ['B6'], MSP: ['DL', 'SY'], DTW: ['DL'],
  EWR: ['UA'], IAH: ['UA'], IAD: ['UA'], BWI: ['WN'], MCO: ['WN'],
  YYZ: ['AC', 'WS', 'PD'], YUL: ['AC', 'TS'], YOW: ['PD'], AMS: ['KL', 'OR'],
});
/** No nonstop from where they are: the two hubs whose engines take any origin, and Miami. */
const VIA = ['CM', 'AV', 'AA'];

/**
 * The airline links for one trip: both legs on the trip's own dates, every traveller, lap infants as
 * infants. `trip` is { origin, out, back, adults, children, infants }; null when it cannot be built.
 */
export function airlineLinks(trip) {
  const from = String(trip?.origin || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !trip?.out || !trip?.back || !(trip.adults >= 1)) return null;
  const t = { from, to: 'AUA', out: trip.out, back: trip.back, adults: trip.adults, children: trip.children || 0, infants: trip.infants || 0 };
  const direct = ROUTES[from];
  return (direct || VIA).map((code) => {
    const c = CARRIERS[code];
    const url = c.deep ? c.deep(t) : c.site;
    return { code, airline: c.name, url, dated: !!c.deep, serves_their_airport: !!direct };
  }).filter((l) => !NEVER.test(l.url));
}
