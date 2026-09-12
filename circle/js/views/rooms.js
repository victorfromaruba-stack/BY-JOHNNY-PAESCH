// The rooms of a place, and the pictures of them.
//
// Two sources, one shape. The bundled dossier (data/places.js) carries the property's own
// photographs, fetched from its site with robots.txt honoured and each recorded with the page and
// the day it was seen. The Desk adds its own on top — pictures it holds the rights to, filed on
// the stay with a note saying where they came from. A member sees both in one strip per room,
// every photograph on file, and the caption says which is which. Nothing here is generated, and
// a room nobody lists is not on the list.

import { escapeHtml, fmtDay } from '../core/util.js';
import { normName } from '../core/names.js';
import { sheet } from '../ui/components.js';

const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; } };

/** Alt text that is machine leavings rather than words: a filename, an og:image marker, a blank. */
const JUNK_ALT = /^(og:image|image|photo|picture|untitled)$|^\s*$|\.(jpe?g|png|webp|avif)$/i;
/**
 * What a member should read under a picture.
 *
 * `photos[].what` is the dossier's own note, and on everything filed before 12 September it is a
 * CURATOR's note — "…; 1920x1078, landscape, no visible people", "use as fallback if the 1920px
 * aerial fails". Printing that to a member leaks our filing decisions and reads as machine
 * output, so only the records that carry `kind` (written with a caption for a person) use it.
 * Everything else falls back to the property's own alt text, and where that is a filename or an
 * og:image marker, to nothing — the caller then names the room, which is what a member needs.
 */
const captionOf = (ph) => {
  const written = ph.kind ? String(ph.what || '').trim() : '';
  if (written) return written;
  const alt = String(ph.alt || '').trim();
  return JUNK_ALT.test(alt) ? '' : alt;
};

/** Every photograph on file for a stay, the property's and the Desk's, in one shape. */
export function roomPhotosFor(stay, place) {
  const bundled = (place?.photos || []).map((ph, i) => ({
    key: `b${i}`, src: `assets/${ph.file}`, thumb: `assets/${ph.thumb || ph.file}`, alt: captionOf(ph) || ph.room || '', room: ph.room || null,
    // `kind` is what the picture IS: a photograph of a room, of the property, or the property's
    // own floor plan. A plan is drawn, not shot, so it is never cropped and never captioned as
    // a photograph — it is the answer to "what is the shape of the room".
    kind: ph.kind || (ph.room ? 'room' : 'property'), caption: captionOf(ph),
    from: hostOf(ph.page || ph.source), page: ph.page || ph.source || '', seenOn: ph.seenOn || null, own: false,
  }));
  const own = (Array.isArray(stay?.gallery) ? stay.gallery : []).filter(g => g && g.url).map((g) => ({
    key: `o${g.id}`, id: g.id, src: g.url, thumb: g.url, alt: g.room ? `${g.room} at ${stay.name}` : stay.name, room: g.room || null,
    kind: g.room ? 'room' : 'property', caption: '', from: '', page: '', note: g.note || '', seenOn: g.at || null, own: true,
  }));
  // The Desk's own pictures first: they are the most recent, and they are the ones it chose.
  return [...own, ...bundled];
}

/**
 * The sizes at a resort that publishes no room list of its own, worked out from the units owners
 * actually have there — the same VakayMood record the rest of the dossier comes from. It is the
 * only honest room list for the three Marriott houses, whose own site refuses a scripted read:
 * every figure below is a figure an owner filed against a real week, and where owners disagree
 * the page says the range rather than picking one.
 */
function roomsFromUnits(units) {
  const by = new Map();
  for (const u of units || []) {
    const key = String(u.name || '').trim(); if (!key) continue;
    const g = by.get(key) || { name: key, bedrooms: u.bedrooms ?? null, sleeps: [], baths: [], kitchens: new Set(), views: new Set() };
    if (Number.isFinite(u.sleeps)) g.sleeps.push(u.sleeps);
    if (Number.isFinite(u.bathrooms)) g.baths.push(u.bathrooms);
    if (u.kitchen) g.kitchens.add(String(u.kitchen).toLowerCase());
    if (u.view && !/^varies$/i.test(u.view)) g.views.add(String(u.view).toLowerCase());
    by.set(key, g);
  }
  const span = (xs, one, many) => { if (!xs.length) return ''; const lo = Math.min(...xs), hi = Math.max(...xs); return lo === hi ? `${one} ${lo}` : `${one} ${lo}–${hi}`; };
  const list = (set) => [...set].sort();
  return [...by.values()].sort((a, b) => (a.bedrooms ?? 9) - (b.bedrooms ?? 9)).map(g => ({
    name: g.name,
    bits: [span(g.sleeps, 'sleeps'), g.baths.length ? `${Math.min(...g.baths) === Math.max(...g.baths) ? Math.min(...g.baths) : `${Math.min(...g.baths)}–${Math.max(...g.baths)}`} bath${Math.max(...g.baths) > 1 ? 's' : ''}` : '', list(g.kitchens).join(' or ')].filter(Boolean),
    description: g.views.size ? `Outlooks owners have filed for this size: ${list(g.views).join(', ')}.` : '',
    photos: [],
  }));
}

