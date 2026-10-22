// The one place that decides what Ian is told about the member it is talking to.
//
// The members table hands every Insider every column of every row, so "read the member" would
// carry an email, a phone, a username, a card code, the household and an officer's notes into a
// prompt at Anthropic. Nothing gets out of here unless it is named below. concierge.test.ts feeds
// in a full row and asserts that none of those values survive.

const first = (name?: string | null) => String(name || '').trim().split(/\s+/)[0] || 'Someone';

export type Raw = {
  member: { id: string; name: string; monthly_usd: number; [k: string]: unknown };
  available: number;
  pointsPerDollar: number;
  redemptions: { id: string; member_id: string; stay_id: string; check_in: string; check_out: string; nights: number; status: string; shared?: boolean; [k: string]: unknown }[];
  crews: { id: string; name: string; redemption_id?: string | null; stay_id?: string | null; plan_from?: string | null; plan_to?: string | null; archived_at?: string | null }[];
  crewMembers: { crew_id: string; member_id: string; role: string }[];
  watches: { member_id: string; stay_id?: string | null; from_date: string; to_date: string; nights: number; active?: boolean }[];
  memory: Record<string, string> | null;
  stayName: (id?: string | null) => string | null;
  memberName: (id: string) => string | null;
};

/** The member, as Ian may know them. */
export function memberContext(raw: Raw) {
  const me = raw.member.id;
  const mineCrews = new Set(raw.crewMembers.filter(m => m.member_id === me).map(m => m.crew_id));
  return {
    first_name: first(raw.member.name),
    monthly_usd: raw.member.monthly_usd,
    available_points: raw.available,
    available_usd: Math.round(raw.available / (raw.pointsPerDollar || 100)),
    // Officers can read every booking; Ian only ever talks about the member's own.
    bookings: raw.redemptions.filter(r => r.member_id === me).map(r => ({
      id: r.id, place: raw.stayName(r.stay_id), stay_id: r.stay_id, from: r.check_in, to: r.check_out,
      nights: r.nights, status: r.status, open_to_chip_in: !!r.shared,
    })),
    crews: raw.crews.filter(c => mineCrews.has(c.id) && !c.archived_at).map(c => ({
      id: c.id, name: c.name, booking_id: c.redemption_id ?? null,
      place: raw.stayName(c.stay_id), plan_from: c.plan_from ?? null, plan_to: c.plan_to ?? null,
      you_lead: raw.crewMembers.some(m => m.crew_id === c.id && m.member_id === me && m.role === 'lead'),
      people: raw.crewMembers.filter(m => m.crew_id === c.id).map(m => first(raw.memberName(m.member_id))),
    })),
    watches: raw.watches.filter(w => w.member_id === me && w.active !== false).map(w => ({
      place: raw.stayName(w.stay_id) ?? 'anywhere on the island', from: w.from_date, to: w.to_date, nights: w.nights,
    })),
    remembered: raw.memory || {},
  };
}

/** Somebody else, as Ian may name them: an id to invite with and a first name. Nothing more. */
export const personOf = (m: { id: string; name: string }) => ({ id: m.id, first_name: first(m.name) });
