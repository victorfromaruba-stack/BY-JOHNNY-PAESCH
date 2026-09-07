// Stays, trips, requesting one, and the life of a request.
import { escapeHtml, fmtUsd2, fmtPoints, pointsUsd, fmtDay, fmtDayTime, countdownTo, initials, nightsBetween } from '../core/util.js';
import { VOCAB, tierName } from '../core/vocab.js';
import { quoteStay, nightPoints, fromPoints, seatPoints, unitPoints, versusPublic, tierFor, REACH, reachOf, pointsPerMonth } from '../core/money.js';
import { ring, versusLine } from '../ui/pieces.js';
import { stayCard, stayStrip } from './public.js';
import { toast, sheet, confirmDialog, setBusy, chip, statusLabel } from '../ui/components.js';
import { shareText } from '../core/share.js';
import { icon } from '../ui/icons.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const AREAS = ['Palm Beach', 'Eagle Beach', 'Druif Beach', 'Oranjestad', 'Malmok', 'Savaneta', 'Noord'];

export function stays({ store, query, go }) {
  const me = store.me, s = store.settings;
  const avail = store.availablePoints(me.id);
  const state = { area: '', house: false, onSand: false, adultsOnly: false, allInclusive: false, affordable: false };
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <div class="sec-head"><div><p class="eyebrow">${icon('palm')}Twenty-three places on the island</p><h1>Stays in Aruba</h1>
        <p>Every price is the Circle’s all-in rate per night — room, the 12.5% tourist levy, service charge, resort fee and the environmental levy. Your binding quote comes from Victor and is usually better.</p>
        <p class="small muted" style="margin-top:8px">${icon('eye', { size: 14, cls: 'ico-muted' })}
          <a href="#/live">See what is open right now</a> at these places — a window on what exists, so you know what to ask for.
          You never book it yourself; you put points in and the Circle books it for you.</p>
        <p class="small muted" style="margin-top:8px">Four of these are where we actually end up: the Marriott villas at the <a href="#/stays/stay_oceanclub">Ocean Club</a> and the <a href="#/stays/stay_surfclub">Surf Club</a>, the <a href="#/stays/stay_divi">Divi</a> on Druif, and the <a href="#/stays/stay_renaissance">Renaissance</a> in town. The rest of the list is here because Victor can get them, not because we have been.</p></div></div>
      <div class="row no-print" id="filters" style="margin-bottom:18px" role="group" aria-label="Filter stays"></div>
      <p class="small muted" id="count" style="margin-bottom:14px"></p>
      <div class="grid g3" id="list"></div>
      <p class="small muted" style="margin-top:22px">Most resorts want a longer stay over Christmas and Carnival; the quote tells you when that applies to your dates. <a href="#/rules">The rules</a> explain how cancellations work.</p>
    </div></section></div>`);
  const list = wrap.querySelector('#list'), filters = wrap.querySelector('#filters'), count = wrap.querySelector('#count');

  const draw = () => {
    filters.innerHTML = `
      <button class="btn ${state.house ? '' : 'quiet'} sm" data-flag="house" aria-pressed="${state.house}">Where we stay</button>
      <select class="btn ghost sm" id="area" aria-label="Area" style="padding-inline:12px"><option value="">Anywhere on the island</option>${AREAS.map(a => `<option${a === state.area ? ' selected' : ''}>${a}</option>`).join('')}</select>
      <button class="btn ${state.onSand ? '' : 'quiet'} sm" data-flag="onSand" aria-pressed="${state.onSand}">On the sand</button>
      <button class="btn ${state.adultsOnly ? '' : 'quiet'} sm" data-flag="adultsOnly" aria-pressed="${state.adultsOnly}">Adults only</button>
      <button class="btn ${state.allInclusive ? '' : 'quiet'} sm" data-flag="allInclusive" aria-pressed="${state.allInclusive}">All-inclusive</button>
      <button class="btn ${state.affordable ? '' : 'quiet'} sm" data-flag="affordable" aria-pressed="${state.affordable}">I can afford it now</button>`;
    let items = store.arubaStays();
    if (state.area) items = items.filter(x => x.area === state.area);
    for (const f of ['house', 'onSand', 'adultsOnly', 'allInclusive']) if (state[f]) items = items.filter(x => x[f]);
    if (state.affordable) items = items.filter(x => avail >= fromPoints(x, s) * (x.minNights || 1));
    items = items.slice().sort((a, b) => (b.house ? 1 : 0) - (a.house ? 1 : 0) || fromPoints(a, s) - fromPoints(b, s));
    count.textContent = `${items.length} of ${store.arubaStays().length} places · from-price a night, all in`;
    list.replaceChildren(...items.map(st => {
      const per = fromPoints(st, s);
      const min = st.minNights || 1;
      const coverable = Math.floor(avail / per);
      const footer = `<span class="small ${coverable >= min ? 'muted' : ''}" style="margin-top:4px">${
        coverable >= min ? `You can cover ${Math.min(coverable, 14)} night${coverable === 1 ? '' : 's'}`
        : `${escapeHtml(fmtUsd2(Math.max(0, min * per - avail) / s.pointsPerDollar))} short of the ${min}-night minimum`}</span>`;
      return stayCard(st, { store, footer });
    }));
    if (!items.length) list.replaceChildren(el(`<div class="empty">${icon('search', { size: 28, cls: 'ico-muted' })}<b style="display:block;margin-top:10px">Nothing matches those filters</b><p class="small muted">Try a different area, or turn off “I can afford it now” to see everything.</p></div>`));
  };
  draw();
  filters.addEventListener('click', (e) => {
    const flagBtn = e.target.closest('[data-flag]');
    if (flagBtn) { state[flagBtn.dataset.flag] = !state[flagBtn.dataset.flag]; draw(); }
  });
  filters.addEventListener('change', (e) => { if (e.target.id === 'area') { state.area = e.target.value; draw(); } });
  return wrap;
}

export function trips({ store }) {
  const me = store.me, s = store.settings;
  const avail = store.availablePoints(me.id);
  const tier = tierFor(s, me.monthlyUsd);
  const all = store.trips();
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <div class="sec-head"><div><p class="eyebrow">${icon('plane')}Sourced by Victor, run with Ian</p><h1>Trips</h1>
        <p>A seat covers the hotels, every internal transfer and everything else listed. Flights to and from Aruba are extra unless the note says otherwise. Guests can come at the same rate, in cash.</p>
        <p class="small muted" style="margin-top:8px">Three countries this cycle: the Dominican Republic in March, Mexico in February, Japan the December after. Read the notes — Victor writes down what the journey actually costs you in days, not just in points.</p></div></div>
      <div class="notice" style="margin-bottom:18px"><b>Everyone can come on everything</b>
        <p class="small">There is no level that shuts you out of a trip. What your level changes is how quickly the points build — at ${escapeHtml(fmtUsd2(me.monthlyUsd))} a month you earn ${escapeHtml(fmtPoints(pointsPerMonth(s, me.monthlyUsd)))}, so a seat further afield takes longer to save for — and the perks: ${tier.holds} open request${tier.holds > 1 ? 's' : ''} at a time, ${tier.windowMonths} months ahead${tier.firstLookHours ? `, and first look at a new trip ${tier.firstLookHours} hours early` : ''}. <a href="#/profile">Change your level</a> any month; it starts on your next contribution.</p></div>
      <div class="grid g3" id="list"></div>
      ${all.length ? '' : `<div class="empty">${icon('plane', { size: 28, cls: 'ico-muted' })}<b style="display:block;margin-top:10px">No trips on the board</b><p class="small muted">Victor posts them as he sources them. Ian sends a note when one goes live.</p></div>`}
    </div></section></div>`);
  const list = wrap.querySelector('#list');
  list.replaceChildren(...all.map(t => {
    const held = store.seatsHeld(t.id);
    const mine = store.state.redemptions.some(r => r.memberId === me.id && r.stayId === t.id && ['requested', 'quoted', 'held', 'confirmed', 'completed'].includes(r.status));
    const seat = seatPoints(t, s);
    const canAfford = avail >= seat;
    const firstLook = t.isDrop && tier.firstLookHours > 0;
    const months = canAfford ? 0 : Math.ceil((seat - Math.max(0, avail)) / pointsPerMonth(s, me.monthlyUsd));
    const footer = `<span class="small muted" style="margin-top:4px">${escapeHtml(fmtDay(t.dates.from))} – ${escapeHtml(fmtDay(t.dates.to))} · ${held} of ${t.seats} seats held${mine ? ' · you are in' : ''}</span>
      <span class="small muted" style="margin-top:2px">${mine ? 'Your seat is held' : canAfford ? 'You can cover a seat now' : `About ${months} more month${months === 1 ? '' : 's'} of contributions`}</span>
      <span class="flags" style="margin-top:6px">
        ${t.isDrop ? `<span class="tag" style="background:var(--flight-soft);border-color:transparent">Drop${firstLook ? ` · your first look` : ''}</span>` : ''}
        <span class="tag">${escapeHtml(REACH[reachOf(t)].label)}</span>
      </span>`;
    return stayCard(t, { store, footer });
  }));
  return wrap;
}

