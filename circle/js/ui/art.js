// The pictures on stay and trip cards.
//
// Real hotel photography is not ours to publish, so every place is drawn — but drawn as
// itself. A wall of twenty-three identical wave strips tells you nothing; the towers at the
// north end of Palm Beach, the low blocks on Eagle, the villa rooflines at the Marriott,
// the gables in town and the stilt bungalows at Savaneta all look different in life, so
// they look different here. Which scene a place gets is read off the catalog entry, so a
// new property is drawn correctly the moment it is added.
//
// Everything is deterministic from the id: the same place is the same picture every time,
// on every device, with nothing fetched.

import { escapeHtml } from '../core/util.js';

const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => { let s = (seed >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const n1 = (v) => Number(v.toFixed(1));
/** Rough perceived brightness of a #rrggbb, 0–1. */
const luminance = (hex) => {
  const v = parseInt(String(hex).slice(1), 16);
  return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
};

const W = 640, H = 214;

// Aruba is the same island all day; what changes is the hour. Each place keeps its own.
const SKIES = [
  { name: 'morning', sky: ['#BEE2F1', '#E9F5F7'], sea: ['#1D7E90', '#5DBFC4'], sand: '#F1E3CB', sun: '#FFF6DC', ink: '#0D2B3A', built: '#456C7E' },
  { name: 'midday',  sky: ['#9FD4EC', '#DCEFF5'], sea: ['#12657C', '#4FB4BC'], sand: '#EFDEC2', sun: '#FFFBE9', ink: '#0B2233', built: '#EDE4D4' },
  { name: 'golden',  sky: ['#F6C98D', '#FBEBD3'], sea: ['#1A6A83', '#4CA9B1'], sand: '#F0DBB6', sun: '#FFE7B0', ink: '#123040', built: '#8C6F63' },
  { name: 'dusk',    sky: ['#5D6FA0', '#E9A87E'], sea: ['#14465C', '#2F7F8E'], sand: '#D9C3A4', sun: '#FFD6A0', ink: '#0A1E2C', built: '#26364C' },
];
// The trips are somewhere else entirely, and should not read as Aruba.
const AWAY = {
  'Dominican Republic': { sky: ['#3C6E9B', '#B9D8E4'], sea: ['#0E3F58', '#2A7F94'], sand: '#CFCBB4', sun: '#EAF3F6', ink: '#08202E', built: '#1C4C39' },
  Mexico:               { sky: ['#E8A15C', '#F7DEB4'], sea: ['#8A6A46', '#C39A64'], sand: '#D8B98A', sun: '#FFE9BE', ink: '#2C1B10', built: '#7A4B2E' },
  Japan:                { sky: ['#8E93B8', '#EAD7DE'], sea: ['#3D4A6B', '#7C87A8'], sand: '#CBBFC4', sun: '#FFE1E6', ink: '#1C1F33', built: '#3A4059' },
};

/**
 * Which scene a place gets, from what the catalog already knows about it. Nothing has to be
 * added to the data: a new Palm Beach tower draws as a tower, a new villa resort as villas.
 */
export function sceneFor(stay) {
  if (!stay) return 'lowrise';
  // A cruise is the ship, wherever it sails from; a trip is the place it goes.
  if (stay.kind === 'trip' && stay.cruise) return 'cruise';
  if (stay.kind === 'trip') return `away:${stay.country}`;
  const f = (stay.features || []).join(' ').toLowerCase();
  const name = `${stay.name} ${stay.vibe || ''}`.toLowerCase();
  if (/overwater|bungalow|tree house/.test(f + name)) return 'overwater';
  if (/villa/.test(f) || /villas/.test(name)) return 'villa';
  // The harbour front in town, not the beach hotels that happen to share the postcode.
  if (stay.area === 'Oranjestad' && !stay.onSand) return 'town';
  if (stay.area === 'Malmok' || stay.area === 'Savaneta') return 'wild';
  // Aruba's own names for its two strips: Palm Beach is the high-rise one, Eagle the low.
  if (stay.area === 'Palm Beach') return 'highrise';
  return 'lowrise';
}

const grad = (id, [a, b], vertical = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">
     <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

/** A wobbling horizontal edge, closed down to the bottom of the frame. */
function band(y, amp, freq, phase, fill, opacity = 1) {
  let d = `M0 ${n1(y)}`;
  for (let x = 16; x <= W; x += 16) d += ` L${x} ${n1(y + Math.sin(x * freq + phase) * amp)}`;
  return `<path d="${d} L${W} ${H} L0 ${H}Z" fill="${fill}" opacity="${opacity}"/>`;
}

/**
 * A divi-divi-ish palm: a leaning trunk with fronds that arc out and fall back down. The
 * fronds are scaled off the trunk, or a tall tree ends up with a tuft on top of a pole.
 */
const palm = (x, base, h, lean, ink) => {
  const top = base - h, tx = x + lean, r = h * 0.42;
  // Each frond leaves the crown flat and droops: out to (dx, -lift), down to (dx*1.5, drop).
  const frond = (dx, lift, drop) =>
    `M${n1(tx)} ${n1(top)}Q${n1(tx + dx * 0.55)} ${n1(top - lift)} ${n1(tx + dx)} ${n1(top + drop)}`;
  const fronds = [
    frond(-r, r * 0.5, r * 0.30), frond(r, r * 0.5, r * 0.30),
    frond(-r * 0.72, r * 0.62, -r * 0.18), frond(r * 0.72, r * 0.62, -r * 0.18),
    frond(-r * 0.26, r * 0.68, -r * 0.42), frond(r * 0.26, r * 0.68, -r * 0.42),
  ].map(d => `<path d="${d}"/>`).join('');
  return `<g stroke="${ink}" stroke-width="${n1(Math.max(1.8, h * 0.045))}" fill="none" stroke-linecap="round" opacity=".9">
    <path d="M${n1(x)} ${n1(base)}Q${n1(x + lean * 0.35)} ${n1(base - h * 0.6)} ${n1(tx)} ${n1(top)}"/>
    ${fronds}</g><circle cx="${n1(tx)}" cy="${n1(top)}" r="${n1(h * 0.035)}" fill="${ink}" opacity=".9"/>`;
};

const palapa = (x, base, w, ink) =>
  `<g fill="${ink}" opacity=".85">
     <path d="M${n1(x - w)} ${n1(base - 13)}Q${n1(x)} ${n1(base - 17)} ${n1(x + w)} ${n1(base - 13)}L${n1(x)} ${n1(base - 27)}Z"/>
     <rect x="${n1(x - 1.4)}" y="${n1(base - 14)}" width="2.8" height="14" rx="1.2"/></g>`;

const catamaran = (x, y, s, ink) =>
  `<g fill="${ink}" opacity=".85" transform="translate(${n1(x)} ${n1(y)}) scale(${s})">
     <path d="M0 0 24 0 21 6 3 6Z"/><path d="M11 -2 11 -26 26 -4Z"/><path d="M9 -2 9 -22 -4 -3Z"/></g>`;

const bird = (x, y, s, ink) =>
  `<path d="M${n1(x)} ${n1(y)}q${4 * s} ${-4 * s} ${8 * s} 0q${4 * s} ${-4 * s} ${8 * s} 0"
     fill="none" stroke="${ink}" stroke-width="${1.6 * s}" stroke-linecap="round" opacity=".45"/>`;

const cloud = (x, y, s, o) =>
  `<g fill="#fff" opacity="${o}"><ellipse cx="${n1(x)}" cy="${n1(y)}" rx="${n1(30 * s)}" ry="${n1(11 * s)}"/>
   <ellipse cx="${n1(x + 22 * s)}" cy="${n1(y + 3 * s)}" rx="${n1(20 * s)}" ry="${n1(8 * s)}"/>
   <ellipse cx="${n1(x - 20 * s)}" cy="${n1(y + 4 * s)}" rx="${n1(17 * s)}" ry="${n1(7 * s)}"/></g>`;

/** Palm Beach: the tower strip, seen down the beach. */
function highrise(rand, ink, horizon) {
  let out = '';
  let x = 40 + rand() * 40;
  while (x < W - 40) {
    const w = 34 + rand() * 26, h = 46 + rand() * 54;
    const top = horizon - h;
    out += `<g fill="${ink}"><rect x="${n1(x)}" y="${n1(top)}" width="${n1(w)}" height="${n1(h + 6)}" rx="3" opacity=".9"/></g>`;
    // Lit windows, in rows, so it reads as a hotel rather than a block.
    for (let r = 0; r < Math.floor(h / 13); r++) {
      for (let c = 0; c < Math.floor(w / 11); c++) {
        if (rand() > 0.42) continue;
        out += `<rect x="${n1(x + 5 + c * 11)}" y="${n1(top + 8 + r * 13)}" width="4.5" height="6" rx="1" fill="var(--sceneWin)" opacity=".75"/>`;
      }
    }
    x += w + 8 + rand() * 22;
  }
  return out;
}

/** Eagle Beach and Druif: two or three storeys, wide, with the palapa line in front. */
function lowrise(rand, ink, horizon) {
  let out = '', x = 24 + rand() * 30;
  while (x < W - 30) {
    const w = 70 + rand() * 80, h = 22 + rand() * 18;
    out += `<rect x="${n1(x)}" y="${n1(horizon - h)}" width="${n1(w)}" height="${n1(h + 6)}" rx="3" fill="${ink}" opacity=".82"/>`;
    for (let c = 0; c < Math.floor(w / 16); c++) {
      if (rand() > 0.5) continue;
      out += `<rect x="${n1(x + 7 + c * 16)}" y="${n1(horizon - h + 7)}" width="6" height="5" rx="1" fill="var(--sceneWin)" opacity=".7"/>`;
    }
    x += w + 10 + rand() * 26;
  }
  return out;
}

/** The Marriott villas and the Divi villages: pitched roofs, stepped back in rows. */
function villa(rand, ink, horizon) {
  let out = '';
  for (const [row, o, sc] of [[1, 0.55, 0.78], [0, 0.9, 1]]) {
    const base = horizon + row * 0 - (row ? 14 : 0);
    let x = -20 + rand() * 40;
    while (x < W + 20) {
      const w = (54 + rand() * 34) * sc, h = (20 + rand() * 12) * sc, roof = 15 * sc;
      out += `<g fill="${ink}" opacity="${o}">
        <path d="M${n1(x - 5)} ${n1(base - h)}L${n1(x + w / 2)} ${n1(base - h - roof)}L${n1(x + w + 5)} ${n1(base - h)}Z"/>
        <rect x="${n1(x)}" y="${n1(base - h)}" width="${n1(w)}" height="${n1(h + 6)}" rx="2"/></g>`;
      if (!row) out += `<rect x="${n1(x + w * 0.36)}" y="${n1(base - h + 7)}" width="${n1(w * 0.28)}" height="7" rx="1.5" fill="var(--sceneWin)" opacity=".72"/>`;
      x += w + 6 + rand() * 16;
    }
  }
  return out;
}

/** Oranjestad: the Dutch colonial gables along the harbour. */
function town(rand, ink, horizon) {
  let out = '', x = 10;
  while (x < W - 20) {
    const w = 40 + rand() * 26, h = 34 + rand() * 34, top = horizon - h;
    const step = 5 + rand() * 3;
    // A stepped gable, which is the one silhouette nobody mistakes for a beach hotel.
    let g = `M${n1(x)} ${n1(horizon + 6)}L${n1(x)} ${n1(top + step * 2)}`;
    for (let i = 0; i < 3; i++) g += `L${n1(x + w * (0.16 + i * 0.17))} ${n1(top + step * 2 - i * step)}L${n1(x + w * (0.16 + i * 0.17))} ${n1(top + step - i * step)}`;
    g += `L${n1(x + w / 2)} ${n1(top - step)}`;
    for (let i = 2; i >= 0; i--) g += `L${n1(x + w * (0.84 - i * 0.17))} ${n1(top + step - i * step)}L${n1(x + w * (0.84 - i * 0.17))} ${n1(top + step * 2 - i * step)}`;
    g += `L${n1(x + w)} ${n1(top + step * 2)}L${n1(x + w)} ${n1(horizon + 6)}Z`;
    out += `<path d="${g}" fill="${ink}" opacity=".88"/>`;
    for (let r = 0; r < 2; r++) out += `<rect x="${n1(x + w * 0.3)}" y="${n1(top + 20 + r * 15)}" width="${n1(w * 0.4)}" height="8" rx="1.5" fill="var(--sceneWin)" opacity=".7"/>`;
    x += w + 5 + rand() * 10;
  }
  return out;
}

/** Savaneta: the bungalows stand in the water, which is the whole point of them. */
function overwater(rand, ink, horizon) {
  let out = '';
  for (let i = 0; i < 4; i++) {
    const x = 60 + i * 145 + rand() * 24, base = horizon + 34 + i * 4, w = 48;
    out += `<g fill="${ink}" opacity=".88">
      <path d="M${n1(x - 8)} ${n1(base - 20)}L${n1(x + w / 2)} ${n1(base - 38)}L${n1(x + w + 8)} ${n1(base - 20)}Z"/>
      <rect x="${n1(x)}" y="${n1(base - 20)}" width="${w}" height="20" rx="2"/></g>
      <g stroke="${ink}" stroke-width="2.6" opacity=".7" stroke-linecap="round">
        <path d="M${n1(x + 6)} ${n1(base)}v13"/><path d="M${n1(x + w - 6)} ${n1(base)}v13"/>
        <path d="M${n1(x + w + 10)} ${n1(base - 10)}h26"/></g>
      <rect x="${n1(x + 16)}" y="${n1(base - 14)}" width="14" height="7" rx="1.5" fill="var(--sceneWin)" opacity=".72"/>`;
  }
  return out;
}

/** Malmok and the north shore: no hotel at all — rock, and the boats that anchor off it. */
function wild(rand, ink, horizon) {
  let out = '';
  for (let i = 0; i < 5; i++) {
    const x = rand() * W, w = 26 + rand() * 46, h = 10 + rand() * 20;
    out += `<path d="M${n1(x - w / 2)} ${n1(horizon + 8)}Q${n1(x - w * 0.2)} ${n1(horizon + 8 - h)} ${n1(x)} ${n1(horizon + 6 - h * 0.8)}Q${n1(x + w * 0.3)} ${n1(horizon + 8 - h * 0.5)} ${n1(x + w / 2)} ${n1(horizon + 9)}Z" fill="${ink}" opacity="${n1(0.55 + rand() * 0.3)}"/>`;
  }
  return out;
}

/** The three trips, each drawn as the thing people are actually going for. */
function away(country, rand, ink, horizon) {
  if (country === 'Dominican Republic') {
    // Samaná in whale season. A tail out of the water is the one whale shape nobody has to
    // squint at, so it is drawn big and near; a breaching back sits further out behind it.
    const hill = (x, w, h, o) => `<path d="M${n1(x)} ${n1(horizon + 2)}Q${n1(x + w / 2)} ${n1(horizon + 2 - h)} ${n1(x + w)} ${n1(horizon + 2)}Z" fill="${ink}" opacity="${o}"/>`;
    return hill(-60, 330, 66, 0.5) + hill(170, 360, 88, 0.7) + hill(440, 300, 54, 0.45) +
      // The far one: a rolling back and a small fin.
      `<g fill="#0E2A38" opacity=".78">
         <path d="M436 156q30-26 68-12 20 8 30 22-34 6-66 0-22-4-32-10Z"/>
         <path d="M470 138q4-16 0-27 14 9 17 25Z"/></g>
       <g stroke="#fff" stroke-width="2.4" fill="none" opacity=".5" stroke-linecap="round">
         <path d="M488 132q-5-14 1-25"/><path d="M498 133q4-12 0-20"/></g>
       <!-- The near one: fluke and peduncle, filling the left third. -->
       <g fill="#0B2431" opacity=".95">
         <path d="M118 214q10-52 34-78 8-9 18-14-2 30-14 56-8 18-16 36Z"/>
         <path d="M170 122q-14-20-40-26 26-16 56-4 26 10 34 34-26-10-50-4Z"/>
         <path d="M170 122q22-16 54-14-24 16-54 22Z"/></g>
       <g fill="#fff" opacity=".38">
         <ellipse cx="150" cy="196" rx="66" ry="9"/><ellipse cx="470" cy="176" rx="44" ry="6"/></g>
       <path d="M0 200q160-10 320 0t320-5V${H}H0Z" fill="#fff" opacity=".1"/>`;
  }
  if (country === 'Mexico') {
    // Oaxaca: the agave terraces and the dome of Santo Domingo.
    const agave = (x, y, s) => {
      let g = '';
      for (let i = -4; i <= 4; i++) g += `<path d="M${n1(x)} ${n1(y)}q${i * 5} ${-14 * s} ${i * 7.5} ${-26 * s}" stroke="${ink}" stroke-width="${n1(3 * s)}" fill="none" stroke-linecap="round"/>`;
      return `<g opacity=".85">${g}</g>`;
    };
    let out = `<path d="M-20 ${n1(horizon + 6)}Q140 ${n1(horizon - 54)} 320 ${n1(horizon + 2)}T680 ${n1(horizon - 10)}L680 ${H}L-20 ${H}Z" fill="${ink}" opacity=".45"/>`;
    out += `<g fill="${ink}" opacity=".85"><rect x="286" y="${n1(horizon + 6)}" width="68" height="34" rx="2"/>
      <path d="M300 ${n1(horizon + 6)}a20 20 0 0 1 40 0Z"/><rect x="316" y="${n1(horizon - 24)}" width="8" height="16" rx="3"/></g>`;
    for (let i = 0; i < 7; i++) out += agave(50 + i * 88 + rand() * 26, H - 12 - rand() * 16, 0.8 + rand() * 0.5);
    return out;
  }
  // Japan in early December: the torii, the gate posts, and Fuji behind.
  return `<path d="M150 ${n1(horizon + 4)}L330 78L510 ${n1(horizon + 4)}Z" fill="${ink}" opacity=".5"/>
    <path d="M296 100L330 78L364 100q-16 8-34 8t-34-8Z" fill="#fff" opacity=".8"/>
    <g fill="#B4463F" opacity=".92">
      <path d="M176 128h288l-12 16H188Z"/><rect x="196" y="152" width="248" height="11" rx="2"/>
      <rect x="212" y="140" width="17" height="${n1(H - 140)}" rx="3"/><rect x="411" y="140" width="17" height="${n1(H - 140)}" rx="3"/></g>
    <g stroke="${ink}" stroke-width="2.2" opacity=".35" fill="none" stroke-linecap="round">
      <path d="M60 176q18-10 36 0"/><path d="M544 168q18-10 36 0"/></g>`;
}

/** A cruise: the ship itself, long and low on the water at dusk, one silhouette. */
const CRUISE = { sky: ['#2F5E86', '#D3E2EB'], sea: ['#0B3A52', '#1F6E85'], sun: '#EAF3F6', ink: '#0A1F2C', built: '#0A1F2C' };
function ship(rand, ink, horizon) {
  const y = horizon + 2;
  const x0 = 110 + rand() * 30, x1 = x0 + 410;
  const hull = `<path d="M${n1(x0)} ${n1(y - 14)}L${n1(x1 - 34)} ${n1(y - 14)}Q${n1(x1 + 8)} ${n1(y - 13)} ${n1(x1)} ${n1(y + 2)}L${n1(x1 - 10)} ${n1(y + 24)}H${n1(x0 + 26)}L${n1(x0 - 12)} ${n1(y + 2)}Z" fill="${ink}"/>`;
  const decks = `<g fill="${ink}"><rect x="${n1(x0 + 34)}" y="${n1(y - 48)}" width="306" height="36" rx="7"/>
    <rect x="${n1(x0 + 66)}" y="${n1(y - 70)}" width="236" height="26" rx="7"/>
    <rect x="${n1(x0 + 106)}" y="${n1(y - 86)}" width="150" height="20" rx="6"/>
    <path d="M${n1(x0 + 236)} ${n1(y - 86)}h26l7-24h-27Z"/></g>`;
  let win = '';
  for (let i = 0; i < 22; i++) win += `<rect x="${n1(x0 + 46 + i * 13)}" y="${n1(y - 39)}" width="6" height="4" rx="1" fill="#FFE9B8" opacity=".85"/>`;
  for (let i = 0; i < 16; i++) win += `<rect x="${n1(x0 + 80 + i * 13)}" y="${n1(y - 62)}" width="6" height="4" rx="1" fill="#FFE9B8" opacity=".85"/>`;
  const wake = `<path d="M${n1(x0 - 48)} ${n1(y + 16)}q46 9 100 4" stroke="#fff" stroke-width="2" fill="none" opacity=".35" stroke-linecap="round"/>`;
  return hull + decks + win + wake;
}

/**
 * The picture for one stay or trip, as an SVG string. Deterministic from the id, so the
 * same place is the same picture on every device, and nothing is fetched.
 */
export function sceneSvg(stay, { w = W, h = H } = {}) {
  const key = stay?.id || 'x';
  const rand = rng(hash(key));
  const scene = sceneFor(stay);
  const isAway = scene.startsWith('away:');
  const pal = scene === 'cruise' ? CRUISE : isAway ? (AWAY[scene.slice(5)] || AWAY.Japan) : SKIES[Math.floor(rand() * SKIES.length)];
  const uid = `a${(hash(key) % 1e6).toString(36)}`;
  const horizon = 118 + rand() * 10;
  const ink = pal.ink;

  // Sky, sea, and the building. That is the whole picture.
  //
  // It used to be nine things in a 340x214 box: a gradient, a sun, three clouds, three birds,
  // four wave bands, the buildings, a sand strip, up to five palm trees, a couple of palapas
  // and a catamaran. Stacked in a space the size of a business card that is not a scene, it is
  // a sticker sheet — which is exactly why Victor kept calling the site cheap. The house style
  // this project already wrote down says one idea per image, silhouette first, two tones beat
  // five, and "Aruba is the address, not the subject… a drawing does not need a palm tree in it
  // to be from here". The old drawing broke every one of those lines.
  //
  // So: a two-stop sky, a calm sea, and the property's own roofline as a single flat shape,
  // with two thirds of the frame left empty. The silhouette is the subject and the emptiness is
  // what makes it look considered rather than decorated. Nothing here is random-looking any
  // more, and nothing competes with the hotel's name sitting underneath it.
  const sky = `<rect width="${W}" height="${H}" fill="url(#${uid}s)"/>`;

  // One horizon, one sea. A single soft band where the water meets the light, not four.
  const sea = `<path d="M0 ${n1(horizon)}H${W}V${H}H0Z" fill="url(#${uid}w)"/>`
    + band(horizon + 5, 1.6, 0.011, rand() * 6.28, '#ffffff', 0.07);

  const built = pal.built || ink;
  let mid = '';
  if (scene === 'highrise') mid = highrise(rand, built, horizon);
  else if (scene === 'lowrise') mid = lowrise(rand, built, horizon);
  else if (scene === 'villa') mid = villa(rand, built, horizon);
  else if (scene === 'town') mid = town(rand, built, horizon);
  else if (scene === 'wild') mid = wild(rand, built, horizon);
  else if (scene === 'overwater') mid = overwater(rand, built, horizon);
  else if (scene === 'cruise') mid = ship(rand, built, horizon);
  else if (isAway) mid = away(scene.slice(5), rand, built, horizon);

  // Lit windows against a dark building, glazed dark against a pale one.
  const win = luminance(pal.built || ink) > 0.55 ? '#4E6B7C' : '#FFE9B8';
  return `<svg viewBox="0 0 ${W} ${H}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" focusable="false" style="--sceneWin:${win}">
    <defs>${grad(`${uid}s`, pal.sky)}${grad(`${uid}w`, pal.sea)}</defs>
    ${sky}${sea}${mid}</svg>`;
}

/**
 * The plate a place gets when we hold no photograph of it.
 *
 * This used to be a drawing of the property — a row of towers for Palm Beach, low blocks for
 * Eagle, gables for town. It was honest in intent and wrong in effect. Fifteen of the
 * twenty-three properties are chains that refuse an automated fetch, so fifteen cards drew one
 * of two near-identical rows of rectangles with dots for windows, over and over down the grid.
 * Victor's words for the site were "AI slop" and "all ghost fantasy pictures", and that grid was
 * the strongest remaining evidence for both: a machine inventing a picture of somewhere it has
 * never seen, fifteen times, with the variation turned down far enough that you notice the
 * repetition before you notice the place.
 *
 * So it draws nothing. A card with no photograph now says so, quietly: the club's own mark
 * embossed into a blank field, and a line of type underneath it. Fifteen identical blanks and
 * fifteen slightly-different fakes are not the same failure — uniform blanks read as a system
 * ("these eight have photographs, these do not"), while varied fakes read as a broken generator.
 * The blank is also what makes the eight real photographs land.
 *
 * It is type rather than a drawing, and it is markup rather than SVG: real text at a real size,
 * selectable, and themed by the same tokens as everything else instead of carrying a baked
 * daylight sky into dark mode.
 *
 * The word on the plate is the beach, which is the one true thing we know about every property
 * and the thing a member actually sorts by. The first attempt put the club's star here instead;
 * at 3:1 and low contrast a centred grey mark reads as a broken-image icon, which is a worse lie
 * than the drawing was.
 */
export function plateHtml(stay) {
  const area = String(stay?.area || '').trim();
  return area ? `<span class="plate-area">${escapeHtml(area)}</span>` : '';
}

/** The card's etched contour lines, as an inline SVG string. */
export function contourSvg(key, { stroke = 'currentColor', lines = 11, w = 340, h = 214 } = {}) {
  const rand = rng(hash(key));
  const paths = [];
  for (let i = 0; i < lines; i++) {
    const baseY = h * (i / lines) * 1.05 + 8;
    const amp = 4 + rand() * 12, freq = 0.012 + rand() * 0.014, phase = rand() * 6.28;
    let d = `M0 ${(baseY + Math.sin(phase) * amp).toFixed(1)}`;
    for (let x = 8; x <= w; x += 8) d += ` L${x} ${(baseY + Math.sin(x * freq + phase) * amp).toFixed(1)}`;
    paths.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1" opacity=".5"/>`);
  }
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">${paths.join('')}</svg>`;
}

/** The leaning-tree tier glyph: the wind-pruned trees of Aruba, leaning further at each tier. */
export function treeSvg(deg = 12, { size = 18, stroke = 'currentColor' } = {}) {
  return `<svg class="tree" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
    <g stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" fill="none" transform="rotate(${deg} 12 21)">
      <path d="M12 21V10"/><path d="M12 11.6c-2-1.7-4-2-5.7-1.4"/><path d="M12 11.6c2-1.7 4-2 5.7-1.4"/>
      <path d="M12 14.8c-1.8-1.5-3.5-1.8-4.9-1.3"/><path d="M12 14.8c1.8-1.5 3.5-1.8 4.9-1.3"/>
    </g></svg>`;
}

/** The four-pointed star used as the points glyph and the app mark. */
export function starSvg({ size = 22, fill = 'currentColor' } = {}) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M12 1.5 14.4 9.6 22.5 12 14.4 14.4 12 22.5 9.6 14.4 1.5 12 9.6 9.6Z" fill="${fill}"/></svg>`;
}
