#!/usr/bin/env node
// Fetch what a property actually publishes about its rooms, and the pictures it publishes with
// them — with a record of where each thing came from and when.
//
// The rule this whole script exists to enforce: never invent. A missing size comes back null,
// not estimated. A room nobody publishes does not appear. The catalog it feeds had eleven room
// types whose sizes were inferred, and a member reading "941 sq ft" has no way to know which
// eleven — so the number was worse than the blank would have been.
//
// Usage:
//   node fetch-rooms.mjs <url> [--out DIR] [--images] [--max-images N] [--ua NAME]
//   node fetch-rooms.mjs --check <url>        # robots.txt verdict only, fetch nothing
//
// Exit codes: 0 ok · 2 robots.txt disallows · 3 fetch failed · 4 nothing extractable

import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const UA_DEFAULT = 'HuntoCircleCatalog/1.0 (private travel club; contact via the club)';
const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? true) : d; };
const has = (n) => args.includes(n);
const url = args.find(a => a.startsWith('http'));
const UA = flag('--ua', UA_DEFAULT);

if (!url) { console.error('Give me a property URL.'); process.exit(3); }

// ---------------------------------------------------------------- robots.txt
/**
 * The site's own answer to "may I". Parsed properly rather than waved at: longest-match wins in
 * the standard, and a bare `Disallow:` means allow. We honour the most specific group that
 * applies to us, falling back to `*`.
 *
 * A site that says no gets a no. That is not a limitation to work around — it is the operator
 * telling us how they want their pages used, and a club that books real rooms with these people
 * has more to lose than a page of copy.
 */
async function robotsVerdict(target, ua) {
  const u = new URL(target);
  const robotsUrl = `${u.origin}/robots.txt`;
  let txt = '';
  try {
    const res = await fetch(robotsUrl, { headers: { 'user-agent': ua }, redirect: 'follow' });
    if (res.status === 404) return { allowed: true, why: 'no robots.txt', robotsUrl };
    if (!res.ok) return { allowed: true, why: `robots.txt returned ${res.status}`, robotsUrl };
    txt = await res.text();
  } catch (e) {
    return { allowed: true, why: `robots.txt unreachable (${e.message})`, robotsUrl };
  }

  const groups = [];
  let current = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(val.toLowerCase());
    } else if ((key === 'disallow' || key === 'allow') && current) {
      current.rules.push({ allow: key === 'allow', pathPrefix: val });
    }
  }

  const uaLower = ua.toLowerCase();
  const named = groups.find(g => g.agents.some(a => a !== '*' && uaLower.includes(a)));
  const star = groups.find(g => g.agents.includes('*'));
  const group = named || star;
  if (!group) return { allowed: true, why: 'no group applies to us', robotsUrl };

  // Longest match wins; an empty Disallow is an explicit allow-all.
  let best = null;
  for (const r of group.rules) {
    if (r.pathPrefix === '') { if (!r.allow) continue; }
    const p = r.pathPrefix.replace(/\*$/, '');
    if (p && !u.pathname.startsWith(p)) continue;
    if (!best || p.length > best.pathPrefix.replace(/\*$/, '').length) best = r;
  }
  if (!best) return { allowed: true, why: `no rule matches ${u.pathname}`, robotsUrl };
  return {
    allowed: best.allow,
    why: `${best.allow ? 'Allow' : 'Disallow'}: ${best.pathPrefix || '(empty)'} for ${named ? named.agents.join(',') : '*'}`,
    robotsUrl,
  };
}

// ---------------------------------------------------------------- extraction
const decode = (s) => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/\s+/g, ' ').trim();

/** Everything the page states about itself in machine-readable form. This is the good stuff:
 *  schema.org is the hotel telling search engines the facts, so it is the hotel's own claim. */
function jsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      for (const node of (Array.isArray(parsed) ? parsed : [parsed])) {
        out.push(node);
        if (node['@graph']) out.push(...node['@graph']);
      }
    } catch { /* a malformed block is not a reason to abandon the page */ }
  }
  return out;
}

