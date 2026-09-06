// "Open right now" — live timeshare availability from VakayMood, in the Circle's own units.
//
// This is the section that does what Victor actually asked for: it keeps checking, and when
// a one-bedroom at the Ocean Club is there, it says so. It is the only source in the plan
// that permits it — a free public API with CORS open to any origin, so the member's own
// browser makes the call and there is no key and no server in the middle.
//
// Three things it is careful about:
//   · it prices in points at the club's rate AND shows the dollars, because a member is
//     going to compare it against the catalog either way;
//   · it says out loud when a live week beats the club's own modelled rate, which is the
//     whole reason to look;
//   · it never claims to have booked anything. Booking happens on VakayMood, and a member
//     asking for it goes through the same quote as everything else.

import { escapeHtml, fmtUsd2, fmtPoints, fmtDay, pointsUsd, nightsBetween } from '../core/util.js';
import { seasonPoints, SEASONS, seasonFor } from '../core/money.js';
import { icon } from '../ui/icons.js';
import { toast, setBusy, confirmDialog } from '../ui/components.js';
import { availability, RESORTS, rrCode } from '../data/vakaymood.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const iso = (d) => d.toISOString().slice(0, 10);

/** How many bedrooms a VakayMood listing has, from the field or from the unit-type name. */
function bedroomsOf(d) {
  if (Number.isInteger(d.bedrooms)) return d.bedrooms;
  const t = String(d.unitType || '').toLowerCase();
  if (/studio/.test(t)) return 0;
  const m = t.match(/(\d)\s*bed/);
  return m ? Number(m[1]) : null;
}

/**
 * What the same thing would cost on the club's own published rate.
 *
 * The property's headline rate is modelled on ONE room — a two-bedroom villa at the Surf
 * Club, a one-bedroom at the Ocean Club. Comparing a live studio against that would invent
 * a saving that is really just a smaller room, so this matches on bedroom count first and
 * takes the CHEAPEST of our rooms at that size. Any saving it then reports is understated
 * rather than flattering, which is the direction to be wrong in.
 */
function clubRateFor(store, d) {
  if (!d.stayId) return null;
  const stay = store.stayLike(d.stayId);
  if (!stay || stay.kind === 'trip') return null;
  const season = seasonFor(`${d.from}T12:00:00Z`) || 'low';
  const base = seasonPoints(stay, season, store.settings);
  if (!base) return null;

  const beds = bedroomsOf(d);
  const rooms = store.roomTypesFor(stay.id);
  const sameSize = beds == null ? [] : rooms.filter(r => r.bedrooms === beds);
  const match = sameSize.length
    ? sameSize.reduce((a, b) => ((a.rateFactor || 1) <= (b.rateFactor || 1) ? a : b))
    : null;

  const per = match ? Math.round(base * (match.rateFactor || 1)) : base;
  return {
    season, per, total: per * d.nights, stay,
    // Named so the card can say WHAT it is comparing against, rather than implying it is
    // the property's headline rate when it is not.
    against: match ? match.name : null,
    exact: !!match,
  };
}

