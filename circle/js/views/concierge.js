// Ian, the Circle's concierge: ask what is worth booking, and get the board's own answer.
//
// The screen is the crew thread reused — the same .thread / .msg / .bubble markup and the same
// composer — so it is born looking like the rest of the app. Ian's lines carry "Ian" where a
// crew-mate's name would be and no face: Ian is not a person and does not pretend to be one.
//
// The server is stateless. The conversation lives in this tab's sessionStorage, and the last
// twelve lines go up with every question; every turn is still logged on the server for the Desk.
//
// A suggestion from Ian is a card with ids on it, never a price: the card looks the row up in the
// store and prints it with the board's own dealRow, so the figure on a card is the board's. Nothing
// happens until the member taps, and the tap runs the app's own code (createCrew, addToCrew, the
// ask form). Under each answer, "Helped" / "Not it" go to the turn's row for the nightly review.
import { escapeHtml, safeUrl } from '../core/util.js';
import { toast, confirmDialog, setBusy } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { dealRow, askHrefFor, shortRange } from './deals.js';
import { tripPanel, changeWords } from './trip.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const KEEP = 30;                       // lines kept in the tab
const SEND = 12;                       // lines sent with each question

const keyFor = (store) => `hunto.ian.${store.me?.id || 'anon'}`;
const load = (store) => { try { return JSON.parse(sessionStorage.getItem(keyFor(store)) || '[]'); } catch { return []; } };
const save = (store, lines) => { try { sessionStorage.setItem(keyFor(store), JSON.stringify(lines.slice(-KEEP))); } catch { /* private mode */ } };

/**
 * Ian's words: escaped, line breaks kept, and a listing link drawn as a link to its site. Only an
 * address a tool gave this turn (the server sends them as `links`) becomes a link; any other address
 * in the text stays text, so a model can never put a link in front of a member that the board did not.
 */
function words(text, links = []) {
  const ok = new Set(links);
  return escapeHtml(text).replace(/https?:\/\/[^\s<]+[^\s<.,;:)!?]/g, (u) => {
    const raw = u.replace(/&amp;/g, '&');
    const safe = ok.has(raw) ? safeUrl(raw) : null;
    if (!safe) return u;
    let host = ''; try { host = new URL(safe).hostname.replace(/^www\./, ''); } catch { /* not a URL */ }
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(host || 'the listing')} ↗</a>`;
  }).replace(/\n/g, '<br>');
}

/** What a card says and does, from the store alone. Null when the store does not know the ids. */
function cardModel(c, store, plan = {}) {
  if (c.action === 'plan_change') {
    if (!c.plan || !Object.keys(c.plan).length) return null;
    return { head: changeWords(c.plan, plan, store), sub: 'Ian keeps what you told him and asks before changing it.', button: 'Change it' };
  }
  const stay = c.stay_id ? store.stay(c.stay_id) : null;
  const dates = c.from && c.to ? shortRange(c.from, c.to) : '';
  if (c.action === 'create_crew') {
    if (!stay) return null;
    return { head: `Start a crew: ${c.name}`, sub: `${stay.name} · ${dates}${c.about ? ` · ${c.about}` : ''}`, button: 'Start the crew' };
  }
  if (c.action === 'invite') {
    const who = store.member(c.member_id), crew = store.crew(c.crew_id);
    if (!who || !crew) return null;
    const first = who.name.split(' ')[0];
    return { head: `Add ${first} to ${crew.name}`, sub: 'They see the crew and its thread from the moment you add them.', button: `Add ${first}` };
  }
  if (c.action === 'refresh') {
    if (!stay) return null;
    return { head: `Look again at ${stay.name}`, sub: 'The watcher re-reads RedWeek, and Interval within its limits. Ask Ian again in a minute.', button: 'Look again' };
  }
  if (c.action === 'watch') {
    if (!stay) return null;
    return { head: `Watch for a better week at ${stay.name}`, sub: `${dates} · ${c.nights} nights · ${c.guests} ${c.guests === 1 ? 'guest' : 'guests'}`, button: 'Watch for it' };
  }
  if (c.action === 'ask_dates') {
    if (!stay) return null;
    const deal = c.deal_id ? store.liveDeals().find(d => d.id === c.deal_id) : null;
    // Who is travelling and the member's note ride to the ask form, which reads both; they still press send.
    const extra = `${c.guests ? `&guests=${encodeURIComponent(c.guests)}` : ''}${c.note ? `&note=${encodeURIComponent(c.note)}` : ''}`;
    return { head: deal ? 'Ask Victor for this week' : `Ask Victor for ${stay.name}`, sub: [deal ? '' : dates, c.guests ? `${c.guests} ${c.guests === 1 ? 'guest' : 'guests'}` : '', c.note || ''].filter(Boolean).join(' · '), deal, button: 'Ask for these dates',
      href: (deal ? askHrefFor(deal) : `#/book/${encodeURIComponent(stay.id)}?from=${encodeURIComponent(c.from)}&to=${encodeURIComponent(c.to)}`) + extra };
  }
  return null;
}

