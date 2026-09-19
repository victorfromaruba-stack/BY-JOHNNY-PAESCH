// Crews: the people you actually travel with, and the thread that belongs to them.
//
// A crew is not the Circle and not a chip-in. The Circle is everybody; a chip-in is money on
// one booking and ends when that booking does. A crew is the four who split the villa, the
// family group, the ones who always go in October — it is named by the people in it, it keeps
// its own conversation, and it outlives any particular week.
//
// Deliberately small: a name, who is in it, and somewhere to talk. Everything the Circle
// already does well — quoting, pledging, the board — stays where it is.
import { escapeHtml, fmtDay, fmtDayTime, fmtPoints, fmtUsd2 } from '../core/util.js';
import { fmtClock } from '../core/util.js';
import { toast, sheet, confirmDialog, avatar, setBusy } from '../ui/components.js';
import { icon } from '../ui/icons.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };

/** How much of a long conversation is drawn at once. The rest is one tap above it. */
const PAGE = 60;

/** A stack of faces, for a crew card. */
function faces(roster, max = 5) {
  const shown = roster.slice(0, max);
  const rest = roster.length - shown.length;
  return `<span class="faces">${shown.map(m => avatar(m.member, 30)).join('')}${
    rest > 0 ? `<span class="face-rest">+${rest}</span>` : ''}</span>`;
}

/** Your crews, and a way to start one. */
export function crews({ store, go }) {
  const me = store.me;
  const mine = store.crewsFor(me.id);
  const rooms = store.approvedRoomsFor(me.id);

  const wrap = el(`<div><section class="sec"><div class="wrap">
      <div class="sec-head">
        <p class="eyebrow">${icon('users')}Your crews</p>
        <h1>Who you are going with</h1>
        <p>A crew is the people on one booking, with a thread only they can read.</p>
      </div>
      ${rooms.length
        ? `<button class="btn block" id="new-crew">${icon('plus', { size: 17 })}Start a crew</button>`
        : `<a class="btn block" href="#/stays">${icon('bed', { size: 17 })}Find a room first</a>`}
      <div id="list" style="margin-top:var(--s-5)"></div>
    </div></section></div>`);

  const list = wrap.querySelector('#list');
  if (!mine.length) {
    list.appendChild(el(`<div class="panel empty">
      <span class="ico">${icon('users', { size: 30, cls: 'ico-muted' })}</span>
      <h2>${rooms.length ? 'Start one around a room' : 'A crew starts with a room'}</h2>
      <p class="small muted">${rooms.length
        ? `You have <b class="num">${rooms.length}</b> approved booking${rooms.length === 1 ? '' : 's'} to build one around. Name it whatever you already call yourselves, add the people coming with you, and the thread is yours — nobody else in the Circle can read it, not the Desk, not the Banker.`
        : 'A crew is the people on a booking, so it needs a booking first. Ask for a room, and once the Desk quotes it and you accept, you can start the crew around it and bring the others in.'}</p>
    </div>`));
  }
  for (const c of mine) {
    const roster = store.crewRoster(c.id);
    const thread = store.crewThread(c.id);
    const last = thread.at(-1);
    const who = store.member(last?.memberId);
    list.appendChild(el(`<a class="panel crew-card" href="#/crews/${escapeHtml(c.id)}">
        <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--s-2);align-items:center">
          <h2>${escapeHtml(c.name)}${
            store.leadsCrew(c.id, me.id) ? '<span class="tag" style="margin-left:8px">you lead it</span>' : ''}</h2>
          ${icon('chevronRight', { size: 18, cls: 'ico-muted' })}
        </div>
        ${c.about ? `<p class="small muted" style="margin-top:4px">${escapeHtml(c.about)}</p>` : ''}
        ${(() => {
          const r = c.redemptionId ? store.redemption(c.redemptionId) : null;
          const st = r ? store.stay(r.stayId) : null;
          if (!st) return '';
          return `<p class="small" style="margin-top:6px">${icon('bed', { size: 14, cls: 'ico-muted' })}
            ${escapeHtml(st.name)} · ${escapeHtml(fmtDay(r.checkIn))}${r.nights ? ` · <b class="num">${r.nights}</b> night${r.nights === 1 ? '' : 's'}` : ''}</p>`;
        })()}
        <p class="small muted" style="margin-top:8px">${
          last
            ? `<b>${escapeHtml(who?.name.split(' ')[0] || 'Someone')}:</b> ${escapeHtml((last.body || '(taken back)').slice(0, 70))}${(last.body || '').length > 70 ? '…' : ''}`
            : 'No messages yet — say the first thing.'}</p>
        <div class="row" style="margin-top:var(--s-3)">
          ${faces(roster)}
          <span class="tiny muted"><b class="num">${roster.length}</b> ${roster.length === 1 ? 'person' : 'people'}${
            last ? ` · last spoke ${escapeHtml(fmtDay(last.createdAt))}` : ''}</span>
        </div>
      </a>`));
  }

  wrap.querySelector('#new-crew')?.addEventListener('click', async () => {
    const made = await crewSheet({ store });
    if (made) { toast(`${made.name} it is.`, { kind: 'good' }); go(`/crews/${made.id}`); }
  });
  return wrap;
}

