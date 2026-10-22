// Air fares, one airline at a time, from public fare pages or official APIs only.
//
// Empty on purpose. v3 fills SOURCES from research/flights/airlines-aua.md; each source says which
// routes it covers and returns fares with where and when they were read. Until one exists Ian
// says it cannot read fares, and invents none. A 403 or a challenge from an airline is a stop.

export type Fare = { airline: string; from: string; to: string; date: string; usd: number; url: string; fetchedAt: string };
export type AirlineSource = { code: string; routes: string[]; fares(q: { from: string; to: string; date: string; pax: number }): Promise<Fare[]> };

export const SOURCES: AirlineSource[] = [];

export async function flights(q: { from?: string | null; to?: string | null; date?: string | null; pax?: number | null }) {
  const route = `${q?.from || ''}-${q?.to || ''}`.toUpperCase();
  const src = SOURCES.filter(s => s.routes.includes(route));
  if (!src.length) return { fares: [], said: 'No fares are read here yet. Interval is the Circle\'s main source for flights, cars, cruises and packages: Victor looks there himself. Offer to pass the request to him (a stay page or a crew thread), and invent nothing.' };
  const fares = (await Promise.all(src.map(s => s.fares({ from: q.from!, to: q.to!, date: q.date || '', pax: q.pax || 1 }).catch(() => [])))).flat();
  return { fares };
}
