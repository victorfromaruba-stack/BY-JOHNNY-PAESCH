// Postcards: one picture from the island, sent to the people at home.
//
// The ritual is BeReal's, re-anchored to a fact the club already holds: a member's own approved
// booking says which day of which stay they are on, so "DAY 2 OF 4 · MANCHEBO" is something the
// server established, not something typed. Everything else printed here follows the same rule —
// the sent time is the row's clock time under a day rule recomputed on render (never "3 min
// ago"), the taken time follows the row's `takenFrom`, and the caption is the member's own words
// set in the sans so the two registers say which is which. Nothing is ever printed on the
// photograph. No comments: the crew thread is where a picture gets talked about.
//
// The view is a pure function of state. The app re-renders the route on every store commit, so a
// Cheers, a take-back or a new postcard redraws the whole screen; the in-place updates below are
// only so a tap answers before the round trip does.
import { arubaDate, fmtClock, dayRule, postmarkLabel, fmtDay, escapeHtml } from '../core/util.js';
import { readPostcard } from '../core/image.js';
import { VOCAB } from '../core/vocab.js';
import { shareText } from '../core/share.js';
import { toast, sheet, confirmDialog, avatar, setBusy } from '../ui/components.js';
import { icon } from '../ui/icons.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };

const PAGE = 30;
// How many rows the feed is showing. Module-level on purpose: a Cheers re-renders the route, and
// the thirty someone just asked for must not fold back up under their finger.
let shown = PAGE;

const firstName = (m) => (m?.name || 'Someone').split(' ')[0];
/** 'YYYY-MM-DD' as a local Date, so a bare date never slips a day in a negative-offset zone. */
const ymd = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const dayShort = (d, tz) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(tz ? { timeZone: tz } : {}) });   // '14 Sept'
const monthLong = (d) => d.toLocaleDateString('en-GB', { month: 'long' });

/** '10–13 Aug', '30 Sept – 2 Oct', or with years when a booking straddles one. */
function spanLabel(checkIn, checkOut) {
  const a = ymd(checkIn), b = ymd(checkOut);
  if (a.getFullYear() !== b.getFullYear()) return `${fmtDay(a)} – ${fmtDay(b)}`;
  if (a.getMonth() !== b.getMonth()) return `${dayShort(a)} – ${dayShort(b)}`;
  return `${a.getDate()}–${dayShort(b)}`;
}

/** The masthead eyebrow: a count over readable rows, never an island headcount. */
function eyebrowText(count) {
  const noun = VOCAB.postcards.toUpperCase();
  if (count?.thisWeek > 0) return `${noun} · ${count.thisWeek} THIS WEEK`;
  if (count?.total > 0 && count.firstAt) return `${noun} · ${count.total} SINCE ${monthLong(new Date(count.firstAt)).toUpperCase()}`;
  return noun;
}

/** One line, in the hand: how many there are, and when the last one landed. */
function datelineHtml(store, count) {
  const latest = store.moments()[0];
  if (!latest || !count?.total) return 'Nothing sent yet';
  const one = count.total === 1;
  const noun = one ? VOCAB.postcard.toLowerCase() : VOCAB.postcards.toLowerCase();
  return `<b class="num">${count.total}</b> ${escapeHtml(noun)} · latest <span class="stamp">${
    escapeHtml(fmtClock(latest.createdAt))}</span>, ${escapeHtml(dayShort(new Date(latest.createdAt)))}`;
}

/** The place line, only from what the server wrote on the row. */
function placeLine(moment, store) {
  if (!moment.stayId) return '';
  const stay = store.stay(moment.stayId);
  if (!stay) return '';
  const after = moment.stayEnds && arubaDate(moment.createdAt) > moment.stayEnds;
  if (after) return `${stay.name} · SENT AFTER THE STAY`.toUpperCase();
  if (moment.stayDay && moment.stayDays) return `${stay.name} · DAY ${moment.stayDay} OF ${moment.stayDays}`.toUpperCase();
  return stay.name.toUpperCase();
}

