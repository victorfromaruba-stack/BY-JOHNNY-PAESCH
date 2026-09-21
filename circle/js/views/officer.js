// The officers' screens — the Banker's inbox and month close, the Desk, settings —
// plus the two everyone can see: the Circle and the Pool.
import { countdownTo, downloadText, escapeHtml, fmtAfl2, fmtDay, fmtDayTime, fmtMonth, fmtPct, fmtPoints, fmtUsd2, initials, monthKey, pointsUsd, safeUrl, sum, toCsv } from '../core/util.js';
import { VOCAB, tierName } from '../core/vocab.js';
import { splitContribution, tierFor, fromPoints, seatPoints, RATE_BAND_LIST } from '../core/money.js';
import { poolGauge, rankCrest, ring } from '../ui/pieces.js';
import { toast, sheet, confirmDialog, setBusy, chip, statusLabel, avatar } from '../ui/components.js';
import { columns } from '../ui/charts.js';
import { waLink, TEMPLATES, copyText, shareText } from '../core/share.js';
import { quoteSheet, bookSheet } from './catalog.js';
import { photoFor } from './public.js';
import { roomPhotosFor } from './rooms.js';
import { icon } from '../ui/icons.js';

// The Desk's open tab survives a re-render: saving a stay commits, a commit repaints the route,
// and the tab used to snap back to Requests with the row just saved out of sight.
let DESK_TAB = 'requests';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };

// ---------------------------------------------------------------- the Banker
export function bank({ store, go }) {
  const me = store.me, s = store.settings;
  const t = store.treasury();
  const pending = store.pendingContributions();
  const month = monthKey();
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">${icon('inbox')}${escapeHtml(VOCAB.treasurerTitle)}</p>
      <h1>The inbox</h1>
      <p class="dateline"><b class="num">${pending.length}</b> waiting · <b class="num">${escapeHtml(fmtUsd2(t.pendingUsd))}</b> marked as sent
        · <b class="num">${t.confirmedThisMonth} / ${t.expectedThisMonth}</b> confirmed for ${escapeHtml(fmtMonth(month))}</p>
      ${pending.length ? `
      <button class="btn good block no-print" id="confirm-all" style="margin-top:var(--s-4)">Confirm all <b class="num">${pending.length}</b></button>
      <p class="small muted" style="margin-top:var(--s-2)">Only confirm what you can see on the statement.</p>
      <div class="row no-print" style="margin-top:var(--s-1)">
        <button class="link-rule" id="record" type="button">Money came in</button>
        <a class="link-rule" href="#/bank/close/${month}">Close ${escapeHtml(fmtMonth(month))}</a>
      </div>` : `
      <button class="btn block no-print" id="record" type="button" style="margin-top:var(--s-4)">${icon('banknote', { size: 16 })}Money came in</button>
      <div class="row no-print" style="margin-top:var(--s-1)">
        <a class="link-rule" href="#/bank/close/${month}">Close ${escapeHtml(fmtMonth(month))}</a>
      </div>`}
      <div class="stack" id="queue" style="margin-top:var(--s-5)"></div>
      <div class="panel" style="margin-top:var(--s-5)">
        <h2>Not sent yet this month</h2>
        <p class="small muted" style="margin-top:6px">Only you and Ian see this. Nobody is ever shown a public late list.</p>
        <div class="row" style="margin-top:12px" id="missing"></div>
      </div>
      <!-- "Verified" was doing a lot of work it had not earned: t.coverage is the ledger over its
           own liability, so the word described arithmetic, not a bank statement. Say what the
           bank actually said, and on what date — this agrees with the gauge word for word. -->
      <div class="rule-block small muted">
        <p>Reserve <b class="num">${escapeHtml(fmtUsd2(t.reserveUsd))}</b> by the ledger, behind <b class="num">${escapeHtml(fmtPoints(t.outstandingPoints))}</b>.</p>
        <p style="margin-top:6px">Coverage <b class="num">${escapeHtml(fmtPct(t.liabilityUsd && t.verified ? (t.reserveUsd + (t.verifiedVarianceUsd || 0)) / t.liabilityUsd : t.coverage))}</b> — ${t.verified
          ? `the bank said <b class="num">${escapeHtml(fmtUsd2(t.verified.balanceUsd))}</b> on <b class="num">${escapeHtml(fmtDay(t.verified.at))}</b>${Math.abs(t.verifiedVarianceUsd || 0) < 0.005 ? ' and the ledger agreed' : `, <b class="num">${escapeHtml(fmtUsd2(Math.abs(t.verifiedVarianceUsd)))}</b> ${t.verifiedVarianceUsd > 0 ? 'more' : 'less'} than the ledger expected`}.`
          : 'from the ledger, never checked against the bank.'}</p>
      </div>
    </div></section></div>`);

  const queue = wrap.querySelector('#queue');
  if (!pending.length) queue.appendChild(el(`<div class="empty">${icon('checkCircle', { size: 28, cls: 'ico-muted' })}<b style="display:block">Nothing waiting</b><p class="small muted">Every transfer marked as sent has been confirmed or returned. ${escapeHtml(VOCAB.pap.thanks[0])}.</p></div>`));
  for (const c of pending) {
    const m = store.member(c.memberId);
    const row = el(`<div class="panel" data-id="${c.id}">
        <div class="row" style="gap:10px;flex-wrap:nowrap;align-items:flex-start">
          ${avatar(m, 28)}
          <div style="min-width:0"><b>${escapeHtml(m.name)}</b> · ${escapeHtml(tierName(m.monthlyUsd))}
            <br><span class="small muted">${c.extra ? 'Extra, not a monthly' : escapeHtml(fmtMonth(c.forMonth))} · sent ${escapeHtml(fmtDay(c.submittedAt))} · ${escapeHtml(c.bank || c.method || 'bank transfer')}${c.recordedBy ? ' · entered by the Banker' : ''}</span></div>
          <div style="margin-left:auto;text-align:right;flex:none"><b class="num fig">${escapeHtml(fmtUsd2(c.expectedUsd))}</b>
            <br><span class="small muted num">${escapeHtml(fmtAfl2(c.expectedUsd, s.awgPerUsd))}</span></div>
        </div>
        <div class="copyline" style="margin-top:12px"><code class="num">${escapeHtml(c.reference || 'no reference given')}</code>
          <button class="btn ghost sm" data-copy="${escapeHtml(c.reference || '')}">Copy</button></div>
        ${c.note ? `<p class="small muted" style="margin-top:10px">“${escapeHtml(c.note)}”</p>` : ''}
        ${(c.proofName || c.proofPath || c.proofDataUrl) ? `<div class="row"><button class="link-rule" type="button" data-proof="${escapeHtml(c.id)}">See the screenshot</button></div>` : ''}
        <button class="btn good block" data-act="confirm" style="margin-top:var(--s-2)">Confirm <b class="num">${escapeHtml(fmtUsd2(c.expectedUsd))}</b></button>
        <div class="row" style="margin-top:var(--s-1)">
          <button class="link-rule" type="button" data-act="partial">A different amount arrived</button>
          <button class="link-rule danger" type="button" data-act="return">Return it</button>
        </div>
      </div>`);
    row.addEventListener('click', async (e) => {
      const copy = e.target.closest('[data-copy]');
      if (copy) { const ok = await copyText(copy.dataset.copy); toast(ok ? 'Copied.' : 'Select and copy it by hand.'); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      try {
        if (b.dataset.act === 'confirm') await confirmOne(store, c, m);
        if (b.dataset.act === 'partial') {
          const out = await sheet({ title: `What actually arrived from ${m.name.split(' ')[0]}?`, render: (body, close) => {
            body.innerHTML = `<p class="sheet-text">Points follow the money that arrived, not what was expected. A short month does not earn the tier bonus and does not extend a streak.</p>
              <div class="pair">
                <label class="field"><span>Amount received</span><input name="amt" type="number" step="0.01" value="${c.expectedUsd}" inputmode="decimal"></label>
                <label class="field"><span>Currency</span><select name="cur"><option value="USD">US dollars</option><option value="AWG">Aruban florin</option></select></label>
              </div>
              <label class="field"><span>Note for the ledger</span><input name="note" placeholder="Bank fee deducted at the sending side."></label>
              <div id="prev" class="notice"></div>
              <div class="sheet-actions"><button class="btn good block" data-ok>Confirm that amount</button></div>`;
            const prev = body.querySelector('#prev');
            const calc = () => {
              const cur = body.querySelector('[name=cur]').value;
              const raw = Number(body.querySelector('[name=amt]').value) || 0;
              const usd = cur === 'AWG' ? Math.round((raw / s.awgPerUsd) * 100) / 100 : raw;
              const sp = splitContribution(usd, s, tierFor(s, m.monthlyUsd));
              prev.innerHTML = `<b>${escapeHtml(fmtPoints(sp.points))} (${escapeHtml(fmtUsd2(sp.points / s.pointsPerDollar))})</b>
                <p class="small">${escapeHtml(fmtUsd2(usd))} received · all of it to the Reserve${sp.full ? '' : ' · short of the tier, so no bonus this month'}</p>`;
              return { usd, cur };
            };
            calc(); body.addEventListener('input', calc);
            body.querySelector('[data-ok]').addEventListener('click', () => { const { usd, cur } = calc(); close({ receivedUsd: usd, currency: cur, note: body.querySelector('[name=note]').value }); });
          } });
          if (out) { await store.confirmContribution(c.id, me.id, out); undoToast(store, c.id, me.id); }
        }
        if (b.dataset.act === 'return') {
          const reason = await confirmDialog({ title: `Return ${m.name.split(' ')[0]}’s transfer`, requireReason: true, danger: true, confirmText: 'Return it',
            reasonLabel: 'What should they fix? They read this word for word.',
            message: 'Nothing is minted. Ian can send them the reason, and they can mark it as sent again once it is fixed.' });
          if (reason) { await store.rejectContribution(c.id, me.id, reason); toast('Returned with your reason.'); }
        }
      } catch (err) { toast(err.message, { kind: 'bad', timeout: 6000 }); }
    });
    queue.appendChild(row);
  }
  wrap.querySelector('#record')?.addEventListener('click', () => recordMoneySheet({ store, go }));

  // The screenshot is what the Banker actually confirms the money against. On the real
  // backend it lives in private storage and needs a signed URL; in preview it is a data URL
  // on the row itself.
  wrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-proof]'); if (!btn) return;
    const c = store.contribution(btn.dataset.proof);
    if (!c) return;
    setBusy(btn, true, 'Opening…');
    try {
      const src = c.proofDataUrl || (c.proofPath ? await store.proofUrl(c.proofPath) : null);
      if (!src) throw new Error('That screenshot is no longer stored.');
      await sheet({ title: c.proofName || 'The screenshot', tall: true, render: (body) => {
        body.innerHTML = `<img src="${escapeHtml(src)}" alt="The transfer screenshot as it was sent" loading="lazy" decoding="async"
            style="width:100%;border-radius:var(--r-input);border:1px solid var(--hairline)">
          <div class="sheet-actions">
            <a class="btn block" href="${escapeHtml(src)}" target="_blank" rel="noopener">${icon('external', { size: 16 })}Open it full size</a></div>`;
      } });
    } catch (err) { toast(err.message, { kind: 'bad', timeout: 6000 }); }
    finally { setBusy(btn, false); }
  });
  wrap.querySelector('#confirm-all')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const yes = await confirmDialog({ title: `Confirm all ${pending.length}?`, confirmText: 'Confirm them', message: 'Only do this once you have matched every reference on the bank statement. Each one can still be undone for a minute afterwards.' });
    if (!yes) return;
    // Count what actually happened. This used to toast "12 confirmed" whatever the outcome —
    // the connection drops at number three, nine red toasts fade in four seconds, and a green
    // "12 confirmed. Points are minted and dated." is what the Banker closes the app on.
    setBusy(btn, true, 'Confirming…');
    let done = 0; const failed = [];
    try {
      for (const c of pending) {
        try { await store.confirmContribution(c.id, me.id, {}); done++; }
        catch (err) {
          failed.push(`${store.member(c.memberId)?.name.split(' ')[0] || 'one'}: ${err.message}`);
          // A dead connection will fail every remaining one the same way; stop and say so.
          if (/not answering|fetch|network|connection|timeout/i.test(err.message)) break;
        }
      }
    } finally { setBusy(btn, false); }
    if (!failed.length) toast(`${done} confirmed. Points are minted and dated.`, { kind: 'good' });
    else toast(`${done} confirmed · ${pending.length - done} not — ${failed[0]}${failed.length > 1 ? ` (and ${failed.length - 1} more)` : ''}`, { kind: 'bad', timeout: 10000 });
  });
  const missing = store.expectedMembers(month).filter(m2 => store.monthStatus(m2.id, month) === 'due');
  wrap.querySelector('#missing').innerHTML = missing.length
    ? missing.map(m2 => `<a class="btn ghost sm" target="_blank" rel="noopener"
        href="${escapeHtml(waLink(m2.phone, TEMPLATES.reminder({ member: m2, amountUsd: m2.monthlyUsd, month, reference: `${VOCAB.refPrefix}-${initials(m2.name)}-${month}`, v: VOCAB })))}">
        ${escapeHtml(m2.name)} · ${escapeHtml(fmtUsd2(m2.monthlyUsd))}</a>`).join('')
    : '<span class="small muted">Everyone has sent this month.</span>';
  return wrap;
}

/**
 * Money that never went through the queue: cash across a table, a transfer the Banker
 * matched himself, someone catching up a month they missed. He types the amount, sees
 * exactly what it mints before he commits, and it lands in the ledger with his name on it.
 */
export async function recordMoneySheet({ store, go, memberId = null }) {
  const s = store.settings;
  const people = store.people().filter(m => m.status !== 'left').sort((a, b) => a.name.localeCompare(b.name));
  const out = await sheet({
    title: 'Money came in',
    render: (body, close) => {
      body.innerHTML = `
        <p class="sheet-text">Use this when the money reached you outside the app — cash in your hand, a transfer you spotted on the statement, or someone paying for a month they missed. It mints the points the same way a normal contribution does, and it shows up on their ledger with your name on it.</p>
        <label class="field"><span>From whom</span>
          <select name="memberId" required>${people.map(m => `<option value="${escapeHtml(m.id)}"${m.id === memberId ? ' selected' : ''}>${escapeHtml(m.name)} · ${escapeHtml(fmtUsd2(m.monthlyUsd))} a month</option>`).join('')}</select></label>
        <div class="pair">
          <label class="field"><span>Amount</span><input name="amount" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="300" required></label>
          <label class="field"><span>Currency</span><select name="currency"><option value="USD">US dollars</option><option value="AWG">Aruban florin</option></select></label>
        </div>
        <label class="field"><span>How it came</span><select name="method">
          <option value="cash">Cash</option><option value="bank">Bank transfer</option>
          <option value="card">Card</option><option value="other">Some other way</option></select></label>
        <label class="field"><span>What is it for</span>
          <select name="forMonth"><option value="">Extra — on top of their monthly</option></select>
          <span class="hint" id="month-hint"></span></label>
        <label class="field"><span>Note for their ledger</span>
          <input name="note" placeholder="Cash at the shop, 6 September." required></label>
        <div id="prev" class="notice"></div>
        <div class="sheet-actions"><button class="btn good block" data-ok>${icon('check', { size: 16 })}Record it</button></div>`;

      const v = (n) => body.querySelector(`[name=${n}]`);
      const fillMonths = () => {
        const open = store.openMonthsFor(v('memberId').value);
        v('forMonth').innerHTML = `<option value="">Extra — on top of their monthly</option>`
          + open.map(m => `<option value="${m}">${escapeHtml(fmtMonth(m))} — a month they have not paid</option>`).join('');
        body.querySelector('#month-hint').textContent = open.length
          ? 'A month earns the tier bonus and can extend a streak. An extra buys points at the plain rate.'
          : 'They are up to date, so anything now is an extra: points at the plain rate, no bonus, no streak.';
      };
      const draw = () => {
        const m = store.member(v('memberId').value);
        const p = store.previewDirect(v('memberId').value, Number(v('amount').value) || 0,
          { forMonth: v('forMonth').value || null, currency: v('currency').value });
        if (!p.usd) { body.querySelector('#prev').innerHTML = '<b>Type the amount</b><p class="small">Nothing is minted until you tap Record.</p>'; return; }
        body.querySelector('#prev').innerHTML = `
          <b>${escapeHtml(fmtPoints(p.points))} for ${escapeHtml(m.name.split(' ')[0])}</b>
          <p class="small" style="margin-top:6px">
            ${escapeHtml(fmtUsd2(p.usd))} in · ${escapeHtml(fmtUsd2(p.backingUsd))} into the Reserve · nothing taken
            ${p.bonusPoints ? ` · ${escapeHtml(fmtPoints(p.bonusPoints))} tier bonus` : ''}
          </p>
          <p class="small muted" style="margin-top:6px">${p.extra
            ? 'An extra: base points only, no tier bonus, no streak, and it does not cover a month.'
            : p.full ? 'The whole tier amount, so it earns the bonus and counts towards their streak.'
                     : 'Short of their tier amount, so no bonus this month and the streak does not extend.'}</p>`;
      };
      body.addEventListener('input', draw);
      body.addEventListener('change', (e) => { if (e.target.name === 'memberId') fillMonths(); draw(); });
      fillMonths(); draw();

      body.querySelector('[data-ok]').addEventListener('click', () => {
        if (!v('note').value.trim()) { v('note').focus(); toast('A note, so they know what it was.', { kind: 'bad' }); return; }
        close({ memberId: v('memberId').value, amountUsd: Number(v('amount').value),
          currency: v('currency').value, method: v('method').value,
          forMonth: v('forMonth').value || null, note: v('note').value.trim() });
      });
    },
  });
  if (!out) return null;
  try {
    const usd = out.currency === 'AWG' ? Math.round((out.amountUsd / s.awgPerUsd) * 100) / 100 : out.amountUsd;
    const c = await store.recordDirectContribution({ ...out, amountUsd: usd }, store.me.id);
    const m = store.member(out.memberId);
    toast(`${VOCAB.pap.thanks[0]} · ${fmtPoints(c.points)} minted for ${m.name.split(' ')[0]}.`, { kind: 'good' });
    undoToast(store, c.id, store.me.id);
    return c;
  } catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); return null; }
}

async function confirmOne(store, c, m) {
  await store.confirmContribution(c.id, store.me.id, {});
  const fresh = store.contribution(c.id);
  toast(`${VOCAB.pap.thanks[0]} · ${fmtPoints(fresh.points)} minted for ${m.name.split(' ')[0]}.`, { kind: 'good' });
  undoToast(store, c.id, store.me.id);
}
function undoToast(store, id, actorId) {
  const t = toast('Confirmed. Undo?', { kind: 'good', timeout: store.settings.undoSeconds * 1000, action: { label: 'Undo', fn: async () => {
    try { await store.reverseContribution(id, actorId); toast('Undone. The whole transaction is reversed and it is back in your queue.'); }
    catch (err) { toast(err.message, { kind: 'bad' }); }
  } } });
  return t;
}

export function monthClose({ store, params, go }) {
  const me = store.me, s = store.settings;
  const month = params.month || monthKey();
  const p = store.closePreview(month);
  // people(), not members(): the watcher holds the Voice role so it can post a deal, and a
  // robot must never be offered as the second signature on a month close.
  const others = store.people().filter(m => m.id !== me.id && m.roles.some(r => ['planner', 'comms', 'admin', 'treasurer', 'deputy'].includes(r)));
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">${icon('lock')}Month close</p>
      <h1>${escapeHtml(fmtMonth(month))}</h1>
      ${p.alreadyClosed ? `<div class="notice good" style="margin-top:16px"><b>Already closed and sealed</b>
        <p class="small">Closed by ${escapeHtml(store.member(p.alreadyClosed.closedBy)?.name || '')} on ${escapeHtml(fmtDayTime(p.alreadyClosed.closedAt))}, co-signed by ${escapeHtml(store.member(p.alreadyClosed.cosignedBy)?.name || '')}. Reserve at close <b class="num">${escapeHtml(fmtUsd2(p.alreadyClosed.bankBalanceUsd))}</b>, coverage <b class="num">${escapeHtml(fmtPct(p.alreadyClosed.coverage))}</b>.</p></div>` : ''}
      <div class="panel" style="margin-top:var(--s-4)">
        <div class="row" style="gap:16px;align-items:center">
          <span id="rollcall"></span>
          <div><b><b class="num">${p.confirmedCount}</b> of <b class="num">${p.rows.length}</b> confirmed</b>
            <br><span class="small muted"><b class="num">${p.pendingCount}</b> still waiting for you · <b class="num">${p.missingCount}</b> never arrived</span></div>
        </div>
      </div>
      <!-- The month is ruled rows, not a tinted card. It was the one box on a page that is
           otherwise ruled from the ring down, and a box here reads as a thing you can open. -->
      <p class="eyebrow" style="margin-top:var(--s-4)">${icon('calendar')}The month</p>
      <ul class="ledger" style="margin-top:10px">
        <li><span class="what"><b>Collected</b></span><span class="delta"><b>${escapeHtml(fmtUsd2(p.grossUsd))}</b></span></li>
        <li><span class="what"><b>To the Reserve</b><span class="meta">all of it — a point per dollar</span></span><span class="delta"><b>${escapeHtml(fmtUsd2(p.grossUsd))}</b></span></li>
        <li><span class="what"><b>Coverage now</b><span class="meta">Reserve ÷ everything owed</span></span><span class="delta"><b>${escapeHtml(fmtPct(p.treasury.coverage))}</b></span></li>
      </ul>
      <form class="panel" id="close-form">
        <h2>Seal the month</h2>
        <label class="field" style="margin-top:12px"><span>Reserve balance on the bank statement</span>
          <input name="balance" type="number" step="0.01" inputmode="decimal" value="${p.treasury.reserveExpectedUsd.toFixed(2)}" required>
          <span class="hint">The ledger says it should be <b class="num">${escapeHtml(fmtUsd2(p.treasury.reserveExpectedUsd))}</b>. A gap of more than <b class="num">$${escapeHtml(String(s.closeToleranceUsd))}</b> blocks the close.</span></label>
        <label class="field"><span>Second officer</span><select name="cosigner" required>
          <option value="">Choose who co-signs</option>
          ${others.map(o => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Note</span><input name="note" placeholder="All transfers matched."></label>
        ${p.pendingCount ? `<p class="small" style="color:var(--flag)"><b class="num">${p.pendingCount}</b> transfer${p.pendingCount > 1 ? 's are' : ' is'} still waiting. Confirm or return ${p.pendingCount > 1 ? 'them' : 'it'} first.</p>` : ''}
        <div class="act-bar"><button class="btn block" type="submit" ${p.alreadyClosed ? 'disabled' : ''}>Close ${escapeHtml(fmtMonth(month))}</button></div>
      </form>
      <details class="fineprint"><summary>Everyone, this month</summary>
        <ul class="ledger">${p.rows.map(r => `<li>
          <span class="what"><b>${escapeHtml(r.member.name)}</b>
            <span class="meta">${escapeHtml(tierName(r.member.monthlyUsd))} · <span class="num">${escapeHtml(r.reference || 'no reference')}</span></span>
            <span class="meta">${chip(r.status === 'missing' ? 'due' : r.status, r.status === 'missing' ? 'Not sent' : undefined)}${r.full === false ? ' <span class="small muted">short</span>' : ''}</span></span>
          <span class="delta"><b>${escapeHtml(fmtUsd2(r.expectedUsd))}</b><small>${r.receivedUsd == null ? 'nothing yet' : escapeHtml(fmtUsd2(r.receivedUsd))}</small></span></li>`).join('')}</ul>
      </details>
    </div></section></div>`);
  wrap.querySelector('#rollcall').replaceChildren(ring({ total: Math.max(1, p.rows.length), filled: p.confirmedCount, size: 92, label: `${p.confirmedCount}`, sub: `of ${p.rows.length}` }));
  wrap.querySelector('#close-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target); const btn = e.target.querySelector('button[type=submit]');
    setBusy(btn, true, 'Closing…');
    try {
      await store.closeMonth(month, me.id, { bankBalanceUsd: Number(f.get('balance')), cosignerId: f.get('cosigner'), note: f.get('note') });
      toast(`${fmtMonth(month)} is closed and sealed.`, { kind: 'good' });
      go('/pool');
    } catch (err) { setBusy(btn, false); toast(err.message, { kind: 'bad', timeout: 8000 }); }
  });
  return wrap;
}