/** Name a crew. */
async function crewSheet({ store, crew = null }) {
  return sheet({
    title: crew ? 'Rename this crew' : 'Start a crew',
    render: (body, close) => {
      const rooms = crew ? [] : store.approvedRoomsFor();
      body.innerHTML = `
        <p class="sheet-text">${crew
          ? 'Call it whatever you already call yourselves.'
          : 'A crew is the people on one booking. Pick the room, name yourselves, and only the people you add can see it or read what is said in it.'}</p>
        ${crew ? '' : `<label class="field"><span>The room</span>
          <select name="redemptionId" required>
            ${rooms.map(r => {
              const st = store.stay(r.stayId);
              return `<option value="${escapeHtml(r.id)}">${escapeHtml(st?.name || 'A stay')} · ${escapeHtml(fmtDay(r.checkIn))}${r.nights ? ` · ${r.nights} night${r.nights === 1 ? '' : 's'}` : ''}</option>`;
            }).join('')}
          </select>
          <span class="hint">Only rooms the Desk has approved and that do not already have a crew.</span></label>`}
        <label class="field"><span>Name</span>
          <input name="name" required maxlength="40" placeholder="The October Four"
                 value="${escapeHtml(crew?.name || '')}"></label>
        <label class="field"><span>What it is <span class="muted">(optional)</span></span>
          <input name="about" maxlength="120" placeholder="The ones who always go in October"
                 value="${escapeHtml(crew?.about || '')}"></label>
        <div class="sheet-actions">
          <button class="btn" data-ok>${crew ? 'Save' : 'Start it'}</button>
        </div>`;
      body.querySelector('[data-ok]').addEventListener('click', async (e) => {
        const name = body.querySelector('[name=name]').value.trim();
        const about = body.querySelector('[name=about]').value.trim();
        if (name.length < 2) { toast('A crew needs a name.', { kind: 'bad' }); return; }
        setBusy(e.target, true, crew ? 'Saving…' : 'Starting…');
        try {
          const out = crew ? await store.renameCrew(crew.id, { name, about })
                           : await store.createCrew({ name, about, redemptionId: body.querySelector('[name=redemptionId]')?.value || null });
          close(out || { id: crew?.id, name, about });
        } catch (err) { setBusy(e.target, false); toast(err.message, { kind: 'bad' }); }
      });
    },
  });
}

