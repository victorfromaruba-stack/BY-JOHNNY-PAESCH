// RedWeek: owner rentals at a resort.
//
// No login and no browser. Every listing card carries its own data attributes — check-in,
// check-out, nights, bedrooms, sleeps, view, price, price per night — so this reads structured
// values rather than guessing at text. One request per resort, and it identifies itself.

const BASE = 'https://www.redweek.com';
// A crawler saying who it is, and how to be told to stop, is the polite convention and makes a
// block less likely. Whose address that is, though, is not this file's to decide: set
// WATCH_CONTACT in .env and it goes in, leave it out and nothing personal is sent or published.
const UA = process.env.WATCH_UA
  || `HuntoCircleWatcher/1.0 (private travel club${process.env.WATCH_CONTACT ? `; contact ${process.env.WATCH_CONTACT}` : ''})`;

/**
 * Every Aruba resort RedWeek lists, read off their own search page, mapped to the name our
 * catalog uses. Names, not ids: on the live backend every stay has a fresh uuid, so a bundled
 * id like stay_surfclub matches nothing there.
 */
export const ARUBA = Object.freeze({
  'P4872-marriotts-aruba-surf-club': "Marriott's Aruba Surf Club",
  'P148-marriotts-aruba-ocean-club': "Marriott's Aruba Ocean Club",
  'P6494-renaissance-wind-creek-aruba-ocean': 'Renaissance Wind Creek Aruba Resort',
  'P134-barcelo-aruba': 'Barceló Aruba',
  'P146-eagle-aruba-resort': 'Eagle Aruba Resort',
  'P6631-amsterdam-manor-beach-resort': 'Amsterdam Manor Beach Resort',
  'P137-divi-aruba-phoenix-beach-resort': null,
  'P144-divi-dutch-village-beach-resort': null,
  'P5400-divi-village-golf-and-beach-resort': null,
  'P139-caribbean-palm-village': null,
  'P140-casa-del-mar-beach-resort': null,
  'P141-costa-linda-beach-resort': null,
  'P145-la-cabana-beach-resort': null,
  'P147-la-quinta-beach-resort': null,
  'P149-paradise-beach-villas': null,
  'P151-playa-linda-beach-resort': null,
  'P135-aruba-beach-club': null,
  'P4734-the-mill-resort-suites': null,
});

// Apostrophes, accents and "&" differ between sites and our data. One normaliser for the whole
// app, so the watcher and the website agree on which resort a name means.
export { sameName } from '../js/core/names.js';

const day = (s) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null);
const num = (s) => { const n = Number(String(s).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : 0; };

/**
 * Pull the listings out of a rentals page. Exported so it can be tested against saved HTML
 * without going near the network.
 */
export function parseRentals(html, { slug, ourName = null } = {}) {
  const out = [];
  // Each card opens with its attributes; take the tag and the chunk of markup after it. The
  // ceiling was 2,500 characters, and the biggest cards run to 5,600 — the lookahead simply
  // failed on those and the listing vanished, silently, at a rate of ten out of every fifty-four
  // bookable weeks. It is generous now and still bounded, so a malformed page cannot run away.
  const re = /<div class="([^"]*posting-card[^"]*)"([^>]*)>([\s\S]{0,12000}?)(?=<div class="[^"]*posting-card|<\/section|$)/g;
  let m;
  while ((m = re.exec(html))) {
    const [, cls, attrs, body] = m;
    const a = Object.fromEntries([...attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
    if (!a.price_per_night || !a.check_in) continue;
    const from = day(a.check_in), to = day(a.check_out);
    if (!from || !to) continue;
    // data-price is the subtotal; the card also prints an all-in total that includes fees.
    const shown = body.match(/\$([\d,]+)\s*total/i);
    const total = shown ? num(shown[1]) : num(a.price);
    const nights = Number(a.nights) || 0;
    const unit = (body.match(/>\s*((?:Studio|\d\s*Bedroom)[^<]{0,44})</i) || [, ''])[1].trim();
    // The posting id: its own link when the card has one, the id RedWeek puts on the action
    // button when it does not. Never the price — a listing that drops a dollar is the same week.
    const id = (a['posting-path'] || '').split('/').pop()
      || (body.match(/title="(R\d+)"/) || [])[1]
      || `${slug}-${a.check_in}-${a.check_out}`;
    out.push({
      source: 'redweek', slug, ourName,
      externalId: id,
      url: a['posting-path'] ? BASE + a['posting-path'] : `${BASE}/resort/${slug}/timeshare-rentals`,
      from, to, nights,
      bedrooms: Number(a.bedrooms) || 0, bathrooms: Number(a.bathrooms) || 0,
      sleeps: Number(a.sleeps) || 0, view: a.view || '',
      unit: unit || (Number(a.bedrooms) ? `${a.bedrooms} Bedroom` : 'Studio'),
      // The site's own per-night figure is the subtotal divided out; the total it prints
      // includes the fees. Comparing one against the other put a nightly ceiling on a number
      // nobody pays, so the nightly here is the total spread across the nights — what it costs.
      usdNightly: nights > 0 && total > 0 ? Math.round((total / nights) * 100) / 100 : num(a.price_per_night),
      usdBeforeFees: num(a.price_per_night),
      usdTotal: total,
      // RedWeek leaves sold listings on the page and marks the card.
      taken: /posting-not-available|unavailable/.test(cls) || /\bRented!?\b/i.test(body),
      // What an available card actually carries is posting-protected — RedWeek standing behind
      // the payment. `posting-verified` is only ever on a card that is already gone, so reading
      // that one meant this said "false" on every single week the watcher could post.
      protected: /posting-protected/.test(cls),
    });
  }
  return out;
}

/** One resort's live rentals. Returns only what is still bookable. */
export async function rentals(slug, { includeTaken = false, timeoutMs = 30000 } = {}) {
  const url = `${BASE}/resort/${slug}/timeshare-rentals`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'text/html' } });
    if (res.status === 429) throw new Error('RedWeek is rate-limiting us — slow down.');
    if (!res.ok) throw new Error(`RedWeek returned ${res.status} for ${slug}`);
    const all = parseRentals(await res.text(), { slug, ourName: ARUBA[slug] ?? null });
    return includeTaken ? all : all.filter(x => !x.taken);
  } finally { clearTimeout(timer); }
}

/** Every resort we care about, one at a time with a pause. Politeness, not performance. */
export async function sweep(slugs = Object.keys(ARUBA), { pauseMs = 2500, onResort = () => {} } = {}) {
  const found = [];
  let wait = pauseMs;
  for (const slug of slugs) {
    try {
      const list = await rentals(slug);
      found.push(...list);
      onResort(slug, list.length, null);
      wait = pauseMs;                       // it answered; back to the ordinary pace
    } catch (err) {
      onResort(slug, 0, err);
      // Being told to slow down and then carrying on at the same rate is how a watcher gets
      // itself blocked. Each refusal doubles the wait, up to two minutes.
      if (/rate-limit|429/i.test(err.message)) wait = Math.min(wait * 2, 120_000);
    }
    if (slug !== slugs[slugs.length - 1]) await new Promise(r => setTimeout(r, wait));
  }
  return found;
}
