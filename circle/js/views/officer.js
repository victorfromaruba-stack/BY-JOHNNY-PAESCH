// The officers' screens — the Banker's inbox and month close, the Desk, settings —
// plus the two everyone can see: the Circle and the Pool.
import { escapeHtml, fmtUsd2, fmtAfl2, fmtPoints, pointsUsd, fmtDay, fmtDayTime, fmtMonth, fmtPct, monthKey, countdownTo, initials, toCsv, downloadText, sum } from '../core/util.js';
import { VOCAB, tierName } from '../core/vocab.js';
import { splitContribution, tierFor, seasonPoints, SEASONS } from '../core/money.js';
import { splitBar, poolGauge, ring } from '../ui/pieces.js';
import { treeSvg } from '../ui/art.js';
import { toast, sheet, confirmDialog, setBusy, chip, statusLabel, avatar } from '../ui/components.js';
import { columns, tableFor, sparkline } from '../ui/charts.js';
import { waLink, TEMPLATES, copyText, shareText } from '../core/share.js';
import { quoteSheet } from './catalog.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };

// ---------------------------------------------------------------- the Banker
export function bank({ store, go }) {
  const me = store.me, s = store.settings;
  const t = store.treasury();
  const pending = store.pendingContributions();
  const month = monthKey();
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <div class="row-between">
        <div><p class="eyebrow">${escapeHtml(VOCAB.treasurerTitle)}</p><h1>The inbox</h1></div>
        <div class="row no-print"><a class="btn ghost sm" href="#/bank/close/${month}">Close ${escapeHtml(fmtMonth(month))}</a></div>
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
  if (!pending.length) queue.appendChild(el(`<div class="empty"><b>Nothing waiting</b><p class="small muted">Every transfer marked as sent has been confirmed or returned. ${escapeHtml(VOCAB.pap.thanks[0])}.</p></div>`));
  for (const c of pending) {
    const m = store.member(c.memberId);
    const row = el(`<div class="panel" data-id="${c.id}">
        <div class="row-between">
          <div class="row" style="gap:12px">
            ${avatar(m, 40)}
            <div><b>${escapeHtml(m.name)}</b> · ${escapeHtml(tierName(m.monthlyUsd))}
              <br><span class="small muted">${escapeHtml(fmtMonth(c.forMonth))} · sent ${escapeHtml(fmtDay(c.submittedAt))} · ${escapeHtml(c.bank || 'bank transfer')}${c.proofName ? ' · screenshot attached' : ''}</span></div>
          </div>
          <div style="text-align:right"><b class="num" style="font-size:1.2rem">${escapeHtml(fmtUsd2(c.expectedUsd))}</b>
            <br><span class="small muted num">${escapeHtml(fmtAfl2(c.expectedUsd, s.awgPerUsd))}</span></div>
        </div>
        <div class="copyline" style="margin-top:12px"><code class="num">${escapeHtml(c.reference || 'no reference given')}</code>
          <button class="btn quiet sm" data-copy="${escapeHtml(c.reference || '')}">Copy</button></div>
        ${c.note ? `<p class="small muted" style="margin-top:10px">“${escapeHtml(c.note)}”</p>` : ''}
        <div class="row" style="margin-top:14px">
          <button class="btn good" data-act="confirm">Confirm ${escapeHtml(fmtUsd2(c.expectedUsd))}</button>
          <button class="btn ghost" data-act="partial">A different amount arrived</button>
          <button class="btn danger" data-act="return">Return it</button>
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
                <p class="small">${escapeHtml(fmtUsd2(usd))} received · ${escapeHtml(fmtUsd2(sp.shareUsd))} to the Circle · ${escapeHtml(fmtUsd2(sp.backingUsd))} to the Reserve${sp.full ? '' : ' · short of the tier, so no bonus this month'}</p>`;
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
  wrap.querySelector('#confirm-all')?.addEventListener('click', async () => {
    const yes = await confirmDialog({ title: `Confirm all ${pending.length}?`, confirmText: 'Confirm them', message: 'Only do this once you have matched every reference on the bank statement. Each one can still be undone for a minute afterwards.' });
    if (!yes) return;
    for (const c of pending) { try { await store.confirmContribution(c.id, me.id, {}); } catch (err) { toast(err.message, { kind: 'bad' }); } }
    toast(`${pending.length} confirmed. Points are minted and dated.`, { kind: 'good' });
  });
  const missing = store.expectedMembers(month).filter(m2 => store.monthStatus(m2.id, month) === 'due');
  wrap.querySelector('#missing').innerHTML = missing.length
    ? missing.map(m2 => `<a class="btn ghost sm" target="_blank" rel="noopener"
        href="${escapeHtml(waLink(m2.phone, TEMPLATES.reminder({ member: m2, amountUsd: m2.monthlyUsd, month, reference: `${VOCAB.refPrefix}-${initials(m2.name)}-${month}`, v: VOCAB })))}">
        ${escapeHtml(m2.name)} · ${escapeHtml(fmtUsd2(m2.monthlyUsd))}</a>`).join('')
    : '<span class="small muted">Everyone has sent this month.</span>';
  return wrap;
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
  const others = store.members.filter(m => m.id !== me.id && m.roles.some(r => ['planner', 'comms', 'admin', 'treasurer', 'deputy'].includes(r)));
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">Month close</p>
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
            <p class="eyebrow">The month</p>
            <ul class="ledger" style="margin-top:10px">
              <li><span class="what"><b>Collected</b></span><span class="delta"><b>${escapeHtml(fmtUsd2(p.grossUsd))}</b></span></li>
              <li><span class="what"><b>${escapeHtml(VOCAB.share)}</b><span class="meta">to Operating</span></span><span class="delta"><b>${escapeHtml(fmtUsd2(p.shareUsd))}</b></span></li>
              <li><span class="what"><b>To the Reserve</b><span class="meta">backs points</span></span><span class="delta"><b>${escapeHtml(fmtUsd2(p.grossUsd - p.shareUsd))}</b></span></li>
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
      <p class="eyebrow">Victor and Ian</p>
      <h1>The Desk</h1>
      <div class="row no-print" style="margin-top:16px" role="tablist" id="tabs">
        <button class="btn sm" data-tab="requests" aria-pressed="true">Requests${open.length ? ` · ${open.length}` : ''}</button>
        <button class="btn quiet sm" data-tab="catalog" aria-pressed="false">Stays &amp; trips</button>
        <button class="btn quiet sm" data-tab="notes" aria-pressed="false">Notes</button>
      </div>
      <div id="panel" style="margin-top:18px"></div>
    </div></section></div>`);
  const panel = wrap.querySelector('#panel');
  let tab = 'requests';

  const drawRequests = () => {
    const rows = open;
    panel.replaceChildren(el(`<div class="stack">
      ${rows.length ? rows.map(r => {
        const m = store.member(r.memberId); const st = store.stay(r.stayId);
        const age = Math.round((Date.now() - new Date(r.requestedAt)) / 36e5);
        const sla = s.slaHours - age;
        return `<div class="panel">
          <div class="row-between">
            <div class="row" style="gap:12px">${avatar(m, 38)}
              <div><b>${escapeHtml(m.name)}</b> → ${escapeHtml(st?.name || '')}
                <br><span class="small muted">${escapeHtml(fmtDay(r.checkIn))} – ${escapeHtml(fmtDay(r.checkOut))} · ${r.nights} night${r.nights > 1 ? 's' : ''} · ${r.guests} guest${r.guests > 1 ? 's' : ''}${r.flexDays ? ` · flexible ±${r.flexDays}d` : ''}</span></div>
            </div>
            <div style="text-align:right">${chip(r.status)}<br><span class="small muted num">${escapeHtml(fmtPoints(r.quotedPoints || r.indicativePoints))}</span></div>
          </div>
          ${r.note ? `<p class="small muted" style="margin-top:10px">“${escapeHtml(r.note)}”</p>` : ''}
          <div class="row" style="margin-top:12px">
            ${r.status === 'requested' ? `<button class="btn sm" data-quote="${r.id}">Quote it</button>
              <span class="small ${sla < 12 ? '' : 'muted'}" ${sla < 12 ? 'style="color:var(--flag)"' : ''}>${sla > 0 ? `${sla}h left of the 72-hour promise` : 'past the 72-hour promise'}</span>` : ''}
            <a class="btn ghost sm" href="#/requests/${r.id}">Open</a>
          </div></div>`;
      }).join('') : `<div class="empty"><b>No open requests</b><p class="small muted">Everything has been quoted, booked or answered.</p></div>`}
    </div>`));
    panel.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-quote]'); if (!b) return;
      const r = store.redemption(b.dataset.quote);
      await quoteSheet(store, r, store.stay(r.stayId));
    });
  };

  const drawCatalog = () => {
    const list = store.stays;
    panel.replaceChildren(el(`<div class="panel">
      <div class="row-between"><h2 style="font-size:1.1rem">What the Circle offers</h2>
        <button class="btn ghost sm" id="add">Add a stay</button></div>
      <div class="tablewrap" style="margin-top:14px;border:0"><table>
        <thead><tr><th>Name</th><th>Area</th><th class="num">Summer</th><th class="num">Winter</th><th class="num">Peak</th><th>State</th><th></th></tr></thead>
        <tbody>${list.map(st => `<tr>
          <td><b>${escapeHtml(st.name)}</b><br><span class="small muted">${st.kind === 'trip' ? `${escapeHtml(fmtDay(st.dates.from))} · ${st.nights} nights` : `min ${st.minNights} nights`}</span></td>
          <td class="small">${escapeHtml(st.area)}</td>
          ${st.kind === 'trip'
            ? `<td class="num" colspan="3">${escapeHtml(fmtPoints(st.pointsPerSeat))} a seat</td>`
            : `<td class="num">${escapeHtml(fmtPoints(seasonPoints(st, 'low', s)))}</td>
               <td class="num">${escapeHtml(fmtPoints(seasonPoints(st, 'high', s)))}</td>
               <td class="num">${escapeHtml(fmtPoints(seasonPoints(st, 'peak', s)))}</td>`}
          <td>${st.active ? chip('confirmed', 'Live') : chip('cancelled', 'Draft')}</td>
          <td><button class="btn quiet sm" data-edit="${st.id}">Edit</button></td></tr>`).join('')}</tbody>
      </table></div>
      <p class="small muted" style="margin-top:12px">Rates are the Circle’s all-in cost per night. Members see the points; you edit the dollars.</p>
    </div>`));
    panel.addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-edit]');
      if (ed) return editStay(store, store.stay(ed.dataset.edit));
      if (e.target.id === 'add') return editStay(store, null);
    });
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
      e.preventDefault(); const f = new FormData(e.target);
      await store.postAnnouncement({ authorId: me.id, title: f.get('title'), body: f.get('body'), pinned: !!f.get('pinned') });
      toast('Published to the Circle.', { kind: 'good' });
    });
    panel.addEventListener('click', async (e) => {
      const d = e.target.closest('[data-del]'); if (!d) return;
      const yes = await confirmDialog({ title: 'Delete this note?', message: 'It disappears from everyone’s Circle page.', confirmText: 'Delete', danger: true });
      if (yes) { await store.deleteAnnouncement(d.dataset.del, me.id); toast('Deleted.'); }
    });
  };

  const draw = () => { ({ requests: drawRequests, catalog: drawCatalog, notes: drawNotes })[tab](); };
  draw();
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
      <p class="eyebrow" style="margin-bottom:8px">${isTrip ? 'What a seat costs' : 'What a night costs, all in'}</p>
      <p class="small muted" style="margin-bottom:12px">Type dollars or points — whichever you have in your head. The other follows, at ${s.pointsPerDollar} points to the dollar.</p>
      ${isTrip ? `<div class="grid g2">${moneyPair('seat', 'A seat, all in', stay.pointsPerSeat / s.pointsPerDollar, s)}
          <label class="field"><span>Guest price in cash US$</span><input name="guestCashUsd" type="number" step="1" value="${stay.guestCashUsd || 0}" inputmode="decimal">
            <span class="hint">What a non-member pays the Banker. No 15% is taken on it.</span></label></div>`
        : `<div class="grid g3">
        ${moneyPair('low', 'Summer · Apr 6 – Dec 19', stay?.rates?.low ?? 250, s)}
        ${moneyPair('high', 'Winter · Jan 4 – Apr 5', stay?.rates?.high ?? 380, s)}
        ${moneyPair('peak', 'Peak · Dec 20 – Jan 3', stay?.rates?.peak ?? 460, s)}
      </div>
      <div class="grid g3">
        <label class="field"><span>Minimum nights</span><input name="minNights" type="number" value="${stay?.minNights || 2}" inputmode="numeric"></label>
        <label class="field"><span>Minimum at Peak</span><input name="peakMinNights" type="number" value="${stay?.peakMinNights || 7}" inputmode="numeric"></label>
        <label class="field"><span>Public rate US$</span><input name="retailUsd" type="number" value="${stay?.retailUsd || 0}" inputmode="decimal"></label>
      </div>`}
      <label class="field"><span>What it is like</span><textarea name="vibe" rows="2">${escapeHtml(stay?.vibe || '')}</textarea></label>
      <label class="field"><span>Note from Victor</span><input name="dealNote" value="${escapeHtml(stay?.dealNote || '')}"></label>
      <label class="row" style="gap:10px;margin-bottom:12px"><input type="checkbox" name="active" ${stay?.active !== false ? 'checked' : ''} style="width:20px;height:20px"><span class="small">Live for members</span></label>
      ${isTrip ? '' : `<label class="row" style="gap:10px;margin-bottom:12px"><input type="checkbox" name="house" ${stay?.house ? 'checked' : ''} style="width:20px;height:20px"><span class="small">One of the places we actually use — shows first, with a badge</span></label>`}
      <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>Save</button></div>`;
    // Typing in either box updates the other, so the two never disagree.
    body.addEventListener('input', (e) => {
      const usd = e.target.closest('[data-usd]'); const pts = e.target.closest('[data-pts]');
      if (usd) { const p = body.querySelector(`[data-pts="${usd.dataset.usd}"]`); if (p) p.value = Math.round((Number(usd.value) || 0) * s.pointsPerDollar); }
      if (pts) { const u = body.querySelector(`[data-usd="${pts.dataset.pts}"]`); if (u) u.value = (Math.round(Number(pts.value) || 0) / s.pointsPerDollar).toFixed(2); }
    });
    body.querySelector('[data-ok]').addEventListener('click', () => {
      const v = (n) => body.querySelector(`[name=${n}]`)?.value;
      const usd = (n) => Number(body.querySelector(`[data-usd="${n}"]`)?.value) || 0;
      const data = { id: stay?.id, kind: stay?.kind || 'aruba', name: v('name'), area: v('area'), vibe: v('vibe'), dealNote: v('dealNote'),
        active: body.querySelector('[name=active]').checked, country: stay?.country || 'Aruba', features: stay?.features || [] };
      if (isTrip) Object.assign(data, { pointsPerSeat: Math.round(usd('seat') * s.pointsPerDollar), guestCashUsd: Number(v('guestCashUsd')) || 0,
        dates: stay.dates, nights: stay.nights, seats: stay.seats, holdDeadline: stay.holdDeadline });
      else Object.assign(data, { rates: { low: usd('low'), high: usd('high'), peak: usd('peak') },
        minNights: Number(v('minNights')), peakMinNights: Number(v('peakMinNights')), retailUsd: Number(v('retailUsd')),
        onSand: stay?.onSand ?? true, adultsOnly: stay?.adultsOnly ?? false, category: stay?.category || 2,
        house: !!body.querySelector('[name=house]')?.checked });
      close(data);
    });
  } });
  if (out) { await store.upsertStay(out, store.me.id); toast('Saved. Members see the new points immediately.', { kind: 'good' }); }
}

