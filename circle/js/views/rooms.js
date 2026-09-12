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

/** Every photograph on file for a stay, the property's and the Desk's, in one shape. */
export function roomPhotosFor(stay, place) {
  const bundled = (place?.photos || []).map((ph, i) => ({
    key: `b${i}`, src: `assets/${ph.file}`, thumb: `assets/${ph.thumb || ph.file}`, alt: ph.alt || ph.what || '', room: ph.room || null,
    // `kind` is what the picture IS: a photograph of a room, of the property, or the property's
    // own floor plan. A plan is drawn, not shot, so it is never cropped and never captioned as
    // a photograph — it is the answer to "what is the shape of the room".
    kind: ph.kind || (ph.room ? 'room' : 'property'), caption: ph.what && ph.what !== 'room' ? ph.what : (ph.alt || ''),
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
  const rooms = (place?.rooms || []).map((r) => {
    const keys = [normName(r.name), r.catalogName ? normName(r.catalogName) : null].filter(Boolean);
    const photos = keys.flatMap(k => byRoom.get(k) || []).sort(order);
    for (const k of keys) byRoom.delete(k);
    const bits = [r.sqft ? `${r.sqft.toLocaleString('en-US')} sq ft` : r.sqm ? `${r.sqm} m²` : '', r.sleeps ? `sleeps ${r.sleeps}` : '', r.beds || '', r.view || ''].filter(Boolean);
    return { name: r.name, bits, description: r.description || '', photos };
  });
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
      <p class="tiny muted" style="margin-top:12px">${photos.some(p => !p.own) ? 'The property’s own pictures, shown so you know the room you are asking for. They are the property’s copyright.' : 'Photographs the Circle holds the rights to, with where each came from.'}</p>`;
  } });
}
