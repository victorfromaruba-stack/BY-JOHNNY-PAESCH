// "Open right now" — live owner-rented weeks from VakayMood, in the Circle's own units.
//
// VakayMood is the one source the app can genuinely watch by machine: a free public API with
// CORS open to any origin, so the member's own browser makes the call and there is no key and no
// server in the middle. What it carries is owner rentals at the timeshare resorts the Circle
// already books — a studio at the Surf Club, a one-bedroom at the Ocean Club. It is NOT Interval:
// what Victor finds on Interval reaches members through the board, posted by him or by the
// watcher on his VPS.
//
// This used to be its own screen, ten tabs along, that almost nobody opened. It is now a section
// of Deals — "everything open" in one place — and a section of every stay page that VakayMood
// carries, so a room row can say when an owner has that size open. One module, one card, three
// places it appears.
//
// Three things it is careful about:
//   · it prices in points at the club's rate AND shows the dollars, because a member is going to
//     compare it against the catalog either way;
//   · it says what the Circle's own rate for the same room is, under every card, so a member
//     knows the number they would actually be quoted against;
//   · it never claims to have booked anything, and never says "available". A week is open on
//     VakayMood at the time shown; asking for it goes through the same quote as everything else.

import { escapeHtml, fmtUsd2, fmtPoints, fmtDay, pointsUsd } from '../core/util.js';
import { nightPoints } from '../core/money.js';
import { icon } from '../ui/icons.js';
import { toast, setBusy, confirmDialog } from '../ui/components.js';
import { availability, toDeal, RESORTS } from '../data/vakaymood.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };

/** The resorts VakayMood carries that are also in the catalog — the ones the Circle can price and book. */
export const CATALOG_RESORTS = Object.freeze(RESORTS.filter(r => r.stayId));

/** How many bedrooms a VakayMood listing has, from the field or from the unit-type name. */
export function bedroomsOf(d) {
  if (Number.isInteger(d.bedrooms)) return d.bedrooms;
  const t = String(d.unitType || '').toLowerCase();
  if (/studio/.test(t)) return 0;
  const m = t.match(/(\d)\s*bed/);
  return m ? Number(m[1]) : null;
}

/**
 * The catalog room a listing most plausibly is: the cheapest of ours with the same bedroom
 * count, or null when the size is unknown or we carry no room of that size. Used for the price
 * comparison and for deciding whether a room-specific watch is answered — the same rule in both
 * places, so a card never says "under our rate" against one room and "you asked for this"
 * against another.
 */
export function roomFor(store, stay, d) {
  const beds = bedroomsOf(d);
  if (beds == null || !stay) return null;
  const same = store.roomTypesFor(stay.id).filter(r => r.bedrooms === beds);
  return same.length ? same.reduce((a, b) => ((a.rateFactor || 1) <= (b.rateFactor || 1) ? a : b)) : null;
}

/**
 * What the same thing would cost on the club's own rate.
 *
 * The property's headline rate is modelled on ONE room — a two-bedroom villa at the Surf Club, a
 * one-bedroom at the Ocean Club. Comparing a live studio against that would invent a saving that
 * is really just a smaller room, so this matches on bedroom count first and takes the CHEAPEST of
 * our rooms at that size. Any saving it then reports is understated rather than flattering, which
 * is the direction to be wrong in.
 */
export function clubRateFor(store, d) {
  if (!d.stayId) return null;
  const stay = store.stayLike(d.stayId);
  if (!stay || stay.kind === 'trip') return null;
  // Priced on the night the deal actually starts, which is what this comparison is about.
  const base = nightPoints(stay, `${d.from}T12:00:00Z`, store.settings);
  if (!base) return null;
  const match = roomFor(store, stay, d);
  const per = match ? Math.round(base * (match.rateFactor || 1)) : base;
  return {
    per, total: per * d.nights, stay,
    // Named so the card can say WHAT it is comparing against, rather than implying it is the
    // property's headline rate when it is not.
    against: match ? match.name : null,
    exact: !!match,
  };
}

/**
 * A live listing in the shape dealMatchesWatch() reads, so a watch can be tested against it
 * without anything being posted. Carries the LIVE stay id — a watch is stored against whatever
 * this backend calls the place, and the bundled id would never match on production.
 */