export function stayDetail({ store, params, go }) {
  const me = store.me, s = store.settings;
  const stay = store.stay(params.id);
  if (!stay) return el('<div class="wrap sec"><h1>That place is not on the list</h1><p class="lede" style="margin-top:10px">It may have been retired. <a href="#/stays">Back to the stays</a>.</p></div>');
  const isTrip = stay.kind === 'trip';
  const avail = store.availablePoints(me.id);
  const tier = tierFor(s, me.monthlyUsd);
  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:940px">
      <p class="eyebrow">${escapeHtml(stay.area)}${stay.country !== 'Aruba' ? `, ${escapeHtml(stay.country)}` : ''}${isTrip ? '' : ` · ${stay.onSand ? 'on the sand' : 'across the road'}`}${stay.house ? ' · <span style="color:var(--good-text)">where we stay</span>' : ''}</p>
      <h1>${escapeHtml(stay.name)}</h1>
      <p class="lede" style="margin-top:12px">${escapeHtml(stay.vibe)}</p>
      <div class="stay-card daylight" style="margin-top:20px;border-radius:var(--r-card)"><span class="strip"><span class="ph-note">illustration</span></span></div>
      <div class="row" style="margin-top:14px">${(stay.features || []).map(f => `<span class="tag">${escapeHtml(f)}</span>`).join('')}</div>
      ${(() => {
        // Where the number came from, ALWAYS — including when the answer is "nowhere yet".
        //
        // This panel used to render only when `stay.sources` existed, and no live row had it,
        // because the column did not exist. The one audience who saw it was signed-OUT
        // visitors, through the fallback to the bundled catalog — so a stranger saw the
        // evidence and a member never did. It now says something on every stay, and it never
        // shows a figure without the date it was seen: an undated price comparison is worth
        // nothing, and a six-month-old one is worse than nothing.
        const src = stay.sources || {};
        const rows = [];
        if (src.interval?.seenUsd) rows.push(['Interval', src.interval.seenUsd, src.interval.seenOn, src.interval.note, src.best === 'interval']);
        if (src.redweek?.fromUsd) rows.push(['RedWeek', src.redweek.fromUsd, src.redweek.seenOn, src.redweek.note, src.best === 'redweek']);
        const seenOn = src.interval?.seenOn || src.redweek?.seenOn || null;
        const daysOld = seenOn ? Math.floor((Date.now() - Date.parse(seenOn)) / 864e5) : null;
        const stale = daysOld != null && daysOld > 60;
        return `<div class="panel" style="margin-top:16px">
          <h3>Where this price comes from</h3>
          ${rows.length ? `
            <p class="small muted" style="margin-top:6px">What the public sites were asking for a week here, the last time anyone looked. Interval is surplus inventory so it is not always there, and an owner on RedWeek sometimes beats it.</p>
            <div class="tablewrap" style="margin-top:12px;border:0"><table>
              <thead><tr><th>Where</th><th class="num">Asking</th><th>Seen</th></tr></thead>
              <tbody>
                ${rows.map(([where, usd, on, note, best]) => `<tr${best ? ' class="best"' : ''}>
                  <td><b>${escapeHtml(where)}</b>${best ? ' <span class="tag house">usually cheapest</span>' : ''}
                    ${note ? `<br><span class="small muted">${escapeHtml(note)}</span>` : ''}</td>
                  <td class="num">${escapeHtml(fmtUsd2(usd))}</td>
                  <td class="small muted">${on ? escapeHtml(fmtDay(on)) : '<b>undated</b>'}</td></tr>`).join('')}
                <tr><td><b>The resort</b><br><span class="small muted">Booking direct, for comparison</span></td>
                  <td class="num">${escapeHtml(fmtUsd2(stay.retailUsd || 0))}</td><td class="small muted">—</td></tr>
              </tbody></table></div>
            <p class="tiny ${stale ? '' : 'muted'}" style="margin-top:10px">${stale
              ? `Last checked ${daysOld} days ago — old enough to have moved. Victor re-checks before he quotes you.`
              : 'A night. These move; the number you are quoted is the one Victor actually finds on the day.'}</p>`
          : `<p class="small muted" style="margin-top:6px">Nobody has checked this one against the booking sites yet, so the rate above is the Circle&rsquo;s own negotiated number and nothing else. Victor checks Interval and RedWeek before he books, and what he finds goes here.</p>`}
        </div>`;
      })()}
      ${stay.dealNote ? `<div class="notice" style="margin-top:16px"><b>From Victor</b><p class="small">${escapeHtml(stay.dealNote)}</p></div>` : ''}
      <div class="side" style="margin-top:22px">
        <div class="panel" id="pricing"></div>
        <div class="panel flat" id="afford"></div>
      </div>
      <div id="rooms"></div>
      <div id="reach-note"></div>
      <div class="row" style="margin-top:20px">
        <a class="btn" href="#/book/${escapeHtml(stay.id)}">${icon('send', { size: 17 })}${isTrip ? 'Ask for a seat' : 'Ask Victor for dates'}</a>
        <button class="btn ghost" id="share">${icon('share', { size: 16 })}Share</button>
      </div>
    </div></section></div>`);
  wrap.querySelector('.strip').prepend(stayStrip(stay));

  // What you can actually be given here, and what each one costs a night.
  const roomsSlot = wrap.querySelector('#rooms');
  const rooms = store.roomTypesFor(stay.id);
  if (rooms.length && !isTrip) {
    roomsSlot.appendChild(el(`<section class="panel" style="margin-top:22px">
        <div><p class="eyebrow">${icon('bed')}The rooms</p>
          <h2 style="font-size:1.15rem;margin-top:6px">${rooms.length} you can be given here</h2></div>
        <div class="tablewrap" style="margin-top:14px"><table class="rooms-table">
          <caption class="sr-only">Room types with size, occupancy and from-price per night</caption>
          <thead><tr><th>Room</th><th>Size</th><th>Sleeps</th><th class="num">From, a night</th><th></th></tr></thead>
          <tbody id="r-body"></tbody>
        </table></div>
        <p class="small muted" style="margin-top:12px">${icon('scale', { size: 14, cls: 'ico-muted' })}
          Every room is priced off this property's own rate, so when Victor negotiates a better one they all move together.
          A room marked <em>inferred</em> is one nobody publishes a size for.</p>
      </section>`));
    const drawRooms = () => {
      roomsSlot.querySelector('#r-body').innerHTML = rooms.map(r => {
        const per = store.roomPointsFrom(stay.id, r.id);
        const min = stay.minNights || 1;
        const can = Math.floor(avail / (per || 1));
        return `<tr>
          <td><b>${escapeHtml(r.name)}</b>
            ${r.beds ? `<br><span class="small muted">${escapeHtml(r.beds)}</span>` : ''}
            <br><span class="flags">${r.kitchen === 'full' ? `<span class="tag">${icon('kitchen', { size: 13 })}Full kitchen</span>` : r.kitchen === 'kitchenette' ? '<span class="tag">Kitchenette</span>' : ''}
              ${(r.extras || []).slice(0, 2).map(x => `<span class="tag">${escapeHtml(x)}</span>`).join('')}
              ${r.source === 'inferred' ? '<span class="tag">inferred</span>' : ''}</span></td>
          <td class="small" data-k="Size">${r.sqft ? `${r.sqft.toLocaleString('en-US')} sq ft` : '<span class="muted">not published</span>'}
            ${r.sqm ? `<br><span class="muted">${r.sqm} m²</span>` : ''}</td>
          <td class="small" data-k="Sleeps">${icon('users', { size: 14, cls: 'ico-muted' })} ${r.sleeps}${r.bedrooms ? `<br><span class="muted">${r.bedrooms} bed${r.bedrooms > 1 ? 'rooms' : 'room'}</span>` : ''}</td>
          <td class="num" data-k="A night"><b>${escapeHtml(fmtPoints(per))}</b><br><span class="small muted">${escapeHtml(fmtUsd2(per / s.pointsPerDollar))}</span>
            <br><span class="small ${can >= min ? 'muted' : ''}">${can >= min ? `covers ${Math.min(can, 14)} night${can === 1 ? '' : 's'}` : `${escapeHtml(fmtUsd2(Math.max(0, min * per - avail) / s.pointsPerDollar))} short of ${min}`}</span></td>
          <td><div class="row nowrap" style="gap:6px;justify-content:flex-end;flex-wrap:nowrap">
            <a class="btn ghost sm" href="#/book/${escapeHtml(stay.id)}?room=${escapeHtml(r.id)}">Ask</a>
            <button class="btn quiet sm icon-only" data-watch-room="${escapeHtml(r.id)}" aria-label="Tell me when a ${escapeHtml(r.name)} comes free">${icon('bell', { size: 15 })}</button>
          </div></td></tr>`;
      }).join('');
    };
    drawRooms();
    roomsSlot.addEventListener('click', async (e) => {
      const w = e.target.closest('[data-watch-room]');
      if (w) { const { addWatchSheet } = await import('./deals.js'); addWatchSheet({ store, prefill: { stayId: stay.id, roomTypeId: w.dataset.watchRoom, nights: stay.minNights || 3 } }); }
    });
  }

  if (isTrip) {
    const held = store.seatsHeld(stay.id);
    const roster = store.rosterFor(stay.id);
    wrap.querySelector('#pricing').innerHTML = `
      <h2>${escapeHtml(fmtPoints(seatPoints(stay, s)))} a seat</h2>
      <p class="small muted" style="margin-top:4px">${escapeHtml(pointsUsd(seatPoints(stay, s), s.pointsPerDollar))} all-in for ${stay.nights} nights · the Circle’s 15% is inside it · guests pay ${escapeHtml(fmtUsd2(stay.guestCashUsd))} in cash</p>
      <ul class="ledger" style="margin-top:14px">
        <li><span class="what"><b>Dates</b></span><span class="delta"><b>${escapeHtml(fmtDay(stay.dates.from))} – ${escapeHtml(fmtDay(stay.dates.to))}</b></span></li>
        <li><span class="what"><b>Seats</b><span class="meta">${roster.length ? roster.map(m => escapeHtml(m.name.split(' ')[0])).join(', ') + ' are in' : 'Nobody yet'}</span></span><span class="delta"><b>${held} / ${stay.seats}</b></span></li>
        <li><span class="what"><b>Hold deadline</b><span class="meta">Victor releases the block after this</span></span><span class="delta"><b>${escapeHtml(fmtDay(stay.holdDeadline))}</b></span></li>
        ${(() => {
          const v = versusPublic(stay.retailUsd, seatPoints(stay, s) / s.pointsPerDollar);
          if (!v) return '';
          return `<li><span class="what"><b>Booked alone</b><span class="meta">What the same trip costs on your own</span></span>
            <span class="delta"><b>${escapeHtml(fmtUsd2(v.publicUsd))}</b></span></li>`;
        })()}
      </ul>
      ${versusLine(versusPublic(stay.retailUsd, seatPoints(stay, s) / s.pointsPerDollar), 'a seat')}`;
  } else {
    // Defaults a member would plausibly want: a fortnight out, for this stay's own minimum.
    // The minimum matters — opening on two nights at a villa that only comes by the week would
    // greet everybody with a refusal.
    const today = new Date();
    const soon = new Date(today.getTime() + 14 * 864e5);
    const iso = (d) => new Date(d).toISOString().slice(0, 10);
    const dToday = iso(today), dIn = iso(soon);
    const dOut = iso(soon.getTime() + Math.max(1, stay.minNights || 1) * 864e5);
    wrap.querySelector('#pricing').innerHTML = `
      <h2>What your nights cost</h2>
      <p class="small muted" style="margin-top:6px">From <b class="num">${escapeHtml(fmtPoints(fromPoints(stay, s)))}</b> a night. Put your dates in and it prices those exact nights — the same arithmetic the Desk quotes from.</p>
      <div class="grid g2" style="margin-top:14px">
        <label class="field"><span>Check in</span><input type="date" id="q-in" value="${escapeHtml(dIn)}" min="${escapeHtml(dToday)}"></label>
        <label class="field"><span>Check out</span><input type="date" id="q-out" value="${escapeHtml(dOut)}" min="${escapeHtml(dToday)}"></label>
      </div>
      <div id="q-out-slot"></div>`;

    // A date-driven quote instead of a table of three seasons. Same numbers, none of the
    // vocabulary: the member says when, and the app says what — which is the only question
    // they ever had. quoteStay walks the nights exactly as the database does, so this figure
    // and the Desk's binding quote come from one piece of arithmetic.
    const qSlot = wrap.querySelector('#q-out-slot');
    const drawQuote = () => {
      const ci = wrap.querySelector('#q-in').value, co = wrap.querySelector('#q-out').value;
      const q = quoteStay(stay, ci, co, s);
      if (!q.nights) { qSlot.innerHTML = '<p class="small muted">Pick a check-out after your check-in.</p>'; return; }
      const short = Math.max(0, q.points - avail);
      qSlot.innerHTML = `
        <div class="notice${q.ok ? '' : ' warn'}" style="margin-top:4px">
          ${q.ok ? `<b>${escapeHtml(fmtPoints(q.points))} for ${q.nights} night${q.nights > 1 ? 's' : ''}</b>
            <p class="small">${escapeHtml(fmtUsd2(q.points / s.pointsPerDollar))} all in — ${escapeHtml(fmtUsd2(q.points / s.pointsPerDollar / q.nights))} a night on average.
            ${escapeHtml(fmtPoints(q.basePoints))} is the room and ${escapeHtml(fmtPoints(q.servicePoints))} is the Circle's 15%.
            ${short ? `You are ${escapeHtml(fmtPoints(short))} short — a top-up of ${escapeHtml(fmtUsd2(short / s.pointsPerDollar))} in cash, at face value.` : 'Covered by the points you hold.'}</p>`
          : `<b>${escapeHtml(stay.name)} wants ${q.minNights} nights for those dates</b>
            <p class="small">Most resorts ask for longer over Christmas and Carnival. Move a date, or ask anyway and Victor will tell you what he can get.</p>`}
        </div>
        ${q.ok ? versusLine(versusPublic(q.retailUsd, q.points / s.pointsPerDollar), `for ${q.nights} night${q.nights > 1 ? 's' : ''}`) : ''}
        <p style="margin-top:12px"><a class="btn" href="#/book/${escapeHtml(stay.id)}?from=${escapeHtml(ci)}&to=${escapeHtml(co)}">${icon('send', { size: 17 })}Ask for these dates</a></p>
        <p class="small muted" style="margin-top:10px">${stay.taxesIncluded ? 'Taxes and breakfast are already in this.' : 'Room, the 12.5% tourist levy, service charge, resort fee and environmental levy are all in this.'} Victor's binding quote is usually better.</p>`;
    };
    drawQuote();
    wrap.querySelector('#pricing').addEventListener('change', (e) => { if (e.target.id === 'q-in' || e.target.id === 'q-out') drawQuote(); });
  }
  const per = unitPoints(stay, s);
  const min = isTrip ? 1 : (stay.minNights || 1);
  const canCover = Math.floor(avail / per);
  wrap.querySelector('#afford').innerHTML = `
    <p class="eyebrow">${icon('spark')}Against your points</p>
    <div class="row" style="gap:14px;margin-top:12px;align-items:center"><span id="ring"></span>
      <div class="small"><b>${escapeHtml(fmtPoints(avail))}</b> available<br>
      <span class="muted">${canCover >= min ? `enough for ${Math.min(canCover, 14)} ${isTrip ? 'seat' : 'night'}${canCover === 1 ? '' : 's'}` : `${escapeHtml(fmtUsd2(Math.max(0, min * per - avail) / s.pointsPerDollar))} short of ${isTrip ? 'a seat' : `the ${min}-night minimum`}`}</span></div></div>
    <p class="small muted" style="margin-top:14px">Short of it? Pay the difference as a top-up when Victor quotes you — at face value, since the Circle's share is already in the quote. Nothing is booked on credit.</p>
    <p class="small muted" style="margin-top:8px">${escapeHtml(tierName(me.monthlyUsd))} can hold ${tier.holds} open request${tier.holds > 1 ? 's' : ''} and book ${tier.windowMonths} months ahead.</p>`;
  wrap.querySelector('#ring').replaceChildren(ring({ total: min, filled: Math.min(min, canCover), size: 76, label: String(Math.min(canCover, 99)), sub: isTrip ? 'seats' : 'nights' }));
  {
    // Nobody is turned away from a trip. If it is more than they hold, say plainly how
    // long it takes at their level — and how long it would take at the others.
    const price = isTrip ? seatPoints(stay, s) : fromPoints(stay, s) * (stay.minNights || 1);
    const pace = store.monthsToAfford(price);
    const mineRow = pace?.find(x => x.mine);
    if (mineRow && mineRow.months > 0) {
      const faster = pace.filter(x => !x.mine && x.months < mineRow.months);
      wrap.querySelector('#reach-note').innerHTML = `<div class="notice" style="margin-top:18px">
        <b>About ${mineRow.months} more month${mineRow.months === 1 ? '' : 's'} at your level</b>
        <p class="small">You hold ${escapeHtml(fmtPoints(Math.max(0, store.availablePoints(me.id))))} and ${isTrip ? 'a seat' : `${stay.minNights} night${stay.minNights > 1 ? 's' : ''}`} here is ${escapeHtml(fmtPoints(price))}. At ${escapeHtml(fmtUsd2(me.monthlyUsd))} a month you earn ${escapeHtml(fmtPoints(pointsPerMonth(s, me.monthlyUsd)))}.
        ${faster.length ? `At ${faster.map(f => `${escapeHtml(fmtUsd2(f.tier.monthlyUsd))} it would be ${f.months}`).join(', and at ')}.` : ''}
        You can ask for it now either way — Victor quotes it, and you accept when the points are there. Or ${escapeHtml(fmtUsd2((price - Math.max(0, store.availablePoints(me.id))) / s.pointsPerDollar))} as a cash top-up closes the gap.</p></div>`;
    }
  }
  wrap.querySelector('#share').addEventListener('click', () => shareText({
    title: stay.name, text: `${stay.name} — ${fmtPoints(per)} ${isTrip ? 'a seat' : 'a night'} through the ${VOCAB.clubName}.`,
    url: `${location.origin}${location.pathname}#/${isTrip ? 'trips' : 'stays'}/${stay.id}`,
  }));
  return wrap;
}