export function concierge({ store, go, query = {} }) {
  const me = store.me;
  const stay = query.stay ? store.stay(query.stay) : null;
  let lines = load(store);
  let busy = false;

  const wrap = el(`<div><section class="sec"><div class="wrap">
      <h1>${stay ? `Ask Ian about ${escapeHtml(stay.name)}` : 'Ask Ian'}</h1>
      <p class="lede" style="margin-top:var(--s-2)">The Circle’s concierge. Ian reads the board and the places as you see them,
        and says where a figure comes from. Victor still books every room himself.</p>
      <div id="trip-slot"></div>
      <div class="thread" id="thread"></div>
      <div class="act-bar">
        <form id="say" class="say-row">
          <input name="body" placeholder="${stay ? 'What would you like to know?' : 'Cheapest week in December?'}" maxlength="2000"
                 autocomplete="off" enterkeyhint="send">
          <button class="btn" type="submit" aria-label="Send"
                  style="width:44px;min-height:44px;flex:none">${icon('send', { size: 17 })}</button>
        </form>
      </div>
    </div></section></div>`);
  const thread = wrap.querySelector('#thread');
  const trip = tripPanel({ store });
  wrap.querySelector('#trip-slot').replaceWith(trip);

  const bubble = (l, i) => {
    if (l.role === 'user') return `<div class="msg mine"><span class="bubble"><span class="what">${escapeHtml(l.text)}</span></span></div>`;
    if (l.role === 'note') return `<p class="small muted" style="text-align:center">${escapeHtml(l.text)}</p>`;
    const said = l.text ? `<div class="msg"><span class="bubble"><b class="who">Ian</b><span class="what">${words(l.text, l.links)}</span></span></div>` : '';
    const cards = (l.cards || []).map((c, j) => {
      const m = cardModel(c, store, trip.current());
      if (!m || c.state === 'no') return '';
      return `<div class="msg" data-line="${i}" data-card="${j}"><div class="bubble bubble-card" style="width:min(100%, 46ch)">
          <b class="who">Ian suggests</b>
          <span class="what"><b>${escapeHtml(m.head)}</b>${m.sub ? `<br><span class="small muted">${escapeHtml(m.sub)}</span>` : ''}</span>
          ${m.deal ? '<ul class="listing" data-deal-slot style="margin:var(--s-2) 0 0;padding:0"></ul>' : ''}
          ${c.state === 'done'
            ? `<p class="small muted" style="margin-top:var(--s-2)">${icon('check', { size: 14 })} Done.</p>`
            : `<div class="row" style="margin-top:var(--s-3);gap:var(--s-4)">
                <button type="button" class="btn sm" data-go>${escapeHtml(m.button)}</button>
                <button type="button" class="link-rule" data-no>Not now</button></div>`}
        </div></div>`;
    }).join('');
    // "Helped" / "Not it": once, then a quiet thank-you. "Not it" asks, optionally, what was wanted.
    const fb = !l.turnId ? '' : l.fb
      ? `<p class="tiny muted" style="margin:-2px 0 0 4px">${l.fb === 1 ? 'Thanks.' : 'Thanks — that goes to the people who teach Ian.'}</p>`
      : l.asking
        ? `<form class="say-row" data-why="${i}" style="margin:0 0 0 4px"><input name="why" maxlength="200" placeholder="What were you after? (optional)" autocomplete="off" enterkeyhint="send">
            <button class="btn ghost sm" type="submit" style="width:auto;border-radius:var(--r-btn);padding:0 var(--s-3)">Send</button></form>`
        : `<div class="row" style="gap:var(--s-4);margin:-2px 0 0 4px"><button type="button" class="link-rule" data-fb="1" data-i="${i}">Helped</button><button type="button" class="link-rule" data-fb="-1" data-i="${i}">Not it</button></div>`;
    // One answer is one block, so it can be brought into view whole: words, cards and the two taps.
    return `<div class="ian-turn" data-turn="${i}">${said}${cards}${fb}</div>`;
  };

  const draw = () => {
    thread.innerHTML = lines.length
      ? lines.map(bubble).join('')
      : `<p class="small muted">Ask what is cheapest when you want to go, whether a week on the board is a good price,
          or to start a crew for a trip. Ian only says figures it can point to.</p>`;
    // The board's own row inside a card, drawn by the board's own function.
    thread.querySelectorAll('[data-deal-slot]').forEach((slot) => {
      const box = slot.closest('[data-card]');
      const c = lines[box.dataset.line].cards[box.dataset.card];
      const deal = store.liveDeals().find(d => d.id === c.deal_id);
      if (deal) slot.appendChild(dealRow(deal, { store, level: 3 }));
    });
    if (busy) thread.insertAdjacentHTML('beforeend', '<div class="msg"><span class="bubble"><b class="who">Ian</b><span class="what muted">Looking…</span></span></div>');
  };
  const toLatest = () => requestAnimationFrame(() => thread.lastElementChild?.scrollIntoView?.({ block: 'end', behavior: 'auto' }));
  /**
   * After an answer: the whole of it above the composer, down to Helped / Not it, when it fits on the
   * screen; when it does not, its first line under the running head, so it is read from the top.
   * The .ian-turn scroll margins in app.css are what keep it clear of the bar and the composer.
   */
  const toAnswer = () => requestAnimationFrame(() => {
    const turn = [...thread.querySelectorAll('.ian-turn')].at(-1);
    if (!turn) return toLatest();
    const top = document.getElementById('topbar')?.getBoundingClientRect().bottom || 0;
    const floor = wrap.querySelector('.act-bar')?.getBoundingClientRect().top ?? innerHeight;
    turn.scrollIntoView({ block: turn.getBoundingClientRect().height <= floor - top - 16 ? 'end' : 'start', behavior: 'auto' });
  });
  draw();
  if (lines.length) toLatest();

  const form = wrap.querySelector('#say');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const input = form.querySelector('[name=body]');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    lines.push({ role: 'user', text });
    busy = true; save(store, lines); draw(); toLatest();
    const send = form.querySelector('button[type=submit]');
    setBusy(send, true);
    try {
      const sent = lines.filter(l => l.role === 'user' || l.role === 'assistant').slice(-SEND).map(l => ({ role: l.role, text: l.text || '' }));
      const out = await store.concierge(sent, { stay: stay?.id || null });
      lines.push({ role: 'assistant', text: out?.reply || '', cards: out?.cards || [], links: out?.links || [], turnId: out?.turn_id || null });
    } catch (err) {
      lines.push({ role: 'note', text: err.message });
    } finally {
      busy = false; setBusy(send, false); save(store, lines); draw(); toAnswer();
      trip.reload();                        // Ian may have filled a blank in the plan
    }
  });

  /** A "Thanks" that did not reach the Circle is taken back, so the taps come back too. */
  const unsaid = (l) => (err) => { l.fb = null; save(store, lines); draw(); toast(err?.message || 'That did not reach the Circle. Try again.', { kind: 'bad' }); };

  thread.addEventListener('click', async (e) => {
    const fbBtn = e.target.closest('[data-fb]');
    if (fbBtn) {
      const l = lines[fbBtn.dataset.i];
      if (fbBtn.dataset.fb === '-1') { l.asking = true; save(store, lines); draw(); thread.querySelector(`[data-why="${fbBtn.dataset.i}"] input`)?.focus(); }
      else { l.fb = 1; save(store, lines); draw(); store.conciergeFeedback(l.turnId, 1).catch(unsaid(l)); }
      return;
    }
    const box = e.target.closest('[data-card]');
    if (!box) return;
    const c = lines[box.dataset.line].cards[box.dataset.card];
    if (e.target.closest('[data-no]')) { c.state = 'no'; save(store, lines); draw(); return; }
    const b = e.target.closest('[data-go]'); if (!b) return;
    const m = cardModel(c, store, trip.current()); if (!m) return;
    if (c.action === 'ask_dates') { location.hash = m.href; return; }
    // A change to the trip is the member's to make: this tap is it.
    if (c.action === 'plan_change') { await trip.apply(c.plan); c.state = 'done'; save(store, lines); draw(); toast('Your trip is updated.', { kind: 'good' }); return; }
    // The member's own tap is what spends the watcher's read, never Ian's suggestion of one.
    if (c.action === 'refresh') { store.noteStayLook?.(c.stay_id); c.state = 'done'; save(store, lines); draw(); toast('Asked. Ask Ian again in a minute.', { kind: 'good' }); return; }
    const yes = await confirmDialog({ title: m.head, message: m.sub || 'Nothing is booked and no points move.', confirmText: m.button });
    if (!yes) return;
    setBusy(b, true);
    try {
      if (c.action === 'create_crew') {
        const made = await store.createCrew({ name: c.name, about: c.about || '', redemptionId: c.redemption_id || null, stayId: c.stay_id, from: c.from, to: c.to });
        c.state = 'done'; save(store, lines);
        toast(`${made.name} it is.`, { kind: 'good' });
        go(`/crews/${made.id}`);
        return;
      }
      if (c.action === 'watch') {
        await store.addWatch({ memberId: store.me?.id, stayId: c.stay_id, from: c.from, to: c.to, nights: c.nights, guests: c.guests, flexDays: 3 });
        c.state = 'done'; save(store, lines); draw();
        toast('Watching. A week that fits shows on Stays and under What you are watching.', { kind: 'good' });
        return;
      }
      await store.addToCrew(c.crew_id, c.member_id);
      c.state = 'done'; save(store, lines); draw();
      toast(`${store.member(c.member_id)?.name.split(' ')[0]} is in.`, { kind: 'good' });
    } catch (err) { setBusy(b, false); toast(err.message, { kind: 'bad' }); }
  });

  thread.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-why]'); if (!f) return;
    e.preventDefault();
    const l = lines[f.dataset.why];
    const note = f.querySelector('[name=why]').value.trim();
    l.fb = -1; l.asking = false; save(store, lines); draw();
    store.conciergeFeedback(l.turnId, -1, note).catch(unsaid(l));
  });

  return wrap;
}