export function draftDealFrom(store, d) {
  const stay = d.stayId ? store.stayLike(d.stayId) : null;
  if (!stay) return null;
  return {
    id: `vm:${d.externalId}`, status: 'live', kind: 'aruba', stayId: stay.id,
    roomTypeId: roomFor(store, stay, d)?.id || null,
    from: d.from, to: d.to, nights: d.nights, pointsTotal: d.pointsTotal,
    postedAt: new Date().toISOString(),
  };
}

/**
 * Does this listing answer something the member is watching for? Null when it does not.
 *
 * A watch for a specific room is answered only by a listing of that room's SIZE. The store's own
 * rule skips the room test when the deal names no room, which for a posted deal is right (the
 * Desk left it open) and for a live listing would badge a studio as the two-bedroom somebody
 * asked for. So the size is checked here first, and an unknown size never matches a room watch.
 */
export function draftMatch(store, d, memberId = store.me?.id) {
  const draft = draftDealFrom(store, d);
  if (!draft || !memberId) return null;
  const beds = bedroomsOf(d);
  for (const w of store.watchesFor(memberId)) {
    let probe = draft;
    if (w.roomTypeId) {
      const room = store.roomType(w.roomTypeId);
      if (beds == null || !room || room.bedrooms !== beds) continue;
      probe = { ...draft, roomTypeId: w.roomTypeId };
    }
    const m = store.dealMatchesWatch(probe, w);
    if (m) return m;
  }
  return null;
}

/**
 * Several owners often list the identical week at the identical price. They are genuinely
 * different listings, but six identical cards is noise — group them and say how many there are,
 * keeping the first one's booking link.
 */
export function groupCopies(list) {
  const key = (x) => `${x.slug}|${x.unitType}|${x.from}|${x.to}|${x.pointsTotal}`;
  const out = [];
  const byKey = new Map();
  for (const x of list) {
    const k = key(x);
    if (byKey.has(k)) { byKey.get(k).copies += 1; continue; }
    const row = { ...x, copies: 1 };
    byKey.set(k, row); out.push(row);
  }
  return out;
}

/**
 * The Circle's own copy of what is open, published with the site by .github/workflows/open-weeks.yml
 * every half hour. A phone in Aruba could not reach vakaymood.com at all — every call failed,
 * twice — so when the live feed does not answer, the page reads this from its own address and
 * says when the copy was taken. Fetched once per page load; a missing file is simply "no copy".
 */
let copyPromise = null;
const loadCopy = () => (copyPromise ||= fetch('data/open-weeks.json', { cache: 'no-cache' })
  .then(r => (r.ok ? r.json() : null)).catch(() => null));

/** The copy's listings for these slugs, priced like the live ones and filtered like them. */
function fromCopy(copy, slugs, state, s) {
  const rows = [];
  let total = 0;
  for (const slug of slugs) {
    const r = copy?.resorts?.[slug];
    if (!r) continue;
    total += r.total || 0;
    for (const l of r.listings || []) rows.push(toDeal(l, { pointsPerDollar: s.pointsPerDollar, serviceRate: s.serviceRate }));
  }
  const kept = rows.filter(d =>
    (!state.sleeps || (d.sleeps || 0) >= Number(state.sleeps))
    && (!state.maxNightlyUsd || d.usdNightly <= Number(state.maxNightlyUsd))
    && (!state.checkin || d.from >= state.checkin)
    && (!state.checkout || d.to <= state.checkout));
  return { rows: kept.sort(SORTS[state.sort] || SORTS.price_asc), total, generatedAt: copy?.generatedAt || null };
}

const SORTS = {
  price_asc: (a, b) => a.pointsTotal - b.pointsTotal,
  price_desc: (a, b) => b.pointsTotal - a.pointsTotal,
  start_asc: (a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.pointsTotal - b.pointsTotal),
};