const SIZE_RE = /(\d[\d,.]*)\s*(?:sq\.?\s*(?:ft|feet)|square\s*feet|ft²|sqft)/i;
const SQM_RE = /(\d[\d,.]*)\s*(?:m²|sq\.?\s*m|square\s*met(?:er|re)s?|sqm)/i;
const SLEEPS_RE = /(?:sleeps|accommodates|max(?:imum)?\s+occupancy|up to)\D{0,12}(\d{1,2})/i;
const BEDROOMS_RE = /(\d{1,2})[- ]bedroom/i;

/** A room the page actually names, with only the numbers the page actually prints. */
function roomsFromLd(nodes) {
  const rooms = [];
  const consider = (n) => {
    const t = [].concat(n['@type'] || []).join(' ');
    if (!/HotelRoom|Suite|Room|Accommodation|Product/i.test(t)) return;
    const name = decode(n.name);
    if (!name) return;
    const blob = decode([n.description, JSON.stringify(n.amenityFeature || '')].join(' '));
    const sqftFromLd = n.floorSize?.value && /f(oo|ee)t|sqft|ft/i.test(String(n.floorSize?.unitText || n.floorSize?.unitCode || ''))
      ? Number(String(n.floorSize.value).replace(/,/g, '')) : null;
    const sqmFromLd = n.floorSize?.value && /m(et|²)|MTK/i.test(String(n.floorSize?.unitText || n.floorSize?.unitCode || ''))
      ? Number(String(n.floorSize.value).replace(/,/g, '')) : null;
    const sqftText = blob.match(SIZE_RE), sqmText = blob.match(SQM_RE);
    const occ = n.occupancy?.maxValue ?? n.occupancy?.value ?? null;
    const sleepsText = blob.match(SLEEPS_RE);
    const bedText = blob.match(BEDROOMS_RE);
    rooms.push({
      name,
      sqft: sqftFromLd ?? (sqftText ? Number(sqftText[1].replace(/,/g, '')) : null),
      sqm: sqmFromLd ?? (sqmText ? Number(sqmText[1].replace(/,/g, '')) : null),
      sleeps: occ != null ? Number(occ) : (sleepsText ? Number(sleepsText[1]) : null),
      bedrooms: bedText ? Number(bedText[1]) : null,
      beds: decode(n.bed?.name || (Array.isArray(n.bed) ? n.bed.map(b => b.name || b.typeOfBed).join(' + ') : n.bed?.typeOfBed) || '') || null,
      description: decode(n.description || '') || null,
      image: [].concat(n.image || []).map(i => (typeof i === 'string' ? i : i?.url)).filter(Boolean),
      source: 'official',            // it came out of the property's own structured data
    });
  };
  for (const n of nodes) {
    consider(n);
    for (const key of ['containsPlace', 'makesOffer', 'itemListElement', 'hasPart']) {
      for (const child of [].concat(n[key] || [])) {
        consider(child?.item || child);
      }
    }
  }
  return rooms;
}

/**
 * When a property publishes no structured data — most of them — read the page as a person
 * would: a heading is a room name, and a size or occupancy printed near it belongs to it.
 *
 * This is deliberately timid. It records only strings it can point at, and anything it cannot
 * find stays null. Rooms found this way are marked `page-text` rather than `official`, because
 * "we read it off their page" and "they published it as data" are different degrees of
 * confidence and the catalog should be able to tell them apart.
 */