// ---------------------------------------------------------------- the Desk
export function desk({ store, go }) {
  const me = store.me, s = store.settings;
  const open = store.openRedemptions();
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">${icon('clipboard')}Victor and Ian</p>
      <h1>The Desk</h1>
      <!-- One control with a thumb, not five buttons that happen to sit in a row: the same
           segmented component /settings uses, so the Desk and Settings agree. -->
      <div class="segmented even no-print" role="group" aria-label="Desk sections" id="tabs">
        <button type="button" data-tab="requests" aria-pressed="true">Asks${open.length ? ` <span class="nav-badge">${open.length}</span>` : ''}</button>
        <button type="button" data-tab="wanted" aria-pressed="false">Wanted</button>
        <button type="button" data-tab="deals" aria-pressed="false">Deals</button>
        <button type="button" data-tab="catalog" aria-pressed="false">Places</button>
        <button type="button" data-tab="notes" aria-pressed="false">Notes</button>
      </div>
      <div id="panel" style="margin-top:var(--s-4)"></div>
    </div></section></div>`);
  const panel = wrap.querySelector('#panel');
  let tab = DESK_TAB;
  wrap.querySelectorAll('#tabs [data-tab]').forEach(x => { const on = x.dataset.tab === tab; x.setAttribute('aria-pressed', String(on)); });

  /** What the Circle has asked to be told about — this is the shopping list. */
  const drawWanted = () => {
    const rows = store.demand();
    // No boxed explainer over the lane: four lines of grey telling Victor what his own Desk is
    // for, above a lane that is often one line long. The rows say it themselves.
    panel.replaceChildren(el(`<div>
      ${rows.length ? `<div class="stack">${rows.map(r => {
        const stay = r.stay;
        const names = [...r.members].map(id => store.member(id)?.name.split(' ')[0]).filter(Boolean);
        const windows = r.watches.map(w => `${fmtDay(w.from)} – ${fmtDay(w.to)}${w.nights ? ` · ${w.nights}n` : ''}`);
        return `<div class="panel">
          <div class="row-between" style="align-items:flex-start;gap:14px">
            <div>
              <h3>${escapeHtml(stay?.name || 'Anywhere on the island')}</h3>
              <p class="small muted" style="margin-top:6px">${icon('users', { size: 14, cls: 'ico-muted' })}
                <b class="num">${r.count}</b> ${r.count === 1 ? 'Insider' : 'Insiders'}: ${escapeHtml(names.join(', '))}</p>
              <p class="small muted" style="margin-top:4px">${icon('calendar', { size: 14, cls: 'ico-muted' })} ${escapeHtml(windows.join(' · '))}</p>
            </div>
            <div class="row" style="flex:none">
              ${r.matched ? `<span class="tag">${icon('check', { size: 13 })}on the board</span>` : ''}
              ${stay ? `<button class="btn sm" data-post="${escapeHtml(stay.id)}" data-room="${escapeHtml(r.roomTypeId || '')}">${icon('plus', { size: 15 })}Post one</button>` : ''}
            </div>
          </div></div>`;
      }).join('')}</div>`
      : `<div class="empty">${icon('bell', { size: 30, cls: 'ico-muted' })}
          <b style="display:block">Nobody is watching for anything yet</b>
          <p class="small muted">When Insiders start adding watches, this becomes the list of what to hunt for.</p></div>`}
    </div>`));
  };

  /**
   * The bookmark that reads an Interval page Victor is already looking at.
   *
   * It is a bookmark and not a service on purpose. Interval has no API, their terms forbid
   * automated access, and a bot sign-in is refused — and the penalty falls on Victor's own
   * membership, which is where every cheap week the Circle sells comes from. So nothing signs in
   * on his behalf: he is already signed in, already on the page, and this reads the text his
   * browser has already drawn, only when he taps it. Nothing goes on the board until he has seen
   * what it read and tapped again.
   */
  /**
   * How long since anyone actually looked at Interval on the Circle's behalf.
   *
   * The board is only worth browsing unattended if its rows are recent, and nothing can refresh
   * them by itself: Interval has no feed, so a person has to look. Saying how stale the rows have
   * got turns "tap Grab sometime" into a thing with an answer, and the panel opens itself once
   * they are older than a day.
   */
  const freshness = () => {
    const rows = store.liveDeals().filter(d => d.source === 'interval' && (d.seenAt || d.postedAt));
    if (!rows.length) return { chip: '', line: '', overdue: false };
    const newest = Math.max(...rows.map(d => Date.parse(d.seenAt || d.postedAt)));
    const hours = Math.floor((Date.now() - newest) / 36e5);
    const said = hours < 1 ? 'in the last hour' : hours < 24 ? `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
      : `${Math.floor(hours / 24)} ${Math.floor(hours / 24) === 1 ? 'day' : 'days'} ago`;
    const overdue = hours >= 24;
    return {
      overdue,
      chip: overdue ? ` <span class="tag" style="background:var(--flight-soft);color:var(--ink);border-color:transparent">${escapeHtml(said)}</span>` : '',
      line: `<p class="small muted" style="margin-top:10px">The ${rows.length} Interval ${rows.length === 1 ? 'week' : 'weeks'} on the board ${rows.length === 1 ? 'was' : 'were'} last seen <b>${escapeHtml(said)}</b>. Members see that on every row, so a stale board tells on itself \u2014 but only you can look again.</p>`,
    };
  };

  const GRAB = "javascript:(function(){var d=document,s=d.createElement('script');"
    + "s.src='https://victorfromaruba-stack.github.io/BY-JOHNNY-PAESCH/circle/tools/grab.js?'+Date.now();"
    + "d.documentElement.appendChild(s);})()";

  const drawDeals = () => {
    const live = store.liveDeals();
    panel.replaceChildren(el(`<div>
      <button class="btn block" id="post-deal">${icon('plus', { size: 16 })}Post a deal</button>
      <div class="row" style="margin-bottom:16px"><a class="link-rule" href="#/stays">See it as a member does</a></div>
      <details class="panel" style="margin-bottom:16px"${freshness().overdue ? ' open' : ''}>
        <summary style="cursor:pointer;font-weight:600">${icon('zap', { size: 16 })}Grab a whole Interval page at once${freshness().chip}</summary>
        ${freshness().line}
        <p class="small muted" style="margin-top:10px">Open Interval, signed in as yourself, and search Getaways the way you always do
          — sorting by Price puts the ones worth having on the first screen. Scroll so those weeks are visible.
          Then pick the bookmark. It reads what is on the page, shows you every week it made out — including the
          ones it could not read — and puts nothing on the board until you tap again. It does not sign in
          anywhere and it never runs on its own.</p>
        <div class="row no-print" style="margin-top:12px">
          <a class="btn sm" href="https://vip.intervalworld.com/" target="_blank" rel="noopener noreferrer">${icon('external', { size: 15 })}Open Interval</a>
          <a class="btn ghost sm" href="tools/check-interval.ics" download>${icon('calendar', { size: 15 })}Remind me four times a day</a>
        </div>
        <p class="small muted" style="margin-top:10px">Nothing watches Interval for the Circle. They publish no feed, and there is no
          alert to switch on — the only way to know what is open is for somebody to look. So the reminder comes to you instead:
          four a day at 08:00, 12:00, 16:30 and 20:30, each one a tap away from a current board. Open it once and your phone keeps it.</p>
        <div class="copyline" style="margin-top:12px"><code class="tiny">${escapeHtml(GRAB.slice(0, 54))}…</code>
          <button class="btn ghost sm" data-copy="${escapeHtml(GRAB)}">Copy</button></div>
        <p class="small muted" style="margin-top:10px">To install it: save any page as a bookmark, edit the bookmark, and paste this over its address.
          The first tap asks for the Desk’s ingest token — the one you were given. It is kept in that browser
          and nowhere else, so it is not in the bookmark and not in this app.</p>
      </details>
      ${live.length ? `<div class="stack">${live.map(d => {
        const stay = store.stay(d.stayId);
        const hits = store.matchesForDeal(d.id);
        return `<div class="panel" data-deal="${escapeHtml(d.id)}">
          <div class="row-between" style="align-items:flex-start;gap:14px">
            <div>
              <h3>${escapeHtml(d.title || stay?.name || '')}</h3>
              <p class="small muted" style="margin-top:5px">${escapeHtml(fmtDay(d.from))} – ${escapeHtml(fmtDay(d.to))} · ${d.nights} nights · ${escapeHtml(fmtPoints(d.pointsTotal))}
                · from ${escapeHtml(d.source)}</p>
              <p class="small${hits.length ? '' : ' muted'}" style="margin-top:6px">
                ${icon(hits.length ? 'bellRing' : 'bell', { size: 14 })}
                ${hits.length ? `${hits.length} ${hits.length === 1 ? 'Insider was' : 'Insiders were'} waiting for this` : 'Nobody was watching for this one'}</p>
            </div>
            <div class="row" style="flex:none">
              ${safeUrl(d.sourceUrl) ? `<a class="btn ghost sm" href="${escapeHtml(safeUrl(d.sourceUrl))}" target="_blank" rel="noopener noreferrer" aria-label="Open the listing">${icon('external', { size: 15 })}</a>` : ''}
              <button class="btn ghost sm" data-retire="${escapeHtml(d.id)}">${icon('x', { size: 15 })}Gone</button>
            </div>
          </div></div>`;
      }).join('')}</div>`
      : `<div class="empty">${icon('zap', { size: 30, cls: 'ico-muted' })}
          <b style="display:block">Nothing on the board</b>
          <p class="small muted">Post the moment you see something — a good week goes within hours.</p></div>`}
    </div>`));
  };

  const drawRequests = () => {
    // Three lanes, by what the Desk owes: a price, a booking, or nothing yet. A flat list mixed
    // the three and hid the one that is Victor's own job — booking it — behind an "Open".
    const hoursLeft = (r) => (tierFor(s, store.member(r.memberId)?.monthlyUsd)?.slaHours ?? s.slaHours) - Math.round((Date.now() - new Date(r.requestedAt)) / 36e5);
    const lanes = [
      { key: 'requested', title: 'To look and price',
        rows: open.filter(r => r.status === 'requested').sort((a, b) => hoursLeft(a) - hoursLeft(b)) },
      { key: 'held', title: 'To book',
        rows: open.filter(r => r.status === 'held').sort((a, b) => (a.approvedAt ? 1 : 0) - (b.approvedAt ? 1 : 0) || String(a.heldAt).localeCompare(String(b.heldAt))) },
      { key: 'quoted', title: 'Waiting on the member',
        rows: open.filter(r => r.status === 'quoted').sort((a, b) => String(a.quoteExpiresAt).localeCompare(String(b.quoteExpiresAt))) },
    ];
    const row = (r) => {
      const m = store.member(r.memberId); const st = store.stay(r.stayId);
      const promised = tierFor(s, m?.monthlyUsd)?.slaHours ?? s.slaHours;
      const sla = hoursLeft(r);
      const topUpOwed = r.status === 'held' && r.topUpUsd > 0 && (r.topUpReceivedUsd ?? 0) < r.topUpUsd;
      const left = countdownTo(r.quoteExpiresAt);
      return `<div class="panel req ${r.status}">
        <div class="row-between" style="align-items:flex-start">
          <div class="row" style="gap:10px;min-width:0;flex-wrap:nowrap;align-items:flex-start">${avatar(m, 38)}
            <div style="min-width:0"><b>${escapeHtml(m?.name || '')}</b> → ${escapeHtml(st?.name || '')}
              <br><span class="small muted">${escapeHtml(fmtDay(r.checkIn))} – ${escapeHtml(fmtDay(r.checkOut))} · <b class="num">${r.nights}</b> night${r.nights > 1 ? 's' : ''} · <b class="num">${r.guests}</b> guest${r.guests > 1 ? 's' : ''}${r.flexDays ? ` · flexible <b class="num">±${r.flexDays}d</b>` : ''}</span></div>
          </div>
          <span style="flex:none">${r.status === 'held' ? chip(r.approvedAt ? 'held' : 'requested', r.approvedAt ? 'Booking it' : 'To book') : r.status === 'quoted' ? chip('quoted', 'Priced') : chip(r.status)}</span>
        </div>
        <p class="num" style="margin-top:var(--s-2)">${escapeHtml(fmtPoints(r.quotedPoints || r.indicativePoints))}</p>
        ${r.note ? `<p class="small muted" style="margin-top:10px">“${escapeHtml(r.note)}”</p>` : ''}
        <div class="stack tight" style="justify-items:start;margin-top:var(--s-3)">
          ${r.status === 'requested' && store.canQuote(r) ? `<button class="btn sm" data-quote="${r.id}">${icon('tag', { size: 15 })}Look and price</button>
            <span class="small ${sla > 0 ? 'muted' : ''}">${sla > 0 ? `<b class="num">${sla}h</b> left of the <b class="num">${promised}-hour</b> promise` : `<span style="color:var(--flag)">past the <b class="num">${promised}-hour</b> promise</span>`}</span>` : ''}
          ${r.status === 'held' && store.hasRole('planner', 'admin', 'treasurer', 'deputy') ? `<button class="btn good sm" data-book="${r.id}">${icon('check', { size: 15 })}Book it</button>` : ''}
          ${r.status === 'held' && store.canPlan() && !r.approvedAt ? `<button class="link-rule" type="button" data-approve="${r.id}">I have it</button>` : ''}
          ${r.status === 'held' && topUpOwed ? `<span class="small" style="color:var(--flag)"><b class="num">${escapeHtml(fmtUsd2(r.topUpUsd))}</b> top-up still to the Banker</span>` : ''}
          ${r.status === 'quoted' ? `<span class="small muted">${left ? `the price holds another ${escapeHtml(left)}` : 'the price has lapsed'}</span>` : ''}
          <a class="link-rule" href="#/requests/${r.id}">Open</a>
        </div></div>`;
    };
    panel.replaceChildren(el(`<div class="stack lanes">${lanes.map(l => `<section class="lane lane-${l.key}">
        <div class="lane-head"><p class="eyebrow">${escapeHtml(l.title)}</p><b class="num lane-count">${l.rows.length}</b></div>
        ${l.rows.length ? `<div class="stack">${l.rows.map(row).join('')}</div>` : '<p class="small muted lane-empty">Nothing here.</p>'}
      </section>`).join('')}</div>`));
  };

  const drawCatalog = () => {
    const list = store.stays;
    panel.replaceChildren(el(`<div class="panel">
      <h2>What the Circle offers</h2>
      <button class="btn block" id="add" style="margin-top:var(--s-3)">Add a stay, trip or cruise</button>
      <ul class="ledger" style="margin-top:var(--s-4)">${list.map(st => `<li>
        <span class="what"><b>${escapeHtml(st.name)}</b>
          <span class="meta">${escapeHtml(st.area)}${st.kind === 'trip'
            ? ` · ${st.cruise ? `cruise${st.cruise.ship ? ` · ${escapeHtml(st.cruise.ship)}` : ''} · ` : 'trip · '}${escapeHtml(fmtDay(st.dates.from))} · <b class="num">${st.nights}</b> nights`
            : ` · min <b class="num">${st.minNights}</b> nights`}</span></span>
        <span class="delta"><b>${escapeHtml(fmtPoints(st.kind === 'trip' ? seatPoints(st, s) : fromPoints(st, s)))}</b>
          ${st.active ? chip('confirmed', 'Live') : chip('cancelled', 'Draft')}
          <button class="btn ghost sm" data-edit="${st.id}">Edit</button></span></li>`).join('')}</ul>
      <p class="small muted" style="margin-top:12px">The cheapest night of the year at each place — open one to set all three of its rates. Members see the points; you edit the dollars.</p>
    </div>`));
  };

  const drawNotes = () => {
    const notes = store.announcements();
    panel.replaceChildren(el(`<div class="stack">
      <form class="panel" id="note-form">
        <h2>Write to the Circle</h2>
        <p class="small muted" style="margin-top:6px">Every note opens “Bon dia, Circle” and is signed by you. Nothing is ever sent without you tapping send.</p>
        <label class="field" style="margin-top:12px"><span>Title</span><input name="title" required placeholder="Samaná is open — fourteen seats"></label>
        <label class="field"><span>Note</span><textarea name="body" rows="5" required placeholder="Bon dia, Circle. …"></textarea></label>
        <label class="row" style="gap:10px;margin-bottom:14px;flex-wrap:nowrap"><input type="checkbox" name="pinned"><span class="small">Pin it to the top</span></label>
        <button class="btn block" type="submit">Publish</button>
      </form>
      <div class="panel"><h2>Ready-made messages</h2>
        <p class="small muted" style="margin-top:6px">Open in WhatsApp with the details already filled in. You decide what to send and to whom.</p>
        <div class="row" style="margin-top:12px" id="templates"></div></div>
      <div class="panel"><h2>Published</h2>
        <ul class="ledger" style="margin-top:10px">${notes.map(n => `<li><span class="what"><b>${escapeHtml(n.title)}</b>
          <span class="meta">${escapeHtml(store.member(n.authorId)?.name.split(' ')[0] || '')} · ${escapeHtml(fmtDay(n.at))}${n.pinned ? ' · pinned' : ''}</span></span>
          <span class="delta"><button class="btn ghost sm" data-del="${n.id}">Delete</button></span></li>`).join('')}</ul></div>
    </div>`));
    const month = monthKey();
    panel.querySelector('#templates').innerHTML = store.expectedMembers(month).slice(0, 6).map(m => `
      <a class="btn ghost sm" target="_blank" rel="noopener" href="${escapeHtml(waLink(m.phone, TEMPLATES.reminder({ member: m, amountUsd: m.monthlyUsd, month, reference: `${VOCAB.refPrefix}-${initials(m.name)}-${month}`, v: VOCAB })))}">${escapeHtml(m.name.split(' ')[0])}</a>`).join('');
    panel.querySelector('#note-form').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const btn = e.submitter || e.target.querySelector('[type=submit]');
      // Busy while it goes, so a double-tap cannot send the same note to forty people twice;
      // and a failure is SAID, not swallowed as an unhandled rejection.
      setBusy(btn, true, 'Publishing…');
      try {
        await store.postAnnouncement({ authorId: me.id, title: f.get('title'), body: f.get('body'), pinned: !!f.get('pinned') });
        toast('Published to the Circle.', { kind: 'good' });
      } catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); }
      finally { setBusy(btn, false); }
    });
  };

  const draw = () => { ({ requests: drawRequests, wanted: drawWanted, deals: drawDeals, catalog: drawCatalog, notes: drawNotes })[tab](); };
  draw();
  // ONE listener on the panel, attached once. The Requests, Stays and Notes tabs each used to add
  // their own inside draw*(), and replaceChildren() does not remove a listener from the node it
  // is called on — so Deals → Requests → "Quote it" opened two quote sheets stacked, and on Stays
  // a save wrote twice, the second overwriting the first with untouched values.
  panel.addEventListener('click', async (e) => {
    // Copy works on whichever tab is open, so it is answered before the tabs are.
    const cp = e.target.closest('[data-copy]');
    if (cp) { const got = await copyText(cp.dataset.copy); return toast(got ? 'Copied.' : 'Select it and copy by hand — this browser would not.', { kind: got ? 'good' : 'bad' }); }
    if (tab === 'requests') {
      const b = e.target.closest('[data-quote]');
      if (b) { const r = store.redemption(b.dataset.quote); return quoteSheet(store, r, store.stay(r.stayId)); }
      const bk = e.target.closest('[data-book]');
      if (bk) return bookSheet(store, store.redemption(bk.dataset.book));
      const ap = e.target.closest('[data-approve]');
      if (ap) { try { const r = store.redemption(ap.dataset.approve); await store.approveRedemption(r.id, me.id); toast(`${store.member(r.memberId)?.name.split(' ')[0] || 'They'} can see you are booking it.`, { kind: 'good' }); } catch (err) { toast(err.message, { kind: 'bad' }); } return; }
    }
    if (tab === 'catalog') {
      const ed = e.target.closest('[data-edit]');
      if (ed) return editStay(store, store.stay(ed.dataset.edit));
      if (e.target.id === 'add') return editStay(store, null);
    }
    if (tab === 'notes') {
      const d = e.target.closest('[data-del]');
      if (d) {
        const yes = await confirmDialog({ title: 'Delete this note?', message: 'It disappears from everyone’s Circle page.', confirmText: 'Delete', danger: true });
        if (yes) { try { await store.deleteAnnouncement(d.dataset.del, me.id); toast('Deleted.'); } catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); } }
        return;
      }
    }
    const post = e.target.closest('[data-post]') || e.target.closest('#post-deal');
    if (post) {
      const { postDealSheet } = await import('./deals.js');
      const prefill = post.dataset?.post ? { stayId: post.dataset.post, roomTypeId: post.dataset.room || null } : {};
      const d = await postDealSheet({ store, prefill });
      if (d) draw();
      return;
    }
    const retire = e.target.closest('[data-retire]');
    if (retire) {
      const yes = await confirmDialog({ title: 'Take it off the board?', confirmText: 'It is gone',
        message: 'It stays in the record, but nobody sees it as available any more.' });
      if (yes) { try { await store.retireDeal(retire.dataset.retire, store.me.id, 'Taken'); toast('Off the board.'); draw(); } catch (err) { toast(err.message, { kind: 'bad' }); } }
    }
  });
  wrap.querySelector('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    tab = b.dataset.tab; DESK_TAB = tab;
    wrap.querySelectorAll('[data-tab]').forEach(x => { const on = x.dataset.tab === tab; x.setAttribute('aria-pressed', String(on)); });
    draw();
  });
  return wrap;
}

