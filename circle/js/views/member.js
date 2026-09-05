// The member's own screens: home, sending a contribution, the ledger, the card, the profile.
import { escapeHtml, fmtUsd2, fmtAfl2, fmtPoints, fmtPointsUsd, pointsUsd, fmtDay, fmtDayTime, fmtMonth, fmtPct, monthKey, countdownTo, initials, toCsv, downloadText } from '../core/util.js';
import { VOCAB, tierName, refFor } from '../core/vocab.js';
import { splitContribution, tierFor, seasonPoints, SEASONS, isDushiSeason } from '../core/money.js';
import { splitBar, poolGauge, ring, memberCard } from '../ui/pieces.js';
import { treeSvg } from '../ui/art.js';
import { toast, sheet, confirmDialog, setBusy, chip, countUp, statusLabel } from '../ui/components.js';
import { sparkline, columns, tableFor } from '../ui/charts.js';
import { waLink, TEMPLATES, copyText } from '../core/share.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const KIND_LABEL = { earn: 'Contribution', bonus: 'Tier bonus', streak: 'Streak bonus', founding: 'Founding bonus', burn: 'Stay', refund: 'Refund', adjust: 'Adjustment', expire: 'Expired', reverse: 'Reversal' };

export function home({ store, go }) {
  const me = store.me, s = store.settings;
  const lt = store.lifetime(me.id);
  const t = store.treasury();
  const month = monthKey();
  const status = store.monthStatus(me.id, month);
  const tier = tierFor(s, me.monthlyUsd);
  const held = store.state.redemptions.filter(r => r.memberId === me.id && r.status === 'held');
  const quoted = store.state.redemptions.filter(r => r.memberId === me.id && r.status === 'quoted');
  const upcoming = store.state.redemptions.filter(r => r.memberId === me.id && r.status === 'confirmed');
  const note = store.announcements()[0];
  const dream = store.stay(me.dreamStayId) || store.arubaStays()[0];
  const streak = store.streak(me.id);
  const next = store.nextMilestone(me.id);

  const wrap = el(`<div><section class="sec"><div class="wrap">
    <div class="side">
      <div class="stack" id="left"></div>
      <div class="stack" id="right"></div>
    </div></div></section></div>`);
  const left = wrap.querySelector('#left'), right = wrap.querySelector('#right');

  // 1 — the card strip and the balance, above the fold
  const top = el(`<div class="panel">
      <div class="card-strip">
        <a href="#/card" style="width:132px;display:block" aria-label="Open your card"><span id="mini-card"></span></a>
        <div>
          <h1 style="font-size:1.05rem;letter-spacing:.01em"><span lang="pap" class="pap">${escapeHtml(VOCAB.pap.welcome[0])}</span>, ${escapeHtml(me.name.split(' ')[0])}</h1>
          <p class="k small muted" style="margin-top:8px">Available</p>
          <div class="hero-figure" id="avail">0</div>
          <p class="small muted" id="avail-usd"></p>
        </div>
      </div>
      <div id="balbar" style="margin-top:16px"></div>
      <div class="row" style="margin-top:16px">
        <a class="btn" href="#/pay">Send a contribution</a>
        <a class="btn ghost" href="#/stays">Request a stay</a>
        <a class="btn quiet sm" href="#/ledger">Statement</a>
      </div>
    </div>`);
  left.appendChild(top);
  top.querySelector('#mini-card').replaceChildren(memberCard(me, { store, flippable: false, compact: true }));
  countUp(top.querySelector('#avail'), lt.available, { format: (n) => `✦ ${Math.round(n).toLocaleString('en-US')}` });
  top.querySelector('#avail-usd').textContent = `${pointsUsd(lt.available, s.pointsPerDollar)} of hotel${lt.committed ? ` · ${fmtPoints(lt.committed)} committed to a booking` : ''}`;
  {
    const total = Math.max(1, lt.available + lt.committed);
    top.querySelector('#balbar').innerHTML = `
      <div class="balbar" role="img" aria-label="${fmtPoints(lt.available)} available, ${fmtPoints(lt.committed)} committed">
        <span class="b-avail" style="width:${(lt.available / total) * 100}%"></span>
        <span class="b-held" style="width:${(lt.committed / total) * 100}%"></span>
      </div>
      <div class="split-legend"><span><i style="background:var(--good)"></i>Available <b>${escapeHtml(fmtPoints(lt.available))}</b></span>
      ${lt.committed ? `<span><i style="background:var(--flight)"></i>Committed <b>${escapeHtml(fmtPoints(lt.committed))}</b></span>` : ''}</div>`;
  }

  // 2 — the dream, with a season scrubber
  const dreamPanel = el(`<div class="panel">
      <div class="row-between"><p class="eyebrow">Where you are heading</p>
        <div class="row" role="group" aria-label="Season" id="season-dial">
          ${Object.values(SEASONS).map((se, i) => `<button class="btn quiet sm" data-season="${se.id}" aria-pressed="${i === 0}">${escapeHtml(se.label)}</button>`).join('')}
        </div></div>
      <div class="row" style="gap:18px;margin-top:12px;align-items:center">
        <span id="dream-ring"></span>
        <div><h2 id="dream-line" style="font-size:1.25rem"></h2>
        <p class="small muted" id="dream-sub" style="margin-top:6px"></p>
        <p class="small" style="margin-top:8px"><a href="#/stays">Choose a different one</a></p></div>
      </div></div>`);
  left.appendChild(dreamPanel);
  let season = 'low';
  const drawDream = () => {
    const per = seasonPoints(dream, season, s);
    const coverable = per ? lt.available / per : 0;
    const min = dream.minNights || 1;
    dreamPanel.querySelector('#dream-ring').replaceChildren(ring({ total: min, filled: Math.min(min, Math.floor(coverable)), size: 84, label: coverable.toFixed(1), sub: 'nights' }));
    dreamPanel.querySelector('#dream-line').textContent = `You are ${coverable.toFixed(1)} nights from ${dream.name} in ${SEASONS[season].label}.`;
    dreamPanel.querySelector('#dream-sub').textContent =
      `${fmtPoints(per)} a night all-in (${fmtUsd2(per / 100)}) · ${SEASONS[season].range} · minimum ${min} night${min > 1 ? 's' : ''}` +
      (isDushiSeason(new Date()) && season === 'low' ? ' · dushi season: the quietest, cheapest weeks of the year.' : '');
    dreamPanel.querySelectorAll('[data-season]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.season === season)));
  };
  drawDream();
  dreamPanel.querySelector('#season-dial').addEventListener('click', (e) => { const b = e.target.closest('[data-season]'); if (!b) return; season = b.dataset.season; drawDream(); });

  // 3 — what needs you, in the order it needs you
  const blocks = [];
  if (status === 'due') blocks.push(`<div class="notice warn"><b>Your ${escapeHtml(fmtMonth(month))} contribution is due</b>
      <p class="small">${escapeHtml(fmtUsd2(me.monthlyUsd))} to the Reserve with reference <span class="num">${escapeHtml(refFor(me, month))}</span>, then tap “I sent it”.</p>
      <p style="margin-top:8px"><a class="btn sm" href="#/pay">Send it</a></p></div>`);
  if (status === 'pending') {
    const c = store.contributionsFor(me.id).find(x => x.forMonth === month && x.status === 'pending');
    blocks.push(`<div class="notice"><b>Sent · awaiting the Banker</b>
      <p class="small">${escapeHtml(fmtUsd2(c.expectedUsd))} marked as sent on ${escapeHtml(fmtDay(c.submittedAt))}. Vishnu confirms within ${s.bankerSlaHours} hours of the money arriving; your points appear the moment he does.</p></div>`);
  }
  if (status === 'paused') blocks.push(`<div class="notice"><b>You are paused until ${escapeHtml(fmtMonth(me.pausedUntil))}</b>
      <p class="small">Your streak is frozen at ${streak}, not reset, and your points stay fully usable. <a href="#/profile">Resume any time</a>.</p></div>`);
  for (const q of quoted) {
    const st = store.stay(q.stayId); const left2 = countdownTo(q.quoteExpiresAt);
    blocks.push(`<div class="notice warn"><b>A quote is waiting for you</b>
      <p class="small">${escapeHtml(st.name)} · ${q.nights} nights from ${escapeHtml(fmtDay(q.checkIn))} · ${escapeHtml(fmtPoints(q.quotedPoints))}${q.topUpUsd ? ` plus ${escapeHtml(fmtUsd2(q.topUpUsd))} top-up` : ''}.
      ${left2 ? `Expires in <span class="num">${escapeHtml(left2)}</span>.` : 'It has expired.'}</p>
      <p style="margin-top:8px"><a class="btn sm" href="#/requests/${q.id}">Look at it</a></p></div>`);
  }
  for (const h of held) {
    const st = store.stay(h.stayId);
    blocks.push(`<div class="notice"><b>${escapeHtml(fmtPoints(h.points))} committed to ${escapeHtml(st.name)}</b>
      <p class="small">${h.nights} nights from ${escapeHtml(fmtDay(h.checkIn))}. Victor is confirming with the hotel; your points burn when it is paid.</p>
      <p style="margin-top:8px"><a class="btn ghost sm" href="#/requests/${h.id}">Details</a></p></div>`);
  }
  for (const u of upcoming) {
    const st = store.stay(u.stayId);
    blocks.push(`<div class="notice good"><b>Booked: ${escapeHtml(st.name)}</b>
      <p class="small">${u.nights} nights from ${escapeHtml(fmtDay(u.checkIn))} · confirmation <span class="num">${escapeHtml(u.confirmationRef)}</span>${u.hotelDeadline ? ` · free cancellation until ${escapeHtml(fmtDay(u.hotelDeadline))}` : ''}.</p></div>`);
  }
  const chipIn = store.openToChipIn().filter(r => r.memberId !== me.id);
  for (const r of chipIn.slice(0, 2)) {
    const st = store.stay(r.stayId); const owner = store.member(r.memberId);
    const target = r.quotedPoints || r.indicativePoints || 0;
    const gap = Math.max(0, target - store.coveredPoints(r));
    blocks.push(`<div class="notice"><b>${escapeHtml(owner?.name.split(' ')[0] || 'An Insider')} is ${escapeHtml(fmtPoints(gap))} short for ${escapeHtml(st?.name || 'a stay')}</b>
      <p class="small">${r.nights} nights from ${escapeHtml(fmtDay(r.checkIn))}. Anyone can put their own points in — yours are committed only until it is booked or falls through.</p>
      <p style="margin-top:8px"><a class="btn sm" href="#/requests/${r.id}">Chip in</a></p></div>`);
  }
  if (blocks.length) left.appendChild(el(`<div class="stack">${blocks.join('')}</div>`));

  // 4 — the ledger, last five lines
  const recent = store.ledgerFor(me.id).slice(0, 5);
  const ledgerPanel = el(`<div class="panel">
      <div class="row-between"><h2 style="font-size:1.1rem">Your ledger</h2><a class="small" href="#/ledger">All of it</a></div>
      <ul class="ledger" style="margin-top:10px">${recent.map(l => ledgerRow(l, s)).join('') || '<li><span class="what"><b>No lines yet</b><span class="meta">Your first confirmed contribution will appear here with its split.</span></span></li>'}</ul>
    </div>`);
  left.appendChild(ledgerPanel);

  // right column — streak, roll call, coverage, the note from Ian
  right.appendChild(el(`<div class="panel">
      <p class="eyebrow">Your standing</p>
      <div class="row" style="gap:12px;margin-top:10px;align-items:center">
        ${treeSvg(VOCAB.tierLean[me.monthlyUsd], { size: 30 })}
        <div><b>${escapeHtml(tierName(me.monthlyUsd))}</b> · ${escapeHtml(fmtUsd2(me.monthlyUsd))} a month
        <br><span class="small muted">${escapeHtml(fmtPointsUsd(store.lifetime(me.id).balance, s.pointsPerDollar))} held${me.founding ? ` · ${escapeHtml(VOCAB.founding)}` : ''}</span></div>
      </div>
      <p class="small" style="margin-top:14px"><b class="num">${streak}</b> consecutive contribution${streak === 1 ? '' : 's'}${next ? ` · ${next - streak} more to the ${next}-month bonus of ${fmtPoints(s.streakBonuses[next])}` : ''}.</p>
      <div style="margin-top:12px">${sparkSlot()}</div>
    </div>`));
  {
    const series = store.balanceSeries(me.id).map(p => p.points);
    right.querySelector('.spark-slot')?.replaceChildren(sparkline(series.length ? series : [0, 0], { height: 46 }));
  }
  right.appendChild(el(`<div class="panel">
      <p class="eyebrow">This month in the Circle</p>
      <div class="row" style="gap:14px;margin-top:12px;align-items:center">
        <span id="rollcall"></span>
        <div class="small"><b>${t.confirmedThisMonth} of ${t.expectedThisMonth}</b> contributions confirmed for ${escapeHtml(fmtMonth(month))}.
        <br><span class="muted">Names stay private unless an Insider opts in.</span></div>
      </div></div>`));
  right.querySelector('#rollcall').replaceChildren(ring({ total: t.expectedThisMonth, filled: t.confirmedThisMonth, size: 76 }));
  const cov = el(`<div class="panel"><p class="eyebrow">Proof of reserves</p><div id="cov" style="margin-top:12px"></div>
      <p class="small muted" style="margin-top:10px"><a href="#/pool">The whole Pool</a></p></div>`);
  cov.querySelector('#cov').appendChild(poolGauge({ coverage: t.coverage, reserveUsd: t.reserveUsd, outstandingPoints: t.outstandingPoints, verifiedAt: t.verified?.at, verifiedVarianceUsd: t.verifiedVarianceUsd, configured: t.accountsConfigured }));
  right.appendChild(cov);
  if (note) right.appendChild(el(`<div class="panel"><p class="eyebrow">Note from ${escapeHtml(store.member(note.authorId)?.name.split(' ')[0] || 'Ian')}</p>
      <h3 style="margin-top:8px">${escapeHtml(note.title)}</h3>
      <p class="small muted" style="margin-top:8px">${escapeHtml(note.body.slice(0, 180))}${note.body.length > 180 ? '…' : ''}</p>
      <p class="small" style="margin-top:10px"><a href="#/circle">All the notes</a></p></div>`));
  return wrap;
}

const sparkSlot = () => '<div class="spark-slot"></div>';

function ledgerRow(l, s) {
  const positive = l.points > 0;
  return `<li><span class="what"><b>${escapeHtml(l.note)}</b>
      <span class="meta">${escapeHtml(KIND_LABEL[l.kind] || l.kind)} · ${escapeHtml(fmtDay(l.at))}</span></span>
    <span class="delta"><b class="${positive ? 'pos' : 'neg'}">${positive ? '+' : ''}${Math.round(l.points).toLocaleString('en-US')}</b>
      <small>${escapeHtml(pointsUsd(Math.abs(l.points), s.pointsPerDollar))}</small></span></li>`;
}

export function pay({ store, go }) {
  const me = store.me, s = store.settings;
  const month = monthKey();
  const status = store.monthStatus(me.id, month);
  const tier = tierFor(s, me.monthlyUsd);
  const sp = splitContribution(me.monthlyUsd, s, tier);
  const reference = refFor(me, month);
  const pending = store.contributionsFor(me.id).find(c => c.forMonth === month && c.status === 'pending');
  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:820px">
      <p class="eyebrow">${escapeHtml(fmtMonth(month))}</p>
      <h1>Send your contribution</h1>
      <p class="lede" style="margin-top:12px">${escapeHtml(fmtUsd2(me.monthlyUsd))} — ${escapeHtml(fmtAfl2(me.monthlyUsd, s.awgPerUsd))} at the peg of ${s.awgPerUsd} — to the Circle’s Reserve account. Points appear when Vishnu confirms the money landed, not before.</p>

      <div class="panel" style="margin-top:22px">
        <h2>1 · Make the transfer</h2>
        <div class="grid g2" style="margin-top:14px">
          <div class="stack">
            <div class="copyline"><code>${escapeHtml(s.reserveAccount.bank)}</code></div>
            <div class="copyline"><code>${escapeHtml(s.reserveAccount.holder)}</code></div>
            <div class="copyline"><code class="num">${escapeHtml(s.reserveAccount.number)}</code><button class="btn quiet sm" data-copy="${escapeHtml(s.reserveAccount.number)}">Copy</button></div>
          </div>
          <div class="stack">
            <div><p class="eyebrow">Put this in the description</p>
              <div class="copyline" style="margin-top:6px"><code class="num" style="font-size:1.05rem">${escapeHtml(reference)}</code><button class="btn quiet sm" data-copy="${escapeHtml(reference)}">Copy</button></div></div>
            <p class="small muted">It is how Vishnu matches your transfer against the statement in seconds. Same reference every month, with the month on the end.</p>
          </div>
        </div>
        <p class="small muted" style="margin-top:14px">Florins between local banks land in seconds through I-Pago. A US-dollar transfer can take a business day. Your points follow the amount that actually arrives — bank fees and exchange spread are yours, and the Circle never rounds in its own favour.</p>
      </div>

      <div class="panel" style="margin-top:16px">
        <h2>2 · What it becomes</h2>
        <div id="split" style="margin-top:14px"></div>
        <div class="grid g3" style="margin-top:16px">
          <div class="stat"><span class="k">Backs your points</span><b class="num">${escapeHtml(fmtUsd2(sp.backingUsd))}</b><span class="sub">${escapeHtml(fmtPoints(sp.basePoints))}</span></div>
          <div class="stat"><span class="k">${escapeHtml(VOCAB.share)}</span><b class="num">${escapeHtml(fmtUsd2(sp.shareUsd))}</b><span class="sub">15%, itemised, not refundable</span></div>
          <div class="stat"><span class="k">${sp.bonusPoints ? escapeHtml(tierName(me.monthlyUsd)) + ' bonus' : 'Total credited'}</span><b class="num">${escapeHtml(sp.bonusPoints ? fmtPoints(sp.bonusPoints) : fmtPoints(sp.points))}</b><span class="sub">${sp.bonusPoints ? 'Funded by the Circle from its share' : 'When Vishnu confirms'}</span></div>
        </div>
      </div>

      <div class="panel" style="margin-top:16px">
        <h2>3 · Tell Vishnu</h2>
        ${pending ? `<div class="notice" style="margin-top:12px"><b>Already sent</b>
            <p class="small">You marked ${escapeHtml(fmtUsd2(pending.expectedUsd))} as sent on ${escapeHtml(fmtDay(pending.submittedAt))}, reference <span class="num">${escapeHtml(pending.reference)}</span>. It is in the Banker’s queue.</p>
            <p style="margin-top:10px"><button class="btn ghost sm" id="withdraw">Withdraw it</button></p></div>`
          : status === 'confirmed' ? `<div class="notice good" style="margin-top:12px"><b><span lang="pap" class="pap">${escapeHtml(VOCAB.pap.thanks[0])}</span> · ${escapeHtml(VOCAB.pap.thanks[1])}</b>
            <p class="small">${escapeHtml(fmtMonth(month))} is already confirmed. Your next one is due on the ${s.dueDay}th of next month.</p></div>`
          : `<form id="sent" style="margin-top:12px">
            <div class="grid g2">
              <label class="field"><span>Amount sent</span><input name="amountUsd" type="number" inputmode="decimal" step="0.01" min="1" value="${me.monthlyUsd}" required></label>
              <label class="field"><span>Currency</span><select name="currency"><option value="USD">US dollars</option><option value="AWG">Aruban florin</option></select></label>
              <label class="field"><span>Date sent</span><input name="sentOn" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
              <label class="field"><span>From which bank</span><select name="bank">${['Aruba Bank', 'Banco di Caribe', 'CMB', 'RBC Royal Bank', 'Other'].map(b => `<option>${b}</option>`).join('')}</select></label>
            </div>
            <label class="field"><span>Anything Vishnu should know</span><textarea name="note" rows="2" placeholder="Optional — for example, my wife sent it from her account."></textarea></label>
            <label class="field"><span>Screenshot of the transfer (optional)</span><input name="proof" type="file" accept="image/*" style="padding:10px">
              <span class="hint">Helpful, never required. The bank statement is what actually matches.</span></label>
            <div class="row"><button class="btn" type="submit">I sent it</button>
              <a class="btn ghost" id="wa" target="_blank" rel="noopener" href="${escapeHtml(waLink(store.member('mem_vishnu')?.phone || '', TEMPLATES.transferSent({ member: me, amountUsd: me.monthlyUsd, month, reference })))}">Message Vishnu</a></div>
          </form>`}
      </div>

      <p class="small muted" style="margin-top:18px">Prefer not to think about it? Set a standing order for the ${s.dueDay}th — Aruba Bank and Banco di Caribe both do it free, online — and put the reference in the description once. <a href="#/profile">Mark yourself on autopilot</a>.</p>
    </div></section></div>`);
  wrap.querySelector('#split').appendChild(splitBar({ amountUsd: me.monthlyUsd, shareRate: s.serviceRate, points: sp.basePoints }));
  wrap.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { const ok = await copyText(c.dataset.copy); toast(ok ? 'Copied.' : 'Select and copy it by hand.'); return; }
    if (e.target.id === 'withdraw') {
      const yes = await confirmDialog({ title: 'Withdraw this contribution?', message: 'It disappears from the Banker’s queue. You can mark it as sent again at any time.', confirmText: 'Withdraw' });
      if (yes) { await store.withdrawContribution(pending.id, store.me.id); toast('Withdrawn.'); }
    }
  });
  wrap.querySelector('#sent')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    setBusy(btn, true, 'Sending…');
    try {
      const currency = f.get('currency');
      const raw = Number(f.get('amountUsd'));
      const amountUsd = currency === 'AWG' ? Math.round((raw / s.awgPerUsd) * 100) / 100 : raw;
      const file = e.target.proof?.files?.[0];
      await store.submitContribution({
        memberId: me.id, amountUsd, forMonth: month, currency, bank: f.get('bank'), reference,
        note: f.get('note'), sentOn: f.get('sentOn'), proofName: file?.name || '',
      });
      toast('Marked as sent. Vishnu will confirm it once it lands.', { kind: 'good' });
      go('/home');
    } catch (err) { setBusy(btn, false); toast(err.message, { kind: 'bad', timeout: 6000 }); }
  });
  return wrap;
}

export function ledger({ store, params }) {
  const me = store.me, s = store.settings;
  const all = store.ledgerFor(me.id);
  const lt = store.lifetime(me.id);
  const month = params.month || null;
  const rows = month ? all.filter(l => l.at.slice(0, 7) === month) : all;
  const closed = month ? store.state.monthCloses.find(c => c.month === month) : null;
  const months = [...new Set(all.map(l => l.at.slice(0, 7)))].sort().reverse();
  const effective = lt.paidUsd ? (lt.balance / s.pointsPerDollar + lt.burnedPoints / s.pointsPerDollar) / lt.paidUsd : 0;

  const wrap = el(`<div><section class="sec"><div class="wrap">
      <div class="row-between">
        <div><p class="eyebrow">${month ? escapeHtml(fmtMonth(month)) + ' statement' : 'Every line, since you joined'}</p>
          <h1>${month ? escapeHtml(fmtMonth(month)) : 'Your ledger'}</h1></div>
        <div class="row no-print">
          <select id="month-pick" class="btn ghost sm" aria-label="Choose a month" style="padding-inline:12px">
            <option value="">Everything</option>
            ${months.map(m => `<option value="${m}"${m === month ? ' selected' : ''}>${escapeHtml(fmtMonth(m))}</option>`).join('')}
          </select>
          <button class="btn ghost sm" id="print">Print</button>
          <button class="btn ghost sm" id="csv">CSV</button>
        </div>
      </div>
      ${closed ? `<div class="notice good" style="margin-top:16px"><b>Sealed</b>
        <p class="small">${escapeHtml(fmtMonth(month))} was closed by ${escapeHtml(store.member(closed.closedBy)?.name || 'the Banker')} on ${escapeHtml(fmtDay(closed.closedAt))} and co-signed by ${escapeHtml(store.member(closed.cosignedBy)?.name || 'an officer')}. Coverage at close: ${escapeHtml(fmtPct(closed.coverage))}.</p></div>` : ''}

      <div class="grid g4" style="margin-top:20px">
        <div class="stat"><span class="k">Sent, lifetime</span><b class="num">${escapeHtml(fmtUsd2(lt.paidUsd))}</b><span class="sub">${escapeHtml(store.contributionsFor(me.id).filter(c => c.status === 'confirmed').length)} confirmed contributions</span></div>
        <div class="stat"><span class="k">${escapeHtml(VOCAB.share)}</span><b class="num">${escapeHtml(fmtUsd2(lt.shareUsd))}</b><span class="sub">15%, taken once, up front</span></div>
        <div class="stat"><span class="k">Backing + bonuses</span><b class="num">${escapeHtml(fmtUsd2(lt.backingUsd + lt.promoPoints / s.pointsPerDollar))}</b><span class="sub">${escapeHtml(fmtPoints(lt.promoPoints))} of that is bonus points</span></div>
        <div class="stat"><span class="k">Available now</span><b class="num">${escapeHtml(fmtPoints(lt.available))}</b><span class="sub">${escapeHtml(pointsUsd(lt.available, s.pointsPerDollar))}${lt.committed ? ` · ${fmtPoints(lt.committed)} committed` : ''}</span></div>
      </div>
      <p class="small muted" style="margin-top:12px">You have turned ${escapeHtml(fmtUsd2(lt.paidUsd))} into ${escapeHtml(fmtUsd2(lt.balance / s.pointsPerDollar + lt.burnedPoints / s.pointsPerDollar))} of hotel so far — ${escapeHtml(fmtPct(effective, 1))} of everything you sent. Committed points still count against the Circle’s coverage until they are burned.</p>

      <div class="panel" style="margin-top:20px">
        <div class="row-between"><h2 style="font-size:1.1rem">Contributions</h2></div>
        <div class="tablewrap" style="margin-top:12px;border:0">
          <table><thead><tr><th>Month</th><th>Sent</th><th>Received</th><th>Split</th><th class="num">Points</th><th>State</th></tr></thead>
          <tbody id="contrib-rows"></tbody></table>
        </div>
      </div>

      <div class="panel" style="margin-top:16px">
        <h2 style="font-size:1.1rem">Points, line by line</h2>
        <ul class="ledger" style="margin-top:10px" id="rows"></ul>
      </div>
    </div></section></div>`);

  const contribs = store.contributionsFor(me.id).filter(c => !month || c.forMonth === month);
  wrap.querySelector('#contrib-rows').innerHTML = contribs.map(c => `<tr>
      <td>${escapeHtml(fmtMonth(c.forMonth))}<br><span class="small muted num">${escapeHtml(c.reference || '—')}</span></td>
      <td class="num">${escapeHtml(fmtUsd2(c.expectedUsd))}</td>
      <td class="num">${c.receivedUsd == null ? '—' : escapeHtml(fmtUsd2(c.receivedUsd))}</td>
      <td style="min-width:150px">${c.status === 'confirmed' ? `<div class="split drawn" style="--cut:85%"><i style="width:85%"></i></div><span class="small muted num">${escapeHtml(fmtUsd2(c.backingUsd))} + ${escapeHtml(fmtUsd2(c.shareUsd))}</span>` : '<span class="small muted">—</span>'}</td>
      <td class="num">${c.points == null ? '—' : escapeHtml(fmtPoints(c.points))}</td>
      <td>${chip(c.status === 'rejected' ? 'rejected' : c.status)}${c.reason ? `<br><span class="small muted">${escapeHtml(c.reason)}</span>` : ''}
        ${c.reviewedAt && c.status === 'confirmed' ? `<br><span class="small muted">by ${escapeHtml(store.member(c.reviewedBy)?.name.split(' ')[0] || 'the Banker')} · ${escapeHtml(fmtDayTime(c.reviewedAt))}</span>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted small">Nothing yet.</td></tr>';

  let running = 0;
  const ordered = [...rows].reverse();
  const withRunning = ordered.map(l => ({ ...l, running: (running += l.points) })).reverse();
  wrap.querySelector('#rows').innerHTML = withRunning.map(l => `<li>
      <span class="what"><b>${escapeHtml(l.note)}</b>
        <span class="meta">${escapeHtml(KIND_LABEL[l.kind] || l.kind)} · ${escapeHtml(fmtDayTime(l.at))}${l.by ? ` · ${escapeHtml(store.member(l.by)?.name.split(' ')[0] || '')}` : ''}${l.expiresAt ? ` · expires ${escapeHtml(fmtDay(l.expiresAt))}` : ''}</span></span>
      <span class="delta"><b class="${l.points > 0 ? 'pos' : 'neg'}">${l.points > 0 ? '+' : ''}${Math.round(l.points).toLocaleString('en-US')}</b>
        <small>balance ${Math.round(l.running).toLocaleString('en-US')}</small></span></li>`).join('')
    || '<li><span class="what"><b>No lines yet</b><span class="meta">Your first confirmed contribution will appear here with its split.</span></span></li>';

  wrap.querySelector('#month-pick').addEventListener('change', (e) => { location.hash = e.target.value ? `#/ledger/${e.target.value}` : '#/ledger'; });
  wrap.querySelector('#print').addEventListener('click', () => window.print());
  wrap.querySelector('#csv').addEventListener('click', () => {
    const csv = toCsv(withRunning, [
      { label: 'Date', value: (r) => fmtDayTime(r.at) }, { label: 'Kind', value: (r) => KIND_LABEL[r.kind] || r.kind },
      { label: 'Description', value: 'note' }, { label: 'Points', value: 'points' },
      { label: 'US$', value: (r) => (r.points / s.pointsPerDollar).toFixed(2) }, { label: 'Running balance', value: 'running' },
    ]);
    downloadText(`${VOCAB.clubName.toLowerCase()}-ledger-${me.name.split(' ')[0].toLowerCase()}${month ? `-${month}` : ''}.csv`, `﻿${csv}`, 'text/csv;charset=utf-8');
  });
  return wrap;
}

export function card({ store }) {
  const me = store.me, s = store.settings;
  const lt = store.lifetime(me.id);
  const wrap = el(`<div class="nocturne" style="background:var(--ground);color:var(--ink);min-height:100vh">
    <section class="sec"><div class="wrap" style="max-width:520px">
      <p class="eyebrow">${escapeHtml(tierName(me.monthlyUsd))} · ${escapeHtml(VOCAB.clubName)}</p>
      <h1 style="font-size:1.6rem;margin-top:6px">Your card</h1>
      <div id="card" style="margin-top:20px"></div>
      <p class="small muted" style="margin-top:12px">Tap the card to turn it over. The face carries no numbers — everything else is in the app.</p>
      <div class="panel" style="margin-top:20px">
        <div class="row-between"><span class="small muted">Available</span><b class="num">${escapeHtml(fmtPoints(lt.available))}</b></div>
        <div class="row-between" style="margin-top:8px"><span class="small muted">Worth</span><b class="num">${escapeHtml(pointsUsd(lt.available, s.pointsPerDollar))}</b></div>
        <div class="row-between" style="margin-top:8px"><span class="small muted">Insider since</span><b class="num">${escapeHtml(fmtDay(me.joinedAt))}</b></div>
        <div class="row-between" style="margin-top:8px"><span class="small muted">Card code</span><b class="num">${escapeHtml(me.cardCode || '—')}</b></div>
      </div>
      <div class="panel" style="margin-top:16px;display:grid;gap:12px;justify-items:center">
        <p class="eyebrow">For the Desk</p>
        <div class="qr-holder" id="qr"></div>
        <p class="tiny muted" style="text-align:center">Victor and Ian scan this to pull up your account at a hotel desk.</p>
      </div>
      <p style="margin-top:18px"><a class="btn ghost" href="#/home">Back</a></p>
    </div></section></div>`);
  wrap.querySelector('#card').appendChild(memberCard(me, { store }));
  import('../ui/qr.js').then(({ renderQr }) => {
    renderQr(wrap.querySelector('#qr'), `${location.origin}${location.pathname}#/circle?c=${encodeURIComponent(me.cardCode || me.id)}`, { size: 148 });
  }).catch(() => { wrap.querySelector('#qr').textContent = me.cardCode || ''; });
  return wrap;
}

export function profile({ store, go, refresh }) {
  const me = store.me, s = store.settings;
  const exit = store.exitQuote(me.id);
  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:820px">
      <p class="eyebrow">${escapeHtml(tierName(me.monthlyUsd))} Insider${me.founding ? ` · ${escapeHtml(VOCAB.founding)}` : ''}</p>
      <h1>${escapeHtml(me.name)}</h1>
      <p class="lede" style="margin-top:10px">${escapeHtml(me.title || `${fmtUsd2(me.monthlyUsd)} a month · joined ${fmtDay(me.joinedAt)}`)}</p>

      <div class="panel" style="margin-top:22px">
        <h2>Your contribution level</h2>
        <p class="small muted" style="margin-top:6px">A change takes effect on your next contribution. Nothing you already hold is affected.</p>
        <div class="choices" id="tiers" style="margin-top:14px"></div>
      </div>

      <div class="panel" style="margin-top:16px">
        <h2>Details</h2>
        <form id="details" style="margin-top:12px">
          <div class="grid g2">
            <label class="field"><span>Name</span><input name="name" value="${escapeHtml(me.name)}" required></label>
            <label class="field"><span>Phone</span><input name="phone" value="${escapeHtml(me.phone || '')}" placeholder="+297 000 0000"></label>
          </div>
          <label class="field"><span>Your dream stay</span><select name="dreamStayId">
            ${store.arubaStays().map(st => `<option value="${st.id}"${st.id === me.dreamStayId ? ' selected' : ''}>${escapeHtml(st.name)}</option>`).join('')}</select>
            <span class="hint">This is the one your home screen counts nights toward.</span></label>
          <label class="row" style="gap:10px;align-items:flex-start;margin-bottom:12px"><input type="checkbox" name="standingOrder" ${me.standingOrder ? 'checked' : ''} style="width:20px;height:20px;margin-top:2px">
            <span class="small">I have a standing order set for the ${s.dueDay}th.</span></label>
          <label class="row" style="gap:10px;align-items:flex-start;margin-bottom:12px"><input type="checkbox" name="showOnRollcall" ${me.showOnRollcall ? 'checked' : ''} style="width:20px;height:20px;margin-top:2px">
            <span class="small">Show my name on the monthly roll call. <span class="muted">Off by default; only the count is public.</span></span></label>
          <button class="btn" type="submit">Save</button>
        </form>
      </div>

      <div class="panel" style="margin-top:16px">
        <h2>Pausing and leaving</h2>
        <p class="small muted" style="margin-top:6px">Both are yours to do, whenever you like. Neither costs you the points you hold.</p>
        <div class="row" style="margin-top:14px">
          ${me.status === 'paused'
            ? `<button class="btn ghost" id="resume">Resume contributing</button>`
            : `<button class="btn ghost" id="pause">Pause for a few months</button>`}
          <button class="btn danger" id="leave">Leave the Circle</button>
        </div>
        <p class="small muted" style="margin-top:12px">If you left today you hold ${escapeHtml(fmtPoints(exit.basePoints))} base points. After a twelve-month window to use them, ${escapeHtml(fmtUsd2(exit.basePoints / s.pointsPerDollar))} − ${escapeHtml(fmtUsd2(exit.feeUsd))} = <b>${escapeHtml(fmtUsd2(exit.refundUsd))}</b> comes back to you. ${escapeHtml(fmtPoints(exit.promoPoints))} of bonus points and the Circle’s share are not refunded.</p>
      </div>

      <div class="panel" style="margin-top:16px">
        <h2>Your data</h2>
        <p class="small muted" style="margin-top:6px">In the demo everything lives in this browser, and Safari clears it after about a week of not visiting. Keep a copy if you want it to survive.</p>
        <div class="row" style="margin-top:12px">
          <button class="btn ghost sm" id="export">Export everything as JSON</button>
          <button class="btn quiet sm" id="signout">Sign out</button>
        </div>
      </div>
    </div></section></div>`);

  wrap.querySelector('#tiers').innerHTML = s.tiers.map(t => `<button type="button" class="choice" aria-pressed="${t.monthlyUsd === me.monthlyUsd}" data-amt="${t.monthlyUsd}">
      <span class="amt">$${t.monthlyUsd}</span><span class="tier">${escapeHtml(tierName(t.monthlyUsd))} ${treeSvg(VOCAB.tierLean[t.monthlyUsd], { size: 14 })}</span>
      <span class="tiny muted">${t.holds} open request${t.holds > 1 ? 's' : ''} · ${t.guestCerts} guest passes · ${t.windowMonths} months ahead</span></button>`).join('');
  wrap.querySelector('#tiers').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-amt]'); if (!b) return;
    const amt = Number(b.dataset.amt); if (amt === me.monthlyUsd) return;
    await store.updateMember(me.id, { monthlyUsd: amt }, me.id);
    toast(`${VOCAB.pap.congrats[0]}! From your next contribution you are ${tierName(amt)}.`, { kind: 'good' });
  });
  wrap.querySelector('#details').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    await store.updateMember(me.id, { name: f.get('name'), phone: f.get('phone'), dreamStayId: f.get('dreamStayId'), standingOrder: !!f.get('standingOrder'), showOnRollcall: !!f.get('showOnRollcall') }, me.id);
    toast('Saved.', { kind: 'good' });
  });
  wrap.querySelector('#pause')?.addEventListener('click', async () => {
    const until = await sheet({ title: 'Pause your contributions', render: (body, close) => {
      body.innerHTML = `<p class="sheet-text">Up to three months. Your streak freezes at ${store.streak(me.id)} rather than resetting, and everything you hold stays usable.</p>
        <label class="field"><span>Resume from</span><select name="until">${[1, 2, 3].map(n => { const d = new Date(); d.setMonth(d.getMonth() + n); const m = monthKey(d); return `<option value="${m}">${escapeHtml(fmtMonth(m))}</option>`; }).join('')}</select></label>
        <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>Pause</button></div>`;
      body.querySelector('[data-ok]').addEventListener('click', () => close(body.querySelector('select').value));
    } });
    if (until) { await store.pauseMember(me.id, until, me.id); toast(`Paused until ${fmtMonth(until)}. Your streak is frozen, not reset.`); }
  });
  wrap.querySelector('#resume')?.addEventListener('click', async () => { await store.resumeMember(me.id, me.id); toast('Welcome back.', { kind: 'good' }); });
  wrap.querySelector('#leave').addEventListener('click', async () => {
    const yes = await confirmDialog({ title: 'Leave the Circle?', danger: true, confirmText: 'Give notice',
      message: `You hold ${fmtPoints(exit.basePoints)} base points. You have twelve months to use them on stays; after that ${fmtUsd2(exit.refundUsd)} comes back to you. Bonus points and the 15% share are not refunded. Ian will be in touch.` });
    if (yes) { await store.leaveMember(me.id, me.id); toast('Notice given. Ian will be in touch this week.'); go('/home'); }
  });
  wrap.querySelector('#export').addEventListener('click', () => downloadText(`${VOCAB.clubName.toLowerCase()}-backup.json`, store.exportJson(), 'application/json'));
  wrap.querySelector('#signout').addEventListener('click', async () => { await store.signOut(); toast(`${VOCAB.pap.bye[0]} · ${VOCAB.pap.bye[1]}`); go('/'); });
  return wrap;
}