function roomsFromHeadings(html) {
  const rooms = [];
  const re = /<h([2-4])\b[^>]*>([\s\S]{0,200}?)<\/h\1>/gi;
  const marks = [];
  let m;
  while ((m = re.exec(html))) {
    const name = decode(m[2].replace(/<[^>]+>/g, ' '));
    if (!name || name.length < 4 || name.length > 90) continue;
    if (!/\b(room|suite|villa|studio|penthouse|casita|bungalow|apartment)\b/i.test(name)) continue;
    marks.push({ name, at: m.index + m[0].length });
  }
  for (let i = 0; i < marks.length; i++) {
    // Only the text between this heading and the next: a size two rooms further down the page
    // is not this room's size.
    const block = decode(html.slice(marks[i].at, marks[i + 1]?.at ?? marks[i].at + 1600).replace(/<[^>]+>/g, ' '));
    const sqft = block.match(SIZE_RE), sqm = block.match(SQM_RE);
    const sleeps = block.match(SLEEPS_RE), beds = block.match(BEDROOMS_RE);
    if (!sqft && !sqm && !sleeps && !beds) continue;   // a heading alone tells us nothing
    rooms.push({
      name: marks[i].name,
      sqft: sqft ? Number(sqft[1].replace(/,/g, '')) : null,
      sqm: sqm ? Number(sqm[1].replace(/,/g, '')) : null,
      sleeps: sleeps ? Number(sleeps[1]) : null,
      bedrooms: beds ? Number(beds[1]) : null,
      beds: null,
      description: block.slice(0, 240) || null,
      image: [],
      source: 'page-text',
    });
  }
  return rooms;
}

