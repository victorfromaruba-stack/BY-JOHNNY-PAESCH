// Making a photograph small enough to keep.
//
// A phone hands over a 4,000-pixel, three-megabyte JPEG. On a card it is shown at four hundred
// pixels wide, on a phone over island data. So it is drawn down to 1,600 on the long side and
// re-encoded before it goes anywhere — to the bucket on the real Circle, or into localStorage
// on the preview, where three megabytes would be the whole budget. Orientation is honoured, so
// a photo taken upright stays upright.

/** The file, as a JPEG blob no wider or taller than `max`. */
export async function shrinkImage(file, { max = 1600, quality = 0.82 } = {}) {
  const source = await decode(file);
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0, w, h);
  source.close?.();
  return new Promise((resolve, reject) => canvas.toBlob(
    (b) => (b ? resolve(b) : reject(new Error('Could not read that image'))), 'image/jpeg', quality));
}

/** A bitmap for the file, whichever way this browser can make one. */
async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* older engine, or a format it will not bitmap */ }
  try { return await createImageBitmap(file); } catch { /* fall through to an <img> */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('That is not an image this browser can read — JPEG, PNG or WebP, please')); img.src = url; });
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
  } finally { URL.revokeObjectURL(url); }
}

/** A blob as a data: URL — what the preview backend stores. */
export const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error || new Error('Could not read the image'));
  r.readAsDataURL(blob);
});

/**
 * DateTimeOriginal, OffsetTimeOriginal and Orientation from a JPEG's APP1 segment. Anything that is
 * not a JPEG with EXIF (a PNG, a WebP, a screenshot, a WhatsApp forward) resolves all-null, which is
 * the honest answer: the phone did not say.
 */
export async function readExifDate(file) {
  const none = { dateTimeOriginal: null, offset: null, orientation: null };
  try {
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return none;
    let p = 2;
    while (p + 4 <= v.byteLength) {
      if (v.getUint8(p) !== 0xFF) return none;
      const marker = v.getUint8(p + 1);
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { p += 2; continue; }
      const len = v.getUint16(p + 2);
      if (marker === 0xE1 && p + 10 <= v.byteLength && v.getUint32(p + 4) === 0x45786966) return parseTiff(v, p + 10, none);
      if (marker === 0xDA) return none;           // the image data starts: no EXIF came before it
      p += 2 + len;
    }
  } catch { /* unreadable: no claim */ }
  return none;
}
function parseTiff(v, start, none) {
  if (start + 8 > v.byteLength) return none;
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(o, le), u32 = (o) => v.getUint32(o, le);
  if (u16(start + 2) !== 42) return none;
  const out = { ...none };
  const str = (o, n) => { let s = ''; for (let i = 0; i < n && o + i < v.byteLength; i++) { const c = v.getUint8(o + i); if (!c) break; s += String.fromCharCode(c); } return s.trim(); };
  const readIfd = (off, tags) => {
    if (off + 2 > v.byteLength) return;
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12; if (e + 12 > v.byteLength) return;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const bytes = (({ 1: 1, 2: 1, 3: 2, 4: 4, 7: 1 })[type] || 0) * count;
      const at = bytes <= 4 ? e + 8 : start + u32(e + 8);      // small values sit inline, left-justified
      const fn = tags[tag]; if (fn) fn(at, count, type);
    }
  };
  let exifIfd = 0;
  readIfd(start + u32(start + 4), {
    0x0112: (o, c, t) => { if (t === 3) out.orientation = u16(o); },
    0x8769: (o) => { exifIfd = u32(o); },
  });
  if (exifIfd) readIfd(start + exifIfd, {
    0x9003: (o, c) => { out.dateTimeOriginal = str(o, c); },
    0x9011: (o, c) => { out.offset = str(o, c); },
  });
  return out;
}

/**
 * A postcard from a phone. The taken date is read off the ORIGINAL first; then the picture is
 * drawn down and re-encoded to JPEG — always, no exception for small files. Re-encoding through
 * the canvas is what makes a HEIC from an iPhone visible on every Android and desktop, what keeps a
 * season of postcards inside the club's 1 GB, and what strips every EXIF field including the GPS
 * position. The only thing kept from the phone is the date, on the row, and only when the phone
 * actually said it: with a zone ('exif'), as a bare day ('exif_day'), or as a fresh capture whose
 * file was made within two minutes of now ('camera'). Otherwise the row says nothing ('none').
 *
 * The size is the backend's call, never the view's: every caller passes store.postcardEncoding()
 * — 1200/0.8 on the preview, where the card lives in localStorage, and 2048/0.85 on Supabase,
 * where the private bucket takes 8 MB and the re-encode at that size is what strips the EXIF.
 * The defaults below are only what a caller that forgot would get.
 */
export async function readPostcard(file, { max = 2048, quality = 0.85, captured = false } = {}) {
  const exif = await readExifDate(file);
  let takenAt = null, takenFrom = 'none';
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(exif.dateTimeOriginal || '');
  if (m) {
    const [, Y, Mo, D, h, mi, s] = m;
    const off = /^[+-]\d{2}:\d{2}$/.test(exif.offset || '') ? exif.offset : null;
    const exact = off ? new Date(`${Y}-${Mo}-${D}T${h}:${mi}:${s}${off}`) : null;
    if (exact && !Number.isNaN(exact.getTime())) { takenAt = exact.toISOString(); takenFrom = 'exif'; }
    else {
      // A wall clock in an unknown zone: keep the day, as midnight in Aruba, and print only the day.
      const dayStart = new Date(`${Y}-${Mo}-${D}T00:00:00-04:00`);
      if (!Number.isNaN(dayStart.getTime())) { takenAt = dayStart.toISOString(); takenFrom = 'exif_day'; }
    }
  } else if (captured && Number.isFinite(file.lastModified) && Math.abs(Date.now() - file.lastModified) < 120000) {
    takenAt = new Date(file.lastModified).toISOString(); takenFrom = 'camera';
  }
  let source;
  try { source = await decode(file); }
  catch { throw new Error('That is not a photograph this phone can read — JPEG, PNG or WebP, please'); }
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale)), h = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0, w, h);
  source.close?.();
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not read that image'))), 'image/jpeg', quality));
  return { blob, width: w, height: h, bytes: blob.size, mime: 'image/jpeg', takenAt, takenFrom };
}