/** One crew: who is in it, and the thread. */
export function crewDetail({ store, params, go, refresh }) {
  const me = store.me;
  const c = store.crew(params.id);
  if (!c || !store.isInCrew(c.id, me.id)) {
    return el(`<div><section class="sec"><div class="wrap">
      <h1>Not your crew</h1>
      <p class="lede" style="margin-top:var(--s-3)">This one is private to the people in it. If you
        should be, ask whoever leads it to add you.</p>
      <p style="margin-top:var(--s-5)"><a class="btn block" href="#/crews">Back to your crews</a></p>
    </div></section></div>`);
  }

  const roster = store.crewRoster(c.id);
  const lead = store.leadsCrew(c.id, me.id);
  const people = `<b class="num">${roster.length}</b> ${roster.length === 1 ? 'person' : 'people'}`;
  store.markCrewSeen(c.id);            // opening it is reading it

  // The head says the name once and what the crew is once; the roster folds away under it, and
  // the thread is the page itself. The way back to the list is the running head's, not the page's.
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--s-2);align-items:start">
        <h1>${escapeHtml(c.name)}</h1>
        ${lead ? `<button class="icon-btn" id="rename" aria-label="Rename this crew">${icon('edit', { size: 18 })}</button>` : ''}
      </div>
      <p class="lede" style="margin-top:var(--s-2)">${c.about
        ? escapeHtml(c.about)
        : 'The people on one booking, and a thread only they can read.'}</p>

      <details class="fineprint">
        <summary>Who is in it · <b class="num">${roster.length}</b></summary>
        <ul class="roster" id="roster"></ul>
        <div class="stack" style="margin-top:var(--s-3)">
          ${lead ? `<span><button class="btn ghost sm" id="add">${icon('plus', { size: 15 })}Add someone</button></span>` : ''}
          <span><button class="link-rule danger" id="leave">Leave the crew</button></span>
        </div>
      </details>
      <p class="tiny muted">Only the ${people} in this crew can read what is said here.</p>

      <div class="thread" id="thread"></div>

      <div class="act-bar">
        <form id="say" class="say-row">
          <input name="body" placeholder="Say something to the crew" maxlength="4000"
                 autocomplete="off" enterkeyhint="send">
          <!-- The 44px round send. Inline until the stylesheet carries it: .act-bar .btn
               { width: 100% } is written after .say-row .btn, and .btn's 48px min-height beats
               .say-row .btn's height, which drew the circle as an ellipse. -->
          <button class="btn" type="submit" aria-label="Send"
                  style="width:44px;min-height:44px;flex:none">${icon('send', { size: 17 })}</button>
        </form>
      </div>
    </div></section></div>`);

  // --- who is in it
  const rosterEl = wrap.querySelector('#roster');
  for (const m of roster) {
    const row = el(`<li>
      <span class="row" style="gap:10px;flex-wrap:nowrap;min-width:0">
        ${avatar(m.member, 34)}
        <span style="min-width:0"><b>${escapeHtml(m.member.name)}</b>${m.memberId === me.id ? ' <span class="tiny muted">(you)</span>' : ''}
          <br><span class="tiny muted">${m.role === 'lead' ? 'Leads the crew' : 'In the crew'} · joined ${escapeHtml(fmtDay(m.joinedAt))}</span></span>
      </span>
      ${lead && m.memberId !== me.id ? `<button class="btn ghost sm" data-remove="${escapeHtml(m.memberId)}">Remove</button>` : ''}
    </li>`);
    rosterEl.appendChild(row);
  }
  rosterEl.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-remove]'); if (!b) return;
    const who = store.member(b.dataset.remove);
    const yes = await confirmDialog({ title: `Remove ${who?.name.split(' ')[0]}?`, danger: true, confirmText: 'Remove',
      message: 'They stop seeing this crew and its thread. You can add them again any time.' });
    if (!yes) return;
    try { await store.leaveCrew(c.id, b.dataset.remove); refresh(); }
    catch (err) { toast(err.message, { kind: 'bad' }); }
  });

  // --- the thread
  const thread = wrap.querySelector('#thread');
  // Postcards dropped into the thread need their pictures signed; one call per draw, then redraw.
  let urls = new Map();
  // The last sixty are drawn; older ones arrive sixty at a time when asked for, so a two-year
  // conversation opens as fast as a two-day one.
  let shown = PAGE;
  const signPictures = (msgs) => {
    const paths = msgs.map(m => m.momentId && store.moment?.(m.momentId)?.path).filter(p => p && !urls.has(p));
    if (!paths.length || typeof store.momentUrls !== 'function') return;
    store.momentUrls(paths).then(map => { map.forEach((v, k) => urls.set(k, v)); draw(); }).catch(() => {});
  };
  /** The thread is page flow: nothing here scrolls but the page. */
  const draw = () => {
    const all = store.crewThread(c.id);
    const msgs = all.slice(Math.max(0, all.length - shown));
    signPictures(msgs);
    if (!msgs.length) {
      thread.innerHTML = `<p class="small muted">Nothing said yet. Whatever you
        are planning, this is the place for it.</p>`;
      return;
    }
    const earlier = all.length > msgs.length
      ? `<button type="button" class="link-rule" id="earlier">Earlier messages</button>` : '';
    let lastDay = '';
    thread.innerHTML = earlier + msgs.map((m) => {
      const who = store.member(m.memberId);
      const day = String(m.createdAt).slice(0, 10);
      const rule = day !== lastDay ? `<div class="thread-day"><span>${escapeHtml(fmtDay(m.createdAt))}</span></div>` : '';
      lastDay = day;
      const mine = m.memberId === me.id;
      if (m.deletedAt) {
        return `${rule}<div class="msg ${mine ? 'mine' : ''} gone"><span class="bubble">taken back</span></div>`;
      }
      if (m.momentId) {
        // A postcard in the thread: the picture, small, and where it is from. Gone means a tombstone.
        const mo = store.moment?.(m.momentId);
        if (!mo) return `${rule}<div class="msg ${mine ? 'mine' : ''} gone"><span class="bubble">a postcard that was taken back</span></div>`;
        const src = urls.get(mo.path) || '';
        const place = mo.stayId ? `${store.stay(mo.stayId)?.name || ''} · day ${mo.stayDay} of ${mo.stayDays}` : '';
        return `${rule}<div class="msg ${mine ? 'mine' : ''}">
          ${mine ? '' : avatar(who, 28)}
          <a class="bubble bubble-card" href="#/postcards/${escapeHtml(mo.id)}">
            ${mine ? '' : `<b class="who">${escapeHtml(who?.name.split(' ')[0] || 'Someone')}</b>`}
            <span class="card-shot" style="--w:${Number(mo.width) || 4};--h:${Number(mo.height) || 3}">${src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async">` : ''}</span>
            ${m.body ? `<span class="what">${escapeHtml(m.body)}</span>` : ''}
            <span class="tiny">${escapeHtml(place || 'A postcard')}</span>
            <span class="when">${escapeHtml(fmtClock(m.createdAt))}</span>
          </a></div>`;
      }
      return `${rule}<div class="msg ${mine ? 'mine' : ''}">
        ${mine ? '' : avatar(who, 28)}
        <span class="bubble">
          ${mine ? '' : `<b class="who">${escapeHtml(who?.name.split(' ')[0] || 'Someone')}</b>`}
          <span class="what">${escapeHtml(m.body || '')}</span>
          <span class="when">${escapeHtml(fmtDayTime(m.createdAt).split(' ').slice(-1)[0])}${
            mine ? ` <button class="unsay" data-unsay="${escapeHtml(String(m.id))}" aria-label="Take it back">×</button>` : ''}</span>
        </span></div>`;
    }).join('');
  };
  /** The newest line, above the composer and the tab bar — the thread's scroll-margin does that. */
  const toLatest = (tries = 3) => requestAnimationFrame(() => {
    const last = thread.querySelector('.msg:last-of-type');
    if (last?.isConnected) last.scrollIntoView({ block: 'end', behavior: 'auto' });
    else if (tries > 0) toLatest(tries - 1);
  });
  draw();
  toLatest();

  thread.addEventListener('click', async (e) => {
    if (e.target.closest('#earlier')) {
      const was = thread.querySelectorAll('.msg').length;
      shown += PAGE;
      draw();
      // Stay where the eye was: whatever was the top line stays the top line.
      requestAnimationFrame(() => {
        const msgs = [...thread.querySelectorAll('.msg')];
        msgs[Math.max(0, msgs.length - was)]?.scrollIntoView({ block: 'start', behavior: 'auto' });
      });
      return;
    }
    const b = e.target.closest('[data-unsay]'); if (!b) return;
    try { await store.deleteCrewMessage(b.dataset.unsay); draw(); }
    catch (err) { toast(err.message, { kind: 'bad' }); }
  });

  wrap.querySelector('#say').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('[name=body]');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';                       // clear first, so a slow network does not eat it twice
    try { await store.sendCrewMessage(c.id, text); draw(); toLatest(); }
    catch (err) { input.value = text; toast(err.message, { kind: 'bad' }); }
  });

  wrap.querySelector('#rename')?.addEventListener('click', async () => {
    const out = await crewSheet({ store, crew: c });
    if (out) { toast('Saved.', { kind: 'good' }); refresh(); }
  });

  wrap.querySelector('#add')?.addEventListener('click', async () => {
    const inIt = new Set(roster.map(m => m.memberId));
    const candidates = store.people().filter(p => p.status !== 'left' && !inIt.has(p.id));
    if (!candidates.length) { toast('Everybody is already in it.'); return; }
    const picked = await sheet({ title: 'Add to the crew', render: (body, close) => {
      body.innerHTML = `<p class="sheet-text">They see this crew and everything said in it from
          the moment you add them.</p>
        <div class="stack tight">
          ${/* A name is read along a line, not stacked under a face. The inline declarations are
                .choice.pick, waiting on the stylesheet; delete them the day the rule lands. */''}
          ${candidates.map(p => `<button type="button" class="choice pick" data-id="${escapeHtml(p.id)}"
            style="display:flex;align-items:center;gap:11px;text-align:left">
            ${avatar(p, 34)}<span><b>${escapeHtml(p.name)}</b></span></button>`).join('')}
        </div>`;
      body.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-id]'); if (b) close(b.dataset.id);
      });
    } });
    if (!picked) return;
    try { await store.addToCrew(c.id, picked); toast(`${store.member(picked)?.name.split(' ')[0]} is in.`, { kind: 'good' }); refresh(); }
    catch (err) { toast(err.message, { kind: 'bad' }); }
  });

  wrap.querySelector('#leave').addEventListener('click', async () => {
    const yes = await confirmDialog({ title: `Leave ${c.name}?`, danger: true, confirmText: 'Leave',
      message: 'You stop seeing the crew and its thread. Whoever leads it can add you back.' });
    if (!yes) return;
    try { await store.leaveCrew(c.id, me.id); toast('You left the crew.'); go('/crews'); }
    catch (err) { toast(err.message, { kind: 'bad' }); }
  });

  return wrap;
}
