// Deals, and the watch list that decides who hears about them.
//
// The whole point of this screen is speed. Victor sees a one-bedroom appear on Interval at
// eleven at night; by the time he has typed four fields, every Insider who asked for that
// exact thing has it on their home screen. Nothing here books anything — a deal turns into
// a request, and a request goes through the same quote the rest of the app uses.

import { escapeHtml, fmtUsd2, fmtPoints, fmtDay, fmtRelative, pointsUsd, nightsBetween } from '../core/util.js';
import { VOCAB } from '../core/vocab.js';
import { seasonPoints } from '../core/money.js';
import { icon } from '../ui/icons.js';
import { toast, sheet, confirmDialog, setBusy, avatar } from '../ui/components.js';
import { stayStrip } from './public.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };

export const SOURCES = Object.freeze({
  interval: { label: 'Interval', icon: 'refresh', note: 'An exchange or a Getaway on Interval International' },
  redweek:  { label: 'RedWeek', icon: 'tag', note: 'An owner renting their week directly' },
  iberostar:{ label: 'Iberostar', icon: 'idCard', note: 'The employee rate' },
  airbnb:   { label: 'Airbnb', icon: 'home', note: 'A whole place, usually by the week' },
  vrbo:     { label: 'Vrbo', icon: 'home', note: 'A whole place, usually by the week' },
  hotel:    { label: 'Direct', icon: 'phone', note: 'Straight from the hotel, on our rate' },
  member:   { label: 'An Insider', icon: 'users', note: 'Someone in the Circle passed it on' },
  other:    { label: 'Elsewhere', icon: 'compass', note: '' },
});

const sourceChip = (s) => {
  const src = SOURCES[s] || SOURCES.other;
  return `<span class="tag">${icon(src.icon, { size: 14 })}${escapeHtml(src.label)}</span>`;
};

/** One deal, as a card. `match` is set when it answers something this member asked for. */
export function dealCard(deal, { store, match = null, canEdit = false } = {}) {
  const stay = store.stay(deal.stayId);
  const room = store.roomType?.(deal.roomTypeId);
  const saveUsd = deal.retailUsd ? deal.retailUsd - deal.pointsTotal / store.settings.pointsPerDollar : 0;
  const node = el(`<article class="panel deal${match ? ' matched' : ''}" data-deal="${escapeHtml(deal.id)}">
      <div class="deal-strip"></div>
      <div class="deal-body">
        ${match ? `<p class="eyebrow" style="color:var(--good-text)">${icon('bellRing', { size: 15 })}You asked for this</p>` : ''}
        <div class="row-between" style="align-items:flex-start;gap:12px">
          <div>
            <h3 style="font-size:1.05rem">${escapeHtml(deal.title || stay?.name || 'A deal')}</h3>
            <p class="small muted" style="margin-top:4px">${escapeHtml(stay?.area || '')}${stay && stay.country !== 'Aruba' ? `, ${escapeHtml(stay.country)}` : ''}
              ${room ? ` · ${escapeHtml(room.name)}` : ''}</p>
          </div>
          <div style="text-align:right;flex:none">
            <b class="num" style="font-size:1.15rem">${escapeHtml(fmtPoints(deal.pointsTotal))}</b>
            <br><span class="small muted">${escapeHtml(pointsUsd(deal.pointsTotal, store.settings.pointsPerDollar))} · ${deal.nights} night${deal.nights === 1 ? '' : 's'}</span>
          </div>
        </div>
        <p class="small" style="margin-top:10px">${icon('calendar', { size: 15, cls: 'ico-muted' })}
          ${escapeHtml(fmtDay(deal.from))} – ${escapeHtml(fmtDay(deal.to))}
          ${deal.units > 1 ? ` · ${deal.units} available` : ''}</p>
        ${saveUsd > 0 ? `<p class="small" style="margin-top:6px;color:var(--good-text)">${icon('trend', { size: 15 })}About ${escapeHtml(fmtUsd2(saveUsd))} under the public rate</p>` : ''}
        ${deal.note ? `<p class="small muted" style="margin-top:10px">“${escapeHtml(deal.note)}”</p>` : ''}
        <div class="flags" style="margin-top:10px">
          ${sourceChip(deal.source)}
          <span class="tag">${icon('clock', { size: 14 })}${escapeHtml(fmtRelative(deal.postedAt))}</span>
          ${deal.expiresAt ? `<span class="tag">${icon('hourglass', { size: 14 })}until ${escapeHtml(fmtDay(deal.expiresAt))}</span>` : ''}
        </div>
        ${match && !match.affordable ? `<p class="small muted" style="margin-top:10px">${icon('spark', { size: 14 })}
          You are ${escapeHtml(fmtPoints(match.short))} short — ask anyway and close the gap with a top-up, or open it to the Circle.</p>` : ''}
        <div class="row" style="margin-top:14px">
          <a class="btn sm" href="#/book/${escapeHtml(deal.stayId)}?from=${escapeHtml(deal.from)}&to=${escapeHtml(deal.to)}&deal=${escapeHtml(deal.id)}">${icon('send', { size: 16 })}Ask for it</a>
          ${canEdit && deal.sourceUrl ? `<a class="btn ghost sm" href="${escapeHtml(deal.sourceUrl)}" target="_blank" rel="noopener noreferrer">${icon('external', { size: 16 })}Go and book it</a>` : ''}
          ${canEdit ? `<button class="btn quiet sm" data-act="retire">${icon('x', { size: 16 })}Gone</button>` : ''}
        </div>
      </div>
    </article>`);
  if (stay) node.querySelector('.deal-strip').appendChild(stayStrip(stay));
  return node;
}

