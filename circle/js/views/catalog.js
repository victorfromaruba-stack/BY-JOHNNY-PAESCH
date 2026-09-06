// Stays, trips, requesting one, and the life of a request.
import { escapeHtml, fmtUsd2, fmtPoints, pointsUsd, fmtDay, fmtDayTime, countdownTo, initials, nightsBetween } from '../core/util.js';
import { VOCAB, tierName } from '../core/vocab.js';
import { quoteStay, seasonPoints, SEASONS, seasonFor, tierFor, isDushiSeason, REACH, reachOf } from '../core/money.js';
import { ring } from '../ui/pieces.js';
import { stayCard, stayStrip } from './public.js';
import { toast, sheet, confirmDialog, setBusy, chip, statusLabel } from '../ui/components.js';
import { shareText } from '../core/share.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
/** Points a month at a given level, bonus included. */
const splitPreview = (monthlyUsd, s) => {
  const t = tierFor(s, monthlyUsd);
  return Math.round(monthlyUsd * (1 - s.serviceRate) * s.pointsPerDollar) + Math.round(monthlyUsd * t.bonusRate * s.pointsPerDollar);
};
const AREAS = ['Palm Beach', 'Eagle Beach', 'Druif Beach', 'Oranjestad', 'Malmok', 'Savaneta', 'Noord'];

