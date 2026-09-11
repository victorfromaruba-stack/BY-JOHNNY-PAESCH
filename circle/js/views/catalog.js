// Stays (the deals), cruises and trips, requesting one, and the life of a request.
import { escapeHtml, fmtUsd2, fmtPoints, pointsUsd, fmtDay, fmtDayTime, countdownTo, initials, nightsBetween, safeUrl } from '../core/util.js';
import { VOCAB, tierName } from '../core/vocab.js';
import { quoteStay, nightPoints, fromPoints, seatPoints, unitPoints, versusPublic, tierFor, REACH, reachOf, pointsPerMonth, round2, hotelOwedUsd, isCruise, unitWord } from '../core/money.js';
import { versusLine } from '../ui/pieces.js';
import { effectiveTier } from '../core/standing.js';
import { stayCard, stayStrip, photoFor, photoCredit, seedIdOf } from './public.js';
import { PLACES } from '../data/places.js';
import { normName } from '../core/names.js';
import { toast, sheet, confirmDialog, setBusy, chip, statusLabel } from '../ui/components.js';
import { shareText } from '../core/share.js';
import { icon } from '../ui/icons.js';
import { dealList, byNight, wireDealActions, postDealSheet, pasteListingSheet } from './deals.js';
import { openWeeks, resortForStay } from './live.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const AREAS = ['Palm Beach', 'Eagle Beach', 'Druif Beach', 'Oranjestad', 'Malmok', 'Savaneta', 'Noord'];

/**
 * One line, under every list of what is open: where the owner weeks came from and when.
 * Never "available" — open on VakayMood at the time shown, or the Circle's own copy of it.
 */
function asOfLine(res, where = 'the places we stay') {
  const t = res.generatedAt ? new Date(res.generatedAt) : null;
  const time = t ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const day = t ? t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
  const eye = icon('eye', { size: 14, cls: 'ico-muted' });
  if (res.error) return `${eye} This phone could not reach VakayMood just now${res.blocked ? ' — mobile data, or a content blocker' : ''}, so owner weeks are missing here. What the Desk has posted is what you see. <button type="button" class="btn quiet sm" data-act="retry-open" style="margin-left:6px">${icon('refresh', { size: 14 })}Try again</button>`;
  const n = res.total.toLocaleString('en-US');
  const weeks = `${n} owner week${res.total === 1 ? '' : 's'} open at ${escapeHtml(where)}`;
  return res.fromCopy
    ? `${eye} ${weeks} in the Circle’s copy of VakayMood, taken ${escapeHtml(day)} ${escapeHtml(time)} — this phone could not reach it live.`
    : `${eye} ${weeks} on VakayMood as of ${escapeHtml(time)}${res.failed ? ` (${res.failed} place${res.failed === 1 ? '' : 's'} did not answer)` : ''}.`;
}

/**
 * The Stays tab IS the deals: every live one, cheapest a night first — what Victor and Ian have
 * put on the board, and what owners have open right now at the places we stay — as one list
 * with one button. Victor: "I only need the best deals on the market." The places themselves
 * are a strip underneath, for a member who wants a place rather than a week.
 */
