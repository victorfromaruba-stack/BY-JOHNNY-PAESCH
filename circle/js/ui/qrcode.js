// A small QR encoder, so the card does not depend on a CDN script and the module
// matrix is ours to draw — into a canvas at exact integer scale, or into the
// printable card image.
//
// Scope on purpose: byte mode, error correction level M, versions 1 to 10. That
// covers 213 bytes, and a member card URL is about 55. Level M recovers ~15%,
// which is the right level for a code read off a screen: raising it to H shrinks
// every module inside the same box and makes scanning worse, not better.
// Verified module-for-module against the reference implementation.

const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const EC_PER_BLOCK_M  = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M        = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ALIGNMENT = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// --- GF(256) for Reed-Solomon, generator 0x11d ---
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function ecPolynomial(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    // poly[0] is the highest-degree coefficient: multiplying by x keeps the index,
    // multiplying by the constant moves it one place down.
    for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= mul(poly[j], EXP[i]); }
    poly = next;
  }
  return poly;
}
function ecCodewords(data, count) {
  const gen = ecPolynomial(count);
  const rem = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift(); rem.push(0);
    for (let i = 0; i < count; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

/** Encode text and return { size, modules } where modules[y][x] is true for a dark module. */
export function encode(text, { ecc = 'M' } = {}) {
  if (ecc !== 'M') throw new Error('This encoder ships error correction level M only');
  const bytes = new TextEncoder().encode(text);
  // smallest version that fits
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const capacity = TOTAL_CODEWORDS[v - 1] - EC_PER_BLOCK_M[v - 1] * BLOCKS_M[v - 1];
    const header = 4 + (v < 10 ? 8 : 16);
    if (capacity * 8 >= header + bytes.length * 8) { version = v; break; }
  }
  if (!version) throw new Error('Too much data for this encoder');

  const totalCw = TOTAL_CODEWORDS[version - 1];
  const ecPer = EC_PER_BLOCK_M[version - 1];
  const blocks = BLOCKS_M[version - 1];
  const dataCw = totalCw - ecPer * blocks;

  // --- bit stream: mode, length, data, terminator, pad ---
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  for (let i = 0; i < 4 && bits.length < dataCw * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let i = 0; codewords.length < dataCw; i++) codewords.push(i % 2 ? 0x11 : 0xec);

  // --- split into blocks, add error correction, interleave ---
  const shortLen = Math.floor(dataCw / blocks), longCount = dataCw % blocks;
  const dataBlocks = [], ecBlocks = [];
  let at = 0;
  for (let b = 0; b < blocks; b++) {
    const len = shortLen + (b >= blocks - longCount ? 1 : 0);
    const block = codewords.slice(at, at + len); at += len;
    dataBlocks.push(block); ecBlocks.push(ecCodewords(block, ecPer));
  }
  const final = [];
  for (let i = 0; i < shortLen + 1; i++) for (const b of dataBlocks) if (i < b.length) final.push(b[i]);
  for (let i = 0; i < ecPer; i++) for (const b of ecBlocks) final.push(b[i]);

  // --- the matrix ---
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const set = (x, y, dark) => { if (x >= 0 && y >= 0 && x < size && y < size) modules[y][x] = dark; };

  const finder = (cx, cy) => {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const x = cx + dx, y = cy + dy;
      const inRing = (dx >= 0 && dx <= 6 && (dy === 0 || dy === 6)) || (dy >= 0 && dy <= 6 && (dx === 0 || dx === 6));
      const inCore = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      set(x, y, inRing || inCore);
    }
  };
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
  for (let i = 8; i < size - 8; i++) { const dark = i % 2 === 0; set(i, 6, dark); set(6, i, dark); }
  for (const cy of ALIGNMENT[version]) for (const cx of ALIGNMENT[version]) {
    if ((cx <= 8 && cy <= 8) || (cx <= 8 && cy >= size - 9) || (cx >= size - 9 && cy <= 8)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  set(8, size - 8, true);                              // the module that is always dark
  const reserveFormat = () => { for (let i = 0; i < 9; i++) { if (modules[i][8] === null) set(8, i, false); if (modules[8][i] === null) set(i, 8, false); } for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, modules[8][size - 1 - i] ?? false); set(8, size - 1 - i, modules[size - 1 - i][8] ?? false); } };
  reserveFormat();
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vbits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vbits >> i) & 1) === 1, a = Math.floor(i / 3), b = (i % 3) + size - 11;
      set(b, a, bit); set(a, b, bit);
    }
  }

  // --- lay the data in, zig-zagging up and down the columns ---
  const bitsOut = [];
  for (const cw of final) for (let i = 7; i >= 0; i--) bitsOut.push((cw >> i) & 1);
  let idx = 0, upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;                        // skip the vertical timing column
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (modules[y][x] !== null) continue;
        modules[y][x] = idx < bitsOut.length ? bitsOut[idx++] === 1 : false;
      }
    }
    upward = !upward;
  }

  // --- pick the mask that reads best ---
  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const isFunction = functionMap(size, version);
  let best = null, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const grid = modules.map((row, y) => row.map((v, x) => (isFunction[y][x] ? v : v !== MASKS[m](x, y))));
    applyFormat(grid, size, m);
    const score = penalty(grid, size);
    if (score < bestScore) { bestScore = score; best = grid; }
  }
  return { size, modules: best, version };
}

