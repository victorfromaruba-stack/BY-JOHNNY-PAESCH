// What Ian knows beyond the board: each place's own published facts, and a short hand-kept facts file.
//
// No vectors and no second vendor: the whole of it is a few thousand words, matched by words. A fact is
// sayable only because a tool returned it (the number guard counts tool results and nothing else), which
// is why none of this lives in the prompt.
//
// places.js and stays.js are the app's own files; shared/sync.ts copies them into this folder (a test
// fails when a copy drifts), so the deploy and the nightly replay's scratch copy both carry them, and
// the phone and Ian read the same facts. The dry run says how many places the deploy carried.

import { PLACES } from './shared/places.ts';
import { ARUBA_STAYS } from './shared/stays.ts';
import { normName } from './shared/names.ts';

export const PLACES_ON_FILE = Object.keys(PLACES).length;
const SEED_BY_NAME = new Map((ARUBA_STAYS as { id: string; name: string }[]).map(s => [normName(s.name), s.id]));
const np = (v: unknown) => (v == null || v === '' ? 'not published' : v);

/** What a place publishes about itself, with where it was read. Null when the Circle holds nothing on it. */
export function placeFacts(name: string) {
  const id = SEED_BY_NAME.get(normName(name));
  const p = id ? (PLACES as Record<string, any>)[id] : null;
  if (!p) return null;
  return {
    address: np(p.address), check_in: np(p.checkIn), check_out: np(p.checkOut),
    children_welcome: np(p.policies?.children), dogs_allowed: np(p.policies?.dogs),
    on_site: p.amenities?.onsite?.length ? p.amenities.onsite : 'not published',
    services: p.amenities?.services?.length ? p.amenities.services : 'not published',
    nearby: p.amenities?.nearby?.length ? p.amenities.nearby : 'not published',
    units: (p.units || []).slice(0, 8).map((u: any) => ({ name: u.name, bedrooms: u.bedrooms ?? null, bathrooms: u.bathrooms ?? null, sleeps: u.sleeps ?? null, kitchen: u.kitchen ?? null, view: u.view ?? null })),
    // Under `listing`, so the phone links the page the facts were read from, and no other.
    source: (p.sources || []).map((s: any) => ({ label: s.label, listing: s.url, read_on: s.seenOn })),
    say: 'Facts as the place publishes them. Anything not here is "not published": say so, never guess.',
  };
}

// ---------------------------------------------------------------- facts.md
export const FACTS_MD = await Deno.readTextFile(new URL('./facts.md', import.meta.url)).catch(() => '');
export type Section = { title: string; text: string; source: string; checked: string | null; listing: string | null };

export function sections(md = FACTS_MD): Section[] {
  return md.split(/^## /m).slice(1).map((chunk) => {
    const [title, ...rest] = chunk.split('\n');
    const body = rest.join('\n').trim();
    const source = (body.match(/^Source:.*$/m) || [''])[0];
    return {
      title: title.trim(),
      text: body.replace(/^Source:.*$/m, '').trim(),
      source: source.replace(/^Source:\s*/, '').trim(),
      checked: (source.match(/Checked (\d{1,2} \w+ \d{4})/) || [null, null])[1],
      listing: ((source.match(/https:\/\/[^\s,);]+/) || [null])[0] || '').replace(/[.;]+$/, '') || null,
    };
  });
}

const STOP = new Set(['the', 'and', 'for', 'what', 'how', 'does', 'can', 'are', 'with', 'from', 'that', 'this', 'there', 'get', 'any',
  'you', 'your', 'about', 'tell', 'much', 'many', 'when', 'where', 'who', 'why', 'which', 'have', 'need', 'take', 'out']);
const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)
  .filter(w => w.length >= 3 && !STOP.has(w)).map(w => w.replace(/(ies)$/, 'y').replace(/(?<=[^s])s$/, ''));

/** The two or three sections that answer a topic best, by words; or a plain "not on file". */
export function factsFor(topic: string, md = FACTS_MD) {
  const want = [...new Set(words(topic))];
  const scored = sections(md).map((s) => {
    const t = new Set(words(s.title)), b = words(s.text);
    const score = want.reduce((n, w) => n + (t.has(w) ? 3 : 0) + Math.min(3, b.filter(x => x === w).length), 0);
    return { s, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  if (!scored.length) return { found: [], said: 'Nothing on file about that. Say it is not on file; never guess.' };
  return {
    found: scored.map(({ s }) => ({ topic: s.title, facts: s.text, source: s.source, checked: s.checked, ...(s.listing ? { listing: s.listing } : {}) })),
    say: 'Say these as written, with where they come from. Anything not in them is not on file.',
  };
}
