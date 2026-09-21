// Public and entry screens: the landing page, the rules, sign-in, and the invitation.
import { escapeHtml, html, raw, fmtUsd, fmtUsd2, fmtAfl2, fmtPoints, fmtPointsUsd, pointsUsd, fmtDay, fmtPct, initials } from '../core/util.js';
import { VOCAB, tierName } from '../core/vocab.js';
import { splitContribution, tierFor, projectPoints, fromPoints, seatPoints, unitPoints, pointsPerMonth, monthsToAfford } from '../core/money.js';
import { poolGauge, memberCard, ring, tierLadder } from '../ui/pieces.js';
import { sceneSvg, plateHtml, starSvg } from '../ui/art.js';
import { toast, setBusy, sheet, avatar } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { copyText } from '../core/share.js';
import { CATALOG_NAMES } from '../core/store.js';
import { normName } from '../core/names.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
/** One figure in the apparatus face. One figure to a call — never a whole phrase, because .num
 *  does not wrap and a sentence wrapped in it walks straight out of a 358px column. Returns raw
 *  so it can be dropped into an html`` template beside copy that is still escaped. */
const num = (v) => raw(`<b class="num">${escapeHtml(v)}</b>`);
/**
 * Which places we hold a real photograph of, and where each one came from.
 *
 * Victor: "I don't want fantasy rooms only rooms that are actual there… it's all ghost fantasy
 * pictures." Every card used to be a generated SVG of an imaginary beach. Eight of these are
 * photographs from the properties' own sites, fetched with .claude/skills/real-rooms with
 * robots.txt honoured. Four are openly licensed photographs of the property from Wikimedia
 * Commons (CC BY-SA), reached through the category and File pages its robots.txt allows, and
 * their author and licence are shown under the picture — that is the licence's one condition.
 * assets/stays/sources.json records the page, the date and the licence for every one.
 *
 * The other eleven are chains — Marriott, Hilton, IHG, Radisson, Barceló — and every one of them
 * refuses an automated fetch of its own site (Marriott and Hilton answer the page with 403; Hyatt,
 * IHG and Radisson return 403 on robots.txt itself, which is a site saying plainly that it does
 * not want to be read by a script), and nobody has published a licensed photograph of them. We
 * take the no. Working around bot management to take a property's copyrighted photographs would
 * be wrong twice over, and a picture that is not of the place is worse than none.
 *
 * So those eleven get no picture at all — see plateSvg — unless the Desk uploads one it holds the
 * rights to, which arrives on the stay as `photoUrl` and wins over anything bundled here.
 *
 * The set is keyed by the BUNDLED ids, and that was the whole bug: on the live backend every stay
 * is a uuid, so `REAL_PHOTOS.has(stay.id)` was false for every signed-in member and these eight
 * photographs had only ever been seen by strangers on the landing page, who get the bundled
 * catalog. A stay is therefore matched back to its bundled id by name, through the same
 * normalisation stayLike() uses, before the set is consulted.
 */
const REAL_PHOTOS = new Set(['stay_amsterdam', 'stay_boardwalk', 'stay_bucuti', 'stay_divi',
  'stay_manchebo', 'stay_oceanvillas', 'stay_oceanz', 'stay_tamarijn',
  'stay_renaissance', 'stay_marriott', 'stay_riu', 'stay_hyatt']);
