// What RedWeek is asked, and by whom: the one place the address, the user agent, the list of resorts,
// the challenge test and the robots.txt reading live. Two programs use it and must never disagree —
// redweek.mjs on the primary (a direct read, the fallback) and fetch.mjs on the VPS (the usual one) —
// so there is one copy. No imports, so it runs on the VPS beside fetch.mjs with nothing else installed.
//
// Deployed together: /srv/redweek/rules.mjs and /srv/redweek/fetch.mjs (see the README, "RedWeek from the VPS").

export const BASE = 'https://www.redweek.com';

// A crawler saying who it is, and how to be told to stop, is the polite convention and makes a
// block less likely. Whose address that is, though, is not this file's to decide: set
// WATCH_CONTACT in .env and it goes in, leave it out and nothing personal is sent or published.
export const UA = process.env.WATCH_UA
  || `InnerHotelCircleWatcher/1.0 (private travel club${process.env.WATCH_CONTACT ? `; contact ${process.env.WATCH_CONTACT}` : ''})`;

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

/** The resorts the watcher's pass reads by default (WATCH_ONLY_OUR_STAYS on): the ones with a catalog name. The VPS fetches these. */
export const OUR_SLUGS = Object.freeze(Object.keys(ARUBA).filter((s) => ARUBA[s]));

/** The one page a resort has, and its path. */
export const rentalsPath = (slug) => `/resort/${slug}/timeshare-rentals`;

// What a bot wall looks like when it arrives with a 200. Only believed on a page with no listings
// at all, because a real resort page never shows one of these and a resort with nothing open does
// not need to be mistaken for a wall.
export const WALL = /captcha|cf-challenge|challenge-platform|just a moment|access denied|unusual traffic|are you a (?:robot|human)|px-captcha|verify you are human/i;

/**
 * May a program that identifies as `ua` read `path`, by this robots.txt? Longest matching rule
 * wins and Allow beats Disallow on a tie (RFC 9309). The group naming us wins over `*`.
 */
export function robotsAllows(txt, path, ua = UA) {
  const me = String(ua).split(/[\/\s]/)[0].toLowerCase();
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase()); lastWasAgent = true;
    } else if ((k === 'allow' || k === 'disallow') && cur) {
      cur.rules.push({ allow: k === 'allow', path: v }); lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const mine = groups.filter(g => g.agents.includes(me));
  const rules = (mine.length ? mine : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules);
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;                                  // "Disallow:" with nothing means allow all
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (!re.test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

/** The pause between two resorts, in ms: WATCH_REDWEEK_PAUSE_SEC, 10 s when it is not set (Victor, 22 Oct 2026: twice a day, and slowly). */
export function pauseMs() {
  const raw = process.env.WATCH_REDWEEK_PAUSE_SEC;
  const s = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(s) && s >= 0 ? s * 1000 : 10000;
}

const TIMEOUT_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT', 'ESOCKETTIMEDOUT']);
/** A request that never got an answer: our own clock ran out, or undici's connect/headers/body timer did. */
export function isTimeout(err) {
  const c = err?.cause || err;
  return err?.name === 'AbortError' || err?.name === 'TimeoutError' || TIMEOUT_CODES.has(c?.code) || TIMEOUT_CODES.has(err?.code);
}
