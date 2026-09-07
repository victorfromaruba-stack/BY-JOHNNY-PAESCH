// Crews: the people you actually travel with, and the thread that belongs to them.
//
// A crew is not the Circle and not a chip-in. The Circle is everybody; a chip-in is money on
// one booking and ends when that booking does. A crew is the four who split the villa, the
// family group, the ones who always go in October — it is named by the people in it, it keeps
// its own conversation, and it outlives any particular week.
//
// Deliberately small: a name, who is in it, and somewhere to talk. Everything the Circle
// already does well — quoting, pledging, the board — stays where it is.
import { escapeHtml, fmtDay, fmtDayTime } from '../core/util.js';
import { toast, sheet, confirmDialog, avatar, setBusy } from '../ui/components.js';
import { icon } from '../ui/icons.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };

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

  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:820px">
      <div class="sec-head">
        <div>
          <p class="eyebrow">${icon('users')}Your crews</p>
          <h1>Who you travel with</h1>
          <p>A crew is the handful of you who actually go together — the four who split a villa,
             the family group, the ones who always go in October. It has a name you choose and a
             thread only the people in it can read.</p>
        </div>
        <button class="btn" id="new-crew">${icon('plus', { size: 17 })}Start a crew</button>
      </div>
      <div class="stack" id="list" style="margin-top:22px"></div>
    </div></section></div>`);

  const list = wrap.querySelector('#list');
  if (!mine.length) {
    list.appendChild(el(`<div class="panel empty">
      <span class="ico">${icon('users', { size: 30, cls: 'ico-muted' })}</span>
      <h2 style="margin-top:10px;font-size:1.15rem">You are not in a crew yet</h2>
      <p class="small muted" style="margin-top:8px;max-width:52ch">Start one and name it whatever you
        call yourselves. Add the people you go with, and the thread is yours — nobody else in the
        Circle can read it — not the Desk, not the Banker.</p>
      <p style="margin-top:14px"><button class="btn sm" id="new-crew-2">${icon('plus', { size: 16 })}Start a crew</button></p>
    </div>`));
  }
  for (const c of mine) {
    const roster = store.crewRoster(c.id);
    const thread = store.crewThread(c.id);
    const last = thread.at(-1);
    const who = store.member(last?.memberId);
    list.appendChild(el(`<a class="panel crew-card" href="#/crews/${escapeHtml(c.id)}">
        <div class="row-between" style="align-items:flex-start;gap:12px">
          <div style="min-width:0">
            <h2 style="font-size:1.1rem">${escapeHtml(c.name)}${
              store.leadsCrew(c.id, me.id) ? '<span class="tag" style="margin-left:8px">you lead it</span>' : ''}</h2>
            ${c.about ? `<p class="small muted" style="margin-top:4px">${escapeHtml(c.about)}</p>` : ''}
            <p class="small muted" style="margin-top:8px">${
              last
                ? `<b>${escapeHtml(who?.name.split(' ')[0] || 'Someone')}:</b> ${escapeHtml((last.body || '(taken back)').slice(0, 70))}${(last.body || '').length > 70 ? '…' : ''}`
                : 'No messages yet — say the first thing.'}</p>
          </div>
          ${icon('chevronRight', { size: 18, cls: 'ico-muted' })}
        </div>
        <div class="row" style="margin-top:12px;gap:10px;align-items:center">
          ${faces(roster)}
          <span class="tiny muted">${roster.length} ${roster.length === 1 ? 'person' : 'people'}${
            last ? ` · last spoke ${escapeHtml(fmtDay(last.createdAt))}` : ''}</span>
        </div>
      </a>`));
  }

  const start = async () => {
    const made = await crewSheet({ store });
    if (made) { toast(`${made.name} it is.`, { kind: 'good' }); go(`/crews/${made.id}`); }
  };
  wrap.querySelector('#new-crew').addEventListener('click', start);
  wrap.querySelector('#new-crew-2')?.addEventListener('click', start);
  return wrap;
}

/** Name a crew. */
async function crewSheet({ store, crew = null }) {
  return sheet({
    title: crew ? 'Rename this crew' : 'Start a crew',
    render: (body, close) => {
      body.innerHTML = `
        <p class="sheet-text">Call it whatever you already call yourselves. Only the people you
          add can see it or read what is said in it.</p>
        <label class="field"><span>Name</span>
          <input name="name" required maxlength="40" autofocus placeholder="The October Four"
                 value="${escapeHtml(crew?.name || '')}"></label>
        <label class="field"><span>What it is <span class="muted">(optional)</span></span>
          <input name="about" maxlength="120" placeholder="The ones who always go in October"
                 value="${escapeHtml(crew?.about || '')}"></label>
        <div class="sheet-actions">
          <button class="btn ghost" data-close>Cancel</button>
          <button class="btn" data-ok>${crew ? 'Save' : 'Start it'}</button>
        </div>`;
      body.querySelector('[data-ok]').addEventListener('click', async (e) => {
        const name = body.querySelector('[name=name]').value.trim();
        const about = body.querySelector('[name=about]').value.trim();
        if (name.length < 2) { toast('A crew needs a name.', { kind: 'bad' }); return; }
        setBusy(e.target, true, crew ? 'Saving…' : 'Starting…');
        try {
          const out = crew ? await store.renameCrew(crew.id, { name, about })
                           : await store.createCrew({ name, about });
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
    return el(`<div><section class="sec"><div class="wrap" style="max-width:640px;text-align:center">
      <h1 style="margin-top:40px">Not your crew</h1>
      <p class="lede" style="margin-top:12px">This one is private to the people in it. If you should
        be, ask whoever leads it to add you.</p>
      <p style="margin-top:20px"><a class="btn ghost" href="#/crews">Your crews</a></p>
    </div></section></div>`);
  }

  const roster = store.crewRoster(c.id);
  const lead = store.leadsCrew(c.id, me.id);
  store.markCrewSeen(c.id);            // opening it is reading it

  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:760px">
      <p class="small"><a href="#/crews" class="back">${icon('chevronRight', { size: 14 })}Your crews</a></p>
      <div class="row-between" style="align-items:flex-start;gap:14px;margin-top:8px">
        <div style="min-width:0">
          <h1 style="font-size:1.5rem">${escapeHtml(c.name)}</h1>
          ${c.about ? `<p class="lede" style="margin-top:6px">${escapeHtml(c.about)}</p>` : ''}
        </div>
        <div class="row" style="gap:8px;flex:none">
          ${lead ? `<button class="btn quiet sm" id="rename">${icon('edit', { size: 15 })}Rename</button>` : ''}
          <button class="btn quiet sm" id="leave">Leave</button>
        </div>
      </div>

      <div class="panel" style="margin-top:18px">
        <div class="row-between">
          <p class="eyebrow">${icon('users')}Who is in it</p>
          ${lead ? `<button class="btn quiet sm" id="add">${icon('plus', { size: 15 })}Add someone</button>` : ''}
        </div>
        <ul class="roster" id="roster" style="margin-top:12px"></ul>
      </div>

      <div class="panel" style="margin-top:16px">
        <p class="eyebrow">${icon('inbox')}The thread</p>
        <div class="thread" id="thread"></div>
        <form id="say" class="say-row">
          <input name="body" placeholder="Say something to the crew" maxlength="4000" autocomplete="off">
          <button class="btn" type="submit" aria-label="Send">${icon('send', { size: 17 })}</button>
        </form>
        <p class="tiny muted" style="margin-top:8px">Only the ${roster.length}
          ${roster.length === 1 ? 'person' : 'people'} above can read this.</p>
      </div>
    </div></section></div>`);

  // --- who is in it
  const rosterEl = wrap.querySelector('#roster');
  for (const m of roster) {
    const row = el(`<li>
      <span class="row" style="gap:10px;align-items:center;min-width:0">
        ${avatar(m.member, 34)}
        <span style="min-width:0"><b>${escapeHtml(m.member.name)}</b>${m.memberId === me.id ? ' <span class="tiny muted">(you)</span>' : ''}
          <br><span class="tiny muted">${m.role === 'lead' ? 'Leads the crew' : 'In the crew'} · joined ${escapeHtml(fmtDay(m.joinedAt))}</span></span>
      </span>
      ${lead && m.memberId !== me.id ? `<button class="btn quiet sm" data-remove="${escapeHtml(m.memberId)}">Remove</button>` : ''}
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
  const draw = () => {
    const msgs = store.crewThread(c.id);
    if (!msgs.length) {
      thread.innerHTML = `<p class="small muted" style="padding:18px 2px">Nothing said yet. Whatever you
        are planning, this is the place for it.</p>`;
      return;
    }
    let lastDay = '';
    thread.innerHTML = msgs.map((m) => {
      const who = store.member(m.memberId);
      const day = String(m.createdAt).slice(0, 10);
      const rule = day !== lastDay ? `<div class="thread-day"><span>${escapeHtml(fmtDay(m.createdAt))}</span></div>` : '';
      lastDay = day;
      const mine = m.memberId === me.id;
      if (m.deletedAt) {
        return `${rule}<div class="msg ${mine ? 'mine' : ''} gone"><span class="bubble">taken back</span></div>`;
      }
      return `${rule}<div class="msg ${mine ? 'mine' : ''}">
        ${mine ? '' : avatar(who, 28)}
        <span class="bubble">
          ${mine ? '' : `<b class="who">${escapeHtml(who?.name.split(' ')[0] || 'Someone')}</b>`}
          <span class="what">${escapeHtml(m.body || '')}</span>
          <span class="when">${escapeHtml(fmtDayTime(m.createdAt).split(' ').slice(-1)[0])}${
            mine ? ` <button class="unsay" data-unsay="${escapeHtml(String(m.id))}" title="Take it back">×</button>` : ''}</span>
        </span></div>`;
    }).join('');
    thread.scrollTop = thread.scrollHeight;
  };
  draw();

  thread.addEventListener('click', async (e) => {
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
    try { await store.sendCrewMessage(c.id, text); draw(); }
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
        <div class="stack" style="gap:8px;max-height:52vh;overflow:auto">
          ${candidates.map(p => `<button type="button" class="choice pick" data-id="${escapeHtml(p.id)}"
            style="display:flex;align-items:center;gap:11px;text-align:left">
            ${avatar(p, 34)}<span><b>${escapeHtml(p.name)}</b></span></button>`).join('')}
        </div>
        <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button></div>`;
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