/** A dollars box and a points box that keep each other honest. */
function moneyPair(key, label, valueUsd, s) {
  const usd = Number(valueUsd) || 0;
  return `<div class="field"><span>${escapeHtml(label)}</span>
    <div class="row" style="gap:8px;flex-wrap:nowrap">
      <span class="row" style="gap:4px;flex:1;min-width:0;flex-wrap:nowrap"><span class="muted">$</span>
        <input data-usd="${escapeHtml(key)}" type="number" step="1" min="0" inputmode="decimal" value="${usd.toFixed(0)}" aria-label="${escapeHtml(label)} in dollars" style="min-width:0"></span>
      <span class="row" style="gap:4px;flex:1;min-width:0;flex-wrap:nowrap"><span class="muted">✦</span>
        <input data-pts="${escapeHtml(key)}" type="number" step="100" min="0" inputmode="numeric" value="${Math.round(usd * s.pointsPerDollar)}" aria-label="${escapeHtml(label)} in points" class="mono" style="min-width:0"></span>
    </div></div>`;
}

async function editStay(store, stay) {
  const s = store.settings;
  // What it is: a stay on the island (priced a night), a trip (a seat), or a cruise (a cabin,
  // on a ship, from a port). A cruise is stored as a trip with a `cruise` record, so everything
  // that holds and books a seat holds and books a cabin unchanged.
  let kind = stay ? (stay.cruise ? 'cruise' : stay.kind) : 'aruba';
  const out = await sheet({ title: stay ? `Edit ${stay.name}` : 'Add a stay, trip or cruise', tall: true, render: (body, close) => {
   const draw = () => {
    const isTrip = kind !== 'aruba', cruise = kind === 'cruise', unit = cruise ? 'cabin' : 'seat';
    const cr = stay?.cruise || {};
    body.innerHTML = `
      ${stay ? '' : `<label class="field"><span>What is it</span><select name="kind">
        <option value="aruba"${kind === 'aruba' ? ' selected' : ''}>A stay on the island — priced a night</option>
        <option value="trip"${kind === 'trip' ? ' selected' : ''}>A trip — a seat each, fixed dates</option>
        <option value="cruise"${kind === 'cruise' ? ' selected' : ''}>A cruise — a cabin each, fixed dates</option></select></label>`}
      <label class="field"><span>Name</span><input name="name" value="${escapeHtml(stay?.name || '')}" placeholder="${cruise ? '7 nights, Southern Caribbean' : ''}" required></label>
      <label class="field"><span>${cruise ? 'Sails from' : 'Area'}</span><input name="area" value="${escapeHtml(stay?.area || '')}" placeholder="${cruise ? 'San Juan' : ''}"></label>
      ${cruise ? `
      <label class="field"><span>Cruise line</span><input name="crLine" value="${escapeHtml(cr.line || '')}" placeholder="Celebrity"></label>
      <label class="field"><span>Ship</span><input name="crShip" value="${escapeHtml(cr.ship || '')}" placeholder="Celebrity Beyond"></label>
      <label class="field"><span>Cabin</span><input name="crCabin" value="${escapeHtml(cr.cabin || '')}" placeholder="Balcony, two people"></label>
      <label class="field"><span>Ports, in order</span><input name="crPorts" value="${escapeHtml((cr.ports || []).join(', '))}" placeholder="Aruba, Curaçao, Bonaire">
        <span class="hint">Comma-separated. Members see them on the card and the page.</span></label>
      <label class="field"><span>Where you saw it</span><input name="crRef" type="url" value="${escapeHtml(stay?.sources?.interval?.url || '')}" placeholder="https://www.intervalworld.com/…" inputmode="url">
        <span class="hint">The Interval page for this sailing, so when someone asks you are one tap from it.</span></label>` : ''}
      <p class="eyebrow" style="margin-bottom:8px">${isTrip ? `What a ${unit} costs us` : 'What a night costs us'}</p>
      <p class="small muted" style="margin-bottom:12px">The room, taxes and levies included — what the Circle pays. The member is charged ${escapeHtml(fmtPct(s.serviceRate, 0))} on top of this when they spend points, and that is the number every screen shows them. Type dollars or points, whichever you have in your head; the other follows at ${s.pointsPerDollar} points to the dollar.</p>
      ${isTrip ? `${moneyPair('seat', `A ${unit}, before our share`, (stay?.pointsPerSeat || 0) / s.pointsPerDollar, s)}
        <label class="field"><span>Guest price in cash US$</span><input name="guestCashUsd" type="number" step="1" value="${stay?.guestCashUsd || 0}" inputmode="decimal">
          <span class="hint">What a non-member pays the Banker, at face value.</span></label>
        <div class="pair">
          <label class="field"><span>${cruise ? 'Sails on' : 'Starts on'}</span><input name="startsOn" type="date" value="${escapeHtml(stay?.dates?.from || '')}" required></label>
          <label class="field"><span>${cruise ? 'Back on' : 'Ends on'}</span><input name="endsOn" type="date" value="${escapeHtml(stay?.dates?.to || '')}" required></label>
        </div>
        <div class="pair">
          <label class="field"><span>${cruise ? 'Cabins' : 'Seats'} you can hold</span><input name="seats" type="number" min="1" value="${stay?.seats || (cruise ? 4 : 10)}" inputmode="numeric"></label>
          <label class="field"><span>Hold deadline</span><input name="holdDeadline" type="date" value="${escapeHtml(stay?.holdDeadline || '')}"><span class="hint">You release the block after this.</span></label>
        </div>
        <label class="field"><span>Public rate US$, a ${unit}</span><input name="retailUsd" type="number" value="${stay?.retailUsd || 0}" inputmode="decimal"><span class="hint">What the same ${unit} costs booked alone, for comparison.</span></label>`
        : `${RATE_BAND_LIST.map(b => moneyPair(b.id, `${b.from} – ${b.to}`,
            stay?.rates?.[b.id] ?? ({ low: 250, high: 380, peak: 460 })[b.id], s)).join('')}
      <p class="small muted" style="margin-bottom:14px">Three dates, three rates — the way the hotels quote them. A member never sees these three or any name for them: they give their dates and the app prices those nights.</p>
      <div class="pair">
        <label class="field"><span>Minimum nights</span><input name="minNights" type="number" value="${stay?.minNights || 2}" inputmode="numeric"></label>
        <label class="field"><span>Minimum, 20 Dec – 3 Jan</span><input name="peakMinNights" type="number" value="${stay?.peakMinNights || 7}" inputmode="numeric"></label>
      </div>
      <label class="field"><span>Public rate US$</span><input name="retailUsd" type="number" value="${stay?.retailUsd || 0}" inputmode="decimal"></label>
      <label class="field"><span>Booking page</span>
        <input name="site" type="url" value="${escapeHtml(stay?.site || '')}" placeholder="https://…" inputmode="url">
        <span class="hint">Where you actually go to book this place. It is the link on every request for it, so when a member asks you are one tap from the room instead of searching for it again.</span></label>
      <p class="eyebrow" style="margin:20px 0 8px">What the booking sites are asking</p>
      <p class="small muted" style="margin-bottom:12px">Type what you actually saw and the day you saw it. This is what a member is shown under the price — with the date, always, so nobody is comparing against something six months old. Leave it empty and the page says plainly that nobody has checked.</p>
      <div class="pair">
        <label class="field"><span>Interval, a night US$</span><input name="srcIntervalUsd" type="number" step="0.01" value="${stay?.sources?.interval?.seenUsd || ''}" inputmode="decimal"></label>
        <label class="field"><span>RedWeek, from US$</span><input name="srcRedweekUsd" type="number" step="0.01" value="${stay?.sources?.redweek?.fromUsd || ''}" inputmode="decimal"></label>
      </div>
      <label class="field"><span>Seen on</span><input name="srcSeenOn" type="date" value="${escapeHtml(stay?.sources?.interval?.seenOn || stay?.sources?.redweek?.seenOn || '')}"></label>`}
      <label class="field"><span>What it is like</span><textarea name="vibe" rows="2">${escapeHtml(stay?.vibe || '')}</textarea></label>
      <label class="field"><span>Note from Victor</span><input name="dealNote" value="${escapeHtml(stay?.dealNote || '')}"></label>
      <div class="field" id="photo-block">
        <span>Photograph</span>
        <div id="photo-preview" class="photo-preview">${photoFor(stay)
          ? `<img src="${escapeHtml(photoFor(stay))}" alt="">${stay?.photoUrl ? '' : '<span class="tiny muted" style="display:block;margin-top:4px">From the property\'s own site, with its page and date on record. One you upload replaces it.</span>'}`
          : '<span class="small muted">No photograph yet — the card shows a blank plate until there is one.</span>'}</div>
        <div class="row" style="margin-top:8px">
          <label class="btn ghost sm" style="cursor:pointer">${icon('camera', { size: 15 })}Choose a photograph<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" hidden></label>
          ${stay?.photoUrl ? `<button type="button" class="btn ghost sm" id="photo-remove">${icon('x', { size: 15 })}Take it off</button>` : ''}
        </div>
        <label class="field" style="margin-top:10px"><span>Where it came from</span>
          <input name="photoNote" value="${escapeHtml(stay?.photoNote || '')}" placeholder="Our own photo, March 2026 · the resort's media kit, with their OK">
          <span class="hint">Only a photograph the Circle may use: one you took, or one from the resort's media kit with their permission. Not a picture copied off their website — those are the hotel's copyright, and the Circle does not take what it has not been given. Members see this line under the picture.</span></label>
      </div>
      <label class="row" style="gap:10px;margin-bottom:12px;flex-wrap:nowrap"><input type="checkbox" name="active" ${stay?.active !== false ? 'checked' : ''}><span class="small">Live for members</span></label>
      ${isTrip ? '' : `<label class="row" style="gap:10px;margin-bottom:12px;flex-wrap:nowrap"><input type="checkbox" name="house" ${stay?.house ? 'checked' : ''}><span class="small">One of the places we actually use — shows first, with a badge</span></label>`}
      <div class="sheet-actions"><button class="btn block" data-ok>Save</button></div>`;
    // Typing in either box updates the other, so the two never disagree.
    body.addEventListener('input', (e) => {
      const usd = e.target.closest('[data-usd]'); const pts = e.target.closest('[data-pts]');
      if (usd) { const p = body.querySelector(`[data-pts="${usd.dataset.usd}"]`); if (p) p.value = Math.round((Number(usd.value) || 0) * s.pointsPerDollar); }
      if (pts) { const u = body.querySelector(`[data-usd="${pts.dataset.pts}"]`); if (u) u.value = (Math.round(Number(pts.value) || 0) / s.pointsPerDollar).toFixed(2); }
    });
    // The photograph: show what was chosen, or mark the current one to come off on save.
    const preview = body.querySelector('#photo-preview');
    body.querySelector('[name=photo]')?.addEventListener('change', (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      delete body.dataset.photoRemove;
      preview.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
      body.querySelector('#photo-remove')?.remove();
      body.querySelector('[name=photoNote]')?.focus();
    });
    body.querySelector('#photo-remove')?.addEventListener('click', (e) => {
      body.dataset.photoRemove = '1';
      preview.innerHTML = '<span class="small muted">The photograph comes off when you save.</span>';
      e.currentTarget.remove();
    });
    body.querySelector('[data-ok]').addEventListener('click', () => {
      const v = (n) => body.querySelector(`[name=${n}]`)?.value;
      const usd = (n) => Number(body.querySelector(`[data-usd="${n}"]`)?.value) || 0;
      if (!String(v('name') || '').trim()) { toast('Give it a name.', { kind: 'bad' }); body.querySelector('[name=name]')?.focus(); return; }
      const data = { id: stay?.id, kind: isTrip ? 'trip' : 'aruba', name: String(v('name')).trim(), area: v('area'), vibe: v('vibe'), dealNote: v('dealNote'),
        active: body.querySelector('[name=active]').checked, country: stay?.country || (isTrip ? '' : 'Aruba'), features: stay?.features || [] };
      if (isTrip) {
        const from = v('startsOn'), to = v('endsOn');
        const nights = Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
        if (!(nights > 0)) { toast('The end date has to come after the start.', { kind: 'bad' }); body.querySelector('[name=endsOn]')?.focus(); return; }
        if (!(usd('seat') > 0)) { toast(`Say what a ${unit} costs us.`, { kind: 'bad' }); body.querySelector('[data-usd="seat"]')?.focus(); return; }
        Object.assign(data, { pointsPerSeat: Math.round(usd('seat') * s.pointsPerDollar), guestCashUsd: Number(v('guestCashUsd')) || 0,
          dates: { from, to }, nights, seats: Math.max(1, Number(v('seats')) || 1), holdDeadline: v('holdDeadline') || null,
          retailUsd: Number(v('retailUsd')) || 0, reach: stay?.reach || (cruise ? 'region' : 'world'), isDrop: stay?.isDrop ?? false });
        if (cruise) {
          const ref = safeUrl(v('crRef')) || '';
          data.cruise = { line: (v('crLine') || '').trim(), ship: (v('crShip') || '').trim(), embark: (v('area') || '').trim(),
            ports: String(v('crPorts') || '').split(',').map(x => x.trim()).filter(Boolean), cabin: (v('crCabin') || '').trim(), ref };
          data.sources = { ...(stay?.sources || {}), ...(ref ? { interval: { ...(stay?.sources?.interval || {}), url: ref } } : {}) };
        } else data.cruise = stay?.cruise ?? null;
      } else Object.assign(data, { site: v('site') || null,
        rates: { low: usd('low'), high: usd('high'), peak: usd('peak') },
        sources: (() => {
          // Merged into what is on file, not rebuilt from the two boxes: the boxes set the two
          // prices and the date, and everything else the record carries — a note, the nights it
          // was seen for, a source the boxes do not cover — stays as it was. Rebuilding threw
          // those away on every save, including a rename.
          //
          // A price is only ever stored WITH the date it was seen. A price with no date cannot be
          // checked by the member it is shown to, which is the whole point of showing it — so a
          // cleared price, or a cleared date, takes that source off.
          const on = v('srcSeenOn'), iv = Number(v('srcIntervalUsd')), rw = Number(v('srcRedweekUsd'));
          const out = { ...(stay?.sources || {}) };
          // One date box serves both prices, so the date is written only onto a price that
          // changed: a RedWeek figure left as it was keeps the day it was actually seen.
          let changed = false;
          const set = (key, field, n) => {
            const prev = out[key];
            if (!(n > 0) || !on) { if (prev) changed = true; delete out[key]; return; }
            if (prev && prev[field] === n) return;
            changed = true;
            out[key] = { ...(prev || {}), [field]: n, seenOn: on };
          };
          set('interval', 'seenUsd', iv);
          set('redweek', 'fromUsd', rw);
          const i = out.interval?.seenUsd || 0, r = out.redweek?.fromUsd || 0;
          // "best" is recomputed only when a price moved; a rename keeps the one on file, which
          // the Desk may have set knowing that a RedWeek "from" is a floor across hundreds of
          // listings and not a week's price.
          const keep = out.best === 'interval' ? i > 0 : out.best === 'redweek' ? r > 0 : false;
          if (changed || !keep) {
            if (i > 0 && r > 0) out.best = i <= r ? 'interval' : 'redweek';
            else if (i > 0 || r > 0) out.best = i > 0 ? 'interval' : 'redweek';
            else delete out.best;
          }
          return out;
        })(),
        minNights: Number(v('minNights')), peakMinNights: Number(v('peakMinNights')), retailUsd: Number(v('retailUsd')),
        onSand: stay?.onSand ?? true, adultsOnly: stay?.adultsOnly ?? false, category: stay?.category || 2,
        house: !!body.querySelector('[name=house]')?.checked });
      // A photograph never leaves the sheet without its provenance. The stores refuse it too.
      const photoFile = body.querySelector('[name=photo]')?.files?.[0] || null;
      const photoNote = v('photoNote') || '';
      if (photoFile && !photoNote.trim()) {
        toast('Say where the photograph came from before saving it.', { kind: 'bad' });
        body.querySelector('[name=photoNote]')?.focus();
        return;
      }
      Object.assign(data, { photoFile, photoNote, photoRemove: !!body.dataset.photoRemove });
      close(data);
    });
   };
   draw();
   body.addEventListener('change', (e) => { if (e.target.name === 'kind') { kind = e.target.value; draw(); } });
  } });
  if (out) {
    try {
      await store.upsertStay(out, store.me.id);
      toast(out.photoFile ? 'Saved. The photograph is on the stay now.' : out.photoRemove ? 'Saved. The photograph is off.' : 'Saved. Members see the new points immediately.', { kind: 'good' });
    } catch (err) { toast(err.message, { kind: 'bad', timeout: 8000 }); }
  }
}

