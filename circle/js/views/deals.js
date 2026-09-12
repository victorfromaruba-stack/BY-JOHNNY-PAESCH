// Deals — the card, the list, the sheets the Desk posts with, and the watch list that decides
// who hears about them.
//
// The whole point is speed. Victor sees a one-bedroom appear on Interval at eleven at night; by
// the time he has typed four fields, every Insider who asked for that exact thing has it on
// their home screen. Nothing here books anything — a deal turns into a request, and a request
// goes through the same quote the rest of the app uses.
//
// There is no Deals page any more. The Stays tab IS the deals — every live one, cheapest a
// night first — and this module is what it draws them with.

import { escapeHtml, fmtDay, fmtPoints, fmtRelative, fmtUsd2, nightsBetween, pointsUsd, safeUrl } from '../core/util.js';
import { VOCAB } from '../core/vocab.js';
import { quoteStay, fromPoints, seatPoints, isCruise } from '../core/money.js';
import { icon } from '../ui/icons.js';
import { toast, sheet, confirmDialog, setBusy, avatar } from '../ui/components.js';
import { stayStrip, thumbFor, beachMark, photoFor, photoKind, photoCredit } from './public.js';
import { sameName, nameWithin } from '../core/names.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };

export const SOURCES = Object.freeze({
  interval: { label: 'Interval', icon: 'refresh', note: 'An exchange or a Getaway on Interval International' },
  redweek:  { label: 'RedWeek', icon: 'tag', note: 'An owner renting their week directly' },
  iberostar:{ label: 'Iberostar', icon: 'idCard', note: 'The employee rate' },
  airbnb:   { label: 'Airbnb', icon: 'home', note: 'A whole place, usually by the week' },
  vrbo:     { label: 'Vrbo', icon: 'home', note: 'A whole place, usually by the week' },
  hotel:    { label: 'Direct', icon: 'phone', note: 'Straight from the hotel, on our rate' },
  member:   { label: 'An Insider', icon: 'users', note: 'Someone in the Circle passed it on' },
  vakaymood:{ label: 'VakayMood', icon: 'eye', note: 'An owner renting their week, booked through VakayMood' },
  other:    { label: 'Elsewhere', icon: 'compass', note: '' },
});

const sourceChip = (s) => {
  const src = SOURCES[s] || SOURCES.other;
  return `<span class="tag">${icon(src.icon, { size: 14 })}${escapeHtml(src.label)}</span>`;
};

/**
 * A deal's title without the place in front of it. The watcher writes "Marriott's Aruba Surf
 * Club · Studio Queen · owner asking $166 a night on RedWeek"; under a heading that already says
 * Surf Club, the first part is the heading again, three lines of it on a phone.
 */
export function titleWithoutPlace(title, stay, { nights = 0 } = {}) {
  const names = (a, b) => sameName(a, b) || nameWithin(a, b) || nameWithin(b, a);
  const parts = String(title || '').split(' · ').map(x => x.trim()).filter(Boolean);
  // The watcher titles a find with the source's own spelling of the place, which may be longer
  // or shorter than the catalog's ("Aruba Surf Club", "Renaissance Aruba Resort & Casino").
  const rest = parts.length > 1 && stay && names(parts[0], stay.name) ? parts.slice(1).join(' · ') : (title || '');
  // A deal posted by hand is titled with the place, so under the place's own heading there
  // would be nothing left: say the length rather than the heading again.
  if (!rest || (stay && names(rest, stay.name))) return nights ? `${nights} night${nights === 1 ? '' : 's'}` : 'Posted by the Desk';
  return rest;
}

/** Points a night, from the row or from the total: older rows and some backends carry only the total. */
export const nightly = (d) => d?.pointsPerNight || (d?.pointsTotal && d?.nights ? Math.round(d.pointsTotal / d.nights) : 0);

/** "25 Sept – 2 Oct", the year only when it is not this one — a row has no room for four digits twice. */
export function shortRange(from, to) {
  const d = (iso) => new Date(`${iso}T12:00:00Z`);
  const y = new Date().getFullYear();
  const a = d(from), b = d(to);
  const f = (x, withYear) => x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC', ...(withYear ? { year: 'numeric' } : {}) });
  const sameYear = a.getUTCFullYear() === y && b.getUTCFullYear() === y;
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) return `${a.getUTCDate()} – ${f(b, !sameYear)}`;
  return `${f(a, false)} – ${f(b, !sameYear)}`;
}

/**
 * The page for the place a deal is at, opened ON that week: the stay page pins the deal at the
 * top of "Open right now", prices those exact nights, and shows the rooms and the map before
 * anyone commits points. A row on the board goes here; the Ask button goes straight to the ask.
 */
export function placeHrefFor(deal, stay) {
  const seg = stay?.kind === 'trip' ? (isCruise(stay) ? 'cruises' : 'trips') : 'stays';
  return `#/${seg}/${escapeHtml(deal.stayId)}?from=${escapeHtml(deal.from)}&to=${escapeHtml(deal.to)}&deal=${encodeURIComponent(deal.id)}`;
}
/** The ask link for a deal: a posted one carries its id; an owner's week carries the listing link. */
export function askHrefFor(deal) {
  return deal.draft
    ? `#/book/${escapeHtml(deal.stayId)}?from=${escapeHtml(deal.from)}&to=${escapeHtml(deal.to)}${safeUrl(deal.sourceUrl) ? `&src=${encodeURIComponent(deal.sourceUrl)}&srcLabel=${encodeURIComponent('VakayMood')}` : ''}`
    : `#/book/${escapeHtml(deal.stayId)}?from=${escapeHtml(deal.from)}&to=${escapeHtml(deal.to)}&deal=${escapeHtml(deal.id)}`;
}