/** One live listing as a card. `ctx` is { store, me, s, canPost }. */
export function card(d, ctx) {
  const { store, me, s, canPost } = ctx;
  const club = clubRateFor(store, d);
  const beatsClub = club && d.pointsTotal < club.total;
  const savedPts = club ? club.total - d.pointsTotal : 0;
  const avail = Math.max(0, store.availablePoints(me.id));
  const short = Math.max(0, d.pointsTotal - avail);
  // Resolve to whatever this backend actually calls the place, and use that id in links.
  const stay = d.stayId ? store.stayLike(d.stayId) : null;
  const stayRef = stay?.id || null;
  const asked = draftMatch(store, d, me.id);

  return `<article class="panel live-card${beatsClub ? ' beats' : ''}${asked ? ' matched' : ''}" data-id="${escapeHtml(d.externalId)}">
    ${asked ? `<p class="eyebrow" style="color:var(--good-text)">${icon('bellRing', { size: 15 })}You asked for this</p>` : ''}
    <div class="row-between" style="align-items:flex-start;gap:14px">
      <div style="min-width:0">
        <h3 style="font-size:1.05rem">${escapeHtml(d.resortName)}</h3>
        <p class="small muted" style="margin-top:4px">
          ${d.unitType ? `${escapeHtml(d.unitType)} · ` : ''}${d.sleeps ? `sleeps ${d.sleeps}` : ''}${d.bedrooms ? ` · ${d.bedrooms} bed${d.bedrooms > 1 ? 'rooms' : 'room'}` : ''}
          ${d.copies > 1 ? ` · <b>${d.copies} owners have it</b>` : ''}
          ${stay?.house ? ` · <span style="color:var(--good-text)">where we stay</span>` : ''}
          ${!stayRef ? ' · <span class="muted">not in our catalog yet</span>' : ''}</p>
      </div>
      <div style="text-align:right;flex:none">
        <b class="num" style="font-size:1.12rem">${escapeHtml(fmtPoints(d.pointsTotal))}</b>
        <br><span class="small muted">owner asking ${escapeHtml(fmtUsd2(d.usdNightly))} a night · ${escapeHtml(fmtUsd2(d.usdTotal))} all in</span>
      </div>
    </div>

    <p class="small" style="margin-top:10px">${icon('calendar', { size: 15, cls: 'ico-muted' })}
      ${escapeHtml(fmtDay(d.from))} – ${escapeHtml(fmtDay(d.to))} · ${d.nights} night${d.nights === 1 ? '' : 's'}
      ${d.flexibleDates && d.lastBookableCheckin ? ` · <span class="muted">any start up to ${escapeHtml(fmtDay(d.lastBookableCheckin))}</span>` : ''}</p>

    ${d.usdFees > 0 ? `<p class="small muted" style="margin-top:6px">${icon('scale', { size: 14, cls: 'ico-muted' })}
      ${escapeHtml(fmtUsd2(d.usdSubtotal))} at booking, ${escapeHtml(fmtUsd2(d.usdFees))} at the resort${d.feeLines.length ? ` (${d.feeLines.map(f => escapeHtml(f.name)).join(', ')})` : ''}</p>` : ''}

    ${beatsClub ? `<div class="notice good" style="margin-top:10px"><b>${icon('trend', { size: 16 })} ${escapeHtml(fmtPoints(savedPts))} under our own rate</b>
        <p class="small">Our own rate for those ${d.nights} nights${club.against ? ` in a ${escapeHtml(club.against)}` : ''} is ${escapeHtml(fmtPoints(club.total))} — this owner is asking ${escapeHtml(pointsUsd(savedPts, s.pointsPerDollar))} less.${club.exact ? '' : ' Compared against the property’s headline room, since we have no room of this size on file.'}</p></div>`
      : club ? `<p class="small muted" style="margin-top:8px">Our own rate for the same ${d.nights} nights${club.against ? ` in a ${escapeHtml(club.against)}` : ''} is ${escapeHtml(fmtPoints(club.total))}. What you accept is Victor's quote.</p>` : ''}

    <p class="small ${short ? 'muted' : ''}" style="margin-top:8px">${icon('spark', { size: 14 })}
      ${short ? `At the owner's price you would be ${escapeHtml(fmtPoints(short))} short — ${escapeHtml(pointsUsd(short, s.pointsPerDollar))} as a top-up, or open it to the Circle.`
              : 'You hold enough for this at the owner\'s price.'}</p>

    <div class="row" style="margin-top:14px">
      ${stayRef ? `<a class="btn sm" href="#/book/${escapeHtml(stayRef)}?from=${escapeHtml(d.from)}&to=${escapeHtml(d.to)}${d.bookingUrl ? `&src=${encodeURIComponent(d.bookingUrl)}&srcLabel=${encodeURIComponent('VakayMood')}` : ''}">${icon('send', { size: 16 })}Ask the Circle for it</a>` : ''}
      ${canPost && stayRef ? `<button class="btn ghost sm" data-post="${escapeHtml(d.externalId)}">${icon('plus', { size: 15 })}Put it on the board</button>` : ''}
      ${canPost && d.bookingUrl ? `<a class="btn quiet sm" href="${escapeHtml(d.bookingUrl)}" target="_blank" rel="noopener noreferrer">${icon('external', { size: 16 })}Go and book it</a>` : ''}
    </div>
  </article>`;
}

/**
 * The Deals page re-renders on every store commit (a watch marked seen, a deal posted, a
 * realtime row), and each render builds this section afresh. The member's filters live here,
 * outside any one render, so flipping "sleeps 6+" and then having a deal land does not put the
 * filters back to their defaults under their hands.
 */
let lastState = null;
const freshState = () => ({
  slug: '', sort: 'price_asc', sleeps: '', maxNightlyUsd: '',
  checkin: '', checkout: '', page: 1, oursOnly: true, revealed: 0,
});

/**
 * The live section: filters, count, cards, and "show more". Returns a node.
 *
 * `compact` is the stay-page form — one resort, no filters, cheapest first, a handful of rows —
 * and `onLoaded(byBeds, res)` tells the page which sizes are open so the rooms table can say so.
 */
export function liveSection(ctx, { compact = false, slug = null, first = compact ? 6 : 12, onLoaded = null } = {}) {
  const { store, s } = ctx;
  const state = compact ? { ...freshState(), slug, oursOnly: false } : (lastState ||= freshState());
  const FIRST = compact ? first : 6;   // the cheapest six open with the page; fifty cards was the scroll Victor called empty

  const wrap = el(`<div class="live-section">
    ${compact ? '' : `<button type="button" class="btn ghost sm no-print" id="live-ftoggle" aria-expanded="false" aria-controls="live-filters" style="margin-top:14px">${icon('filter', { size: 15 })}Filters</button>
    <div class="row no-print" id="live-filters" style="margin-top:14px" role="group" aria-label="Filter what is open"></div>`}
    <p class="small muted" id="count" style="margin-top:${compact ? 8 : 14}px"></p>
    <div id="list" style="margin-top:14px"></div>
    <div class="row" id="more" style="margin-top:16px"></div>
  </div>`);

  const list = wrap.querySelector('#list');
  const count = wrap.querySelector('#count');
  // Its own id, not #filters: the stays list owns that one, and the stylesheet hides it on a
  // phone behind that page's toggle — which is how this section's filters vanished on every
  // phone with no way to open them.
  const filters = wrap.querySelector('#live-filters');
  const ftoggle = wrap.querySelector('#live-ftoggle');
  const activeFilters = () => ['slug', 'sleeps', 'maxNightlyUsd', 'checkin', 'checkout'].filter(k => state[k]).length + (state.oursOnly ? 0 : 1);
  const drawToggle = () => { if (!ftoggle) return; const n = activeFilters(); ftoggle.innerHTML = `${icon('filter', { size: 15 })}Filters${n ? ` · ${n}` : ''}`; };
  ftoggle?.addEventListener('click', () => { const open = filters.classList.toggle('open'); ftoggle.setAttribute('aria-expanded', String(open)); });
  const more = wrap.querySelector('#more');

  const drawFilters = () => {
    drawToggle();
    if (!filters) return;
    const shown = state.oursOnly ? CATALOG_RESORTS : RESORTS;
    filters.innerHTML = `
      <select class="btn ghost sm" id="resort" aria-label="Resort" style="padding-inline:12px;max-width:22em">
        <option value="">${state.oursOnly ? 'The places we book' : 'Anywhere on Aruba'}</option>
        ${shown.map(r => `<option value="${escapeHtml(r.slug)}"${r.slug === state.slug ? ' selected' : ''}>${escapeHtml(r.name)}${r.house ? ' · where we stay' : ''}</option>`).join('')}
      </select>
      <button class="btn ${state.oursOnly ? '' : 'quiet'} sm" data-toggle="oursOnly" aria-pressed="${state.oursOnly}">${icon('star', { size: 15 })}Places we book</button>
      <select class="btn ghost sm" id="sort" aria-label="Sort" style="padding-inline:12px">
        <option value="price_asc"${state.sort === 'price_asc' ? ' selected' : ''}>Cheapest first</option>
        <option value="start_asc"${state.sort === 'start_asc' ? ' selected' : ''}>Soonest first</option>
        <option value="price_desc"${state.sort === 'price_desc' ? ' selected' : ''}>Dearest first</option>
      </select>
      <select class="btn ghost sm" id="sleeps" aria-label="Sleeps" style="padding-inline:12px">
        <option value="">Any size</option>
        ${[2, 4, 6, 8, 10, 12].map(n => `<option value="${n}"${String(n) === String(state.sleeps) ? ' selected' : ''}>Sleeps ${n}+</option>`).join('')}
      </select>
      <input class="btn ghost sm" id="maxNightly" type="number" min="0" step="25" inputmode="decimal"
             placeholder="Max $ a night" value="${escapeHtml(state.maxNightlyUsd)}" style="padding-inline:12px;max-width:11em" aria-label="Most an owner may ask a night">
      <input class="btn ghost sm" id="checkin" type="date" value="${escapeHtml(state.checkin)}" aria-label="Earliest check-in" style="padding-inline:12px">
      <input class="btn ghost sm" id="checkout" type="date" value="${escapeHtml(state.checkout)}" aria-label="Latest checkout" style="padding-inline:12px">
      ${state.checkin || state.checkout || state.sleeps || state.maxNightlyUsd || state.slug
        ? `<button class="btn quiet sm" id="clear">${icon('x', { size: 15 })}Clear</button>` : ''}`;
  };

  const ask = (extra) => availability({
    sort: state.sort, sleeps: state.sleeps || null, maxNightlyUsd: state.maxNightlyUsd || null,
    checkin: state.checkin || null, checkout: state.checkout || null,
    pointsPerDollar: s.pointsPerDollar, serviceRate: s.serviceRate, ...extra,
  });

  let loaded = [];
  let serverMore = false;   // the API has another page in single-resort / island-wide mode
  let fromTheCopy = false;  // this paint is the Circle's own copy, not the live feed
  const paint = () => {
    const shown = state.revealed ? loaded : loaded.slice(0, FIRST);
    const hidden = loaded.length - shown.length;
    list.innerHTML = loaded.length
      ? `<div class="grid g2">${shown.map(d => card(d, ctx)).join('')}</div>`
      : `<div class="empty">${icon('search', { size: 30, cls: 'ico-muted' })}
          <b style="display:block;margin-top:10px">Nothing open on VakayMood that matches</b>
          <p class="small muted">${compact ? 'Nothing at this place right now. A watch is how you hear when there is.' : state.oursOnly ? 'Try the other places, or widen the dates.' : 'Try widening the dates or the price.'}</p></div>`;
    more.innerHTML = hidden > 0
      ? `<button class="btn ghost sm" id="reveal">${icon('chevronDown', { size: 16 })}Show the other ${hidden}</button>`
      : loaded.length && serverMore
        ? `<button class="btn ghost sm" id="load-more">${icon('chevronDown', { size: 16 })}Show more</button>` : '';
  };

  const draw = async ({ append = false } = {}) => {
    drawFilters();
    if (!append) { list.innerHTML = `<div class="panel flat"><p class="small muted">${icon('refresh', { size: 15 })} Asking VakayMood…</p></div>`; more.innerHTML = ''; }
    try {
      let rows, total, generatedAt, failed = 0;
      if (!state.slug && state.oursOnly) {
        // One call per place we book, in parallel, then merged. The island carries thousands of
        // owner weeks at resorts we do not use, so one island-wide page filtered afterwards showed
        // five of ours under a count of two thousand — which read as "nothing open" to a member.
        const settled = await Promise.allSettled(CATALOG_RESORTS.map(r => ask({ slug: r.slug, page: 1, limit: 12 })));
        const ok = settled.filter(x => x.status === 'fulfilled').map(x => x.value);
        failed = settled.length - ok.length;
        if (!ok.length) throw settled[0].reason;
        rows = ok.flatMap(x => x.deals).sort(SORTS[state.sort] || SORTS.price_asc);
        total = ok.reduce((n, x) => n + x.total, 0);
        generatedAt = ok.find(x => x.generatedAt)?.generatedAt || null;
        serverMore = false;
      } else {
        const res = await ask({ slug: state.slug || null, page: state.page, limit: 24 });
        rows = append ? [...loaded, ...res.deals] : res.deals;
        total = res.total; generatedAt = res.generatedAt;
        serverMore = res.page * res.limit < res.total;
      }
      fromTheCopy = false;
      loaded = groupCopies(rows);
      // What answers a watch comes first. The stay page shows six of a resort's cheapest weeks,
      // and the two-bedroom somebody asked for is rarely among the six cheapest; the sort is
      // stable, so within each group the price order stands.
      if (ctx.me) {
        const hit = new Map(loaded.map(d => [d, draftMatch(store, d, ctx.me.id) ? 1 : 0]));
        loaded.sort((a, b) => hit.get(b) - hit.get(a));
      }
      if (append) state.revealed = 1;

      const at = generatedAt ? new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const where = state.slug ? (RESORTS.find(r => r.slug === state.slug)?.name || 'this place') : state.oursOnly ? 'the places we book' : 'Aruba';
      count.innerHTML = `${total.toLocaleString('en-US')} open at ${escapeHtml(where)}`
        + (at ? ` · as of ${escapeHtml(at)}` : '')
        + (failed ? ` · <span class="muted">${failed} place${failed === 1 ? '' : 's'} did not answer</span>` : '');
      paint();
      if (onLoaded) {
        const byBeds = new Map();
        for (const d of loaded) {
          const beds = bedroomsOf(d);
          if (beds == null) continue;
          if (!byBeds.has(beds) || d.usdNightly < byBeds.get(beds).usdNightly) byBeds.set(beds, d);
        }
        try { onLoaded(byBeds, { total, generatedAt, cheapest: loaded.slice().sort(SORTS.price_asc)[0] || null }); } catch (e) { console.error(e); }
      }
    } catch (err) {
      // The live feed did not answer. The Circle keeps its own copy, taken every half hour and
      // served from this site's own address, which a phone can always reach. Show that, and say
      // when it was taken — never as if it were live.
      const copy = await loadCopy();
      const slugs = state.slug ? [state.slug] : CATALOG_RESORTS.map(r => r.slug);
      if (copy && slugs.some(sl => copy.resorts?.[sl])) {
        const got = fromCopy(copy, slugs, state, s);
        fromTheCopy = true; serverMore = false;
        loaded = groupCopies(got.rows);
        if (ctx.me) {
          const hit = new Map(loaded.map(d => [d, draftMatch(store, d, ctx.me.id) ? 1 : 0]));
          loaded.sort((a, b) => hit.get(b) - hit.get(a));
        }
        const at = got.generatedAt ? new Date(got.generatedAt).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '';
        const where = state.slug ? (RESORTS.find(r => r.slug === state.slug)?.name || 'this place') : 'the places we book';
        count.innerHTML = `${got.total.toLocaleString('en-US')} open at ${escapeHtml(where)}${at ? ` · the Circle’s copy, taken ${escapeHtml(at)}` : ''}
          <span class="muted">· this phone could not reach VakayMood live${state.slug || state.oursOnly ? '' : '; the copy covers the places we book'}</span>`;
        paint();
        if (onLoaded) {
          const byBeds = new Map();
          for (const d of loaded) { const beds = bedroomsOf(d); if (beds == null) continue; if (!byBeds.has(beds) || d.usdNightly < byBeds.get(beds).usdNightly) byBeds.set(beds, d); }
          try { onLoaded(byBeds, { total: got.total, generatedAt: got.generatedAt, cheapest: loaded.slice().sort(SORTS.price_asc)[0] || null, fromCopy: true }); } catch (e) { console.error(e); }
        }
        return;
      }
      count.textContent = '';
      more.innerHTML = '';
      // A request that never got an answer is this phone's network path — mobile data, a
      // content blocker, a DNS filter — not a problem with the Circle, and it does not deserve a
      // warning box on the member's Deals page. One quiet line, and a way to try again.
      if (/from this device/i.test(err.message)) {
        list.innerHTML = `<p class="small muted">${icon('eye', { size: 14, cls: 'ico-muted' })} This phone could not reach VakayMood just now — mobile data, or a content blocker. The board above is unaffected.
          <button class="btn quiet sm" id="retry" style="margin-left:8px">${icon('refresh', { size: 14 })}Try again</button></p>`;
        return;
      }
      list.innerHTML = `<div class="notice warn"><b>${icon('alert', { size: 16 })} VakayMood is not answering right now</b>
        <p class="small">${escapeHtml(err.message)} That is their server, not ours. The board above is what the Desk has posted, and your points are untouched.</p>
        <p style="margin-top:10px"><button class="btn sm" id="retry">${icon('refresh', { size: 15 })}Try again</button></p></div>`;
    }
  };
  draw();

  wrap.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) { state[t.dataset.toggle] = !state[t.dataset.toggle]; state.slug = ''; state.page = 1; state.revealed = 0; draw(); return; }
    if (e.target.closest('#clear')) {
      Object.assign(state, { slug: '', sleeps: '', maxNightlyUsd: '', checkin: '', checkout: '', page: 1, revealed: 0 });
      draw(); return;
    }
    if (e.target.closest('#retry')) { draw(); return; }
    if (e.target.closest('#reveal')) { state.revealed = 1; paint(); return; }
    if (e.target.closest('#load-more')) {
      const btn = e.target.closest('#load-more');
      setBusy(btn, true, 'Loading…');
      state.page += 1; await draw({ append: true }); return;
    }
    const post = e.target.closest('[data-post]');
    if (post) {
      const d = loaded.find(x => x.externalId === post.dataset.post);
      if (!d) return;
      const yes = await confirmDialog({
        title: 'Put it on the board?',
        confirmText: 'Post it',
        message: `${d.resortName} · ${d.nights} nights from ${fmtDay(d.from)} · ${fmtPoints(d.pointsTotal)}. Everyone watching for something this answers hears about it straight away.`,
      });
      if (!yes) return;
      try {
        const deal = await store.postDeal({
          stayId: store.stayLike(d.stayId)?.id || null, from: d.from, to: d.to, nights: d.nights,
          pointsTotal: d.pointsTotal, retailUsd: d.usdTotal,
          source: 'vakaymood', sourceUrl: d.bookingUrl,
          sourceRef: `vakaymood:${d.externalId}`,
          title: `${d.resortName}${d.unitType ? ` · ${d.unitType}` : ''}`,
          note: `Owner rental on VakayMood. ${fmtUsd2(d.usdSubtotal)} at booking, ${fmtUsd2(d.usdFees)} at the resort.`,
          expiresAt: `${d.from}T12:00:00Z`,
        }, ctx.me.id);
        const n = store.matchesForDeal(deal.id).length;
        toast(n ? `On the board. ${n} ${n === 1 ? 'Insider was' : 'Insiders were'} waiting for it.` : 'On the board.', { kind: 'good', timeout: 6000 });
      } catch (err) { toast(err.message, { kind: 'bad', timeout: 6000 }); }
    }
  });

  filters?.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'resort') state.slug = e.target.value;
    else if (id === 'sort') state.sort = e.target.value;
    else if (id === 'sleeps') state.sleeps = e.target.value;
    else if (id === 'maxNightly') state.maxNightlyUsd = e.target.value;
    else if (id === 'checkin') state.checkin = e.target.value;
    else if (id === 'checkout') state.checkout = e.target.value;
    else return;
    state.page = 1; state.revealed = 0;
    draw();
  });

  return wrap;
}

/** The catalog resort VakayMood carries for this stay, resolved across backends, or null. */
export function resortForStay(store, stay) {
  if (!stay || stay.kind === 'trip') return null;
  return CATALOG_RESORTS.find(r => store.stayLike(r.stayId)?.id === stay.id) || null;
}