/**
 * The licence line under a preview stand-in, set as one stamp under the chips: the EXAMPLE chip
 * already says it is a stand-in, so the line carries only what the licence asks for — who made the
 * picture, under what licence, and where it came from — separated the way the apparatus is.
 */
function creditLine(credit) {
  if (!credit) return "A preview stand-in, not a member's picture";
  return String(credit).trim().replace(/\.$/, '')
    .replace(/^photograph(ed)? by /i, '')
    .replace(/,? via /i, ' · ')
    .replace(/, /g, ' · ');
}

/** The picture arrives after the text: set the src, and let it settle in once it has loaded. */
function setShot(fig, url) {
  const img = fig.querySelector('.postcard-shot img');
  if (!img || !url || img.getAttribute('src') === url) return;
  const show = () => img.classList.add('in');
  img.addEventListener('load', show, { once: true });
  img.src = url;
  if (img.complete && img.naturalWidth) show();
}

/** 'Cheers from you and Ana' — names, never a bare number; nothing when nobody has. */
export function cheersLine(moment, store) {
  const rows = store.cheersFor(moment.id) || [];
  if (!rows.length) return '';
  const meId = store.me?.id;
  const names = [];
  if (rows.some(r => r.memberId === meId)) names.push('you');
  for (const r of rows) if (r.memberId !== meId) names.push(firstName(r.member || store.member(r.memberId)));
  let list;
  if (names.length > 3) list = `${names[0]}, ${names[1]} and ${names.length - 2} more`;
  else if (names.length === 1) list = names[0];
  else list = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${VOCAB.cheer} from ${list}`;
}

/**
 * One postcard. The shared renderer: the feed, the /postcards/:id page, Home and the crew thread
 * all draw the same figure. `urls` is the Map from momentUrls (may be omitted; the caller then
 * sets the picture later). `compact` is the Home version: capped at 4:5, no ruled links, since
 * Home writes its own. `full` is the detail page: the whole picture at its own ratio.
 */
export function postCard(moment, { store, urls = null, compact = false, full = false, go = null } = {}) {
  const me = store.me;
  const who = store.member(moment.memberId);
  const w = Number(moment.width) || 4, h = Number(moment.height) || 3;
  const ratio = h / w;
  const shape = full ? '' : ratio > 1.25 ? ' tall' : ratio < 0.5 ? ' wide' : '';
  const myCrews = me ? (store.crewsFor(me.id) || []) : [];
  const crew = moment.crewId ? myCrews.find(c => c.id === moment.crewId) : null;
  const isMine = !!me && moment.memberId === me.id;
  const canTake = isMine || store.hasRole('admin');
  const cheered = !!me && (store.cheersFor(moment.id) || []).some(r => r.memberId === me.id);
  const place = placeLine(moment, store);

  const facts = [
    moment.example ? '<span class="tag">EXAMPLE</span>' : '',
    place ? `<span>${escapeHtml(place)}</span>` : '',
    crew ? `<span class="tag">${escapeHtml(`${crew.name} ONLY`.toUpperCase())}</span>` : '',
  ].filter(Boolean);

  const links = [];
  if (canTake) links.push('<button type="button" class="link-rule" data-act="take">Take it back</button>');
  if (isMine && moment.crewId) links.push('<button type="button" class="link-rule" data-act="circle">Send it to the whole Circle</button>');
  for (const c of myCrews) {
    links.push(`<button type="button" class="link-rule" data-act="talk" data-crew="${escapeHtml(c.id)}">Talk about it in ${escapeHtml(c.name)}</button>`);
  }

  const href = `#/postcards/${escapeHtml(moment.id)}`;
  const label = escapeHtml(`${VOCAB.postcard} from ${firstName(who)}`);
  const shot = full
    ? `<div class="postcard-shot" style="--w:${w};--h:${h}"><img loading="lazy" decoding="async" alt=""></div>`
    : `<a class="postcard-shot${shape}" href="${href}" style="--w:${w};--h:${h}" aria-label="${label}"><img loading="lazy" decoding="async" alt=""></a>`;

  const fig = el(`<figure class="postcard${compact ? ' compact' : ''}${full ? ' full' : ''}">
    ${shot}
    <figcaption class="postcard-body">
      <div class="postcard-who">${avatar(who, 28)}<b>${escapeHtml(firstName(who))}</b><span class="stamp">${escapeHtml(fmtClock(moment.createdAt))}</span></div>
      ${facts.length ? `<p class="postcard-place">${facts.join('')}</p>` : ''}
      ${moment.example ? `<p class="stamp">${escapeHtml(creditLine(moment.credit))}</p>` : ''}
      ${moment.caption ? `<p class="postcard-caption">${escapeHtml(moment.caption)}</p>` : ''}
      <p class="postmark">${escapeHtml(postmarkLabel(moment))}</p>
      <div class="postcard-acts">
        <button type="button" class="btn ghost sm cheer" aria-pressed="${cheered ? 'true' : 'false'}">${escapeHtml(VOCAB.cheer)}</button>
        <span class="postcard-cheers">${escapeHtml(cheersLine(moment, store))}</span>
      </div>
      ${!compact && links.length ? `<div class="postcard-links">${links.join('')}</div>` : ''}
    </figcaption>
  </figure>`);

  const url = urls?.get?.(moment.path);
  if (url) setShot(fig, url);

  // Cheers answers in place; the store's commit redraws the rest.
  const cheerBtn = fig.querySelector('.cheer');
  const names = fig.querySelector('.postcard-cheers');
  let busy = false;
  cheerBtn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      const on = await store.toggleCheer(moment.id);
      cheerBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      names.textContent = cheersLine(moment, store);
    } catch (err) { toast(err.message, { kind: 'bad' }); }
    finally { busy = false; }
  });

  fig.querySelector('.postcard-links')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const nav = go || ((p) => { location.hash = `#${p}`; });
    try {
      if (b.dataset.act === 'take') {
        const yes = await confirmDialog({
          title: 'Take this postcard back?',
          message: "It comes off everyone's screen now. The picture stays on your phone.",
          confirmText: 'Take it back', danger: true,
        });
        if (!yes) return;
        await store.deleteMoment(moment.id);
        toast('Taken back.');
        if (full) nav('/postcards'); else fig.remove();
      } else if (b.dataset.act === 'circle') {
        await store.setMomentAudience(moment.id, null);
      } else if (b.dataset.act === 'talk') {
        await store.sendCrewMessage(b.dataset.crew, '', { momentId: moment.id });
        nav(`/crews/${b.dataset.crew}`);
      }
    } catch (err) { toast(err.message, { kind: 'bad' }); }
  });

  return fig;
}