export function stays({ store, query, go }) {
  const me = store.me, s = store.settings;
  const avail = store.availablePoints(me.id);
  const state = { season: query.season || 'low', area: '', onSand: false, adultsOnly: false, allInclusive: false, affordable: false };
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <div class="sec-head"><div><p class="eyebrow">Twenty-one places on the island</p><h1>Stays in Aruba</h1>
        <p>Every price is the Circle’s all-in rate per night — room, the 12.5% tourist levy, service charge, resort fee and the environmental levy. Your binding quote comes from Victor and is usually better.</p></div></div>
      <div class="row no-print" id="filters" style="margin-bottom:18px" role="group" aria-label="Filter stays"></div>
      <p class="small muted" id="count" style="margin-bottom:14px"></p>
      <div class="grid g3" id="list"></div>
      <p class="small muted" style="margin-top:22px">Minimums apply at Peak — 20 December to 3 January and Carnival week — where most resorts want seven nights. <a href="#/rules">The rules</a> explain how cancellations work.</p>
    </div></section></div>`);
  const list = wrap.querySelector('#list'), filters = wrap.querySelector('#filters'), count = wrap.querySelector('#count');

  const draw = () => {
    filters.innerHTML = `
      <div class="row" role="group" aria-label="Season">${Object.values(SEASONS).map(se => `<button class="btn ${state.season === se.id ? '' : 'quiet'} sm" data-season="${se.id}" aria-pressed="${state.season === se.id}">${escapeHtml(se.label)}</button>`).join('')}</div>
      <select class="btn ghost sm" id="area" aria-label="Area" style="padding-inline:12px"><option value="">Anywhere on the island</option>${AREAS.map(a => `<option${a === state.area ? ' selected' : ''}>${a}</option>`).join('')}</select>
      <button class="btn ${state.onSand ? '' : 'quiet'} sm" data-flag="onSand" aria-pressed="${state.onSand}">On the sand</button>
      <button class="btn ${state.adultsOnly ? '' : 'quiet'} sm" data-flag="adultsOnly" aria-pressed="${state.adultsOnly}">Adults only</button>
      <button class="btn ${state.allInclusive ? '' : 'quiet'} sm" data-flag="allInclusive" aria-pressed="${state.allInclusive}">All-inclusive</button>
      <button class="btn ${state.affordable ? '' : 'quiet'} sm" data-flag="affordable" aria-pressed="${state.affordable}">I can afford it now</button>`;
    let items = store.arubaStays();
    if (state.area) items = items.filter(x => x.area === state.area);
    for (const f of ['onSand', 'adultsOnly', 'allInclusive']) if (state[f]) items = items.filter(x => x[f]);
    if (state.affordable) items = items.filter(x => avail >= seasonPoints(x, state.season, s) * (x.minNights || 1));
    items = items.slice().sort((a, b) => seasonPoints(a, state.season, s) - seasonPoints(b, state.season, s));
    count.textContent = `${items.length} of ${store.arubaStays().length} places · ${SEASONS[state.season].label}, ${SEASONS[state.season].range}` +
      (state.season === 'low' && isDushiSeason(new Date()) ? ' · dushi season, the quietest and cheapest weeks of the year' : '');
    list.replaceChildren(...items.map(st => {
      const per = seasonPoints(st, state.season, s);
      const min = st.minNights || 1;
      const coverable = Math.floor(avail / per);
      const footer = `<span class="small ${coverable >= min ? 'muted' : ''}" style="margin-top:4px">${
        coverable >= min ? `You can cover ${Math.min(coverable, 14)} night${coverable === 1 ? '' : 's'}`
        : `${escapeHtml(fmtUsd2(Math.max(0, min * per - avail) / s.pointsPerDollar))} short of the ${min}-night minimum`}</span>`;
      return stayCard(st, { store, season: state.season, footer });
    }));
    if (!items.length) list.replaceChildren(el(`<div class="empty"><b>Nothing matches those filters</b><p class="small muted">Try a different area, or turn off “I can afford it now” to see everything.</p></div>`));
  };
  draw();
  filters.addEventListener('click', (e) => {
    const seasonBtn = e.target.closest('[data-season]'); const flagBtn = e.target.closest('[data-flag]');
    if (seasonBtn) { state.season = seasonBtn.dataset.season; draw(); }
    else if (flagBtn) { state[flagBtn.dataset.flag] = !state[flagBtn.dataset.flag]; draw(); }
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
      <div class="sec-head"><div><p class="eyebrow">Sourced by Victor, run with Ian</p><h1>Trips</h1>
        <p>A seat covers the hotel and everything listed. Flights are extra unless the note says otherwise. Guests can come at the same rate, in cash.</p></div></div>
      <div class="notice" style="margin-bottom:18px"><b>What your level reaches</b>
        <p class="small">Stays on Aruba are open to everyone. ${escapeHtml(tierName(150))} adds trips around the region — the other islands and the near mainland — and ${escapeHtml(tierName(200))} adds everywhere else Victor takes the group. You are ${escapeHtml(tierName(me.monthlyUsd))}: ${escapeHtml(REACH[tier.reach].blurb.toLowerCase())}. <a href="#/profile">Change your level</a> any month; it takes effect on your next contribution.</p></div>
      <div class="grid g3" id="list"></div>
      ${all.length ? '' : '<div class="empty"><b>No trips on the board</b><p class="small muted">Victor posts them as he sources them. Ian sends a note when one goes live.</p></div>'}
    </div></section></div>`);
  const list = wrap.querySelector('#list');
  list.replaceChildren(...all.map(t => {
    const held = store.seatsHeld(t.id);
    const mine = store.state.redemptions.some(r => r.memberId === me.id && r.stayId === t.id && ['requested', 'quoted', 'held', 'confirmed', 'completed'].includes(r.status));
    const canAfford = avail >= t.pointsPerSeat;
    const firstLook = t.isDrop && tier.firstLookHours > 0;
    const reachable = store.canReachStay(t);
    const needed = store.tierNeededFor(t);
    const footer = `<span class="small muted" style="margin-top:4px">${escapeHtml(fmtDay(t.dates.from))} – ${escapeHtml(fmtDay(t.dates.to))} · ${held} of ${t.seats} seats held${mine ? ' · you are in' : canAfford ? '' : ' · you are short'}</span>
      <span class="flags" style="margin-top:6px">
        ${t.isDrop ? `<span class="tag" style="background:var(--flight-soft);border-color:transparent">Drop${firstLook ? ` · your first look` : ''}</span>` : ''}
        <span class="tag">${escapeHtml(REACH[reachOf(t)].label)}</span>
        ${reachable ? '' : `<span class="tag" style="background:var(--raised)">${escapeHtml(tierName(needed.monthlyUsd))} and up</span>`}
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
      <p class="eyebrow">${escapeHtml(stay.area)}${stay.country !== 'Aruba' ? `, ${escapeHtml(stay.country)}` : ''}${isTrip ? '' : ` · ${stay.onSand ? 'on the sand' : 'across the road'}`}</p>
      <h1>${escapeHtml(stay.name)}</h1>
      <p class="lede" style="margin-top:12px">${escapeHtml(stay.vibe)}</p>
      <div class="stay-card daylight" style="margin-top:20px;border-radius:var(--r-card)"><span class="strip"><span class="ph-note">illustration</span></span></div>
      <div class="row" style="margin-top:14px">${(stay.features || []).map(f => `<span class="tag">${escapeHtml(f)}</span>`).join('')}</div>
      ${stay.dealNote ? `<div class="notice" style="margin-top:16px"><b>From Victor</b><p class="small">${escapeHtml(stay.dealNote)}</p></div>` : ''}
      <div class="side" style="margin-top:22px">
        <div class="panel" id="pricing"></div>
        <div class="panel flat" id="afford"></div>
      </div>
      <div id="reach-note"></div>
      <div class="row" style="margin-top:20px">
        ${store.canReachStay(stay)
          ? `<a class="btn" href="#/book/${escapeHtml(stay.id)}">${isTrip ? 'Ask for a seat' : 'Ask Victor for dates'}</a>`
          : `<a class="btn" href="#/profile">Move up to ${escapeHtml(tierName(store.tierNeededFor(stay).monthlyUsd))}</a>`}
        <button class="btn ghost" id="share">Share</button>
      </div>
    </div></section></div>`);
  wrap.querySelector('.strip').prepend(stayStrip(stay));

  if (isTrip) {
    const held = store.seatsHeld(stay.id);
    const roster = store.rosterFor(stay.id);
    wrap.querySelector('#pricing').innerHTML = `
      <h2>${escapeHtml(fmtPoints(stay.pointsPerSeat))} a seat</h2>
      <p class="small muted" style="margin-top:4px">${escapeHtml(pointsUsd(stay.pointsPerSeat, s.pointsPerDollar))} all-in for ${stay.nights} nights · guests pay ${escapeHtml(fmtUsd2(stay.guestCashUsd))} in cash</p>
      <ul class="ledger" style="margin-top:14px">
        <li><span class="what"><b>Dates</b></span><span class="delta"><b>${escapeHtml(fmtDay(stay.dates.from))} – ${escapeHtml(fmtDay(stay.dates.to))}</b></span></li>
        <li><span class="what"><b>Seats</b><span class="meta">${roster.length ? roster.map(m => escapeHtml(m.name.split(' ')[0])).join(', ') + ' are in' : 'Nobody yet'}</span></span><span class="delta"><b>${held} / ${stay.seats}</b></span></li>
        <li><span class="what"><b>Hold deadline</b><span class="meta">Victor releases the block after this</span></span><span class="delta"><b>${escapeHtml(fmtDay(stay.holdDeadline))}</b></span></li>
        <li><span class="what"><b>Public price</b><span class="meta">What the same trip costs booked alone</span></span><span class="delta"><b>${escapeHtml(fmtUsd2(stay.retailUsd))}</b><small>you save ${escapeHtml(fmtUsd2(Math.max(0, stay.retailUsd - stay.pointsPerSeat / s.pointsPerDollar)))}</small></span></li>
      </ul>`;
  } else {
    wrap.querySelector('#pricing').innerHTML = `
      <h2>What a night costs</h2>
      <div class="tablewrap" style="margin-top:12px;border:0"><table>
        <thead><tr><th>Season</th><th>When</th><th class="num">Points</th><th class="num">Value</th></tr></thead>
        <tbody>${Object.values(SEASONS).map(se => `<tr><td>${escapeHtml(se.label)}</td><td class="small muted">${escapeHtml(se.range)}</td>
          <td class="num">${escapeHtml(fmtPoints(seasonPoints(stay, se.id, s)))}</td><td class="num">${escapeHtml(fmtUsd2(seasonPoints(stay, se.id, s) / s.pointsPerDollar))}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="small muted" style="margin-top:12px">Minimum ${stay.minNights} night${stay.minNights > 1 ? 's' : ''}${stay.peakMinNights > stay.minNights ? `, ${stay.peakMinNights} at Peak` : ''}.
      ${stay.taxesIncluded ? 'Taxes and breakfast are already in this rate.' : 'Room, 12.5% tourist levy, service charge, resort fee and environmental levy are all included.'}
      Booked alone, a Winter night here runs about ${escapeHtml(fmtUsd2(stay.retailUsd))} — you save ${escapeHtml(fmtUsd2(Math.max(0, stay.retailUsd - stay.rates.high)))} a night.</p>`;
  }
  const per = isTrip ? stay.pointsPerSeat : seasonPoints(stay, 'low', s);
  const min = isTrip ? 1 : (stay.minNights || 1);
  const canCover = Math.floor(avail / per);
  wrap.querySelector('#afford').innerHTML = `
    <p class="eyebrow">Against your points</p>
    <div class="row" style="gap:14px;margin-top:12px;align-items:center"><span id="ring"></span>
      <div class="small"><b>${escapeHtml(fmtPoints(avail))}</b> available<br>
      <span class="muted">${canCover >= min ? `enough for ${Math.min(canCover, 14)} ${isTrip ? 'seat' : 'night'}${canCover === 1 ? '' : 's'}` : `${escapeHtml(fmtUsd2(Math.max(0, min * per - avail) / s.pointsPerDollar))} short of the minimum`}</span></div></div>
    <p class="small muted" style="margin-top:14px">Short of it? Pay the difference as a top-up when Victor quotes you — no 15% is taken on a top-up, and nothing is booked on credit.</p>
    <p class="small muted" style="margin-top:8px">${escapeHtml(tierName(me.monthlyUsd))} can hold ${tier.holds} open request${tier.holds > 1 ? 's' : ''} and book ${tier.windowMonths} months ahead.</p>`;
  wrap.querySelector('#ring').replaceChildren(ring({ total: min, filled: Math.min(min, canCover), size: 76, label: String(Math.min(canCover, 99)), sub: isTrip ? 'seats' : 'nights' }));
  if (!store.canReachStay(stay)) {
    const needed = store.tierNeededFor(stay);
    const nextUp = splitPreview(needed.monthlyUsd, s);
    wrap.querySelector('#reach-note').innerHTML = `<div class="notice" style="margin-top:18px">
      <b>This one is for ${escapeHtml(tierName(needed.monthlyUsd))} and up</b>
      <p class="small">Trips off the island are what the bigger levels are for. You are ${escapeHtml(tierName(me.monthlyUsd))} at ${escapeHtml(fmtUsd2(me.monthlyUsd))} a month — ${escapeHtml(REACH[tier.reach].blurb.toLowerCase())}.
      At ${escapeHtml(fmtUsd2(needed.monthlyUsd))} you would earn ${escapeHtml(fmtPoints(nextUp))} a month instead, and this trip opens to you from your next contribution. Nothing you already hold changes.</p>
      <p class="small muted" style="margin-top:6px">If the dates are sooner than that, ask Ian — a ${escapeHtml(tierName(needed.monthlyUsd))} Insider can sponsor you onto a trip.</p></div>`;
  }
  wrap.querySelector('#share').addEventListener('click', () => shareText({
    title: stay.name, text: `${stay.name} — ${fmtPoints(per)} ${isTrip ? 'a seat' : 'a night'} through the ${VOCAB.clubName}.`,
    url: `${location.origin}${location.pathname}#/${isTrip ? 'trips' : 'stays'}/${stay.id}`,
  }));
  return wrap;
}