/** The board: everything live, with the things you asked for pinned to the top. */
export function deals({ store, go }) {
  const me = store.me;
  const canEdit = store.canPlan() || store.hasRole('comms');
  const mine = store.matchesForMember(me.id);
  const mineIds = new Set(mine.map(m => m.deal.id));
  const rest = store.liveDeals().filter(d => !mineIds.has(d.id));

  const wrap = el(`<div><section class="sec"><div class="wrap">
      <div class="row-between">
        <div><p class="eyebrow">${icon('zap')}As they turn up</p><h1>Deals</h1>
          <p class="lede" style="margin-top:10px;max-width:60ch">Rooms that became available somewhere Victor or Ian was looking. They go as fast as they come, so anything here is worth asking about the same day.
            <b>You do not book these yourself</b> — put your points in, alone or with others, and the Circle books it in your name.</p></div>
        ${canEdit ? `<div class="row no-print"><button class="btn sm" id="post">${icon('plus', { size: 16 })}Post a deal</button></div>` : ''}
      </div>

      <div class="row" style="margin-top:18px">
        <a class="btn ghost sm" href="#/watching">${icon('bell', { size: 16 })}What you are watching${store.watchesFor(me.id).length ? ` · ${store.watchesFor(me.id).length}` : ''}</a>
      </div>

      <div id="mine" style="margin-top:22px"></div>
      <div id="all" style="margin-top:22px"></div>
    </div></section></div>`);

  const mineSlot = wrap.querySelector('#mine'), allSlot = wrap.querySelector('#all');

  if (mine.length) {
    mineSlot.appendChild(el(`<div class="sec-head"><div><p class="eyebrow" style="color:var(--good-text)">${icon('bellRing')}Matches what you asked for</p>
      <h2 style="font-size:1.2rem">${mine.length} of these ${mine.length === 1 ? 'is' : 'are'} what you are watching for</h2></div></div>`));
    const grid = el('<div class="grid g2"></div>');
    mine.forEach(m => grid.appendChild(dealCard(m.deal, { store, match: m, canEdit })));
    mineSlot.appendChild(grid);
    // Only when something is actually unseen. markWatchesSeen() commits, a commit notifies,
    // a notify re-renders, and this runs again — so keying it off mine.length (which never
    // shrinks) spun the page against the database forever the moment one deal matched.
    if (store.unseenMatches(me.id).length) store.markWatchesSeen(me.id);
  }

  allSlot.appendChild(el(`<div class="sec-head"><div><p class="eyebrow">${mine.length ? 'Everything else' : 'On the board'}</p>
    <h2 style="font-size:1.2rem">${rest.length} live right now</h2></div></div>`));
  if (rest.length) {
    const grid = el('<div class="grid g2"></div>');
    rest.forEach(d => grid.appendChild(dealCard(d, { store, canEdit })));
    allSlot.appendChild(grid);
  } else {
    allSlot.appendChild(el(`<div class="empty">${icon('compass', { size: 30, cls: 'ico-muted' })}
      <b style="display:block;margin-top:10px">Nothing on the board today</b>
      <p class="small muted">This is normal — good weeks appear and go within hours. Tell the Circle what you are after and you will hear the moment one does.</p>
      <p style="margin-top:12px"><a class="btn sm" href="#/watching">${icon('bell', { size: 16 })}Add a watch</a></p></div>`));
  }

  wrap.addEventListener('click', async (e) => {
    const retire = e.target.closest('[data-act="retire"]');
    if (retire) {
      const id = retire.closest('[data-deal]').dataset.deal;
      const yes = await confirmDialog({ title: 'Take it off the board?', confirmText: 'It is gone',
        message: 'It stays in the record, but nobody sees it as available any more.' });
      if (yes) { try { await store.retireDeal(id, store.me.id, 'Taken'); toast('Off the board.'); } catch (err) { toast(err.message, { kind: 'bad' }); } }
    }
  });
  wrap.querySelector('#post')?.addEventListener('click', () => postDealSheet({ store }));
  return wrap;
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
        <label class="field" id="room-slot" hidden><span>Which room, if it matters</span>
          <select name="roomTypeId"><option value="">Any room</option></select></label>
        <div class="grid g2">
          <label class="field"><span>From</span><input type="date" name="from" value="${escapeHtml(prefill.from || '')}" required></label>
          <label class="field"><span>To</span><input type="date" name="to" value="${escapeHtml(prefill.to || '')}" required></label>
        </div>
        <div class="grid g2">
          <label class="field"><span>All-in cost US$</span><input type="number" name="usd" step="1" min="1" inputmode="decimal" placeholder="1995"></label>
          <label class="field"><span>In points</span><input type="number" name="points" step="100" min="1" inputmode="numeric" placeholder="199500"></label>
        </div>
        <div class="grid g2">
          <label class="field"><span>Where it came from</span>
            <select name="source">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`).join('')}</select></label>
          <label class="field"><span>Public rate US$, if you know it</span><input type="number" name="retailUsd" step="1" min="0" inputmode="decimal" placeholder="2800"></label>
        </div>
        <label class="field"><span>Link to it</span><input type="url" name="sourceUrl" placeholder="https://…"></label>
        <label class="field"><span>Anything the Circle should know</span><input name="note" placeholder="Lighthouse tower, owner rental, Saturday to Saturday."></label>
        <div id="who" class="notice" style="margin-top:4px"></div>
        <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>${icon('send', { size: 16 })}Post it</button></div>`;

      const v = (n) => body.querySelector(`[name=${n}]`);
      const roomSlot = body.querySelector('#room-slot');

      // Dollars and points stay in step, the way they do everywhere else in the Desk.
      body.addEventListener('input', (e) => {
        if (e.target.name === 'usd') v('points').value = Math.round((Number(e.target.value) || 0) * s.pointsPerDollar);
        if (e.target.name === 'points') v('usd').value = ((Math.round(Number(e.target.value) || 0)) / s.pointsPerDollar).toFixed(2);
        preview();
      });

      const fillRooms = () => {
        const rooms = store.roomTypesFor?.(v('stayId').value) || [];
        roomSlot.hidden = !rooms.length;
        v('roomTypeId').innerHTML = `<option value="">Any room</option>` +
          rooms.map(r => `<option value="${escapeHtml(r.id)}"${r.id === prefill.roomTypeId ? ' selected' : ''}>${escapeHtml(r.name)}</option>`).join('');
      };
      // Say, before he posts, exactly who is about to hear about it.
      const preview = () => {
        const draft = { id: 'draft', status: 'live', stayId: v('stayId').value, roomTypeId: v('roomTypeId').value || null,
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
      body.addEventListener('change', (e) => { if (e.target.name === 'stayId') { fillRooms(); } preview(); });
      fillRooms(); preview();

      body.querySelector('[data-ok]').addEventListener('click', () => close({
        stayId: v('stayId').value, roomTypeId: v('roomTypeId').value || null,
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
    const room = store.roomType?.(w.roomTypeId);
    const hits = store.liveDeals().map(d => store.dealMatchesWatch(d, w)).filter(Boolean);
    list.appendChild(el(`<div class="panel" data-watch="${escapeHtml(w.id)}">
        <div class="row-between" style="align-items:flex-start;gap:14px">
          <div>
            <h3 style="font-size:1.05rem">${icon(stay?.kind === 'trip' ? 'plane' : 'bed', { size: 18, cls: 'ico-muted' })}
              ${escapeHtml(stay?.name || (w.kind === 'trip' ? 'Any trip' : 'Anywhere on the island'))}</h3>
            <p class="small muted" style="margin-top:6px">
              ${room ? `${escapeHtml(room.name)} · ` : ''}${w.nights} night${w.nights === 1 ? '' : 's'} between
              ${escapeHtml(fmtDay(w.from))} and ${escapeHtml(fmtDay(w.to))}${w.flexDays ? `, give or take ${w.flexDays} days` : ''}
              ${w.maxPoints ? ` · up to ${escapeHtml(fmtPoints(w.maxPoints))}` : ''}</p>
            ${w.note ? `<p class="small muted" style="margin-top:8px">“${escapeHtml(w.note)}”</p>` : ''}
          </div>
          <button class="btn quiet sm" data-act="stop">${icon('x', { size: 15 })}Stop</button>
        </div>
        ${hits.length ? `<div class="notice good" style="margin-top:12px"><b>${icon('checkCircle', { size: 16 })} ${hits.length} on the board right now</b>
           <p style="margin-top:8px"><a class="btn sm" href="#/deals">Look at ${hits.length === 1 ? 'it' : 'them'}</a></p></div>`
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
        <label class="field" id="room-slot" hidden><span>Which room</span>
          <select name="roomTypeId"><option value="">Any room there</option></select></label>
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
      const roomSlot = body.querySelector('#room-slot');
      const fillRooms = () => {
        const rooms = store.roomTypesFor?.(v('stayId').value) || [];
        roomSlot.hidden = !rooms.length;
        v('roomTypeId').innerHTML = `<option value="">Any room there</option>` +
          rooms.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}${r.sqft ? ` · ${r.sqft} sq ft` : ''}</option>`).join('');
      };
      const draw = () => {
        const stay = store.stay(v('stayId').value);
        const nights = Number(v('nights').value) || 1;
        const avail = Math.max(0, store.availablePoints(store.me.id));
        const likely = stay && stay.kind !== 'trip' ? seasonPoints(stay, 'low', s) * nights : stay?.pointsPerSeat || 0;
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
      body.addEventListener('change', (e) => { if (e.target.name === 'stayId') fillRooms(); draw(); });
      fillRooms(); draw();

      body.querySelector('[data-ok]').addEventListener('click', () => close({
        stayId: v('stayId').value || null, roomTypeId: v('roomTypeId').value || null,
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