// ---------------------------------------------------------------- the Pool
export function pool({ store }) {
  const s = store.settings;
  const t = store.treasury();
  const series = store.monthlySeries(9);
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">Proof of reserves</p>
      <h1>The Pool</h1>
      <p class="lede" style="margin-top:12px">Every point the Circle owes has a dollar sitting behind it in the Reserve. This page is the arithmetic, open to every Insider.</p>
      <div id="gauge" style="margin-top:20px"></div>
      <div class="grid g4" style="margin-top:20px">
        <div class="stat"><span class="k">Reserve, by the ledger</span><b class="num">${escapeHtml(fmtUsd2(t.reserveUsd))}</b><span class="sub">every dollar in, minus what has been paid out</span></div>
        <div class="stat"><span class="k">Owed in points</span><b class="num">${escapeHtml(fmtPoints(t.outstandingPoints))}</b><span class="sub">${escapeHtml(fmtUsd2(t.liabilityUsd))} of hotel</span></div>
        <div class="stat"><span class="k">Coverage</span><b class="num">${escapeHtml(fmtPct(t.coverage))}</b><span class="sub">Reserve ÷ what is owed</span></div>
        <div class="stat"><span class="k">Operating</span><b class="num">${escapeHtml(fmtUsd2(t.operatingUsd))}</b><span class="sub">the 15%, minus the bonuses it funded</span></div>
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
            <li><span class="what"><b>${escapeHtml(VOCAB.share)}</b><span class="meta">15%, to Operating</span></span><span class="delta"><b>−${escapeHtml(fmtUsd2(t.share))}</b></span></li>
            <li><span class="what"><b>Into the Reserve</b><span class="meta">the 85% that backs points</span></span><span class="delta"><b>${escapeHtml(fmtUsd2(t.backing))}</b></span></li>
            <li><span class="what"><b>Bonuses funded by the Circle</b><span class="meta">tier, streak and founding — paid out of the 15%, moved into the Reserve</span></span><span class="delta"><b>+${escapeHtml(fmtUsd2(t.promoUsd))}</b></span></li>
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
  const roster = store.members.filter(m => m.status !== 'left');
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
      panel.replaceChildren(el(`<div class="grid g3">${roster.map(m => {
        const named = m.showOnRollcall || m.id === me.id || m.roles.some(r => r !== 'member');
        const streak = store.streak(m.id);
        return `<div class="panel"><div class="row" style="gap:12px">
            ${avatar(m, 40)}
            <div><b>${escapeHtml(named ? m.name : initials(m.name))}</b>
              <br><span class="small muted">${escapeHtml(m.title || `${tierName(m.monthlyUsd)} · since ${fmtDay(m.joinedAt)}`)}</span></div>
          </div>
          <div class="row" style="margin-top:12px;gap:8px">
            ${treeSvg(VOCAB.tierLean[m.monthlyUsd], { size: 18 })}
            ${m.founding ? '<span class="tag">Founding</span>' : ''}
            ${m.standingOrder ? '<span class="tag">Autopilot</span>' : ''}
            ${m.status === 'paused' ? '<span class="tag">Paused</span>' : ''}
            ${streak >= 6 ? `<span class="tag">${streak} in a row</span>` : ''}
          </div></div>`;
      }).join('')}</div>`));
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
export function settings({ store, go }) {
  const me = store.me, s = store.settings;
  const isAdmin = store.hasRole('admin');
  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:900px">
      <p class="eyebrow">${isAdmin ? 'Admin' : 'The Banker'}</p>
      <h1>Settings</h1>

      <form class="panel" id="accounts" style="margin-top:20px">
        <h2 style="font-size:1.1rem">The two accounts</h2>
        <p class="small muted" style="margin-top:6px">Coverage can only be verified when the Reserve and Operating are two different accounts. Be honest about who holds them.</p>
        <div class="grid g2" style="margin-top:12px">
          <div><p class="eyebrow">Reserve · backs the points</p>
            <label class="field"><span>Bank</span><input name="rBank" value="${escapeHtml(s.reserveAccount.bank || '')}"></label>
            <label class="field"><span>Held by</span><input name="rHolder" value="${escapeHtml(s.reserveAccount.holder || '')}" placeholder="Held by Vishnu on behalf of the Circle"></label>
            <label class="field"><span>Account number</span><input name="rNumber" class="mono" value="${escapeHtml(s.reserveAccount.number || '')}"></label></div>
          <div><p class="eyebrow">Operating · the 15%</p>
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

      <div class="panel" style="margin-top:16px">
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
      </form>

      <div class="panel" style="margin-top:16px">
        <div class="row-between"><h2 style="font-size:1.1rem">Insiders</h2><button class="btn ghost sm" id="invite">Invite someone</button></div>
        <div class="tablewrap" style="margin-top:14px;border:0"><table>
          <thead><tr><th>Name</th><th>Tier</th><th>Roles</th><th>State</th><th class="num">Points</th><th></th></tr></thead>
          <tbody>${store.members.map(m => `<tr>
            <td><b>${escapeHtml(m.name)}</b><br><span class="small muted">${escapeHtml(m.email)}</span></td>
            <td>${escapeHtml(tierName(m.monthlyUsd))}</td>
            <td class="small">${escapeHtml(m.roles.join(', '))}</td>
            <td>${chip(m.status === 'active' ? 'active' : m.status)}</td>
            <td class="num">${escapeHtml(fmtPoints(store.availablePoints(m.id)))}</td>
            <td><button class="btn quiet sm" data-adjust="${m.id}">Adjust</button></td></tr>`).join('')}</tbody></table></div>
      </div>

      <div class="panel" style="margin-top:16px">
        <h2 style="font-size:1.1rem">The record</h2>
        <p class="small muted" style="margin-top:6px">Everything anyone did, oldest at the bottom. The ledger itself can never be edited — corrections are new lines with a reason.</p>
        <div class="row" style="margin-top:12px">
          <button class="btn ghost sm" id="backup">Back up everything</button>
          <button class="btn ghost sm" id="restore">Restore from a backup</button>
          <button class="btn quiet sm" id="reset">Reset the demo</button>
        </div>
        <ul class="ledger" style="margin-top:14px">${store.audit(25).map(a => `<li>
          <span class="what"><b>${escapeHtml(a.action)}</b><span class="meta">${escapeHtml(store.member(a.actorId)?.name || 'system')} · ${escapeHtml(a.entity)}</span></span>
          <span class="delta"><small>${escapeHtml(fmtDayTime(a.at))}</small></span></li>`).join('')}</ul>
      </div>` : ''}
    </div></section></div>`);

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
    e.preventDefault();
    await store.updateSettings({ wallet: { url: new FormData(e.target).get('walletUrl').trim(), token: '' } }, me.id);
    toast('Saved.', { kind: 'good' });
  });
  wrap.querySelector('#accounts').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    await store.updateSettings({
      reserveAccount: { bank: f.get('rBank'), holder: f.get('rHolder'), number: f.get('rNumber') },
      operatingAccount: { bank: f.get('oBank'), holder: f.get('oHolder'), number: f.get('oNumber') },
    }, me.id);
    toast('Saved.', { kind: 'good' });
  });
  wrap.querySelector('#rules-form')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const patch = Object.fromEntries([...f.entries()].map(([k, v]) => [k, Number(v)]));
    const yes = await confirmDialog({ title: 'Change the rules?', confirmText: 'Change them',
      message: 'The share and the value of a point are promises to every Insider. Tell the Circle first, and never change them after someone has booked against them.' });
    if (yes) { await store.updateSettings(patch, me.id); toast('Saved. Tell the Circle what changed.', { kind: 'good' }); }
  });
  wrap.querySelector('#invite')?.addEventListener('click', async () => {
    const out = await sheet({ title: 'Invite an Insider', render: (body, close) => {
      body.innerHTML = `<p class="sheet-text">They pick their own level when they accept. ${store.activeMembers().length} of ${s.memberCap} seats are taken.</p>
        <label class="field"><span>Their name</span><input name="name" required></label>
        <label class="field"><span>Their email</span><input name="email" type="email"></label>
        <label class="field"><span>Suggested level</span><select name="monthlyUsd">${s.tiers.map(t => `<option value="${t.monthlyUsd}"${t.monthlyUsd === 150 ? ' selected' : ''}>$${t.monthlyUsd} · ${escapeHtml(tierName(t.monthlyUsd))}</option>`).join('')}</select></label>
        <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>Create the invitation</button></div>`;
      body.querySelector('[data-ok]').addEventListener('click', () => close({
        name: body.querySelector('[name=name]').value, email: body.querySelector('[name=email]').value,
        monthlyUsd: Number(body.querySelector('[name=monthlyUsd]').value),
      }));
    } });
    if (out?.name) {
      const inv = await store.createInvitation({ ...out, sponsorId: me.id }, me.id);
      const url = `${location.origin}${location.pathname}#/join/${inv.code}`;
      await copyText(url);
      toast(`Invitation created and the link is copied: ${inv.code}`, { kind: 'good', timeout: 7000 });
    }
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
      const yes = await confirmDialog({ title: 'Reset the demo?', danger: true, confirmText: 'Reset', message: 'Everything in this browser goes back to how the demo started.' });
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