/**
 * Room photographs the Desk holds the rights to, on a stay: what is on file, what is being added,
 * which room each shows, and — not optional — where it came from. Resolves true when anything
 * changed, so the page re-draws.
 */
export async function roomPhotosSheet(store, stay, { rooms = [] } = {}) {
  let changed = false;
  await sheet({ title: `Room photographs · ${stay.name}`, tall: true, render: (body, close) => {
    const draw = () => {
      const current = store.stay(stay.id) || stay;
      const own = roomPhotosFor(current, null);
      body.innerHTML = `
        <p class="small muted">Only photographs the Circle may use: ones you took, or the resort's media kit with their OK. Not pictures copied off their website — those are the hotel's copyright, and the Circle does not take what it has not been given. Members see the note under each picture.</p>
        ${own.length ? `<ul class="photo-rows" style="margin-top:14px">${own.map(ph => `<li><img src="${escapeHtml(ph.thumb)}" alt="" loading="lazy" decoding="async"><span class="what"><b>${escapeHtml(ph.room || 'The property')}</b><span class="meta">${escapeHtml(ph.note)}${ph.seenOn ? ` · ${escapeHtml(fmtDay(ph.seenOn))}` : ''}</span></span><button type="button" class="btn ghost sm" data-remove="${escapeHtml(ph.id)}">${icon('x', { size: 14 })}Take off</button></li>`).join('')}</ul>`
          : '<p class="small muted" style="margin-top:12px">Nothing of ours on file for this place yet.</p>'}
        <div style="margin-top:16px">
          <label class="field"><span>Which room</span>
            <input name="room" list="room-names" placeholder="Studio · One-bedroom · leave empty for the property" autocomplete="off">
            <datalist id="room-names">${rooms.map(r => `<option value="${escapeHtml(r)}"></option>`).join('')}</datalist></label>
          <label class="field"><span>Where they came from</span><input name="note" placeholder="Our own photos, March 2026 · the resort's media kit, with their OK"></label>
        </div>
        <div class="row" style="margin-top:8px"><label class="btn ghost sm" style="cursor:pointer">${icon('camera', { size: 15 })}Choose photographs<input type="file" name="files" accept="image/jpeg,image/png,image/webp" multiple hidden></label><span class="small muted" id="picked"></span></div>
        <div class="sheet-actions"><button class="btn block" data-ok>Add them</button></div>`;
      body.querySelector('[name=files]').addEventListener('change', (e) => {
        const n = e.target.files?.length || 0;
        body.querySelector('#picked').textContent = n ? `${n} chosen` : '';
      });
      body.querySelector('[data-ok]').addEventListener('click', async (e) => {
        const files = [...(body.querySelector('[name=files]').files || [])];
        const note = body.querySelector('[name=note]').value.trim();
        const room = body.querySelector('[name=room]').value.trim();
        if (!files.length) { toast('Choose at least one photograph.', { kind: 'bad' }); return; }
        if (!note) { toast('Say where the photographs came from before saving them.', { kind: 'bad' }); body.querySelector('[name=note]').focus(); return; }
        const btn = e.currentTarget; setBusy(btn, true, 'Adding…');
        try {
          await store.addStayPhotos(stay.id, files, { room, note }, store.me.id);
          changed = true; toast(`${files.length} photograph${files.length === 1 ? '' : 's'} on the stay now.`, { kind: 'good' }); draw();
        } catch (err) { toast(err.message, { kind: 'bad', timeout: 8000 }); setBusy(btn, false); }
      });
    };
    draw();
    // Delegated once: draw() replaces the body on every add, and a listener added inside it
    // would fire once per redraw by the third photograph.
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-remove]'); if (!b) return;
      try { await store.removeStayPhoto(stay.id, b.dataset.remove, store.me.id); changed = true; toast('Off the stay.', { kind: 'good' }); draw(); }
      catch (err) { toast(err.message, { kind: 'bad' }); }
    });
  } });
  return changed;
}