/**
 * The rooms as the property lists them, each with its photographs; then any room the Desk has
 * photographed that the property's list does not carry. Sizes and sleeps are the property's own
 * published figures — a blank is a blank.
 */
export function roomsOf(stay, place) {
  const pics = roomPhotosFor(stay, place);
  const byRoom = new Map();
  for (const ph of pics) if (ph.room) (byRoom.get(normName(ph.room)) || byRoom.set(normName(ph.room), []).get(normName(ph.room))).push(ph);
  // A plan first: it is the shape of the room, and it is what the rest of the strip is of.
  const order = (a, b) => (b.kind === 'plan' ? 1 : 0) - (a.kind === 'plan' ? 1 : 0);
  // A resort that publishes no room list of its own still has sizes: the units owners hold there.
  const fromUnits = !(place?.rooms || []).length && (place?.units || []).length ? roomsFromUnits(place.units) : null;
  const rooms = (fromUnits || place?.rooms || []).map((r) => {
    if (fromUnits) {
      const photos = [normName(r.name)].flatMap(k => byRoom.get(k) || []).sort(order);
      byRoom.delete(normName(r.name));
      return { ...r, photos, fromUnits: true };
    }
    return null;
  }).filter(Boolean).concat(fromUnits ? [] : (place?.rooms || []).map((r) => {
    const keys = [normName(r.name), r.catalogName ? normName(r.catalogName) : null].filter(Boolean);
    const photos = keys.flatMap(k => byRoom.get(k) || []).sort(order);
    for (const k of keys) byRoom.delete(k);
    const bits = [r.sqft ? `${r.sqft.toLocaleString('en-US')} sq ft` : r.sqm ? `${r.sqm} m²` : '', r.sleeps ? `sleeps ${r.sleeps}` : '', r.beds || '', r.view || ''].filter(Boolean);
    return { name: r.name, bits, description: r.description || '', photos };
  }));
  for (const [, photos] of byRoom) rooms.push({ name: photos[0].room, bits: [], description: '', photos: photos.sort(order) });
  // Pictures that are plainly of a room, where the property does not say which one. They are not
  // the property, and naming them would be inventing — so they go last, under their own heading,
  // with no "ask for this one" button, because there is nothing to ask for by name.
  const inside = pics.filter(ph => ph.kind === 'inside');
  if (inside.length) rooms.push({ name: 'Inside the rooms', bits: [], description: 'Rooms the property photographs but does not name.', photos: inside, unnamed: true });
  return rooms;
}

/** A swipeable strip of photographs; each tile opens the sheet on that picture. */
export function galleryStrip(photos, { room = '' } = {}) {
  return `<div class="gallery big" role="list" data-strip="${escapeHtml(String(room))}">${photos.map((ph, i) => `
    <button type="button" class="gallery-tile${ph.kind === 'plan' ? ' plan' : ''}" role="listitem" data-photo="${i}" aria-label="${escapeHtml(ph.kind === 'plan' ? `Floor plan: ${ph.caption || ph.alt}` : (ph.caption || ph.alt || 'A photograph'))}">
      <img src="${escapeHtml(ph.thumb)}" alt="" loading="lazy" decoding="async">${ph.own ? '<span class="tile-tag">Ours</span>' : ph.kind === 'plan' ? '<span class="tile-tag">Plan</span>' : ''}</button>`).join('')}</div>`;
}

/** Every picture of a room, full size, each with where it came from. */
export function roomPhotoSheet(title, photos) {
  return sheet({ title, wide: true, render: (body) => {
    body.innerHTML = `<div class="stack">${photos.map(ph => `
      <figure class="place-photo${ph.kind === 'plan' ? ' plan' : ''}"><img src="${escapeHtml(ph.src)}" alt="${escapeHtml(ph.caption || ph.alt || title)}" loading="lazy" decoding="async">
        <figcaption class="tiny muted">${ph.own
          ? `${escapeHtml(ph.note || 'The Circle’s own photograph')}${ph.seenOn ? ` · ${escapeHtml(fmtDay(ph.seenOn))}` : ''}`
          : `${ph.kind === 'plan' && !/plan/i.test(ph.caption || ph.alt || '') ? 'The property’s own plan. ' : ''}${escapeHtml(ph.caption || ph.alt || ph.room || 'The property')}${ph.from ? ` · from ${escapeHtml(ph.from)}` : ''}${ph.seenOn ? `, seen ${escapeHtml(fmtDay(ph.seenOn))}` : ''}`}</figcaption></figure>`).join('')}</div>
      <p class="tiny muted" style="margin-top:12px">${photos.every(p => p.own)
        ? 'Photographs the Circle holds the rights to, with where each came from.'
        : photos.some(p => p.own)
          ? 'The ones marked Ours are the Circle’s own, with where each came from; the rest are the property’s, shown so you know the room you are asking for, and they are the property’s copyright.'
          : 'The property’s own pictures, shown so you know the room you are asking for. They are the property’s copyright.'}</p>`;
  } });
}