export function book({ store, params, query = {}, go }) {
  const me = store.me, s = store.settings;
  const stay = store.stay(params.id);
  if (!stay) return el('<div class="wrap sec"><h1>Nothing to request</h1><p class="lede" style="margin-top:10px"><a href="#/stays">Back to the stays</a>.</p></div>');
  const isTrip = stay.kind === 'trip';
  const avail = store.availablePoints(me.id);
  const tier = tierFor(s, me.monthlyUsd);
  const today = new Date(); const soon = new Date(today); soon.setMonth(soon.getMonth() + 2);
  const d = (x) => x.toISOString().slice(0, 10);

  // Three screens link here with what the member already chose — a deal's dates, a week seen on
  // Interval, a room out of the room table — and this form threw all of it away and opened on
  // "two months from today, any room". Somebody who tapped "Ask for it" under a specific week
  // then had to retype that week. The link carried the answer; use it.
  const isDate = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) && !Number.isNaN(Date.parse(x));
  const wantFrom = isDate(query.from) && Date.parse(query.from) >= Date.parse(d(today)) ? query.from : null;
  const wantTo = wantFrom && isDate(query.to) && Date.parse(query.to) > Date.parse(wantFrom) ? query.to : null;
  const startIn = wantFrom || d(soon);
  const startOut = wantTo || d(new Date(Date.parse(startIn) + (stay.minNights || 2) * 864e5));
  const wantRoom = (store.roomTypesFor?.(stay.id) || []).find(r => r.id === query.room) || null;
  // The request has no room column, and inventing one across two backends to carry a
  // preference is the wrong trade — the note is the field for exactly this, and it reaches
  // Victor with everything else. It is prefilled, not locked: it is still the member's message.
  const openingNote = [
    wantRoom ? `${wantRoom.name}, if it is free.` : '',
    query.deal ? 'Asking against a deal from the board.' : '',
  ].filter(Boolean).join(' ');
  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:720px">
      <p class="eyebrow">${escapeHtml(stay.area)}</p>
      <h1>${isTrip ? 'Ask for a seat' : 'Ask Victor for dates'}</h1>
      <p class="lede" style="margin-top:10px">${escapeHtml(stay.name)}. He answers within ${tierFor(s, me.monthlyUsd).slaHours ?? s.slaHours} hours with an all-in price in points, locked for ${s.quoteHours} hours. Nothing is committed until you accept it.</p>
      <form class="panel" id="form" style="margin-top:20px">
        ${isTrip ? `<div class="notice"><b>${escapeHtml(fmtDay(stay.dates.from))} – ${escapeHtml(fmtDay(stay.dates.to))}</b>
            <p class="small">${stay.nights} nights · ${escapeHtml(fmtPoints(seatPoints(stay, s)))} a seat · ${store.seatsHeld(stay.id)} of ${stay.seats} seats held</p></div>
          <label class="field" style="margin-top:14px"><span>Seats</span><input name="seats" type="number" min="1" max="4" value="1" inputmode="numeric"></label>`
        : `${wantFrom ? `<div class="notice" style="margin-bottom:14px"><b>${escapeHtml(fmtDay(startIn))} – ${escapeHtml(fmtDay(startOut))}</b>
              <p class="small">The dates you came in with. Change them if you meant others.</p></div>` : ''}
          <div class="grid g2">
            <label class="field"><span>Check in</span><input name="checkIn" type="date" required value="${escapeHtml(startIn)}" min="${d(today)}"></label>
            <label class="field"><span>Check out</span><input name="checkOut" type="date" required value="${escapeHtml(startOut)}" min="${d(today)}"></label>
          </div>
          ${wantRoom ? `<div class="notice" style="margin-bottom:14px"><b>${escapeHtml(wantRoom.name)}</b>
              <p class="small">From ${escapeHtml(fmtPoints(store.roomPointsFrom(stay.id, wantRoom.id)))} a night. It is in your note below, so Victor prices that room — ask for another and he will price that instead.</p></div>` : ''}
          <div class="grid g2">
            <label class="field"><span>Guests</span><input name="guests" type="number" min="1" max="8" value="2" inputmode="numeric"></label>
            <label class="field"><span>Flexible by</span><select name="flexDays"><option value="0">Exact dates</option><option value="1">A day either way</option><option value="3">Three days either way</option><option value="7">A week either way</option></select></label>
          </div>`}
        <label class="field"><span>Anything Victor should know</span><textarea name="note" rows="3" placeholder="Ground floor if possible, arriving late, celebrating something…">${escapeHtml(openingNote)}</textarea></label>
        <label class="row" style="gap:10px;align-items:flex-start;margin-bottom:14px">
          <input type="checkbox" name="shared" style="width:20px;height:20px;margin-top:2px">
          <span class="small">Let the Circle chip in. <span class="muted">Anyone can add their own points toward this booking — for a room you are sharing, or a gift. Their points are committed the moment they chip in, and released if it falls through.</span></span></label>
        <div id="preview" class="notice" style="margin-bottom:16px"></div>
        <button class="btn block" type="submit">Send the request</button>
        <p class="small muted" style="margin-top:12px">You currently hold ${escapeHtml(fmtPoints(avail))} available and can have ${tier.holds} open request${tier.holds > 1 ? 's' : ''} at a time as ${escapeHtml(tierName(me.monthlyUsd))}.</p>
      </form>
    </div></section></div>`);
  const form = wrap.querySelector('#form'), preview = wrap.querySelector('#preview');
  const update = () => {
    const f = new FormData(form);
    const seats = Number(f.get('seats') || 1);
    const ci = isTrip ? stay.dates.from : f.get('checkIn'), co = isTrip ? stay.dates.to : f.get('checkOut');
    const q = quoteStay(stay, ci, co, s, { seats });
    if (!q.nights) { preview.innerHTML = '<b>Pick your dates</b>'; return; }
    const short = Math.max(0, q.points - avail);
    preview.className = `notice${q.ok ? '' : ' warn'}`;
    preview.innerHTML = q.ok
      ? `<b>Indicative: ${escapeHtml(fmtPoints(q.points))} (${escapeHtml(fmtUsd2(q.points / s.pointsPerDollar))})</b>
         <p class="small">${q.nights} night${q.nights > 1 ? 's' : ''}${isTrip || q.nights < 1 ? '' : ` · ${escapeHtml(fmtUsd2(q.points / s.pointsPerDollar / q.nights))} a night on average`}.
         ${escapeHtml(fmtPoints(q.basePoints))} is the room and ${escapeHtml(fmtPoints(q.servicePoints))} is the Circle's 15% — the only fee there is, and this is where it is charged.
         ${short ? `You are ${escapeHtml(fmtPoints(short))} short — that would be a top-up of ${escapeHtml(fmtUsd2(short / s.pointsPerDollar))} in cash, at face value.` : 'Covered by the points you hold.'}
         ${q.retailUsd ? ` Booked alone this runs about ${escapeHtml(fmtUsd2(q.retailUsd))}.` : ''}</p>`
      : `<b>${stay.name} needs at least ${q.minNights} nights for those dates</b>
         <p class="small">${q.breakdown.peak ? 'Christmas and Carnival weeks carry a longer minimum at most resorts.' : ''}</p>`;
  };
  update();
  form.addEventListener('input', update);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form); const btn = form.querySelector('button[type=submit]');
    setBusy(btn, true, 'Sending…');
    try {
      const r = await store.requestRedemption({
        memberId: me.id, stayId: stay.id,
        checkIn: isTrip ? stay.dates.from : f.get('checkIn'), checkOut: isTrip ? stay.dates.to : f.get('checkOut'),
        guests: Number(f.get('guests') || 1), seats: Number(f.get('seats') || 1),
        note: f.get('note'), flexDays: Number(f.get('flexDays') || 0), shared: !!f.get('shared'),
      });
      toast('Sent to Victor. He answers within 72 hours.', { kind: 'good' });
      go(`/requests/${r.id}`);
    } catch (err) { setBusy(btn, false); toast(err.message, { kind: 'bad', timeout: 6000 }); }
  });
  return wrap;
}

const GROUPS = [
  ['quoted', 'Waiting on you'], ['requested', 'With Victor'], ['held', 'Committed'],
  ['confirmed', 'Booked'], ['completed', 'Been and gone'], ['declined', 'Declined'], ['cancelled', 'Cancelled'], ['expired', 'Expired'],
];

export function requests({ store }) {
  const me = store.me;
  const mine = store.redemptionsFor(me.id);
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <h1>Your requests</h1>
      <div class="stack" id="groups" style="margin-top:20px"></div>
    </div></section></div>`);
  const groups = wrap.querySelector('#groups');
  if (!mine.length) {
    groups.appendChild(el(`<div class="empty"><b>Nothing requested</b>
      <p class="small muted">Pick a stay and tell Victor your dates — he answers within 72 hours.</p>
      <a class="btn sm" href="#/stays">Look at the stays</a></div>`));
    return wrap;
  }
  for (const [status, label] of GROUPS) {
    const items = mine.filter(r => r.status === status);
    if (!items.length) continue;
    groups.appendChild(el(`<div class="panel">
      <div class="row-between"><h2 style="font-size:1.05rem">${escapeHtml(label)}</h2><span class="small muted">${items.length}</span></div>
      <ul class="ledger" style="margin-top:10px">${items.map(r => {
        const st = store.stay(r.stayId);
        const left = r.status === 'quoted' ? countdownTo(r.quoteExpiresAt) : null;
        return `<li><span class="what"><b><a href="#/requests/${r.id}">${escapeHtml(st?.name || 'Stay')}</a></b>
            <span class="meta">${escapeHtml(fmtDay(r.checkIn))} · ${r.nights} night${r.nights > 1 ? 's' : ''}${r.shared ? ` · ${(r.pledges || []).length ? `${(r.pledges || []).length} chipped in` : 'open to the Circle'}` : ''}${r.decision ? ` · ${escapeHtml(r.decision.slice(0, 70))}${r.decision.length > 70 ? '…' : ''}` : ''}</span></span>
          <span class="delta"><b>${escapeHtml(fmtPoints(r.quotedPoints || r.indicativePoints || r.points))}</b>
            <small>${left ? `expires in ${escapeHtml(left)}` : escapeHtml(statusLabel(r.status))}</small></span></li>`;
      }).join('')}</ul></div>`));
  }
  return wrap;
}