/**
 * Who or what saw it, and when — the mono mark every row carries. "VM · 14:20" for an owner's
 * week read off VakayMood at that minute; "Victor · 11 Sep 09:10" for a find a person posted.
 * Because one man books everything and the app may not invent a fact, provenance is set in
 * the same face as the ledger's "by Vishnu": the board and the statement are one instrument.
 */
export function stampFor(deal, store) {
  const t = deal.postedAt ? new Date(deal.postedAt) : null;
  const hhmm = t ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const day = t ? t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
  if (deal.draft) return { text: `VM · ${hhmm}`, feed: true };
  const who = store.member?.(deal.postedBy)?.name.split(' ')[0] || (SOURCES[deal.source] || SOURCES.other).label;
  return { text: [who, day && hhmm ? `${day} ${hhmm}` : day || hhmm].filter(Boolean).join(' · '), feed: false };
}

/**
 * One deal as a listing row: the row is the ask. A thumb only where a photograph of the place
 * exists (never a beach photo at 56px), a folio number for its rank on the board, the title, the
 * dates and the stamp, and the price a night on the right with the all-in under it. `inPlace`
 * drops the thumb and the place from the title, for rows under a place's own heading.
 */
export function dealRow(deal, { store, folio = null, match = null, canEdit = false, inPlace = false, level = 3, picked = false } = {}) {
  const H = `h${Math.min(6, Math.max(2, level))}`;
  const s = store.settings;
  const stay = store.stay(deal.stayId);
  const draft = !!deal.draft;
  const thumb = inPlace ? null : thumbFor(stay);
  const title = inPlace ? titleWithoutPlace(deal.title, stay, { nights: deal.nights }) : (deal.title || stay?.name || 'A deal');
  const stamp = stampFor(deal, store);
  const soon = soonLabel(deal.from);
  const node = el(`<article class="listing-row${inPlace ? ' no-thumb' : ''}${match ? ' asked' : ''}${picked ? ' picked' : ''}" data-deal="${escapeHtml(deal.id)}">
      ${inPlace ? '' : `<span class="thumb" aria-hidden="true">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async">` : `<b>${escapeHtml(beachMark(stay))}</b>`}</span>`}
      <span class="main" style="min-width:0">
        <span class="folio">${picked ? `<span class="asked">${icon('check', { size: 12 })}The week you picked</span>` : match ? `<span class="asked">${icon('bellRing', { size: 12 })}You asked for this</span>` : folio ? `No. ${folio}` : ''}</span>
        <${H}><a class="row-link" href="${inPlace ? askHrefFor(deal) : placeHrefFor(deal, stay)}">${escapeHtml(title)}</a></${H}>
        <span class="sub">${soon ? `<span class="soon">${escapeHtml(soon)}</span> · ` : ''}${escapeHtml(shortRange(deal.from, deal.to))} · ${deal.nights}&nbsp;night${deal.nights === 1 ? '' : 's'}<span class="l2">${deal.sleeps ? `sleeps ${deal.sleeps} · ` : ''}<span class="stamp${stamp.feed ? ' feed' : ''}">${escapeHtml(stamp.text)}</span></span></span>
      </span>
      <span class="price-col"><b>${escapeHtml(fmtPoints(nightly(deal)))}</b><small>a night</small><span class="all">${escapeHtml(fmtPoints(deal.pointsTotal))} all in<span class="usd"> · ${escapeHtml(pointsUsd(deal.pointsTotal, s.pointsPerDollar))}</span></span></span>
      ${inPlace && !canEdit ? `<span class="go" aria-hidden="true">${icon('chevronRight', { size: 18 })}</span>` : ''}
      ${canEdit ? `<span class="row-acts">
        ${safeUrl(deal.sourceUrl) ? `<a class="btn ghost sm" href="${escapeHtml(safeUrl(deal.sourceUrl))}" target="_blank" rel="noopener noreferrer">${icon('external', { size: 15 })}Go and book it</a>` : ''}
        ${draft ? `<button class="btn quiet sm" data-act="post-draft">${icon('plus', { size: 15 })}Put it on the board</button>` : `<button class="btn quiet sm" data-act="retire">${icon('x', { size: 15 })}Gone</button>`}</span>` : ''}
    </article>`);
  return node;
}

/**
 * The cover: the cheapest week on the market, its photograph — of this place, or the beach it is
 * on, tagged — with the price set on it, and the story under it. Where there is no photograph
 * at all the plate stands in and the price moves into the body.
 */
export function dealCover(deal, { store, canEdit = false, match = null, folio = 1 } = {}) {
  const s = store.settings;
  const stay = store.stay(deal.stayId);
  const draft = !!deal.draft;
  const kind = photoKind(stay);
  const photo = photoFor(stay);
  const credit = kind === 'area' ? photoCredit(stay) : null;
  const stamp = stampFor(deal, store);
  const soon = soonLabel(deal.from);
  const who = store.member?.(deal.postedBy)?.name.split(' ')[0];
  const why = draft
    ? `Owner’s week on VakayMood${deal.sleeps ? ` · sleeps ${deal.sleeps}` : ''}${deal.usdNightly ? ` · the owner asks ${fmtUsd2(deal.usdNightly)} a night` : ''}`
    : `${(SOURCES[deal.source] || SOURCES.other).label}${who ? ` · found by ${who}` : ''}${deal.note ? ` · ${deal.note}` : ''}`;
  const node = el(`<article class="cover${photo ? '' : ' plate'}${match ? ' matched' : ''}" data-deal="${escapeHtml(deal.id)}">
      <a class="cover-shot" href="${placeHrefFor(deal, stay)}" aria-label="${escapeHtml(stay?.name || 'The place')}: the rooms, the map and this week">
        <span class="cover-scrim" aria-hidden="true"></span>
        <span class="eyebrow cover-no">No. ${folio}</span>
        <span class="cover-price"><span class="num">${escapeHtml(fmtPoints(nightly(deal)))}</span><small>a night</small></span>
      </a>
      <div class="cover-body">
        ${match ? `<p class="eyebrow" style="color:var(--good-text)">${icon('bellRing', { size: 15 })}You asked for this</p>` : ''}
        <h2><a class="cover-link" href="${placeHrefFor(deal, stay)}">${escapeHtml(deal.title || stay?.name || 'A deal')}</a></h2>
        <span class="mono">${escapeHtml(shortRange(deal.from, deal.to))} · ${deal.nights}&nbsp;night${deal.nights === 1 ? '' : 's'} · ${escapeHtml(fmtPoints(deal.pointsTotal))} all in · ${escapeHtml(pointsUsd(deal.pointsTotal, s.pointsPerDollar))}</span>
        ${soon ? `<p class="soon">${icon('zap', { size: 15 })}${escapeHtml(soon)}</p>` : ''}
        <p class="why">${escapeHtml(why)} · <span class="stamp${stamp.feed ? ' feed' : ''}">${escapeHtml(stamp.text)}</span></p>
        ${credit ? `<p class="tiny muted" style="margin-top:8px">${credit.html}</p>` : ''}
        <div class="row" style="margin-top:14px">
          <a class="btn" href="${askHrefFor(deal)}">${icon('send', { size: 16 })}Ask Victor</a>
          ${canEdit && safeUrl(deal.sourceUrl) ? `<a class="btn ghost sm" href="${escapeHtml(safeUrl(deal.sourceUrl))}" target="_blank" rel="noopener noreferrer">${icon('external', { size: 15 })}Go and book it</a>` : ''}
          ${canEdit ? (draft ? `<button class="btn quiet sm" data-act="post-draft">${icon('plus', { size: 15 })}Put it on the board</button>` : `<button class="btn quiet sm" data-act="retire">${icon('x', { size: 15 })}Gone</button>`) : ''}
        </div>
      </div>
    </article>`);
  const shot = node.querySelector('.cover-shot');
  shot.prepend(stayStrip(stay));
  return node;
}

/**
 * One deal, as a card. `match` is set when it answers something this member asked for.
 * `inPlace` is for a card that sits under its place's own heading — no photograph strip, no
 * area line, no place in the title — so twenty of them read as a list, not twenty posters.
 */
/** Days from today (Aruba) to a check-in day; 0 is today, negative is gone. */
export const daysUntil = (isoDay) => {
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Aruba' }) + 'T12:00:00Z');
  return Math.round((Date.parse(`${isoDay}T12:00:00Z`) - today.getTime()) / 864e5);
};
/** "Checks in today", "tomorrow", "in 3 days" — only inside the week, when it changes what you do. */
export const soonLabel = (isoDay) => {
  const n = daysUntil(isoDay);
  if (n < 0 || n > 7) return '';
  return n === 0 ? 'Checks in today' : n === 1 ? 'Checks in tomorrow' : `Checks in ${n} days`;
};

export function dealCard(deal, { store, match = null, canEdit = false, inPlace = false, level = 3, showPlace = false } = {}) {
  // Under a place's own h3 the card's title is an h4, so a screen reader moving by heading
  // hears places and the weeks under them as parent and child, not as peers.
  const H = `h${Math.min(6, Math.max(2, level))}`;
  const stay = store.stay(deal.stayId);
  const saveUsd = deal.retailUsd ? deal.retailUsd - deal.pointsTotal / store.settings.pointsPerDollar : 0;
  const title = inPlace ? titleWithoutPlace(deal.title, stay, { nights: deal.nights }) : null;
  // An owner's week open on VakayMood is not on the board: the ask carries the listing link
  // instead of a deal id, and the Desk's button puts it on the board rather than taking it off.
  const draft = !!deal.draft;
  const askHref = draft
    ? `#/book/${escapeHtml(deal.stayId)}?from=${escapeHtml(deal.from)}&to=${escapeHtml(deal.to)}${safeUrl(deal.sourceUrl) ? `&src=${encodeURIComponent(deal.sourceUrl)}&srcLabel=${encodeURIComponent('VakayMood')}` : ''}`
    : `#/book/${escapeHtml(deal.stayId)}?from=${escapeHtml(deal.from)}&to=${escapeHtml(deal.to)}&deal=${escapeHtml(deal.id)}`;
  // The watcher's note repeats the unit the title already names ("Studio Queen · sleeps 4 ·
  // RedWeek protects the payment"); under a place, keep only what the title does not say.
  const noteLine = (() => {
    const n = String(deal.note || '').trim(); if (!n) return '';
    if (!inPlace) return n;
    const parts = n.split(' · ').map(x => x.trim()).filter(Boolean);
    const t = String(title || '').toLowerCase();
    return parts.filter(x => !t.includes(x.toLowerCase())).join(' · ');
  })();
  const node = el(`<article class="panel deal${match ? ' matched' : ''}${inPlace ? ' in-place' : ''}" data-deal="${escapeHtml(deal.id)}">
      ${inPlace ? '' : '<div class="deal-strip"></div>'}
      <div class="deal-body">
        ${match ? `<p class="eyebrow" style="color:var(--good-text)">${icon('bellRing', { size: 15 })}You asked for this</p>` : ''}
        ${showPlace && stay ? `<p class="eyebrow"><a href="#/stays/${escapeHtml(stay.id)}" style="color:inherit;text-decoration:none">${escapeHtml(stay.name)}</a>${stay.area ? ` · ${escapeHtml(stay.area)}` : ''}</p>` : ''}
        ${inPlace
          ? `<${H} style="font-size:1.02rem">${escapeHtml(title)}</${H}>
             <p class="deal-price"><b class="num">${escapeHtml(fmtPoints(deal.pointsTotal))}</b>
               <span class="small muted mono">${escapeHtml(pointsUsd(deal.pointsTotal, store.settings.pointsPerDollar))} · ${deal.nights} night${deal.nights === 1 ? '' : 's'}${nightly(deal) ? ` · ${escapeHtml(fmtPoints(nightly(deal)))} a night` : ''}</span></p>`
          : `<div class="row-between" style="align-items:flex-start;gap:12px">
          <div>
            <${H} style="font-size:1.05rem">${escapeHtml(deal.title || stay?.name || 'A deal')}</${H}>
            <p class="small muted" style="margin-top:4px">${escapeHtml(stay?.area || '')}${stay && stay.country !== 'Aruba' ? `, ${escapeHtml(stay.country)}` : ''}</p>
          </div>
          <div style="text-align:right;flex:none">
            <b class="num" style="font-size:1.15rem">${escapeHtml(fmtPoints(deal.pointsTotal))}</b>
            <br><span class="small muted">${escapeHtml(pointsUsd(deal.pointsTotal, store.settings.pointsPerDollar))} · ${deal.nights} night${deal.nights === 1 ? '' : 's'}${nightly(deal) ? ` · ${escapeHtml(fmtPoints(nightly(deal)))} a night` : ''}</span>
          </div>
        </div>`}
        ${soonLabel(deal.from) ? `<p class="small soon" style="margin-top:${inPlace ? 8 : 10}px">${icon('zap', { size: 15 })}${soonLabel(deal.from)}</p>` : ''}
        <p class="small" style="margin-top:${soonLabel(deal.from) ? 4 : inPlace ? 8 : 10}px">${icon('calendar', { size: 15, cls: 'ico-muted' })}
          ${escapeHtml(fmtDay(deal.from))} – ${escapeHtml(fmtDay(deal.to))}
          ${deal.units > 1 && !draft ? ` · ${deal.units} of them` : ''}${saveUsd > 0 && inPlace ? ` <span style="color:var(--good-text)">· about ${escapeHtml(fmtUsd2(saveUsd))} under the public rate</span>` : ''}</p>
        ${saveUsd > 0 && !inPlace ? `<p class="small" style="margin-top:6px;color:var(--good-text)">${icon('trend', { size: 15 })}About ${escapeHtml(fmtUsd2(saveUsd))} under the resort's public rate</p>` : ''}
        ${noteLine ? `<p class="small muted" style="margin-top:${inPlace ? 6 : 10}px">${inPlace || draft ? escapeHtml(noteLine) : `“${escapeHtml(noteLine)}”`}</p>` : ''}
        ${inPlace
          ? `<p class="small muted deal-meta" style="margin-top:6px">${draft ? `Open on VakayMood as of ${escapeHtml(fmtRelative(deal.postedAt))}` : `${escapeHtml((SOURCES[deal.source] || SOURCES.other).label)} · ${escapeHtml(fmtRelative(deal.postedAt))}${deal.expiresAt ? ` · until ${escapeHtml(fmtDay(deal.expiresAt))}` : ''}`}</p>`
          : `<div class="flags" style="margin-top:10px">
          ${draft ? `<span class="tag">${icon('eye', { size: 14 })}Open on VakayMood</span>` : sourceChip(deal.source)}
          <span class="tag">${icon('clock', { size: 14 })}${draft ? 'as of ' : ''}${escapeHtml(fmtRelative(deal.postedAt))}</span>
          ${deal.expiresAt && !draft ? `<span class="tag">${icon('hourglass', { size: 14 })}until ${escapeHtml(fmtDay(deal.expiresAt))}</span>` : ''}
        </div>`}
        ${match && !match.affordable ? `<p class="small muted" style="margin-top:10px">${icon('spark', { size: 14 })}
          You are ${escapeHtml(fmtPoints(match.short))} short — ask anyway and close the gap with a top-up, or open it to the Circle.</p>` : ''}
        <div class="row" style="margin-top:14px">
          <a class="btn sm" href="${askHref}">${icon('send', { size: 16 })}Ask for it</a>
          ${canEdit && safeUrl(deal.sourceUrl) ? `<a class="btn ghost sm" href="${escapeHtml(safeUrl(deal.sourceUrl))}" target="_blank" rel="noopener noreferrer">${icon('external', { size: 16 })}Go and book it</a>` : ''}
          ${canEdit && draft ? `<button class="btn quiet sm" data-act="post-draft">${icon('plus', { size: 16 })}Put it on the board</button>` : ''}
          ${canEdit && !draft ? `<button class="btn quiet sm" data-act="retire">${icon('x', { size: 16 })}Gone</button>` : ''}
        </div>
      </div>
    </article>`);
  if (stay && !inPlace) node.querySelector('.deal-strip').appendChild(stayStrip(stay));
  return node;
}

// Which "Show the other N" buttons have been pressed. Module-level because the whole route is
// re-rendered on every store commit, and the Desk taking one week off the board must not fold
// the other nineteen back up.
const REVEALED = new Set();

// Cheapest a night first, then soonest. The same order the live section uses, so a member
// reading down either list is reading the same thing.
export const byNight = (a, b) => nightly(a) - nightly(b) || String(a.from).localeCompare(String(b.from));

/**
 * Some deals as cards, the first few shown and the rest behind one button. `key` is what the
 * button remembers itself by across re-renders; `first` is how many open with the page.
 */
export function dealList(slot, deals, { store, me = null, canEdit = false, first = 3, key = '', inPlace = true, noun = '', level = 3, showPlace = false, mode = 'cards', folioOf = null, wide = false, pin = null } = {}) {
  const watches = me ? store.watchesFor(me.id) : [];
  const matchFor = (d) => watches.map(w => store.dealMatchesWatch(d, w)).find(Boolean) || null;
  // What answers a watch comes first, whatever it costs: the two-bedroom somebody asked for is
  // rarely among the cheapest, and a card that says "You asked for this" must not sit behind
  // the button. Stable, so the given order holds within each half.
  const matched = new Map(deals.map(d => [d.id, matchFor(d)]));
  // The one the member tapped through on comes first of all, so the page they land on opens on
  // the week they picked and not on a cheaper one at the same place.
  const ordered = deals.slice().sort((a, b) => ((b.id === pin ? 2 : 0) + (matched.get(b.id) ? 1 : 0)) - ((a.id === pin ? 2 : 0) + (matched.get(a.id) ? 1 : 0)));
  const grid = el(mode === 'rows' ? `<div class="listing${wide ? ' two' : ''}"></div>` : '<div class="grid g2"></div>');
  const more = el('<div class="list-more"></div>');
  const paint = () => {
    // A button that hides one card costs as much as the card: show it.
    const shown = REVEALED.has(key) || ordered.length - first <= 1 ? ordered : ordered.slice(0, first);
    const hidden = ordered.length - shown.length;
    grid.replaceChildren(...shown.map(d => (mode === 'rows'
      ? dealRow(d, { store, folio: folioOf?.get(d.id) || null, match: matched.get(d.id), canEdit, inPlace, level, picked: d.id === pin })
      : dealCard(d, { store, match: matched.get(d.id), canEdit, inPlace, level, showPlace }))));
    more.innerHTML = hidden > 0 ? `<button class="btn ghost sm" data-act="reveal">${icon('chevronDown', { size: 16 })}Show the other ${hidden}${noun ? ` ${noun}` : ''}</button>` : '';
  };
  more.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="reveal"]')) return;
    REVEALED.add(key); paint();
    // The button that had focus is gone; put focus on the first card it revealed, so a keyboard
    // or screen-reader user lands on what appeared rather than back at the top of the page.
    const card = grid.children[first];
    if (card) { card.tabIndex = -1; card.focus({ preventScroll: true }); }
  });
  paint();
  slot.append(grid, more);
  return { grid, more };
}

/**
 * The Desk puts an owner's week on the board. Everyone watching for something it answers hears
 * about it straight away; the listing link rides along so Victor is one tap from it when asked.
 */
export async function postDraft(store, draft, actorId) {
  const yes = await confirmDialog({
    title: 'Put it on the board?',
    confirmText: 'Post it',
    message: `${draft.title} · ${draft.nights} nights from ${fmtDay(draft.from)} · ${fmtPoints(draft.pointsTotal)}. Everyone watching for something this answers hears about it straight away.`,
  });
  if (!yes) return null;
  const deal = await store.postDeal({
    stayId: draft.stayId, from: draft.from, to: draft.to, nights: draft.nights,
    pointsTotal: draft.pointsTotal, retailUsd: draft.usdTotal || null,
    source: 'vakaymood', sourceUrl: draft.sourceUrl, sourceRef: draft.sourceRef,
    title: draft.title,
    note: `Owner rental on VakayMood.${draft.usdSubtotal ? ` ${fmtUsd2(draft.usdSubtotal)} at booking, ${fmtUsd2(draft.usdFees || 0)} at the resort.` : ''}`,
    expiresAt: draft.expiresAt,
  }, actorId);
  const n = store.matchesForDeal(deal.id).length;
  toast(n ? `On the board. ${n} ${n === 1 ? 'Insider was' : 'Insiders were'} waiting for it.` : 'On the board.', { kind: 'good', timeout: 6000 });
  return deal;
}

/**
 * The two officer buttons on a card — "Gone" and "Put it on the board" — wired once on whatever
 * node holds the cards, so they are never buttons that do nothing. `drafts` resolves a draft's
 * id to the row the page holds (the card only carries the id).
 */
export function wireDealActions(node, store, { drafts = () => [] } = {}) {
  node.addEventListener('click', async (e) => {
    const retire = e.target.closest('[data-act="retire"]');
    if (retire) {
      const id = retire.closest('[data-deal]')?.dataset.deal;
      const yes = await confirmDialog({ title: 'Take it off the board?', confirmText: 'It is gone',
        message: 'It stays in the record, but it comes off the board for everyone.' });
      if (yes) { try { await store.retireDeal(id, store.me.id, 'Taken'); toast('Off the board.'); } catch (err) { toast(err.message, { kind: 'bad' }); } }
      return;
    }
    const post = e.target.closest('[data-act="post-draft"]');
    if (post) {
      const id = post.closest('[data-deal]')?.dataset.deal;
      const draft = drafts().find(d => d.id === id);
      if (!draft) return;
      try { await postDraft(store, draft, store.me.id); } catch (err) { toast(err.message, { kind: 'bad', timeout: 6000 }); }
    }
  });
}

/** Victor or Ian, posting something they just found. Four fields and it is on everyone's screen. */
export async function postDealSheet({ store, prefill = {} }) {
  const s = store.settings;
  const stays = [...store.arubaStays(), ...store.trips()];
  const out = await sheet({
    title: 'Post a deal',
    render: (body, close) => {
      body.innerHTML = `
        <p class="sheet-text">Everyone who asked for something this answers hears about it straight away. Be quick and rough — the binding number is still the quote you give them afterwards.</p>
        <label class="field"><span>Which place</span>
          <select name="stayId" required>${stays.map(st => `<option value="${escapeHtml(st.id)}"${st.id === prefill.stayId ? ' selected' : ''}>${escapeHtml(st.name)}${st.kind === 'trip' ? ' (trip)' : ''}</option>`).join('')}</select></label>
        <div class="grid g2">
          <label class="field"><span>From</span><input type="date" name="from" value="${escapeHtml(prefill.from || '')}" required></label>
          <label class="field"><span>To</span><input type="date" name="to" value="${escapeHtml(prefill.to || '')}" required></label>
        </div>
        <div class="grid g2">
          <label class="field"><span>All-in cost US$</span><input type="number" name="usd" step="1" min="1" inputmode="decimal" placeholder="1995" value="${escapeHtml(prefill.usd ?? '')}"></label>
          <label class="field"><span>In points</span><input type="number" name="points" step="100" min="1" inputmode="numeric" placeholder="199500" value="${escapeHtml(prefill.points ?? '')}"></label>
        </div>
        <div class="grid g2">
          <label class="field"><span>Where it came from</span>
            <select name="source">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}"${k === prefill.source ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}</select></label>
          <label class="field"><span>Public rate US$, if you know it</span><input type="number" name="retailUsd" step="1" min="0" inputmode="decimal" placeholder="2800"></label>
        </div>
        <label class="field"><span>Link to it</span><input type="url" name="sourceUrl" placeholder="https://…" value="${escapeHtml(prefill.sourceUrl || '')}"></label>
        <label class="field"><span>Anything the Circle should know</span><input name="note" placeholder="Lighthouse tower, owner rental, Saturday to Saturday." value="${escapeHtml(prefill.note || '')}"></label>
        <div id="who" class="notice" style="margin-top:4px"></div>
        <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>${icon('send', { size: 16 })}Post it</button></div>`;

      const v = (n) => body.querySelector(`[name=${n}]`);

      // Dollars and points stay in step, the way they do everywhere else in the Desk.
      body.addEventListener('input', (e) => {
        if (e.target.name === 'usd') v('points').value = Math.round((Number(e.target.value) || 0) * s.pointsPerDollar);
        if (e.target.name === 'points') v('usd').value = ((Math.round(Number(e.target.value) || 0)) / s.pointsPerDollar).toFixed(2);
        preview();
      });

      // Say, before he posts, exactly who is about to hear about it.
      const preview = () => {
        const draft = { id: 'draft', status: 'live', stayId: v('stayId').value, roomTypeId: null,
          kind: store.stay(v('stayId').value)?.kind === 'trip' ? 'trip' : 'aruba',
          from: v('from').value, to: v('to').value,
          nights: Math.max(1, nightsBetween(v('from').value, v('to').value) || 1),
          pointsTotal: Number(v('points').value) || 0, postedAt: new Date().toISOString() };
        const who = draft.from && draft.to && draft.pointsTotal
          ? store.watches().map(w => store.dealMatchesWatch(draft, w)).filter(Boolean) : [];
        body.querySelector('#who').innerHTML = who.length
          ? `<b>${icon('bellRing', { size: 16 })} ${who.length} ${who.length === 1 ? 'Insider is' : 'Insiders are'} waiting for exactly this</b>
             <p class="small">${who.map(m => escapeHtml(store.member(m.watch.memberId)?.name.split(' ')[0] || '')).join(', ')} — they will see it the moment you post.</p>`
          : `<b>Nobody is watching for this yet</b><p class="small">It still goes on the board for everyone.</p>`;
      };
      body.addEventListener('change', preview);
      preview();

      body.querySelector('[data-ok]').addEventListener('click', () => close({
        stayId: v('stayId').value, roomTypeId: null,
        from: v('from').value, to: v('to').value,
        pointsTotal: Number(v('points').value) || 0,
        retailUsd: Number(v('retailUsd').value) || null,
        source: v('source').value, sourceUrl: v('sourceUrl').value, note: v('note').value,
      }));
    },
  });
  if (!out) return null;
  try {
    const d = await store.postDeal(out, store.me.id);
    const n = store.matchesForDeal(d.id).length;
    toast(n ? `Posted. ${n} ${n === 1 ? 'Insider has' : 'Insiders have'} it on their home screen now.` : 'Posted to the board.', { kind: 'good', timeout: 6000 });
    return d;
  } catch (err) { toast(err.message, { kind: 'bad', timeout: 6000 }); return null; }
}

/** What a member has asked to be told about. */
export function watching({ store, go }) {
  const me = store.me;
  const mine = store.watchesFor(me.id);
  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:900px">
      <div class="row-between">
        <div><p class="eyebrow">${icon('bell')}Standing wants</p><h1>What you are watching</h1>
          <p class="lede" style="margin-top:10px;max-width:58ch">Tell the Circle what you would take if it appeared. Nothing is reserved and nothing is charged — but when Victor finds it, you are the first to know instead of the last.</p></div>
        <div class="row no-print"><button class="btn sm" id="add">${icon('plus', { size: 16 })}Watch for something</button></div>
      </div>
      <div class="stack" id="list" style="margin-top:22px"></div>
    </div></section></div>`);

  const list = wrap.querySelector('#list');
  if (!mine.length) {
    list.appendChild(el(`<div class="empty">${icon('bell', { size: 30, cls: 'ico-muted' })}
      <b style="display:block;margin-top:10px">You are not watching for anything</b>
      <p class="small muted">The good weeks at the Marriott villas and the Divi go within hours of appearing. A watch is how you hear in time.</p>
      <p style="margin-top:12px"><button class="btn sm" id="add2">${icon('plus', { size: 16 })}Watch for something</button></p></div>`));
  }
  for (const w of mine) {
    const stay = w.stayId ? store.stay(w.stayId) : null;
    const hits = store.liveDeals().map(d => store.dealMatchesWatch(d, w)).filter(Boolean);
    list.appendChild(el(`<div class="panel" data-watch="${escapeHtml(w.id)}">
        <div class="row-between" style="align-items:flex-start;gap:14px">
          <div>
            <h3 style="font-size:1.05rem">${icon(stay?.kind === 'trip' ? 'plane' : 'bed', { size: 18, cls: 'ico-muted' })}
              ${escapeHtml(stay?.name || (w.kind === 'trip' ? 'Any cruise or trip' : 'Anywhere on the island'))}</h3>
            <p class="small muted" style="margin-top:6px">
              ${w.nights} night${w.nights === 1 ? '' : 's'} between
              ${escapeHtml(fmtDay(w.from))} and ${escapeHtml(fmtDay(w.to))}${w.flexDays ? `, give or take ${w.flexDays} days` : ''}
              ${w.maxPoints ? ` · up to ${escapeHtml(fmtPoints(w.maxPoints))}` : ''}</p>
            ${w.note ? `<p class="small muted" style="margin-top:8px">“${escapeHtml(w.note)}”</p>` : ''}
          </div>
          <button class="btn quiet sm" data-act="stop">${icon('x', { size: 15 })}Stop</button>
        </div>
        ${hits.length ? `<div class="notice good" style="margin-top:12px"><b>${icon('checkCircle', { size: 16 })} ${hits.length} on the board right now</b>
           <p style="margin-top:8px"><a class="btn sm" href="#/stays">Look at ${hits.length === 1 ? 'it' : 'them'}</a></p></div>`
          : `<p class="small muted" style="margin-top:12px">${icon('clock', { size: 15, cls: 'ico-muted' })}Nothing yet. You will see it here and on your home screen.</p>`}
      </div>`));
  }

  wrap.addEventListener('click', async (e) => {
    if (e.target.closest('#add') || e.target.closest('#add2')) { await addWatchSheet({ store }); go('/watching'); return; }
    const stop = e.target.closest('[data-act="stop"]');
    if (stop) {
      const id = stop.closest('[data-watch]').dataset.watch;
      try { await store.removeWatch(id, store.me.id); toast('Stopped watching.'); go('/watching'); }
      catch (err) { toast(err.message, { kind: 'bad' }); }
    }
  });
  return wrap;
}