export function book({ store, params, go }) {
  const me = store.me, s = store.settings;
  const stay = store.stay(params.id);
  if (!stay) return el('<div class="wrap sec"><h1>Nothing to request</h1><p class="lede" style="margin-top:10px"><a href="#/stays">Back to the stays</a>.</p></div>');
  const isTrip = stay.kind === 'trip';
  const avail = store.availablePoints(me.id);
  const tier = tierFor(s, me.monthlyUsd);
  if (!store.canReachStay(stay)) {
    const needed = store.tierNeededFor(stay);
    return el(`<div class="wrap sec" style="max-width:640px"><p class="eyebrow">${escapeHtml(stay.area)}</p>
      <h1>${escapeHtml(stay.name)} is a ${escapeHtml(tierName(needed.monthlyUsd))} trip</h1>
      <p class="lede" style="margin-top:12px">Your level covers ${escapeHtml(REACH[tier.reach].blurb.toLowerCase())}. Move up to ${escapeHtml(fmtUsd2(needed.monthlyUsd))} a month and this opens from your next contribution — or ask Ian, since a ${escapeHtml(tierName(needed.monthlyUsd))} Insider can sponsor you onto a trip.</p>
      <div class="row" style="margin-top:20px"><a class="btn" href="#/profile">Change my level</a><a class="btn ghost" href="#/trips">Back to the trips</a></div></div>`);
  }
  const today = new Date(); const soon = new Date(today); soon.setMonth(soon.getMonth() + 2);
  const d = (x) => x.toISOString().slice(0, 10);
  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:720px">
      <p class="eyebrow">${escapeHtml(stay.area)}</p>
      <h1>${isTrip ? 'Ask for a seat' : 'Ask Victor for dates'}</h1>
      <p class="lede" style="margin-top:10px">${escapeHtml(stay.name)}. He answers within ${s.slaHours} hours with an all-in price in points, locked for ${s.quoteHours} hours. Nothing is committed until you accept it.</p>
      <form class="panel" id="form" style="margin-top:20px">
        ${isTrip ? `<div class="notice"><b>${escapeHtml(fmtDay(stay.dates.from))} – ${escapeHtml(fmtDay(stay.dates.to))}</b>
            <p class="small">${stay.nights} nights · ${escapeHtml(fmtPoints(stay.pointsPerSeat))} a seat · ${store.seatsHeld(stay.id)} of ${stay.seats} seats held</p></div>
          <label class="field" style="margin-top:14px"><span>Seats</span><input name="seats" type="number" min="1" max="4" value="1" inputmode="numeric"></label>`
        : `<div class="grid g2">
            <label class="field"><span>Check in</span><input name="checkIn" type="date" required value="${d(soon)}" min="${d(today)}"></label>
            <label class="field"><span>Check out</span><input name="checkOut" type="date" required value="${d(new Date(soon.getTime() + (stay.minNights || 2) * 864e5))}" min="${d(today)}"></label>
          </div>
          <div class="grid g2">
            <label class="field"><span>Guests</span><input name="guests" type="number" min="1" max="8" value="2" inputmode="numeric"></label>
            <label class="field"><span>Flexible by</span><select name="flexDays"><option value="0">Exact dates</option><option value="1">A day either way</option><option value="3">Three days either way</option><option value="7">A week either way</option></select></label>
          </div>`}
        <label class="field"><span>Anything Victor should know</span><textarea name="note" rows="3" placeholder="Ground floor if possible, arriving late, celebrating something…"></textarea></label>
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
      ? `<b>Indicative: ${escapeHtml(fmtPoints(q.points))} (${escapeHtml(fmtUsd2(q.usd))})</b>
         <p class="small">${q.nights} night${q.nights > 1 ? 's' : ''}${isTrip ? '' : ` · ${Object.entries(q.breakdown).filter(([, n]) => n).map(([k, n]) => `${n} at ${SEASONS[k].label}`).join(', ')}`}.
         ${short ? `You are ${escapeHtml(fmtPoints(short))} short — that would be a top-up of ${escapeHtml(fmtUsd2(short / s.pointsPerDollar))} in cash.` : 'Covered by the points you hold.'}
         ${q.retailUsd ? ` Booked alone this runs about ${escapeHtml(fmtUsd2(q.retailUsd))}.` : ''}</p>`
      : `<b>${stay.name} needs at least ${q.minNights} nights for those dates</b>
         <p class="small">${q.breakdown.peak ? 'Peak weeks — 20 December to 3 January and Carnival — carry a longer minimum at most resorts.' : ''}</p>`;
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
          ${r.note ? `<div class="panel flat"><p class="eyebrow">What they asked for</p><p class="small" style="margin-top:8px">${escapeHtml(r.note)}</p></div>` : ''}
          ${r.decision ? `<div class="notice ${['declined', 'cancelled', 'expired'].includes(r.status) ? 'bad' : ''}">
            <b>${escapeHtml(['declined'].includes(r.status) ? 'Declined by ' : 'Note from ')}${escapeHtml(store.member(r.decidedBy || r.quotedBy)?.name.split(' ')[0] || 'the Desk')}</b>
            <p class="small">${escapeHtml(r.decision)}</p></div>` : ''}
          <div class="panel" id="actions"></div>
        </div>
        <div class="panel flat">
          <p class="eyebrow">What happened when</p>
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
      ${r.topUpUsd ? `<li><span class="what"><b>Top-up in cash</b><span class="meta">Beyond the points held. No 15% is taken on a top-up.</span></span>
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
    ? `<p class="eyebrow">What you can do</p><div class="row" style="margin-top:12px">${buttons.join('')}</div>
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