export function requestDetail({ store, params, go, refresh }) {
  const me = store.me, s = store.settings;
  const r = store.redemption(params.id);
  if (!r) return el('<div class="wrap sec"><h1>No such request</h1><p class="lede" style="margin-top:10px"><a href="#/requests">Your requests</a>.</p></div>');
  const stay = store.stay(r.stayId);
  const member = store.member(r.memberId);
  const mine = r.memberId === me.id;
  const canQuote = store.canQuote(r);
  const canPay = store.canConfirmMoney() || store.hasRole('planner', 'admin');
  const left = countdownTo(r.quoteExpiresAt);
  const avail = store.availablePoints(r.memberId);

  const steps = [
    { key: 'requested', label: 'Requested', at: r.requestedAt, who: member?.name },
    { key: 'quoted', label: 'Quoted', at: r.quotedAt, who: store.member(r.quotedBy)?.name },
    { key: 'held', label: 'Accepted · points committed', at: r.heldAt, who: member?.name },
    { key: 'confirmed', label: 'Paid and booked', at: r.confirmedAt, who: store.member(r.decidedBy)?.name },
    { key: 'completed', label: 'Stayed', at: r.completedAt },
  ];
  const order = ['requested', 'quoted', 'held', 'confirmed', 'completed'];
  const at = order.indexOf(r.status);

  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:860px">
      <p class="eyebrow">${escapeHtml(stay?.area || '')} · ${escapeHtml(statusLabel(r.status))}</p>
      <h1>${escapeHtml(stay?.name || 'Stay')}</h1>
      <p class="lede" style="margin-top:10px">${escapeHtml(fmtDay(r.checkIn))} – ${escapeHtml(fmtDay(r.checkOut))} · ${r.nights} night${r.nights > 1 ? 's' : ''} · ${r.guests} guest${r.guests > 1 ? 's' : ''}${mine ? '' : ` · ${escapeHtml(member?.name || '')}`}</p>

      <div class="side" style="margin-top:22px">
        <div class="stack">
          <div class="panel" id="money"></div>
          <div id="chipin"></div>
          ${r.note ? `<div class="panel flat"><p class="eyebrow">${icon('user')}What they asked for</p><p class="small" style="margin-top:8px">${escapeHtml(r.note)}</p></div>` : ''}
          ${r.decision ? `<div class="notice ${['declined', 'cancelled', 'expired'].includes(r.status) ? 'bad' : ''}">
            <b>${escapeHtml(['declined'].includes(r.status) ? 'Declined by ' : 'Note from ')}${escapeHtml(store.member(r.decidedBy || r.quotedBy)?.name.split(' ')[0] || 'the Desk')}</b>
            <p class="small">${escapeHtml(r.decision)}</p></div>` : ''}
          <div class="panel" id="actions"></div>
        </div>
        <div class="panel flat">
          <p class="eyebrow">${icon('history')}What happened when</p>
          <ul class="timeline" style="margin-top:12px">
            ${steps.filter(st2 => st2.at || order.indexOf(st2.key) <= Math.max(at, 0)).map(st2 => `<li class="${st2.at ? 'done' : order.indexOf(st2.key) === at + 1 ? 'now' : ''}">
              <b>${escapeHtml(st2.label)}</b><br><span class="when">${st2.at ? escapeHtml(fmtDayTime(st2.at)) : 'not yet'}${st2.who ? ` · ${escapeHtml(st2.who.split(' ')[0])}` : ''}</span></li>`).join('')}
          </ul>
          ${r.hotelDeadline ? `<p class="small muted" style="margin-top:14px">Free cancellation with the hotel until <b class="num">${escapeHtml(fmtDay(r.hotelDeadline))}</b>. ${escapeHtml(r.hotelTerms || '')}</p>` : ''}
        </div>
      </div>
    </div></section></div>`);

  const money = wrap.querySelector('#money');
  const pts = r.quotedPoints || r.indicativePoints || r.points;
  money.innerHTML = `
    <div class="row-between"><h2 style="font-size:1.1rem">${r.quotedPoints ? 'The quote' : 'Indicative price'}</h2>
      ${left && r.status === 'quoted' ? `<span class="chip chip-warn"><i></i>expires in <span class="num">${escapeHtml(left)}</span></span>` : ''}</div>
    <ul class="ledger" style="margin-top:10px">
      <li><span class="what"><b>${r.nights} night${r.nights > 1 ? 's' : ''} all-in</b>
        <span class="meta">${r.quoteStack ? Object.entries(r.quoteStack).map(([k, v]) => `${k} ${fmtUsd2(v)}`).join(' · ') : 'Room, levies, service and resort fees included'}</span></span>
        <span class="delta"><b>${escapeHtml(fmtPoints(pts))}</b><small>${escapeHtml(pointsUsd(pts, s.pointsPerDollar))}</small></span></li>
      ${r.topUpUsd ? `<li><span class="what"><b>Top-up in cash</b><span class="meta">Beyond the points held, at face value — the share is already in the quote.</span></span>
        <span class="delta"><b>${escapeHtml(fmtUsd2(r.topUpUsd))}</b><small>${r.topUpConfirmed ? 'received' : 'to the Banker'}</small></span></li>` : ''}
      ${r.retailUsd ? `<li><span class="what"><b>Booked on your own</b><span class="meta">Same room, public all-in rate</span></span>
        <span class="delta"><b>${escapeHtml(fmtUsd2(r.retailUsd))}</b><small>you save ${escapeHtml(fmtUsd2(Math.max(0, r.retailUsd - pts / s.pointsPerDollar)))}</small></span></li>` : ''}
      ${r.confirmationRef ? `<li><span class="what"><b>Hotel confirmation</b></span><span class="delta"><b class="num">${escapeHtml(r.confirmationRef)}</b></span></li>` : ''}
    </ul>`;

  // ---- who is chipping in
  const chip$ = wrap.querySelector('#chipin');
  const target = r.quotedPoints || r.indicativePoints || 0;
  const covered = store.coveredPoints(r);
  const outstanding = Math.max(0, target - covered);
  const canChipIn = r.shared && ['quoted', 'held'].includes(r.status) && outstanding > 0 && r.memberId !== me.id;
  const myPledge = (r.pledges || []).find(p => p.memberId === me.id);
  if (r.shared || (r.pledges || []).length) {
    const parts = [{ memberId: r.memberId, points: r.points, owner: true }, ...(r.pledges || [])];
    chip$.className = 'panel';
    chip$.innerHTML = `
      <div class="row-between"><h2 style="font-size:1.1rem">Everyone chipping in</h2>
        <span class="small muted num">${escapeHtml(fmtPoints(covered))} of ${escapeHtml(fmtPoints(target))}</span></div>
      <div class="balbar" style="margin-top:12px" role="img" aria-label="${covered} of ${target} points covered">
        <span class="b-avail" style="width:${Math.min(100, (covered / Math.max(target, 1)) * 100)}%"></span></div>
      <ul class="ledger" style="margin-top:10px">
        ${parts.filter(p => p.points > 0).map(p => {
          const m2 = store.member(p.memberId);
          return `<li><span class="what"><b>${escapeHtml(m2?.name || 'An Insider')}${p.owner ? ' · asked for it' : ''}</b>
              <span class="meta">${p.owner ? 'their own points' : `chipped in ${escapeHtml(fmtDay(p.at))}`}</span></span>
            <span class="delta"><b>${escapeHtml(fmtPoints(p.points))}</b><small>${escapeHtml(pointsUsd(p.points, s.pointsPerDollar))}</small>
              ${!p.owner && (p.memberId === me.id || store.hasRole('planner', 'admin')) && !['confirmed', 'completed'].includes(r.status)
                ? `<button class="btn quiet sm" data-unpledge="${escapeHtml(p.memberId)}">Take it back</button>` : ''}</span></li>`;
        }).join('')}
      </ul>
      ${outstanding > 0
        ? `<p class="small muted" style="margin-top:10px">${escapeHtml(fmtPoints(outstanding))} still to cover — ${escapeHtml(pointsUsd(outstanding, s.pointsPerDollar))}.
             ${r.topUpUsd ? `Whatever is left when Victor books it is paid in cash by ${escapeHtml(store.member(r.memberId)?.name.split(' ')[0] || 'the member')}.` : ''}</p>`
        : `<p class="small" style="margin-top:10px;color:var(--good-text)">Fully covered by the Circle.</p>`}
      ${canChipIn ? `<form class="row" id="pledge-form" style="margin-top:14px;align-items:flex-end">
          <label class="field" style="margin:0;flex:1;min-width:150px"><span>Chip in</span>
            <input name="points" type="number" inputmode="numeric" min="1" max="${Math.min(outstanding, Math.max(0, store.availablePoints(me.id)))}"
                   value="${Math.min(outstanding, Math.max(0, store.availablePoints(me.id)))}" class="mono">
            <span class="hint" id="pledge-usd"></span></label>
          <button class="btn" type="submit">Chip in</button>
        </form>` : ''}
      ${!canChipIn && myPledge ? `<p class="small muted" style="margin-top:10px">You have chipped in ${escapeHtml(fmtPoints(myPledge.points))}.</p>` : ''}
      ${r.shared && r.memberId === me.id ? `<p class="small" style="margin-top:12px"><button class="btn ghost sm" id="ask-circle">Ask the Circle to chip in</button></p>` : ''}`;
    const form = chip$.querySelector('#pledge-form');
    if (form) {
      const sync = () => { chip$.querySelector('#pledge-usd').textContent = `${pointsUsd(Number(form.points.value) || 0, s.pointsPerDollar)} of the booking`; };
      sync(); form.addEventListener('input', sync);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await store.pledgeToRedemption(r.id, me.id, Number(form.points.value)); toast('Chipped in. Your points are committed until the booking is paid or falls through.', { kind: 'good' }); }
        catch (err) { toast(err.message, { kind: 'bad', timeout: 6000 }); }
      });
    }
    chip$.addEventListener('click', async (e) => {
      const un = e.target.closest('[data-unpledge]');
      if (un) {
        try { await store.withdrawPledge(r.id, un.dataset.unpledge, me.id); toast('Taken back. Those points are yours to spend again.'); }
        catch (err) { toast(err.message, { kind: 'bad' }); }
      }
      if (e.target.id === 'ask-circle') {
        shareText({ title: stay?.name, text: `I am putting ${fmtPoints(target)} toward ${stay?.name} from ${fmtDay(r.checkIn)} through the ${VOCAB.clubName} and ${fmtPoints(outstanding)} is still to cover. Chip in if you are coming.`,
          url: `${location.origin}${location.pathname}#/requests/${r.id}` });
      }
    });
  }

  const actions = wrap.querySelector('#actions');
  const buttons = [];
  if (mine && r.status === 'quoted' && left) buttons.push('<button class="btn" data-act="accept">Accept and commit the points</button>');
  if (mine && ['requested', 'quoted', 'held'].includes(r.status)) buttons.push('<button class="btn ghost" data-act="cancel">Cancel this request</button>');
  if (canQuote && r.status === 'requested') buttons.push('<button class="btn" data-act="quote">Quote it</button><button class="btn danger" data-act="decline">Decline</button>');
  const topUpOwed = r.status === 'held' && r.topUpUsd > 0 && !r.topUpConfirmed;
  if (canPay && r.status === 'held') buttons.push(`<button class="btn good" data-act="pay"${topUpOwed ? ' disabled' : ''}>Pay the hotel and burn the points</button>`);
  if (canPay && topUpOwed) buttons.push('<button class="btn" data-act="topup">Mark the top-up received</button>');
  if (store.hasRole('planner', 'admin') && r.status === 'confirmed') buttons.push('<button class="btn ghost" data-act="complete">Mark as stayed</button><button class="btn danger" data-act="cancelPaid">Cancel the booking</button>');
  actions.innerHTML = buttons.length
    ? `<p class="eyebrow">${icon('zap')}What you can do</p><div class="row" style="margin-top:12px">${buttons.join('')}</div>
       ${topUpOwed ? `<p class="small" style="margin-top:12px;color:var(--flag)">The hotel cannot be paid until the ${escapeHtml(fmtUsd2(r.topUpUsd))} top-up has reached the Banker. Nothing is ever booked on credit.</p>` : ''}
       ${r.status === 'quoted' && mine ? `<p class="small muted" style="margin-top:12px">Accepting moves ${escapeHtml(fmtPoints(Math.min(pts, avail)))} into Committed. They are still yours and still counted in the Circle’s coverage until the hotel is paid.</p>` : ''}`
    : '';
  if (!buttons.length) actions.remove();

  actions.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    try {
      if (act === 'accept') { await store.acceptQuote(r.id, me.id); toast('Accepted. Your points are committed while Victor books it.', { kind: 'good' }); }
      if (act === 'cancel') {
        const yes = await confirmDialog({ title: 'Cancel this request?', message: 'Nothing has been committed to a hotel yet, so nothing is lost.', confirmText: 'Cancel it', danger: true });
        if (yes) { await store.cancelRedemption(r.id, me.id, { reason: 'Cancelled by the member' }); toast('Cancelled.'); go('/requests'); return; }
      }
      if (act === 'decline') {
        const reason = await confirmDialog({ title: 'Decline this request', requireReason: true, reasonLabel: 'What should they know? They read this word for word.', confirmText: 'Decline', danger: true,
          message: 'Say what is not possible and, if you can, what is.' });
        if (reason) { await store.declineRedemption(r.id, me.id, reason); toast('Declined, with your reason.'); }
      }
      if (act === 'quote') await quoteSheet(store, r, stay);
      if (act === 'topup') { await store.confirmTopUp(r.id, me.id); toast('Top-up marked as received.'); }
      if (act === 'pay') {
        const out = await sheet({ title: 'Pay the hotel', render: (body, close) => {
          body.innerHTML = `<p class="sheet-text">This burns ${escapeHtml(fmtPoints(r.points))} from ${escapeHtml(member?.name || 'the member')} and records what the Reserve actually paid.</p>
            <label class="field"><span>Amount paid to the hotel</span><input name="paid" type="number" step="0.01" value="${(r.quotedPoints / s.pointsPerDollar).toFixed(2)}" inputmode="decimal"></label>
            <label class="field"><span>Hotel confirmation number</span><input name="ref" placeholder="e.g. BT-2026-4471" required></label>
            <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn good" data-ok>Pay and burn</button></div>`;
          body.querySelector('[data-ok]').addEventListener('click', () => {
            const ref = body.querySelector('[name=ref]').value.trim();
            if (!ref) { body.querySelector('[name=ref]').classList.add('invalid'); return; }
            close({ paidUsd: Number(body.querySelector('[name=paid]').value), confirmationRef: ref });
          });
        } });
        if (out) { await store.payRedemption(r.id, me.id, out); toast('Booked. The points are burned and the ledger shows it.', { kind: 'good' }); }
      }
      if (act === 'complete') { await store.completeRedemption(r.id, me.id); toast('Marked as stayed.'); }
      if (act === 'cancelPaid') {
        const reason = await confirmDialog({ title: 'Cancel a booked stay', requireReason: true, reasonLabel: 'Why, and what did the hotel charge?', confirmText: 'Cancel the booking', danger: true,
          message: 'Whatever the hotel keeps comes off the member’s points; the rest is refunded to them.' });
        if (reason) {
          const penalty = await sheet({ title: 'Hotel penalty', render: (body, close) => {
            body.innerHTML = `<p class="sheet-text">In points. Enter 0 if the hotel refunded everything.</p>
              <label class="field"><span>Penalty in points</span><input name="p" type="number" min="0" value="0" inputmode="numeric"></label>
              <div class="sheet-actions"><button class="btn ghost" data-close>Back</button><button class="btn danger" data-ok>Cancel the booking</button></div>`;
            body.querySelector('[data-ok]').addEventListener('click', () => close(Number(body.querySelector('[name=p]').value) || 0));
          } });
          if (penalty !== undefined) { await store.cancelRedemption(r.id, me.id, { reason, penaltyPoints: penalty }); toast('Cancelled and refunded in points.'); }
        }
      }
    } catch (err) { toast(err.message, { kind: 'bad', timeout: 6000 }); }
  });
  return wrap;
}

