// The SAN: one rotating round of florin among people already in the Circle.
//
// 250 florin from each person, every month of the round. The pot — hands times 250 —
// is handed to one person, once, on their month. The person who opens the round is
// month 1. Everyone else asks for a later month, and the organizer confirms one person
// per month. When every month has a person, the round is full and the calendar starts.
// Marking a month paid is a confirmation that the pot was handed over. It is not a
// transfer, not points, and not the Reserve.
import { escapeHtml, fmtFlorin, fmtMonth, addMonths, arubaDate } from '../core/util.js';
import { SAN_MONTHLY_AWG } from '../core/store.js';
import { toast, sheet, confirmDialog, setBusy } from '../ui/components.js';
import { icon } from '../ui/icons.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const num = (text) => `<b class="num">${escapeHtml(String(text ?? ''))}</b>`;
const first = (name) => String(name || 'Someone').split(' ')[0];

/** The calendar month of a hand, only after the round has started. */
function handWhen(round, hand) {
  if (!round?.startedAt) return '';
  const start = arubaDate(round.startedAt).slice(0, 7);
  return fmtMonth(addMonths(start, hand - 1));
}

export function san({ store }) {
  const me = store.me;
  const round = store.currentSan();
  const monthly = round?.monthlyAwg || SAN_MONTHLY_AWG;
  const rule = `You pay ${num(monthly)} florin every month of the round and you receive the pot once, on your month.`;

  const wrap = el(`<div><section class="sec"><div class="wrap">
    <p class="eyebrow">${icon('banknote')}The SAN</p>
    <h1>A round of florin</h1>
    <p class="lede">${rule}</p>
    <div id="body"></div>
  </div></section></div>`);

  const body = wrap.querySelector('#body');
  if (!round) {
    const last = store.sanRounds().at(-1);
    body.appendChild(el(`<div>
      <p class="hero-figure" style="margin-top:var(--s-4)">${escapeHtml(fmtFlorin(monthly))}</p>
      <p class="dateline">Each month, from every person in the round. The pot is that amount times the number of months, fixed when the round opens.</p>
      ${last ? `<p class="small" style="margin-top:var(--s-4)">The last round has finished. Every month was marked paid.</p>` : ''}
      <div class="panel empty">
        <h2>No round is open</h2>
        <p class="small muted">The person who opens one holds month 1 and names how many months this round runs. When every month has a person, the round is full and nobody else joins it.</p>
      </div>
      <button type="button" class="btn block" id="open-san">Open a round</button>
    </div>`));
    wrap.querySelector('#open-san').addEventListener('click', () => openSheet(store));
    return wrap;
  }

  const seats = store.sanSeats(round.id);
  const pending = store.sanPending(round.id);
  const pot = store.sanPotAwg(round);
  const started = store.sanStarted(round);
  const next = store.sanNextHand(round);
  const mine = seats.find(s => s.memberId === me.id);
  const myAsk = pending.find(r => r.memberId === me.id);
  const organizer = round.organizerId === me.id;
  const canPay = started && next && (organizer || store.canBank());
  const openSeats = seats.filter(s => s.hand > 1 && !s.memberId);
  const canAsk = !started && !mine && !myAsk && openSeats.length > 0;

  const monthLine = (seat) => {
    const who = seat.memberId ? store.member(seat.memberId) : null;
    const when = started ? handWhen(round, seat.hand) : '';
    let meta;
    let state = 'open';
    if (seat.hand === 1) {
      state = 'locked';
      meta = seat.memberId === me.id
        ? 'You opened the round. Month 1 stays with you.'
        : `${who?.name || 'The organizer'} opened the round. Month 1 stays with them.`;
    } else if (!who) {
      const asks = pending.filter(r => r.hand === seat.hand).length;
      meta = asks ? `${asks === 1 ? '1 person has' : `${asks} people have`} asked for it` : 'Open';
    } else if (seat.paidAt) {
      state = 'paid';
      meta = `${seat.memberId === me.id ? 'You' : who.name} received the pot. Marked paid.`;
    } else {
      state = 'held';
      meta = seat.memberId === me.id ? 'Yours. One person to this month.' : `${who.name}. Taken.`;
    }
    const askable = state === 'open' && canAsk;
    const body = `<span class="what"><b>Month ${num(seat.hand)}</b>
        <span class="meta">${escapeHtml(meta)}${when ? ` · ${escapeHtml(when)}` : ''}</span></span>`;
    const control = askable
      ? `<label class="row" style="width:100%"><input type="radio" name="hand" value="${seat.hand}" data-request="${seat.hand}"${seat.hand === openSeats[0].hand ? ' checked' : ''}>${body}</label>`
      : body;
    return `<li data-hand="${seat.hand}" data-state="${state}">${control}</li>`;
  };

  let nextLine = '';
  if (next) {
    const who = store.member(next.memberId);
    const when = handWhen(round, next.hand);
    const anyPaid = seats.some(s => s.paidAt);
    const whoName = first(who?.name);
    nextLine = anyPaid
      ? `Next is month ${num(next.hand)}, ${escapeHtml(whoName)}.${when ? ` ${escapeHtml(when)}.` : ''}`
      : `This month is ${escapeHtml(whoName)}'s.${when ? ` ${escapeHtml(when)}.` : ''}`;
  }

  body.innerHTML = `
    <p class="hero-figure" style="margin-top:var(--s-4)">${escapeHtml(fmtFlorin(pot))}</p>
    <p class="dateline">The pot · ${num(round.hands)} months · ${num(fmtFlorin(monthly))} from each person, each month. Fixed when the round opens.${started ? '' : ' The calendar starts when every month has a person.'}</p>
    ${mine ? `<p style="margin-top:var(--s-3)">You hold month ${num(mine.hand)}.</p>` : ''}
    ${myAsk ? `<p style="margin-top:var(--s-3)">You asked for month ${num(myAsk.hand)}. The organizer has not confirmed it.</p>` : ''}
    ${nextLine ? `<p style="margin-top:var(--s-3)">${nextLine}</p>` : ''}
    <ul class="ledger" id="months" style="margin-top:var(--s-3)">${seats.map(monthLine).join('')}</ul>
    <div id="act" style="margin-top:var(--s-3)"></div>`;

  const act = body.querySelector('#act');

  if (organizer && !started) {
    if (!pending.length) {
      act.appendChild(el(`<p class="small muted">Nobody has asked for a month yet.</p>`));
    } else {
      const picks = el(`<div id="asks"></div>`);
      picks.innerHTML = `<p class="eyebrow">Requests</p><ul class="ledger">${pending.map((r, i) => {
        const who = store.member(r.memberId);
        return `<li><label class="row" style="width:100%"><input type="radio" name="req" value="${escapeHtml(r.id)}" data-request="${escapeHtml(r.id)}"${i === 0 ? ' checked' : ''}>
          <span class="what"><b>${escapeHtml(who?.name || 'A member')}</b><span class="meta">Month ${num(r.hand)}</span></span></label></li>`;
      }).join('')}</ul>
        <button type="button" class="btn block" id="confirm" style="margin-top:var(--s-3)">Confirm</button>`;
      act.appendChild(picks);
      const btn = picks.querySelector('#confirm');
      const sync = () => {
        const id = picks.querySelector('input[name=req]:checked')?.value;
        const row = pending.find(r => r.id === id);
        btn.innerHTML = row ? `<span>Confirm month ${num(row.hand)}</span>` : 'Confirm';
      };
      sync();
      picks.addEventListener('change', sync);
      btn.addEventListener('click', async (e) => {
        const id = picks.querySelector('input[name=req]:checked')?.value;
        if (!id) { toast('Choose a request first.', { kind: 'bad' }); return; }
        const row = pending.find(r => r.id === id);
        setBusy(e.currentTarget, true, 'Confirming…');
        try {
          await store.confirmSanRequest(id);
          toast(`Month ${row?.hand} is taken.`);
        } catch (err) { setBusy(e.currentTarget, false); toast(err.message, { kind: 'bad' }); }
      });
    }
  } else if (canAsk) {
    const firstHand = openSeats[0].hand;
    act.appendChild(el(`<button type="button" class="btn block" id="request"><span>Request month ${num(firstHand)}</span></button>`));
    const btn = act.querySelector('#request');
    const sync = () => {
      const hand = wrap.querySelector('input[name=hand]:checked')?.value;
      btn.innerHTML = hand ? `<span>Request month ${num(hand)}</span>` : '<span>Request this month</span>';
    };
    wrap.querySelector('#months').addEventListener('change', sync);
    btn.addEventListener('click', async (e) => {
      const hand = Number(wrap.querySelector('input[name=hand]:checked')?.value);
      if (!hand) { toast('Choose a month first.', { kind: 'bad' }); return; }
      setBusy(e.currentTarget, true, 'Asking…');
      try {
        await store.requestSanHand(round.id, hand);
        toast(`You asked for month ${hand}.`);
      } catch (err) { setBusy(e.currentTarget, false); toast(err.message, { kind: 'bad' }); }
    });
  } else if (myAsk) {
    act.appendChild(el(`<button type="button" class="btn ghost" id="withdraw">Withdraw the request</button>`));
    act.querySelector('#withdraw').addEventListener('click', async (e) => {
      setBusy(e.currentTarget, true, 'Withdrawing…');
      try { await store.withdrawSanRequest(myAsk.id); toast('Request withdrawn.'); }
      catch (err) { setBusy(e.currentTarget, false); toast(err.message, { kind: 'bad' }); }
    });
  } else if (canPay) {
    const who = store.member(next.memberId);
    act.appendChild(el(`<div>
      <button type="button" class="btn block" id="paid"><span>Mark month ${num(next.hand)} paid</span></button>
      <p class="small muted" style="margin-top:var(--s-3)">This records that the pot was handed to ${escapeHtml(first(who?.name))}. It does not move points and it does not touch the Reserve.</p>
    </div>`));
    act.querySelector('#paid').addEventListener('click', async (e) => {
      const yes = await confirmDialog({
        title: `Mark month ${next.hand} paid?`,
        message: `This records that the pot was handed to ${who?.name || 'that person'}. It does not move points and it does not touch the Reserve.`,
        confirmText: 'Mark it paid',
      });
      if (!yes) return;
      setBusy(e.currentTarget, true, 'Saving…');
      try { await store.markSanHandPaid(round.id, next.hand); toast(`Month ${next.hand} is marked paid.`); }
      catch (err) { setBusy(e.currentTarget, false); toast(err.message, { kind: 'bad' }); }
    });
  }

  return wrap;
}

async function openSheet(store) {
  const made = await sheet({
    title: 'Open a round',
    render: (body, close) => {
      body.innerHTML = `
        <p class="sheet-text">You hold month 1. Name how many months this round runs. That number is the size of the round. Each person pays ${num(SAN_MONTHLY_AWG)} florin every month and receives the pot once.</p>
        <label class="field"><span>Months</span>
          <input name="hands" inputmode="numeric" required min="2" max="120" placeholder="4" autocomplete="off">
          <span class="hint">At least 2. Once every month has a person, nobody else can join.</span></label>
        <div class="sheet-actions">
          <button class="btn" data-ok>Open it</button>
        </div>`;
      body.querySelector('[data-ok]').addEventListener('click', async (e) => {
        const hands = Number(body.querySelector('[name=hands]').value);
        setBusy(e.currentTarget, true, 'Opening…');
        try {
          const round = await store.openSan(hands);
          close(round);
          toast(`A ${round.hands}-month round is open. Month 1 is yours.`);
        } catch (err) { setBusy(e.currentTarget, false); toast(err.message, { kind: 'bad' }); }
      });
    },
  });
  return made;
}