export function stays({ store, go }) {
  const me = store.me, s = store.settings;
  const canEdit = store.canPostDeals();
  const mine = store.matchesForMember(me.id);
  const mineIds = new Set(mine.map(m => m.deal.id));
  const posted = store.liveDeals().filter(d => !mineIds.has(d.id));
  const watching = store.watchesFor(me.id).length;
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <div class="row-between" style="align-items:flex-start;gap:14px">
        <div><h1>Stays</h1>
          <p class="lede" style="margin-top:10px;max-width:58ch">The best deals on the market right now, cheapest a night first — what Victor and Ian have found, and what owners have open at the places we stay. Tap one and Victor books it in your name; you never book anything yourself. <a href="#/rules">How it works</a>.</p></div>
        ${canEdit ? `<div class="row no-print"><button class="btn sm" id="paste">${icon('copy', { size: 16 })}Paste a listing</button>
          <button class="btn ghost sm" id="post">${icon('plus', { size: 16 })}By hand</button></div>` : ''}
      </div>
      <div class="row" style="margin-top:16px">
        <a class="btn ghost sm" href="#/watching">${icon('bell', { size: 16 })}Tell the Desk what you want${watching ? ` · ${watching}` : ''}</a>
      </div>
      <div id="mine" style="margin-top:22px"></div>
      <div id="deals" style="margin-top:22px"></div>
      <div id="places" style="margin-top:34px"></div>
    </div></section></div>`);

  if (mine.length) {
    const mineSlot = wrap.querySelector('#mine');
    mineSlot.appendChild(el(`<div class="sec-head tight"><div><p class="eyebrow" style="color:var(--good-text)">${icon('bellRing')}What you asked for</p>
      <h2 style="font-size:1.2rem">${mine.length} of these ${mine.length === 1 ? 'is' : 'are'} what you are watching for</h2></div></div>`));
    dealList(mineSlot, mine.map(m => m.deal), { store, me, canEdit, first: 4, key: 'mine', inPlace: false, noun: 'you asked for' });
    // Only when something is actually unseen: markWatchesSeen() commits, a commit re-renders,
    // and this would run again forever.
    if (store.unseenMatches(me.id).length) store.markWatchesSeen(me.id);
  }

  // The list. What the Desk posted paints at once; what owners have open is asked for and
  // merged in when it answers, so the page never waits on a third party to show the board.
  const dealsSlot = wrap.querySelector('#deals');
  let drafts = [];
  let loading = true;
  // Cheapest a night first — but the eight that open with the page are spread across places, at
  // most two from any one of them. Sixty Surf Club studios at $166 are all genuinely the cheapest
  // and the first screen would be eight of the same card; the rest keep strict price order
  // behind "Show the other N".
  const FIRST = 8;
  const spread = (list) => {
    const lead = [], rest = [], seen = new Map();
    for (const d of list) {
      const n = seen.get(d.stayId) || 0;
      if (lead.length < FIRST && n < 2) { lead.push(d); seen.set(d.stayId, n + 1); } else rest.push(d);
    }
    return [...lead, ...rest];
  };
  const paint = (sub) => {
    dealsSlot.replaceChildren();
    const all = spread([...posted, ...drafts].sort(byNight));
    dealsSlot.appendChild(el(`<div class="sec-head tight"><div><p class="eyebrow">${icon('trend')}Open right now</p>
      <h2 style="font-size:1.2rem">${all.length ? `${all.length} open, cheapest a night first` : loading ? 'Looking at what is open…' : 'Nothing open right now'}</h2>
      <p class="small muted" id="asof" style="margin-top:6px;max-width:62ch">${sub}</p></div></div>`));
    if (all.length) dealList(dealsSlot, all, { store, me, canEdit, first: FIRST, key: 'stays', inPlace: false, noun: 'open' });
    else if (!loading) dealsSlot.appendChild(el(`<p class="small muted" style="margin-top:8px">Open a place below and put your dates in — Victor prices any nights. <a href="#/watching">A watch</a> tells you the moment something opens.</p>`));
  };
  const load = () => {
    loading = true;
    paint(`${icon('refresh', { size: 14, cls: 'ico-muted' })} Looking at what owners have open at the places we stay…`);
    openWeeks(store).then(res => { drafts = res.deals.filter(d => !mineIds.has(d.id)); loading = false; paint(asOfLine(res)); });
  };
  load();
  wireDealActions(wrap, store, { drafts: () => drafts });
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-act="retry-open"]')) load(); });
  wrap.querySelector('#post')?.addEventListener('click', () => postDealSheet({ store }));
  wrap.querySelector('#paste')?.addEventListener('click', () => pasteListingSheet({ store }));

  // The places, as a strip: where we actually stay first, then by price. One for a member who
  // wants a place on their own dates rather than a week somebody else has open.
  const placesSlot = wrap.querySelector('#places');
  const places = store.arubaStays().slice().sort((a, b) => (b.house ? 1 : 0) - (a.house ? 1 : 0) || fromPoints(a, s) - fromPoints(b, s));
  placesSlot.appendChild(el(`<div class="sec-head tight"><div><p class="eyebrow">${icon('bed')}The places</p>
    <h2 style="font-size:1.2rem">${places.length} places Victor can get</h2>
    <p class="small muted" style="margin-top:6px;max-width:62ch">Open one for what it costs a night on any dates, all in. The ones marked <em>Where we stay</em> are where we actually end up; the rest are here because Victor can get them.</p></div></div>`));
  const hz = el('<div class="horizon-wrap"><div class="horizon"></div></div>');
  places.forEach(st => hz.firstElementChild.appendChild(stayCard(st, { store })));
  placesSlot.appendChild(hz);
  return wrap;
}

/**
 * Cruises, and the trips under them. Both are the same shape — fixed dates, a fixed price for
 * a cabin or a seat, so many of them — and both are asked for and booked the way a stay is.
 * Interval International trades a deposited week for a cabin; Victor posts the ones worth it.
 */
export function cruises({ store }) {
  const me = store.me, s = store.settings;
  const avail = store.availablePoints(me.id);
  const tier = tierFor(s, me.monthlyUsd);
  const look = effectiveTier(tier, store.standingOf(me.id));
  const sailings = store.cruises(), trips = store.landTrips();
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <div class="sec-head tight"><div><h1>Cruises</h1>
        <p class="lede" style="margin-top:10px;max-width:58ch">Interval International trades a deposited week for a cabin, and now and then sells a cabin cheap. Victor posts the sailings worth it; you ask for a cabin and he books it in your name.</p></div></div>
      <div class="grid g3" id="list"></div>
      ${sailings.length ? '' : `<div class="empty">${icon('compass', { size: 28, cls: 'ico-muted' })}<b style="display:block;margin-top:10px">No cruise on the board yet</b><p class="small muted">Victor posts one when Interval has a sailing worth it. <a href="#/watching">A watch</a> tells you first.</p></div>`}
      <div id="trips" style="margin-top:34px"></div>
    </div></section></div>`);
  const card = (t) => {
    const held = store.seatsHeld(t.id);
    const unit = unitWord(t);
    const mine = store.state.redemptions.some(r => r.memberId === me.id && r.stayId === t.id && ['requested', 'quoted', 'held', 'confirmed', 'completed'].includes(r.status));
    const seat = seatPoints(t, s);
    const canAfford = avail >= seat;
    const months = canAfford ? 0 : Math.ceil((seat - Math.max(0, avail)) / pointsPerMonth(s, me.monthlyUsd));
    const footer = `<span class="small muted" style="margin-top:4px">${escapeHtml(fmtDay(t.dates.from))} – ${escapeHtml(fmtDay(t.dates.to))} · ${held} of ${t.seats} ${unit}s held${mine ? ' · you are in' : ''}</span>
      <span class="small muted" style="margin-top:2px">${mine ? `Your ${unit} is held` : canAfford ? `You can cover a ${unit} now` : `About ${months} more month${months === 1 ? '' : 's'} of contributions`}</span>
      <span class="flags" style="margin-top:6px">
        ${t.cruise?.ship ? `<span class="tag">${escapeHtml(t.cruise.ship)}</span>` : ''}
        ${t.isDrop ? `<span class="tag" style="background:var(--flight-soft);border-color:transparent">Drop${t.isDrop && look.firstLookHours > 0 ? ' · your first look' : ''}</span>` : ''}
        <span class="tag">${escapeHtml(REACH[reachOf(t)].label)}</span>
      </span>`;
    return stayCard(t, { store, footer, href: `#/${isCruise(t) ? 'cruises' : 'trips'}/${t.id}` });
  };
  wrap.querySelector('#list').replaceChildren(...sailings.map(card));
  if (trips.length) {
    const slot = wrap.querySelector('#trips');
    slot.appendChild(el(`<div class="sec-head tight"><div><p class="eyebrow">${icon('plane')}Trips with the Circle</p>
      <h2 style="font-size:1.2rem">${trips.length} trip${trips.length === 1 ? '' : 's'}, a seat each</h2>
      <p class="small muted" style="margin-top:6px;max-width:62ch">Everyone can come on everything. A seat covers the hotels and every transfer on the ground; flights to and from Aruba are extra unless the note says otherwise. At ${escapeHtml(fmtUsd2(me.monthlyUsd))} a month you earn ${escapeHtml(fmtPoints(pointsPerMonth(s, me.monthlyUsd)))}, so a seat further afield takes longer to save for — ${look.holds} open request${look.holds > 1 ? 's' : ''} at a time, ${look.windowMonths} months ahead.</p></div></div>`));
    const grid = el('<div class="grid g3"></div>');
    grid.replaceChildren(...trips.map(card));
    slot.appendChild(grid);
  } else wrap.querySelector('#trips').remove();
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
      <div class="stay-card daylight" id="stay-hero" style="margin-top:20px;border-radius:var(--r-card)"><span class="strip"></span></div>
      <div class="row" style="margin-top:14px">${(stay.features || []).map(f => `<span class="tag">${escapeHtml(f)}</span>`).join('')}</div>
      <div id="open"></div>
      <div class="panel" id="pricing" style="margin-top:22px"></div>
      <div id="place"></div>
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
        // The property's own booking page. Every one of the twenty-three now has one, each
        // checked to be that property's page on its own or its chain's site — never an OTA and
        // never a chain homepage. Victor: "I need a link to even be able to book it."
        const site = safeUrl(stay.site);
        const rows = [];
        if (src.interval?.seenUsd) rows.push(['Interval', src.interval.seenUsd, src.interval.seenOn, src.interval.note, src.best === 'interval']);
        if (src.redweek?.fromUsd) rows.push(['RedWeek', src.redweek.fromUsd, src.redweek.seenOn, src.redweek.note, src.best === 'redweek']);
        const seenOn = src.interval?.seenOn || src.redweek?.seenOn || null;
        const daysOld = seenOn ? Math.floor((Date.now() - Date.parse(seenOn)) / 864e5) : null;
        const stale = daysOld != null && daysOld > 60;
        return `<details class="fineprint" style="margin-top:16px"><summary>Where this price comes from</summary><div class="panel" style="margin-top:10px">
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
                <tr><td>${site
                    ? `<a href="${escapeHtml(site)}" target="_blank" rel="noopener noreferrer"><b>The resort</b> ${icon('external', { size: 13 })}</a>`
                    : '<b>The resort</b>'}<br><span class="small muted">Booking direct, for comparison</span></td>
                  <td class="num">${escapeHtml(fmtUsd2(stay.retailUsd || 0))}</td><td class="small muted">—</td></tr>
              </tbody></table></div>
            <p class="tiny ${stale ? '' : 'muted'}" style="margin-top:10px">${stale
              ? `Last checked ${daysOld} days ago — old enough to have moved. Victor re-checks before he quotes you.`
              : 'A night. These move; the number you are quoted is the one Victor actually finds on the day.'}</p>`
          : `<p class="small muted" style="margin-top:6px">Nobody has checked this one against the booking sites yet, so the rate above is the Circle&rsquo;s own negotiated number and nothing else. Victor checks Interval and RedWeek before he books, and what he finds goes here.</p>
             ${site ? `<p class="small" style="margin-top:10px">Their own page is
               <a href="${escapeHtml(site)}" target="_blank" rel="noopener noreferrer">${escapeHtml(new URL(site).host.replace(/^www\./, ''))} ${icon('external', { size: 13 })}</a>
               &mdash; what it is asking today is the number to beat.</p>` : ''}`}
        </div></details>`;
      })()}
      ${stay.dealNote ? `<div class="notice" style="margin-top:16px"><b>From Victor</b><p class="small">${escapeHtml(stay.dealNote)}</p></div>` : ''}
      <div class="row" style="margin-top:20px">
        <a class="btn" href="#/book/${escapeHtml(stay.id)}">${icon('send', { size: 17 })}${isTrip ? `Ask for a ${unitWord(stay)}` : 'Ask Victor for dates'}</a>
        <button class="btn ghost" id="share">${icon('share', { size: 16 })}Share</button>
      </div>
    </div></section></div>`);

  // What you can actually be given here, and what each one costs a night.
  {
    // This block is the only thing that fills #stay-hero. A line above it used to prepend a
    // second stayStrip into the same .strip — invisible for years because photoFor() was null on
    // the live backend and the hero was removed, and a double-height drawing on every trip page.
    // On a card the blank plate earns its place: it holds the grid's rhythm and carries the
    // beach. Here it earns nothing — a full-width empty box under a heading that has just said
    // the same beach in the breadcrumb. Where there is no photograph the hero simply goes, and
    // the page starts on the thing a member actually came for, the price and where it came from.
    const hero = wrap.querySelector('#stay-hero');
    if (hero && (photoFor(stay) || isTrip)) {
      hero.querySelector('.strip').appendChild(stayStrip(stay));
      // Where the picture came from: the Desk's own words, the property's site, or the author
      // and licence of an openly licensed photograph. A caption cannot live inside the strip (it
      // is a span), so it sits under the hero.
      const credit = photoCredit(stay);
      if (credit) hero.insertAdjacentHTML('afterend', `<p class="tiny muted" style="margin-top:6px">${credit.html}</p>`);
    } else if (hero) hero.remove();
  }
  // What the place publishes about itself: address, phone, check-in, what is on site, and the
  // pictures it publishes of the property and its rooms. Every fact comes from the property's own
  // site or, for the timeshare resorts whose sites refuse a scripted fetch, from VakayMood's resort
  // page — and the panel says which. Nothing typed in, nothing inferred.
  const place = isTrip ? null : PLACES[seedIdOf(stay)] || null;
  const roomPhotos = new Map();   // normName(catalog room) → [photo]
  for (const ph of place?.photos || []) if (ph.room) (roomPhotos.get(normName(ph.room)) || roomPhotos.set(normName(ph.room), []).get(normName(ph.room))).push(ph);
  const photoSheet = (title, photos, facts = '') => sheet({ title, wide: true, render: (body) => {
    body.innerHTML = `${facts}<div class="stack" style="margin-top:${facts ? 14 : 0}px">${photos.map(ph => `
      <figure class="place-photo"><img src="assets/${escapeHtml(ph.file)}" alt="${escapeHtml(ph.alt || title)}" loading="lazy" decoding="async">
        <figcaption class="tiny muted">${escapeHtml(ph.alt || (ph.room ? ph.room : 'The property'))} · from ${escapeHtml(new URL(ph.page || ph.source).host.replace(/^www\./, ''))}, seen ${escapeHtml(fmtDay(ph.seenOn))}</figcaption></figure>`).join('')}</div>
      <p class="tiny muted" style="margin-top:12px">These are the property's own photographs, shown so you know the room you are asking for. They are the property's copyright.</p>`;
  } });
  if (place) {
    const groups = [['onsite', 'On site'], ['services', 'Services'], ['nearby', 'Nearby']].filter(([k]) => (place.amenities?.[k] || []).length);
    const allAmen = groups.flatMap(([k, label]) => (place.amenities[k]).map(a => ({ a, label })));
    const propertyPhotos = (place.photos || []).filter(ph => !ph.room);
    const facts = [];
    if (place.address) facts.push(`${icon('mapPin', { size: 14, cls: 'ico-muted' })} ${place.geo
      ? `<a href="https://maps.apple.com/?q=${encodeURIComponent(stay.name)}&ll=${place.geo.lat},${place.geo.lng}" target="_blank" rel="noopener noreferrer">${escapeHtml(place.address)}</a>`
      : escapeHtml(place.address)}`);
    if (place.phone) facts.push(`${icon('phone', { size: 14, cls: 'ico-muted' })} <a href="tel:${escapeHtml(place.phone.replace(/[^+\d]/g, ''))}">${escapeHtml(place.phone)}</a>`);
    if (place.checkIn || place.checkOut) facts.push(`${icon('clock', { size: 14, cls: 'ico-muted' })} ${place.checkIn ? `check-in ${escapeHtml(place.checkIn)}` : ''}${place.checkIn && place.checkOut ? ' · ' : ''}${place.checkOut ? `check-out ${escapeHtml(place.checkOut)}` : ''}`);
    if (place.policies?.children != null || place.policies?.dogs != null) facts.push(`${icon('users', { size: 14, cls: 'ico-muted' })} ${[place.policies.children === true ? 'children welcome' : place.policies.children === false ? 'adults only' : '', place.policies.dogs === false ? 'no dogs' : place.policies.dogs === true ? 'dogs allowed' : ''].filter(Boolean).join(' · ')}`);
    const SHOW = 10;
    const srcLine = (place.sources || []).map(x => `<a href="${escapeHtml(x.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(x.label)}</a>, seen ${escapeHtml(fmtDay(x.seenOn))}`).join('; ');
    wrap.querySelector('#place').innerHTML = `<details class="fineprint" style="margin-top:16px"><summary>About the place</summary><section class="panel" style="margin-top:10px" id="the-place">
      <div><p class="eyebrow">${icon('home')}The place</p>
        <h2 style="font-size:1.15rem;margin-top:6px">What ${escapeHtml(stay.name)} publishes about itself</h2></div>
      ${facts.length ? `<ul class="facts" style="margin-top:10px">${facts.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
      ${propertyPhotos.length ? `<div class="gallery" style="margin-top:14px" role="list">${propertyPhotos.map((ph, i) => `
        <button type="button" class="gallery-tile" role="listitem" data-gallery="${i}" aria-label="${escapeHtml(ph.alt || 'A photograph of the property')}"><img src="assets/${escapeHtml(ph.thumb || ph.file)}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>` : ''}
      ${allAmen.length ? `<div class="flags" id="amen" style="margin-top:14px">${allAmen.slice(0, SHOW).map(({ a, label }) => `<span class="tag" title="${escapeHtml(label)}">${escapeHtml(a)}</span>`).join('')}
        ${allAmen.length > SHOW ? `<button type="button" class="btn quiet sm" id="amen-more">All ${allAmen.length} on the list</button>` : ''}</div>` : ''}
      ${!facts.length && !allAmen.length && !propertyPhotos.length ? `<p class="small muted" style="margin-top:8px">Nothing this place publishes in a form we can read yet.</p>` : ''}
      ${(place.rooms || []).length ? `
        <div style="margin-top:16px"><p class="eyebrow">${icon('bed', { size: 14 })}Rooms, as the property lists them</p>
        <ul class="ledger" id="site-rooms" style="margin-top:8px">${place.rooms.map((r, i) => {
          const pics = roomPhotos.get(normName(r.catalogName || r.name)) || [];
          const bits = [r.sqft ? `${r.sqft.toLocaleString('en-US')} sq ft` : r.sqm ? `${r.sqm} m²` : '', r.sleeps ? `sleeps ${r.sleeps}` : '', r.beds || '', r.view || ''].filter(Boolean);
          return `<li><span class="what">${pics.length ? `<button type="button" class="room-thumb" data-site-room="${i}" aria-label="Photographs of ${escapeHtml(r.name)}"><img src="assets/${escapeHtml(pics[0].thumb || pics[0].file)}" alt="" loading="lazy" decoding="async"></button>` : ''}<b>${escapeHtml(r.name)}</b>
            ${bits.length ? `<span class="meta">${escapeHtml(bits.join(' · '))}</span>` : ''}${r.description ? `<span class="meta">${escapeHtml(r.description)}</span>` : ''}</span></li>`; }).join('')}</ul>
        <p class="tiny muted" style="margin-top:6px">Sizes and sleeps are the property's own published figures; a blank means it publishes none. Say which one you want in your ask, and Victor prices the nights.</p></div>` : ''}
      <p class="tiny muted" style="margin-top:12px">Facts and pictures from ${srcLine}. What is not stated there is not stated here.</p>
    </section></details>`;
    wrap.querySelector('#place').addEventListener('click', (e) => {
      const sr = e.target.closest('[data-site-room]');
      if (sr) {
        const r = place.rooms[Number(sr.dataset.siteRoom)];
        const pics = roomPhotos.get(normName(r.catalogName || r.name)) || [];
        photoSheet(r.name, pics, r.description ? `<p class="small muted">“${escapeHtml(r.description)}”</p>` : '');
        return;
      }
      const t = e.target.closest('[data-gallery]');
      if (t) { const i = Number(t.dataset.gallery); photoSheet(stay.name, [propertyPhotos[i], ...propertyPhotos.filter((_, j) => j !== i)]); return; }
      if (e.target.closest('#amen-more')) {
        wrap.querySelector('#amen').innerHTML = allAmen.map(({ a, label }) => `<span class="tag" title="${escapeHtml(label)}">${escapeHtml(a)}</span>`).join('');
      }
    });
  } else {
    wrap.querySelector('#place')?.remove();
  }

  // What is open here right now: what the Desk has posted for this place, and what owners have
  // open on VakayMood where it carries this resort — one list, cheapest a night first, the same
  // card as the Stays tab. First, because it is what a member came for.
  {
    const resort = isTrip ? null : resortForStay(store, stay);
    const posted = store.liveDeals().filter(d => d.stayId === stay.id);
    if (resort || posted.length) {
      const panel = el(`<section class="panel" style="margin-top:22px" id="open-now">
        <div><p class="eyebrow">${icon('trend')}Open right now</p>
          <h2 style="font-size:1.15rem;margin-top:6px" id="open-h"></h2>
          <p class="small muted" id="open-sub" style="margin-top:6px;max-width:62ch"></p></div>
        <div id="open-list" style="margin-top:12px"></div>
      </section>`);
      wrap.querySelector('#open').appendChild(panel);
      let drafts = [];
      let loading = !!resort;
      const paint = (sub) => {
        const slot = panel.querySelector('#open-list'); slot.replaceChildren();
        const all = [...posted, ...drafts].sort(byNight);
        panel.querySelector('#open-h').textContent = all.length ? `${all.length} open at ${stay.name}` : loading ? `Looking at what is open at ${stay.name}…` : `Nothing open at ${stay.name} right now`;
        panel.querySelector('#open-sub').innerHTML = `${sub} Cheapest a night first; ask for one and Victor books it in your name.`;
        if (all.length) dealList(slot, all, { store, me, canEdit: store.canPostDeals(), first: 4, key: `stay:${stay.id}`, inPlace: true, noun: 'open' });
        else if (!loading) slot.innerHTML = `<p class="small muted">Put your dates in below and Victor prices them. <a href="#/watching">A watch</a> tells you the moment a week opens here.</p>`;
      };
      const load = () => {
        if (!resort) { paint(''); return; }
        loading = true; paint(`${icon('refresh', { size: 14, cls: 'ico-muted' })} Looking at what owners have open…`);
        openWeeks(store, { slug: resort.slug }).then(res => { drafts = res.deals; loading = false; paint(asOfLine(res, stay.name)); });
      };
      load();
      wireDealActions(panel, store, { drafts: () => drafts });
      panel.addEventListener('click', (e) => { if (e.target.closest('[data-act="retry-open"]')) load(); });
    }
  }

  if (isTrip) {
    const held = store.seatsHeld(stay.id);
    const roster = store.rosterFor(stay.id);
    const unit = unitWord(stay), cr = stay.cruise || null;
    wrap.querySelector('#pricing').innerHTML = `
      <h2>${escapeHtml(fmtPoints(seatPoints(stay, s)))} a ${unit}</h2>
      <p class="small muted" style="margin-top:4px">${escapeHtml(pointsUsd(seatPoints(stay, s), s.pointsPerDollar))} all-in for ${stay.nights} nights · the Circle’s 15% is inside it${stay.guestCashUsd ? ` · guests pay ${escapeHtml(fmtUsd2(stay.guestCashUsd))} in cash` : ''}</p>
      <ul class="ledger" style="margin-top:14px">
        ${cr ? `<li><span class="what"><b>${escapeHtml(cr.ship || 'The ship')}</b>${cr.line ? `<span class="meta">${escapeHtml(cr.line)}</span>` : ''}</span><span class="delta"><b>${escapeHtml(cr.cabin || '')}</b></span></li>
        ${cr.embark || (cr.ports || []).length ? `<li><span class="what"><b>${cr.embark ? `Sails from ${escapeHtml(cr.embark)}` : 'Ports'}</b>${(cr.ports || []).length ? `<span class="meta">${escapeHtml(cr.ports.join(' · '))}</span>` : ''}</span></li>` : ''}` : ''}
        <li><span class="what"><b>Dates</b></span><span class="delta"><b>${escapeHtml(fmtDay(stay.dates.from))} – ${escapeHtml(fmtDay(stay.dates.to))}</b></span></li>
        <li><span class="what"><b>${unit === 'cabin' ? 'Cabins' : 'Seats'}</b><span class="meta">${roster.length ? roster.map(m => escapeHtml(m.name.split(' ')[0])).join(', ') + ' are in' : 'Nobody yet'}</span></span><span class="delta"><b>${held} / ${stay.seats}</b></span></li>
        <li><span class="what"><b>Hold deadline</b><span class="meta">Victor releases the block after this</span></span><span class="delta"><b>${escapeHtml(fmtDay(stay.holdDeadline))}</b></span></li>
        ${(() => {
          const v = versusPublic(stay.retailUsd, seatPoints(stay, s) / s.pointsPerDollar);
          if (!v) return '';
          return `<li><span class="what"><b>Booked alone</b><span class="meta">What the same trip costs on your own</span></span>
            <span class="delta"><b>${escapeHtml(fmtUsd2(v.publicUsd))}</b></span></li>`;
        })()}
      </ul>
      ${versusLine(versusPublic(stay.retailUsd, seatPoints(stay, s) / s.pointsPerDollar), `a ${unit}`)}`;
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
      <div class="ask-dates" style="margin-top:14px">
        <label class="ask-tile"><span class="k">Check in</span><b data-dm="q-in"></b><em><span data-wd="q-in"></span> · <span data-yr="q-in"></span></em>
          <input type="date" id="q-in" value="${escapeHtml(dIn)}" min="${escapeHtml(dToday)}" aria-label="Check in"></label>
        <div class="ask-nights" aria-live="polite"><b id="q-nights">–</b><span>nights</span></div>
        <label class="ask-tile"><span class="k">Check out</span><b data-dm="q-out"></b><em><span data-wd="q-out"></span> · <span data-yr="q-out"></span></em>
          <input type="date" id="q-out" value="${escapeHtml(dOut)}" min="${escapeHtml(dToday)}" aria-label="Check out"></label>
      </div>
      <div id="q-out-slot" style="margin-top:12px"></div>`;
    const showTile = (id) => {
      const v = wrap.querySelector(`#${id}`).value; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      const d = new Date(v + 'T12:00:00');
      wrap.querySelector(`[data-dm="${id}"]`).textContent = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      wrap.querySelector(`[data-wd="${id}"]`).textContent = d.toLocaleDateString('en-GB', { weekday: 'short' });
      wrap.querySelector(`[data-yr="${id}"]`).textContent = String(d.getFullYear());
    };

    // A date-driven quote instead of a table of three seasons. Same numbers, none of the
    // vocabulary: the member says when, and the app says what — which is the only question
    // they ever had. quoteStay walks the nights exactly as the database does, so this figure
    // and the Desk's binding quote come from one piece of arithmetic.
    const qSlot = wrap.querySelector('#q-out-slot');
    const drawQuote = () => {
      const ci = wrap.querySelector('#q-in').value, co = wrap.querySelector('#q-out').value;
      showTile('q-in'); showTile('q-out');
      const q = quoteStay(stay, ci, co, s);
      wrap.querySelector('#q-nights').textContent = q.nights > 0 ? q.nights : '–';
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
        <p class="small muted" style="margin-top:10px">${stay.taxesIncluded ? 'Taxes and breakfast are already in this.' : 'Room, taxes, service charge and resort fee are all in this.'} Victor's binding quote is usually better.</p>`;
    };
    drawQuote();
    wrap.querySelector('#pricing').addEventListener('change', (e) => { if (e.target.id === 'q-in' || e.target.id === 'q-out') drawQuote(); });
  }
  // Against your points, in one line under the price — not a panel, a ring and a notice all
  // saying the same thing three ways.
  const per = unitPoints(stay, s);
  {
    const min = isTrip ? 1 : (stay.minNights || 1);
    const canCover = Math.floor(avail / per);
    const unit = unitWord(stay);
    const price = per * min;
    const pace = store.monthsToAfford(price);
    const mineRow = pace?.find(x => x.mine);
    const gapUsd = fmtUsd2(Math.max(0, price - avail) / s.pointsPerDollar);
    wrap.querySelector('#pricing').insertAdjacentHTML('beforeend', `<p class="small muted" style="margin-top:12px">${icon('spark', { size: 14, cls: 'ico-muted' })}
      You hold <b class="num">${escapeHtml(fmtPoints(avail))}</b> — ${canCover >= min
        ? `enough for ${Math.min(canCover, 14)} ${unit}${canCover === 1 ? '' : 's'} here.`
        : `${escapeHtml(gapUsd)} short of ${isTrip ? `a ${unit}` : `the ${min}-night minimum`}${mineRow && mineRow.months > 0 ? `, about ${mineRow.months} more month${mineRow.months === 1 ? '' : 's'} at your level` : ''}. Ask anyway: Victor quotes it, and ${escapeHtml(gapUsd)} as a cash top-up closes the gap.`}
      ${escapeHtml(tierName(me.monthlyUsd))} can hold ${tier.holds} open request${tier.holds > 1 ? 's' : ''} and book ${tier.windowMonths} months ahead.</p>`);
  }
  wrap.querySelector('#share').addEventListener('click', () => shareText({
    title: stay.name, text: `${stay.name} — ${fmtPoints(per)} a ${unitWord(stay)} through the ${VOCAB.clubName}.`,
    url: `${location.origin}${location.pathname}#/${isCruise(stay) ? 'cruises' : isTrip ? 'trips' : 'stays'}/${stay.id}`,
  }));
  return wrap;
}

export function book({ store, params, query = {}, go }) {
  const me = store.me, s = store.settings;
  const stay = store.stay(params.id);
  if (!stay) return el('<div class="wrap sec"><h1>Nothing to request</h1><p class="lede" style="margin-top:10px"><a href="#/stays">Back to the stays</a>.</p></div>');
  const isTrip = stay.kind === 'trip';
  const unit = unitWord(stay);
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
  // Dates that came in but have already passed: the page opens two months out, and says so,
  // rather than quietly pretending the member chose those.
  const datesPassed = !wantFrom && isDate(query.from);
  const startIn = wantFrom || d(soon);
  const startOut = wantTo || d(new Date(Date.parse(startIn) + (stay.minNights || 2) * 864e5));
  // "Ask again" on a declined or lapsed request carries what the member said the first time —
  // guests, flexibility, the word, the switch — so the re-ask opens as they left it, not blank.
  const wantNote = typeof query.note === 'string' ? query.note.slice(0, 600).trim() : '';
  const wantGuests = Math.min(8, Math.max(1, Math.round(Number(query.guests)) || 2));
  const wantFlex = [0, 1, 3, 7].includes(Number(query.flex)) ? Number(query.flex) : 0;
  const wantShared = query.shared === '1';
  // Where they were looking. A deal off the board knows its own listing; a week seen on
  // Interval or RedWeek came in through the same link. Victor gets this on the request so he
  // does not have to go and find it again.
  const fromDeal = query.deal ? store.deal?.(query.deal) : null;
  // ?src= is the listing the member had open when they tapped through — the "Open right now"
  // board sends it, and that is the freshest link the app ever holds, because VakayMood is the
  // one source the Circle is allowed to poll. It used to carry the dates and drop the link, so
  // the request reached Victor with nothing to click and he had to go and find the page again.
  const fromLink = safeUrl(query.src) ? { url: safeUrl(query.src), label: String(query.srcLabel || 'Where they were looking').slice(0, 60) } : null;
  const cameFrom = fromDeal?.sourceUrl
    ? { url: fromDeal.sourceUrl, label: fromDeal.source === 'other' ? 'The board' : (fromDeal.source || 'The board') }
    : fromLink;
  // The request has no room column, and inventing one across two backends to carry a
  // preference is the wrong trade — the note is the field for exactly this, and it reaches
  // Victor with everything else. It is prefilled, not locked: it is still the member's message.
  // The room, if one matters, is a line in the word for Victor — the field he reads. There is
  // no room catalog to pick from any more; the member says it in their own words.
  const openingNote = wantNote || (query.deal ? 'Asking against a deal from the board.' : '');
  const sla = tier.slaHours ?? s.slaHours;
  const minHold = s.minQuoteHours ?? 12;
  const wd = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
  const dm = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const yr = (iso) => new Date(iso + 'T12:00:00').getFullYear();
  // The ask is not a form to fill in, it is a brief to Victor: the place, the nights, who is
  // coming, a word — and, before anything is sent, what it costs and what happens next. Every
  // control here answers when touched, and every number is the mono face.
  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:720px">
      <p class="eyebrow">${escapeHtml(stay.area)}${stay.country && stay.country !== 'Aruba' ? `, ${escapeHtml(stay.country)}` : ''}</p>
      <h1>${isTrip ? `Ask for a ${unit}` : 'Have Victor book it'}</h1>
      <p class="lede" style="margin-top:10px">${escapeHtml(stay.name)}. You never book it yourself: Victor checks the room, prices it in points, and books it in your name once you say yes.</p>
      <form class="panel ask" id="form">
        ${photoFor(stay) ? '<div class="ask-shot" aria-hidden="true"></div>' : ''}
        ${isTrip ? `
        <div class="ask-block">
          <div class="ask-tile static"><span class="k">The trip</span><b>${escapeHtml(fmtDay(stay.dates.from))} – ${escapeHtml(fmtDay(stay.dates.to))}</b>
            <em>${stay.nights} nights · ${escapeHtml(fmtPoints(seatPoints(stay, s)))} a ${unit} · ${store.seatsHeld(stay.id)} of ${stay.seats} ${unit}s held</em></div>
          <div class="ask-row"><span class="k">${unit === 'cabin' ? 'Cabins' : 'Seats'}</span>
            <div class="stepper" data-for="seats" data-min="1" data-max="4"><button type="button" data-step="-1" aria-label="One ${unit} fewer" disabled>−</button><output aria-live="polite">1</output><button type="button" data-step="1" aria-label="One ${unit} more">+</button></div>
            <input type="hidden" name="seats" value="1"></div>
        </div>`
        : `
        <div class="ask-dates">
          <label class="ask-tile"><span class="k">Check in</span><b data-dm="checkIn">${escapeHtml(dm(startIn))}</b><em><span data-wd="checkIn">${escapeHtml(wd(startIn))}</span> · <span data-yr="checkIn">${yr(startIn)}</span></em>
            <input name="checkIn" type="date" required value="${escapeHtml(startIn)}" min="${d(today)}" aria-label="Check in"></label>
          <div class="ask-nights" aria-live="polite"><b id="nights">–</b><span>nights</span></div>
          <label class="ask-tile"><span class="k">Check out</span><b data-dm="checkOut">${escapeHtml(dm(startOut))}</b><em><span data-wd="checkOut">${escapeHtml(wd(startOut))}</span> · <span data-yr="checkOut">${yr(startOut)}</span></em>
            <input name="checkOut" type="date" required value="${escapeHtml(startOut)}" min="${d(today)}" aria-label="Check out"></label>
        </div>
        ${wantFrom ? `<p class="tiny muted ask-hint">${fromDeal ? 'The dates of the deal you tapped.' : cameFrom ? 'The dates of the week you were looking at.' : 'The dates you came in with.'} Tap either to change them.</p>`
          : datesPassed ? '<p class="tiny muted ask-hint">The dates you came in with have passed, so these are two months out. Tap either to change them.</p>' : ''}
        <div class="ask-block">
          <div class="ask-row"><span class="k">Guests</span>
            <div class="stepper" data-for="guests" data-min="1" data-max="8"><button type="button" data-step="-1" aria-label="One guest fewer"${wantGuests <= 1 ? ' disabled' : ''}>−</button><output aria-live="polite">${wantGuests}</output><button type="button" data-step="1" aria-label="One guest more"${wantGuests >= 8 ? ' disabled' : ''}>+</button></div>
            <input type="hidden" name="guests" value="${wantGuests}"></div>
          <div class="ask-row"><span class="k">Flexible</span>
            <div class="chips" role="radiogroup" aria-label="Flexible by" data-for="flexDays">
              ${[[0, 'Exact dates'], [1, '±1 day'], [3, '±3 days'], [7, '±7 days']].map(([v, label]) => `<button type="button" class="chip-btn" data-v="${v}" aria-pressed="${wantFlex === v ? 'true' : 'false'}">${label}</button>`).join('')}
            </div><input type="hidden" name="flexDays" value="${wantFlex}"></div>
        </div>`}
        <label class="field ask-note"><span>A word for Victor</span>
          <textarea name="note" rows="2" placeholder="${isTrip ? 'Who is coming, anything he should know…' : 'A two-bedroom if there is one, ground floor, arriving late, celebrating something…'}">${escapeHtml(openingNote)}</textarea></label>
        <label class="ask-row ask-switch">
          <span><b>Let the Circle chip in</b><span class="small muted">Anyone can put their own points toward this one — a room you are sharing, or a gift. Theirs commit the moment they chip in and come back if it falls through.</span></span>
          <input type="checkbox" name="shared" role="switch" class="switch" aria-label="Let the Circle chip in"${wantShared ? ' checked' : ''}>
        </label>
        <div class="ask-quote" id="preview" aria-live="polite"></div>
        <ol class="ask-steps" aria-label="What happens next">
          <li class="now"><b>You ask</b><span>dates, guests, a word for Victor</span></li>
          <li><b>Victor prices it</b><span>within ${sla} hours, all-in, in points · the quote says how long it holds, ${minHold} hours at the least</span></li>
          <li><b>You say yes</b><span>before it lapses · your points commit</span></li>
          <li><b>Victor books it</b><span>himself, in your name · then it is confirmed</span></li>
        </ol>
        <button class="btn block" type="submit">${isTrip ? `Ask for the ${unit}` : 'Ask Victor to book it'}</button>
        <p class="small muted ask-foot">He answers within ${sla} hours${isTrip ? '' : ' with an all-in price'}. Nothing is committed until you say yes to it.
          You hold ${escapeHtml(fmtPoints(avail))} and can have ${tier.holds} open request${tier.holds > 1 ? 's' : ''} at a time as ${escapeHtml(tierName(me.monthlyUsd))}.${cameFrom ? ` <span class="nowrap">${icon('external', { size: 13, cls: 'ico-muted' })} Victor gets the ${escapeHtml(cameFrom.label)} link you were looking at.</span>` : ''}</p>
      </form>
    </div></section></div>`);
  wrap.querySelector('.ask-shot')?.appendChild(stayStrip(stay));
  const form = wrap.querySelector('#form'), preview = wrap.querySelector('#preview');
  const v = (n) => form.querySelector(`[name=${n}]`);

  // Steppers and chip groups write to hidden inputs, so the submit reads one FormData like
  // before, and every press answers: the number changes, the chip fills, the price re-runs.
  form.addEventListener('click', (e) => {
    const stepBtn = e.target.closest('[data-step]');
    if (stepBtn) {
      const box = stepBtn.closest('.stepper'); const inp = v(box.dataset.for); const out = box.querySelector('output');
      const n = Math.min(Number(box.dataset.max), Math.max(Number(box.dataset.min), Number(inp.value) + Number(stepBtn.dataset.step)));
      inp.value = n; out.textContent = n;
      box.querySelector('[data-step="-1"]').disabled = n <= Number(box.dataset.min);
      box.querySelector('[data-step="1"]').disabled = n >= Number(box.dataset.max);
      form.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const chipBtn = e.target.closest('.chip-btn[data-v]');
    if (chipBtn) {
      const group = chipBtn.closest('.chips'); const inp = v(group.dataset.for);
      group.querySelectorAll('.chip-btn[data-v]').forEach(c => c.setAttribute('aria-pressed', String(c === chipBtn)));
      inp.value = chipBtn.dataset.v;
      form.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // A date tile is a transparent date input stretched over a label, so every tap lands on the
    // input. Phones open the picker on that tap; a desktop click only focuses an invisible
    // segment of the field, so ask for the picker outright.
    if (e.target.matches?.('.ask-tile input[type="date"]')) { try { e.target.showPicker?.(); } catch { /* a browser that refuses still has the input focused; typing a date works */ } }
  });
  const showDate = (name) => {
    const iso = v(name)?.value; if (!isDate(iso)) return;
    wrap.querySelector(`[data-wd="${name}"]`).textContent = wd(iso);
    wrap.querySelector(`[data-dm="${name}"]`).textContent = dm(iso);
    wrap.querySelector(`[data-yr="${name}"]`).textContent = yr(iso);
  };
  const update = () => {
    const f = new FormData(form);
    const seats = Number(f.get('seats') || 1);
    const ci = isTrip ? stay.dates.from : f.get('checkIn'), co = isTrip ? stay.dates.to : f.get('checkOut');
    if (!isTrip) { showDate('checkIn'); showDate('checkOut'); }
    const q = quoteStay(stay, ci, co, s, { seats });
    const nightsEl = wrap.querySelector('#nights'); if (nightsEl) nightsEl.textContent = q.nights > 0 ? q.nights : '–';
    if (!q.nights) { preview.className = 'ask-quote'; preview.innerHTML = '<b>Pick your dates</b>'; return; }
    const short = Math.max(0, q.points - avail);
    const pctRoom = q.points ? Math.round((q.basePoints / q.points) * 100) : 100;
    preview.className = `ask-quote${q.ok ? '' : ' warn'}`;
    preview.innerHTML = q.ok
      ? `<div><span class="k">Indicative, all-in</span><b class="hero-figure" id="q-pts">${escapeHtml(fmtPoints(q.points))}</b>
           <span class="small muted mono">${escapeHtml(fmtUsd2(q.points / s.pointsPerDollar))} · ${q.nights} night${q.nights > 1 ? 's' : ''}${isTrip ? '' : ` · ${escapeHtml(fmtUsd2(q.points / s.pointsPerDollar / q.nights))} a night`}</span></div>
         <div class="ask-split" role="img" aria-label="${pctRoom}% the room, ${100 - pctRoom}% the Circle's share"><span style="width:${pctRoom}%"></span></div>
         <p class="small">${escapeHtml(fmtPoints(q.basePoints))} is the room, ${escapeHtml(fmtPoints(q.servicePoints))} the Circle's ${Math.round(s.serviceRate * 100)}% — the only fee there is.
         ${short ? `You are ${escapeHtml(fmtPoints(short))} short: a top-up of ${escapeHtml(fmtUsd2(short / s.pointsPerDollar))} in cash, at face value, or let the Circle chip in.` : 'Covered by the points you hold.'}
         ${q.retailUsd ? ` Booked alone this runs about ${escapeHtml(fmtUsd2(q.retailUsd))}.` : ''}</p>`
      : `<b>${escapeHtml(stay.name)} needs at least ${q.minNights} nights for those dates</b>
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
        sourceUrl: cameFrom?.url || '', sourceLabel: cameFrom?.label || '',
      });
      toast(`Sent to Victor. He answers within ${sla} hours.`, { kind: 'good' });
      go(`/requests/${r.id}`);
    } catch (err) { setBusy(btn, false); toast(err.message, { kind: 'bad', timeout: 6000 }); }
  });
  return wrap;
}