// ---------------------------------------------------------------- the Pool
export function pool({ store }) {
  const s = store.settings;
  const t = store.treasury();
  const series = store.monthlySeries(9);
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">${icon('shield')}Proof of reserves</p>
      <h1>The Pool</h1>
      <div id="gauge" style="margin-top:var(--s-5)"></div>
      <!-- ONE coverage figure on this page, and it is the gauge's — the bank-checked per cent with
           the date it was checked on. Naming the ledger's own ratio 'Coverage by the ledger' here
           was not enough: an officer met 100.0% and 101.0% one under the other and could not say
           which one the Pool runs on. The two figures the ledger's ratio is made of are still
           printed below, so nothing is hidden; what is gone is the second per cent.
           Operating is not coverage and now stands on its own line. -->
      <p class="dateline">By the ledger today · Reserve <b class="num">${escapeHtml(fmtUsd2(t.reserveUsd))}</b> against <b class="num">${escapeHtml(fmtPoints(t.outstandingPoints))}</b> owed (<b class="num">${escapeHtml(fmtUsd2(t.liabilityUsd))}</b>)</p>
      <p class="dateline">Operating <b class="num">${escapeHtml(fmtUsd2(t.operatingUsd))}</b></p>
      <p class="small muted" style="margin-top:var(--s-2)">Operating is the <b class="num">15%</b> earned on bookings, less the bonuses fronted — negative until the first one.</p>

      <!-- This block said the gauge's three figures over again, word for word, four inches under
           it. It now carries only what the gauge cannot: whose hand entered the balance, and that
           the money confirmed since has not been looked at. -->
      <div class="panel flat" style="margin-top:var(--s-4)">
        <b>${t.verified ? `Checked against the bank on <b class="num">${escapeHtml(fmtDay(t.verified.at))}</b>` : 'Not yet checked against the bank'}</b>
        <p class="small">${t.verified
          ? `${escapeHtml(store.member(t.verified.byId)?.name || 'The Banker')} entered that balance from the statement. Money confirmed since then has not been checked yet; that happens at the next month close.`
          : 'Coverage is arithmetic until the Banker enters the bank balance at a month close. Until then, treat it as what the ledger says rather than what the bank holds.'}</p></div>

      <div class="stack" style="margin-top:var(--s-5)">
        <div class="panel">
          <h2>Where the money has gone</h2>
          <!-- This column is a sum, and a member checking it with his thumb has to be able to
               make it add up. Two figures used to sit in it that are not terms of it: what has
               been collected (the same money as the first row, counted at the door instead of in
               the account) and the Circle's share (earned on bookings, not taken here — and it
               carried a + sign in front of a total it is not part of). They are worth knowing, so
               they stay; they just stop pretending to be addends. Every term that can move the
               Reserve now has a row of its own, printed only when it is not zero, so the column
               still adds up on the day a refund, a correction or an expiry lands in it. -->
          <!-- VOCAB.share reads "the Circle's share", so it can never open a sentence: the
               semicolon is load-bearing. -->
          <p class="small muted" style="margin-top:10px">Insiders have sent <b class="num">${escapeHtml(fmtUsd2(t.collected))}</b> in all. Nothing is taken when points are bought, so every dollar of it went into the Reserve; ${escapeHtml(VOCAB.share)} is earned later, when points are spent on a room — <b class="num">${escapeHtml(fmtUsd2(t.serviceEarnedUsd))}</b> so far.</p>
          <ul class="ledger" style="margin-top:12px">
            <li><span class="what"><b>Into the Reserve</b><span class="meta">every confirmed contribution, in full</span></span><span class="delta"><b>${escapeHtml(fmtUsd2(t.backing))}</b></span></li>
            <li><span class="what"><b>Bonuses funded by the Circle</b><span class="meta">tier, streak and founding — fronted against the <b class="num">15%</b> still to be earned on bookings</span></span><span class="delta"><b>+${escapeHtml(fmtUsd2(t.promoUsd))}</b></span></li>
            ${t.topUpsUsd ? `<li><span class="what"><b>Cash top-ups received</b><span class="meta">paid straight on to the hotel; no 15% is taken</span></span><span class="delta"><b>+${escapeHtml(fmtUsd2(t.topUpsUsd))}</b></span></li>` : ''}
            ${t.refundedUsd ? `<li><span class="what"><b>Refunded to members</b><span class="meta">points handed back when a booking was undone or someone left</span></span><span class="delta"><b>+${escapeHtml(fmtUsd2(t.refundedUsd))}</b></span></li>` : ''}
            ${t.adjustUsd ? `<li><span class="what"><b>Corrections</b><span class="meta">lines the Banker entered by hand, each with a reason on the ledger</span></span><span class="delta"><b>${t.adjustUsd > 0 ? '+' : '−'}${escapeHtml(fmtUsd2(Math.abs(t.adjustUsd)))}</b></span></li>` : ''}
            ${t.expiredUsd ? `<li><span class="what"><b>Points expired</b><span class="meta">promotional points that ran out — the dollars behind them are released</span></span><span class="delta"><b>−${escapeHtml(fmtUsd2(t.expiredUsd))}</b></span></li>` : ''}
            <li><span class="what"><b>Paid to hotels</b><span class="meta">confirmed bookings, at the invoiced amount</span></span><span class="delta"><b>−${escapeHtml(fmtUsd2(t.paidOutUsd))}</b></span></li>
            <li class="sum"><span class="what"><b>Reserve today</b></span><span class="delta"><b>${escapeHtml(fmtUsd2(t.reserveExpectedUsd))}</b></span></li>
          </ul>
        </div>
        <div class="panel flat">
          <h2>The two accounts</h2>
          <p class="small muted" style="margin-top:8px">${escapeHtml(s.reserveAccount.holder || 'Not registered yet')}<br><span class="num">${escapeHtml(s.reserveAccount.number || '—')}</span></p>
          <p class="small muted" style="margin-top:10px">${escapeHtml(s.operatingAccount.holder || 'Not registered yet')}<br><span class="num">${escapeHtml(s.operatingAccount.number || '—')}</span></p>
          ${t.lastClose ? `<p class="small muted" style="margin-top:14px">Last sealed: ${escapeHtml(fmtMonth(t.lastClose.month))}, closed by ${escapeHtml(store.member(t.lastClose.closedBy)?.name.split(' ')[0] || '')} and co-signed by ${escapeHtml(store.member(t.lastClose.cosignedBy)?.name.split(' ')[0] || '')}.</p>` : ''}
          <p class="small muted" style="margin-top:14px">${escapeHtml(VOCAB.legal)}</p>
        </div>
      </div>

      <div class="panel" style="margin-top:var(--s-5)">
        <h2>Confirmed each month</h2>
        <div id="chart" style="margin-top:14px"></div>
        <div class="row"><button class="link-rule" type="button" id="toggle-table">Show the numbers</button></div>
        <div id="table" hidden></div>
      </div>
    </div></section></div>`);
  wrap.querySelector('#gauge').appendChild(poolGauge({ coverage: t.coverage, reserveUsd: t.reserveUsd, outstandingPoints: t.outstandingPoints, verifiedAt: t.verified?.at, verifiedVarianceUsd: t.verifiedVarianceUsd, liabilityUsd: t.liabilityUsd, configured: t.accountsConfigured, size: 'full' }));
  const data = series.map(m => ({ label: fmtMonth(m.month).slice(0, 3), values: [m.backing, m.share] }));
  wrap.querySelector('#chart').appendChild(columns(data, { series: ['Into the Reserve', 'The Circle’s share'], height: 200, width: 340, unit: '', ariaLabel: 'Money confirmed each month, split between the Reserve and the Circle’s share' }));
  // The months as ruled rows, not a table that scrolls sideways in a 358px column.
  wrap.querySelector('#table').innerHTML = `<ul class="ledger">${series.map(r => `<li>
      <span class="what"><b>${escapeHtml(fmtMonth(r.month))}</b>
        <span class="meta"><b class="num">${r.count}</b> confirmed · collected <b class="num">${escapeHtml(fmtUsd2(r.collected))}</b></span></span>
      <span class="delta"><b>${escapeHtml(fmtUsd2(r.backing))}</b><small>${escapeHtml(fmtUsd2(r.share))}</small></span></li>`).join('')}</ul>`;
  wrap.querySelector('#toggle-table').addEventListener('click', (e) => {
    const t2 = wrap.querySelector('#table'); t2.hidden = !t2.hidden;
    e.target.textContent = t2.hidden ? 'Show the numbers' : 'Hide the numbers';
  });
  return wrap;
}

// ---------------------------------------------------------------- the Circle
export function circle({ store }) {
  const me = store.me, s = store.settings;
  const roster = store.people().filter(m => m.status !== 'left');
  const t = store.treasury();
  const notes = store.announcements();
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">${roster.length} Insiders · capped at ${s.memberCap} · ${s.memberCap - roster.length} seats open</p>
      <h1>The Circle</h1>
      <div class="segmented even no-print" role="group" aria-label="Circle sections" id="tabs">
        <button type="button" data-tab="people" aria-pressed="true">Insiders</button>
        <button type="button" data-tab="chipin" aria-pressed="false">Chip in${store.openToChipIn().length ? ` <span class="nav-badge">${store.openToChipIn().length}</span>` : ''}</button>
        <button type="button" data-tab="notes" aria-pressed="false">Notes</button>
        <button type="button" data-tab="milestones" aria-pressed="false">Milestones</button>
      </div>
      <div id="panel" style="margin-top:var(--s-4)"></div>
    </div></section></div>`);
  const panel = wrap.querySelector('#panel');
  let tab = 'people';
  const draw = () => {
    if (tab === 'people') {
      const paintCrests = (root) => root.querySelectorAll('[data-crest]').forEach((slot) => {
        // Standing beside the name, at the size it is actually read: a mark, not a picture.
        slot.replaceChildren(rankCrest(store.standingOf(slot.dataset.crest), { size: 30, withName: false }));
      });
      // The roster goes to night. Fourteen members each carried the identical grey shield, so
      // the ladder the club is built on — Watapana, Fofoti, Kibrahacha — showed nothing at all.
      // The three finishes only read on dark stock: on the page's own ground a Watapana metal
      // is 1.07:1 and invisible. So this one screen is a different material, and on it each
      // seat carries its tier's metal as an edge and as the name. The field is fixed nocturne,
      // not the reader's own tier: this page is the club, not the member.
      panel.replaceChildren(el(`<div class="field-night"><p class="field-head"><b class="num">${s.memberCap - roster.length}</b> seats open · <b class="num">${roster.length}</b> of <b class="num">${s.memberCap}</b> taken</p>
        <ul class="roster">${roster.map(m => {
        const named = m.showOnRollcall || m.id === me.id || m.roles.some(r => r !== 'member');
        const streak = store.streak(m.id);
        const tags = [m.founding ? 'Founding' : '', m.standingOrder ? 'Autopilot' : '', m.status === 'paused' ? 'Paused' : '',
          streak >= 6 ? `${streak} in a row` : ''].filter(Boolean);
        // The seat's own metal, on the edge and on the tier's name. An officer's title is what
        // they do, so it stays where it is and the tier is named beside it rather than instead.
        return `<li data-tier="${escapeHtml(String(m.monthlyUsd))}">
          <div class="row" style="gap:12px;min-width:0;flex-wrap:nowrap">
            ${avatar(m, 40)}
            <div style="min-width:0"><b>${escapeHtml(named ? m.name : initials(m.name))}</b>
              <br><span class="small muted">${m.title
                ? `${escapeHtml(m.title)} · <span class="tier-name">${escapeHtml(tierName(m.monthlyUsd))}</span>`
                : `<span class="tier-name">${escapeHtml(tierName(m.monthlyUsd))}</span> · since ${escapeHtml(fmtDay(m.joinedAt))}`}</span>
              ${tags.length ? `<br>${tags.map(x => `<span class="tag">${escapeHtml(x)}</span>`).join(' ')}` : ''}</div>
          </div>
          <span style="flex:none" data-crest="${m.id}"></span></li>`;
      }).join('')}</ul></div>`));
      paintCrests(panel);
    } else if (tab === 'chipin') {
      const open = store.openToChipIn();
      const avail = store.availablePoints(me.id);
      panel.replaceChildren(el(`<div class="stack">
        <p class="small muted">When an Insider opens a booking to the Circle, anyone can put their own points toward it — for a room you are sharing, or as a gift. Points are committed the moment you chip in, and released if the booking falls through. You have ${escapeHtml(fmtPoints(avail))} available.</p>
        ${open.length ? open.map(r => {
          const st = store.stay(r.stayId); const m2 = store.member(r.memberId);
          const target = r.quotedPoints || r.indicativePoints || 0;
          const covered = store.coveredPoints(r);
          const pct = Math.min(100, (covered / Math.max(target, 1)) * 100);
          return `<div class="panel">
            <div class="row-between"><div class="row" style="gap:12px">${avatar(m2, 38)}
              <div><b>${escapeHtml(st?.name || 'Stay')}</b><br>
                <span class="small muted">${escapeHtml(m2?.name || '')} · ${escapeHtml(fmtDay(r.checkIn))} · ${r.nights} night${r.nights > 1 ? 's' : ''}</span></div></div>
              <div style="text-align:right"><b class="num">${escapeHtml(fmtPoints(Math.max(0, target - covered)))}</b><br><span class="small muted">still to cover</span></div></div>
            <div class="balbar" style="margin-top:12px" role="img" aria-label="${Math.round(pct)}% covered"><span class="b-avail" style="width:${pct}%"></span></div>
            <div class="row-between" style="margin-top:8px">
              <span class="small muted num">${escapeHtml(fmtPoints(covered))} of ${escapeHtml(fmtPoints(target))} · ${(r.pledges || []).length} chipped in</span>
              <a class="btn sm" href="#/requests/${r.id}">Chip in</a></div>
          </div>`;
        }).join('') : `<div class="empty"><b>Nothing open right now</b>
          <p class="small muted">When you request a stay you can tick “Let the Circle chip in”, and it appears here for everyone.</p>
          <a class="btn sm" href="#/stays">Find a stay</a></div>`}
      </div>`));
    } else if (tab === 'notes') {
      panel.replaceChildren(el(`<div class="stack">${notes.map(n => `<div class="panel">
          <div class="row-between"><h2>${escapeHtml(n.title)}</h2>${n.pinned ? '<span class="tag">Pinned</span>' : ''}</div>
          <p class="small muted" style="margin-top:6px">${escapeHtml(store.member(n.authorId)?.name || '')} · ${escapeHtml(fmtDay(n.at))}</p>
          <p style="margin-top:12px">${escapeHtml(n.body)}</p>
          <div class="row"><button class="link-rule" type="button" data-copy="${escapeHtml(n.body)}">Copy for WhatsApp</button></div>
        </div>`).join('')}</div>`));
      panel.addEventListener('click', async (e) => {
        const c = e.target.closest('[data-copy]'); if (!c) return;
        const ok = await copyText(c.dataset.copy); toast(ok ? 'Copied — paste it into the group.' : 'Select the text and copy it by hand.');
      });
    } else {
      const ladder = Object.entries(s.streakBonuses).map(([n, pts]) => ({ n: Number(n), pts }));
      const mine = store.streak(me.id);
      panel.replaceChildren(el(`<div class="panel">
        <h2>Streak bonuses</h2>
        <p class="small muted" style="margin-top:6px">Funded by the Circle out of its 15%, never out of anyone else’s backing. Only months where the full amount arrived count, and a pause freezes your run rather than resetting it.</p>
        <ul class="ledger" style="margin-top:14px">${ladder.map(l => `<li>
          <span class="what"><b>${l.n} consecutive contributions</b><span class="meta">${mine >= l.n ? 'You have this' : `${l.n - mine} to go`}</span></span>
          <span class="delta"><b>${escapeHtml(fmtPoints(l.pts))}</b><small>${escapeHtml(pointsUsd(l.pts, s.pointsPerDollar))}</small></span></li>`).join('')}
          <li><span class="what"><b>Founding Insider</b><span class="meta">the first ${s.foundingSeats} to join, once only</span></span>
            <span class="delta"><b>${escapeHtml(fmtPoints(s.foundingBonus))}</b><small>${escapeHtml(pointsUsd(s.foundingBonus, s.pointsPerDollar))}</small></span></li></ul>
        <p class="small muted" style="margin-top:14px">You are on <b class="num">${mine}</b> in a row. Nobody's misses are shown to anyone.</p>
      </div>`));
    }
  };
  draw();
  wrap.querySelector('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    tab = b.dataset.tab;
    wrap.querySelectorAll('[data-tab]').forEach(x => { const on = x.dataset.tab === tab; x.setAttribute('aria-pressed', String(on)); });
    draw();
  });
  return wrap;
}

