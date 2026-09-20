// Stays (the deals), cruises and trips, requesting one, and the life of a request.
import { escapeHtml, fmtUsd, fmtUsd2, fmtPoints, pointsUsd, fmtDay, fmtDayTime, countdownTo, initials, nightsBetween, safeUrl } from '../core/util.js';
import { VOCAB, tierName } from '../core/vocab.js';
import { quoteStay, nightPoints, fromPoints, seatPoints, unitPoints, versusPublic, tierFor, REACH, reachOf, pointsPerMonth, round2, hotelOwedUsd, isCruise, unitWord } from '../core/money.js';
import { effectiveTier } from '../core/standing.js';
import { stayCard, stayStrip, photoFor, photoCredit, seedIdOf } from './public.js';
import { roomPhotosFor, roomsOf, roomPhotoSheet, galleryStrip } from './rooms.js';
import { PLACES } from '../data/places.js';
import { toast, sheet, confirmDialog, setBusy, chip, statusLabel } from '../ui/components.js';
import { shareText } from '../core/share.js';
import { icon } from '../ui/icons.js';
import { routeSvg, islandSvg } from '../ui/art.js';
import { dealList, byNight, wireDealActions, postDealSheet, pasteListingSheet, daysUntil, dealCover, nightly, dropWhen, SOURCES } from './deals.js';
import { openWeeks, resortForStay, bedroomsOf } from './live.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const AREAS = ['Palm Beach', 'Eagle Beach', 'Druif Beach', 'Oranjestad', 'Malmok', 'Savaneta', 'Noord'];

// A points-a-night figure shown as the dollars it is worth, so a browse price reads like a
// hotel's and not a jackpot. Used on the surfaces a member scans — the cover, the hero caption,
// the places index. Points stay primary only where a member actually spends them: the pricing
// panel, where the live quote does the arithmetic in the currency they hold.
const usdFrom = (pts, ppd = 100) => fmtUsd((pts || 0) / (ppd || 100));

/** The one button that asks VakayMood again, on a line of its own under the sentence that needed it. */
const retryLine = () => `<p class="row"><button type="button" class="btn ghost sm" data-act="retry-open">${icon('refresh', { size: 14 })}Try again</button></p>`;

/**
 * One sentence, under every list of what is open: where the owner weeks came from and when.
 * Never "available" — open on VakayMood at the time shown, or the Circle's own copy of it.
 * The sentence only; the caller puts the retry button on its own line when `res.error`.
 *
 * Two figures live on this panel and they are not the same fact: the heading counts the weeks
 * the Circle has in front of it here, `res.total` counts every owner week VakayMood LISTS at the
 * place — the whole resort, not the page we asked for (we ask for 24). Printing both as "open at
 * Marriott's Aruba Surf Club", one line apart, made a member read one of them as false, so the
 * big number is now "listed" and the sentence says plainly that only some of them are priced.
 */
function asOfLine(res, where = 'the places we stay') {
  const t = res.generatedAt ? new Date(res.generatedAt) : null;
  const time = t ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const day = t ? t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
  const eye = icon('eye', { size: 14, cls: 'ico-muted' });
  if (res.error) return `${eye} This phone could not reach VakayMood just now${res.blocked ? ' — mobile data, or a content blocker' : ''}, so owner weeks are missing here. What the Desk has posted is what you see.`;
  const n = `<b class="num">${res.total.toLocaleString('en-US')}</b>`;
  const weeks = `${n} owner week${res.total === 1 ? '' : 's'} listed at ${escapeHtml(where)}`;
  const some = res.total > (res.deals?.length || 0) ? '; the ones the Circle can price are below' : '';
  return res.fromCopy
    ? `${eye} ${weeks} in the Circle’s copy of VakayMood, taken ${escapeHtml(day)} ${escapeHtml(time)} — this phone could not reach it live${some}.`
    : `${eye} ${weeks} on VakayMood as of ${escapeHtml(time)}${res.failed ? ` (<b class="num">${res.failed}</b> place${res.failed === 1 ? '' : 's'} did not answer)` : ''}${some}.`;
}

/**
 * The masthead's dateline: which edition of the market this is, in one line. Never "live",
 * never "available". The provenance — how many owner weeks, whose copy, who did not answer —
 * is the colophon at the foot (colophonOf), so the first screen carries the edition and the count.
 */
function datelineOf(res, open) {
  const t = res.generatedAt ? new Date(res.generatedAt) : new Date();
  const time = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `Edition of ${escapeHtml(day)} · <span class="stamp">${escapeHtml(time)}</span> · <b class="num">${open}</b> open${res.error ? ' · what the Desk has posted' : ''}`;
}

/** The sentence under the dateline when this phone could not reach VakayMood; '' otherwise. */
function reachNote(res) {
  if (!res.error) return '';
  return `This phone could not reach VakayMood${res.blocked ? ' — mobile data, or a content blocker' : ''}, so owner weeks are missing.`;
}

/**
 * The colophon: where the board's weeks came from, as short stamps a line can wrap between.
 * Each stamp is its own nowrap span, so the line breaks between facts and never inside one.
 */
function colophonOf(res) {
  if (res.error) return [];
  const n = res.total.toLocaleString('en-US');
  const bits = [`${n} owner week${res.total === 1 ? '' : 's'} on VakayMood`];
  if (res.fromCopy) bits.push('the Circle’s copy — this phone could not reach it live');
  if (res.failed) bits.push(`${res.failed} place${res.failed === 1 ? '' : 's'} did not answer`);
  return bits;
}

/**
 * The Stays tab IS the deals, set like a front page. A masthead says which edition of the
 * market you are reading; the cheapest week open is the cover, photographed and priced large;
 * the rest are numbered listing rows the eye reads down a hairline, cheapest a night first,
 * the first spread across places; the places are an index at the foot. Victor: "I only need
 * the best deals on the market."
 */
/**
 * What the board is actually made of, by source — because "I still see RedWeeks" should be a
 * thing a member can read off the page rather than infer. Interval is named even when it has
 * nothing on the board, because its absence is the fact that matters: the Getaways are the
 * cheapest weeks the Circle can get, and none of them are here until one is put here.
 */
