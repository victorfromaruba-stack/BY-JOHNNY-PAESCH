// Flights both ways for one option: out on its check-in, back on its check-out, every traveller.
//
// Now (slice 4a): the airline's own site, with the dates and travellers filled in, from
// js/core/airline-links.js, the same module the Ask Ian panel draws. Never an aggregator.
// Later (4b, when the Duffel key lands): SOURCES reads round-trip offers for these same legs.
// Each offer must carry both legs and a fare_usd; a fare not in USD is not quoted; a 403 or a
// challenge from anyone is a stop.

import { airlineLinks } from '../shared/airline-links.ts';

export type Trip = { out: string; back: string; origin: string | null; adults: number; children: number; infants: number };
export type Offer = { airline: string; out: unknown; back: unknown; fare_usd: number; listing: string; read_at: string };
export type AirlineSource = { code: string; offers(t: Trip): Promise<Offer[]> };
export const SOURCES: AirlineSource[] = [];

export async function flights(t: Trip) {
  const legs = {
    out: { date: t.out, from: t.origin ?? 'where they fly from, not known yet', to: 'AUA' },
    back: { date: t.back, from: 'AUA', to: t.origin ?? 'where they fly from, not known yet' },
  };
  const travellers = { adults: t.adults, children: t.children, lap_infants: t.infants };
  if (!t.origin) return { legs, travellers, said: 'Both legs follow these dates. Ask where they fly from (the plan tool keeps it), then the airline links can be given.' };
  if (!(t.adults >= 1)) return { legs, travellers, said: 'Ask who is travelling (adults, children, lap infants) first; the plan tool keeps it.' };
  const links = airlineLinks({ origin: t.origin, out: t.out, back: t.back, adults: t.adults, children: t.children, infants: t.infants }) || [];
  return {
    legs, travellers,
    airlines: links.map((l: any) => ({ airline: l.airline, listing: l.url, dates_filled_in: l.dated, flies_from_their_airport: l.serves_their_airport })),
    fares: 'Not read here. Each link opens the airline\'s own site with both legs and every traveller filled in; it shows the fare.',
    say: 'Name both legs with their dates, then give the airline links, one per line. Never a search site.',
  };
}