// The quote's lines, in words a member reads rather than the keys the sheet stores them under.
const STACK_LABEL = { room: 'room', taxes: 'taxes', service: 'service', resort: 'resort fee', env: 'levy', share: 'the Circle’s share' };

/** What a request is doing right now, in the member's words. Approval is a fact on a held request, not a status. */
export const requestLabel = (r) => (r?.status === 'held' && r.approvedAt ? 'Victor is booking it' : statusLabel(r?.status));

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
            <small>${left ? `expires in ${escapeHtml(left)}` : escapeHtml(requestLabel(r))}</small></span></li>`;
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

  const sla = tierFor(s, member?.monthlyUsd)?.slaHours ?? s.slaHours;
  // The road, with the step that is happening now. Approval is Victor picking it up — a person
  // and a time on the record — so "Victor is booking it" is said only once it is true.
  const steps = [
    { key: 'requested', label: 'Asked', at: r.requestedAt, who: member?.name, next: `Victor prices it within ${sla} hours` },
    { key: 'quoted', label: 'Priced by Victor', at: r.quotedAt, who: store.member(r.quotedBy)?.name, next: mine ? 'waiting on you' : 'waiting on the member' },
    { key: 'held', label: 'Said yes · points committed', at: r.heldAt, who: member?.name, next: 'Victor picks it up next' },
    { key: 'approved', label: 'Picked up by Victor', at: r.approvedAt, who: store.member(r.approvedBy)?.name, next: 'in his hands · you hear the moment it is booked' },
    { key: 'confirmed', label: 'Booked', at: r.confirmedAt, who: store.member(r.decidedBy)?.name, next: 'the room is yours' },
    { key: 'completed', label: 'Stayed', at: r.completedAt, next: '' },
  ];
  const closed = ['declined', 'cancelled', 'expired'].includes(r.status);
  // A closed request keeps every step that actually happened — the quote that lapsed, the yes
  // that was cancelled — because those are the member's record of what they committed and when.
  const doneUpTo = closed ? steps.reduce((n, st, i) => (st.at ? i : n), 0)
    : r.status === 'completed' ? 5 : r.status === 'confirmed' ? 4 : r.status === 'held' ? (r.approvedAt ? 3 : 2) : r.status === 'quoted' ? 1 : 0;

  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:860px">
      <p class="eyebrow">${escapeHtml(stay?.area || '')} · ${escapeHtml(requestLabel(r))}</p>
      <h1>${escapeHtml(stay?.name || 'Stay')}</h1>
      <p class="lede" style="margin-top:10px">${escapeHtml(fmtDay(r.checkIn))} – ${escapeHtml(fmtDay(r.checkOut))} · ${r.nights} night${r.nights > 1 ? 's' : ''} · ${r.guests} guest${r.guests > 1 ? 's' : ''}${mine ? '' : ` · ${escapeHtml(member?.name || '')}`}</p>

      <div class="side" style="margin-top:22px">
        <div class="stack">
          <div class="panel" id="money"></div>
          <div id="chipin"></div>
          ${r.note ? `<div class="panel flat"><p class="eyebrow">${icon('user')}What they asked for</p><p class="small" style="margin-top:8px">${escapeHtml(r.note)}</p></div>` : ''}
          ${(() => {
            // Only the people who actually do the booking need this, and only while it is still
            // a job — once the hotel is paid the link is history, not a task.
            if (!store.canPlan?.() || ['completed', 'declined', 'cancelled', 'expired'].includes(r.status)) return '';
            const links = store.whereToBook(r.id);
            const gated = store.needsLook?.(r);
            const seen = gated ? store.lookFor?.(r.stayId, r.checkIn, r.checkOut) : null;
            return `<div class="panel" style="border-color:var(--good)">
              <p class="eyebrow">${icon('external')}Go and look</p>
              <p class="small muted" style="margin-top:6px">Open it, then say what you saw. Nothing here checks the hotel &mdash; you are the only thing that can.</p>
              ${links.length ? `<ul class="stack" style="margin-top:10px;list-style:none;padding:0;gap:10px">
                ${links.map((l, i) => `<li><a class="btn ${l.exact ? '' : 'ghost'} sm" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">
                  ${icon('external', { size: 15 })}${escapeHtml(l.label)}</a>${l.exact
                    ? '<span class="small muted" style="margin-left:8px">the listing they were looking at</span>'
                    : l.seenOn ? `<span class="small muted" style="margin-left:8px">seen ${escapeHtml(fmtDay(l.seenOn))}</span>` : ''}
                  <span class="row" style="gap:6px;margin-top:6px">
                    <button class="btn ghost sm" data-look="showing" data-url="${escapeHtml(l.url)}" data-label="${escapeHtml(l.label)}">It is there</button>
                    <button class="btn ghost sm" data-look="gone" data-url="${escapeHtml(l.url)}" data-label="${escapeHtml(l.label)}">It is gone</button>
                    <button class="btn ghost sm" data-look="unclear" data-url="${escapeHtml(l.url)}" data-label="${escapeHtml(l.label)}">Could not tell</button>
                  </span></li>`).join('')}
              </ul>` : `<p class="small muted" style="margin-top:8px">No link on file for this one &mdash; the property has no booking page in the catalog and this request did not come from a listing. Add one in the Desk so the next request has somewhere to go.</p>`}
              <p class="small" style="margin-top:12px">
                <button class="btn ghost sm" data-look="phone">I rang them instead</button></p>
              ${gated ? `<p class="tiny ${seen ? 'muted' : ''}" style="margin-top:10px${seen ? '' : ';color:var(--flag)'}">${seen
                ? `Last look: ${escapeHtml(store.member(seen.lookedBy)?.name.split(' ')[0] || 'someone')} ${escapeHtml(seen.found === 'showing' ? 'saw it' : seen.found === 'booked' ? 'booked it' : `found it ${seen.found}`)} ${escapeHtml(fmtDayTime(seen.lookedAt))}${seen.priceUsd ? `, asking ${escapeHtml(fmtUsd2(seen.priceUsd))} a night` : ''}.`
                : 'Nobody has looked at these nights yet, so this cannot be quoted.'}</p>` : ''}
            </div>`;
          })()}
          ${(() => {
            // What anyone has actually seen. The app never says a room is available — it cannot
            // know that, and saying it would be the same ghost information the rest of this
            // codebase has spent weeks deleting. It says who looked, where, when, and what they
            // found. A member reading this can tell the difference between "somebody checked an
            // hour ago" and "nobody has looked", which is the whole point.
            if (!store.needsLook?.(r)) return '';
            const rows = (store.looksFor?.(r.id) || []).filter(l => !l.byRobot);
            const newest = rows[0];
            const who = (id) => escapeHtml(store.member(id)?.name.split(' ')[0] || 'The Desk');
            const host = (u) => { try { return escapeHtml(new URL(u).host.replace(/^www\./, '')); } catch { return 'their site'; } };
            let line;
            if (!newest) {
              line = `<b>Nobody has looked yet.</b> Victor looks before he prices anything — nothing is committed and no points have moved.`;
            } else if (newest.found === 'booked') {
              line = `<b>${who(newest.lookedBy)} booked it${newest.note ? `, reference ${escapeHtml(newest.note)}` : ''}.</b> That is the room, not a maybe.`;
            } else if (newest.found === 'gone') {
              line = `<b>Not there.</b> ${who(newest.lookedBy)} looked ${newest.channel === 'phone' ? 'and rang them' : `on ${host(newest.url)}`} ${escapeHtml(fmtDayTime(newest.lookedAt))} and could not find these nights.`;
            } else if (newest.found === 'unclear') {
              line = `${who(newest.lookedBy)} looked ${escapeHtml(fmtDayTime(newest.lookedAt))} and could not tell${newest.note ? ` &mdash; ${escapeHtml(newest.note)}` : ''}.`;
            } else {
              const stale = Date.parse(newest.goodUntil) < Date.now();
              line = `${who(newest.lookedBy)} saw these nights open. ${newest.channel === 'phone' ? 'He rang them' : `He opened <b>${host(newest.url)}</b>`} ${escapeHtml(fmtDayTime(newest.lookedAt))}${newest.priceUsd ? `, asking ${escapeHtml(fmtUsd2(newest.priceUsd))} a night` : ''}${newest.roomLabel ? ` (${escapeHtml(newest.roomLabel)})` : ''}. That is what the page showed &mdash; it is not a reservation. The room is yours when Victor books it.`
                + (stale ? ` <b>That was a while ago, and nobody has looked since;</b> he will look again before he books.` : '');
            }
            return `<div class="panel flat"><p class="eyebrow">${icon('search')}What anyone has actually seen</p>
              <p class="small" style="margin-top:8px;line-height:1.5">${line}</p>
              ${rows.length > 1 ? `<ul class="stack small muted" style="margin-top:10px;list-style:none;padding:0;gap:4px">
                ${rows.slice(1, 4).map(l => `<li>${who(l.lookedBy)} &middot; ${escapeHtml(fmtDayTime(l.lookedAt))} &middot; ${escapeHtml(l.found)}</li>`).join('')}
              </ul>` : ''}</div>`;
          })()}
          ${r.decision ? `<div class="notice ${['declined', 'cancelled', 'expired'].includes(r.status) ? 'bad' : ''}">
            <b>${escapeHtml(['declined'].includes(r.status) ? 'Declined by ' : 'Note from ')}${escapeHtml(store.member(r.decidedBy || r.quotedBy)?.name.split(' ')[0] || 'the Desk')}</b>
            <p class="small">${escapeHtml(r.decision)}</p></div>` : ''}
          <div class="panel" id="actions"></div>
        </div>
        <div class="panel flat">
          <p class="eyebrow">${icon('history')}What happened when</p>
          <ul class="timeline" style="margin-top:12px">
            ${steps.slice(0, closed ? doneUpTo + 1 : doneUpTo + 2).map((st2, i) => i <= doneUpTo
              ? `<li class="done"><b>${escapeHtml(st2.label)}</b><br><span class="when">${st2.at ? escapeHtml(fmtDayTime(st2.at)) : ''}${st2.who ? ` · ${escapeHtml(st2.who.split(' ')[0])}` : ''}</span></li>`
              : `<li class="now"><b>${escapeHtml(st2.label)}</b><br><span class="when">${escapeHtml(steps[i - 1].next || 'next')}</span></li>`).join('')}
            ${closed ? `<li class="end"><b>${escapeHtml(statusLabel(r.status))}</b><br><span class="when">${r.decidedAt ? escapeHtml(fmtDayTime(r.decidedAt)) : ''}${r.decidedBy ? ` · ${escapeHtml(store.member(r.decidedBy)?.name.split(' ')[0] || '')}` : ''}</span></li>` : ''}
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
        <span class="meta">${r.quoteStack ? Object.entries(r.quoteStack).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${STACK_LABEL[k] || k} ${fmtUsd2(v)}`).join(' · ') : 'Room, levies, service and resort fees included'}</span></span>
        <span class="delta"><b>${escapeHtml(fmtPoints(pts))}</b><small>${escapeHtml(pointsUsd(pts, s.pointsPerDollar))}</small></span></li>
      ${(r.topUpUsd || r.topUpReceivedUsd) ? (() => {
        // Owed and received are two numbers, and the line has to say both when they differ:
        // a pledge after the cash arrived leaves the Banker holding money to give back, and a
        // withdrawal after it leaves more to collect. Either way the member sees it.
        const due = r.topUpUsd || 0, got = r.topUpReceivedUsd;
        const state = got == null ? 'to the Banker'
          : got > due ? `${fmtUsd2(got)} received · ${fmtUsd2(got - due)} comes back to you`
          : got < due ? `${fmtUsd2(got)} received · ${fmtUsd2(due - got)} still to the Banker`
          : 'received';
        return `<li><span class="what"><b>Top-up in cash</b><span class="meta">Beyond the points held, at face value — the share is already in the quote.</span></span>
        <span class="delta"><b>${escapeHtml(fmtUsd2(due))}</b><small>${escapeHtml(state)}</small></span></li>`;
      })() : ''}
      ${r.retailUsd ? `<li><span class="what"><b>Booked on your own</b><span class="meta">Same room, public all-in rate</span></span>
        <span class="delta"><b>${escapeHtml(fmtUsd2(r.retailUsd))}</b><small>${escapeHtml((() => {
          // Honest in both directions, like versusPublic three screens away. The old clamp could
          // only ever print a win, and printed "you save $0.00" on the Ritz for ever.
          const v = versusPublic(r.retailUsd, pts / s.pointsPerDollar);
          return !v ? '' : v.same ? 'about the same as booking direct' : v.better ? `you save ${fmtUsd2(v.diffUsd)}` : `direct is ${fmtUsd2(v.diffUsd)} cheaper`;
        })())}</small></span></li>` : ''}
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

  // Writing down what the Desk saw. Its own listener because the buttons live in the "Go and
  // look" panel, not in #actions, and that dispatcher only matches [data-act].
  wrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-look]'); if (!btn) return;
    await lookSheet(store, r, stay, { found: btn.dataset.look, url: btn.dataset.url, label: btn.dataset.label });
  });

  const actions = wrap.querySelector('#actions');
  const buttons = [];
  if (mine && r.status === 'quoted' && left) buttons.push('<button class="btn" data-act="accept">Accept and commit the points</button>');
  if (mine && ['requested', 'quoted', 'held'].includes(r.status)) buttons.push('<button class="btn ghost" data-act="cancel">Cancel this request</button>');
  if (canQuote && r.status === 'requested') buttons.push('<button class="btn" data-act="quote">Quote it</button><button class="btn danger" data-act="decline">Decline</button>');
  const topUpOwed = r.status === 'held' && r.topUpUsd > 0 && !r.topUpConfirmed;
  if (store.canPlan?.() && r.status === 'held' && !r.approvedAt) buttons.push('<button class="btn" data-act="approve">I have it — booking it</button>');
  if (canPay && r.status === 'held') buttons.push(`<button class="btn good" data-act="pay"${topUpOwed ? ' disabled' : ''}>${icon('check', { size: 16 })}I booked it</button>`);
  if (mine && closed && stay && stay.kind !== 'trip') {
    // Everything they said the first time rides along, so the re-ask opens as they left it.
    const again = new URLSearchParams({ from: r.checkIn, to: r.checkOut, guests: String(r.guests || 2), flex: String(r.flexDays || 0), shared: r.shared ? '1' : '0', note: r.note || '' });
    buttons.push(`<a class="btn ghost" href="#/book/${escapeHtml(stay.id)}?${escapeHtml(again.toString())}">Ask again</a>`);
  }
  if (canPay && topUpOwed) buttons.push('<button class="btn" data-act="topup">Mark the top-up received</button>');
  if (store.hasRole('planner', 'admin') && r.status === 'confirmed') buttons.push('<button class="btn ghost" data-act="complete">Mark as stayed</button><button class="btn danger" data-act="cancelPaid">Cancel the booking</button>');
  actions.innerHTML = buttons.length
    ? `<p class="eyebrow">${icon('zap')}What you can do</p><div class="row" style="margin-top:12px">${buttons.join('')}</div>
       ${topUpOwed ? `<p class="small" style="margin-top:12px;color:var(--flag)">The hotel cannot be paid until the ${escapeHtml(fmtUsd2(r.topUpUsd))} top-up has reached the Banker. Nothing is ever booked on credit.</p>` : ''}
       ${r.status === 'held' && mine ? `<p class="small muted" style="margin-top:12px">${r.approvedAt ? 'Victor has it and is booking it himself, in your name. Your points burn only when the room is his to give you.' : 'Your points are committed and Victor picks it up next. Nothing is booked until he books it himself.'}</p>` : ''}
       ${r.status === 'quoted' && mine ? `<p class="small muted" style="margin-top:12px">Accepting moves ${escapeHtml(fmtPoints(Math.min(pts, avail)))} into Committed. They are still yours and still counted in the Circle’s coverage until the hotel is paid.</p>` : ''}`
    : '';
  if (!buttons.length) actions.remove();

  actions.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    try {
      if (act === 'accept') { await store.acceptQuote(r.id, me.id); toast('Accepted. Your points are committed while Victor books it.', { kind: 'good' }); }
      if (act === 'cancel') {
        const yes = await confirmDialog({ title: 'Cancel this request?', message: r.approvedAt ? 'Victor is booking it — he sees this straight away and stops. Nothing has been paid, so nothing is lost.' : 'Nothing has been committed to a hotel yet, so nothing is lost.', confirmText: 'Cancel it', danger: true });
        if (yes) { await store.cancelRedemption(r.id, me.id, { reason: 'Cancelled by the member' }); toast('Cancelled.'); go('/requests'); return; }
      }
      if (act === 'decline') {
        const reason = await confirmDialog({ title: 'Decline this request', requireReason: true, reasonLabel: 'What should they know? They read this word for word.', confirmText: 'Decline', danger: true,
          message: 'Say what is not possible and, if you can, what is.' });
        if (reason) { await store.declineRedemption(r.id, me.id, reason); toast('Declined, with your reason.'); }
      }
      if (act === 'quote') await quoteSheet(store, r, stay);
      if (act === 'topup') { await store.confirmTopUp(r.id, me.id); toast('Top-up marked as received.'); }
      if (act === 'approve') { await store.approveRedemption(r.id, me.id); toast(`${member?.name.split(' ')[0] || 'They'} can see you are booking it.`, { kind: 'good' }); }
      if (act === 'pay') await bookSheet(store, r);
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

/**
 * Victor's quote composer: he types what the hotel charges, and the Circle's share is added on
 * top — visibly, as its own line, because that is what every screen already tells the member.
 *
 * This used to publish `total * pointsPerDollar` and nothing else, so the binding quote was the
 * hotel's cash exactly and the Circle earned nothing on the booking. It hid because the
 * pre-filled defaults were fractions of the ALL-IN indicative price (0.72 + 0.09 + 0.10 + 0.08
 * ≈ 0.99 of it), so an untouched quote reconstructed roughly the right total by accident. The
 * moment the Desk typed the real numbers off a hotel checkout page — the entire point of this
 * sheet — the 15% vanished, on the club's only source of income. The defaults are now fractions
 * of the ROOM-only figure, so the labels are true and the arithmetic does not depend on nobody
 * touching them.
 */
/**
 * A named person opened a named page and wrote down what they saw. The only availability fact
 * the app holds; shared by the request page and the Desk's sheets so a look can be written
 * down wherever the Desk happens to be when it looks.
 */
export async function lookSheet(store, r, stay, { found, url = '', label = '' } = {}) {
  const phone = found === 'phone';
  try {
    const out = await sheet({ title: phone ? 'You rang them' : 'What did you see?', render: (body, close) => {
      body.innerHTML = `<p class="sheet-text">${escapeHtml(stay?.name || '')} · ${escapeHtml(fmtDay(r.checkIn))} – ${escapeHtml(fmtDay(r.checkOut))}.
          This is written down with your name and the time on it, and the member reads it.</p>
        ${phone ? `<label class="field"><span>What did they say?</span><input name="note" placeholder="Held under Hunto until Tuesday, ref 4471" required></label>
          <label class="field"><span>Was the week there?</span><select name="found">
            <option value="showing">Yes, it is there</option><option value="gone">No, it is gone</option>
            <option value="unclear">They could not say</option></select></label>` : ''}
        <label class="field"><span>Asking, a night (optional)</span><input name="price" type="number" step="0.01" inputmode="decimal" placeholder="only if the page said"></label>
        <label class="field"><span>The room, as the page named it (optional)</span><input name="room" placeholder="Two-Bedroom Oceanfront"></label>
        ${phone ? '' : `<label class="field"><span>Anything worth noting${found === 'showing' ? ' (optional)' : ''}</span><input name="note" ${found === 'showing' ? '' : 'required'} placeholder="${found === 'gone' ? 'nothing for these dates, or only a studio' : 'what was unclear'}"></label>`}
        <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>Write it down</button></div>`;
      body.querySelector('[data-ok]').addEventListener('click', () => {
        const noteEl = body.querySelector('[name=note]');
        const note = noteEl?.value.trim() || '';
        if ((phone || ['gone', 'unclear'].includes(found)) && !note) { noteEl.classList.add('invalid'); return; }
        close({ found: phone ? body.querySelector('[name=found]').value : found, note,
          priceUsd: Number(body.querySelector('[name=price]').value) || null,
          roomLabel: body.querySelector('[name=room]').value.trim() });
      });
    } });
    if (!out) return null;
    const l = await store.recordLook({ stayId: r.stayId, checkIn: r.checkIn, checkOut: r.checkOut,
      found: out.found, channel: phone ? 'phone' : 'site',
      url: phone ? '' : url, label: phone ? 'Rang them' : label,
      priceUsd: out.priceUsd, roomLabel: out.roomLabel, note: out.note, redemptionId: r.id }, store.me.id);
    toast('Written down.', { kind: 'good' });
    // The caller reads `.found` — a look that says the week is gone must never be taken for a yes.
    return l || out;
  } catch (err) { toast(err.message, { kind: 'bad' }); return null; }
}

/** Who may write down a look: the same people both backends let record one (planner, comms, admin). */
const canLook = (store) => store.hasRole('planner', 'comms', 'admin');

/**
 * Where to book this one, with the look buttons under each link. Markup only; wire [data-look]
 * to lookSheet. The Banker sees the links but not the buttons — the server refuses their look
 * anyway, and a button that only ever toasts an error is not a control.
 */
function lookBlock(store, r) {
  const links = store.whereToBook(r.id);
  const gated = store.needsLook?.(r);
  const seen = gated ? store.lookFor?.(r.stayId, r.checkIn, r.checkOut, r.status === 'held' ? r.heldAt : null) : null;
  const may = canLook(store);
  return `<div class="look-block">
    ${links.length ? `<ul class="stack" style="list-style:none;padding:0;gap:8px">
      ${links.map(l => `<li class="row" style="gap:8px;flex-wrap:wrap"><a class="btn ${l.exact ? '' : 'ghost'} sm" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${icon('external', { size: 15 })}${escapeHtml(l.label)}</a>
        ${may ? `<button type="button" class="btn ghost sm" data-look="showing" data-url="${escapeHtml(l.url)}" data-label="${escapeHtml(l.label)}">It is there</button>
        <button type="button" class="btn quiet sm" data-look="gone" data-url="${escapeHtml(l.url)}" data-label="${escapeHtml(l.label)}">It is gone</button>` : ''}</li>`).join('')}
    </ul>` : '<p class="small muted">No link on file for this one.</p>'}
    ${may ? '<p class="small" style="margin-top:8px"><button type="button" class="btn quiet sm" data-look="phone">I rang them instead</button></p>' : ''}
    ${gated ? `<p class="tiny look-line" style="margin-top:6px${seen ? '' : ';color:var(--flag)'}">${seen
      ? `Last look: ${escapeHtml(store.member(seen.lookedBy)?.name.split(' ')[0] || 'someone')} ${seen.found === 'showing' ? 'saw it open' : seen.found === 'booked' ? 'booked it' : `found it ${escapeHtml(seen.found)}`} · ${escapeHtml(fmtDayTime(seen.lookedAt))}`
      : `Nobody has looked at these nights${r.status === 'held' ? ' since they said yes' : ''}${may ? ' — open it and say what you saw first.' : ' — Victor or Ian looks before it can be booked.'}`}</p>` : ''}
  </div>`;
}

/**
 * Victor books it. The sheet has everything he needs in one place — the dates, the word from
 * the member, where to book, the look buttons — and the one thing the app needs from him
 * afterwards: the confirmation. Nothing here is automatic. The points burn only when he says
 * he has booked it, and the ledger shows it under his name.
 */
export async function bookSheet(store, r) {
  const s = store.settings, stay = store.stay(r.stayId), member = store.member(r.memberId);
  const first = member?.name.split(' ')[0] || 'the member';
  const canApprove = !!store.canPlan?.();
  const out = await sheet({ title: `Book ${stay?.name || 'it'} for ${first}`, wide: true, render: (body, close) => {
    const draw = () => {
      // The live backend replaces the record on every write, so re-read it before drawing —
      // otherwise the sheet keeps showing "I have it" after it has been said.
      Object.assign(r, store.redemption(r.id) || {});
      const topUpOwed = r.topUpUsd > 0 && (r.topUpReceivedUsd ?? 0) < r.topUpUsd;
      const owed = hotelOwedUsd(r, s);
      body.innerHTML = `
        <p class="sheet-text"><b>${escapeHtml(fmtDay(r.checkIn))} – ${escapeHtml(fmtDay(r.checkOut))}</b> · ${r.nights} night${r.nights > 1 ? 's' : ''} · ${r.guests} guest${r.guests > 1 ? 's' : ''}${r.flexDays ? ` · flexible ±${r.flexDays}d` : ''}
          · ${escapeHtml(fmtPoints(r.quotedPoints || r.points))} quoted${r.topUpUsd ? ` · ${escapeHtml(fmtUsd2(r.topUpUsd))} top-up ${topUpOwed ? '<span style="color:var(--flag)">still to the Banker</span>' : 'received'}` : ''}
          ${r.note ? `<br>“${escapeHtml(r.note)}”` : ''}</p>
        <p class="eyebrow" style="margin-top:4px">${icon('external')}Book it here${r.approvedAt || !canApprove ? '' : ` — ${escapeHtml(first)} is told you have it the moment you say it is there`}</p>
        ${lookBlock(store, r)}
        <p class="eyebrow" style="margin-top:18px">${icon('check')}Once it is booked</p>
        <p class="sheet-text" style="margin-top:6px">This burns ${escapeHtml(fmtPoints(r.points))} from ${escapeHtml(member?.name || 'the member')}${(r.pledges || []).length ? ` and what ${r.pledges.length} other${r.pledges.length > 1 ? 's' : ''} chipped in` : ''}, and records what the Reserve paid the hotel. ${escapeHtml(first)} was quoted ${escapeHtml(fmtUsd2((r.quotedPoints || 0) / s.pointsPerDollar))}; the difference is the Circle's ${Math.round(s.serviceRate * 100)}%.</p>
        <div class="grid g2">
          <label class="field"><span>Hotel confirmation number</span><input name="ref" placeholder="e.g. BT-2026-4471" required autocomplete="off"></label>
          <label class="field"><span>Paid to the hotel, US$</span><input name="paid" type="number" step="0.01" value="${owed.toFixed(2)}" inputmode="decimal"></label>
        </div>
        ${topUpOwed ? `<p class="small" style="color:var(--flag);margin-bottom:10px">The ${escapeHtml(fmtUsd2(r.topUpUsd))} top-up has not reached the Banker yet. Nothing is booked on credit — book it once Vishnu has it.</p>` : ''}
        <div class="sheet-actions"><button class="btn ghost" data-close>Not yet</button>
          ${r.approvedAt || !canApprove ? '' : '<button type="button" class="btn ghost" data-approve>I have it, booking later</button>'}
          <button class="btn good" data-ok ${topUpOwed ? 'disabled' : ''}>${icon('check', { size: 16 })}I booked it — burn the points</button></div>`;
    };
    draw();
    body.addEventListener('click', async (e) => {
      const look = e.target.closest('[data-look]');
      if (look) {
        const done = await lookSheet(store, r, stay, { found: look.dataset.look, url: look.dataset.url, label: look.dataset.label });
        // Seeing it there is Victor picking it up. Seeing it gone, or not being sure, is not.
        if (done?.found === 'showing' && !r.approvedAt && canApprove) { try { await store.approveRedemption(r.id, store.me.id); } catch { /* the look is written down either way */ } }
        if (done) draw();
        return;
      }
      if (e.target.closest('[data-approve]')) { try { await store.approveRedemption(r.id, store.me.id); toast(`${first} can see you are booking it.`, { kind: 'good' }); draw(); } catch (err) { toast(err.message, { kind: 'bad' }); } return; }
      if (e.target.closest('[data-ok]')) {
        const ref = body.querySelector('[name=ref]').value.trim();
        if (!ref) { body.querySelector('[name=ref]').classList.add('invalid'); body.querySelector('[name=ref]').focus(); return; }
        close({ paidUsd: Number(body.querySelector('[name=paid]').value), confirmationRef: ref });
      }
    });
  } });
  if (!out) return null;
  try {
    await store.payRedemption(r.id, store.me.id, out);
    toast(`Booked. ${first} can see it, and the ledger shows the points burned under your name.`, { kind: 'good' });
    return true;
  } catch (err) { toast(err.message, { kind: 'bad', timeout: 8000 }); return null; }
}

export async function quoteSheet(store, r, stay) {
  const s = store.settings;
  const indicative = r.indicativePoints || 0;
  // The indicative price already carries the share (money.js allIn), so take it back out to get
  // what the hotel is likely to charge. These are a starting point Victor overwrites.
  const hotelUsd = indicative / s.pointsPerDollar / (1 + s.serviceRate);
  const out = await sheet({ title: `Quote ${stay?.name || 'this stay'}`, wide: true, render: (body, close) => {
    body.innerHTML = `
      ${store.needsLook?.(r) ? `<p class="eyebrow">${icon('external')}Look first</p>${lookBlock(store, r)}<p class="eyebrow" style="margin-top:18px">${icon('tag')}Then price it</p>` : ''}
      <p class="sheet-text">Type what the hotel charges. The Circle's ${Math.round(s.serviceRate * 100)}% is added on top and the member sees it as its own line. The quote holds for ${s.quoteHours} hours, or until the look it rests on goes stale — never under ${s.minQuoteHours ?? 12} — and the member sees the countdown.</p>
      <div class="grid g3">
        <label class="field"><span>Room total</span><input name="room" type="number" step="0.01" value="${(hotelUsd * 0.72).toFixed(2)}" inputmode="decimal"></label>
        <label class="field"><span>Taxes</span><input name="taxes" type="number" step="0.01" value="${(hotelUsd * 0.09).toFixed(2)}" inputmode="decimal"></label>
        <label class="field"><span>Service charge</span><input name="service" type="number" step="0.01" value="${(hotelUsd * 0.1).toFixed(2)}" inputmode="decimal"></label>
        <label class="field"><span>Resort fee</span><input name="resort" type="number" step="0.01" value="${(hotelUsd * 0.08).toFixed(2)}" inputmode="decimal"></label>
        <label class="field"><span>Environmental levy</span><input name="env" type="number" step="0.01" value="${(r.nights * 6).toFixed(2)}" inputmode="decimal"></label>
        <div class="stat"><span class="k">The hotel</span><b class="num" id="q-hotel">—</b><span class="sub">what we pay them</span></div>
        <div class="stat"><span class="k">The Circle's ${Math.round(s.serviceRate * 100)}%</span><b class="num" id="q-share">—</b><span class="sub">what the club earns</span></div>
        <div class="stat"><span class="k">The quote</span><b class="num" id="q-total">—</b><span class="sub" id="q-pts">—</span></div>
      </div>
      <label class="field"><span>Hotel’s cancellation terms</span><input name="terms" value="Free cancellation up to 30 days before arrival." ></label>
      <label class="field"><span>Free-cancellation deadline</span><input name="deadline" type="date" value="${new Date(new Date(r.checkIn).getTime() - 30 * 864e5).toISOString().slice(0, 10)}"></label>
      <label class="field"><span>A line for the member</span><textarea name="note" rows="2" placeholder="Lagoon view, high floor — and I got the resort fee waived."></textarea></label>
      <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>Publish the quote</button></div>`;
    const HOTEL_LINES = ['room', 'taxes', 'service', 'resort', 'env'];
    const hotel = () => HOTEL_LINES.reduce((sum, k) => sum + (Number(body.querySelector(`[name=${k}]`).value) || 0), 0);
    const share = () => round2(hotel() * s.serviceRate);
    const quoteUsd = () => hotel() + share();
    const sync = () => {
      body.querySelector('#q-hotel').textContent = fmtUsd2(hotel());
      body.querySelector('#q-share').textContent = fmtUsd2(share());
      body.querySelector('#q-total').textContent = fmtUsd2(quoteUsd());
      body.querySelector('#q-pts').textContent = fmtPoints(Math.round(quoteUsd() * s.pointsPerDollar));
    };
    sync(); body.addEventListener('input', sync);
    body.addEventListener('click', async (e) => {
      const look = e.target.closest('[data-look]'); if (!look) return;
      const done = await lookSheet(store, r, stay, { found: look.dataset.look, url: look.dataset.url, label: look.dataset.label });
      if (done) { const block = body.querySelector('.look-block'); if (block) block.outerHTML = lookBlock(store, r); }
    });
    body.querySelector('[data-ok]').addEventListener('click', () => {
      // `share` rides in the stack so the member's breakdown shows it by name. Both backends
      // re-derive it from the hotel lines and refuse a quote whose points do not match, so the
      // rate cannot be dropped by a future caller the way it was dropped here.
      const stack = Object.fromEntries(HOTEL_LINES.map(k => [k, Number(body.querySelector(`[name=${k}]`).value) || 0]));
      stack.share = share();
      close({ points: Math.round(quoteUsd() * s.pointsPerDollar), stack, terms: body.querySelector('[name=terms]').value,
        hotelDeadline: body.querySelector('[name=deadline]').value, note: body.querySelector('[name=note]').value });
    });
  } });
  if (!out) return;
  // The refusal has to show wherever this is called from. From the Desk — the normal path — the
  // write was bare, so quote_redemption's good reasons ("That quote leaves out the Circle's
  // share", "Open the link and say what you saw before you price it", "The last look says that
  // week was gone") closed the sheet and said nothing, and the one guard built to stop an
  // unbacked quote was invisible exactly when it fired.
  try {
    await store.quoteRedemption(r.id, store.me.id, out);
    toast(`Quote published. It is locked for ${s.quoteHours} hours.`, { kind: 'good' });
  } catch (err) {
    toast(err.message, { kind: 'bad', timeout: 8000 });
  }
}