function madeOf(list) {
  if (!list.length) return [];
  const by = new Map();
  for (const d of list) {
    const k = d.draft ? 'vakaymood' : (d.source || 'other');
    by.set(k, (by.get(k) || 0) + 1);
  }
  const bits = [...by.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} from ${escapeHtml((SOURCES[k] || SOURCES.other).label)}`);
  if (!by.get('interval')) bits.push('nothing from Interval yet');
  return bits;
}

export function stays({ store, go, query = {} }) {
  const me = store.me, s = store.settings;
  const canEdit = store.canPostDeals();
  const mine = store.matchesForMember(me.id);
  const mineIds = new Set(mine.map(m => m.deal.id));
  const isTeased = (d) => typeof store.teased === 'function' && store.teased(d);
  const teasedWeeks = store.liveDeals().filter(isTeased).sort((a, b) => String(a.dropAt).localeCompare(String(b.dropAt)));
  const posted = store.liveDeals().filter(d => !mineIds.has(d.id) && !isTeased(d));
  const watching = store.watchesFor(me.id).length;
  const watches = store.watchesFor(me.id);
  const matchFor = (d) => watches.map(w => store.dealMatchesWatch(d, w)).find(Boolean) || null;
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <header class="masthead">
        <p class="eyebrow">${icon('trend')}The board · <span class="num" id="count">…</span></p>
        <h1>Cheapest a night, <em class="ac">first</em>.</h1>
        <p class="dateline" id="asof">Looking at what owners have open…</p>
        <div class="small muted" id="reach" hidden></div>
        <div class="small" id="no-interval" hidden></div>
        ${canEdit ? `<div class="row no-print"><button class="btn sm" id="paste">${icon('copy', { size: 16 })}Paste a listing</button>
          <button class="btn ghost sm" id="post">${icon('plus', { size: 16 })}By hand</button></div>` : ''}
      </header>
      <div id="board"></div>
      <div id="mine"></div>
      <div id="cover" style="margin-top:22px"></div>
      <div id="soon"></div>
      <div id="deals"></div>
      <div id="places"></div>
      <p class="tiny muted" id="colophon" style="margin-top:34px" hidden></p>
      <div class="rule-block">
        <p class="small muted">Want something that is not here?</p>
        <div class="row">
          <a class="link-rule" href="#/watching">Tell the Desk what to watch for${watching ? ` · <b class="num">${watching}</b> watching` : ''}</a>
          <a class="link-rule" href="#/cruises">Cruises and trips</a>
          <a class="link-rule" href="#/rules">How it works</a>
        </div>
      </div>
    </div></section></div>`);

  // THE BOARD — the weeks Victor has lined up for the next opening. Names only until the hour,
  // which is the whole point: forty people spend the evening guessing at six places. It claims
  // nothing (no price, no dates, no "available"), and it needs no scheduler — when the clock
  // passes dropAt these rows simply stop being teased and join the board below.
  if (teasedWeeks.length) {
    const boardSlot = wrap.querySelector('#board');
    const when = dropWhen(teasedWeeks[0].dropAt);
    boardSlot.appendChild(el(`<div class="running-head"><h2>${icon('zap')}The Board</h2>
      <p class="eyebrow">${teasedWeeks.length} week${teasedWeeks.length === 1 ? '' : 's'} · prices ${escapeHtml(when)}</p></div>`));
    dealList(boardSlot, teasedWeeks, { store, me, canEdit, first: 6, key: 'board', inPlace: false, noun: 'on the board' });
  }

  if (mine.length) {
    const mineSlot = wrap.querySelector('#mine');
    mineSlot.appendChild(el(`<div class="running-head"><h2>${icon('bellRing')}What you asked for</h2><p class="eyebrow">${mine.length} on the board</p></div>`));
    dealList(mineSlot, mine.map(m => m.deal).sort(byNight), { store, me, canEdit, first: 4, key: 'mine', inPlace: false, noun: 'you asked for' });
    if (store.unseenMatches(me.id).length) store.markWatchesSeen(me.id);
  }

  // Cheapest a night first, and nothing reorders it. An earlier build spread the lead across
  // places, at most two from any one of them, so the first screen was not eight identical Surf
  // Club studios — but that put a dearer week above a cheaper one, and Victor asked for the
  // opposite in plain words: "always lowest price first". The folio number and the price now
  // always agree, which is the point of a board.
  const FIRST = 9;
  const coverSlot = wrap.querySelector('#cover'), dealsSlot = wrap.querySelector('#deals'), soonSlot = wrap.querySelector('#soon');
  const count = wrap.querySelector('#count'), asof = wrap.querySelector('#asof');
  const reach = wrap.querySelector('#reach'), colophon = wrap.querySelector('#colophon');
  let drafts = [];
  let loading = true;
  const paintSoon = (list, folioOf) => {
    soonSlot.replaceChildren();
    const soon = list.filter(d => { const n = daysUntil(d.from); return n >= 0 && n <= 7; }).sort(byNight).slice(0, 4);
    if (!soon.length) return;
    soonSlot.appendChild(el(`<div class="running-head"><h2>${icon('zap')}Coming up</h2><p class="eyebrow">check in within the week · cheapest first</p></div>`));
    dealList(soonSlot, soon, { store, me, canEdit, first: 4, key: 'soon', inPlace: false, noun: 'coming up', folioOf });
  };
  // `res` is VakayMood's answer once it has one; while it is still being asked the dateline
  // says so and the colophon stays hidden, because nothing about the market is known yet.
  const paint = (res) => {
    const ranked = [...posted, ...drafts].sort(byNight);
    const folioOf = new Map(ranked.map((d, i) => [d.id, i + 1]));
    const all = ranked;
    count.textContent = `${ranked.length} open`;
    asof.innerHTML = res ? datelineOf(res, ranked.length) : 'Looking at what owners have open at the places we stay…';
    const note2 = res ? reachNote(res) : '';
    reach.hidden = !note2;
    reach.innerHTML = note2 ? `<p>${note2}</p>${retryLine()}` : '';
    // The colophon: every stamp its own nowrap span, the line free to break between them.
    const stamps = res ? [...colophonOf(res), ...madeOf(ranked)] : [];
    colophon.hidden = !stamps.length;
    colophon.innerHTML = stamps.map(t => `<span class="stamp">${t}</span>`).join(' · ');
    // Interval's Getaways are the cheapest weeks the Circle can get, and none of them arrive on
    // their own: Interval refuses the watcher's sign-in. When there is nothing from Interval on
    // the board, the Desk is told why and handed the two ways in, right where it is looking.
    const noInterval = !ranked.some(d => !d.draft && d.source === 'interval');
    const note = wrap.querySelector('#no-interval');
    if (note) {
      note.hidden = !(noInterval && canEdit && !loading);
      note.innerHTML = note.hidden ? '' : `<p>${icon('alert', { size: 15, cls: 'ico-muted' })} Nothing here is an Interval Getaway. Interval will not let the watcher sign in, so a Getaway only reaches the board when you put it there — tap Grab on the Interval page you are looking at, share one to Hunto, or paste it.</p>
        <div class="row"><a class="link-rule" href="#/desk">The Desk has the bookmark</a><button type="button" class="link-rule" id="paste-interval">Paste a Getaway</button></div>`;
    }
    paintSoon(ranked, folioOf);
    coverSlot.replaceChildren();
    dealsSlot.replaceChildren();
    if (all.length) coverSlot.appendChild(dealCover(all[0], { store, canEdit, match: matchFor(all[0]), folio: 1 }));
    const rest = all.slice(1);
    if (rest.length) {
      dealsSlot.appendChild(el(`<div class="running-head"><h2>The other ${rest.length}</h2><p class="eyebrow">cheapest a night first</p></div>`));
      dealList(dealsSlot, rest, { store, me, canEdit, first: FIRST - 1, key: 'stays', inPlace: false, noun: 'open', folioOf });
    } else if (!loading && !all.length) {
      dealsSlot.appendChild(el(`<div class="rule-block"><p class="small muted">Nothing open right now. Open a place below and put your dates in — Victor prices any nights.</p><a class="link-rule" href="#/watching">Set a watch and hear the moment something opens</a></div>`));
    }
  };
  const load = () => {
    loading = true;
    paint(null);
    openWeeks(store).then(res => { drafts = res.deals.filter(d => !mineIds.has(d.id)); loading = false; paint(res); });
  };
  load();
  wireDealActions(wrap, store, { drafts: () => drafts });
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-act="retry-open"]')) load(); });
  wrap.querySelector('#post')?.addEventListener('click', () => postDealSheet({ store }));
  wrap.querySelector('#paste')?.addEventListener('click', () => pasteListingSheet({ store }));
  wrap.addEventListener('click', (e) => { if (e.target.closest('#paste-interval')) pasteListingSheet({ store }); });
  // Shared to the app from the phone (a Getaway copied off Interval, a RedWeek listing): the
  // share landed the text in sessionStorage on the way in, and the paste sheet opens on it.
  if (query.paste && canEdit) {
    let raw = '';
    try { raw = sessionStorage.getItem('hunto.share') || ''; sessionStorage.removeItem('hunto.share'); } catch { /* private mode: nothing to open */ }
    if (raw) setTimeout(() => pasteListingSheet({ store, prefill: { raw } }), 50);
  }

  // The index: every place, one row, where we actually stay first, then by price. For a member
  // who wants a place on their own dates rather than a week somebody else has open.
  const placesSlot = wrap.querySelector('#places');
  // The index used to print "from $155 a night" against all twenty-three places, sorted by that
  // figure. But the figure is the Circle's own rate card, not a week anybody can have: eighteen of
  // the twenty-three have nothing open at all. A price on a place with no week behind it is the
  // same overclaim as a coverage figure the bank never confirmed — it reads as an offer and it is
  // not one. So the index splits: what is genuinely open, priced off the cheapest REAL week; and
  // the rest of the island, with no number at all and the one honest verb, which is to ask.
  const cheapestOpen = new Map();
  for (const d of store.liveDeals()) {
    // A week whose board has not opened is not open, and pricing the index off it would both
    // overclaim and give away the number the whole ritual exists to hold back.
    if (isTeased(d)) continue;
    const per = nightly(d);
    if (!per) continue;
    const had = cheapestOpen.get(d.stayId);
    if (!had || per < had) cheapestOpen.set(d.stayId, per);
  }
  const all = store.arubaStays().slice();
  const open = all.filter(st => cheapestOpen.has(st.id))
    .sort((a, b) => cheapestOpen.get(a.id) - cheapestOpen.get(b.id));
  const rest = all.filter(st => !cheapestOpen.has(st.id))
    .sort((a, b) => (b.house ? 1 : 0) - (a.house ? 1 : 0) || a.name.localeCompare(b.name));

  if (open.length) {
    placesSlot.appendChild(el(`<div class="running-head"><h2>Open now · ${open.length}</h2><p class="eyebrow">cheapest week on the board · a night, all in</p></div>`));
    const idx = el('<div class="index"></div>');
    for (const st of open) idx.appendChild(el(`<a class="index-row" href="#/stays/${escapeHtml(st.id)}">
        <span class="name">${escapeHtml(st.name)}<span class="meta">${st.house ? '<span class="house">where we stay</span>' : ''}<span class="beach">${escapeHtml(st.area)}</span></span></span>
        <span class="from"><b class="num">${escapeHtml(usdFrom(cheapestOpen.get(st.id), s.pointsPerDollar))}</b></span></a>`));
    placesSlot.appendChild(idx);
  }

  if (rest.length) {
    placesSlot.appendChild(el(`<div class="running-head"><h2>${open.length ? `The rest of the island · ${rest.length}` : `The places · ${rest.length}`}</h2>
      <p class="eyebrow">nothing on the board today · Victor prices these on your dates</p></div>`));
    const idx = el('<div class="index quiet-index"></div>');
    for (const st of rest) idx.appendChild(el(`<a class="index-row" href="#/stays/${escapeHtml(st.id)}">
        <span class="name">${escapeHtml(st.name)}<span class="meta">${st.house ? '<span class="house">where we stay</span>' : ''}<span class="beach">${escapeHtml(st.area)}</span></span></span>
        <span class="from" aria-hidden="true">${icon('chevronRight', { size: 15 })}</span></a>`));
    placesSlot.appendChild(idx);
  }
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
  const n = sailings.length;
  // A one-word title takes no italic accent; the dateline carries the count in the mono face.
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <header class="masthead">
        <p class="eyebrow">Interval International · a cabin for the week</p>
        <h1>Cruises</h1>
        <p class="dateline"><b class="num">${n}</b> sailing${n === 1 ? '' : 's'} on the board</p>
      </header>
      <p class="lede" style="margin-top:22px">Interval trades a deposited week for a cabin; Victor posts the sailings worth it and books yours in your name.</p>
      <div class="stack" id="list" style="margin-top:22px"></div>
      ${n ? '' : `<div class="empty"><b>No cruise on the board yet</b><p class="small muted">Victor posts one when Interval has a sailing worth it.</p><a class="link-rule" href="#/watching">Set a watch and hear first</a></div>`}
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
      ${(t.cruise?.ports || []).length >= 2 ? `<span class="small muted" style="margin-top:4px">${escapeHtml(t.cruise.ports.join(' · '))}</span>` : ''}
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
      <h2><span class="num">${trips.length}</span> trip${trips.length === 1 ? '' : 's'}, a seat each</h2>
      <p class="small muted">A seat covers the hotels and every transfer on the ground; flights to and from Aruba are extra unless the note says otherwise.</p></div></div>`));
    const grid = el('<div class="stack"></div>');
    grid.replaceChildren(...trips.map(card));
    slot.appendChild(grid);
  } else wrap.querySelector('#trips').remove();
  return wrap;
}

/**
 * A photograph's credit keeps one link — the first, the photographer's page — and says the rest
 * (the licence, the archive) in words. Two links on one 13px line would give the phone two
 * overlapping 44px hit boxes; one link gets the whole line. photoCredit's html is already escaped.
 */
function oneLinkCredit(credit) {
  if (!credit) return null;
  const m = credit.html.match(/^([\s\S]*?)<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>([\s\S]*)$/);
  if (!m) return { text: credit.text };
  const plain = (h) => h.replace(/<a [^>]*>([\s\S]*?)<\/a>/g, '$1');
  return { lead: plain(m[1]), link: { href: m[2], label: plain(m[3]) }, tail: plain(m[4]) };
}

/**
 * Against the published rate, as one ruled line: the saving in the favour colour, every figure
 * in the mono face, and honest in both directions — an "over" says so.
 */
function versusRule(v, unit = 'a night') {
  if (!v) return '';
  const pub = `<b class="num">${escapeHtml(fmtUsd2(v.publicUsd))}</b>`, diff = `<b class="num">${escapeHtml(fmtUsd2(v.diffUsd))}</b>`;
  if (v.same) return `<p class="rule-block small muted">Level with the published ${pub} ${escapeHtml(unit)}. What you are buying here is the booking being done for you.</p>`;
  if (v.better) return `<p class="rule-block small"><b class="num pos">${escapeHtml(fmtUsd2(v.diffUsd))}</b> under the published ${pub} ${escapeHtml(unit)} · <b class="num">${v.pct}%</b> off, all in.</p>`;
  return `<p class="rule-block small muted">Above the published ${pub} ${escapeHtml(unit)} by ${diff} at today’s board rate. Ask anyway: what Victor quotes is the rate he finds on the day, and this is the one we publish in advance and do not move.</p>`;
}

export function stayDetail({ store, params, go, query = {} }) {
  const me = store.me, s = store.settings;
  const stay = store.stay(params.id);
  if (!stay) return el('<div class="wrap sec"><h1>That place is not on the list</h1><p class="lede" style="margin-top:10px">It may have been retired.</p><a class="link-rule" href="#/stays">Back to the stays</a></div>');
  const isTrip = stay.kind === 'trip';
  const avail = store.availablePoints(me.id);
  const tier = tierFor(s, me.monthlyUsd);
  const place = isTrip ? null : PLACES[seedIdOf(stay)] || null;
  const photo = isTrip ? null : photoFor(stay);
  const credit = photo ? photoCredit(stay) : null;
  // The page opens on the week the member tapped: ?from/?to price those nights below, and ?deal
  // pins that week at the top of "Open right now". Nothing here is trusted past its shape.
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const cameFrom = isDate(query.from) && isDate(query.to) && Date.parse(query.to) > Date.parse(query.from) ? { from: query.from, to: query.to } : null;
  const pinId = typeof query.deal === 'string' ? query.deal.slice(0, 80) : null;
  // One sentence of the place's own description at the top; the rest of it stays on the card.
  const lede = (() => { const v = String(stay.vibe || '').trim(); const m = v.match(/^(.{20,}?[.!?])(\s|$)/); return m ? m[1] : v; })();
  const eyebrow = `${escapeHtml(stay.area)}${stay.country !== 'Aruba' ? `, ${escapeHtml(stay.country)}` : ''}${isTrip ? '' : ` · ${stay.onSand ? 'on the sand' : 'across the road'}`}${stay.house ? ' · <span class="house">where we stay</span>' : ''}`;
  const fromLine = isTrip ? `${escapeHtml(usdFrom(seatPoints(stay, s), s.pointsPerDollar))} a ${unitWord(stay)} · all in` : `from ${escapeHtml(usdFrom(fromPoints(stay, s), s.pointsPerDollar))} a night · all in`;
  // The name on the picture, the picture edge to edge on a phone: the page opens on the place,
  // not on a heading about it. A place with no photograph opens as a masthead instead — never on
  // a beach standing in for a hotel, and never on a drawing pretending to be one.
  // The credit line carries exactly one link — the photographer's page — so its 44px hit box
  // (app.css `.credit a`) never overlaps another; the licence is named in words beside it.
  const creditLine = (c) => {
    if (!c) return '';
    const one = c.link ? `${c.lead}<a href="${c.link.href}" target="_blank" rel="noopener noreferrer">${c.link.label} ↗</a>${c.tail}` : escapeHtml(c.text);
    return `<p class="tiny muted credit">${one}</p>`;
  };
  const head = photo
    ? `<figure class="hero-place" id="stay-hero">
        <figcaption class="on"><p class="eyebrow">${eyebrow}</p><h1>${escapeHtml(stay.name)}</h1><span class="from num">${fromLine}</span></figcaption>
        <button type="button" class="share" id="share" aria-label="Share ${escapeHtml(stay.name)}">${icon('share', { size: 18 })}</button>
      </figure>${creditLine(oneLinkCredit(credit))}`
    : `<div class="masthead"><p class="eyebrow">${eyebrow}</p><h1>${escapeHtml(stay.name)}</h1><p class="dateline">${fromLine}</p></div>
      ${isTrip ? '<div class="stay-card daylight" id="stay-hero" style="margin-top:18px;border-radius:var(--r-card)"><span class="strip"></span></div>' : ''}
      <button type="button" class="link-rule" id="share">${icon('share', { size: 16 })}Share</button>`;
  // Order: the place, its price on your dates, what is open, the rooms, where it is, what it
  // publishes, where the number came from, the Desk's note — and the one action docked last.
  const wrap = el(`<div><section class="sec"><div class="wrap">
      ${head}
      <p class="lede" style="margin-top:14px">${escapeHtml(lede)}</p>
      <div class="row" style="margin-top:12px">${(stay.features || []).map(f => `<span class="tag">${escapeHtml(f)}</span>`).join('')}</div>
      <div class="panel" id="pricing" style="margin-top:22px"></div>
      <div id="open"></div>
      <div id="rooms"></div>
      <div id="where"></div>
      <div id="place"></div>
      ${isTrip ? (safeUrl(stay.cruise?.ref) ? `<p class="tiny muted credit" style="margin-top:16px">Seen on <a href="${escapeHtml(safeUrl(stay.cruise.ref))}" target="_blank" rel="noopener noreferrer">Interval ↗</a> — Victor confirms the sailing and the cabin before he quotes anyone.</p>` : '') : (() => {
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
        const host = site ? new URL(site).host.replace(/^www\./, '') : '';
        const siteLine = site ? `<a class="link-rule" href="${escapeHtml(site)}" target="_blank" rel="noopener noreferrer">Their own page · ${escapeHtml(host)} ↗</a>` : '';
        // Ledger rows, not a table: what = the source and its note; delta = the figure and when it was seen.
        return `<details class="fineprint" style="margin-top:16px"><summary>Where this price comes from</summary>
          ${rows.length ? `
            <p class="small muted" style="margin-top:6px">What the public sites were asking for a week here, the last time anyone looked. Interval is surplus inventory so it is not always there, and an owner on RedWeek sometimes beats it.</p>
            <ul class="ledger" style="margin-top:12px">
              ${rows.map(([where, usd, on, note, best]) => `<li><span class="what"><b>${escapeHtml(where)}${best ? ' <span class="tag house">usually cheapest</span>' : ''}</b>${note ? `<span class="meta">${escapeHtml(note)}</span>` : ''}</span>
                <span class="delta"><b class="num">${escapeHtml(fmtUsd2(usd))}</b><small>${on ? `seen ${escapeHtml(fmtDay(on))}` : 'undated'}</small></span></li>`).join('')}
              <li><span class="what"><b>The resort</b><span class="meta">Booking direct, for comparison</span></span>
                <span class="delta"><b class="num">${escapeHtml(fmtUsd2(stay.retailUsd || 0))}</b></span></li>
            </ul>
            <p class="tiny ${stale ? '' : 'muted'}" style="margin-top:10px">${stale
              ? `Last checked <b class="num">${daysOld}</b> days ago — old enough to have moved. Victor re-checks before he quotes you.`
              : 'A night. These move; the number you are quoted is the one Victor actually finds on the day.'}</p>
            ${siteLine}`
          : `<p class="small muted" style="margin-top:6px">Nobody has checked this one against the booking sites yet, so the rate above is the Circle&rsquo;s own negotiated number and nothing else. Victor checks Interval and RedWeek before he books, and what he finds goes here.</p>
             ${site ? `<p class="small muted" style="margin-top:10px">What their own page is asking today is the number to beat.</p>${siteLine}` : ''}`}
        </details>`;
      })()}
      ${stay.dealNote ? `<div class="panel flat" style="margin-top:16px"><p class="eyebrow">From Victor</p><p class="small" style="margin-top:8px">${escapeHtml(stay.dealNote)}</p></div>` : ''}
      <div class="act-bar"><button type="button" class="btn block" data-act="ask">${icon('send', { size: 17 })}<span>${isTrip ? `Ask for a ${unitWord(stay)}` : 'Ask for these dates'}</span><span aria-hidden="true">·</span><b class="num" id="ask-fig"></b></button></div>
    </div></section></div>`);
  // The docked Ask: one button, the figure inside it, going where the pricing block points.
  // drawQuote() below rewrites `askPath` and #ask-fig every time the dates change.
  let askPath = `/book/${stay.id}`;
  wrap.querySelector('[data-act="ask"]').addEventListener('click', () => go(askPath));
  const askFig = wrap.querySelector('#ask-fig');

  // The picture: the place's photograph inside the hero figure, under the name; a trip keeps its
  // drawing in the daylight strip. The photograph's credit sits under the figure, because the
  // licence asks for it and because "the beach at the door" must be said in words.
  {
    const hero = wrap.querySelector('#stay-hero');
    if (hero && photo) hero.prepend(stayStrip(stay));
    else if (hero && isTrip) hero.querySelector('.strip').appendChild(stayStrip(stay));
  }

  // The rooms, with the property's own photographs of each — every one on file, not a thumbnail
  // — and the island with the place on it. Victor: "more pictures of the rooms on each package,
  // how they look, a map". What is not on file is said to be missing, by name, and the Desk gets
  // a button to add photographs it holds the rights to.
  if (!isTrip) {
    const canEdit = store.hasRole('planner', 'comms', 'admin');
    // A room is called what the property calls it. This page used to cut every name at the first
    // comma or dash and group what was left, because the Surf Club once listed thirteen rows for
    // four units — Gardenview, Oceanfront, Oceanside, Oceanview — and promised views the Desk
    // cannot honour. That job now belongs to roomsFromUnits (rooms.js), which groups by the unit
    // name VakayMood files ("Studio", "1 Bedroom"); the cut merged nothing any more and only
    // renamed rooms: RIU's "Superior Jr. Suite with sea view - Elite Club" lost the paid tier,
    // Divi's "Pool View room, two beds" lost its beds, and the "Ask for the ..." link then sent
    // the Desk a room the property does not publish. Print the published name, whole.
    const rooms = roomsOf(stay, place);
    const pics = roomPhotosFor(stay, place);
    const property = pics.filter(ph => ph.kind === 'property');
    const plans = pics.filter(ph => ph.kind === 'plan').length;
    // Where the resort publishes no room list a program may read, the sizes come from the units
    // owners hold there. The section says so rather than passing them off as the resort's own.
    const fromUnits = rooms.some(r => r.fromUnits);
    const vm = (place?.sources || []).find(x => x.kind === 'vakaymood');
    const site = safeUrl(stay.site);
    const host = site ? new URL(site).host.replace(/^www\./, '') : '';
    const chain = /marriott\.com/.test(site || '') ? 'Marriott' : /hilton\.com/.test(site || '') ? 'Hilton' : /hyatt\.com/.test(site || '') ? 'Hyatt' : null;
    const roomsSlot = wrap.querySelector('#rooms');
    // The strip shows the thumbnail the dossier ships. It used to swap in the full-size file on
    // the grounds that "the thumb was cut for a 44px square" — never true of the asset: the 111
    // thumbs are 360-640px wide, cut for this tile. The swap put 1.79 MB of photographs on a
    // member's phone on one stay page before a scroll (Divi); the thumbs are 582 KB. Where a
    // thumb is only 360px it is soft in a 300px tile on a 2x screen — that is the asset's fault,
    // and its answer is a srcset on the tile in rooms.js or thumbs cut at 900px, not the 1200px
    // file for every tile on every phone. Tapping a tile still opens the full-size picture.
    const vmUrl = vm ? safeUrl(vm.url) : null;
    roomsSlot.innerHTML = `<section class="rooms" id="the-rooms">
      <div class="running-head"><h2>The rooms</h2><p class="eyebrow">${pics.length
        ? `<span class="num">${pics.length}</span> picture${pics.length === 1 ? '' : 's'}${plans ? ` · <span class="num">${plans}</span> plan${plans === 1 ? '' : 's'}` : ''}`
        : fromUnits ? 'the sizes owners have here' : 'as the property lists them'}</p></div>
      ${rooms.map((r, i) => `<article class="room" data-room="${i}">
        ${r.photos.length ? galleryStrip(r.photos, { room: i }) : ''}
        <div class="room-head"><h3>${escapeHtml(r.name)}</h3>${r.bits.length ? `<span class="meta num">${escapeHtml(r.bits.join(' · '))}</span>` : ''}</div>
        ${r.description ? `<p class="small muted">${escapeHtml(r.description)}</p>` : ''}
        ${r.unnamed ? '' : `<a class="link-rule" href="#/book/${escapeHtml(stay.id)}?note=${encodeURIComponent(`The ${r.name}, if there is one.`)}">Ask for the ${escapeHtml(r.name)}</a>`}
      </article>`).join('')}
      ${property.length ? `<article class="room" data-room="property">${galleryStrip(property, { room: 'property' })}<div class="room-head"><h3>The property</h3><span class="meta"><span class="num">${property.length}</span> photograph${property.length === 1 ? '' : 's'}</span></div></article>` : ''}
      ${!pics.length || fromUnits ? `<details class="fineprint" style="margin-top:10px"><summary>${pics.length ? 'Where these sizes come from' : 'Why there are no room photographs yet'}</summary>
        ${!pics.length ? `<p class="small muted">No photographs of the rooms yet. ${chain ? `${chain} does not let a program copy its pictures, and the Circle does not take what it has not been given.` : 'The property’s own pictures are its copyright, and the Circle does not take what it has not been given.'}</p>
          ${site ? `<p class="tiny muted credit">The rooms are on <a href="${escapeHtml(site)}" target="_blank" rel="noopener noreferrer">${escapeHtml(host)} ↗</a>.</p>` : ''}` : ''}
        ${fromUnits ? `<p class="small muted">${escapeHtml(stay.name)} publishes no room list a program may read, so these are the sizes owners actually hold here. Where owners differ, the range is shown rather than one of them.</p>
          <p class="tiny muted credit">From ${vmUrl ? `<a href="${escapeHtml(vmUrl)}" target="_blank" rel="noopener noreferrer">VakayMood’s resort page ↗</a>` : 'VakayMood’s resort page'}${vm?.seenOn ? `, seen ${escapeHtml(fmtDay(vm.seenOn))}` : ''}.</p>` : ''}
      </details>` : ''}
      ${canEdit ? `<p style="margin-top:12px"><button type="button" class="btn ghost sm" data-act="room-photos">${icon('camera', { size: 15 })}Add room photographs</button></p>` : ''}
      ${pics.length ? `<p class="tiny muted" style="margin-top:12px">${pics.every(ph => ph.own)
        ? 'Photographs the Circle holds the rights to; each carries the note saying where it came from.'
        : 'The property’s own pictures, shown so you know the room you are asking for; each carries the page and the day it was seen. They are the property’s copyright.'}${pics.some(ph => ph.own) && !pics.every(ph => ph.own) ? ' The ones marked Ours are the Circle’s.' : ''}</p>` : ''}
    </section>`;
    roomsSlot.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-photo]');
      if (t) {
        const key = t.closest('[data-room]')?.dataset.room;
        const list = key === 'property' ? property : rooms[Number(key)]?.photos || pics;
        const i = Number(t.dataset.photo);
        roomPhotoSheet(key === 'property' ? stay.name : rooms[Number(key)]?.name || stay.name, [list[i], ...list.filter((_, j) => j !== i)]);
        return;
      }
      if (e.target.closest('[data-act="room-photos"]')) {
        const { roomPhotosSheet } = await import('./officer.js');
        const done = await roomPhotosSheet(store, stay, { rooms: rooms.map(r => r.name) });
        if (done) go(location.hash.slice(1) || `/stays/${stay.id}`, { replace: true });
      }
    });

    // Where it is: the island, drawn, with this place on it and the others we stay at as faint
    // dots; the address as the property publishes it; the map app; the resort's own site for
    // room plans and the resort map, where it publishes them — never fetched, only linked.
    const seed = seedIdOf(stay);
    const others = Object.entries(PLACES).filter(([k, p]) => k !== seed && p.geo).map(([, p]) => ({ geo: p.geo }));
    const mapsHref = place?.geo ? `https://maps.apple.com/?q=${encodeURIComponent(stay.name)}&ll=${place.geo.lat},${place.geo.lng}` : `https://maps.apple.com/?q=${encodeURIComponent(`${stay.name}, ${stay.area}, Aruba`)}`;
    wrap.querySelector('#where').innerHTML = `<section class="where">
      <div class="running-head"><h2>Where it is</h2><p class="eyebrow">${escapeHtml(stay.area)} · ${stay.onSand ? 'on the sand' : 'across the road'}</p></div>
      <div class="island-wrap">${islandSvg({ here: place?.geo || null, area: stay.area, label: stay.name, others })}</div>
      <p class="tiny muted credit" style="margin-top:10px">${place?.address ? `${escapeHtml(place.address)} · ` : ''}<a href="${escapeHtml(mapsHref)}" target="_blank" rel="noopener noreferrer">Open in Maps ↗</a>${place?.geo ? '' : ' · the mark is the beach, not the door: we have no position on file for this one'}.</p>
      ${site ? `<p class="tiny muted" style="margin-top:10px">Room plans and the resort map are on the property's own site, where it publishes them.</p>
      <a class="link-rule" href="${escapeHtml(site)}" target="_blank" rel="noopener noreferrer">${escapeHtml(host)} ↗</a>` : ''}
    </section>`;
  } else { wrap.querySelector('#rooms').remove(); wrap.querySelector('#where').remove(); }

  // What the place publishes about itself: address, phone, check-in, what is on site. Every fact
  // comes from the property's own site or, for the timeshare resorts whose sites refuse a scripted
  // fetch, from VakayMood's resort page — and the panel says which. Nothing typed in, nothing inferred.
  if (place) {
    const groups = [['onsite', 'On site'], ['services', 'Services'], ['nearby', 'Nearby']].filter(([k]) => (place.amenities?.[k] || []).length);
    const allAmen = groups.flatMap(([k, label]) => (place.amenities[k]).map(a => ({ a, label })));
    // The address is words here (Open in Maps is the link, one section up); the phone is the one
    // link in the list, so its 44px hit box has nothing to overlap.
    const facts = [];
    if (place.address) facts.push(`${icon('mapPin', { size: 14, cls: 'ico-muted' })} ${escapeHtml(place.address)}`);
    if (place.phone) facts.push(`${icon('phone', { size: 14, cls: 'ico-muted' })} <a href="tel:${escapeHtml(place.phone.replace(/[^+\d]/g, ''))}">${escapeHtml(place.phone)}</a>`);
    if (place.checkIn || place.checkOut) facts.push(`${icon('clock', { size: 14, cls: 'ico-muted' })} ${place.checkIn ? `check-in <span class="num">${escapeHtml(place.checkIn)}</span>` : ''}${place.checkIn && place.checkOut ? ' · ' : ''}${place.checkOut ? `check-out <span class="num">${escapeHtml(place.checkOut)}</span>` : ''}`);
    if (place.policies?.children != null || place.policies?.dogs != null) facts.push(`${icon('users', { size: 14, cls: 'ico-muted' })} ${[place.policies.children === true ? 'children welcome' : place.policies.children === false ? 'adults only' : '', place.policies.dogs === false ? 'no dogs' : place.policies.dogs === true ? 'dogs allowed' : ''].filter(Boolean).join(' · ')}`);
    const SHOW = 10;
    const srcLines = (place.sources || []).map(x => `<p class="tiny muted credit"><a href="${escapeHtml(x.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(x.label)} ↗</a>, seen ${escapeHtml(fmtDay(x.seenOn))}</p>`).join('');
    wrap.querySelector('#place').innerHTML = `<details class="fineprint" style="margin-top:16px"><summary>About the place</summary><section id="the-place">
      <p class="small" style="margin-top:6px"><b>What ${escapeHtml(stay.name)} publishes about itself</b></p>
      ${facts.length ? `<ul class="facts credit" style="margin-top:10px">${facts.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
      ${allAmen.length ? `<div class="flags" id="amen" style="margin-top:14px">${allAmen.slice(0, SHOW).map(({ a, label }) => `<span class="tag" title="${escapeHtml(label)}">${escapeHtml(a)}</span>`).join('')}
        ${allAmen.length > SHOW ? `<button type="button" class="btn ghost sm" id="amen-more">All ${allAmen.length} on the list</button>` : ''}</div>` : ''}
      ${!facts.length && !allAmen.length ? `<p class="small muted" style="margin-top:8px">Nothing this place publishes in a form we can read yet.</p>` : ''}
      <p class="tiny muted" style="margin-top:12px">Facts and pictures from:</p>${srcLines}
      <p class="tiny muted">What is not stated there is not stated here.</p>
    </section></details>`;
    wrap.querySelector('#place').addEventListener('click', (e) => {
      if (e.target.closest('#amen-more')) {
        wrap.querySelector('#amen').innerHTML = allAmen.map(({ a, label }) => `<span class="tag" title="${escapeHtml(label)}">${escapeHtml(a)}</span>`).join('');
      }
    });
  } else {
    wrap.querySelector('#place')?.remove();
  }

  // What is open here right now: what the Desk has posted for this place, and what owners have
  // open on VakayMood where it carries this resort — one list, cheapest a night first, the same
  // rows as the board. First, because it is what a member came for; the week they tapped, first
  // of all.
  let pinned = null;      // the week the member tapped through on, once it is in the list
  let onPinned = null;    // the pricing block's redraw, so its Ask button gains the week's link
  {
    const resort = isTrip ? null : resortForStay(store, stay);
    const posted = store.liveDeals().filter(d => d.stayId === stay.id);
    if (resort || posted.length) {
      const panel = el(`<section class="panel" style="margin-top:22px" id="open-now">
        <div><p class="eyebrow">${icon('trend')}Open right now</p>
          <h2 style="margin-top:6px" id="open-h"></h2>
          <p class="small muted" id="open-sub" style="margin-top:6px"></p>
          <div id="open-retry" hidden></div></div>
        <div id="open-list" style="margin-top:12px"></div>
      </section>`);
      wrap.querySelector('#open').appendChild(panel);
      let drafts = [];
      let loading = !!resort;
      const paint = (sub, retry = false) => {
        const slot = panel.querySelector('#open-list'); slot.replaceChildren();
        const all = [...posted, ...drafts].sort(byNight);
        const was = pinned;
        pinned = pinId ? all.find(d => d.id === pinId) || null : null;
        // The board's link arrives before VakayMood answers, so the quote above is drawn without
        // the week it came from. When the week turns up, the docked Ask is rebuilt with it.
        if (pinned && pinned !== was) onPinned?.();
        panel.querySelector('#open-h').innerHTML = all.length ? `<span class="num">${all.length}</span> open at ${escapeHtml(stay.name)}` : loading ? `Looking at what is open at ${escapeHtml(stay.name)}…` : `Nothing open at ${escapeHtml(stay.name)} right now`;
        panel.querySelector('#open-sub').innerHTML = `${sub} Cheapest a night first; ask for one and Victor books it in your name.`;
        const retrySlot = panel.querySelector('#open-retry');
        retrySlot.hidden = !retry; retrySlot.innerHTML = retry ? retryLine() : '';
        if (all.length) dealList(slot, all, { store, me, canEdit: store.canPostDeals(), first: pinned ? 3 : 4, key: `stay:${stay.id}`, inPlace: true, noun: 'open', pin: pinId });
        else if (!loading) slot.innerHTML = `<p class="small muted">Put your dates in above and Victor prices them.</p><a class="link-rule" href="#/watching">Set a watch and hear the moment a week opens here</a>`;
      };
      const load = () => {
        if (!resort) { paint(''); return; }
        loading = true; paint(`${icon('refresh', { size: 14, cls: 'ico-muted' })} Looking at what owners have open…`);
        openWeeks(store, { slug: resort.slug }).then(res => { drafts = res.deals; loading = false; paint(asOfLine(res, stay.name), !!res.error); });
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
    askFig.textContent = fmtPoints(seatPoints(stay, s));
    wrap.querySelector('#pricing').innerHTML = `
      <h2><span class="num">${escapeHtml(fmtPoints(seatPoints(stay, s)))}</span> a ${unit}</h2>
      <p class="small muted" style="margin-top:4px"><b class="num">${escapeHtml(pointsUsd(seatPoints(stay, s), s.pointsPerDollar))}</b> all-in for <b class="num">${stay.nights}</b> nights · the Circle’s <b class="num">15%</b> is inside it${stay.guestCashUsd ? ` · guests pay <b class="num">${escapeHtml(fmtUsd2(stay.guestCashUsd))}</b> in cash` : ''}</p>
      <ul class="ledger" style="margin-top:14px">
        ${cr ? `<li><span class="what"><b>${escapeHtml(cr.ship || 'The ship')}</b><span class="meta">${escapeHtml([cr.line, cr.cabin].filter(Boolean).join(' · '))}</span></span></li>
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
      ${versusRule(versusPublic(stay.retailUsd, seatPoints(stay, s) / s.pointsPerDollar), `a ${unit}`)}
      ${cr && (cr.ports || []).length >= 2 ? `<div class="route" style="margin-top:16px"><p class="eyebrow">${icon('compass', { size: 14 })}The route</p>${routeSvg(cr.ports)}</div>` : ''}`;
  } else {
    // Defaults a member would plausibly want: a fortnight out, for this stay's own minimum.
    // The minimum matters — opening on two nights at a villa that only comes by the week would
    // greet everybody with a refusal.
    const today = new Date();
    const soon = new Date(today.getTime() + 14 * 864e5);
    // The day in Aruba, not the day in UTC. After 20:00 local the two differ, and a week checking
    // in today — the one the board leads with — would have been refused as already past.
    const iso = (d) => new Date(new Date(d).getTime() - 4 * 36e5).toISOString().slice(0, 10);
    const dToday = iso(today);
    const dIn = cameFrom && Date.parse(cameFrom.from) >= Date.parse(dToday) ? cameFrom.from : iso(soon);
    const dOut = cameFrom && Date.parse(cameFrom.from) >= Date.parse(dToday) ? cameFrom.to : iso(soon.getTime() + Math.max(1, stay.minNights || 1) * 864e5);
    wrap.querySelector('#pricing').innerHTML = `
      <h2>What your nights cost</h2>
      <p class="small muted" style="margin-top:6px">From <b class="num">${escapeHtml(fmtPoints(fromPoints(stay, s)))}</b> a night. Put your dates in and it prices those exact nights — the same arithmetic the Desk quotes from; the Ask below carries them.</p>
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
      const N = (v) => `<b class="num">${escapeHtml(v)}</b>`;
      // The docked Ask carries these dates (and the week they came from) and shows the figure.
      askPath = `/book/${stay.id}?from=${ci}&to=${co}${pinned && pinned.from === ci && pinned.to === co ? (pinned.draft ? (safeUrl(pinned.sourceUrl) ? `&src=${encodeURIComponent(pinned.sourceUrl)}&srcLabel=VakayMood` : '') : `&deal=${encodeURIComponent(pinned.id)}`) : ''}`;
      askFig.textContent = q.ok ? fmtPoints(q.points) : `from ${fmtPoints(fromPoints(stay, s))} a night`;
      qSlot.innerHTML = `
        <div class="notice${q.ok ? '' : ' warn'}" style="margin-top:4px">
          ${q.ok ? `<b>${N(fmtPoints(q.points))} for ${N(q.nights)} night${q.nights > 1 ? 's' : ''}</b>
            <p class="small">${N(fmtUsd2(q.points / s.pointsPerDollar))} all in — ${N(fmtUsd2(q.points / s.pointsPerDollar / q.nights))} a night on average.
            ${N(fmtPoints(q.basePoints))} is the room and ${N(fmtPoints(q.servicePoints))} is the Circle's ${N('15%')}.
            ${short ? `You are ${N(fmtPoints(short))} short — a top-up of ${N(fmtUsd2(short / s.pointsPerDollar))} in cash, at face value.` : 'Covered by the points you hold.'}</p>`
          : `<b>${escapeHtml(stay.name)} wants ${N(q.minNights)} nights for those dates</b>
            <p class="small">Most resorts ask for longer over Christmas and Carnival. Move a date, or ask anyway and Victor will tell you what he can get.</p>`}
        </div>
        ${q.ok ? versusRule(versusPublic(q.retailUsd, q.points / s.pointsPerDollar), `for ${q.nights} night${q.nights > 1 ? 's' : ''}`) : ''}
        <p class="small muted" style="margin-top:10px">${stay.taxesIncluded ? 'Taxes and breakfast are already in this.' : 'Room, taxes, service charge and resort fee are all in this.'} Victor's binding quote is usually better.</p>`;
    };
    drawQuote();
    onPinned = drawQuote;
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
    const N = (v) => `<b class="num">${escapeHtml(v)}</b>`;
    wrap.querySelector('#pricing').insertAdjacentHTML('beforeend', `<p class="small muted" style="margin-top:12px">You hold ${N(fmtPoints(avail))} — ${canCover >= min
        ? `enough for ${N(Math.min(canCover, 14))} ${unit}${canCover === 1 ? '' : 's'} here.`
        : `${N(gapUsd)} short of ${isTrip ? `a ${unit}` : `the ${N(min)}-night minimum`}${mineRow && mineRow.months > 0 ? `, about ${N(mineRow.months)} more month${mineRow.months === 1 ? '' : 's'} at your level` : ''}. Ask anyway: Victor quotes it, and ${N(gapUsd)} as a cash top-up closes the gap.`}
      ${escapeHtml(tierName(me.monthlyUsd))} can hold ${N(tier.holds)} open request${tier.holds > 1 ? 's' : ''} and book ${N(tier.windowMonths)} months ahead.</p>`);
  }
  wrap.querySelector('#share')?.addEventListener('click', () => shareText({
    title: stay.name, text: `${stay.name} — ${fmtPoints(per)} a ${unitWord(stay)} through the ${VOCAB.clubName}.`,
    url: `${location.origin}${location.pathname}#/${isCruise(stay) ? 'cruises' : isTrip ? 'trips' : 'stays'}/${stay.id}`,
  }));
  return wrap;
}