/** The credit under each bundled photograph. Mirrors assets/stays/sources.json. */
const PHOTO_CREDITS = Object.freeze({
  stay_amsterdam:  { from: 'amsterdammanor.com', page: 'https://www.amsterdammanor.com/' },
  stay_boardwalk:  { from: 'boardwalkaruba.com', page: 'https://www.boardwalkaruba.com/' },
  stay_bucuti:     { from: 'bucuti.com', page: 'https://www.bucuti.com/' },
  stay_divi:       { from: 'diviandtamarijnaruba.com', page: 'https://www.diviandtamarijnaruba.com/divi-rooms.htm' },
  stay_manchebo:   { from: 'manchebo.com', page: 'https://www.manchebo.com/' },
  stay_oceanvillas:{ from: 'arubaoceanvillas.com', page: 'https://www.arubaoceanvillas.com/' },
  stay_oceanz:     { from: 'oceanzaruba.com', page: 'https://www.oceanzaruba.com/' },
  stay_tamarijn:   { from: 'diviandtamarijnaruba.com', page: 'https://www.diviandtamarijnaruba.com/tamarijn-rooms.htm' },
  stay_renaissance:{ what: 'The resort at night, from the marina side', author: 'Caribiana', license: 'CC BY-SA 4.0',
                     licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', page: 'https://commons.wikimedia.org/wiki/File:Renaissance_resort_Aruba_2.jpg' },
  stay_marriott:   { what: 'The entrance on the Palm Beach strip', author: 'LittleT889', license: 'CC BY-SA 4.0',
                     licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', page: 'https://commons.wikimedia.org/wiki/File:Aruba_Marriott_Resort_%26_Stellaris_Casino.jpg' },
  stay_riu:        { what: 'The pool and the beach, from the hotel’s 12th floor', author: 'Exceptionalimages', license: 'CC BY-SA 4.0',
                     licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', page: 'https://commons.wikimedia.org/wiki/File:RIU_Palace_Antillas_-_Aruba.jpg' },
  stay_hyatt:      { what: 'Palm Beach, photographed from the pier at the Hyatt Regency', author: 'Bjørn Christian Tørrissen', license: 'CC BY-SA 3.0',
                     licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0', page: 'https://commons.wikimedia.org/wiki/File:Palm-Beach-Aruba-2013.JPG' },
});
const SEED_BY_NAME = new Map(Object.entries(CATALOG_NAMES).map(([id, n]) => [normName(n), id]));
/** The bundled catalog id for a stay on either backend: its own id, or the id whose name it carries. */
export const seedIdOf = (stay) => (stay?.id && (REAL_PHOTOS.has(stay.id) || SEED_BY_NAME.has(normName(CATALOG_NAMES[stay.id] || ''))) ? stay.id : SEED_BY_NAME.get(normName(stay?.name)));
/**
 * The beach a place stands on, for the eleven stays with no photograph of their own. Openly
 * licensed photographs of Palm Beach, Eagle Beach and Surfside from Wikimedia Commons (see
 * assets/stays/sources.json → areas). Shown with the beach named ON the picture and the credit
 * under it, so a member never takes the sea for the hotel: a real photograph of the real
 * beach at the door beats a grey plate, and it claims nothing the app has not established.
 */
const AREA_PHOTOS = Object.freeze({
  'Palm Beach': ['palm-a', 'palm-b', 'palm-c'],
  'Eagle Beach': ['eagle-a', 'eagle-b'],
  'Oranjestad': ['oranjestad-a'],
  'Noord': ['palm-b'],           // the Courtyard is inland, ten minutes from Palm Beach
});
const AREA_CREDITS = Object.freeze({
  'palm-a': { area: 'Palm Beach', what: 'Palm Beach, the beach at the door', author: 'Coolcaesar', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', page: 'https://commons.wikimedia.org/wiki/File:Palm_Beach,_Aruba.jpg' },
  'palm-b': { area: 'Palm Beach', what: 'Palapas on Palm Beach, the beach at the door', author: 'Ginelly.Q', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', page: 'https://commons.wikimedia.org/wiki/File:Beach_palapas_in_Palm_beach,_Noord_Aruba_01.jpg' },
  'palm-c': { area: 'Palm Beach', what: 'Palapas on Palm Beach, the beach at the door', author: 'Ginelly.Q', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', page: 'https://commons.wikimedia.org/wiki/File:Beach_palapas_in_Palm_beach,_Noord_Aruba_03.jpg' },
  'eagle-a': { area: 'Eagle Beach', what: 'A fofoti tree on Eagle Beach, the beach at the door', author: 'Rarends297', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', page: 'https://commons.wikimedia.org/wiki/File:Fofoti_-_Eagle_Beach_Aruba_(WoA)_08.jpg' },
  'eagle-b': { area: 'Eagle Beach', what: 'A fofoti tree on Eagle Beach, the beach at the door', author: 'Jason Boldero', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', page: 'https://commons.wikimedia.org/wiki/File:Fofoti_Tree,_Eagle_Beach,_Aruba_(28568601953).jpg' },
  'oranjestad-a': { area: 'Oranjestad', what: 'Surfside Beach in Oranjestad, the beach at the door', author: 'Caribiana', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', page: 'https://commons.wikimedia.org/wiki/File:Surfside_Beach_(Aruba).jpeg' },
});
const hashOf = (str) => [...String(str)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/** The beach photograph a stay falls back to, chosen once per stay so neighbours on the list differ. */
export const areaPhotoFor = (stay) => {
  if (!stay || stay.kind === 'trip') return null;
  const keys = AREA_PHOTOS[stay.area]; if (!keys?.length) return null;
  const key = keys[hashOf(stay.name || stay.id) % keys.length];
  return { key, file: `assets/areas/${key}.jpg`, ...AREA_CREDITS[key] };
};
/** 'own' (the Desk's upload), 'bundled' (a photograph of the place), 'area' (its beach), or null. */
export const photoKind = (stay) => {
  if (!stay) return null;
  if (stay.photoUrl) return 'own';
  const seed = seedIdOf(stay);
  if (seed && REAL_PHOTOS.has(seed)) return 'bundled';
  return areaPhotoFor(stay) ? 'area' : null;
};
export const photoFor = (stay) => {
  if (!stay) return null;
  if (stay.photoUrl) return stay.photoUrl;
  const seed = seedIdOf(stay);
  if (seed && REAL_PHOTOS.has(seed)) return `assets/stays/${seed.replace('stay_', '')}.jpg`;
  return areaPhotoFor(stay)?.file || null;
};

/**
 * The same picture as photoFor, at 400px wide. A plate two to the column renders at about
 * 195 CSS px, so the full-size file is ten times the pixels it can show and ten times the bytes
 * on a phone: the eighteen originals are 3,819 KB against 422 KB as thumbs. The Desk's own
 * upload has no thumb — it is whatever was uploaded — so it falls through unchanged.
 */
export const thumbPhotoFor = (stay) => {
  const f = photoFor(stay);
  const m = f && /^assets\/(stays|areas)\/([^/]+)$/.exec(f);
  return m ? `assets/${m[1]}/thumb/${m[2]}` : f;
};

/**
 * Who the photograph is by and where it came from — as plain text for an image title, and as
 * HTML for the line under the hero. A licensed photograph carries its author and licence, which
 * is what the licence asks; a property's own photograph names the site; the Desk's upload
 * carries the note the Desk wrote. Null when there is no photograph.
 */
export function photoCredit(stay) {
  if (!stay) return null;
  const ext = (href, label) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  if (stay.photoUrl) {
    const note = String(stay.photoNote || '').trim();
    return note ? { text: `Photograph: ${note}`, html: `Photograph: ${escapeHtml(note)}` } : null;
  }
  const seed = seedIdOf(stay);
  const c = seed && REAL_PHOTOS.has(seed) ? PHOTO_CREDITS[seed] : null;
  if (!c) {
    // The beach, not the hotel — said in words, because the licence asks for the credit and the
    // house rule asks for the difference between a picture of the place and a picture near it.
    const a = areaPhotoFor(stay); if (!a) return null;
    return {
      text: `${a.what} — not a photograph of the hotel. Photograph by ${a.author}, ${a.license}, via Wikimedia Commons.`,
      html: `${escapeHtml(a.what)} &mdash; not a photograph of the hotel. Photograph by ${ext(a.page, a.author)}, ${ext(a.licenseUrl, a.license)}, via Wikimedia Commons.`,
    };
  }
  if (c.author) {
    return {
      text: `${c.what}. Photograph by ${c.author}, ${c.license}, via Wikimedia Commons.`,
      html: `${escapeHtml(c.what)}. Photograph by ${ext(c.page, c.author)}, ${ext(c.licenseUrl, c.license)}, via Wikimedia Commons.`,
    };
  }
  return {
    text: `Photograph from the property’s own site, ${c.from}.`,
    html: `Photograph from the property’s own site, ${ext(c.page, c.from)}.`,
  };
}

/** Two letters for the beach, for the square where a place has no photograph of its own. */
export function beachMark(stay) {
  const a = String(stay?.area || '');
  return { 'Palm Beach': 'PB', 'Eagle Beach': 'EB', 'Druif Beach': 'DB', 'Oranjestad': 'OR', 'Malmok': 'MA', 'Savaneta': 'SA', 'Noord': 'NO' }[a]
    || a.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '·';
}
/**
 * A picture of THIS place, or nothing: the Desk's own upload or the bundled licensed photograph.
 * Never a beach photograph — at thumbnail size its "the beach" tag does not fit, and a beach
 * standing in for a hotel at 56px is exactly the picture the house rule forbids.
 */
export function thumbFor(stay) {
  const k = photoKind(stay);
  return k === 'own' || k === 'bundled' ? photoFor(stay) : null;
}

export const stayStrip = (stay) => {
  const d = document.createElement('div');
  const photo = photoFor(stay);
  if (photo) {
    d.className = 'scene photo';
    // The alt says what it is, not what it looks like: a member using a screen reader wants to
    // know this is a picture of the property, not a description of the sea.
    const credit = photoCredit(stay);
    const area = photoKind(stay) === 'area' ? areaPhotoFor(stay) : null;
    d.innerHTML = `<img src="${escapeHtml(photo)}" alt="${escapeHtml(area ? `${area.area}, the beach at ${stay.name}` : stay.name)}"${credit ? ` title="${escapeHtml(credit.text)}"` : ''} loading="lazy" decoding="async">`
      + (area ? `<span class="strip-tag">${escapeHtml(area.area)} · the beach</span>` : '');
    return d;
  }
  // The three trips keep their drawing: there is one of each, they are drawn as the thing people
  // actually go for, and nothing about them repeats down a grid.
  const isTrip = stay?.kind === 'trip';
  d.className = isTrip ? 'scene' : 'scene plate';
  d.innerHTML = isTrip ? sceneSvg(stay) : plateHtml(stay);
  return d;
};

/**
 * Where a week at this place actually comes from. Interval's Getaway inventory is the
 * cheapest most of the time — a Surf Club week at $90 a night against a published $850 — but
 * it is surplus, so it is not always there, and an owner on RedWeek sometimes beats it. Both
 * numbers below were seen on the real sites, on the date shown.
 */
export function sourceLine(stay) {
  const src = stay.sources;
  if (!src) return '';
  const bits = [];
  if (src.interval?.seenUsd) bits.push(`Interval from ${fmtUsd2(src.interval.seenUsd)}`);
  if (src.redweek?.fromUsd) bits.push(`RedWeek from ${fmtUsd2(src.redweek.fromUsd)}`);
  if (!bits.length) return '';
  return `<span class="sourced">${icon('search', { size: 13 })}<span>${escapeHtml(bits.join(' · '))}
    <em>a night, seen ${escapeHtml(fmtDay(src.interval?.seenOn || src.redweek?.seenOn))}</em></span></span>`;
}

/**
 * A stay or trip card, used on the landing page and throughout the catalog.
 *
 * A card has no dates on it, so it shows the cheapest the place ever is and says "from". It
 * used to take a season and quote that season's rate without ever saying which — so the same
 * hotel showed a different number on the landing page and in the catalog, and neither was
 * labelled.
 */
export function stayCard(stay, { store, href = null, footer = '' } = {}) {
  // store.settings, not the defaults. Without it the whole catalog priced itself off
  // DEFAULT_SETTINGS and silently ignored every rate Victor edits in the Desk — so the number
  // on the card and the number in the quote could disagree, which is the one thing a price
  // must never do.
  const per = unitPoints(stay, store?.settings);
  // The dollar the points are worth leads the card, the way a hotel prints a rate; the points
  // stay underneath, in the currency a member spends. pointsPerDollar, not a hardcoded 100, so
  // the card never disagrees with the quote if Victor ever moves the rate.
  const ppd = store?.settings?.pointsPerDollar || 100;
  // A card whose picture is the blank plate already carries the beach, in display type, two
  // centimetres above this line. Saying it twice is the kind of thing that makes a page feel
  // machine-assembled, so the body line drops it and keeps only what the plate does not say.
  const plated = !photoFor(stay) && stay.kind !== 'trip';
  const node = el(`<a class="stay-card" href="${escapeHtml(href || `#/${stay.kind === 'trip' ? 'trips' : 'stays'}/${stay.id}`)}">
      <span class="strip"><span class="duo"></span>${photoFor(stay) || stay.kind === 'trip' ? '' : '<span class="ph-note">no photograph yet</span>'}</span>
      <span class="body">
        <h3>${escapeHtml(stay.name)}</h3>
        <span class="where">${plated ? '' : `${escapeHtml(stay.area)}${stay.country !== 'Aruba' ? `, ${escapeHtml(stay.country)}` : ''}`}${stay.kind === 'trip' ? `${plated ? '' : ' · '}${stay.nights} nights` : plated ? (stay.onSand ? 'On the sand' : 'Across the road') : stay.onSand ? ' · on the sand' : ' · across the road'}</span>
        <span class="price"><b class="num">${escapeHtml(fmtUsd(per / ppd))}</b><small>${escapeHtml(stay.kind === 'trip' ? `a ${stay.cruise ? 'cabin' : 'seat'} · ${fmtPoints(per)}` : `from, a night · ${fmtPoints(per)}`)}</small></span>
        <span class="flags">${stay.house ? '<span class="tag house">Where we stay</span>' : ''}${(stay.features || []).slice(0, stay.house ? 2 : 3).map(f => `<span class="tag">${escapeHtml(f)}</span>`).join('')}</span>
        ${sourceLine(stay)}
        ${footer}
      </span></a>`);
  node.querySelector('.strip').prepend(stayStrip(stay));
  return node;
}

/**
 * A full-bleed photograph between two sections, with a line of type on it.
 *
 * These are atmosphere, not evidence: none of them is a picture of a room the Circle books, and
 * none is captioned as though it were. Lazy below the fold, and the ratio is the one the
 * stylesheet gives every band, so the page does not jump when it loads and no caller can pick
 * a shape of its own.
 */
function band(src, alt, line) {
  return `<figure class="band">
      <img src="assets/${escapeHtml(src)}.jpg" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">
      ${line ? `<figcaption>${escapeHtml(line)}</figcaption>` : ''}
    </figure>`;
}

export function landing({ store, go }) {
  const s = store.settings;
  const t = store.treasury();
  // Signed out on the real backend, row-level security hands this browser nothing — so the
  // seat count is 0 and coverage is unverifiable, neither of which is true. Say what we
  // cannot see instead of publishing a number we did not read.
  const blind = !!store.publicOnly;
  const wrap = el('<div></div>');
  const featured = ['stay_oceanclub', 'stay_surfclub', 'stay_divi', 'stay_renaissance', 'trip_japan'].map(id => store.stayLike(id)).filter(Boolean);

  wrap.appendChild(el(`<section class="sec hero-sec">
      <figure class="hero-cover enter">
        <!-- One tall still, and only one: the page is a phone column at every width, so there is
             no wide viewport left for a wide file to belong to. A photograph of the mood, not of
             a room — the rooms are on the stay pages.
             The inline placement is transitional: app.css still carries the placement on the
             .hero-cover picture selector, and the picture element it named is gone. It comes
             off the moment that selector becomes .hero-cover img. Without it the photograph
             takes a second grid row and the promise sits above the picture, not in it. -->
        <img src="assets/hero-tall.jpg" width="880" height="1100" style="grid-area:1/1;min-width:0;min-height:0" alt="A windswept fofoti tree leaning over calm water at first light" fetchpriority="high" decoding="async">
        <figcaption class="on"><div class="wrap">
          <h1 style="max-width:16ch">A private travel circle <em class="ac">in Aruba</em>.</h1>
          <p class="lede" style="margin-top:14px">Put in a hundred dollars a month. Take it out as hotel, at cost, with people you know.</p>
          <!-- The masthead pairing: one filled action and one link-rule beside it, on one line.
               At 390 the column inside the photograph is 358px, and the two labels the spec
               settled on measure 174 + 16 + 141 — they fit with room to spare only without a
               glyph in the button. With the key icon the button was 203 and the pair came to
               360, two pixels over, so .row wrapped and the button sat alone with 156px of
               hero beside it. The words are the invitation; the key was decoration. -->
          <div class="row">
            <a class="btn" href="#/sign-in">I have an invitation</a>
            <a class="link-rule" href="#/rules">How the Circle works</a>
          </div>
        </div></figcaption>
      </figure>
      <div class="wrap"><p class="hero-credit enter" style="--d:120ms">${icon('mapPin', { size: 14 })}The west coast — every place on the list is on this water or ten minutes from it.</p>
      <div class="hero-gauge enter" style="--d:180ms">
        <div id="gauge-slot">${blind ? `<p class="eyebrow">${icon('shield', { size: 14 })}Proof of reserves</p>
          <p class="small muted" style="margin-top:4px">Every point is backed by money in a Reserve account that is checked against the bank
          and published inside the Circle. Sign in to see the current figure.</p>` : ''}</div>
        <div class="hero-facts">
          <div><p class="eyebrow">${icon('users', { size: 14 })}Seats</p>
            <p>${blind ? `<b class="num">${s.memberCap}</b> in all · by invitation only` : `<b class="num">${escapeHtml(String(store.activeMembers().length))}</b> of <b class="num">${s.memberCap}</b> taken · by invitation only`}</p></div>
          <div><p class="eyebrow">${icon('bed', { size: 14 })}On the list</p>
            <p>${(() => {
              const places = store.stays.filter(x => x.kind !== 'trip' && x.active !== false).length;
              const cruises = store.stays.filter(x => x.kind === 'trip' && x.cruise && x.active !== false).length;
              const trips = store.stays.filter(x => x.kind === 'trip' && !x.cruise && x.active !== false).length;
              return [`<b class="num">${places}</b> places`, cruises ? `<b class="num">${cruises}</b> cruise${cruises === 1 ? '' : 's'}` : '', trips ? `<b class="num">${trips}</b> trip${trips === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
            })()}</p></div>
        </div>
      </div>
    </div></section>`));

  if (!blind) wrap.querySelector('#gauge-slot').appendChild(poolGauge({ coverage: t.coverage, reserveUsd: t.reserveUsd, outstandingPoints: t.outstandingPoints, verifiedAt: t.verified?.at, verifiedVarianceUsd: t.verifiedVarianceUsd, liabilityUsd: t.liabilityUsd, configured: t.accountsConfigured, size: 'full' }));

  wrap.appendChild(el(`<section class="sec statement"><div class="wrap">
      <p>This is not a business, and it is not open to the public.
        <span>Every Insider is someone Victor or Ian knows, and you are here because one of them asked you.</span></p>
    </div></section>`));

  // Horizon — the dream, before the ledger
  const horizon = el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><h2>Where the points go</h2>
      <p>The best deals on the market at the places on the island the Circle can get, and the cruises and trips Victor and Ian put together. Every price is the Circle’s all-in rate — taxes, levies and resort fees included.</p>
      <p class="small muted" style="margin-top:8px">These are where we actually end up. See a deal, ask Victor, he books it in your name — nobody books anything themselves.</p>
      <a class="link-rule" href="${blind ? '#/sign-in' : '#/stays'}">${blind ? 'Sign in to see them all' : 'See what is open'}</a></div>
      <div class="horizon" id="horizon"></div></div></section>`);
  const hz = horizon.querySelector('#horizon');
  // Signed out, every one of these opened a password form with no explanation — someone was
  // browsing hotels and got a login screen. Send them somewhere deliberate instead.
  featured.forEach(st => hz.appendChild(stayCard(st, { store, href: blind ? '#/sign-in' : null })));
  wrap.appendChild(horizon);

  // Where the money goes. Nothing is taken on the way in; the Circle is paid on the room.
  // This said the same thing three times — a Split bar with one segment (a chart of 100%), then
  // "Points credited 15,450" and "Into the Reserve $150.00" beside it, then a ledger carrying a
  // $0.00 row for a share that is no longer taken here, then "104.9% of everything you sent",
  // which reads like a scam even though it is true. 1,386px of phone for one number.
  // One figure, one sentence under it, one line about the year. The bar went with the 15%.
  const split = el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><h2>Every dollar backs a point</h2>
      <p>Nothing is taken when you put money in. The Circle is paid <b class="num">15%</b> when you spend points on a room — for the thing it actually does, which is find the room and book it.</p></div>
      <div class="panel">
        <div class="choices" id="tier-choices" role="group" aria-label="Choose a monthly contribution"></div>
        <div id="split-figures" style="margin-top:20px"></div>
      </div></div></section>`);
  wrap.appendChild(split);
  let chosen = 150;
  const choices = split.querySelector('#tier-choices');
  const draw = () => {
    choices.innerHTML = s.tiers.map(t2 => `<button type="button" class="choice" aria-pressed="${t2.monthlyUsd === chosen}" data-amt="${t2.monthlyUsd}">
        <span class="amt">$${t2.monthlyUsd}</span><span class="tier">${escapeHtml(tierName(t2.monthlyUsd))}</span></button>`).join('');
    const tier = tierFor(s, chosen);
    const sp = splitContribution(chosen, s, tier);
    const p12 = projectPoints(chosen, 12, s);
    // store.settings, not the defaults — the same trap the stay cards fell into. Without it
    // these nights are priced off DEFAULT_SETTINGS and quietly ignore Victor's own rates.
    const nights = (id) => { const st = store.stayLike(id); if (!st) return null;
      const per = fromPoints(st, s); return per > 0 ? { n: Math.floor(p12.points / per), name: st.name } : null; };
    const villa = nights('stay_surfclub'), ai = nights('stay_divi');
    const both = [villa && `about <b class="num">${villa.n}</b> nights in a villa at ${escapeHtml(villa.name)}`,
                  ai && `<b class="num">${ai.n}</b> all-inclusive at ${escapeHtml(ai.name)}`].filter(Boolean);
    split.querySelector('#split-figures').innerHTML = `
      <p class="eyebrow">${escapeHtml(fmtUsd2(chosen))} a month becomes</p>
      <p class="big-figure num">${escapeHtml(fmtPoints(sp.points))}</p>
      <p class="lede" style="margin-top:4px"><b class="num">${escapeHtml(fmtUsd2(sp.points / s.pointsPerDollar))}</b> of hotel, every month.</p>
      <p class="small muted" style="margin-top:14px">All <b class="num">${escapeHtml(fmtUsd2(sp.backingUsd))}</b> of it sits in the Reserve, in a named account, until you spend it on a room${sp.bonusPoints ? ` — and the <b class="num">${escapeHtml(fmtPoints(sp.bonusPoints))}</b> on top is the <b class="num">${Math.round(tier.bonusRate * 100)}%</b> ${escapeHtml(tierName(chosen))} bonus, which the Circle funds out of its own share` : ''}.</p>
      <p class="small" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--hairline-soft)">
        <b>After a year,</b> <b class="num">${escapeHtml(fmtPoints(p12.points))}</b> &mdash; <b class="num">${escapeHtml(fmtUsd2(p12.points / s.pointsPerDollar))}</b> of hotel for the <b class="num">${escapeHtml(fmtUsd2(p12.paidUsd))}</b> you sent, the 6- and 12-month streak bonuses included.${both.length ? ` That is ${both.join(', or ')}.` : ''}</p>`;
  };
  draw();
  choices.addEventListener('click', (e) => { const b = e.target.closest('[data-amt]'); if (!b) return; chosen = Number(b.dataset.amt); draw(); });

  // What each level is for
  wrap.appendChild(el(band('band-circle', 'A long table laid for a dozen people, seen from above',
    'Forty seats. Everyone comes on everything.')));
  // How long each level takes to reach three things you can actually book. A difference you can
  // book beats a difference you have to work out, so these sit in the same grid as the perks
  // rather than in a bullet list under three repeated panels.
  const ladderTiers = [...s.tiers].sort((a, b) => a.monthlyUsd - b.monthlyUsd);
  const waitRow = (k, sub, points) => (points > 0 ? [{
    k, sub, vals: ladderTiers.map(t => `<b>${monthsToAfford(s, points, t.monthlyUsd)}</b><span class="lad-sub">months</span>`),
  }] : []);
  const aruba = store.stayLike('stay_amsterdam'), villa = store.stayLike('stay_surfclub'), trip = store.stayLike('trip_samana');
  // A Surf Club villa sleeps eight and rents by the week; four of you chipping in is the real number.
  // Any of these can come back empty on a catalog that has been edited — a missing place costs
  // its own row, never the section.
  const waitRows = [
    ...waitRow('3 nights at Amsterdam Manor', 'at its cheapest, all in', aruba ? fromPoints(aruba, s) * 3 : 0),
    ...waitRow('A week in a Surf Club villa', 'your quarter of it, four of you chipping in',
      villa ? Math.round(fromPoints(villa, s) * (villa.minNights || 7) / 4) : 0),
    ...waitRow('A seat on the Samaná week', 'flights not included', trip ? seatPoints(trip, s) : 0),
  ];
  wrap.appendChild(el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><h2>Everyone comes on everything</h2>
      <p>No level shuts anyone out of a stay or a trip. A level changes how fast the points build and how far in front of everyone else you stand — that is the whole of it.</p></div>
      ${tierLadder(s, { rows: waitRows })}
      <p class="small muted" style="margin-top:16px">Move between levels any month; it starts on your next contribution and nothing you already hold changes. Short of a trip you want? Ask for it anyway — Victor quotes it and you accept when the points are there, or you close the gap with a cash top-up.</p>
      </div></section>`));

  // How a contribution becomes a stay
  wrap.appendChild(el(band('band-how', 'Stone steps descending to still water at first light',
    'Four steps, in order, every time.')));
  // Four panels of forty words each, side by side on a desktop and stacked into 688px of
  // phone, to say four things that are one sentence each. They are four lines now.
  wrap.appendChild(el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><h2>How a contribution becomes a stay</h2></div>
      <ol class="steps">
        <li><b>You send the transfer</b><span>To the Reserve account with your reference, then tap “I sent it”. No points yet.</span></li>
        <li><b>Vishnu confirms it landed</b><span>He matches the reference on the bank statement, and your points are minted and dated the moment he does.</span></li>
        <li><b>Victor quotes the stay</b><span>You ask for dates; he comes back with an all-in price in points, locked for three days.</span></li>
        <li><b>The Circle pays the hotel</b><span>Your points burn, the Reserve pays, and Ian sends you the confirmation.</span></li>
      </ol></div></section>`));

  // What a night costs — read off the catalog, at render time, every time.
  //
  // This was six hand-typed bands with two season columns. Measured against the catalog it
  // sits twelve lines away from, all twelve published ranges were wrong and 27 of the 46 named
  // hotels fell outside the band their own name was printed in — the villa row overstated the
  // Circle's own summer rate by 65%. It also carried the sentence "Published once a year and
  // never changed after you have booked against them", which made a wrong number a promise.
  //
  // A price that is typed in two places drifts. This one is computed from store.stays, so it
  // cannot: if Victor edits a rate in the Desk, this table has already changed.
  const priced = store.arubaStays()
    .map(st => ({ st, from: fromPoints(st, s) }))
    .filter(x => x.from > 0)
    .sort((a, b) => a.from - b.from);
  if (priced.length) {
    const cheapest = priced[0], dearest = priced[priced.length - 1];
    const show = priced.length > 8
      ? [...priced.slice(0, 4), ...priced.slice(-4)]
      : priced;
    // The eight rows stack into cards on a phone and cost 1,527px — two full screens — to say
    // something the sentence under them already said: prices run from here to here. So the
    // range leads, with the figures in it, and the table sits behind a disclosure. Each row
    // carries its own labels in the cells (data-k), so the head row is furniture the phone
    // never draws — it is not rendered at all.
    const costs = el(`<section class="sec"><div class="wrap">
      <div class="sec-head tight"><h2>What a night costs</h2>
      <p>From <b class="num">${escapeHtml(fmtUsd2(cheapest.from / s.pointsPerDollar))}</b> a night at ${escapeHtml(cheapest.st.name)} to <b class="num">${escapeHtml(fmtUsd2(dearest.from / s.pointsPerDollar))}</b> at ${escapeHtml(dearest.st.name)} — the Circle&rsquo;s all-in rate, with the room, taxes, the service charge and the resort fee already in it. Nothing is added later.</p>
      <a class="link-rule" href="${blind ? '#/sign-in' : '#/stays'}"><span>${blind ? 'Sign in to see all' : 'See all'} <b class="num">${priced.length}</b></span></a></div>

      <details class="fineprint" id="cost-table"><summary><span>${priced.length > 8 ? `The four cheapest and the four dearest of <b class="num">${priced.length}</b>` : `All <b class="num">${priced.length}</b>, cheapest first`}</span></summary>
        <div class="tablewrap" style="margin-top:10px"><table class="bands">
          <caption class="sr-only">The cheapest and dearest places on the list, from-price per night</caption>
          <tbody>${show.map(({ st, from }) => `<tr>
            <td><b>${escapeHtml(st.name)}</b><br><span class="small muted">${escapeHtml(st.area)}${st.onSand ? ' · on the sand' : ''}</span></td>
            <td class="num" data-k="From">${escapeHtml(fmtPoints(from))}</td>
            <td class="num" data-k="In dollars">${escapeHtml(fmtUsd2(from / s.pointsPerDollar))}</td></tr>`).join('')}</tbody>
        </table></div>
      </details>

      <p class="small muted" style="margin-top:12px">A night costs more at Christmas and in the busy months, the way it does on every booking site — you never have to work out which is which. Give Victor your dates and he prices those exact nights, and that quote is what you accept.</p>
      </div></section>`);
    wrap.appendChild(costs);
  }

  // The people. Found by the job they do, not by a seed id — on the real backend every row
  // has a uuid, so looking them up as mem_victor rendered an empty grid. And a signed-out
  // visitor can read no members at all, so the three jobs are described either way: those
  // are facts about how the Circle is arranged, not anybody's personal data.
  const JOBS = [
    { role: 'planner', job: 'The Desk', name: 'Victor Rosario', what: html`Finds the deals, plans the trips, and quotes every request within ${num(Math.min(...s.tiers.map(t => t.slaHours ?? s.slaHours)))} to ${num(Math.max(...s.tiers.map(t => t.slaHours ?? s.slaHours)))} hours, depending on your level.` },
    { role: 'comms', job: 'The Voice', name: 'Ian Hekman', what: html`Every message from the Circle comes from one person, so nobody is chased in a group chat.` },
    { role: 'treasurer', job: 'The Banker', name: 'Vishnu', what: html`Holds the money and confirms every transfer. Points are minted only by him, and every line in your ledger carries his name and the time.` },
  ];
  wrap.appendChild(el(band('band-pool', 'Salt pans from above, pale shapes divided by thin channels',
    'The Reserve, checked against the bank every month.')));
  wrap.appendChild(el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><h2>Three people, three jobs</h2></div>
      <div class="jobs">${JOBS.map(({ role, job, what, name }) => {
        // A signed-out browser is handed no members at all by row-level security, so looking
        // the officer up returned nothing and the section that exists to prove real people
        // hold the money printed "not yet filled" three times — on the live site, to every
        // stranger. The three names are already in prose twice on this same page, so naming
        // them here exposes nothing and is simply true.
        const m = store.people().find(x => (x.roles || []).includes(role) && x.status !== 'left');
        return `<div class="job">
          <h3>${escapeHtml(job)}</h3>
          <p class="job-who">${m ? `${avatar(m, 30)}<span>${escapeHtml(m.name)}</span>`
            : `<span>${escapeHtml(name)}</span>`}</p>
          <p class="small muted">${what}</p></div>`;
      }).join('')}</div>
      </div></section>`));

  // Rules in six sentences
  wrap.appendChild(el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><h2>What you are agreeing to</h2></div>
      <ol class="stack" style="padding-left:1.2em">
        <li><b class="num">100</b> points = <b class="num">$1.00</b> of hotel. That never changes, in either direction.</li>
        <li>The only fee is <b class="num">15%</b>, charged when you spend points on a room and never when you put money in. It is on the quote before you accept it, and there are no special assessments.</li>
        <li>Points appear only when Vishnu confirms the money arrived, and they never expire while you are active.</li>
        <li>Every Insider can ask for every stay and every trip. Pause for up to three months a year with one tap.</li>
        <li>Leave whenever you like: unused base points come back at face value, minus <b class="num">${escapeHtml(fmtUsd2(s.exitFeeUsd))}</b>, after a 12-month window.</li>
      </ol>
      <p class="small muted" style="margin-top:18px">That is five of twelve. Version <b class="num">${escapeHtml(s.rulesVersion)}</b>, ${escapeHtml(fmtDay(s.rulesDate))}.</p>
      <a class="link-rule" href="#/rules">Read all of them</a>
      <p class="small muted" style="margin-top:10px">${escapeHtml(VOCAB.legal)}</p>
      </div></section>`));
  return wrap;
}

export function rules({ store }) {
  const s = store.settings;
  // The clauses carry their own markup so that every figure in them sits in the mono face, one
  // figure to a <b class="num"> and never a whole phrase. They used to be plain strings that the
  // renderer escaped, which printed "100 points = $1.00", "15%", "24 months" and "$25" in bold
  // sans — twelve figures in the reading face, and the page's first mono fact three screens down.
  // `html` escapes everything interpolated into it, so the settings values below are as safe as
  // escapeHtml() left them; only the sentences written here are trusted, and they are ours.
  const tiers = (fn) => raw(s.tiers.map(fn).join(', '));
  const clauses = [
    [html`${num(100)} points = ${num('$1.00')} of backing, fixed forever.`, html`The value of a point never changes, in either direction. Every balance in the app prints the dollar beside it so you never have to work it out.`],
    [html`The only fee is the Circle’s ${num('15%')} share.`, html`It is charged when you spend points on a room, not when you put money in, and the quote shows it before you accept. Every dollar you contribute backs a point from the day it lands. The Circle never levies special assessments.`],
    [html`Points are minted only when the Banker confirms money has arrived.`, html`Marking a transfer as sent creates a pending row and nothing else. Vishnu matches it against the bank statement and confirms; the ledger line carries his name and the timestamp.`],
    [html`Base points never expire while you are active or paused.`, html`Promotional points — tier bonus, streak and founding — expire ${num(24)} months after they are issued, which shows on your statement as an expiry line and returns the matching cash to Operating.`],
    [html`No borrowing.`, html`If a quote is more than your available points, you pay the difference as a top-up to the Banker at face value — the ${num('15%')} is already inside the quote, so it is not charged twice. Nothing is ever booked on credit.`],
    [html`A quote is locked for ${num(72)} hours; accepting it commits your points.`, html`Open requests at a time: ${tiers(t => html`${num(t.holds)} for ${tierName(t.monthlyUsd)}`)}. An expired quote releases the points automatically.`],
    [html`Cancellation mirrors the hotel’s terms, in points.`, html`Whatever the hotel charges us is what comes off your points; the rest is restored. Any refund the hotel sends returns to the Reserve and re-credits points — never cash. You get a reminder seven days and two days before the hotel’s deadline.`],
    [html`Pause for up to three consecutive months per year, with one tap.`, html`Your streak freezes rather than resets and your points stay fully usable. Fifteen days late without contact auto-pauses you; three unpaid months makes you inactive, and you keep every point.`],
    [html`Leave any time.`, html`Thirty days’ notice, twelve months to use what you hold, then base points are refunded at face value minus ${num(`$${s.exitFeeUsd}`)} from the Reserve within thirty days — at the full dollar, because nothing was taken on the way in. Promotional points are forfeited. In hardship or death the refund is immediate, at face value, with no fee.`],
    [html`Household is always covered; guests use a certificate.`, html`Your partner and children travel on your points with no extra charge. Non-members use a guest certificate (${tiers(t => html`${num(t.guestCerts)} for ${tierName(t.monthlyUsd)}`)} a year) or pay the same negotiated rate in cash.`],
    [html`Points and bookings cannot be sold, transferred or advertised.`, html`This is a private circle of friends. Reselling a booking ends a membership and returns the backing.`],
    [html`The Circle is by invitation only.`, html`Every Insider is invited by someone already in and the club is capped at ${num(s.memberCap)} seats. It is not advertised, there is no public sign-up, and nobody joins who Victor or Ian does not know. If you leave and want to come back later, you come back the same way.`],
    [html`Every Insider can ask for every stay and every trip.`, html`No level is a wall. What a level changes is how fast your points build — ${tiers(t => html`${num(fmtUsd2(t.monthlyUsd))} earns ${num(fmtPoints(pointsPerMonth(s, t.monthlyUsd)))} a month`)} — and the perks: open requests at a time, how far ahead you can book, guest passes, and first look at a new trip. Move between levels any month; it takes effect on your next contribution and nothing you already hold changes.`],
    [html`You can chip in to each other’s bookings.`, html`Open a booking to the Circle and anyone can add their own points to it — for a room you are sharing, or as a gift. Their points are committed the moment they chip in and released if it falls through; when the hotel is paid, each person’s share burns from their own ledger. Nobody can chip in more than the booking still needs, and points never change hands as points.`],
    [html`${VOCAB.clubName} is a private members’ club for prepaid, club-arranged travel.`, html`Points are not deposits and not an investment. There is no interest, no return, and no payout that depends on new members joining: your points are backed by your own money, held in the Reserve.`],
  ];
  // No band over the version line: the rules are read, not looked at, and a photograph above the
  // first sentence costs a phone half a screen before the page says anything.
  const wrap = el(`<div>
    <section class="sec"><div class="wrap">
      <p class="eyebrow">Version ${escapeHtml(s.rulesVersion)} · ${escapeHtml(fmtDay(s.rulesDate))}</p>
      <h1>How the Circle works</h1>
      <p class="lede" style="margin-top:12px">In plain words, and nothing here changes without telling you first.</p>
      <ol class="stack" style="margin-top:26px;padding-left:1.2em">
        ${clauses.map(([t, b]) => `<li style="margin-bottom:16px"><b>${t}</b><p class="small muted" style="margin-top:5px">${b}</p></li>`).join('')}
      </ol>
      <div class="notice" style="margin-top:24px"><b>The two accounts</b>
        <p class="small rules-prose">The <b>Reserve</b> holds every dollar contributed, so a point is backed by a full dollar from the day it is minted; nothing leaves it except to pay a hotel for a confirmed booking or to refund someone who leaves. <b>Operating</b> is paid its <b class="num">15%</b> out of each booking and funds the bonuses. Coverage is the Reserve divided by everything the Circle owes in points, and it is on <a href="#/pool">the Pool page</a> for everyone to see.</p></div>
      <p class="small muted" style="margin-top:20px">${escapeHtml(VOCAB.legal)} An Aruban accountant should review these rules before the first real contribution.</p>
    </div></section></div>`);
  return wrap;
}

export function signIn({ store, go, refresh }) {
  // The form is the page: no picture above it, no column beside it. A phone opens this screen to
  // type two things, and the keyboard takes the bottom half the moment it does.
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <h1>Sign in</h1>
      <p class="lede" style="margin-top:10px">Victor or Ian gives you a username and a password.</p>

      <form id="pw" class="panel" style="margin-top:20px" autocomplete="on">
        <label class="field"><span>Username</span>
          <input type="text" name="username" autocomplete="username" autocapitalize="none"
                 autocorrect="off" enterkeyhint="next" spellcheck="false" placeholder="victor" required autofocus></label>
        <label class="field"><span>Password</span>
          <span class="pw-wrap"><input type="password" name="password" autocomplete="current-password" enterkeyhint="go" required>
          <button type="button" class="pw-peek" id="peek" aria-label="Show the password">${icon('eye', { size: 18 })}</button></span></label>
        <button class="btn block" type="submit" style="margin-top:4px">${icon('unlock', { size: 18 })}Sign in</button>
      </form>

      <p class="small muted" style="margin-top:16px">Forgotten it? Ask Victor or Ian — nobody, them
        included, can read the one you have now.</p>
      <a class="link-rule" href="#/rules">How the Circle works</a>
    </div></section></div>`);

  const form = wrap.querySelector('#pw');
  wrap.querySelector('#peek').addEventListener('click', () => {
    const i = form.password;
    i.type = i.type === 'password' ? 'text' : 'password';
    wrap.querySelector('#peek').innerHTML = icon(i.type === 'password' ? 'eye' : 'x', { size: 18 });
    i.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const username = form.username.value.trim().toLowerCase();
    setBusy(btn, true, 'Signing in…');
    try {
      await store.signInWithUsername(username, form.password.value);
      if (store.me?.mustChangePassword) { go('/set-password'); return; }
      toast(`${VOCAB.pap.welcome[0]}, ${store.me?.name.split(' ')[0] || ''}.`, { kind: 'good' });
      go('/home');
    } catch (err) {
      setBusy(btn, false);
      form.password.value = '';
      form.password.focus();
      toast(err.message, { kind: 'bad', timeout: 6000 });
    }
  });
  return wrap;
}

export function setPassword({ store, go }) {
  const live = store.mode === 'supabase';
  const forced = !!store.me?.mustChangePassword;
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <h1>${forced ? 'Choose your own password' : 'Choose a password'}</h1>
      <p class="lede" style="margin-top:10px">${forced
        ? 'The one you just used was handed to you. Pick your own now — it is the last thing between your points and anyone else.'
        : 'Twelve characters at least. Longer beats complicated — three unrelated words will outlast anything with a $ in it.'}</p>
      <form id="set" class="panel" style="margin-top:20px">
        <label class="field"><span>New password</span>
          <input type="password" name="password" autocomplete="new-password" enterkeyhint="next" minlength="12" required autofocus></label>
        <div id="meter" class="pw-meter" aria-live="polite"></div>
        <label class="field"><span>And again</span>
          <input type="password" name="again" autocomplete="new-password" enterkeyhint="done" minlength="12" required></label>
        <button class="btn block" type="submit">Set it</button>
        <button type="button" class="link-rule" id="gen">Make one up for me</button>
      </form>
      ${live ? '' : '<p class="small muted" style="margin-top:14px">Preview mode: this locks this browser only.</p>'}
    </div></section></div>`);
  const form = wrap.querySelector('#set'), meter = wrap.querySelector('#meter');

  const draw = async () => {
    const { passwordStrength } = await import('../core/passwords.js');
    const s = passwordStrength(form.password.value);
    meter.innerHTML = form.password.value
      ? `<div class="pw-bar"><span style="width:${Math.round(s.score * 100)}%;background:${s.ok ? 'var(--ink)' : 'var(--flag)'}"></span></div>
         <span class="small ${s.ok ? 'muted' : ''}">${escapeHtml(s.label)}</span>` : '';
  };
  form.addEventListener('input', draw);

  wrap.querySelector('#gen').addEventListener('click', async () => {
    const { generatePassword } = await import('../core/passwords.js');
    const pw = generatePassword();
    form.password.value = pw; form.again.value = pw;
    form.password.type = 'text';
    await draw();
    const ok = await copyText(pw);
    toast(ok ? 'Made one up and copied it. Save it before you set it.' : `Your password: ${pw}`, { kind: 'good', timeout: 8000 });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    if (form.password.value !== form.again.value) { toast('Those two do not match.', { kind: 'bad' }); form.again.focus(); return; }
    setBusy(btn, true, 'Saving…');
    try {
      await store.setPassword(form.password.value);
      toast(forced ? 'That is your password now. Nobody else has it.' : 'Password set. That is the one from now on.', { kind: 'good' });
      go(store.me ? '/home' : '/sign-in');
    } catch (err) { setBusy(btn, false); toast(err.message, { kind: 'bad', timeout: 6000 }); }
  });
  return wrap;
}

/** The invitation: choose a tier, watch the card mint, accept the rules. */
/** Sixteen characters somebody can read off one screen and type into another without a mistake:
 *  no O/0, no l/1/I. The same alphabet the Desk's generator uses when it hands out a first login. */
const madeUpPassword = () => {
  const a = 'abcdefghijkmnopqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  return [...crypto.getRandomValues(new Uint8Array(16))].map(b => a[b % a.length]).join('');
};

/** Why a link did not open, in words, with what to do next. Never "invalid" on its own. */
const LINK_REFUSED = {
  unknown: ['That link does not open anything', 'Check you copied the whole line — they are long and a chat app can cut one. Otherwise ask for a new one.'],
  revoked: ['That link has been turned off', 'It was working and someone closed it. Ask Victor or Ian for a fresh one.'],
  expired: ['That link has expired', 'Ask Victor or Ian for a fresh one — it takes them a moment.'],
  used_up: ['That link has been used', 'It was meant for one person. Ask Victor or Ian for one of your own.'],
  claimed: ['You are already in', 'This invitation has been used and there is an account waiting for you. Sign in with the username you chose; if you cannot remember it, ask Victor or Ian.'],
  full: ['Every seat is taken', 'The Circle is capped and all of them are spoken for. Ask Victor to tell you when one opens.'],
};

/**
 * The sign-up link, end to end: read the token, show what the club is, take a seat.
 *
 * Async because the token means nothing until the database has looked at it, and join() has to
 * return a node straight away. Everything it prints comes from signup_link_info — nothing about
 * the club is baked in here, so a link cannot promise a rate or a seat count that has moved.
 */
async function joinByLink(wrap, { store, token, go }) {
  const said = (title, body, cta = true) => {
    wrap.innerHTML = `<p class="eyebrow">${icon('key', { size: 14 })}Your invitation</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="lede" style="margin-top:14px">${escapeHtml(body)}</p>
      ${cta ? `<p class="row" style="margin-top:22px"><a class="btn ghost" href="#/">See what the Circle is</a>
        <a class="link-rule" href="#/sign-in">I already have a login</a></p>` : ''}`;
  };
  let info;
  try { info = await store.signupLinkInfo(token); }
  catch { return said('The Circle is not answering', 'That is our server, not your link. Try again in a minute — the link keeps working.'); }
  if (!info?.ok) { const [t, b] = LINK_REFUSED[info?.reason] || LINK_REFUSED.unknown; return said(t, b); }

  // A settings-shaped object so the money is worked out by the same functions every other screen
  // uses. Writing the arithmetic again here is how the join page ends up quoting a rate the club
  // stopped using.
  const s2 = { pointsPerDollar: info.pointsPerDollar, serviceRate: info.serviceRate, tiers: info.tiers,
               foundingSeats: info.foundingSeats, memberCap: info.memberCap, exitFeeUsd: info.exitFeeUsd };
  const tiers = (info.tiers || []).slice().sort((a, b) => a.monthlyUsd - b.monthlyUsd);
  // An invitation written FOR someone on the list already knows their name and the level Victor
  // put them down for, so it greets them instead of asking who they are — and their level is the
  // starting point rather than the middle option.
  const forMember = !!info.forName;
  const state = { monthlyUsd: info.forMonthlyUsd ?? tiers[1]?.monthlyUsd ?? tiers[0]?.monthlyUsd ?? 100,
                  show: false, name: info.forName || '' };

  // Picking a level redraws the panel, which rebuilds the form — so whatever has been typed is
  // read back into state first. Without this, choosing a level after filling your name silently
  // emptied both fields and the submit button then did nothing, because `required` blocks a
  // submit without saying so.
  const capture = () => {
    const f = wrap.querySelector('#take-seat');
    if (!f) return;
    state.name = f.name.value; state.username = f.username.value;
    state.password = f.password.value; state.phone = f.phone.value;
  };
  const draw = () => {
    const tier = tierFor(s2, state.monthlyUsd);
    const sp = splitContribution(state.monthlyUsd, s2, tier);
    wrap.innerHTML = `
      <p class="eyebrow">${icon('key', { size: 14 })}${info.invitedBy ? `An invitation from ${escapeHtml(info.invitedBy)}` : 'Your invitation'}</p>
      <h1>${forMember ? `${escapeHtml(String(info.forName).split(' ')[0])}, join ${escapeHtml(info.clubName)}`
                       : `Join ${escapeHtml(info.clubName)}`}</h1>
      <p class="lede" style="margin-top:12px">Put in a hundred dollars a month. Take it out as hotel, at cost,
        with people you know. <b class="num">${info.seatsTaken}</b> of <b class="num">${info.memberCap}</b> seats taken.
        ${info.wouldBeFounding ? 'You would be a Founding Insider — it stays on your card for good.' : ''}</p>

      <div class="panel" style="margin-top:20px">
        <h2>What you are joining</h2>
        <p class="small" style="margin-top:8px">A private travel club in Aruba. Everyone puts in the same way every month,
          the money sits in a named Reserve account, and it buys hotel weeks at what the club pays rather than what a
          hotel asks. You do not book anything yourself — you ask, Victor prices it, and he books it in your name.</p>
        <p class="small" style="margin-top:10px">Nothing is taken on the way in. The Circle is paid
          <b class="num">${fmtPct(info.serviceRate)}</b> when you spend points on a room — for the thing it actually does,
          which is find the room and book it. Leave any time: unused base points come back at face value minus
          <b class="num">${fmtUsd(info.exitFeeUsd)}</b> after a twelve-month window.</p>
        <p class="small muted" style="margin-top:10px">Points are not deposits and not an investment. There is no interest,
          no return, and no payout that depends on anyone else joining.</p>
      </div>

      <div class="panel">
        <h2>Pick your level</h2>
        <p class="small muted" style="margin-top:6px">No level shuts you out of anything. It changes how fast the points
          build, and how far in front you stand when something good comes up.</p>
        <div class="segmented even" role="group" aria-label="A month costs">
          ${tiers.map(t => `<button type="button" data-tier="${t.monthlyUsd}"
            aria-pressed="${t.monthlyUsd === state.monthlyUsd}"><b class="num">${fmtUsd(t.monthlyUsd)}</b>
            ${escapeHtml(tierName(t.monthlyUsd))}</button>`).join('')}
        </div>
        <p class="dateline" style="margin-top:12px"><b class="num">${fmtUsd2(state.monthlyUsd)}</b> a month becomes
          <b class="num">${fmtPoints(sp.points)}</b> — <b class="num">${pointsUsd(sp.points, info.pointsPerDollar)}</b> of hotel, every month.</p>
      </div>

      <form class="panel" id="take-seat">
        <h2>Take your seat</h2>
        ${forMember ? `<p class="small muted" style="margin-top:12px">You are on the list as
            <b>${escapeHtml(info.forName)}</b>. Choose how you sign in and you are through.</p>
          <input name="name" type="hidden" value="${escapeHtml(info.forName)}">`
        : `<label class="field" style="margin-top:12px"><span>Your name</span>
          <input name="name" type="text" autocomplete="name" required maxlength="60" value="${escapeHtml(state.name || '')}">
          <span class="hint">As it should read on your card.</span></label>`}
        <label class="field"><span>Choose a username</span>
          <input name="username" type="text" autocomplete="username" autocapitalize="none" autocorrect="off"
                 spellcheck="false" required maxlength="30" placeholder="marcus" value="${escapeHtml(state.username || '')}">
          <span class="hint">How you sign in. Letters and numbers, and you may use . _ or -</span></label>
        <label class="field"><span>Choose a password</span>
          <span class="pw-wrap"><input name="password" type="${state.show ? 'text' : 'password'}"
                 autocomplete="new-password" required minlength="12" value="${escapeHtml(state.password || '')}">
            <button type="button" class="pw-peek" id="show-pw" aria-label="${state.show ? 'Hide' : 'Show'} the password">${icon('eye', { size: 18 })}</button></span>
          <span class="hint">Twelve characters at least. <button type="button" class="link-rule" id="make-pw">Make one up for me</button></span></label>
        <label class="field"><span>Phone <span class="muted">— optional</span></span>
          <input name="phone" type="tel" autocomplete="tel" maxlength="30" placeholder="+297" value="${escapeHtml(state.phone || '')}">
          <span class="hint">Only so Victor can reach you about a booking.</span></label>
        <button class="btn block" type="submit" style="margin-top:16px">${icon('key', { size: 17 })}Take my seat</button>
        <p class="small muted" style="margin-top:12px">Taking a seat accepts the club's rules
          (version <b class="num">${escapeHtml(String(info.rulesVersion || ''))}</b>) — you can read them in full
          <a class="link-rule" href="#/rules">here</a> before or after. Nothing is emailed to you at any point.</p>
      </form>`;

    wrap.querySelectorAll('[data-tier]').forEach(b => b.addEventListener('click', () => {
      capture(); state.monthlyUsd = Number(b.dataset.tier); draw();
    }));
    wrap.querySelector('#make-pw').addEventListener('click', () => {
      capture(); state.password = madeUpPassword(); state.show = true; draw();
      wrap.querySelector('#take-seat').password.focus();
    });
    wrap.querySelector('#show-pw').addEventListener('click', () => {
      capture(); state.show = !state.show; draw();
    });
    wrap.querySelector('#take-seat').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button[type=submit]');
      setBusy(btn, true, 'Taking your seat…');
      try {
        await store.joinWithLink(token, {
          name: f.name.value, username: f.username.value, password: f.password.value,
          monthlyUsd: state.monthlyUsd, phone: f.phone.value,
        });
        toast('You are in. Welcome to the Circle.');
        go('/home');
      } catch (err) {
        toast(err.message, { kind: 'bad', timeout: 8000 });
        setBusy(btn, false);
      }
    });
  };
  draw();

  // The moment of being invited, said once, over the page rather than instead of it. Victor asked
  // for this: someone should feel a door was opened for them rather than land on a form.
  //
  // What it deliberately does NOT say, and the reason is not squeamishness — a browser has
  // already called this site malicious once: no countdown, no "claim your seat now", no "you have
  // won", no urgency of any kind. Those are the words a scam page uses, and a page that asks for
  // a password is judged, by people and by filters, on how much it sounds like one. Everything
  // printed here is something the link itself establishes: who wrote it, which club, what a seat is.
  await sheet({ title: 'You are invited', render: (body, close) => {
    body.innerHTML = `
      <p class="sheet-text">${info.invitedBy
        ? `<b>${escapeHtml(info.invitedBy)}</b> has invited you to <b>${escapeHtml(info.clubName)}</b>.`
        : `You have been invited to <b>${escapeHtml(info.clubName)}</b>.`}
        A private travel club in Aruba — <b class="num">${info.memberCap}</b> seats, by invitation only,
        and one of them is being held for you.</p>
      <p class="sheet-text">${info.wouldBeFounding
        ? 'You would be a Founding Insider, and that stays on your card for good. ' : ''}Have a read of what it is,
        pick the level that suits you, and take your seat.</p>
      <div class="sheet-actions"><button type="button" class="btn block" data-ok>Open my invitation</button></div>`;
    body.querySelector('[data-ok]').addEventListener('click', () => close(true));
  } });
}

export function join({ store, params, go }) {
  const s = store.settings;
  // Two kinds of code can arrive here. A SIGN-UP LINK is a 32-character token from signup_links
  // and carries its own seat; an INVITATION is the older per-person code, which only the preview
  // backend can still read (on the real one the invitations table is admin-only, so a signed-out
  // browser learns nothing from it).
  //
  // Routed on the shape of the code rather than on the backend, so the link can be tried out in
  // the preview instead of only existing in production — both stores implement the same two
  // functions, and a rule that is only ever exercised live is a rule nobody has checked.
  //
  // The whole welcome goes ABOVE the form on purpose. Somebody is about to commit $100 a month to
  // a club they have only heard about in a message, so what they are joining is said before they
  // are asked to choose a password, not after.
  if (/^[0-9a-f]{32}$/i.test(String(params.code || '')) || store.mode === 'supabase') {
    const wrap = el(`<div class="wrap sec"><p class="lede">Opening your invitation…</p></div>`);
    joinByLink(wrap, { store, token: params.code, go });
    return wrap;
  }
  const inv = store.invitation(params.code);
  const demo = String(params.code).toUpperCase() === 'DEMO';
  if (!inv && !demo) {
    return el(`<div class="wrap sec"><h1>That invitation is not valid</h1>
      <p class="lede" style="margin-top:12px">It may already have been used, or the link may be incomplete. Ask the Insider who invited you to send it again.</p>
      <p style="margin-top:18px"><a class="btn ghost" href="#/">Back to the start</a></p></div>`);
  }
  const sponsor = store.member(inv?.sponsorId || 'mem_victor');
  const state = { step: 1, monthlyUsd: inv?.monthlyUsd || 150, name: inv?.name || '', email: inv?.email || '', phone: '', standingOrder: false, accepted: false };
  const wrap = el('<div><section class="sec"><div class="wrap" id="join-body"></div></section></div>');
  const body = wrap.querySelector('#join-body');

  const draw = () => {
    const tier = tierFor(s, state.monthlyUsd);
    const sp = splitContribution(state.monthlyUsd, s, tier);
    body.innerHTML = `
      <p class="eyebrow">Invitation from ${escapeHtml(sponsor?.name || 'the Circle')}</p>
      <h1>Join ${escapeHtml(VOCAB.clubName)}</h1>
      <p class="lede" style="margin-top:12px"><b class="num">${escapeHtml(String(store.activeMembers().length))}</b> of <b class="num">${s.memberCap}</b> seats are taken. ${store.activeMembers().length < s.foundingSeats ? 'You would be a Founding Insider — it stays on your card for good.' : ''}</p>
      <div class="stack" style="margin-top:24px">
        <div>
          <div id="card-preview"></div>
          <p class="small muted" style="margin-top:10px">Your tier is a finish, not a different card: ${s.tiers.map(t => `${escapeHtml(tierName(t.monthlyUsd))} <b class="num">$${t.monthlyUsd}</b>`).join(' · ')}.</p>
        </div>
        <div class="panel">
          <h2>Choose your monthly contribution</h2>
          <p class="small muted" style="margin-top:6px">You can change it any month; it takes effect on your next contribution.</p>
          <div class="choices" id="tiers" style="margin-top:14px"></div>
          <p class="big-figure num" style="margin-top:18px">${escapeHtml(fmtPoints(sp.points))}</p>
          <p class="small muted" style="margin-top:4px"><b class="num">${escapeHtml(fmtUsd2(sp.points / s.pointsPerDollar))}</b> of hotel a month${sp.bonusPoints ? `, including the <b class="num">${Math.round(tier.bonusRate * 100)}%</b> ${escapeHtml(tierName(state.monthlyUsd))} bonus the Circle funds out of its own share` : ''}. <b class="num">${escapeHtml(fmtAfl2(state.monthlyUsd, s.awgPerUsd))}</b> at the peg, and every dollar of it backs a point.</p>
        </div>
        <form class="panel" id="details">
          <h2>Your details</h2>
          <label class="field"><span>Name as it should be etched on the card</span><input name="name" required value="${escapeHtml(state.name)}" enterkeyhint="next" autocomplete="name"></label>
          <label class="field"><span>Email</span><input name="email" type="email" required value="${escapeHtml(state.email)}" inputmode="email" enterkeyhint="next" autocomplete="email"></label>
          <label class="field"><span>Phone (for Ian)</span><input name="phone" type="tel" placeholder="+297 000 0000" value="${escapeHtml(state.phone)}" inputmode="tel" enterkeyhint="next" autocomplete="tel"></label>
          <label class="row">
            <input type="checkbox" name="standingOrder" ${state.standingOrder ? 'checked' : ''}>
            <span class="small">I will set a standing order for the 5th of the month. <span class="muted">Aruba Bank and Banco di Caribe both do this free, online.</span></span></label>
          <div class="notice"><b>Where the money goes</b>
            <p class="small">${escapeHtml(s.reserveAccount.bank)} · ${escapeHtml(s.reserveAccount.holder)}<br>
            <span class="num">${escapeHtml(s.reserveAccount.number)}</span></p>
            <p class="small muted">Your reference will be <span class="num">${escapeHtml(VOCAB.refPrefix)}-${escapeHtml((state.name || 'XX').split(/\\s+/).map(x => x[0] || '').join('').slice(0, 2).toUpperCase() || 'XX')}-YYYY-MM</span>. Put it in the description field so Vishnu can match it in seconds.</p></div>
          <label class="row">
            <input type="checkbox" name="accepted" required>
            <span class="small">I have read the rules (version <b class="num">${escapeHtml(s.rulesVersion)}</b>) and I understand that points are prepaid travel credit with the Circle — not a deposit, not an investment.</span></label>
          <a class="link-rule" href="#/rules">Read the rules</a>
          <button class="btn block" type="submit">Mint my card</button>
        </form>
      </div>`;
    body.querySelector('#tiers').innerHTML = s.tiers.map(t => `<button type="button" class="choice" aria-pressed="${t.monthlyUsd === state.monthlyUsd}" data-amt="${t.monthlyUsd}">
        <span class="amt">$${t.monthlyUsd}</span><span class="tier">${escapeHtml(tierName(t.monthlyUsd))}</span></button>`).join('');
    body.querySelector('#card-preview').replaceChildren(memberCard(
      { id: 'preview', name: state.name || 'Your name', monthlyUsd: state.monthlyUsd, joinedAt: new Date().toISOString(), founding: store.activeMembers().length < s.foundingSeats, cardCode: '' },
      { store, flippable: false, compact: true }));
  };
  draw();
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-amt]'); if (!b) return;
    const form = body.querySelector('#details');
    state.name = form.name.value; state.email = form.email.value; state.phone = form.phone.value; state.standingOrder = form.standingOrder.checked;
    state.monthlyUsd = Number(b.dataset.amt); draw();
  });
  body.addEventListener('input', (e) => {
    if (e.target.name === 'name') body.querySelector('#card-preview .c-name').textContent = e.target.value || 'Your name';
  });
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    setBusy(btn, true, 'Minting…');
    try {
      await store.acceptInvitation(params.code, {
        name: f.get('name'), email: f.get('email'), phone: f.get('phone'), monthlyUsd: state.monthlyUsd,
        standingOrder: !!f.get('standingOrder'),
      });
      toast(`${VOCAB.pap.welcome[0]} · ${VOCAB.pap.welcome[1]}. Your card is minted.`, { kind: 'good' });
      go('/home');
    } catch (err) { setBusy(btn, false); toast(err.message, { kind: 'bad', timeout: 6000 }); }
  });
  return wrap;
}

export function denied() {
  return el(`<div class="wrap sec"><h1>That screen belongs to someone else</h1>
    <p class="lede" style="margin-top:12px">Only the Banker, the Desk or an admin can open it. If you think you should have access, ask Ian.</p>
    <p style="margin-top:18px"><a class="btn ghost" href="#/home">Back to your home</a></p></div>`);
}
export function notFound() {
  return el(`<div class="wrap sec"><h1>Nothing here</h1>
    <p class="lede" style="margin-top:12px">That link does not lead anywhere in the app.</p>
    <p style="margin-top:18px"><a class="btn ghost" href="#/home">Back to your home</a></p></div>`);
}