/** Add a watch. Pre-filled from a stay page when you got here by tapping "tell me when". */
export async function addWatchSheet({ store, prefill = {} }) {
  const s = store.settings;
  const stays = [...store.arubaStays(), ...store.trips()];
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const inMonths = (n) => { const d = new Date(today); d.setMonth(d.getMonth() + n); return iso(d); };

  const out = await sheet({
    title: 'Tell me when it appears',
    render: (body, close) => {
      body.innerHTML = `
        <p class="sheet-text">Say what you would take. Victor and Ian see what the Circle is waiting for, which is how they know what to go and look for.</p>
        <label class="field"><span>Which place</span>
          <select name="stayId"><option value="">Anywhere on the island</option>
            ${stays.map(st => `<option value="${escapeHtml(st.id)}"${st.id === prefill.stayId ? ' selected' : ''}>${escapeHtml(st.name)}${st.kind === 'trip' ? ' (trip)' : ''}</option>`).join('')}</select></label>
        <div class="grid g2">
          <label class="field"><span>Earliest</span><input type="date" name="from" value="${escapeHtml(prefill.from || inMonths(1))}" required></label>
          <label class="field"><span>Latest</span><input type="date" name="to" value="${escapeHtml(prefill.to || inMonths(4))}" required></label>
        </div>
        <div class="grid g3">
          <label class="field"><span>Nights</span><input type="number" name="nights" min="1" max="30" value="${prefill.nights || 3}" inputmode="numeric"></label>
          <label class="field"><span>Flexible by</span><input type="number" name="flexDays" min="0" max="30" value="3" inputmode="numeric"></label>
          <label class="field"><span>Guests</span><input type="number" name="guests" min="1" max="12" value="2" inputmode="numeric"></label>
        </div>
        <div class="grid g2">
          <label class="field"><span>Most you would spend US$</span><input type="number" name="maxUsd" step="10" min="0" inputmode="decimal" placeholder="optional"></label>
          <label class="field"><span>In points</span><input type="number" name="maxPoints" step="500" min="0" inputmode="numeric" placeholder="optional"></label>
        </div>
        <label class="field"><span>Anything else</span><input name="note" placeholder="Ground floor if there is a choice."></label>
        <div id="afford" class="notice"></div>
        <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>${icon('bell', { size: 16 })}Watch for it</button></div>`;

      const v = (n) => body.querySelector(`[name=${n}]`);
      const draw = () => {
        const stay = store.stay(v('stayId').value);
        const nights = Number(v('nights').value) || 1;
        const avail = Math.max(0, store.availablePoints(store.me.id));
        // Price the dates the member has just typed, not the cheapest week of the year. This
        // quoted the from-rate against any window at all: a Surf Club week over Christmas came
        // back at 15,525 against a real 66,700 — understated 4.3x, in the sheet where somebody
        // decides whether to wait for it.
        const from = v('from')?.value, to = v('to')?.value;
        const likely = !stay ? 0
          : stay.kind === 'trip' ? seatPoints(stay, s)
          : (from && to && quoteStay(stay, from, to, s).nights) ? quoteStay(stay, from, to, s).points
          : fromPoints(stay, s) * nights;
        body.querySelector('#afford').innerHTML = likely
          ? `<b>${escapeHtml(fmtPoints(likely))} is roughly what that costs</b>
             <p class="small">You hold ${escapeHtml(fmtPoints(avail))}.${avail >= likely ? ' Enough already.' : ` About ${escapeHtml(fmtPoints(likely - avail))} short — you can still watch for it, and close the gap when it turns up.`}</p>`
          : `<b>Watching the whole island</b><p class="small">You will hear about anything that fits those dates.</p>`;
      };
      body.addEventListener('input', (e) => {
        if (e.target.name === 'maxUsd') v('maxPoints').value = Math.round((Number(e.target.value) || 0) * s.pointsPerDollar) || '';
        if (e.target.name === 'maxPoints') v('maxUsd').value = (Math.round(Number(e.target.value) || 0) / s.pointsPerDollar).toFixed(2).replace(/\.00$/, '') || '';
        draw();
      });
      body.addEventListener('change', draw);
      draw();

      body.querySelector('[data-ok]').addEventListener('click', () => close({
        stayId: v('stayId').value || null, roomTypeId: null,
        kind: store.stay(v('stayId').value)?.kind === 'trip' ? 'trip' : 'aruba',
        from: v('from').value, to: v('to').value,
        nights: Number(v('nights').value) || 1, flexDays: Number(v('flexDays').value) || 0,
        guests: Number(v('guests').value) || 1,
        maxPoints: Number(v('maxPoints').value) || null, note: v('note').value,
      }));
    },
  });
  if (!out) return null;
  try {
    const w = await store.addWatch({ ...out, memberId: store.me.id });
    const hits = store.liveDeals().map(d => store.dealMatchesWatch(d, w)).filter(Boolean).length;
    toast(hits ? `Watching. ${hits} on the board already — go and look.` : 'Watching. You will hear the moment one appears.', { kind: 'good', timeout: 6000 });
    return w;
  } catch (err) { toast(err.message, { kind: 'bad', timeout: 6000 }); return null; }
}