export function book({ store, params, query = {}, go }) {
  const me = store.me, s = store.settings;
  const stay = store.stay(params.id);
  if (!stay) return el('<div class="wrap sec"><h1>Nothing to request</h1><a class="link-rule" href="#/stays">Back to the stays</a></div>');
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
  // The room being asked for, in pictures, before anyone commits points: the property's own
  // photographs of the size the deal names, or of every room where it names none.
  const askRooms = (() => {
    if (isTrip) return { wanted: null, shown: [] };
    const rooms = roomsOf(stay, PLACES[seedIdOf(stay)] || null);
    const beds = fromDeal ? bedroomsOf({ unitType: fromDeal.title || '' }) : null;
    const wanted = beds == null ? null : rooms.find(r => (beds === 0 ? /studio/i.test(r.name) : new RegExp(`\\b${beds}[ -]?(bed|br\\b)`, 'i').test(r.name)) && r.photos.length) || null;
    return { wanted, shown: (wanted ? wanted.photos : rooms.flatMap(r => r.photos)).slice(0, 8) };
  })();
  const sla = tier.slaHours ?? s.slaHours;
  const minHold = s.minQuoteHours ?? 12;
  const wd = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
  const dm = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const yr = (iso) => new Date(iso + 'T12:00:00').getFullYear();
  // The ask is not a form to fill in, it is a brief to Victor: the place, the nights, who is
  // coming, a word — and, before anything is sent, what it costs and what happens next. Every
  // control here answers when touched, and every number is the mono face.
  // No box and no picture: the form is the page. The lede is one line — the place and its beach.
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">${isTrip ? 'A seat with the Circle' : 'A request to the Desk'}</p>
      <h1>${isTrip ? `Ask for a ${unit}` : 'Have Victor book it'}</h1>
      <p class="lede" style="margin-top:10px">${escapeHtml(stay.name)} · ${escapeHtml(stay.area)}${stay.country && stay.country !== 'Aruba' ? `, ${escapeHtml(stay.country)}` : ''}</p>
      <form class="ask" id="form" style="margin-top:22px">
        ${askRooms.shown.length ? `<div class="ask-rooms"><p class="eyebrow">${icon('camera', { size: 14 })}${askRooms.wanted ? `The ${escapeHtml(askRooms.wanted.name)}` : 'The rooms'}</p>
            ${galleryStrip(askRooms.shown, { room: 'ask' })}
            <p class="tiny muted" style="margin-top:6px">The property’s own photographs.</p></div>` : ''}
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
          <div class="ask-row"><span class="k">Flexible, days</span></div>
          <div class="chips four" role="radiogroup" aria-label="Flexible by, in days" data-for="flexDays">
            ${[[0, 'Exact'], [1, '±1'], [3, '±3'], [7, '±7']].map(([v, label]) => `<button type="button" class="chip-btn" data-v="${v}" aria-pressed="${wantFlex === v ? 'true' : 'false'}" aria-label="${v ? `${v} day${v > 1 ? 's' : ''} either side` : 'Exact dates'}">${label}</button>`).join('')}
          </div><input type="hidden" name="flexDays" value="${wantFlex}">
        </div>`}
        <label class="field ask-note"><span>A word for Victor</span>
          <textarea name="note" rows="2" enterkeyhint="done" placeholder="${isTrip ? 'Who is coming, anything he should know…' : 'A two-bedroom if there is one, ground floor, arriving late, celebrating something…'}">${escapeHtml(openingNote)}</textarea></label>
        <label class="ask-row ask-switch">
          <span><b>Let the Circle chip in</b><span class="small muted">Anyone can put their own points toward this one — a room you are sharing, or a gift. Theirs commit the moment they chip in and come back if it falls through.</span></span>
          <input type="checkbox" name="shared" role="switch" class="switch" aria-label="Let the Circle chip in"${wantShared ? ' checked' : ''}>
        </label>
        <div class="ask-quote" id="preview" aria-live="polite"></div>
        <ol class="steps" aria-label="What happens next">
          <li class="now"><b>You ask</b><span>dates, guests, a word for Victor</span></li>
          <li><b>Victor prices it</b><span>within <b class="num">${sla}</b> hours, all-in, in points · the quote says how long it holds, <b class="num">${minHold}</b> hours at the least</span></li>
          <li><b>You say yes</b><span>before it lapses · your points commit</span></li>
          <li><b>Victor books it</b><span>himself, in your name · then it is confirmed</span></li>
        </ol>
        <p class="small muted ask-foot">He answers within <b class="num">${sla}</b> hours${isTrip ? '' : ' with an all-in price'}. Nothing is committed until you say yes to it.
          You hold <b class="num">${escapeHtml(fmtPoints(avail))}</b> and can have <b class="num">${tier.holds}</b> open request${tier.holds > 1 ? 's' : ''} at a time as ${escapeHtml(tierName(me.monthlyUsd))}.${cameFrom ? ` ${icon('external', { size: 13, cls: 'ico-muted' })} Victor gets the ${escapeHtml(cameFrom.label)} link you were looking at.` : ''}</p>
        <div class="act-bar" style="margin-inline:0;padding-inline:0"><button class="btn block" type="submit"><span>${isTrip ? `Ask for the ${unit}` : 'Ask Victor to book it'}</span><span aria-hidden="true">·</span><b class="num" id="ask-fig"></b></button></div>
      </form>
    </div></section></div>`);
  const form = wrap.querySelector('#form'), preview = wrap.querySelector('#preview'), askFig = wrap.querySelector('#ask-fig');
  wrap.querySelector('.ask-rooms')?.addEventListener('click', (e) => {
    const t = e.target.closest('[data-photo]'); if (!t) return;
    const i = Number(t.dataset.photo); const list = askRooms.shown;
    roomPhotoSheet(askRooms.wanted ? askRooms.wanted.name : stay.name, [list[i], ...list.filter((_, j) => j !== i)]);
  });
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
    askFig.textContent = q.nights ? fmtPoints(q.points) : '';
    if (!q.nights) { preview.className = 'ask-quote'; preview.innerHTML = '<b>Pick your dates</b>'; return; }
    const short = Math.max(0, q.points - avail);
    const pctRoom = q.points ? Math.round((q.basePoints / q.points) * 100) : 100;
    const N = (v) => `<b class="num">${escapeHtml(v)}</b>`;
    preview.className = `ask-quote${q.ok ? '' : ' warn'}`;
    preview.innerHTML = q.ok
      ? `<div><span class="k">Indicative, all-in</span><b class="hero-figure" id="q-pts">${escapeHtml(fmtPoints(q.points))}</b>
           <span class="small muted mono">${escapeHtml(fmtUsd2(q.points / s.pointsPerDollar))} · ${q.nights} night${q.nights > 1 ? 's' : ''}${isTrip ? '' : ` · ${escapeHtml(fmtUsd2(q.points / s.pointsPerDollar / q.nights))} a night`}</span></div>
         <div class="ask-split" role="img" aria-label="${pctRoom}% the room, ${100 - pctRoom}% the Circle's share"><span style="width:${pctRoom}%"></span></div>
         <p class="small">${N(fmtPoints(q.basePoints))} is the room, ${N(fmtPoints(q.servicePoints))} the Circle's ${N(`${Math.round(s.serviceRate * 100)}%`)} — the only fee there is.
         ${short ? `You are ${N(fmtPoints(short))} short: a top-up of ${N(fmtUsd2(short / s.pointsPerDollar))} in cash, at face value, or let the Circle chip in.` : 'Covered by the points you hold.'}
         ${q.retailUsd ? ` Booked alone this runs about ${N(fmtUsd2(q.retailUsd))}.` : ''}</p>`
      : `<b>${escapeHtml(stay.name)} needs at least ${N(q.minNights)} nights for those dates</b>
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
  const s = store.settings;
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <h1>Your requests</h1>
      <div class="stack" id="groups" style="margin-top:20px"></div>
    </div></section></div>`);
  const groups = wrap.querySelector('#groups');
  if (!mine.length) {
    groups.appendChild(el(`<div class="empty"><b>Nothing requested</b>
      <p class="small muted">Pick a stay and tell Victor your dates — he answers within <b class="num">${s.slaHours ?? 72}</b> hours.</p>
      <a class="btn block" href="#/stays">Look at the stays</a></div>`));
    return wrap;
  }
  // Every request is one whole-row anchor, the same row as the board: the place and its dates
  // on the left, the money on the right, the state under it. A decline reason wraps in full —
  // and in the body face, not the row's mono: the rest of the sub is dates and figures, but this
  // is Victor writing to a member in sentences, and seven lines of English in the apparatus face
  // on the one row carrying bad news read like a terminal error instead of a person explaining.
  // It is set here rather than in the sheet because `.l2` also carries the board's stamps, which
  // stay mono; a `.listing-row .sub .l2` rule beside app.css:1302 would only fit if it did not.
  for (const [status, label] of GROUPS) {
    const items = mine.filter(r => r.status === status);
    if (!items.length) continue;
    groups.appendChild(el(`<div class="panel">
      <div class="row-between"><h2>${escapeHtml(label)}</h2><span class="small muted num">${items.length}</span></div>
      <div class="listing has-go" style="margin-top:10px">${items.map(r => {
        const st = store.stay(r.stayId);
        const left = r.status === 'quoted' ? countdownTo(r.quoteExpiresAt) : null;
        const pts = r.quotedPoints || r.indicativePoints || r.points;
        return `<a class="listing-row no-thumb" href="#/requests/${escapeHtml(r.id)}">
          <span class="main" style="min-width:0"><h3>${escapeHtml(st?.name || 'Stay')}</h3>
            <span class="sub">${escapeHtml(fmtDay(r.checkIn))} · ${r.nights}&nbsp;night${r.nights > 1 ? 's' : ''}${r.shared ? ` · ${(r.pledges || []).length ? `${(r.pledges || []).length} chipped in` : 'open to the Circle'}` : ''}${r.decision ? `<span class="l2" style="font-family:var(--font-body)">${escapeHtml(r.decision)}</span>` : ''}</span></span>
          <span class="price-col"><b>${escapeHtml(fmtUsd(pts / s.pointsPerDollar))}</b><small>${left ? `expires in ${escapeHtml(left)}` : escapeHtml(requestLabel(r))}</small><span class="all">${escapeHtml(fmtPoints(pts))}</span></span>
          <span class="go" aria-hidden="true">${icon('chevronRight', { size: 18 })}</span></a>`;
      }).join('')}</div></div>`));
  }
  return wrap;
}