/** Images the page presents, with the alt text that says what they are. */
function imagesFrom(html, base) {
  const seen = new Map();
  const push = (src, alt) => {
    if (!src) return;
    let abs; try { abs = new URL(src, base).href; } catch { return; }
    if (!/\.(jpe?g|png|webp|avif)(\?|$)/i.test(abs)) return;
    if (/sprite|logo|icon|favicon|pixel|1x1|blank|placeholder/i.test(abs)) return;
    // Award badges and rating seals are the commonest junk on a hotel site and the likeliest to
    // end up on a card looking like a room. A harvest of eight Aruba properties came back with
    // Fodor's seals, a TripAdvisor medal and two "9.8 Exceptional" graphics — none of them a
    // picture of anywhere anyone sleeps.
    const junk = /award|badge|seal|winner|tripadvisor|fodor|forbes|travell?ers?[-_]?choice|certif|rating|review|logo|crest|medal|sticker|redes[-_]|social|facebook|instagram|whatsapp/i;
    if (junk.test(abs) || junk.test(String(alt || ''))) return;
    // Shape is the reliable tell the filename is not. Seals and social icons are small squares;
    // a photograph of a room is wide and big. A filename carrying its own dimensions —
    // "ta25-300x300.jpg", "aruba-certified-300x278.png" — hands us both for free.
    const dim = abs.match(/(\d{2,4})x(\d{2,4})(?=\D*$)/);
    if (dim) {
      const w = +dim[1], h = +dim[2];
      if (w < 640 || h < 360) return;              // too small to show a room
      if (Math.abs(w / h - 1) < 0.15) return;      // square: a seal, not a scene
    }
    if (!seen.has(abs)) seen.set(abs, decode(alt) || null);
    else if (!seen.get(abs) && alt) seen.set(abs, decode(alt));
  };
  // HTML lets an attribute value go unquoted, and plenty of real hotel sites ship it that way
  // (`src=https://...` with no quotes at all). Requiring a quote here silently found nothing on
  // a page carrying 163 photographs, so read all three forms.
  const attr = (tag, names) => {
    const m = tag.match(new RegExp(`\\b(?:${names})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
    return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
  };
  // From a srcset, take the widest — a member is looking at a room, not a thumbnail. A srcset
  // with no width descriptors at all (one entry, common in <picture>) still yields its one URL.
  const widestOf = (srcset) => {
    let best = null, bestW = -1;
    for (const part of String(srcset || '').split(',')) {
      const [u, w] = part.trim().split(/\s+/);
      const n = Number(String(w || '').replace(/\D/g, '')) || 0;
      if (u && n >= bestW) { best = u; bestW = n; }
    }
    return best;
  };
  let m;
  const imgRe = /<img\b([^>]*)>/gi;
  while ((m = imgRe.exec(html))) {
    const tag = m[1];
    const alt = attr(tag, 'alt');
    // The real URL hides in a data- attribute whenever the page lazy-loads, and `src` is then a
    // 1x1 base64 placeholder. Prefer the data- attribute over src for exactly that reason.
    const lazy = attr(tag, 'data-src|data-lazy-src|data-lazy|data-original|data-orig|data-image|data-bg');
    const widest = widestOf(attr(tag, 'srcset|data-srcset'));
    push(lazy || widest || attr(tag, 'src'), alt);
  }
  // <picture> keeps its candidates on <source>, and on a page that serves avif/webp first the
  // <img> inside may be a placeholder — so these are often the only real URLs on the page.
  const srcRe = /<source\b([^>]*)>/gi;
  while ((m = srcRe.exec(html))) push(widestOf(attr(m[1], 'srcset|data-srcset')), null);
  const ogRe = /<meta\b[^>]*\bproperty\s*=\s*(?:"og:image"|'og:image'|og:image)[^>]*>/gi;
  while ((m = ogRe.exec(html))) push(attr(m[0], 'content'), 'og:image');
  return [...seen].map(([src, alt]) => ({ src, alt }));
}

/**
 * Where this property keeps its rooms. Given a homepage, the accommodation page is almost always
 * one link away and almost always says so in the link text — but the path is never guessable
 * ("/accommodations/", "/rooms-suites", "/stay/our-rooms"), and guessing produces a 404 and a
 * wasted afternoon. Reading their own navigation is both more reliable and more polite.
 */
function roomLinks(html, base) {
  const out = new Map();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = decode(m[2].replace(/<[^>]+>/g, ' '));
    let abs; try { abs = new URL(m[1], base).href; } catch { continue; }
    if (new URL(abs).host !== new URL(base).host) continue;
    const hay = `${abs} ${text}`.toLowerCase();
    if (!/room|suite|accommodat|villa|stay|lodging/.test(hay)) continue;
    if (/blog|news|press|career|privacy|terms|gift|wedding|meeting|event|spa|dining|restaurant/.test(hay)) continue;
    const score = (/accommodat|rooms?-?(and|&)?-?suites?|our-rooms/.test(hay) ? 3 : 0)
      + (/\broom|suite\b/.test(text.toLowerCase()) ? 2 : 0)
      + (abs.split('/').filter(Boolean).length <= 4 ? 1 : 0);
    const prev = out.get(abs);
    if (!prev || score > prev.score) out.set(abs, { url: abs, text: text.slice(0, 60), score });
  }
  return [...out.values()].sort((a, b) => b.score - a.score).slice(0, 10);
}

// ---------------------------------------------------------------- run
const verdict = await robotsVerdict(url, UA);
if (has('--check')) { console.log(JSON.stringify(verdict, null, 2)); process.exit(verdict.allowed ? 0 : 2); }
if (has('--find')) {
  if (!verdict.allowed) { console.error(`robots.txt says no: ${verdict.why}`); process.exit(2); }
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' } });
  const page = await res.text();
  console.log(JSON.stringify({ url, robots: verdict, candidates: roomLinks(page, url) }, null, 2));
  process.exit(0);
}
if (!verdict.allowed) {
  console.error(`robots.txt says no: ${verdict.why}\n  ${verdict.robotsUrl}`);
  console.error('Stopping. Ask the property directly for a media kit, or link out to their page instead.');
  process.exit(2);
}

/**
 * Most hotel sites build their room list in the browser, so a plain fetch of the HTML comes back
 * with an empty shell — no rooms, no images, nothing to be wrong about. That is not a reason to
 * give up and guess; it is a reason to open the page properly.
 *
 * Rendering is still just reading the page the way a visitor does. It does not touch robots.txt,
 * which was checked before we got here, and it does not defeat anything: a site that says no is
 * still a no.
 */
async function renderedHtml(target, ua) {
  const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')
    .catch(() => import('playwright'));
  // Honour the machine's proxy the way fetch() already does. Without this the browser bypasses
  // a proxy the rest of the toolchain is required to use, and every render dies on a reset.
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const b = await chromium.launch(proxyUrl ? { proxy: { server: proxyUrl } } : {});
  try {
    const page = await b.newPage({ userAgent: ua, viewport: { width: 1400, height: 1000 } });
    await page.goto(target, { waitUntil: 'networkidle', timeout: 45000 });
    // Room lists are usually lazy: walk the page so the images actually attach.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
      document.querySelectorAll('img[loading="lazy"]').forEach(i => { i.loading = 'eager'; });
    });
    await page.waitForTimeout(1500);
    return await page.content();
  } finally { await b.close(); }
}

let html;
try {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' });
  if (!res.ok) { console.error(`Fetch failed: ${res.status}`); process.exit(3); }
  html = await res.text();
} catch (e) { console.error(`Fetch failed: ${e.message}`); process.exit(3); }

const fetchedAt = new Date().toISOString().slice(0, 10);
const ld = jsonLd(html);
let ldNodes = ld;
let rooms = roomsFromLd(ldNodes);
// Structured data first because it is the property's own claim; the page text only fills a gap.
if (!rooms.length) rooms = roomsFromHeadings(html);
let images = imagesFrom(html, url);
let rendered = false;

// Nothing at all usually means the page was built in the browser, not on the server.
if (!has('--no-render') && !rooms.length && images.length < 3) {
  try {
    html = await renderedHtml(url, UA);
    rendered = true;
    ldNodes = jsonLd(html);
    rooms = roomsFromLd(ldNodes);
    if (!rooms.length) rooms = roomsFromHeadings(html);
    images = imagesFrom(html, url);
    console.error('plain fetch was empty; rendered the page instead');
  } catch (e) { console.error(`render unavailable (${e.message}) — reporting what the plain fetch found`); }
}

const result = {
  url,
  fetchedAt,
  robots: verdict,
  // What we are allowed to assume about reuse. The honest answer is almost always "the
  // property's, all rights reserved" — a picture being reachable is not a licence. Recorded so
  // whoever publishes it is deciding knowingly rather than by accident.
  rights: 'Unless the page states otherwise, these images are the property\'s copyright. Reachable is not licensed. For a private members\' club showing a member the room being booked for them this is ordinary use; publishing them on an open marketing page is a different question. Ask the property for a media kit if in doubt.',
  rooms,
  images,
  rendered,
  counts: { rooms: rooms.length, images: images.length, jsonLdNodes: ldNodes.length },
};

const outDir = flag('--out', null);
if (outDir) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'rooms.json'), JSON.stringify(result, null, 2));

  if (has('--images')) {
    const max = Number(flag('--max-images', 12));
    const imgDir = path.join(outDir, 'images');
    await mkdir(imgDir, { recursive: true });
    const saved = [];
    for (const { src, alt } of images.slice(0, max)) {
      try {
        const r = await fetch(src, { headers: { 'user-agent': UA, referer: url } });
        if (!r.ok) { saved.push({ src, ok: false, why: `HTTP ${r.status}` }); continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 8000) { saved.push({ src, ok: false, why: 'too small to be a room photo' }); continue; }
        const ext = (src.match(/\.(jpe?g|png|webp|avif)/i) || [, 'jpg'])[1].toLowerCase();
        const name = `${createHash('sha1').update(src).digest('hex').slice(0, 12)}.${ext}`;
        await writeFile(path.join(imgDir, name), buf);
        // Provenance travels WITH the file. An image in a folder with no record of where it
        // came from is exactly the thing this skill exists to stop.
        saved.push({ file: `images/${name}`, src, alt, bytes: buf.length, fetchedAt, ok: true });
        await new Promise(r2 => setTimeout(r2, 400));   // polite; nobody is in a hurry
      } catch (e) { saved.push({ src, ok: false, why: e.message }); }
    }
    await writeFile(path.join(outDir, 'images.json'), JSON.stringify({ url, fetchedAt, rights: result.rights, images: saved }, null, 2));
    console.error(`images: ${saved.filter(x => x.ok).length} saved, ${saved.filter(x => !x.ok).length} skipped`);
  }
  console.error(`wrote ${path.join(outDir, 'rooms.json')}`);
}

console.log(JSON.stringify(result, null, 2));
if (!rooms.length && !images.length) process.exit(4);
