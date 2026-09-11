// The officers' screens — the Banker's inbox and month close, the Desk, settings —
// plus the two everyone can see: the Circle and the Pool.
import { countdownTo, downloadText, escapeHtml, fmtAfl2, fmtDay, fmtDayTime, fmtMonth, fmtPct, fmtPoints, fmtUsd2, initials, monthKey, pointsUsd, safeUrl, sum, toCsv } from '../core/util.js';
import { VOCAB, tierName } from '../core/vocab.js';
import { splitContribution, tierFor, fromPoints, seatPoints, RATE_BAND_LIST } from '../core/money.js';
import { poolGauge, rankCrest, ring } from '../ui/pieces.js';
import { treeSvg } from '../ui/art.js';
import { toast, sheet, confirmDialog, setBusy, chip, statusLabel, avatar } from '../ui/components.js';
import { columns, tableFor, sparkline } from '../ui/charts.js';
import { waLink, TEMPLATES, copyText, shareText } from '../core/share.js';
import { quoteSheet, bookSheet } from './catalog.js';
import { photoFor } from './public.js';
import { icon } from '../ui/icons.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };

// ---------------------------------------------------------------- the Banker
export function bank({ store, go }) {
  const me = store.me, s = store.settings;
  const t = store.treasury();
  const pending = store.pendingContributions();
  const month = monthKey();
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <div class="row-between">
        <div><p class="eyebrow">${icon('inbox')}${escapeHtml(VOCAB.treasurerTitle)}</p><h1>The inbox</h1></div>
        <div class="row no-print">
          <button class="btn sm" id="record">${icon('banknote', { size: 16 })}Money came in</button>
          <a class="btn ghost sm" href="#/bank/close/${month}">${icon('lock', { size: 16 })}Close ${escapeHtml(fmtMonth(month))}</a></div>
      </div>
      <div class="grid g4" style="margin-top:20px">
        <div class="stat"><span class="k">Waiting for you</span><b class="num">${pending.length}</b><span class="sub">${escapeHtml(fmtUsd2(t.pendingUsd))} marked as sent</span></div>
        <div class="stat"><span class="k">Confirmed this month</span><b class="num">${t.confirmedThisMonth} / ${t.expectedThisMonth}</b><span class="sub">${escapeHtml(fmtMonth(month))}</span></div>
        <div class="stat"><span class="k">Reserve</span><b class="num">${escapeHtml(fmtUsd2(t.reserveUsd))}</b><span class="sub">backs ${escapeHtml(fmtPoints(t.outstandingPoints))}</span></div>
        <div class="stat"><span class="k">Coverage</span><b class="num">${escapeHtml(fmtPct(t.coverage))}</b><span class="sub">${t.verified ? `verified ${escapeHtml(fmtDay(t.verified.at))}` : 'not yet verified'}</span></div>
      </div>
      ${pending.length ? `<div class="row" style="margin-top:18px" id="bulk">
        <button class="btn sm" id="confirm-all">Confirm all ${pending.length}</button>
        <span class="small muted">Only confirm what you can see on the statement.</span></div>` : ''}
      <div class="stack" id="queue" style="margin-top:18px"></div>
      <div class="panel" style="margin-top:22px">
        <h2 style="font-size:1.1rem">Not sent yet this month</h2>
        <p class="small muted" style="margin-top:6px">Only you and Ian see this. Nobody is ever shown a public late list.</p>
        <div class="row" style="margin-top:12px" id="missing"></div>
      </div>
    </div></section></div>`);

  const queue = wrap.querySelector('#queue');
  if (!pending.length) queue.appendChild(el(`<div class="empty">${icon('checkCircle', { size: 28, cls: 'ico-muted' })}<b style="display:block;margin-top:10px">Nothing waiting</b><p class="small muted">Every transfer marked as sent has been confirmed or returned. ${escapeHtml(VOCAB.pap.thanks[0])}.</p></div>`));
  for (const c of pending) {
    const m = store.member(c.memberId);
    const row = el(`<div class="panel" data-id="${c.id}">
        <div class="row-between">
          <div class="row" style="gap:12px">
            ${avatar(m, 40)}
            <div><b>${escapeHtml(m.name)}</b> · ${escapeHtml(tierName(m.monthlyUsd))}
              <br><span class="small muted">${c.extra ? 'Extra, not a monthly' : escapeHtml(fmtMonth(c.forMonth))} · sent ${escapeHtml(fmtDay(c.submittedAt))} · ${escapeHtml(c.bank || c.method || 'bank transfer')}${c.recordedBy ? ' · entered by the Banker' : ''}</span>
              ${(c.proofName || c.proofPath || c.proofDataUrl) ? `<br><button class="btn quiet sm" data-proof="${escapeHtml(c.id)}" style="padding-inline:0">${icon('eye', { size: 14 })}See the screenshot</button>` : ''}</div>
          </div>
          <div style="text-align:right"><b class="num" style="font-size:1.2rem">${escapeHtml(fmtUsd2(c.expectedUsd))}</b>
            <br><span class="small muted num">${escapeHtml(fmtAfl2(c.expectedUsd, s.awgPerUsd))}</span></div>
        </div>
        <div class="copyline" style="margin-top:12px"><code class="num">${escapeHtml(c.reference || 'no reference given')}</code>
          <button class="btn quiet sm" data-copy="${escapeHtml(c.reference || '')}">Copy</button></div>
        ${c.note ? `<p class="small muted" style="margin-top:10px">“${escapeHtml(c.note)}”</p>` : ''}
        <div class="row" style="margin-top:14px">
          <button class="btn good" data-act="confirm">${icon('check', { size: 16 })}Confirm ${escapeHtml(fmtUsd2(c.expectedUsd))}</button>
          <button class="btn ghost" data-act="partial">${icon('scale', { size: 16 })}A different amount arrived</button>
          <button class="btn danger" data-act="return">${icon('refresh', { size: 16 })}Return it</button>
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
              <div class="grid g2">
                <label class="field"><span>Amount received</span><input name="amt" type="number" step="0.01" value="${c.expectedUsd}" inputmode="decimal"></label>
                <label class="field"><span>Currency</span><select name="cur"><option value="USD">US dollars</option><option value="AWG">Aruban florin</option></select></label>
              </div>
              <label class="field"><span>Note for the ledger</span><input name="note" placeholder="Bank fee deducted at the sending side."></label>
              <div id="prev" class="notice"></div>
              <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn good" data-ok>Confirm that amount</button></div>`;
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
      await sheet({ title: c.proofName || 'The screenshot', render: (body, close) => {
        body.innerHTML = `<img src="${escapeHtml(src)}" alt="The transfer screenshot as it was sent"
            style="width:100%;border-radius:var(--r-input);border:1px solid var(--hairline)">
          <div class="sheet-actions"><button class="btn ghost" data-close>Close</button>
            <a class="btn" href="${escapeHtml(src)}" target="_blank" rel="noopener">${icon('external', { size: 16 })}Open it full size</a></div>`;
        body.querySelector('[data-close]').addEventListener('click', () => close());
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
        <div class="grid g3">
          <label class="field"><span>Amount</span><input name="amount" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="300" required autofocus></label>
          <label class="field"><span>Currency</span><select name="currency"><option value="USD">US dollars</option><option value="AWG">Aruban florin</option></select></label>
          <label class="field"><span>How it came</span><select name="method">
            <option value="cash">Cash</option><option value="bank">Bank transfer</option>
            <option value="card">Card</option><option value="other">Some other way</option></select></label>
        </div>
        <label class="field"><span>What is it for</span>
          <select name="forMonth"><option value="">Extra — on top of their monthly</option></select>
          <span class="hint" id="month-hint"></span></label>
        <label class="field"><span>Note for their ledger</span>
          <input name="note" placeholder="Cash at the shop, 6 September." required></label>
        <div id="prev" class="notice"></div>
        <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button>
          <button class="btn good" data-ok>${icon('check', { size: 16 })}Record it</button></div>`;

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
        <p class="small">Closed by ${escapeHtml(store.member(p.alreadyClosed.closedBy)?.name || '')} on ${escapeHtml(fmtDayTime(p.alreadyClosed.closedAt))}, co-signed by ${escapeHtml(store.member(p.alreadyClosed.cosignedBy)?.name || '')}. Reserve at close ${escapeHtml(fmtUsd2(p.alreadyClosed.bankBalanceUsd))}, coverage ${escapeHtml(fmtPct(p.alreadyClosed.coverage))}.</p></div>` : ''}
      <div class="side" style="margin-top:20px">
        <div>
          <div class="panel">
            <div class="row" style="gap:16px;align-items:center">
              <span id="rollcall"></span>
              <div><b>${p.confirmedCount} of ${p.rows.length} confirmed</b>
                <br><span class="small muted">${p.pendingCount} still waiting for you · ${p.missingCount} never arrived</span></div>
            </div>
            <div class="tablewrap" style="margin-top:16px;border:0">
              <table><thead><tr><th>Insider</th><th>Tier</th><th class="num">Expected</th><th class="num">Received</th><th>Reference</th><th>State</th></tr></thead>
              <tbody>${p.rows.map(r => `<tr>
                <td>${escapeHtml(r.member.name)}</td><td>${escapeHtml(tierName(r.member.monthlyUsd))}</td>
                <td class="num">${escapeHtml(fmtUsd2(r.expectedUsd))}</td><td class="num">${r.receivedUsd == null ? '—' : escapeHtml(fmtUsd2(r.receivedUsd))}</td>
                <td class="small num">${escapeHtml(r.reference || '—')}</td>
                <td>${chip(r.status === 'missing' ? 'due' : r.status, r.status === 'missing' ? 'Not sent' : undefined)}${r.full === false ? ' <span class="small muted">short</span>' : ''}</td></tr>`).join('')}</tbody></table>
            </div>
          </div>
        </div>
        <div class="stack">
          <div class="panel flat">
            <p class="eyebrow">${icon('calendar')}The month</p>
            <ul class="ledger" style="margin-top:10px">
              <li><span class="what"><b>Collected</b></span><span class="delta"><b>${escapeHtml(fmtUsd2(p.grossUsd))}</b></span></li>
              <li><span class="what"><b>To the Reserve</b><span class="meta">all of it — a point per dollar</span></span><span class="delta"><b>${escapeHtml(fmtUsd2(p.grossUsd))}</b></span></li>
              <li><span class="what"><b>Coverage now</b><span class="meta">Reserve ÷ everything owed</span></span><span class="delta"><b>${escapeHtml(fmtPct(p.treasury.coverage))}</b></span></li>
            </ul>
          </div>
          <form class="panel" id="close-form">
            <h2 style="font-size:1.05rem">Seal the month</h2>
            <label class="field" style="margin-top:12px"><span>Reserve balance on the bank statement</span>
              <input name="balance" type="number" step="0.01" inputmode="decimal" value="${p.treasury.reserveExpectedUsd.toFixed(2)}" required>
              <span class="hint">The ledger says it should be ${escapeHtml(fmtUsd2(p.treasury.reserveExpectedUsd))}. A gap of more than $${s.closeToleranceUsd} blocks the close.</span></label>
            <label class="field"><span>Second officer</span><select name="cosigner" required>
              <option value="">Choose who co-signs</option>
              ${others.map(o => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select></label>
            <label class="field"><span>Note</span><input name="note" placeholder="All transfers matched."></label>
            <button class="btn block" type="submit" ${p.alreadyClosed ? 'disabled' : ''}>Close ${escapeHtml(fmtMonth(month))}</button>
            ${p.pendingCount ? `<p class="small" style="margin-top:10px;color:var(--flag)">${p.pendingCount} transfer${p.pendingCount > 1 ? 's are' : ' is'} still waiting. Confirm or return ${p.pendingCount > 1 ? 'them' : 'it'} first.</p>` : ''}
          </form>
        </div>
      </div>
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
      <div class="row no-print" style="margin-top:16px" role="tablist" id="tabs">
        <button class="btn sm" data-tab="requests" aria-pressed="true">Requests${open.length ? ` · ${open.length}` : ''}</button>
        <button class="btn quiet sm" data-tab="wanted" aria-pressed="false">${icon('bell', { size: 15 })}Wanted${store.watches().length ? ` · ${store.watches().length}` : ''}</button>
        <button class="btn quiet sm" data-tab="deals" aria-pressed="false">${icon('zap', { size: 15 })}Deals${store.liveDeals().length ? ` · ${store.liveDeals().length}` : ''}</button>
        <button class="btn quiet sm" data-tab="catalog" aria-pressed="false">Stays &amp; trips</button>
        <button class="btn quiet sm" data-tab="notes" aria-pressed="false">Notes</button>
      </div>
      <div id="panel" style="margin-top:18px"></div>
    </div></section></div>`);
  const panel = wrap.querySelector('#panel');
  let tab = 'requests';

  /** What the Circle has asked to be told about — this is the shopping list. */
  const drawWanted = () => {
    const rows = store.demand();
    panel.replaceChildren(el(`<div>
      <div class="notice" style="margin-bottom:16px">
        <b>${icon('compass', { size: 16 })} This is what to go and look for</b>
        <p class="small">Every line is an Insider who said they would take it if it appeared. Find one, post it, and they hear in the same minute you do — no group chat, no chasing.</p>
      </div>
      ${rows.length ? `<div class="stack">${rows.map(r => {
        const stay = r.stay;
        const names = [...r.members].map(id => store.member(id)?.name.split(' ')[0]).filter(Boolean);
        const room = store.roomType(r.roomTypeId);
        const windows = r.watches.map(w => `${fmtDay(w.from)} – ${fmtDay(w.to)}${w.nights ? ` · ${w.nights}n` : ''}`);
        return `<div class="panel">
          <div class="row-between" style="align-items:flex-start;gap:14px">
            <div>
              <h3 style="font-size:1.05rem">${escapeHtml(stay?.name || 'Anywhere on the island')}${room ? ` · ${escapeHtml(room.name)}` : ''}</h3>
              <p class="small muted" style="margin-top:6px">${icon('users', { size: 14, cls: 'ico-muted' })}
                ${r.count} ${r.count === 1 ? 'Insider' : 'Insiders'}: ${escapeHtml(names.join(', '))}</p>
              <p class="small muted" style="margin-top:4px">${icon('calendar', { size: 14, cls: 'ico-muted' })} ${escapeHtml(windows.join(' · '))}</p>
            </div>
            <div class="row" style="flex:none">
              ${r.matched ? `<span class="tag" style="background:var(--good-soft);color:var(--good-text);border-color:transparent">${icon('check', { size: 13 })}on the board</span>` : ''}
              ${stay ? `<button class="btn sm" data-post="${escapeHtml(stay.id)}" data-room="${escapeHtml(r.roomTypeId || '')}">${icon('plus', { size: 15 })}Post one</button>` : ''}
            </div>
          </div></div>`;
      }).join('')}</div>`
      : `<div class="empty">${icon('bell', { size: 30, cls: 'ico-muted' })}
          <b style="display:block;margin-top:10px">Nobody is watching for anything yet</b>
          <p class="small muted">When Insiders start adding watches, this becomes the list of what to hunt for.</p></div>`}
    </div>`));
  };

  const drawDeals = () => {
    const live = store.liveDeals();
    panel.replaceChildren(el(`<div>
      <div class="row" style="margin-bottom:16px"><button class="btn sm" id="post-deal">${icon('plus', { size: 16 })}Post a deal</button>
        <a class="btn ghost sm" href="#/deals">${icon('eye', { size: 15 })}See it as a member does</a></div>
      ${live.length ? `<div class="stack">${live.map(d => {
        const stay = store.stay(d.stayId);
        const hits = store.matchesForDeal(d.id);
        return `<div class="panel" data-deal="${escapeHtml(d.id)}">
          <div class="row-between" style="align-items:flex-start;gap:14px">
            <div>
              <h3 style="font-size:1.02rem">${escapeHtml(d.title || stay?.name || '')}</h3>
              <p class="small muted" style="margin-top:5px">${escapeHtml(fmtDay(d.from))} – ${escapeHtml(fmtDay(d.to))} · ${d.nights} nights · ${escapeHtml(fmtPoints(d.pointsTotal))}
                · from ${escapeHtml(d.source)}</p>
              <p class="small" style="margin-top:6px;color:${hits.length ? 'var(--good-text)' : 'var(--ink-3)'}">
                ${icon(hits.length ? 'bellRing' : 'bell', { size: 14 })}
                ${hits.length ? `${hits.length} ${hits.length === 1 ? 'Insider was' : 'Insiders were'} waiting for this` : 'Nobody was watching for this one'}</p>
            </div>
            <div class="row" style="flex:none">
              ${safeUrl(d.sourceUrl) ? `<a class="btn ghost sm" href="${escapeHtml(safeUrl(d.sourceUrl))}" target="_blank" rel="noopener noreferrer">${icon('external', { size: 15 })}</a>` : ''}
              <button class="btn quiet sm" data-retire="${escapeHtml(d.id)}">${icon('x', { size: 15 })}Gone</button>
            </div>
          </div></div>`;
      }).join('')}</div>`
      : `<div class="empty">${icon('zap', { size: 30, cls: 'ico-muted' })}
          <b style="display:block;margin-top:10px">Nothing on the board</b>
          <p class="small muted">Post the moment you see something — a good week goes within hours.</p></div>`}
    </div>`));
  };

  const drawRequests = () => {
    // Three lanes, by what the Desk owes: a price, a booking, or nothing yet. A flat list mixed
    // the three and hid the one that is Victor's own job — booking it — behind an "Open".
    const hoursLeft = (r) => (tierFor(s, store.member(r.memberId)?.monthlyUsd)?.slaHours ?? s.slaHours) - Math.round((Date.now() - new Date(r.requestedAt)) / 36e5);
    const lanes = [
      { key: 'requested', title: 'To look and price', sub: 'Open it, look, price it. Nothing is promised to anyone until you do.',
        rows: open.filter(r => r.status === 'requested').sort((a, b) => hoursLeft(a) - hoursLeft(b)) },
      { key: 'held', title: 'To book', sub: 'They said yes and their points are committed. Book it yourself, then write down the confirmation.',
        rows: open.filter(r => r.status === 'held').sort((a, b) => (a.approvedAt ? 1 : 0) - (b.approvedAt ? 1 : 0) || String(a.heldAt).localeCompare(String(b.heldAt))) },
      { key: 'quoted', title: 'Waiting on the member', sub: 'Priced. Nothing to do until they say yes, or the price lapses.',
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
          <div class="row" style="gap:12px;min-width:0">${avatar(m, 38)}
            <div style="min-width:0"><b>${escapeHtml(m?.name || '')}</b> → ${escapeHtml(st?.name || '')}
              <br><span class="small muted">${escapeHtml(fmtDay(r.checkIn))} – ${escapeHtml(fmtDay(r.checkOut))} · ${r.nights} night${r.nights > 1 ? 's' : ''} · ${r.guests} guest${r.guests > 1 ? 's' : ''}${r.flexDays ? ` · flexible ±${r.flexDays}d` : ''}</span></div>
          </div>
          <div style="text-align:right;flex:none">${r.status === 'held' ? chip(r.approvedAt ? 'held' : 'requested', r.approvedAt ? 'Booking it' : 'To book') : r.status === 'quoted' ? chip('quoted', 'Priced') : chip(r.status)}<br><span class="small muted num">${escapeHtml(fmtPoints(r.quotedPoints || r.indicativePoints))}</span></div>
        </div>
        ${r.note ? `<p class="small muted" style="margin-top:10px">“${escapeHtml(r.note)}”</p>` : ''}
        <div class="row" style="margin-top:12px;align-items:center">
          ${r.status === 'requested' && store.canQuote(r) ? `<button class="btn sm" data-quote="${r.id}">${icon('tag', { size: 15 })}Look and price</button>
            <span class="small ${sla < 12 ? '' : 'muted'}" ${sla < 12 ? 'style="color:var(--flag)"' : ''}>${sla > 0 ? `${sla}h left of the ${promised}-hour promise` : `past the ${promised}-hour promise`}</span>` : ''}
          ${r.status === 'held' && store.hasRole('planner', 'admin', 'treasurer', 'deputy') ? `<button class="btn good sm" data-book="${r.id}">${icon('check', { size: 15 })}Book it</button>` : ''}
          ${r.status === 'held' && store.canPlan() && !r.approvedAt ? `<button class="btn ghost sm" data-approve="${r.id}">I have it</button>` : ''}
          ${r.status === 'held' ? `
            ${topUpOwed ? `<span class="small" style="color:var(--flag)">${escapeHtml(fmtUsd2(r.topUpUsd))} top-up still to the Banker</span>` : ''}` : ''}
          ${r.status === 'quoted' ? `<span class="small muted">${left ? `the price holds another ${escapeHtml(left)}` : 'the price has lapsed'}</span>` : ''}
          <a class="btn ghost sm" href="#/requests/${r.id}">Open</a>
        </div></div>`;
    };
    panel.replaceChildren(el(`<div class="stack lanes">${lanes.map(l => `<section class="lane lane-${l.key}">
        <div class="lane-head"><div><p class="eyebrow">${escapeHtml(l.title)}</p><p class="small muted">${escapeHtml(l.sub)}</p></div><b class="num lane-count">${l.rows.length}</b></div>
        ${l.rows.length ? `<div class="stack">${l.rows.map(row).join('')}</div>` : '<p class="small muted lane-empty">Nothing here.</p>'}
      </section>`).join('')}</div>`));
  };

  const drawCatalog = () => {
    const list = store.stays;
    panel.replaceChildren(el(`<div class="panel">
      <div class="row-between"><h2 style="font-size:1.1rem">What the Circle offers</h2>
        <button class="btn ghost sm" id="add">Add a stay</button></div>
      <div class="tablewrap" style="margin-top:14px;border:0"><table>
        <thead><tr><th>Name</th><th>Area</th><th class="num">From, a night</th><th>State</th><th></th></tr></thead>
        <tbody>${list.map(st => `<tr>
          <td><b>${escapeHtml(st.name)}</b><br><span class="small muted">${st.kind === 'trip' ? `${escapeHtml(fmtDay(st.dates.from))} · ${st.nights} nights` : `min ${st.minNights} nights`}</span></td>
          <td class="small">${escapeHtml(st.area)}</td>
          ${st.kind === 'trip'
            ? `<td class="num">${escapeHtml(fmtPoints(seatPoints(st, s)))} a seat</td>`
            : `<td class="num">${escapeHtml(fmtPoints(fromPoints(st, s)))}</td>`}
          <td>${st.active ? chip('confirmed', 'Live') : chip('cancelled', 'Draft')}</td>
          <td><button class="btn quiet sm" data-edit="${st.id}">Edit</button></td></tr>`).join('')}</tbody>
      </table></div>
      <p class="small muted" style="margin-top:12px">The cheapest night of the year at each place — open one to set all three of its rates. Members see the points; you edit the dollars.</p>
    </div>`));
  };

  const drawNotes = () => {
    const notes = store.announcements();
    panel.replaceChildren(el(`<div class="stack">
      <form class="panel" id="note-form">
        <h2 style="font-size:1.1rem">Write to the Circle</h2>
        <p class="small muted" style="margin-top:6px">Every note opens “Bon dia, Circle” and is signed by you. Nothing is ever sent without you tapping send.</p>
        <label class="field" style="margin-top:12px"><span>Title</span><input name="title" required placeholder="Samaná is open — fourteen seats"></label>
        <label class="field"><span>Note</span><textarea name="body" rows="5" required placeholder="Bon dia, Circle. …"></textarea></label>
        <label class="row" style="gap:10px;margin-bottom:14px"><input type="checkbox" name="pinned" style="width:20px;height:20px"><span class="small">Pin it to the top</span></label>
        <button class="btn" type="submit">Publish</button>
      </form>
      <div class="panel"><h2 style="font-size:1.1rem">Ready-made messages</h2>
        <p class="small muted" style="margin-top:6px">Open in WhatsApp with the details already filled in. You decide what to send and to whom.</p>
        <div class="row" style="margin-top:12px" id="templates"></div></div>
      <div class="panel"><h2 style="font-size:1.1rem">Published</h2>
        <ul class="ledger" style="margin-top:10px">${notes.map(n => `<li><span class="what"><b>${escapeHtml(n.title)}</b>
          <span class="meta">${escapeHtml(store.member(n.authorId)?.name.split(' ')[0] || '')} · ${escapeHtml(fmtDay(n.at))}${n.pinned ? ' · pinned' : ''}</span></span>
          <span class="delta"><button class="btn quiet sm" data-del="${n.id}">Delete</button></span></li>`).join('')}</ul></div>
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
    tab = b.dataset.tab;
    wrap.querySelectorAll('[data-tab]').forEach(x => { const on = x.dataset.tab === tab; x.setAttribute('aria-pressed', String(on)); x.className = `btn ${on ? '' : 'quiet'} sm`; });
    draw();
  });
  return wrap;
}

/** A dollars box and a points box that keep each other honest. */
function moneyPair(key, label, valueUsd, s) {
  const usd = Number(valueUsd) || 0;
  return `<div class="field"><span>${escapeHtml(label)}</span>
    <div class="row" style="gap:8px;flex-wrap:nowrap">
      <span class="row" style="gap:4px;flex:1;min-width:0"><span class="muted">$</span>
        <input data-usd="${escapeHtml(key)}" type="number" step="1" min="0" inputmode="decimal" value="${usd.toFixed(0)}" aria-label="${escapeHtml(label)} in dollars" style="min-width:0"></span>
      <span class="row" style="gap:4px;flex:1;min-width:0"><span class="muted">✦</span>
        <input data-pts="${escapeHtml(key)}" type="number" step="100" min="0" inputmode="numeric" value="${Math.round(usd * s.pointsPerDollar)}" aria-label="${escapeHtml(label)} in points" class="mono" style="min-width:0"></span>
    </div></div>`;
}

async function editStay(store, stay) {
  const s = store.settings;
  const isTrip = stay?.kind === 'trip';
  const out = await sheet({ title: stay ? `Edit ${stay.name}` : 'Add a stay', wide: true, render: (body, close) => {
    body.innerHTML = `
      <div class="grid g2">
        <label class="field"><span>Name</span><input name="name" value="${escapeHtml(stay?.name || '')}" required></label>
        <label class="field"><span>Area</span><input name="area" value="${escapeHtml(stay?.area || '')}"></label>
      </div>
      <p class="eyebrow" style="margin-bottom:8px">${isTrip ? 'What a seat costs us' : 'What a night costs us'}</p>
      <p class="small muted" style="margin-bottom:12px">The room, taxes and levies included — what the Circle pays. The member is charged ${escapeHtml(fmtPct(s.serviceRate, 0))} on top of this when they spend points, and that is the number every screen shows them. Type dollars or points, whichever you have in your head; the other follows at ${s.pointsPerDollar} points to the dollar.</p>
      ${isTrip ? `<div class="grid g2">${moneyPair('seat', 'A seat, before our share', stay.pointsPerSeat / s.pointsPerDollar, s)}
          <label class="field"><span>Guest price in cash US$</span><input name="guestCashUsd" type="number" step="1" value="${stay.guestCashUsd || 0}" inputmode="decimal">
            <span class="hint">What a non-member pays the Banker, at face value.</span></label></div>`
        : `<div class="grid g3">
        ${RATE_BAND_LIST.map(b => moneyPair(b.id, `${b.from} – ${b.to}`,
            stay?.rates?.[b.id] ?? ({ low: 250, high: 380, peak: 460 })[b.id], s)).join('')}
      </div>
      <p class="small muted" style="margin-bottom:14px">Three dates, three rates — the way the hotels quote them. A member never sees these three or any name for them: they give their dates and the app prices those nights.</p>
      <div class="grid g3">
        <label class="field"><span>Minimum nights</span><input name="minNights" type="number" value="${stay?.minNights || 2}" inputmode="numeric"></label>
        <label class="field"><span>Minimum, 20 Dec – 3 Jan</span><input name="peakMinNights" type="number" value="${stay?.peakMinNights || 7}" inputmode="numeric"></label>
        <label class="field"><span>Public rate US$</span><input name="retailUsd" type="number" value="${stay?.retailUsd || 0}" inputmode="decimal"></label>
      </div>
      <label class="field"><span>Booking page</span>
        <input name="site" type="url" value="${escapeHtml(stay?.site || '')}" placeholder="https://…" inputmode="url">
        <span class="hint">Where you actually go to book this place. It is the link on every request for it, so when a member asks you are one tap from the room instead of searching for it again.</span></label>
      <p class="eyebrow" style="margin:20px 0 8px">What the booking sites are asking</p>
      <p class="small muted" style="margin-bottom:12px">Type what you actually saw and the day you saw it. This is what a member is shown under the price — with the date, always, so nobody is comparing against something six months old. Leave it empty and the page says plainly that nobody has checked.</p>
      <div class="grid g3">
        <label class="field"><span>Interval, a night US$</span><input name="srcIntervalUsd" type="number" step="0.01" value="${stay?.sources?.interval?.seenUsd || ''}" inputmode="decimal"></label>
        <label class="field"><span>RedWeek, from US$</span><input name="srcRedweekUsd" type="number" step="0.01" value="${stay?.sources?.redweek?.fromUsd || ''}" inputmode="decimal"></label>
        <label class="field"><span>Seen on</span><input name="srcSeenOn" type="date" value="${escapeHtml(stay?.sources?.interval?.seenOn || stay?.sources?.redweek?.seenOn || '')}"></label>
      </div>`}
      <label class="field"><span>What it is like</span><textarea name="vibe" rows="2">${escapeHtml(stay?.vibe || '')}</textarea></label>
      <label class="field"><span>Note from Victor</span><input name="dealNote" value="${escapeHtml(stay?.dealNote || '')}"></label>
      <div class="field" id="photo-block">
        <span>Photograph</span>
        <div id="photo-preview" class="photo-preview">${photoFor(stay)
          ? `<img src="${escapeHtml(photoFor(stay))}" alt="">${stay?.photoUrl ? '' : '<span class="tiny muted" style="display:block;margin-top:4px">From the property\'s own site, with its page and date on record. One you upload replaces it.</span>'}`
          : '<span class="small muted">No photograph yet — the card shows a blank plate until there is one.</span>'}</div>
        <div class="row" style="margin-top:8px">
          <label class="btn ghost sm" style="cursor:pointer">${icon('camera', { size: 15 })}Choose a photograph<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" hidden></label>
          ${stay?.photoUrl ? `<button type="button" class="btn quiet sm" id="photo-remove">${icon('x', { size: 15 })}Take it off</button>` : ''}
        </div>
        <label class="field" style="margin-top:10px"><span>Where it came from</span>
          <input name="photoNote" value="${escapeHtml(stay?.photoNote || '')}" placeholder="Our own photo, March 2026 · the resort's media kit, with their OK">
          <span class="hint">Only a photograph the Circle may use: one you took, or one from the resort's media kit with their permission. Not a picture copied off their website — those are the hotel's copyright, and the Circle does not take what it has not been given. Members see this line under the picture.</span></label>
      </div>
      <label class="row" style="gap:10px;margin-bottom:12px"><input type="checkbox" name="active" ${stay?.active !== false ? 'checked' : ''} style="width:20px;height:20px"><span class="small">Live for members</span></label>
      ${isTrip ? '' : `<label class="row" style="gap:10px;margin-bottom:12px"><input type="checkbox" name="house" ${stay?.house ? 'checked' : ''} style="width:20px;height:20px"><span class="small">One of the places we actually use — shows first, with a badge</span></label>`}
      <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>Save</button></div>`;
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
      const data = { id: stay?.id, kind: stay?.kind || 'aruba', name: v('name'), area: v('area'), vibe: v('vibe'), dealNote: v('dealNote'),
        active: body.querySelector('[name=active]').checked, country: stay?.country || 'Aruba', features: stay?.features || [] };
      if (isTrip) Object.assign(data, { pointsPerSeat: Math.round(usd('seat') * s.pointsPerDollar), guestCashUsd: Number(v('guestCashUsd')) || 0,
        dates: stay.dates, nights: stay.nights, seats: stay.seats, holdDeadline: stay.holdDeadline });
      else Object.assign(data, { site: v('site') || null,
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
  } });
  if (out) {
    try {
      await store.upsertStay(out, store.me.id);
      toast(out.photoFile ? 'Saved. The photograph is on the stay now.' : out.photoRemove ? 'Saved. The photograph is off.' : 'Saved. Members see the new points immediately.', { kind: 'good' });
    } catch (err) { toast(err.message, { kind: 'bad', timeout: 8000 }); }
  }
}

// ---------------------------------------------------------------- the Pool
export function pool({ store }) {
  const s = store.settings;
  const t = store.treasury();
  const series = store.monthlySeries(9);
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">${icon('shield')}Proof of reserves</p>
      <h1>The Pool</h1>
      <p class="lede" style="margin-top:12px">Every point the Circle owes has a dollar sitting behind it in the Reserve. This page is the arithmetic, open to every Insider.</p>
      <div id="gauge" style="margin-top:20px"></div>
      <div class="grid g4" style="margin-top:20px">
        <div class="stat"><span class="k">Reserve, by the ledger</span><b class="num">${escapeHtml(fmtUsd2(t.reserveUsd))}</b><span class="sub">every dollar in, minus what has been paid out</span></div>
        <div class="stat"><span class="k">Owed in points</span><b class="num">${escapeHtml(fmtPoints(t.outstandingPoints))}</b><span class="sub">${escapeHtml(fmtUsd2(t.liabilityUsd))} of hotel</span></div>
        <div class="stat"><span class="k">Coverage</span><b class="num">${escapeHtml(fmtPct(t.coverage))}</b><span class="sub">Reserve ÷ what is owed</span></div>
        <div class="stat"><span class="k">Operating</span><b class="num">${escapeHtml(fmtUsd2(t.operatingUsd))}</b><span class="sub">15% earned on bookings, less the bonuses fronted — negative until the first one</span></div>
      </div>

      <div class="notice ${t.verified && Math.abs(t.verifiedVarianceUsd || 0) < 0.005 ? 'good' : t.verified ? 'warn' : ''}" style="margin-top:18px">
        <b>${t.verified ? `Checked against the bank on ${escapeHtml(fmtDay(t.verified.at))}` : 'Not yet checked against the bank'}</b>
        <p class="small">${t.verified
          ? `${escapeHtml(store.member(t.verified.byId)?.name || 'The Banker')} entered ${escapeHtml(fmtUsd2(t.verified.balanceUsd))} from the statement. The ledger said ${escapeHtml(fmtUsd2(t.reserveExpectedUsd))} at the time${Math.abs(t.verifiedVarianceUsd || 0) < 0.005 ? ' — matched to the cent' : ` — a difference of ${escapeHtml(fmtUsd2(Math.abs(t.verifiedVarianceUsd)))}`}. Money confirmed since then has not been checked yet; that happens at the next month close.`
          : 'Coverage is arithmetic until the Banker enters the bank balance at a month close. Until then, treat it as what the ledger says rather than what the bank holds.'}</p></div>

      <div class="side" style="margin-top:24px">
        <div class="panel">
          <h2 style="font-size:1.1rem">Where the money has gone</h2>
          <ul class="ledger" style="margin-top:12px">
            <li><span class="what"><b>Collected from Insiders</b><span class="meta">every confirmed contribution</span></span><span class="delta"><b>${escapeHtml(fmtUsd2(t.collected))}</b></span></li>
            <li><span class="what"><b>${escapeHtml(VOCAB.share)}</b><span class="meta">15%, earned when points are spent on a room</span></span><span class="delta"><b>+${escapeHtml(fmtUsd2(t.serviceEarnedUsd))}</b></span></li>
            <li><span class="what"><b>Into the Reserve</b><span class="meta">all of it — nothing is taken when points are bought</span></span><span class="delta"><b>${escapeHtml(fmtUsd2(t.backing))}</b></span></li>
            <li><span class="what"><b>Bonuses funded by the Circle</b><span class="meta">tier, streak and founding — fronted against the 15% still to be earned on bookings</span></span><span class="delta"><b>+${escapeHtml(fmtUsd2(t.promoUsd))}</b></span></li>
            ${t.topUpsUsd ? `<li><span class="what"><b>Cash top-ups received</b><span class="meta">paid straight on to the hotel; no 15% is taken</span></span><span class="delta"><b>+${escapeHtml(fmtUsd2(t.topUpsUsd))}</b></span></li>` : ''}
            <li><span class="what"><b>Paid to hotels</b><span class="meta">confirmed bookings, at the invoiced amount</span></span><span class="delta"><b>−${escapeHtml(fmtUsd2(t.paidOutUsd))}</b></span></li>
            <li><span class="what"><b>Reserve today</b></span><span class="delta"><b>${escapeHtml(fmtUsd2(t.reserveExpectedUsd))}</b></span></li>
          </ul>
        </div>
        <div class="panel flat">
          <h2 style="font-size:1.1rem">The two accounts</h2>
          <p class="small muted" style="margin-top:8px">${escapeHtml(s.reserveAccount.holder || 'Not registered yet')}<br><span class="num">${escapeHtml(s.reserveAccount.number || '—')}</span></p>
          <p class="small muted" style="margin-top:10px">${escapeHtml(s.operatingAccount.holder || 'Not registered yet')}<br><span class="num">${escapeHtml(s.operatingAccount.number || '—')}</span></p>
          ${t.lastClose ? `<p class="small muted" style="margin-top:14px">Last sealed: ${escapeHtml(fmtMonth(t.lastClose.month))}, closed by ${escapeHtml(store.member(t.lastClose.closedBy)?.name.split(' ')[0] || '')} and co-signed by ${escapeHtml(store.member(t.lastClose.cosignedBy)?.name.split(' ')[0] || '')}.</p>` : ''}
          <p class="small muted" style="margin-top:14px">${escapeHtml(VOCAB.legal)}</p>
        </div>
      </div>

      <div class="panel" style="margin-top:20px">
        <div class="row-between"><h2 style="font-size:1.1rem">Confirmed each month</h2><button class="btn quiet sm" id="toggle-table">Show the numbers</button></div>
        <div id="chart" style="margin-top:14px"></div>
        <div id="table" hidden style="margin-top:14px"></div>
      </div>
    </div></section></div>`);
  wrap.querySelector('#gauge').appendChild(poolGauge({ coverage: t.coverage, reserveUsd: t.reserveUsd, outstandingPoints: t.outstandingPoints, verifiedAt: t.verified?.at, verifiedVarianceUsd: t.verifiedVarianceUsd, configured: t.accountsConfigured, size: 'full' }));
  const data = series.map(m => ({ label: fmtMonth(m.month).slice(0, 3), values: [m.backing, m.share] }));
  wrap.querySelector('#chart').appendChild(columns(data, { series: ['Into the Reserve', 'The Circle’s share'], height: 200, unit: '', ariaLabel: 'Money confirmed each month, split between the Reserve and the Circle’s share' }));
  const table = tableFor(series, [
    { label: 'Month', value: (r) => fmtMonth(r.month) }, { label: 'Confirmed', value: 'count', num: true },
    { label: 'Collected', value: (r) => fmtUsd2(r.collected), num: true },
    { label: 'To the Reserve', value: (r) => fmtUsd2(r.backing), num: true },
    { label: 'The Circle’s share', value: (r) => fmtUsd2(r.share), num: true },
  ]);
  wrap.querySelector('#table').appendChild(table);
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
      <div class="row no-print" style="margin-top:16px" role="tablist" id="tabs">
        <button class="btn sm" data-tab="people" aria-pressed="true">Insiders</button>
        <button class="btn quiet sm" data-tab="chipin" aria-pressed="false">Chip in${store.openToChipIn().length ? ` · ${store.openToChipIn().length}` : ''}</button>
        <button class="btn quiet sm" data-tab="notes" aria-pressed="false">Notes from Ian</button>
        <button class="btn quiet sm" data-tab="milestones" aria-pressed="false">Milestones</button>
      </div>
      <div id="panel" style="margin-top:18px"></div>
    </div></section></div>`);
  const panel = wrap.querySelector('#panel');
  let tab = 'people';
  const draw = () => {
    if (tab === 'people') {
      const paintCrests = (root) => root.querySelectorAll('[data-crest]').forEach((slot) => {
        // Standing beside the name, at the size it is actually read: a mark, not a picture.
        slot.replaceChildren(rankCrest(store.standingOf(slot.dataset.crest), { size: 30, withName: false }));
      });
      panel.replaceChildren(el(`<div class="grid g3">${roster.map(m => {
        const named = m.showOnRollcall || m.id === me.id || m.roles.some(r => r !== 'member');
        const streak = store.streak(m.id);
        return `<div class="panel"><div class="row" style="gap:12px">
            ${avatar(m, 40)}
            <div style="min-width:0"><b>${escapeHtml(named ? m.name : initials(m.name))}</b>
              <br><span class="small muted">${escapeHtml(m.title || `${tierName(m.monthlyUsd)} · since ${fmtDay(m.joinedAt)}`)}</span></div>
            <span style="margin-left:auto;flex:none" data-crest="${m.id}"></span>
          </div>
          <div class="row" style="margin-top:12px;gap:8px">
            ${treeSvg(VOCAB.tierLean[m.monthlyUsd], { size: 18 })}
            ${m.founding ? '<span class="tag">Founding</span>' : ''}
            ${m.standingOrder ? '<span class="tag">Autopilot</span>' : ''}
            ${m.status === 'paused' ? '<span class="tag">Paused</span>' : ''}
            ${streak >= 6 ? `<span class="tag">${streak} in a row</span>` : ''}
          </div></div>`;
      }).join('')}</div>`));
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
          <div class="row-between"><h2 style="font-size:1.1rem">${escapeHtml(n.title)}</h2>${n.pinned ? '<span class="tag">Pinned</span>' : ''}</div>
          <p class="small muted" style="margin-top:6px">${escapeHtml(store.member(n.authorId)?.name || '')} · ${escapeHtml(fmtDay(n.at))}</p>
          <p style="margin-top:12px;max-width:70ch">${escapeHtml(n.body)}</p>
          <div class="row" style="margin-top:12px"><button class="btn quiet sm" data-copy="${escapeHtml(n.body)}">Copy for WhatsApp</button></div>
        </div>`).join('')}</div>`));
      panel.addEventListener('click', async (e) => {
        const c = e.target.closest('[data-copy]'); if (!c) return;
        const ok = await copyText(c.dataset.copy); toast(ok ? 'Copied — paste it into the group.' : 'Select the text and copy it by hand.');
      });
    } else {
      const ladder = Object.entries(s.streakBonuses).map(([n, pts]) => ({ n: Number(n), pts }));
      const mine = store.streak(me.id);
      panel.replaceChildren(el(`<div class="panel">
        <h2 style="font-size:1.1rem">Streak bonuses</h2>
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
    wrap.querySelectorAll('[data-tab]').forEach(x => { const on = x.dataset.tab === tab; x.setAttribute('aria-pressed', String(on)); x.className = `btn ${on ? '' : 'quiet'} sm`; });
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
        <p class="eyebrow">Username</p><p class="mono" style="font-size:1.2rem">${escapeHtml(username)}</p>
        <p class="eyebrow" style="margin-top:14px">Password</p><p class="mono" style="font-size:1.2rem;word-break:break-all">${escapeHtml(password)}</p>
      </div>
      <p class="small muted" style="margin-top:12px">This is the only time it is shown. The app makes them
        choose their own the first time they sign in, so it stops mattering straight away.</p>
      <div class="sheet-actions"><button class="btn" data-close>Done</button></div>`;
    body.querySelector('[data-close]').addEventListener('click', () => close());
  } });
}

export function settings({ store, go }) {
  const me = store.me, s = store.settings;
  const isAdmin = store.hasRole('admin');
  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:900px">
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
        <h2 style="font-size:1.1rem">The two accounts</h2>
        <p class="small muted" style="margin-top:6px">Coverage can only be verified when the Reserve and Operating are two different accounts. Be honest about who holds them.</p>
        <div class="grid g2" style="margin-top:12px">
          <div><p class="eyebrow">${icon('vault')}Reserve · backs the points</p>
            <label class="field"><span>Bank</span><input name="rBank" value="${escapeHtml(s.reserveAccount.bank || '')}"></label>
            <label class="field"><span>Held by</span><input name="rHolder" value="${escapeHtml(s.reserveAccount.holder || '')}" placeholder="Held by Vishnu on behalf of the Circle"></label>
            <label class="field"><span>Account number</span><input name="rNumber" class="mono" value="${escapeHtml(s.reserveAccount.number || '')}"></label></div>
          <div><p class="eyebrow">${icon('scale')}Operating · the 15%</p>
            <label class="field"><span>Bank</span><input name="oBank" value="${escapeHtml(s.operatingAccount.bank || '')}"></label>
            <label class="field"><span>Held by</span><input name="oHolder" value="${escapeHtml(s.operatingAccount.holder || '')}"></label>
            <label class="field"><span>Account number</span><input name="oNumber" class="mono" value="${escapeHtml(s.operatingAccount.number || '')}"></label></div>
        </div>
        <button class="btn" type="submit">Save the accounts</button>
      </form>

      <form class="panel" id="wallet-form" style="margin-top:16px">
        <h2 style="font-size:1.1rem">Apple Wallet passes</h2>
        <p class="small muted" style="margin-top:6px">A Wallet pass has to be signed with a certificate Apple issues to the club, so a browser cannot make one. Deploy the <code>issue-pass</code> function (it is in <code>supabase/functions/</code>, and the README walks through the certificate), then paste its URL here. Until then, members can still save the card as an image and add the app to their home screen.</p>
        <label class="field" style="margin-top:12px"><span>Pass service URL</span>
          <input name="walletUrl" value="${escapeHtml(s.wallet?.url || '')}" placeholder="https://xxxx.supabase.co/functions/v1/issue-pass" class="mono"></label>
        <button class="btn" type="submit">Save</button>
        <p class="small muted" style="margin-top:10px">${s.wallet?.url ? 'Members see “Add to Apple Wallet” on their card screen.' : 'Members are told plainly that this is not set up yet.'}</p>
      </form>
      </div>

      <div data-pane="money" hidden>
      <div class="panel" style="margin-top:20px">
        <h2 style="font-size:1.1rem">Dollars and points</h2>
        <p class="small muted" style="margin-top:6px">${s.pointsPerDollar} points = $1.00. Type either side to check a price before you put it in the catalog.</p>
        <div class="grid g2" style="margin-top:14px">
          <label class="field" style="margin:0"><span>Dollars</span>
            <input id="conv-usd" type="number" step="1" min="0" value="450" inputmode="decimal" class="mono"></label>
          <label class="field" style="margin:0"><span>Points</span>
            <input id="conv-pts" type="number" step="100" min="0" value="${450 * s.pointsPerDollar}" inputmode="numeric" class="mono"></label>
        </div>
        <p class="small muted" style="margin-top:10px" id="conv-note"></p>
      </div>

      ${isAdmin ? `<form class="panel" id="rules-form" style="margin-top:16px">
        <h2 style="font-size:1.1rem">The rules of the club</h2>
        <p class="small muted" style="margin-top:6px">Changing the share or the value of a point affects everyone. Tell the Circle before you do, and never after someone has booked against it.</p>
        <div class="grid g3" style="margin-top:12px">
          <label class="field"><span>The Circle’s share</span><input name="serviceRate" type="number" step="0.01" min="0" max="0.5" value="${s.serviceRate}" inputmode="decimal"><span class="hint">0.15 is 15%</span></label>
          <label class="field"><span>Points per dollar</span><input name="pointsPerDollar" type="number" value="${s.pointsPerDollar}" inputmode="numeric"><span class="hint">100 = a point is a cent</span></label>
          <label class="field"><span>Seats in the Circle</span><input name="memberCap" type="number" value="${s.memberCap}" inputmode="numeric"></label>
          <label class="field"><span>Quote locked for (hours)</span><input name="quoteHours" type="number" value="${s.quoteHours}" inputmode="numeric"></label>
          <label class="field"><span>Banker answers within (hours)</span><input name="bankerSlaHours" type="number" value="${s.bankerSlaHours}" inputmode="numeric"></label>
          <label class="field"><span>Leaving fee US$</span><input name="exitFeeUsd" type="number" value="${s.exitFeeUsd}" inputmode="decimal"></label>
        </div>
        <button class="btn" type="submit">Save the rules</button>
      </form>` : ''}
      </div>

      <!-- "Pictures from your trips" used to sit here: a switch, over copy promising "it is built
           and ready… nothing has to be rebuilt". There is no /moments route, no view file, and
           nothing anywhere in the app reads or writes either table — so turning it on changed
           nothing a member could see. A control that claims a feature the app does not have is
           the purest form of what Victor is calling slop, and the honest fix is to take the
           switch away rather than to keep offering it. The two tables and their policies stay in
           the database, harmless and ready, for whoever builds the screen. -->

      ${isAdmin ? `<div data-pane="people">
      <div class="panel" style="margin-top:20px">
        <div class="row-between"><h2 style="font-size:1.1rem">Insiders · ${store.members.length}</h2>
          <div class="row">${isAdmin ? `<button class="btn sm" id="add-member">${icon('plus', { size: 16 })}Add an Insider</button>` : ''}
            </div></div>
        <p class="small muted" style="margin-top:6px">Adding someone puts them on the list. Then <b>Give a login</b> makes them a username
          and a password, shown once, which you pass on however you like — a message, a phone call, in person. Nothing is emailed
          to anybody, and the first thing the app makes them do is choose their own.</p>
        <div class="tablewrap" style="margin-top:14px;border:0"><table class="people-table">
          <thead><tr><th>Who</th><th>State</th><th class="num">Points</th><th></th></tr></thead>
          <tbody>${store.members.map(m => `<tr>
            <td><b>${escapeHtml(m.name)}</b>${m.bot ? ' <span class="chip chip-muted">robot</span>' : ''}<br><span class="small ${m.username ? 'muted mono' : ''}" ${m.username ? '' : 'style="color:var(--flag)"'}>${escapeHtml(m.username ? `@${m.username}${m.mustChangePassword ? ' · has not changed their password yet' : ''}` : 'no login yet — they cannot sign in')}</span><br><span class="small muted">${m.bot ? 'no seat, pays nothing' : escapeHtml([tierName(m.monthlyUsd), m.roles.join(', ')].filter(Boolean).join(' · '))}</span></td>
            <td data-k="State">${chip(m.status === 'active' ? 'active' : m.status)}</td>
            <td class="num" data-k="Points">${escapeHtml(fmtPoints(store.availablePoints(m.id)))}</td>
            <td><div class="row nowrap" style="gap:6px;justify-content:flex-end;flex-wrap:nowrap">
              ${isAdmin ? `<button class="btn ghost sm" data-login="${m.id}">${icon('key', { size: 15 })}${m.username ? 'New password' : 'Give a login'}</button>` : ''}
              ${isAdmin ? `<button class="btn ghost sm" data-edit="${m.id}">${icon('edit', { size: 15 })}Edit</button>` : ''}
              ${isAdmin ? `<button class="btn ghost sm" data-adjust="${m.id}">Adjust</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>
      </div>
      </div>

      <div data-pane="record" hidden>
      <div class="panel" style="margin-top:20px">
        <h2 style="font-size:1.1rem">The record</h2>
        <p class="small muted" style="margin-top:6px">Everything anyone did, oldest at the bottom. The ledger itself can never be edited — corrections are new lines with a reason.</p>
        <div class="row" style="margin-top:12px">
          <button class="btn ghost sm" id="backup">${icon('download', { size: 15 })}Back up everything</button>
          ${store.mode === 'supabase' ? '' : `<button class="btn ghost sm" id="restore">Restore from a backup</button>
          <button class="btn quiet sm" id="reset">Reset the preview</button>`}
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
        return `${tierName(t.monthlyUsd)} ${(dollars * s.pointsPerDollar / perMonth).toFixed(1)}`;
      }).join(' · ');
      note.textContent = `${fmtAfl2(dollars, s.awgPerUsd)} at the peg. Months of contributions to earn it: ${months}.`;
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
    const patch = Object.fromEntries([...f.entries()].map(([k, v]) => [k, Number(v)]));
    const yes = await confirmDialog({ title: 'Change the rules?', confirmText: 'Change them',
      message: 'The share and the value of a point are promises to every Insider. Tell the Circle first, and never change them after someone has booked against them.' });
    if (yes) { await store.updateSettings(patch, me.id); toast('Saved. Tell the Circle what changed.', { kind: 'good' }); }
  });
  // Adding an Insider, roles and all. This is the path that means nobody ever has to open
  // the table editor: name, email, level, what they do — and a message to send them.
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
        <div class="grid g2">
          <label class="field"><span>Their name</span><input name="name" required autofocus placeholder="Ian Hekman"></label>
          <label class="field"><span>Username</span>
            <input name="username" required autocapitalize="none" spellcheck="false" placeholder="ian"
                   pattern="[a-z0-9][a-z0-9._\-]{1,28}[a-z0-9]"></label>
        </div>
        <label class="field"><span>First password</span>
          <span class="row" style="gap:8px;flex-wrap:nowrap">
            <input name="password" class="mono grow" required value="${escapeHtml(generatePassword())}">
            <button class="btn ghost sm" type="button" data-again style="flex:none">${icon('refresh', { size: 15 })}</button></span></label>
        <div class="grid g2">
          <label class="field"><span>Level</span><select name="monthlyUsd">${s.tiers.map(t => `<option value="${t.monthlyUsd}"${t.monthlyUsd === 150 ? ' selected' : ''}>${escapeHtml(fmtUsd2(t.monthlyUsd))} · ${escapeHtml(tierName(t.monthlyUsd))}</option>`).join('')}</select></label>
          <label class="field"><span>What they are called</span><input name="title" placeholder="Voice of the Circle"></label>
        </div>
        <p class="eyebrow" style="margin-top:6px">What they can do</p>
        <div class="stack" style="gap:8px;margin-top:8px">
          ${ROLES.map(r => `<label class="row" style="gap:10px;align-items:flex-start">
            <input type="checkbox" name="role" value="${r.id}"${r.id === 'member' ? ' checked' : ''} style="width:19px;height:19px;margin-top:2px">
            <span><b class="small">${escapeHtml(r.label)}</b><br><span class="small muted">${escapeHtml(r.note)}</span></span></label>`).join('')}
        </div>
        <label class="row" style="gap:10px;align-items:flex-start;margin-top:14px">
          <input type="checkbox" name="bot" style="width:19px;height:19px;margin-top:2px">
          <span><b class="small">This is a robot, not a person</b><br><span class="small muted">For the watcher on the VPS.
            It takes no seat, owes nothing, is never counted or chased, and may post what it finds to the board.
            Leave every box above unticked — it needs nothing else.</span></span></label>
        <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button>
          <button class="btn" data-ok>${icon('plus', { size: 16 })}Add them</button></div>`;
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
          <input name="username" value="${escapeHtml(suggested)}" autocapitalize="none" spellcheck="false"
                 pattern="[a-z0-9][a-z0-9._\-]{1,28}[a-z0-9]" required${m.username ? ' readonly' : ''}>
          <span class="hint">${m.username ? 'Their username stays the same.' : 'Lower case. Letters, numbers, and . _ - in the middle.'}</span></label>
        <label class="field"><span>Password</span>
          <input name="password" class="mono" value="${escapeHtml(generatePassword())}" required></label>
        <div class="row"><button class="btn ghost sm" type="button" data-again>${icon('refresh', { size: 15 })}Another one</button></div>
        <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button>
          <button class="btn" data-ok>${icon('key', { size: 16 })}Set it</button></div>`;
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
        <div class="grid g2">
          <label class="field"><span>Name</span><input name="name" value="${escapeHtml(m.name)}" required></label>
          <label class="field"><span>Username</span><input class="mono" value="${escapeHtml(m.username || 'no login yet')}" readonly>
            <span class="hint">${m.username ? 'Set with "New password".' : 'Give them a login to set one.'}</span></label>
        </div>
        <div class="grid g2">
          <label class="field"><span>Level</span><select name="monthlyUsd">${s.tiers.map(t => `<option value="${t.monthlyUsd}"${t.monthlyUsd === m.monthlyUsd ? ' selected' : ''}>${escapeHtml(fmtUsd2(t.monthlyUsd))} · ${escapeHtml(tierName(t.monthlyUsd))}</option>`).join('')}</select></label>
          <label class="field"><span>What they are called</span><input name="title" value="${escapeHtml(m.title || '')}"></label>
        </div>
        <p class="eyebrow" style="margin-top:6px">What they can do</p>
        <div class="row" style="flex-wrap:wrap;gap:12px;margin-top:8px">
          ${ROLES.map(r => `<label class="row" style="gap:7px"><input type="checkbox" name="role" value="${r.id}"${(m.roles || []).includes(r.id) ? ' checked' : ''} style="width:18px;height:18px"><span class="small">${escapeHtml(r.label)}</span></label>`).join('')}
        </div>
        <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button>
          <button class="btn" data-ok>${icon('check', { size: 16 })}Save</button></div>`;
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
          <label class="field"><span>Points (negative to take away)</span><input name="pts" type="number" inputmode="numeric" required></label>
          <label class="field"><span>Reason</span><input name="note" required placeholder="Hotel refunded a night after the storm"></label>
          <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>Write the line</button></div>`;
        body.querySelector('[data-ok]').addEventListener('click', () => close({ pts: Number(body.querySelector('[name=pts]').value), note: body.querySelector('[name=note]').value }));
      } });
      if (out?.note) { try { await store.adjustPoints(m.id, out.pts, out.note, me.id); toast('Written to the ledger.'); } catch (err) { toast(err.message, { kind: 'bad' }); } }
    }
    if (e.target.id === 'backup') downloadText(`${VOCAB.clubName.toLowerCase()}-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportJson(), 'application/json');
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