export function live({ store, go }) {
  const s = store.settings;
  const me = store.me;
  const canPost = store.canPlan() || store.hasRole('comms');
  const today = new Date();
  const plus = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };

  const state = {
    slug: '', sort: 'price_asc', sleeps: '', maxNightlyUsd: '',
    checkin: '', checkout: '', page: 1, houseOnly: true,
  };

  const wrap = el(`<div><section class="sec"><div class="wrap">
      <div class="sec-head"><div>
        <p class="eyebrow">${icon('eye')}A window, not a shop</p>
        <h1>What is open right now</h1>
        <p class="lede" style="margin-top:10px;max-width:62ch">Weeks that are free at the moment at the places we use, so you
          can see what exists before you ask. <b>You never book here.</b> You put your points in — on your own or with others —
          and Victor books it for you, the same as everything else in the Circle.</p>
        <p class="small muted" style="margin-top:10px;max-width:62ch">Prices are in points at ${s.pointsPerDollar} to the dollar
          so they sit beside the catalog. They are a guide: what you accept is Victor's quote, and he often does better than
          what is showing here.</p>
      </div></div>

      <div class="row no-print" id="filters" style="margin-top:18px" role="group" aria-label="Filter live availability"></div>
      <p class="small muted" id="count" style="margin-top:14px"></p>
      <div id="list" style="margin-top:16px"></div>
      <div class="row" id="more" style="margin-top:18px"></div>

      <p class="small muted" style="margin-top:26px">${icon('shield', { size: 14, cls: 'ico-muted' })}
        This one feed happens to be public, so it can be shown live. Most of what the Circle books does not work that way:
        Victor and Ian find it on Interval, on RedWeek, or on the phone to the hotel, and put it on
        <a href="#/deals">the board</a> themselves. Either way the Circle does the booking.
        <a href="#/rules">How the Circle works</a>.</p>
    </div></section></div>`);

  const list = wrap.querySelector('#list');
  const count = wrap.querySelector('#count');
  const filters = wrap.querySelector('#filters');
  const more = wrap.querySelector('#more');

  const drawFilters = () => {
    const shown = state.houseOnly ? RESORTS.filter(r => r.house) : RESORTS;
    filters.innerHTML = `
      <select class="btn ghost sm" id="resort" aria-label="Resort" style="padding-inline:12px;max-width:22em">
        <option value="">Anywhere on Aruba</option>
        ${shown.map(r => `<option value="${escapeHtml(r.slug)}"${r.slug === state.slug ? ' selected' : ''}>${escapeHtml(r.name)}${r.house ? ' · where we stay' : ''}</option>`).join('')}
      </select>
      <button class="btn ${state.houseOnly ? '' : 'quiet'} sm" data-toggle="houseOnly" aria-pressed="${state.houseOnly}">${icon('star', { size: 15 })}Ours only</button>
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
             placeholder="Max $ a night" value="${escapeHtml(state.maxNightlyUsd)}" style="padding-inline:12px;max-width:11em">
      <input class="btn ghost sm" id="checkin" type="date" value="${escapeHtml(state.checkin)}" aria-label="Earliest check-in" style="padding-inline:12px">
      <input class="btn ghost sm" id="checkout" type="date" value="${escapeHtml(state.checkout)}" aria-label="Latest checkout" style="padding-inline:12px">
      ${state.checkin || state.checkout || state.sleeps || state.maxNightlyUsd || state.slug
        ? `<button class="btn quiet sm" id="clear">${icon('x', { size: 15 })}Clear</button>` : ''}`;
  };

  const card = (d) => {
    const club = clubRateFor(store, d);
    const beatsClub = club && d.pointsTotal < club.total;
    const savedPts = club ? club.total - d.pointsTotal : 0;
    const avail = Math.max(0, store.availablePoints(me.id));
    const short = Math.max(0, d.pointsTotal - avail);
    // Resolve to whatever this backend actually calls the place, and use that id in links.
    const stay = d.stayId ? store.stayLike(d.stayId) : null;
    const stayRef = stay?.id || null;

    return `<article class="panel live-card${beatsClub ? ' beats' : ''}" data-id="${escapeHtml(d.externalId)}">
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
          <br><span class="small muted">${escapeHtml(fmtUsd2(d.usdTotal))} all in · ${escapeHtml(fmtUsd2(d.usdNightly))}/night</span>
        </div>
      </div>

      <p class="small" style="margin-top:10px">${icon('calendar', { size: 15, cls: 'ico-muted' })}
        ${escapeHtml(fmtDay(d.from))} – ${escapeHtml(fmtDay(d.to))} · ${d.nights} night${d.nights === 1 ? '' : 's'}
        ${d.flexibleDates && d.lastBookableCheckin ? ` · <span class="muted">any start up to ${escapeHtml(fmtDay(d.lastBookableCheckin))}</span>` : ''}</p>

      ${d.usdFees > 0 ? `<p class="small muted" style="margin-top:6px">${icon('scale', { size: 14, cls: 'ico-muted' })}
        ${escapeHtml(fmtUsd2(d.usdSubtotal))} at booking, ${escapeHtml(fmtUsd2(d.usdFees))} at the resort${d.feeLines.length ? ` (${d.feeLines.map(f => escapeHtml(f.name)).join(', ')})` : ''}</p>` : ''}

      ${beatsClub ? `<div class="notice good" style="margin-top:10px"><b>${icon('trend', { size: 16 })} ${escapeHtml(fmtPoints(savedPts))} under our own rate</b>
          <p class="small">Our ${escapeHtml(SEASONS[club.season].label)} rate for ${d.nights} nights${club.against ? ` in a ${escapeHtml(club.against)}` : ''} is ${escapeHtml(fmtPoints(club.total))} — this is ${escapeHtml(pointsUsd(savedPts, s.pointsPerDollar))} cheaper.${club.exact ? '' : ' Compared against the property’s headline room, since we have no room of this size on file.'}</p></div>`
        : club ? `<p class="small muted" style="margin-top:8px">Our ${escapeHtml(SEASONS[club.season].label)} rate for the same ${d.nights} nights${club.against ? ` in a ${escapeHtml(club.against)}` : ''} is ${escapeHtml(fmtPoints(club.total))}.</p>` : ''}

      <p class="small ${short ? 'muted' : ''}" style="margin-top:8px">${icon('spark', { size: 14 })}
        ${short ? `You are ${escapeHtml(fmtPoints(short))} short — ${escapeHtml(pointsUsd(short, s.pointsPerDollar))} as a top-up, or open it to the Circle.`
                : 'You hold enough for this.'}</p>

      <div class="row" style="margin-top:14px">
        ${stayRef ? `<a class="btn sm" href="#/book/${escapeHtml(stayRef)}?from=${escapeHtml(d.from)}&to=${escapeHtml(d.to)}">${icon('send', { size: 16 })}Ask the Circle for it</a>` : ''}
        ${canPost && stayRef ? `<button class="btn ghost sm" data-post="${escapeHtml(d.externalId)}">${icon('plus', { size: 15 })}Put it on the board</button>` : ''}
        ${canPost && d.bookingUrl ? `<a class="btn quiet sm" href="${escapeHtml(d.bookingUrl)}" target="_blank" rel="noopener noreferrer">${icon('external', { size: 16 })}Go and book it</a>` : ''}
      </div>
    </article>`;
  };

  let loaded = [];
  const draw = async ({ append = false } = {}) => {
    drawFilters();
    if (!append) { list.innerHTML = `<div class="panel flat"><p class="small muted">${icon('refresh', { size: 15 })} Asking VakayMood…</p></div>`; more.innerHTML = ''; }
    try {
      const res = await availability({
        slug: state.slug || null,
        sort: state.sort,
        sleeps: state.sleeps || null,
        maxNightlyUsd: state.maxNightlyUsd || null,
        checkin: state.checkin || null,
        checkout: state.checkout || null,
        page: state.page, limit: 24,
        pointsPerDollar: s.pointsPerDollar,
      });
      // With "our four only" on and no single resort chosen, filter client-side: the API
      // takes one resort at a time, and four calls to show one list is wasteful.
      let deals = res.deals;
      if (!state.slug && state.houseOnly) {
        const houseSlugs = new Set(RESORTS.filter(r => r.house).map(r => r.slug));
        deals = deals.filter(d => houseSlugs.has(d.slug));
      }
      // Several owners often list the identical week at the identical price. They are
      // genuinely different listings, but six identical cards is noise — group them and say
      // how many there are, keeping the first one's booking link.
      const key = (x) => `${x.slug}|${x.unitType}|${x.from}|${x.to}|${x.pointsTotal}`;
      const grouped = [];
      const byKey = new Map();
      for (const x of (append ? [...loaded, ...deals] : deals)) {
        const k = key(x);
        if (byKey.has(k)) { byKey.get(k).copies += 1; continue; }
        const row = { ...x, copies: 1 };
        byKey.set(k, row); grouped.push(row);
      }
      loaded = grouped;

      count.innerHTML = `${res.total.toLocaleString('en-US')} live listing${res.total === 1 ? '' : 's'}${state.slug ? '' : ' on Aruba'}`
        + (state.houseOnly && !state.slug ? ` · showing the ${RESORTS.filter(r => r.house).length} of ours it carries` : '')
        + (res.generatedAt ? ` · checked ${escapeHtml(new Date(res.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}` : '');

      list.innerHTML = loaded.length
        ? `<div class="grid g2">${loaded.map(card).join('')}</div>`
        : `<div class="empty">${icon('search', { size: 30, cls: 'ico-muted' })}
            <b style="display:block;margin-top:10px">Nothing open that matches</b>
            <p class="small muted">${state.houseOnly ? 'Try turning off “ours only”, or widen the dates.' : 'Try widening the dates or the price.'}</p></div>`;

      more.innerHTML = loaded.length && res.page * res.limit < res.total
        ? `<button class="btn ghost sm" id="load-more">${icon('chevronDown', { size: 16 })}Show more</button>` : '';
    } catch (err) {
      list.innerHTML = `<div class="notice warn"><b>${icon('alert', { size: 16 })} ${escapeHtml(err.message)}</b>
        <p class="small">Nothing is broken on our side — this is a live feed from someone else's server. The catalog and your points are unaffected.</p>
        <p style="margin-top:10px"><button class="btn sm" id="retry">${icon('refresh', { size: 15 })}Try again</button></p></div>`;
      count.textContent = '';
      more.innerHTML = '';
    }
  };
  draw();

  wrap.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) { state[t.dataset.toggle] = !state[t.dataset.toggle]; state.page = 1; draw(); return; }
    if (e.target.closest('#clear')) {
      Object.assign(state, { slug: '', sleeps: '', maxNightlyUsd: '', checkin: '', checkout: '', page: 1 });
      draw(); return;
    }
    if (e.target.closest('#retry')) { draw(); return; }
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
          source: 'other', sourceUrl: d.bookingUrl,
          sourceRef: `vakaymood:${d.externalId}`,
          title: `${d.resortName}${d.unitType ? ` · ${d.unitType}` : ''}`,
          note: `Owner rental on VakayMood. ${fmtUsd2(d.usdSubtotal)} at booking, ${fmtUsd2(d.usdFees)} at the resort.`,
        }, me.id);
        const n = store.matchesForDeal(deal.id).length;
        toast(n ? `On the board. ${n} ${n === 1 ? 'Insider was' : 'Insiders were'} waiting for it.` : 'On the board.', { kind: 'good', timeout: 6000 });
      } catch (err) { toast(err.message, { kind: 'bad', timeout: 6000 }); }
    }
  });

  filters.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'resort') { state.slug = e.target.value; state.houseOnly = false; }
    else if (id === 'sort') state.sort = e.target.value;
    else if (id === 'sleeps') state.sleeps = e.target.value;
    else if (id === 'maxNightly') state.maxNightlyUsd = e.target.value;
    else if (id === 'checkin') state.checkin = e.target.value;
    else if (id === 'checkout') state.checkout = e.target.value;
    else return;
    state.page = 1;
    draw();
  });

  return wrap;
}