/** The postmark as it will print, shown before sending so the member knows what the card says. */
function previewPostmark(shot) {
  const { takenAt, takenFrom } = shot;
  if (takenAt && (takenFrom === 'camera' || takenFrom === 'exif')) {
    const onTheSpot = Math.abs(Date.now() - new Date(takenAt).getTime()) <= 10 * 60e3;
    return `Taken ${fmtClock(takenAt)}${onTheSpot ? ' · on the spot' : ''}`;
  }
  // An EXIF day with no offset is a wall clock in an unknown zone: the day is kept at noon in
  // Aruba, so print it in Aruba and never the time.
  if (takenAt && takenFrom === 'exif_day') return `Taken ${dayShort(new Date(takenAt), 'America/Aruba')}`;
  return 'From the roll — the phone did not say when it was taken.';
}

/** The composer. Resolves with the new Moment, or undefined when the sheet is dismissed. */
export function postcardSheet({ store, prefill = {} }) {
  if (!store.postcardsOn()) { toast('Postcards are switched off right now', { kind: 'bad' }); return Promise.resolve(undefined); }
  const me = store.me;
  const crews = me ? (store.crewsFor(me.id) || []) : [];

  return sheet({
    title: 'Send a postcard',
    render: (body, close) => {
      let shot = null;        // what readPostcard gave back
      let previewUrl = null;  // the object URL on the preview, revoked on close
      body.innerHTML = `
        <div class="postcard-pick">
          <label class="choice">${icon('camera', { size: 17 })}<span>Take one now</span>
            <input type="file" accept="image/*" capture="environment" hidden data-from="camera"></label>
          <label class="choice"><span>From your roll</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden data-from="roll"></label>
        </div>
        <p class="tiny muted" id="reading" hidden>Reading the photograph…</p>
        <div class="postcard-form" id="form" hidden></div>`;
      const form = body.querySelector('#form');
      const reading = body.querySelector('#reading');

      const selectHtml = (places, selected = '') => `<select name="redemptionId">
          <option value="">Leave the place off</option>
          ${places.map(p => `<option value="${escapeHtml(p.redemption.id)}"${p.redemption.id === selected ? ' selected' : ''}>${
            escapeHtml(`${p.stay?.name || 'A stay'} · ${spanLabel(p.redemption.checkIn, p.redemption.checkOut || p.ends)}`)}</option>`).join('')}
        </select>`;

      const buildForm = () => {
        const keptCaption = form.querySelector('[name=caption]')?.value || '';
        // Where: only a booking of the member's own that contains the day the picture was taken
        // (or today, when the phone did not say). On an island day it is locked to that booking;
        // a roll photo from some other trip falls back to the list, so the server never refuses it.
        const places = store.placesFor(me?.id, shot.takenAt) || [];
        const wanted = prefill.redemptionId || store.islandDay()?.redemption?.id || null;
        const locked = wanted ? places.find(p => p.redemption?.id === wanted) : null;
        let where;
        if (locked) {
          where = `<div class="row" id="lock" style="gap:14px">
            <span class="postcard-where">${escapeHtml(`${locked.stay?.name || 'A stay'} · day ${locked.day} of ${locked.days}`)}</span>
            <button type="button" class="link-rule" data-unlock>Leave the place off</button>
            <input type="hidden" name="redemptionId" value="${escapeHtml(locked.redemption.id)}"></div>`;
        } else if (places.length) {
          where = selectHtml(places);
        } else {
          where = '<p class="tiny muted">No place printed — the app only says where a postcard is from when the Desk booked you there.</p>';
        }

        form.innerHTML = `
          <div class="postcard-preview"><img alt="" src="${escapeHtml(previewUrl)}"></div>
          <p class="postmark">${escapeHtml(previewPostmark(shot))}</p>
          <label class="field"><span>A line for the back</span>
            <input name="caption" maxlength="140" placeholder="A line for the back" autocomplete="off" enterkeyhint="done" value="${escapeHtml(keptCaption)}"></label>
          <div class="field"><span>Where</span>${where}</div>
          ${crews.length ? `<div class="field"><span>Who sees it</span>
            <div class="segmented" id="who">
              <button type="button" aria-pressed="true" data-crew="">The whole Circle</button>
              ${crews.map(c => `<button type="button" aria-pressed="false" data-crew="${escapeHtml(c.id)}">Only ${escapeHtml(c.name)}</button>`).join('')}
            </div></div>` : ''}
          <p class="tiny muted">Sent at postcard size, without the phone's location data. The original stays on your phone. Seen by Insiders only, never outside the club — and a screenshot is a screenshot, same as the group chat.</p>
          <div class="sheet-actions">
            <button type="button" class="btn block" data-ok>Send it</button>
          </div>`;

        form.querySelector('[data-unlock]')?.addEventListener('click', () => {
          form.querySelector('#lock').outerHTML = selectHtml(places);
        });
        form.querySelector('#who')?.addEventListener('click', (e) => {
          const b = e.target.closest('[data-crew]'); if (!b) return;
          form.querySelectorAll('#who [data-crew]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        });
        form.querySelector('[data-ok]').addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          const caption = form.querySelector('[name=caption]').value.trim();
          if (caption.length > 140) { toast('Keep it to 140 characters', { kind: 'bad' }); return; }
          const crewId = form.querySelector('#who [aria-pressed="true"]')?.dataset.crew || null;
          const redemptionId = form.querySelector('[name=redemptionId]')?.value || null;
          setBusy(btn, true, 'Sending…');
          try {
            const moment = await store.postMoment({
              blob: shot.blob, width: shot.width, height: shot.height, bytes: shot.bytes, mime: shot.mime,
              caption, crewId, redemptionId, takenAt: shot.takenAt, takenFrom: shot.takenFrom,
            });
            close(moment);
            const stayName = moment?.stayId ? store.stay(moment.stayId)?.name : null;
            toast('Sent.', { timeout: 8000, action: { label: 'Tell the group', fn: () => shareText({
              title: 'Postcard on the Circle',
              text: `Postcard from ${stayName || 'the Circle'} on the Circle`,
              url: `${location.origin}${location.pathname}#/postcards/${moment.id}`,
            }) } });
          } catch (err) { setBusy(btn, false); toast(err.message, { kind: 'bad' }); }
        });
      };

      body.querySelectorAll('.postcard-pick input').forEach((input) => input.addEventListener('change', async () => {
        const file = input.files?.[0]; if (!file) return;
        const captured = input.dataset.from === 'camera';
        input.value = '';   // so the same file can be chosen again after a refusal
        if (file.size > 50 * 1024 * 1024) { toast("That file is bigger than the club's album allows", { kind: 'bad' }); return; }
        reading.hidden = false;
        try { shot = await readPostcard(file, { ...store.postcardEncoding(), captured }); }
        catch (err) { toast(err.message, { kind: 'bad' }); return; }
        finally { reading.hidden = true; }
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(shot.blob);
        buildForm();
        form.hidden = false;
        // The caption is not focused: the keyboard would rise over the picture and the postmark
        // the member has just been handed, and the sheet's own focus (a button, never an input)
        // is the house rule.
      }));

      body.closest('dialog')?.addEventListener('close', () => { if (previewUrl) URL.revokeObjectURL(previewUrl); });

      // "Take one now" from the island strip or Home: straight to the camera.
      if (prefill.capture) setTimeout(() => body.querySelector('[data-from="camera"]')?.click(), 0);
    },
  });
}

/** The switch is off: say so, claim nothing. */
function offPage() {
  return el(`<div><section class="wrap sec">
    <h1>${escapeHtml(VOCAB.postcards)}</h1>
    <p class="lede" style="margin-top:12px">Postcards are switched off right now.</p>
  </section></div>`);
}

/** /postcards — the feed. `query.mine === '1'` shows only the viewer's own. */
export function feed({ store, go, query = {}, refresh }) {
  if (!store.postcardsOn()) return offPage();
  const mine = query.mine === '1';
  const count = store.momentCount();
  const island = store.islandDay();
  const rows = store.moments({ mine });

  const wrap = el(`<div><section class="sec"><div class="wrap">
      <header class="masthead">
        <p class="eyebrow">${icon('camera')}${escapeHtml(eyebrowText(count))}</p>
        <h1>Wish you were <em class="ac">here</em>.</h1>
        <p class="dateline">${datelineHtml(store, count)}</p>
        <div class="row no-print">
          <button type="button" class="btn" id="send">Send a postcard</button>
        </div>
        <div class="segmented even no-print" role="group" aria-label="Whose postcards" id="whose">
          <button type="button" data-mine="" aria-pressed="${mine ? 'false' : 'true'}">Everyone</button>
          <button type="button" data-mine="1" aria-pressed="${mine ? 'true' : 'false'}">Yours</button>
        </div>
      </header>
      ${island ? `<div class="island-strip">
        <p class="eyebrow">${escapeHtml(`DAY ${island.day} OF ${island.days} · ${island.stay?.name || ''}`.toUpperCase())}</p>
        <div class="row" style="gap:20px">
          <button type="button" class="btn" id="take">Take one now</button>
          <button type="button" class="link-rule" id="roll">From your roll</button>
        </div>
      </div>` : ''}
      <div class="postcard-list" id="list"></div>
      <div id="more"></div>
    </div></section></div>`);

  // Opening the feed is reading it. Guarded so a store that notifies on the marker cannot loop.
  if (typeof store.unseenPostcards !== 'function' || store.unseenPostcards().length) store.markPostcardsSeen();

  const list = wrap.querySelector('#list');
  const more = wrap.querySelector('#more');
  let lastDay = '';

  // Draw rows [from, to): the text first, with every frame reserved by its ratio, then one
  // momentUrls call for the page and the pictures settle in as they arrive.
  const paint = async (from, to) => {
    const page = rows.slice(from, to);
    const drawn = [];
    for (const m of page) {
      const day = dayRule(m.createdAt);
      if (day !== lastDay) { list.appendChild(el(`<div class="thread-day"><span>${escapeHtml(day)}</span></div>`)); lastDay = day; }
      const fig = postCard(m, { store, go });
      list.appendChild(fig);
      drawn.push({ fig, m });
    }
    const left = rows.length - to;
    more.innerHTML = left > 0
      ? `<p class="postcard-more"><button type="button" class="btn ghost" id="more-btn">Show the ${Math.min(PAGE, left)} before these</button></p>` : '';
    more.querySelector('#more-btn')?.addEventListener('click', () => { shown = to + PAGE; paint(to, shown); });
    if (!drawn.length) return;
    try {
      const urls = await store.momentUrls([...new Set(drawn.map(d => d.m.path).filter(Boolean))]);
      for (const d of drawn) setShot(d.fig, urls.get(d.m.path));
    } catch (err) { toast(err.message, { kind: 'bad' }); }
  };

  if (!rows.length) {
    list.innerHTML = mine
      ? '<div class="postcard-empty"><p>You have not sent one yet.</p></div>'
      : `<div class="postcard-empty"><p>Nothing sent yet.</p>
          <p class="small muted">The first postcard comes from whoever is on the island next. Anything from an earlier trip counts too — send one from your roll.</p></div>`;
  } else {
    paint(0, shown);
  }

  // The store's commit redraws the route with the new card first; the refresh is only for a
  // backend that did not notify (the wrap would still be on the page).
  const open = async (prefill) => {
    const made = await postcardSheet({ store, prefill });
    if (made && wrap.isConnected) refresh?.();
  };
  // Everyone · Yours: the same ?mine query the ruled link used to carry.
  wrap.querySelector('#whose').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mine]'); if (!b || b.getAttribute('aria-pressed') === 'true') return;
    const nav = go || ((p) => { location.hash = `#${p}`; });
    nav(b.dataset.mine === '1' ? '/postcards?mine=1' : '/postcards');
  });
  wrap.querySelector('#send').addEventListener('click', () => open({}));
  wrap.querySelector('#take')?.addEventListener('click', () => open({ capture: true, redemptionId: island.redemption?.id || null }));
  wrap.querySelector('#roll')?.addEventListener('click', () => open({ redemptionId: island.redemption?.id || null }));
  return wrap;
}

/** /postcards/:id — one postcard, the whole picture at its own ratio. */
export function one({ store, params, go }) {
  const m = store.postcardsOn() ? store.moment(params.id) : null;
  // No way-up band: the running head carries '‹ POSTCARDS' on this route.
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <div id="card"></div>
    </div></section></div>`);
  const slot = wrap.querySelector('#card');
  if (!m) {
    slot.innerHTML = `<h1>Nothing here</h1>
      <p><a class="link-rule" href="#/postcards">${escapeHtml(VOCAB.postcards)}</a></p>`;
    return wrap;
  }
  const fig = postCard(m, { store, full: true, go });
  slot.appendChild(fig);
  store.momentUrls([m.path])
    .then(urls => setShot(fig, urls.get(m.path)))
    .catch(err => toast(err.message, { kind: 'bad' }));
  return wrap;
}