function functionMap(size, version) {
  const map = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x, y) => { if (x >= 0 && y >= 0 && x < size && y < size) map[y][x] = true; };
  for (const [cx, cy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) mark(cx + dx, cy + dy);
  }
  for (let i = 0; i < size; i++) { mark(i, 6); mark(6, i); }
  for (const cy of ALIGNMENT[version]) for (const cx of ALIGNMENT[version]) {
    if ((cx <= 8 && cy <= 8) || (cx <= 8 && cy >= size - 9) || (cx >= size - 9 && cy <= 8)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(cx + dx, cy + dy);
  }
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(size - 1 - i, 8); mark(8, size - 1 - i); }
  if (version >= 7) for (let i = 0; i < 18; i++) { const a = Math.floor(i / 3), b = (i % 3) + size - 11; mark(b, a); mark(a, b); }
  return map;
}

function applyFormat(grid, size, mask) {
  const data = (0b00 << 3) | mask;                     // 00 = error correction level M
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  for (let i = 0; i <= 5; i++) grid[i][8] = ((bits >> i) & 1) === 1;
  grid[7][8] = ((bits >> 6) & 1) === 1;
  grid[8][8] = ((bits >> 7) & 1) === 1;
  grid[8][7] = ((bits >> 8) & 1) === 1;
  for (let i = 9; i < 15; i++) grid[8][14 - i] = ((bits >> i) & 1) === 1;
  for (let i = 0; i < 8; i++) grid[8][size - 1 - i] = ((bits >> i) & 1) === 1;
  for (let i = 8; i < 15; i++) grid[size - 15 + i][8] = ((bits >> i) & 1) === 1;
  grid[size - 8][8] = true;
}

function penalty(grid, size) {
  let score = 0;
  const run = (get) => {
    for (let a = 0; a < size; a++) {
      let last = null, len = 0;
      for (let b = 0; b < size; b++) {
        const v = get(a, b);
        if (v === last) { len++; if (len === 5) score += 3; else if (len > 5) score += 1; }
        else { last = v; len = 1; }
      }
    }
  };
  run((y, x) => grid[y][x]); run((x, y) => grid[y][x]);
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const v = grid[y][x];
    if (v === grid[y][x + 1] && v === grid[y + 1][x] && v === grid[y + 1][x + 1]) score += 3;
  }
  const pattern = [true, false, true, true, true, false, true];
  const hasAt = (get, a, b) => {
    for (let i = 0; i < 7; i++) if (get(a, b + i) !== pattern[i]) return false;
    const before = [b - 4, b - 3, b - 2, b - 1].every(i => i < 0 || get(a, i) === false);
    const after = [b + 7, b + 8, b + 9, b + 10].every(i => i >= size || get(a, i) === false);
    return before || after;
  };
  for (let a = 0; a < size; a++) for (let b = 0; b <= size - 7; b++) {
    if (hasAt((y, x) => grid[y][x], a, b)) score += 40;
    if (hasAt((x, y) => grid[y][x], a, b)) score += 40;
  }
  let dark = 0;
  for (const row of grid) for (const v of row) if (v) dark++;
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

/**
 * Draws into a canvas at an exact whole number of pixels per module — anything
 * else resamples and blurs the edges, which is what actually breaks a scan.
 */
export function drawQr(canvas, text, { cssSize = 220, quiet = 4, dark = '#000000', light = '#FFFFFF' } = {}) {
  const { size, modules } = encode(text);
  const total = size + quiet * 2;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const scale = Math.max(1, Math.floor((cssSize * dpr) / total));
  const px = total * scale;
  canvas.width = px; canvas.height = px;
  canvas.style.width = `${Math.round(px / dpr)}px`;
  canvas.style.height = `${Math.round(px / dpr)}px`;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light; ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = dark;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (modules[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  }
  return { size, scale, pixels: px };
}

/** The same matrix, painted into someone else's canvas — used by the card image. */
export function paintQr(ctx, text, { x = 0, y = 0, box = 200, quiet = 4, dark = '#000000', light = '#FFFFFF' } = {}) {
  const { size, modules } = encode(text);
  const total = size + quiet * 2;
  const scale = Math.max(1, Math.floor(box / total));
  const drawn = total * scale;
  ctx.fillStyle = light; ctx.fillRect(x, y, drawn, drawn);
  ctx.fillStyle = dark;
  for (let my = 0; my < size; my++) for (let mx = 0; mx < size; mx++) {
    if (modules[my][mx]) ctx.fillRect(x + (mx + quiet) * scale, y + (my + quiet) * scale, scale, scale);
  }
  return drawn;
}