export function requestDetail({ store, params, go, refresh }) {
  const me = store.me, s = store.settings;
  const r = store.redemption(params.id);
  if (!r) return el('<div class="wrap sec"><h1>No such request</h1><a class="link-rule" href="#/requests">Your requests</a></div>');
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

  // One column, in the order a decision is made: the money, what it means, who is chipping in,
  // the word, the Desk's look, what anyone has seen, the note, the record — and the decision
  // itself docked at the very end, the last child of the section, so it rides above the tab bar
  // the whole way down and is still under the thumb when the reader reaches the timeline.
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">${escapeHtml(stay?.area || '')} · ${escapeHtml(requestLabel(r))}</p>
      <h1>${escapeHtml(stay?.name || 'Stay')}</h1>
      <p class="dateline">${escapeHtml(fmtDay(r.checkIn))} – ${escapeHtml(fmtDay(r.checkOut))} · ${r.nights} night${r.nights > 1 ? 's' : ''} · ${r.guests} guest${r.guests > 1 ? 's' : ''}${mine ? '' : ` · ${escapeHtml(member?.name || '')}`}</p>

      <div class="stack" style="margin-top:22px">
          <div class="panel" id="money"></div>
          <div id="actions-note" class="small muted" hidden></div>
          <div id="chipin"></div>
          ${r.note ? `<div class="panel flat"><p class="eyebrow">${icon('user')}What they asked for</p><p class="small" style="margin-top:8px">${escapeHtml(r.note)}</p></div>` : ''}
          ${(() => {
            // Only the people who actually do the booking need this, and only while it is still
            // a job — once the hotel is paid the link is history, not a task.
            if (!store.canPlan?.() || ['completed', 'declined', 'cancelled', 'expired'].includes(r.status)) return '';
            const links = store.whereToBook(r.id);
            const gated = store.needsLook?.(r);
            const seen = gated ? store.lookFor?.(r.stayId, r.checkIn, r.checkOut) : null;
            return `<div class="panel boxed" style="border-color:var(--ink)">
              <p class="eyebrow">${icon('external')}Go and look</p>
              <p class="small muted" style="margin-top:6px">Open it, then say what you saw. Nothing here checks the hotel &mdash; you are the only thing that can.</p>
              ${links.length ? `<ul class="stack" style="margin-top:10px;list-style:none;padding:0;gap:10px">
                ${links.map((l, i) => `<li><a class="btn ${l.exact ? '' : 'ghost'} sm" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">
                  ${icon('external', { size: 15 })}${escapeHtml(l.label)}</a>${l.exact
                    ? '<p class="small muted" style="margin-top:4px">the listing they were looking at</p>'
                    : l.seenOn ? `<p class="small muted" style="margin-top:4px">seen ${escapeHtml(fmtDay(l.seenOn))}</p>` : ''}
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
          <div class="act-bar" id="actions"></div>
      </div>
    </div></section></div>`);

  const money = wrap.querySelector('#money');
  const pts = r.quotedPoints || r.indicativePoints || r.points;
  // Every figure in the breakdown is in the apparatus face, one at a time, with the labels left in
  // the sans — it sat directly above two mono totals and was the only sans money on the screen.
  // `span.num` and not `b.num` because `.ledger .what b` sets the body size and 600 on anything
  // bold inside the row, which blew the five figures up past their own labels.
  money.innerHTML = `
    <div class="row-between"><h2>${r.quotedPoints ? 'The quote' : 'Indicative price'}</h2>
      ${left && r.status === 'quoted' ? `<span class="chip chip-warn"><i></i>expires in <span class="num">${escapeHtml(left)}</span></span>` : ''}</div>
    <ul class="ledger" style="margin-top:10px">
      <li><span class="what"><b>${r.nights} night${r.nights > 1 ? 's' : ''} all-in</b>
        <span class="meta">${r.quoteStack ? Object.entries(r.quoteStack).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${escapeHtml(STACK_LABEL[k] || k)} <span class="num">${escapeHtml(fmtUsd2(v))}</span>`).join(' · ') : 'Room, levies, service and resort fees included'}</span></span>
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
      <div class="row-between"><h2>Everyone chipping in</h2>
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
                ? `<button class="btn ghost sm" data-unpledge="${escapeHtml(p.memberId)}">Take it back</button>` : ''}</span></li>`;
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

  // The docked decision: one filled action — the role's — last in the bar, every other action a
  // ruled link above it. The sentence that explains the decision sits under the money, in flow,
  // so the bar stays two lines tall while it rides above the tab bar.
  const actions = wrap.querySelector('#actions');
  const topUpOwed = r.status === 'held' && r.topUpUsd > 0 && !r.topUpConfirmed;
  let primary = null;
  const links = [];
  if (mine && r.status === 'quoted' && left) primary = '<button type="button" class="btn block" data-act="accept">Accept and commit the points</button>';
  if (mine && ['requested', 'quoted', 'held'].includes(r.status)) links.push('<button type="button" class="link-rule" data-act="cancel">Cancel this request</button>');
  if (canQuote && r.status === 'requested') { primary = '<button type="button" class="btn block" data-act="quote">Quote it</button>'; links.push('<button type="button" class="link-rule danger" data-act="decline">Decline</button>'); }
  if (canPay && r.status === 'held') primary = `<button type="button" class="btn good block" data-act="pay"${topUpOwed ? ' disabled' : ''}>${icon('check', { size: 16 })}I booked it — burn the points</button>`;
  if (store.canPlan?.() && r.status === 'held' && !r.approvedAt) {
    const b = 'data-act="approve">I have it — booking it</button>';
    if (primary) links.push(`<button type="button" class="link-rule" ${b}`); else primary = `<button type="button" class="btn block" ${b}`;
  }
  if (canPay && topUpOwed) links.push('<button type="button" class="link-rule" data-act="topup">Mark the top-up received</button>');
  if (mine && closed && stay && stay.kind !== 'trip') {
    // Everything they said the first time rides along, so the re-ask opens as they left it.
    const again = new URLSearchParams({ from: r.checkIn, to: r.checkOut, guests: String(r.guests || 2), flex: String(r.flexDays || 0), shared: r.shared ? '1' : '0', note: r.note || '' });
    primary = `<a class="btn block" href="#/book/${escapeHtml(stay.id)}?${escapeHtml(again.toString())}">Ask again</a>`;
  }
  if (store.hasRole('planner', 'admin') && r.status === 'confirmed') { primary = '<button type="button" class="btn block" data-act="complete">Mark as stayed</button>'; links.push('<button type="button" class="link-rule danger" data-act="cancelPaid">Cancel the booking</button>'); }
  const notes = [
    topUpOwed ? `<p class="small" style="color:var(--flag)">The hotel cannot be paid until the <b class="num">${escapeHtml(fmtUsd2(r.topUpUsd))}</b> top-up has reached the Banker. Nothing is ever booked on credit.</p>` : '',
    r.status === 'held' && mine ? `<p class="small muted">${r.approvedAt ? 'Victor has it and is booking it himself, in your name. Your points burn only when the room is his to give you.' : 'Your points are committed and Victor picks it up next. Nothing is booked until he books it himself.'}</p>` : '',
    r.status === 'quoted' && mine ? `<p class="small muted">Accepting moves <b class="num">${escapeHtml(fmtPoints(Math.min(pts, avail)))}</b> into Committed. They are still yours and still counted in the Circle’s coverage until the hotel is paid.</p>` : '',
  ].filter(Boolean);
  const noteSlot = wrap.querySelector('#actions-note');
  if (notes.length) { noteSlot.hidden = false; noteSlot.innerHTML = notes.join(''); } else noteSlot.remove();
  actions.innerHTML = `${links.join('')}${primary || ''}`;
  if (!links.length && !primary) actions.remove();

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
              <div class="sheet-actions"><button type="button" class="link-rule" data-close>Not yet</button><button class="btn danger block" data-ok>Cancel the booking</button></div>`;
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
        <div class="sheet-actions"><button type="button" class="link-rule" data-close>Not yet</button><button class="btn block" data-ok>Write it down</button></div>`;
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
        <button type="button" class="btn ghost sm" data-look="gone" data-url="${escapeHtml(l.url)}" data-label="${escapeHtml(l.label)}">It is gone</button>` : ''}</li>`).join('')}
    </ul>` : '<p class="small muted">No link on file for this one.</p>'}
    ${may ? '<p class="small" style="margin-top:8px"><button type="button" class="btn ghost sm" data-look="phone">I rang them instead</button></p>' : ''}
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
  const out = await sheet({ title: `Book ${stay?.name || 'it'} for ${first}`, render: (body, close) => {
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
        <div class="stack">
          <label class="field"><span>Hotel confirmation number</span><input name="ref" placeholder="e.g. BT-2026-4471" required autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="next"></label>
          <label class="field"><span>Paid to the hotel, US$</span><input name="paid" type="number" step="0.01" value="${owed.toFixed(2)}" inputmode="decimal" enterkeyhint="done"></label>
        </div>
        ${topUpOwed ? `<p class="small" style="color:var(--flag);margin-bottom:10px">The <b class="num">${escapeHtml(fmtUsd2(r.topUpUsd))}</b> top-up has not reached the Banker yet. Nothing is booked on credit — book it once Vishnu has it.</p>` : ''}
        <div class="sheet-actions"><button type="button" class="link-rule" data-close>Not yet</button>
          ${r.approvedAt || !canApprove ? '' : '<button type="button" class="btn ghost block" data-approve>I have it, booking later</button>'}
          <button class="btn good block" data-ok ${topUpOwed ? 'disabled' : ''}>${icon('check', { size: 16 })}I booked it — burn the points</button></div>`;
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
  // Tall, because it is the Desk's working sheet: the look, five money lines two across, the
  // arithmetic as one dateline, the terms, and Publish alone at the thumb.
  const out = await sheet({ title: `Quote ${stay?.name || 'this stay'}`, tall: true, render: (body, close) => {
    body.innerHTML = `
      ${store.needsLook?.(r) ? `<p class="eyebrow">${icon('external')}Look first</p>${lookBlock(store, r)}<p class="eyebrow" style="margin-top:18px">${icon('tag')}Then price it</p>` : ''}
      <p class="sheet-text">Type what the hotel charges. The Circle's <b class="num">${Math.round(s.serviceRate * 100)}%</b> is added on top and the member sees it as its own line. The quote holds for <b class="num">${s.quoteHours}</b> hours, or until the look it rests on goes stale — never under <b class="num">${s.minQuoteHours ?? 12}</b> — and the member sees the countdown.</p>
      <div class="pair">
        <label class="field"><span>Room total</span><input name="room" type="number" step="0.01" value="${(hotelUsd * 0.72).toFixed(2)}" inputmode="decimal"></label>
        <label class="field"><span>Taxes</span><input name="taxes" type="number" step="0.01" value="${(hotelUsd * 0.09).toFixed(2)}" inputmode="decimal"></label>
      </div>
      <div class="pair">
        <label class="field"><span>Service charge</span><input name="service" type="number" step="0.01" value="${(hotelUsd * 0.1).toFixed(2)}" inputmode="decimal"></label>
        <label class="field"><span>Resort fee</span><input name="resort" type="number" step="0.01" value="${(hotelUsd * 0.08).toFixed(2)}" inputmode="decimal"></label>
      </div>
      <label class="field"><span>Environmental levy</span><input name="env" type="number" step="0.01" value="${(r.nights * 6).toFixed(2)}" inputmode="decimal"></label>
      <p class="dateline">Hotel <b class="num" id="q-hotel">—</b> · share <b class="num" id="q-share">—</b> · quote <b class="num" id="q-total">—</b> = <b class="num" id="q-pts">—</b></p>
      <label class="field" style="margin-top:14px"><span>Hotel’s cancellation terms</span><input name="terms" value="Free cancellation up to 30 days before arrival." ></label>
      <label class="field"><span>Free-cancellation deadline</span><input name="deadline" type="date" value="${new Date(new Date(r.checkIn).getTime() - 30 * 864e5).toISOString().slice(0, 10)}"></label>
      <label class="field"><span>A line for the member</span><textarea name="note" rows="2" enterkeyhint="done" placeholder="Lagoon view, high floor — and I got the resort fee waived."></textarea></label>
      <div class="sheet-actions"><button class="btn block" data-ok>Publish the quote</button></div>`;
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