// ---------------------------------------------------------------- settings

/** The only time a password is ever shown. It is stored scrambled; nobody can read it back. */
async function showLogin({ name, username, password }) {
  return sheet({ title: `${name} can sign in`, render: (body, close) => {
    body.innerHTML = `
      <p class="sheet-text">Send them these two lines. Both are on your clipboard already.</p>
      <div class="panel flat" style="margin-top:12px">
        <p class="eyebrow">Username</p><p class="mono fig">${escapeHtml(username)}</p>
        <p class="eyebrow" style="margin-top:14px">Password</p><p class="mono fig" style="word-break:break-all">${escapeHtml(password)}</p>
      </div>
      <p class="small muted" style="margin-top:12px">This is the only time it is shown. The app makes them
        choose their own the first time they sign in, so it stops mattering straight away.</p>
      <div class="sheet-actions"><button class="btn block" data-close>Done</button></div>`;
    body.querySelector('[data-close]').addEventListener('click', () => close());
  } });
}

export function settings({ store, go }) {
  const me = store.me, s = store.settings;
  const isAdmin = store.hasRole('admin');
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">${isAdmin ? 'Admin' : 'The Banker'}</p>
      <h1>Settings</h1>

      <!-- Settings used to be one scroll of six panels: three and a half screens of bank
           details and copy before the first number, seven and a half screens end to end. Nobody
           comes here to read all of it — they come to give somebody a login, or to check an
           account number. So it is four rooms now, and you land in the one you came for. -->
      <div class="segmented no-print" role="group" aria-label="Settings sections" id="tabs">
        ${isAdmin ? '<button type="button" data-tab="people" aria-pressed="true">Insiders</button>' : ''}
        <button type="button" data-tab="accounts" aria-pressed="${!isAdmin}">Accounts</button>
        <button type="button" data-tab="money" aria-pressed="false">Money</button>
        ${isAdmin ? '<button type="button" data-tab="record" aria-pressed="false">Record</button>' : ''}
      </div>

      <div data-pane="accounts"${isAdmin ? ' hidden' : ''}>
      <form class="panel" id="accounts" style="margin-top:20px">
        <h2>The two accounts</h2>
        <p class="small muted" style="margin-top:6px">Coverage can only be verified when the Reserve and Operating are two different accounts. Be honest about who holds them.</p>
        <div class="rule-block">
          <p class="eyebrow" style="margin-bottom:var(--s-2)">${icon('vault')}Reserve · backs the points</p>
          <label class="field"><span>Bank</span><input name="rBank" value="${escapeHtml(s.reserveAccount.bank || '')}"></label>
          <label class="field"><span>Held by</span><input name="rHolder" value="${escapeHtml(s.reserveAccount.holder || '')}" placeholder="Held by Vishnu on behalf of the Circle"></label>
          <label class="field"><span>Account number</span><input name="rNumber" class="mono" inputmode="numeric" autocomplete="off" value="${escapeHtml(s.reserveAccount.number || '')}"></label>
        </div>
        <div class="rule-block">
          <p class="eyebrow" style="margin-bottom:var(--s-2)">${icon('scale')}Operating · the 15%</p>
          <label class="field"><span>Bank</span><input name="oBank" value="${escapeHtml(s.operatingAccount.bank || '')}"></label>
          <label class="field"><span>Held by</span><input name="oHolder" value="${escapeHtml(s.operatingAccount.holder || '')}"></label>
          <label class="field"><span>Account number</span><input name="oNumber" class="mono" inputmode="numeric" autocomplete="off" value="${escapeHtml(s.operatingAccount.number || '')}"></label>
        </div>
        <button class="btn block" type="submit">Save the accounts</button>
      </form>

      <form class="panel" id="wallet-form" style="margin-top:16px">
        <h2>Apple Wallet passes</h2>
        <p class="small muted" style="margin-top:6px">A Wallet pass has to be signed with a certificate Apple issues to the club, so a browser cannot make one. Deploy the <code>issue-pass</code> function (it is in <code>supabase/functions/</code>, and the README walks through the certificate), then paste its URL here. Until then, members can still save the card as an image and add the app to their home screen.</p>
        <label class="field" style="margin-top:12px"><span>Pass service URL</span>
          <input name="walletUrl" value="${escapeHtml(s.wallet?.url || '')}" placeholder="https://xxxx.supabase.co/functions/v1/issue-pass" class="mono"></label>
        <button class="btn block" type="submit">Save</button>
        <p class="small muted" style="margin-top:10px">${s.wallet?.url ? 'Members see “Add to Apple Wallet” on their card screen.' : 'Members are told plainly that this is not set up yet.'}</p>
      </form>
      </div>

      <div data-pane="money" hidden>
      <div class="panel" style="margin-top:20px">
        <h2>Dollars and points</h2>
        <p class="small muted" style="margin-top:6px"><b class="num">${s.pointsPerDollar}</b> points = <b class="num">$1.00</b>. Type either side to check a price before you put it in the catalog.</p>
        <div class="pair" style="margin-top:14px">
          <label class="field" style="margin:0"><span>Dollars</span>
            <input id="conv-usd" type="number" step="1" min="0" value="450" inputmode="decimal" class="mono"></label>
          <label class="field" style="margin:0"><span>Points</span>
            <input id="conv-pts" type="number" step="100" min="0" value="${450 * s.pointsPerDollar}" inputmode="numeric" class="mono"></label>
        </div>
        <p class="small muted" style="margin-top:10px" id="conv-note"></p>
      </div>

      ${isAdmin ? `<form class="panel" id="rules-form" style="margin-top:16px">
        <h2>The rules of the club</h2>
        <p class="small muted" style="margin-top:6px">Changing the share or the value of a point affects everyone. Tell the Circle before you do, and never after someone has booked against it.</p>
        <!-- The club's name is a rule like any other, and until now it was the only one with no
             way to change it: clubName is in SupabaseAdapter.RULE_FIELDS and update_club_rules
             patches the column, but no screen ever offered it. So the name lived in the code and
             in a database row that could only disagree with it, and the Apple Wallet pass — which
             reads the ROW, not the code — was the thing that told members the old name.

             The hint used to promise "the card, the pass, the tab and the link a stranger sees".
             Three of those four are false and were false when it was written: the card
             (member.js), the browser tab (app.js) and the social card (index.html) all render
             VOCAB.clubName, which is code and only moves on a deploy. This row reaches exactly
             one place — issue-pass, the Wallet Edge Function. Saying more than that invites an
             officer to rename the club here and believe the app has changed. -->
        <label class="field" style="margin-top:12px"><span>The name of the club</span>
          <input name="clubName" type="text" maxlength="60" value="${escapeHtml(s.clubName || VOCAB.clubName)}" autocomplete="off">
          <span class="hint">What the Apple Wallet pass is stamped with. The name on the screens is in the app itself and changes when the app is next published — ask whoever deploys it.</span></label>
        <div class="pair" style="margin-top:12px">
          <label class="field"><span>The Circle’s share</span><input name="serviceRate" type="number" step="0.01" min="0" max="0.5" value="${s.serviceRate}" inputmode="decimal"><span class="hint"><b class="num">0.15</b> is <b class="num">15%</b></span></label>
          <label class="field"><span>Points per dollar</span><input name="pointsPerDollar" type="number" value="${s.pointsPerDollar}" inputmode="numeric"><span class="hint"><b class="num">100</b> = a point is a cent</span></label>
        </div>
        <div class="pair">
          <label class="field"><span>Seats in the Circle</span><input name="memberCap" type="number" value="${s.memberCap}" inputmode="numeric"></label>
          <label class="field"><span>Quote locked for (hours)</span><input name="quoteHours" type="number" value="${s.quoteHours}" inputmode="numeric"></label>
        </div>
        <div class="pair">
          <label class="field"><span>Banker answers within (hours)</span><input name="bankerSlaHours" type="number" value="${s.bankerSlaHours}" inputmode="numeric"></label>
          <label class="field"><span>Leaving fee US$</span><input name="exitFeeUsd" type="number" value="${s.exitFeeUsd}" inputmode="decimal"></label>
        </div>
        <button class="btn block" type="submit">Save the rules</button>
      </form>` : ''}

      <!-- Postcards: the switch is back because the screen now exists (js/views/postcards.js,
           the /postcards route, the tab). While it is off nothing claims otherwise: no tab, no
           Home block, and the database refuses every insert. The figures are mono and the words
           are not, so the line wraps in the column instead of running into the gutter. -->
      ${isAdmin ? `<div class="panel" style="margin-top:16px">
        <h2>${escapeHtml(VOCAB.postcards)}</h2>
        <label class="row-between ask-switch" style="margin-top:12px">
          <span><b>${escapeHtml(VOCAB.postcards)} — a ${escapeHtml(VOCAB.postcards)} tab appears for every Insider</b>
            <span class="small muted">Photographs sent from the island, to the whole Circle or to a crew. Seen by Insiders only.</span></span>
          <input class="switch" type="checkbox" id="moments-on"${s.momentsOn ? ' checked' : ''}>
        </label>
        <p class="tiny muted" style="margin-top:10px">Album: <b class="num">${(store.albumBytes() / 1048576).toFixed(0)} MB</b> of <b class="num">1 GB</b>, of what this app uploaded</p>
      </div>` : ''}
      </div>

      ${isAdmin ? `<div data-pane="people">
      <div class="panel" style="margin-top:20px">
        <h2>The sign-up link</h2>
        <p class="small muted" style="margin-top:6px">Whoever opens one of these can take a seat themselves — they choose
          their own username and password, and you never send one. The seat cap still holds and everyone who arrives this
          way is a plain Insider. Send it to a person, not a group, and turn it off the moment it has done its job.</p>
        ${(store.signupLinks?.() || []).filter(l => !l.revokedAt).length
          ? `<ul class="ledger" style="margin-top:var(--s-3)">${(store.signupLinks() || []).filter(l => !l.revokedAt).map(l => `<li>
              <div><b>${escapeHtml(l.label || 'Untitled link')}</b>
                <span class="small muted">used <b class="num">${l.uses || 0}</b>${l.maxUses ? ` of <b class="num">${l.maxUses}</b>` : ' times'}${l.expiresAt ? ` · until ${escapeHtml(fmtDay(l.expiresAt))}` : ''}</span></div>
              <div class="row" style="gap:6px">
                <button class="btn ghost sm" data-copy-link="${escapeHtml(l.token)}">${icon('clipboard', { size: 15 })}Copy</button>
                <button class="btn ghost sm" data-kill-link="${escapeHtml(l.id)}">Turn off</button></div></li>`).join('')}</ul>`
          : `<p class="small muted" style="margin-top:10px">None open. Nobody can let themselves in right now.</p>`}
        <button class="btn block" id="new-link" style="margin-top:var(--s-3)">${icon('plus', { size: 16 })}Make a sign-up link</button>
      </div>

      <div class="panel">
        <h2>Insiders · <b class="num">${store.members.length}</b></h2>
        <p class="small muted" style="margin-top:6px">Add someone, then Give a login. Nothing is emailed to anybody.</p>
        ${isAdmin ? `<button class="btn block" id="add-member" style="margin-top:var(--s-3)">${icon('plus', { size: 16 })}Add an Insider</button>` : ''}
        <table class="people-table" style="margin-top:var(--s-4)">
          <tbody>${store.members.map(m => `<tr>
            <td><b>${escapeHtml(m.name)}</b>${m.bot ? ' <span class="chip chip-muted">robot</span>' : ''}<br><span class="small ${m.username ? 'muted mono' : ''}" ${m.username ? '' : 'style="color:var(--flag)"'}>${escapeHtml(m.username ? `@${m.username}${m.mustChangePassword ? ' · has not changed their password yet' : ''}` : 'no login yet — they cannot sign in')}</span><br><span class="small muted">${m.bot ? 'no seat, pays nothing' : escapeHtml([tierName(m.monthlyUsd), m.roles.join(', ')].filter(Boolean).join(' · '))}</span></td>
            <td data-k="State"><span class="tag">● ${escapeHtml(statusLabel(m.status === 'active' ? 'active' : m.status))}</span></td>
            <td class="num" data-k="Points">${escapeHtml(fmtPoints(store.availablePoints(m.id)))}</td>
            <td><div class="row" style="gap:6px">
              ${isAdmin ? `<button class="btn ghost sm" data-login="${m.id}">${icon('key', { size: 15 })}${m.username ? 'New password' : 'Give a login'}</button>` : ''}
              ${isAdmin ? `<button class="btn ghost sm" data-edit="${m.id}">${icon('edit', { size: 15 })}Edit</button>` : ''}
              ${isAdmin ? `<button class="btn ghost sm" data-adjust="${m.id}">Adjust</button>` : ''}</div></td></tr>`).join('')}</tbody></table>
      </div>
      </div>

      <div data-pane="record" hidden>
      <div class="panel" style="margin-top:20px">
        <h2>The record</h2>
        <p class="small muted" style="margin-top:6px">Everything anyone did, oldest at the bottom. The ledger itself can never be edited — corrections are new lines with a reason.</p>
        <div class="row" style="margin-top:12px">
          <button class="btn ghost sm" id="backup">${icon('download', { size: 15 })}Back up everything</button>
          ${store.mode === 'supabase' ? '' : `<button class="btn ghost sm" id="restore">Restore from a backup</button>
          <button class="btn ghost sm" id="reset">Reset the preview</button>`}
        </div>
        ${store.mode === 'supabase' ? `<p class="tiny muted" style="margin-top:8px">The backup is a record you can keep and read, not a restore point — putting data back is a job for Supabase, where the ledger's own history lives.</p>` : ''}
        <ul class="ledger" style="margin-top:14px">${store.audit(25).map(a => `<li>
          <span class="what"><b>${escapeHtml(a.action)}</b><span class="meta">${escapeHtml(store.member(a.actorId)?.name || 'system')} · ${escapeHtml(a.entity)}</span></span>
          <span class="delta"><small>${escapeHtml(fmtDayTime(a.at))}</small></span></li>`).join('')}</ul>
      </div>
      </div>` : ''}
    </div></section></div>`);

  // Every pane stays in the DOM and is only hidden, so the forms below keep the handlers they
  // were given at build time — switching rooms never has to re-wire anything.
  {
    const tabs = wrap.querySelector('#tabs');
    const panes = [...wrap.querySelectorAll('[data-pane]')];
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      tabs.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      panes.forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    });
  }

  {
    const u = wrap.querySelector('#conv-usd'), pt = wrap.querySelector('#conv-pts'), note = wrap.querySelector('#conv-note');
    const say = () => {
      const dollars = Number(u.value) || 0;
      const months = s.tiers.map(t => {
        const perMonth = Math.round(t.monthlyUsd * (1 - s.serviceRate) * s.pointsPerDollar) + Math.round(t.monthlyUsd * t.bonusRate * s.pointsPerDollar);
        return `${escapeHtml(tierName(t.monthlyUsd))} <b class="num">${(dollars * s.pointsPerDollar / perMonth).toFixed(1)}</b>`;
      }).join(' · ');
      // innerHTML, not textContent: every figure in this line goes in the apparatus face one at a
      // time, and the words between it stay in the reading face.
      note.innerHTML = `<b class="num">${escapeHtml(fmtAfl2(dollars, s.awgPerUsd))}</b> at the peg. Months of contributions to earn it: ${months}.`;
    };
    u.addEventListener('input', () => { pt.value = Math.round((Number(u.value) || 0) * s.pointsPerDollar); say(); });
    pt.addEventListener('input', () => { u.value = ((Number(pt.value) || 0) / s.pointsPerDollar).toFixed(2); say(); });
    say();
  }
  wrap.querySelector('#wallet-form')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = e.submitter || e.target.querySelector('[type=submit]');
    setBusy(btn, true, 'Saving…');
    try { await store.updateSettings({ wallet: { url: new FormData(e.target).get('walletUrl').trim(), token: '' } }, me.id); toast('Saved.', { kind: 'good' }); }
    catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); }
    finally { setBusy(btn, false); }
  });
  wrap.querySelector('#accounts').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const btn = e.submitter || e.target.querySelector('[type=submit]');
    setBusy(btn, true, 'Saving…');
    try {
      await store.updateSettings({
        reserveAccount: { bank: f.get('rBank'), holder: f.get('rHolder'), number: f.get('rNumber') },
        operatingAccount: { bank: f.get('oBank'), holder: f.get('oHolder'), number: f.get('oNumber') },
      }, me.id);
      toast('Saved.', { kind: 'good' });
    } catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); }
    finally { setBusy(btn, false); }
  });
  wrap.querySelector('#rules-form')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    // Every other rule here is a figure; the name is not. Number('The Inner Hotel Circle') is
    // NaN, so a blanket coercion would have wiped the club's name the first time anyone saved
    // the form for an unrelated reason.
    const TEXT = new Set(['clubName']);
    const patch = Object.fromEntries([...f.entries()].map(([k, v]) => [k, TEXT.has(k) ? String(v).trim() : Number(v)]));
    if ('clubName' in patch && !patch.clubName) { toast('The club needs a name.', { kind: 'bad' }); return; }
    const yes = await confirmDialog({ title: 'Change the rules?', confirmText: 'Change them',
      message: 'The share and the value of a point are promises to every Insider. Tell the Circle first, and never change them after someone has booked against them.' });
    if (yes) { await store.updateSettings(patch, me.id); toast('Saved. Tell the Circle what changed.', { kind: 'good' }); }
  });
  wrap.querySelector('#moments-on')?.addEventListener('change', async (e) => {
    const on = e.target.checked;
    try { await store.updateSettings({ momentsOn: on }, me.id); toast(on ? `${VOCAB.postcards} are on. The tab is there for everyone.` : `${VOCAB.postcards} are off.`, { kind: 'good' }); }
    catch (err) { e.target.checked = !on; toast(err.message, { kind: 'bad' }); }
  });
  // Adding an Insider, roles and all. This is the path that means nobody ever has to open
  // the table editor: name, email, level, what they do — and a message to send them.
  // The sign-up link. What is copied is the whole URL, never the token on its own: a token pasted
  // into a chat is something nobody can open, and the person would come back to ask.
  const linkUrl = (token) => `${location.origin}${location.pathname}#/join/${token}`;
  wrap.querySelector('#new-link')?.addEventListener('click', async () => {
    const out = await sheet({ title: 'Make a sign-up link', render: (body, close) => {
      body.innerHTML = `
        <p class="sheet-text">Anyone who opens this can take a seat — they pick their own username and password and
          are in straight away. Give it a name you will recognise later, and set a limit unless you mean it to stay open.</p>
        <label class="field"><span>What is it for</span>
          <input name="label" required maxlength="60" placeholder="For Marcus"></label>
        <label class="field"><span>How many people may use it</span>
          <input name="maxUses" type="number" min="1" max="40" inputmode="numeric" value="1">
          <span class="hint">Leave it at <b class="num">1</b> for one person. Clear it to let it stay open.</span></label>
        <label class="field"><span>Stop working after</span>
          <input name="days" type="number" min="1" max="90" inputmode="numeric" value="7">
          <span class="hint">Days from now. Clear it for no expiry.</span></label>
        <div class="sheet-actions"><button type="button" class="btn block" data-ok>Make the link</button></div>`;
      body.querySelector('[data-ok]').addEventListener('click', () => {
        const v = (n) => body.querySelector(`[name=${n}]`).value.trim();
        if (!v('label')) { toast('Give it a name so you know what it was for.', { kind: 'bad' }); return; }
        const days = Number(v('days'));
        close({ label: v('label'), maxUses: Number(v('maxUses')) || null,
                expiresAt: days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null });
      });
    } });
    if (!out) return;
    try {
      const l = await store.createSignupLink(out);
      await copyText(linkUrl(l.token));
      toast('Link made, and it is on your clipboard. Send it to one person.');
    } catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); }
  });
  wrap.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy-link]');
    if (copy) {
      await copyText(linkUrl(copy.dataset.copyLink));
      toast('On your clipboard.');
      return;
    }
    const kill = e.target.closest('[data-kill-link]');
    if (!kill) return;
    const ok = await confirmDialog({
      title: 'Turn this link off?',
      message: 'Anyone still holding it will not be able to join. Nobody who already joined is affected, and this cannot be undone — make a new link rather than reviving one that got out.',
      confirmText: 'Turn it off', danger: true,
    });
    if (!ok) return;
    try { await store.revokeSignupLink(kill.dataset.killLink); toast('That link is closed.'); }
    catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); }
  });

  wrap.querySelector('#add-member')?.addEventListener('click', async () => {
    const ROLES = [
      { id: 'member', label: 'Insider', note: 'Contributes and books. Everyone has this.' },
      { id: 'treasurer', label: 'Banker', note: 'Confirms money and closes the month.' },
      { id: 'planner', label: 'Desk', note: 'Quotes requests, edits the catalog, posts deals.' },
      { id: 'comms', label: 'Voice', note: 'Writes the notes and posts deals.' },
      { id: 'deputy', label: 'Deputy Banker', note: 'Stands in when the Banker is away.' },
      { id: 'admin', label: 'Admin', note: 'Adds people and changes the rules. Give this rarely.' },
    ];
    const { generatePassword } = await import('../core/passwords.js');
    const out = await sheet({ title: 'Add an Insider', render: (body, close) => {
      body.innerHTML = `
        <p class="sheet-text">They sign in with these two. Nothing is emailed to anybody — you pass them on
          yourself, and the app makes them choose their own password the first time.</p>
        <label class="field"><span>Their name</span><input name="name" required placeholder="Ian Hekman"></label>
        <label class="field"><span>Username</span>
          <input name="username" required autocapitalize="none" spellcheck="false" autocomplete="off" placeholder="ian"
                 pattern="[a-z0-9][a-z0-9._\-]{1,28}[a-z0-9]"></label>
        <label class="field"><span>First password</span>
          <input name="password" class="mono" required autocomplete="off" value="${escapeHtml(generatePassword())}"></label>
        <!-- This is the first button in the sheet, so it takes the opening focus and is the first
             thing read aloud. Icon-only it announced nothing at all; it says what it does now,
             in the same words as the New-password sheet. -->
        <div class="row" style="margin-bottom:var(--s-3)"><button class="btn ghost sm" type="button" data-again>${icon('refresh', { size: 15 })}Another one</button></div>
        <label class="field"><span>Level</span><select name="monthlyUsd">${s.tiers.map(t => `<option value="${t.monthlyUsd}"${t.monthlyUsd === 150 ? ' selected' : ''}>${escapeHtml(fmtUsd2(t.monthlyUsd))} · ${escapeHtml(tierName(t.monthlyUsd))}</option>`).join('')}</select></label>
        <label class="field"><span>What they are called</span><input name="title" placeholder="Voice of the Circle"></label>
        <p class="eyebrow" style="margin-top:6px">What they can do</p>
        <div class="stack" style="gap:8px;margin-top:8px">
          ${ROLES.map(r => `<label class="row" style="gap:10px;align-items:flex-start;flex-wrap:nowrap">
            <input type="checkbox" name="role" value="${r.id}"${r.id === 'member' ? ' checked' : ''} style="margin-top:2px">
            <span><b class="small">${escapeHtml(r.label)}</b><br><span class="small muted">${escapeHtml(r.note)}</span></span></label>`).join('')}
        </div>
        <label class="row" style="gap:10px;align-items:flex-start;flex-wrap:nowrap;margin-top:14px">
          <input type="checkbox" name="bot" style="margin-top:2px">
          <span><b class="small">This is a robot, not a person</b><br><span class="small muted">For the watcher on the VPS.
            It takes no seat, owes nothing, is never counted or chased, and may post what it finds to the board.
            Leave every box above unticked — it needs nothing else.</span></span></label>
        <div class="sheet-actions"><button class="btn block" data-ok>${icon('plus', { size: 16 })}Add them</button></div>`;
      const nameEl = body.querySelector('[name=name]'), userEl = body.querySelector('[name=username]');
      // Suggest a username from the first name until they type their own.
      nameEl.addEventListener('input', () => {
        if (userEl.dataset.touched) return;
        userEl.value = nameEl.value.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
      });
      userEl.addEventListener('input', () => { userEl.dataset.touched = '1'; });
      body.querySelector('[data-again]').addEventListener('click', () => { body.querySelector('[name=password]').value = generatePassword(); });
      body.querySelector('[data-ok]').addEventListener('click', () => {
        const roles = [...body.querySelectorAll('[name=role]:checked')].map(x => x.value);
        close({
          name: nameEl.value.trim(),
          username: userEl.value.trim().toLowerCase(),
          password: body.querySelector('[name=password]').value,
          title: body.querySelector('[name=title]').value.trim(),
          monthlyUsd: Number(body.querySelector('[name=monthlyUsd]').value),
          roles: roles.length ? roles : ['member'],
          bot: body.querySelector('[name=bot]').checked,
        });
      });
    } });
    if (!out?.name || !out.username) return;
    try {
      const { username, password, ...rest } = out;
      const m = await store.addMember(rest, me.id);
      await store.setMemberLogin(m.id, username, password, me.id);
      await copyText(`${username}\n${password}`);
      await showLogin({ name: m.name, username, password });
      go('/settings');
    } catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); }
  });

  // Handing someone a way in. No email is sent and none is needed: the password is generated
  // here, shown once, and Victor passes it on however he likes. They must change it the first
  // time they use it, so a password that travelled through WhatsApp stops mattering.
  wrap.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-login]'); if (!b) return;
    const m = store.member(b.dataset.login); if (!m) return;
    const { generatePassword } = await import('../core/passwords.js');
    const suggested = (m.username || m.name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '')).slice(0, 30);
    const out = await sheet({ title: m.username ? `New password for ${m.name}` : `Give ${m.name} a login`, render: (body, close) => {
      body.innerHTML = `
        <p class="sheet-text">They sign in with this username and this password. Nothing is emailed —
          you hand it over yourself, and the first thing the app makes them do is change it.</p>
        <label class="field"><span>Username</span>
          <input name="username" value="${escapeHtml(suggested)}" autocapitalize="none" spellcheck="false" autocomplete="off"
                 pattern="[a-z0-9][a-z0-9._\-]{1,28}[a-z0-9]" required${m.username ? ' readonly' : ''}>
          <span class="hint">${m.username ? 'Their username stays the same.' : 'Lower case. Letters, numbers, and . _ - in the middle.'}</span></label>
        <label class="field"><span>Password</span>
          <input name="password" class="mono" autocomplete="off" value="${escapeHtml(generatePassword())}" required></label>
        <div class="row"><button class="btn ghost sm" type="button" data-again>${icon('refresh', { size: 15 })}Another one</button></div>
        <div class="sheet-actions"><button class="btn block" data-ok>${icon('key', { size: 16 })}Set it</button></div>`;
      body.querySelector('[data-again]').addEventListener('click', () => { body.querySelector('[name=password]').value = generatePassword(); });
      body.querySelector('[data-ok]').addEventListener('click', () => close({
        username: body.querySelector('[name=username]').value.trim().toLowerCase(),
        password: body.querySelector('[name=password]').value,
      }));
    } });
    if (!out?.username || !out.password) return;
    try {
      await store.setMemberLogin(m.id, out.username, out.password);
      await copyText(`${out.username}\n${out.password}`);
      await showLogin({ name: m.name, username: out.username, password: out.password });
      go('/settings');
    } catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); }
  });

  // Editing someone — above all, giving them the email they sign in with. Without this the
  // only way to fix a missing address is the table editor, which is how we got two Ians.
  wrap.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'); if (!ed) return;
    const m = store.member(ed.dataset.edit); if (!m) return;
    const ROLES = [
      { id: 'member', label: 'Insider' }, { id: 'treasurer', label: 'Banker' },
      { id: 'planner', label: 'Desk' }, { id: 'comms', label: 'Voice' },
      { id: 'deputy', label: 'Deputy Banker' }, { id: 'admin', label: 'Admin' },
    ];
    const out = await sheet({ title: `Edit ${m.name}`, render: (body, close) => {
      body.innerHTML = `
        ${m.username ? '' : `<div class="notice warn"><b>${icon('alert', { size: 16 })} No login yet</b>
          <p class="small">They cannot sign in until you give them one. Close this and tap <b>Give a login</b>.</p></div>`}
        <label class="field"><span>Name</span><input name="name" value="${escapeHtml(m.name)}" required></label>
        <label class="field"><span>Username</span><input class="mono" value="${escapeHtml(m.username || 'no login yet')}" readonly>
          <span class="hint">${m.username ? 'Set with "New password".' : 'Give them a login to set one.'}</span></label>
        <label class="field"><span>Level</span><select name="monthlyUsd">${s.tiers.map(t => `<option value="${t.monthlyUsd}"${t.monthlyUsd === m.monthlyUsd ? ' selected' : ''}>${escapeHtml(fmtUsd2(t.monthlyUsd))} · ${escapeHtml(tierName(t.monthlyUsd))}</option>`).join('')}</select></label>
        <label class="field"><span>What they are called</span><input name="title" value="${escapeHtml(m.title || '')}"></label>
        <p class="eyebrow" style="margin-top:6px">What they can do</p>
        <div class="stack tight" style="justify-items:start;margin-top:8px">
          ${ROLES.map(r => `<label class="row" style="gap:10px;flex-wrap:nowrap"><input type="checkbox" name="role" value="${r.id}"${(m.roles || []).includes(r.id) ? ' checked' : ''}><span class="small">${escapeHtml(r.label)}</span></label>`).join('')}
        </div>
        <div class="sheet-actions"><button class="btn block" data-ok>${icon('check', { size: 16 })}Save</button></div>`;
      body.querySelector('[data-ok]').addEventListener('click', () => {
        const roles = [...body.querySelectorAll('[name=role]:checked')].map(x => x.value);
        close({
          name: body.querySelector('[name=name]').value.trim(),
          title: body.querySelector('[name=title]').value.trim(),
          monthlyUsd: Number(body.querySelector('[name=monthlyUsd]').value),
          roles: roles.length ? roles : ['member'],
        });
      });
    } });
    if (!out?.name) return;
    // Another member already on that address would break sign-in for both of them.
    const clash = out.email && store.members.find(x => x.id !== m.id && (x.email || '').toLowerCase() === out.email.toLowerCase());
    if (clash) { toast(`${clash.name} is already on that email.`, { kind: 'bad', timeout: 6000 }); return; }
    // Read this before the write: updateMember assigns straight onto the member object.
    const wasLockedOut = !m.email;
    try {
      await store.updateMember(m.id, out, me.id);
      toast(out.email && wasLockedOut ? `${out.name} can sign in now — send them the link.` : 'Saved.', { kind: 'good' });
      go('/settings');
    } catch (err) { toast(err.message, { kind: 'bad', timeout: 6000 }); }
  });

  wrap.addEventListener('click', async (e) => {
    const adj = e.target.closest('[data-adjust]');
    if (adj) {
      const m = store.member(adj.dataset.adjust);
      const out = await sheet({ title: `Adjust ${m.name}’s points`, render: (body, close) => {
        body.innerHTML = `<p class="sheet-text">This writes a new line in the ledger; nothing is ever edited. Say why — everyone can see it, including ${escapeHtml(m.name.split(' ')[0])}.</p>
          <div class="segmented even" role="group" aria-label="Give or take away" id="give-take">
            <button type="button" data-dir="give" aria-pressed="true">Give</button>
            <button type="button" data-dir="take" aria-pressed="false">Take away</button>
          </div>
          <label class="field" style="margin-top:14px"><span>Points</span><input name="pts" type="number" min="1" inputmode="numeric" required></label>
          <label class="field"><span>Reason</span><input name="note" required placeholder="Hotel refunded a night after the storm"></label>
          <div class="sheet-actions"><button class="btn block" data-ok>Write the line</button></div>`;
        // The iOS numeric pad has no minus, so the direction is a control and the sign is applied here.
        const dirs = body.querySelector('#give-take');
        dirs.addEventListener('click', (ev) => {
          const b = ev.target.closest('[data-dir]'); if (!b) return;
          dirs.querySelectorAll('[data-dir]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        });
        body.querySelector('[data-ok]').addEventListener('click', () => {
          const take = dirs.querySelector('[data-dir="take"]').getAttribute('aria-pressed') === 'true';
          const n = Math.abs(Number(body.querySelector('[name=pts]').value) || 0);
          close({ pts: take ? -n : n, note: body.querySelector('[name=note]').value });
        });
      } });
      if (out?.note) { try { await store.adjustPoints(m.id, out.pts, out.note, me.id); toast('Written to the ledger.'); } catch (err) { toast(err.message, { kind: 'bad' }); } }
    }
    if (e.target.id === 'backup') downloadText(`${VOCAB.slug}-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportJson(), 'application/json');
    if (e.target.id === 'reset') {
      const yes = await confirmDialog({ title: 'Reset the preview?', danger: true, confirmText: 'Reset', message: 'Everything in this browser goes back to how the preview started. The real Circle is untouched.' });
      if (yes) { const { seed } = await import('../data/seed.js'); await store.reset(seed); toast('Back to the start.'); go('/'); }
    }
    if (e.target.id === 'restore') {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json' });
      input.addEventListener('change', async () => {
        const file = input.files[0]; if (!file) return;
        try { await store.importJson(await file.text()); toast('Restored.', { kind: 'good' }); }
        catch (err) { toast(err.message, { kind: 'bad' }); }
      });
      input.click();
    }
  });
  return wrap;
}