/** Victor's quote composer: build the all-in stack, and the points follow. */
export async function quoteSheet(store, r, stay) {
  const s = store.settings;
  const indicative = r.indicativePoints || 0;
  const out = await sheet({ title: `Quote ${stay?.name || 'this stay'}`, wide: true, render: (body, close) => {
    body.innerHTML = `
      <p class="sheet-text">Build the all-in cost. The member sees the stack and the points, and the quote is locked for ${s.quoteHours} hours.</p>
      <div class="grid g3">
        <label class="field"><span>Room total</span><input name="room" type="number" step="0.01" value="${(indicative / s.pointsPerDollar * 0.72).toFixed(2)}" inputmode="decimal"></label>
        <label class="field"><span>Tourist levy 12.5%</span><input name="levy" type="number" step="0.01" value="${(indicative / s.pointsPerDollar * 0.09).toFixed(2)}" inputmode="decimal"></label>
        <label class="field"><span>Service charge</span><input name="service" type="number" step="0.01" value="${(indicative / s.pointsPerDollar * 0.1).toFixed(2)}" inputmode="decimal"></label>
        <label class="field"><span>Resort fee</span><input name="resort" type="number" step="0.01" value="${(indicative / s.pointsPerDollar * 0.08).toFixed(2)}" inputmode="decimal"></label>
        <label class="field"><span>Environmental levy</span><input name="env" type="number" step="0.01" value="${(r.nights * 6).toFixed(2)}" inputmode="decimal"></label>
        <div class="stat"><span class="k">Quote</span><b class="num" id="q-total">—</b><span class="sub" id="q-pts">—</span></div>
      </div>
      <label class="field"><span>Hotel’s cancellation terms</span><input name="terms" value="Free cancellation up to 30 days before arrival." ></label>
      <label class="field"><span>Free-cancellation deadline</span><input name="deadline" type="date" value="${new Date(new Date(r.checkIn).getTime() - 30 * 864e5).toISOString().slice(0, 10)}"></label>
      <label class="field"><span>A line for the member</span><textarea name="note" rows="2" placeholder="Lagoon view, high floor — and I got the resort fee waived."></textarea></label>
      <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>Publish the quote</button></div>`;
    const total = () => ['room', 'levy', 'service', 'resort', 'env'].reduce((sum, k) => sum + (Number(body.querySelector(`[name=${k}]`).value) || 0), 0);
    const sync = () => {
      const t = total();
      body.querySelector('#q-total').textContent = fmtUsd2(t);
      body.querySelector('#q-pts').textContent = fmtPoints(Math.round(t * s.pointsPerDollar));
    };
    sync(); body.addEventListener('input', sync);
    body.querySelector('[data-ok]').addEventListener('click', () => {
      const stack = Object.fromEntries(['room', 'levy', 'service', 'resort', 'env'].map(k => [k, Number(body.querySelector(`[name=${k}]`).value) || 0]));
      close({ points: Math.round(total() * s.pointsPerDollar), stack, terms: body.querySelector('[name=terms]').value,
        hotelDeadline: body.querySelector('[name=deadline]').value, note: body.querySelector('[name=note]').value });
    });
  } });
  if (out) { await store.quoteRedemption(r.id, store.me.id, out); toast('Quote published. It is locked for 72 hours.', { kind: 'good' }); }
}