/**
 * Interval and RedWeek have no API and both forbid automated access, so this does not log
 * into anything. Victor is already looking at the listing; he copies it, pastes it here, and
 * the Desk reads the dates, the unit, the price and which of our places it is. What it cannot
 * read it leaves blank rather than guessing, and he confirms everything before it is posted.
 */
export async function pasteListingSheet({ store, prefill = {} }) {
  const { parseListing } = await import('../data/listing-paste.js');
  const stays = [...store.arubaStays(), ...store.trips()];
  const ppd = store.settings.pointsPerDollar;

  const read = await sheet({ title: 'Paste a listing', render: (body, close) => {
    body.innerHTML = `
      <p class="sheet-text">Select the listing on Interval or RedWeek, copy it, and paste it below.
        Nothing is logged into and nothing is fetched — this only reads what you paste.</p>
      <label class="field"><span>The listing</span>
        <textarea name="raw" rows="7" placeholder="Sep 11–18, 2026  7 Nights&#10;3 Bedroom Villa, Ocean view&#10;Sleeps: 12, Building: Compass&#10;$525/night   $4,031 total" style="font-family:var(--font-mono);font-size:.86rem">${escapeHtml(prefill.raw || '')}</textarea></label>
      <div id="read" class="notice" style="margin-top:4px"><p class="small muted">Waiting for a paste.</p></div>
      <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button>
        <button class="btn" data-ok disabled>${icon('chevronRight', { size: 16 })}Check it over</button></div>`;
    const ta = body.querySelector('[name=raw]'), out = body.querySelector('#read'), okBtn = body.querySelector('[data-ok]');
    let parsed = null;
    const draw = () => {
      parsed = parseListing(ta.value, { stays, pointsPerDollar: ppd });
      if (!parsed) { out.innerHTML = '<p class="small muted">Waiting for a paste.</p>'; okBtn.disabled = true; return; }
      const rows = [
        ['Where', parsed.stay?.name || '<span style="color:var(--flag)">not one of ours — pick it on the next screen</span>'],
        ['When', parsed.from ? `${escapeHtml(fmtDay(parsed.from))} → ${escapeHtml(fmtDay(parsed.to))} · ${parsed.nights} nights` : '<span style="color:var(--flag)">could not read the dates</span>'],
        ['Room', parsed.unit || '—'],
        ['Sleeps', parsed.sleeps ?? '—'],
        ['Cost', parsed.usdTotal ? `${escapeHtml(fmtUsd2(parsed.usdTotal))} all in · ${escapeHtml(fmtPoints(parsed.pointsTotal))}` : '<span style="color:var(--flag)">could not read a price</span>'],
        ['From', SOURCES[parsed.source]?.label || 'somewhere else'],
      ];
      out.className = `notice ${parsed.taken ? 'bad' : parsed.ok ? 'good' : 'warn'}`;
      out.innerHTML = `${parsed.taken ? '<b>This one says it is already gone.</b>' : ''}
        <dl class="grid g2" style="gap:4px 12px;margin:0">${rows.map(([k, v]) =>
          `<div class="row-between"><span class="small muted">${k}</span><span class="small" style="text-align:right">${v}</span></div>`).join('')}</dl>
        ${parsed.missing.length ? `<p class="small" style="margin-top:8px">You will need to fill in ${escapeHtml(parsed.missing.join(' and '))} yourself.</p>` : ''}`;
      okBtn.disabled = !parsed.from;
    };
    ta.addEventListener('input', draw);
    ta.addEventListener('paste', () => setTimeout(draw, 0));
    if (prefill.raw) draw();
    body.querySelector('[data-ok]').addEventListener('click', () => close(parsed));
  } });

  if (!read?.from) return;
  // Straight into the normal posting sheet, filled in, so every guard it already has still runs.
  return postDealSheet({ store, prefill: {
    stayId: read.stayId || undefined, from: read.from, to: read.to,
    usd: read.usdTotal || '', points: read.pointsTotal || '',
    source: read.source === 'redweek' ? 'redweek' : read.source === 'interval' ? 'interval' : 'other',
    note: [read.unit, read.sleeps ? `sleeps ${read.sleeps}` : ''].filter(Boolean).join(' · '),
  } });
}
