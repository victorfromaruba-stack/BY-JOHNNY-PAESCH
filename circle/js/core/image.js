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
