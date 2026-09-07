// The member's own screens: home, sending a contribution, the ledger, the card, the profile.
import { escapeHtml, fmtUsd2, fmtAfl2, fmtPoints, fmtPointsUsd, pointsUsd, fmtDay, fmtDayTime, fmtMonth, fmtPct, monthKey, countdownTo, initials, toCsv, downloadText } from '../core/util.js';
import { RANKS, nextRank } from '../core/standing.js';
import { VOCAB, tierName, refFor } from '../core/vocab.js';
import { splitContribution, tierFor, fromPoints, seatPoints, pointsPerMonth } from '../core/money.js';
import { memberCard, poolGauge, rankCrest, ring, tierLadder, badgeMark, badgeRow } from '../ui/pieces.js';
import { treeSvg } from '../ui/art.js';
import { toast, sheet, confirmDialog, setBusy, chip, countUp, statusLabel, avatar } from '../ui/components.js';
import { sparkline, columns, tableFor } from '../ui/charts.js';
import { waLink, TEMPLATES, copyText, shareText } from '../core/share.js';
import { icon } from '../ui/icons.js';
import { shiftMonth } from '../core/store.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const KIND_LABEL = { earn: 'Contribution', bonus: 'Tier bonus', streak: 'Streak bonus', founding: 'Founding bonus', burn: 'Stay', refund: 'Refund', adjust: 'Adjustment', expire: 'Expired', reverse: 'Reversal' };
// One glyph per kind of officer work, so the Home list reads at a glance.
const WORK_ICON = { bank: 'vault', close: 'scale', quote: 'send', logins: 'key' };

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

  // 1 — what the points are actually worth, in nights, before anything else.
  //
  // This screen used to open on "✦ 28,850" in the biggest type on the page. Nobody holds a
  // conversion rate in their head: a member wants to know whether they can go somewhere, and
  // the app knew the answer and never said it. The five-digit figure is still here — it is
  // just no longer the headline, because it is not the question.
  const book = store.canBookNow(me.id);
  const bookLine = !book ? ''
    : book.can
      ? `<p class="eyebrow">${icon('bed')}What you can book today</p>
         <h1 class="book-now">${book.nights}${book.capped ? '+' : ''} night${book.nights === 1 ? '' : 's'} at<br>${escapeHtml(book.stay.name)}</h1>
         <p class="small muted" style="margin-top:8px">At its cheapest, all in. Pick your dates and the Desk prices those nights exactly.</p>
         <div class="row" style="margin-top:14px">
           <a class="btn" href="#/book/${escapeHtml(book.stay.id)}">${icon('send', { size: 17 })}Ask for these dates</a>
           <a class="btn ghost" href="#/stays">${icon('bed', { size: 17 })}Other places</a>
         </div>`
      : `<p class="eyebrow">${icon('bed')}The first thing within reach</p>
         <h1 class="book-now">${book.nights} night${book.nights === 1 ? '' : 's'} at<br>${escapeHtml(book.stay.name)}</h1>
         <p class="small muted" style="margin-top:8px"><b class="num">${escapeHtml(fmtPoints(book.short))}</b> to go — about ${book.months} more month${book.months === 1 ? '' : 's'} at ${escapeHtml(fmtUsd2(me.monthlyUsd))}. You can ask for it before then and close the gap in cash.</p>
         <div class="row" style="margin-top:14px">
           <a class="btn" href="#/pay">${icon('arrowUp', { size: 17 })}Send a contribution</a>
           <a class="btn ghost" href="#/stays">${icon('bed', { size: 17 })}Other places</a>
         </div>`;

  const top = el(`<div class="panel">
      <div class="card-strip">
        <a href="#/card" style="width:132px;display:block" aria-label="Open your card"><span id="mini-card"></span></a>
        <div>
          <h2 style="font-size:1.05rem;letter-spacing:.01em"><span lang="pap" class="pap">${escapeHtml(VOCAB.pap.welcome[0])}</span>, ${escapeHtml(me.name.split(' ')[0])}</h2>
          <p class="small muted" style="margin-top:6px"><b class="num" id="avail">0</b> <span id="avail-usd"></span></p>
          <div id="balbar" style="margin-top:12px"></div>
        </div>
      </div>
      <div class="book-lead">${bookLine}</div>
      <div class="row" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--hairline-soft)">
        ${book?.can === false ? '' : `<a class="btn ghost sm" href="#/pay">${icon('arrowUp', { size: 16 })}Send a contribution</a>`}
        <a class="btn quiet sm" href="#/ledger">${icon('receipt', { size: 16 })}Statement</a>
      </div>
    </div>`);
  left.appendChild(top);
  top.querySelector('#mini-card').replaceChildren(memberCard(me, { store, flippable: false, compact: true }));
  countUp(top.querySelector('#avail'), lt.available, { format: (n) => `✦ ${Math.round(n).toLocaleString('en-US')}` });
  top.querySelector('#avail-usd').textContent = `· ${pointsUsd(lt.available, s.pointsPerDollar)} of hotel${lt.committed ? ` · ${fmtPoints(lt.committed)} committed` : ''}`;
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

  // 1a — what being in the Circle has been worth, in dollars, from real bookings.
  //
  // "I want people to see their savings real price vs what on the page so they appreciate being
  // a member." It only appears once there is a paid booking to build it from: a savings panel
  // reading $0.00 on somebody's first week is the opposite of the intended feeling, and an
  // estimate would make the number worthless on the day it finally matters.
  {
    const sv = store.savingsFor(me.id);
    if (sv.trips) {
      const good = sv.savedUsd > 0;
      left.appendChild(el(`<div class="panel">
        <div class="row-between"><p class="eyebrow">${icon('trend')}What the Circle has saved you</p>
          <a class="small" href="#/ledger">Every line</a></div>
        <p class="big-figure num" style="color:${good ? 'var(--good-text)' : 'var(--ink)'}">${escapeHtml(fmtUsd2(Math.abs(sv.savedUsd)))}</p>
        <p class="small muted" style="margin-top:4px">${good
          ? `across ${sv.trips} booking${sv.trips === 1 ? '' : 's'} — ${escapeHtml(fmtUsd2(sv.publicUsd))} of hotel for ${escapeHtml(fmtUsd2(sv.oursUsd))}, ${sv.pct}% off the public rate`
          : `${escapeHtml(fmtUsd2(sv.oursUsd))} against a public ${escapeHtml(fmtUsd2(sv.publicUsd))} — the Circle has cost you more so far, and it says so`}</p>
        <ul class="ledger" style="margin-top:14px">
          ${sv.lines.slice(0, 3).map(l => `<li>
            <span class="what"><b>${escapeHtml(l.stayName)}</b><span class="meta">${l.nights} night${l.nights === 1 ? '' : 's'} · booked alone ${escapeHtml(fmtUsd2(l.publicUsd))}</span></span>
            <span class="delta"><b class="${l.savedUsd > 0 ? 'pos' : ''}">${l.savedUsd >= 0 ? '' : '+'}${escapeHtml(fmtUsd2(Math.abs(l.savedUsd)))}</b><small>${l.savedUsd >= 0 ? 'saved' : 'more than direct'} · paid ${escapeHtml(fmtUsd2(l.oursUsd))}</small></span></li>`).join('')}
        </ul>
        <p class="small muted" style="margin-top:10px">Against the public rate for the same nights, taken when you asked for them. ${sv.paidIn ? `You have put in ${escapeHtml(fmtUsd2(sv.paidIn))} altogether.` : ''}</p>
      </div>`));
    }
  }

  // 1b — anything the Circle is waiting on you for, if you hold a job
  const jobs = store.officerWork();
  if (jobs.length) {
    left.appendChild(el(`<div class="panel job-panel">
      <div class="row-between">
        <p class="eyebrow">${icon('crown')}Waiting on you</p>
        <a class="small" href="#/profile">Your jobs</a>
      </div>
      <ul class="job-list" style="margin-top:12px">${jobs.map(j => `
        <li${j.urgent ? ' class="urgent"' : ''}>
          <a href="${escapeHtml(j.href)}">
            <span class="job-ico">${icon(WORK_ICON[j.id] || 'clipboard', { size: 19 })}</span>
            <span class="job-what"><b>${escapeHtml(j.what)}</b><span class="small muted">${escapeHtml(j.why)}</span></span>
            ${icon('chevronRight', { size: 18, cls: 'ico-muted' })}
          </a>
        </li>`).join('')}</ul>
    </div>`));
  }

  // 2 — what you are saving for, and exactly how far off it is
  const goalPanel = el(`<div class="panel" id="goal-panel"></div>`);
  left.appendChild(goalPanel);
  const drawGoal = () => {
    const g = store.goalFor(me.id);
    if (!g) {
      goalPanel.innerHTML = `
        <p class="eyebrow">${icon('target')}What you are saving for</p>
        <h2 style="font-size:1.15rem;margin-top:8px">Pick something and watch it come closer</h2>
        <p class="small muted" style="margin-top:8px">Every contribution moves a bar instead of a number. Choose a place and how many nights, and the app works out how many months it takes at your level — and what would get you there sooner.</p>
        <div class="row" style="margin-top:14px">
          <button class="btn sm" id="set-goal">${icon('target', { size: 16 })}Choose one</button>
          <a class="btn ghost sm" href="#/stays">Look at the places</a>
        </div>`;
      return;
    }
    const pct = Math.round(g.pct * 100);
    const others = g.ways.filter(w => !w.mine && w.months < g.months);
    goalPanel.innerHTML = `
      <div class="row-between"><p class="eyebrow">${icon('target')}What you are saving for</p>
        <button class="btn quiet sm" id="set-goal">${icon('edit', { size: 15 })}Change</button></div>
      <h2 style="font-size:1.2rem;margin-top:10px">${escapeHtml(g.stay.name)}</h2>
      <p class="small muted" style="margin-top:4px">${g.isTrip
        ? `A seat · ${g.nights} nights · ${escapeHtml(fmtDay(g.stay.dates.from))}`
        : `${g.nights} night${g.nights === 1 ? '' : 's'} · from ${escapeHtml(fmtPointsUsd(g.target, s.pointsPerDollar))}`}</p>

      <div class="goal-bar" style="margin-top:16px" role="img"
           aria-label="${fmtPoints(g.have)} of ${fmtPoints(g.target)}, ${pct} per cent of the way">
        <span style="width:${pct}%"></span>
        <b class="goal-pct">${pct}%</b>
      </div>
      <div class="row-between small" style="margin-top:8px">
        <span><b class="num">${escapeHtml(fmtPoints(g.have))}</b> <span class="muted">you hold</span></span>
        <span class="muted">of ${escapeHtml(fmtPoints(g.target))} · ${escapeHtml(pointsUsd(g.target, s.pointsPerDollar))}</span>
      </div>

      ${g.short === 0
        ? `<div class="notice good" style="margin-top:14px"><b>${icon('checkCircle', { size: 16 })} You can ask for this now</b>
             <p class="small">The points are there. Victor quotes it, and it is held the moment you accept.</p>
             <p style="margin-top:10px"><a class="btn sm" href="#/book/${escapeHtml(g.stay.id)}">${icon('send', { size: 15 })}Ask for it</a></p></div>`
        : `<div class="notice" style="margin-top:14px">
             <b>${escapeHtml(fmtPoints(g.short))} to go</b>
             <p class="small" style="margin-top:6px">At ${escapeHtml(fmtUsd2(me.monthlyUsd))} a month you earn ${escapeHtml(fmtPoints(g.perMonth))}, so that is
               <b>${g.months} more month${g.months === 1 ? '' : 's'}</b> — around ${escapeHtml(fmtMonth(shiftMonth(monthKey(), g.months)))}.</p>
             <ul class="stack" style="margin-top:10px;padding-left:1.1em;gap:6px">
               <li class="small muted">${escapeHtml(fmtUsd2(g.topUpUsd))} as a cash top-up closes it today — at face value, the Circle's share is already in the quote</li>
               ${others.length ? `<li class="small muted">At ${escapeHtml(fmtUsd2(others[0].monthlyUsd))} a month it would be ${others[0].months} months instead of ${g.months} · <a href="#/profile">change your level</a></li>` : ''}
               <li class="small muted">Or ask for it anyway and open it to the Circle — others put their own points in</li>
             </ul>
           </div>`}
      <p class="small muted" style="margin-top:12px">${icon('bell', { size: 14, cls: 'ico-muted' })}
        <a href="#/watching">Tell the Desk you want it</a> and you hear the moment one comes free.</p>`;
  };
  drawGoal();
  goalPanel.addEventListener('click', async (e) => {
    if (!e.target.closest('#set-goal')) return;
    const picked = await goalSheet({ store });
    if (picked === CLEAR_GOAL) { await store.setGoal(me.id, null, me.id); drawGoal(); }
    else if (picked?.stayId) { await store.setGoal(me.id, picked, me.id); drawGoal(); }
  });

  // 3 — what needs you, in the order it needs you
  const blocks = [];
  // A deal that answers something you asked for goes above everything else: these go fast.
  for (const m of store.matchesForMember(me.id).slice(0, 3)) {
    const st = store.stay(m.deal.stayId);
    const room = store.roomType(m.deal.roomTypeId);
    blocks.push(`<div class="notice good"><b>${icon('bellRing', { size: 16 })} ${escapeHtml(st?.name || 'A place you asked for')} came free</b>
      <p class="small">${room ? `${escapeHtml(room.name)} · ` : ''}${m.deal.nights} nights from ${escapeHtml(fmtDay(m.deal.from))} · ${escapeHtml(fmtPoints(m.deal.pointsTotal))}.
      ${m.affordable ? 'You have the points.' : `You are ${escapeHtml(fmtPoints(m.short))} short — ask anyway and close it with a top-up.`}</p>
      <p style="margin-top:8px"><a class="btn sm" href="#/deals">${icon('eye', { size: 15 })}Look at it</a></p></div>`);
  }
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
    const pct = target ? Math.min(1, store.coveredPoints(r) / target) : 0;
    blocks.push(`<div class="notice ask">
      <div class="row" style="gap:11px;align-items:flex-start;flex-wrap:nowrap">
        ${avatar(owner, 40)}
        <div style="min-width:0;flex:1">
          <b>${escapeHtml(owner?.name.split(' ')[0] || 'An Insider')} is ${escapeHtml(fmtPoints(gap))} short for ${escapeHtml(st?.name || 'a stay')}</b>
          <p class="small muted" style="margin-top:3px">${r.nights} nights from ${escapeHtml(fmtDay(r.checkIn))}. Anyone can put their own points in — yours are committed only until it is booked or falls through.</p>
          <div class="goal-bar" style="margin-top:10px" role="img"
            aria-label="${escapeHtml(fmtPct(pct))} of the way there"><span style="width:${(pct * 100).toFixed(1)}%"></span></div>
          <p class="tiny muted" style="margin-top:6px">${escapeHtml(fmtPoints(store.coveredPoints(r)))} of ${escapeHtml(fmtPoints(target))} together — ${escapeHtml(fmtPct(pct))} there</p>
          <p style="margin-top:10px"><a class="btn sm" href="#/requests/${r.id}">${icon('chipIn', { size: 15 })}Chip in</a></p>
        </div>
      </div></div>`);
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
  const myStanding = store.standingOf(me.id);
  const nextUp = nextRank(myStanding?.monthsHeld ?? 0);
  right.appendChild(el(`<div class="panel">
      <div class="row-between"><p class="eyebrow">${icon('crown')}Your standing</p>
        <a class="small" href="#/profile">Your corner</a></div>
      <div id="crest-slot" style="margin-top:10px"></div>
      <p class="small muted" style="margin-top:8px">${escapeHtml(
        nextUp ? `${nextUp.months - (myStanding?.monthsHeld ?? 0)} more month${nextUp.months - (myStanding?.monthsHeld ?? 0) === 1 ? '' : 's'} to ${nextUp.name}.`
               : 'Nothing above this one.')} ${escapeHtml(RANKS[myStanding?.rankIndex ?? 0].unlocks)}</p>
      <hr class="rule" style="margin:14px 0">
      <div class="row" style="gap:11px;margin-top:10px;align-items:flex-start;flex-wrap:nowrap">
        <span style="flex:none;margin-top:-4px">${treeSvg(VOCAB.tierLean[me.monthlyUsd], { size: 30 })}</span>
        <div style="min-width:0"><b>${escapeHtml(tierName(me.monthlyUsd))}</b> · ${escapeHtml(fmtUsd2(me.monthlyUsd))} a month
        <br><span class="small muted">${escapeHtml(fmtPointsUsd(store.lifetime(me.id).balance, s.pointsPerDollar))} held${me.founding ? ` · ${escapeHtml(VOCAB.founding)}` : ''}</span></div>
      </div>
      <p class="small" style="margin-top:14px"><b class="num">${streak}</b> consecutive contribution${streak === 1 ? '' : 's'}${next ? ` · ${next - streak} more to the ${next}-month bonus of ${fmtPoints(s.streakBonuses[next])}` : ''}.</p>
      <div style="margin-top:12px">${sparkSlot()}</div>
    </div>`));
  right.querySelector('#crest-slot')?.replaceChildren(
    rankCrest(myStanding, { size: 54, sub: `${myStanding?.monthsHeld ?? 0} month${(myStanding?.monthsHeld ?? 0) === 1 ? '' : 's'} in the Circle` }));
  {
    const series = store.balanceSeries(me.id).map(p => p.points);
    right.querySelector('.spark-slot')?.replaceChildren(sparkline(series.length ? series : [0, 0], { height: 46 }));
  }
  right.appendChild(el(`<div class="panel">
      <div class="row-between"><p class="eyebrow">${icon('users')}This month in the Circle</p>
        <a class="small" href="#/circle">Everyone</a></div>
      <div class="row" style="gap:14px;margin-top:12px;align-items:center">
        <span id="rollcall"></span>
        <div class="small"><b>${t.confirmedThisMonth} of ${t.expectedThisMonth}</b> contributions confirmed for ${escapeHtml(fmtMonth(month))}.
        <br><span class="muted">Names stay private unless an Insider opts in.</span></div>
      </div></div>`));
  right.querySelector('#rollcall').replaceChildren(ring({ total: t.expectedThisMonth, filled: t.confirmedThisMonth, size: 76 }));
  const cov = el(`<div class="panel"><p class="eyebrow">${icon('shield')}Proof of reserves</p><div id="cov" style="margin-top:12px"></div>
      <p class="small muted" style="margin-top:10px"><a href="#/pool">The whole Pool</a></p></div>`);
  cov.querySelector('#cov').appendChild(poolGauge({ coverage: t.coverage, reserveUsd: t.reserveUsd, outstandingPoints: t.outstandingPoints, verifiedAt: t.verified?.at, verifiedVarianceUsd: t.verifiedVarianceUsd, configured: t.accountsConfigured }));
  right.appendChild(cov);
  if (note) right.appendChild(el(`<div class="panel"><p class="eyebrow">Note from ${escapeHtml(store.member(note.authorId)?.name.split(' ')[0] || 'Ian')}</p>
      <h3 style="margin-top:8px">${escapeHtml(note.title)}</h3>
      <p class="small muted" style="margin-top:8px">${escapeHtml(note.body.slice(0, 180))}${note.body.length > 180 ? '…' : ''}</p>
      <p class="small" style="margin-top:10px"><a href="#/circle">All the notes</a></p></div>`));
  return wrap;
}

/** The sheet resolves with this when someone asks to stop saving, so it can never be
 *  confused with the undefined that closing or cancelling the sheet gives back. */
const CLEAR_GOAL = Symbol('clear-goal');

/** Choose what you are saving for: a place and how many nights. */
export async function goalSheet({ store }) {
  const s = store.settings;
  const me = store.me;
  const current = me.goal || {};
  const stays = store.arubaStays(), trips = store.trips();
  return sheet({
    title: 'What are you saving for?',
    render: (body, close) => {
      body.innerHTML = `
        <p class="sheet-text">Nothing is reserved and nothing is charged. It is here so that every contribution moves something you actually want, instead of a number.</p>
        <label class="field"><span>Where</span>
          <select name="stayId" required>
            <optgroup label="On the island">${stays.map(x => `<option value="${escapeHtml(x.id)}"${x.id === current.stayId ? ' selected' : ''}>${escapeHtml(x.name)}${x.house ? ' · where we stay' : ''}</option>`).join('')}</optgroup>
            <optgroup label="Trips">${trips.map(x => `<option value="${escapeHtml(x.id)}"${x.id === current.stayId ? ' selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</optgroup>
          </select></label>
        <div class="grid g2" id="stay-only">
          <label class="field"><span>Nights</span><input name="nights" type="number" min="1" max="30" value="${current.nights || 3}" inputmode="numeric"></label>

        </div>
        <div id="prev" class="notice"></div>
        <div class="sheet-actions">
          ${me.goal ? '<button class="btn quiet" data-clear>Stop saving for it</button>' : ''}
          <button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>Set it</button></div>`;
      const v = (n) => body.querySelector(`[name=${n}]`);
      const draw = () => {
        const stay = store.stay(v('stayId').value);
        const isTrip = stay?.kind === 'trip';
        body.querySelector('#stay-only').hidden = isTrip;
        const nights = isTrip ? stay.nights : Math.max(Number(v('nights').value) || 1, stay?.minNights || 1);
        const target = isTrip ? seatPoints(stay, s) : fromPoints(stay, s) * nights;
        const have = Math.max(0, store.availablePoints(me.id));
        const short = Math.max(0, target - have);
        const perMonth = pointsPerMonth(s, me.monthlyUsd);
        const months = short ? Math.ceil(short / perMonth) : 0;
        body.querySelector('#prev').innerHTML = `
          <b>${escapeHtml(fmtPoints(target))} · ${escapeHtml(pointsUsd(target, s.pointsPerDollar))}</b>
          <p class="small" style="margin-top:6px">${short
            ? `You hold ${escapeHtml(fmtPoints(have))}, so ${escapeHtml(fmtPoints(short))} to go — about ${months} month${months === 1 ? '' : 's'} at ${escapeHtml(fmtUsd2(me.monthlyUsd))}.`
            : 'You already hold enough for this. Ask for it whenever you like.'}</p>
          ${stay?.minNights > 1 && !isTrip ? `<p class="small muted" style="margin-top:6px">${escapeHtml(stay.name)} takes a minimum of ${stay.minNights} nights.</p>` : ''}`;
      };
      body.addEventListener('input', draw); body.addEventListener('change', draw); draw();
      body.querySelector('[data-clear]')?.addEventListener('click', () => close(CLEAR_GOAL));
      body.querySelector('[data-ok]').addEventListener('click', () => {
        const stay = store.stay(v('stayId').value);
        close({ stayId: stay.id, nights: stay.kind === 'trip' ? stay.nights : Number(v('nights').value) || 1 });
      });
    },
  });
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
            <div><p class="eyebrow">${icon('tag')}Put this in the description</p>
              <div class="copyline" style="margin-top:6px"><code class="num" style="font-size:1.05rem">${escapeHtml(reference)}</code><button class="btn quiet sm" data-copy="${escapeHtml(reference)}">Copy</button></div></div>
            <p class="small muted">It is how Vishnu matches your transfer against the statement in seconds. Same reference every month, with the month on the end.</p>
          </div>
        </div>
        <p class="small muted" style="margin-top:14px">Florins between local banks land in seconds through I-Pago. A US-dollar transfer can take a business day. Your points follow the amount that actually arrives — bank fees and exchange spread are yours, and the Circle never rounds in its own favour.</p>
      </div>

      <div class="panel" style="margin-top:16px">
        <h2>2 · What it becomes</h2>
        <p class="big-figure num" style="margin-top:12px">${escapeHtml(fmtPoints(sp.points))}</p>
        <p class="lede" style="margin-top:4px">${escapeHtml(fmtUsd2(sp.points / s.pointsPerDollar))} of hotel.</p>
        <p class="small muted" style="margin-top:12px;max-width:56ch">All ${escapeHtml(fmtUsd2(sp.backingUsd))} of it goes into the Reserve and stays there until you spend it on a room${sp.bonusPoints ? ` — and the ${escapeHtml(fmtPoints(sp.bonusPoints))} on top is your ${escapeHtml(tierName(me.monthlyUsd))} bonus, which the Circle funds out of its own share` : ''}. Nothing is taken on the way in; the Circle is paid 15% when you book.</p>
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
            <div class="row"><button class="btn" type="submit">${icon('send', { size: 17 })}I sent it</button>
              <a class="btn ghost" id="wa" target="_blank" rel="noopener" href="${escapeHtml(waLink(store.member('mem_vishnu')?.phone || '', TEMPLATES.transferSent({ member: me, amountUsd: me.monthlyUsd, month, reference })))}">Message Vishnu</a></div>
          </form>`}
      </div>

      <p class="small muted" style="margin-top:18px">Prefer not to think about it? Set a standing order for the ${s.dueDay}th — Aruba Bank and Banco di Caribe both do it free, online — and put the reference in the description once. <a href="#/profile">Mark yourself on autopilot</a>.</p>
    </div></section></div>`);
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
        // The file itself, not just its name: the Supabase backend uploads it to storage and
        // the local one keeps it as a data URL. Sending only the name meant every transfer
        // screenshot a member attached was accepted by the form and then dropped.
        note: f.get('note'), sentOn: f.get('sentOn'), proofFile: file || null, proofName: file?.name || '',
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
        <div class="stat"><span class="k">Into the Reserve</span><b class="num">${escapeHtml(fmtUsd2(lt.backingUsd ?? lt.paidUsd))}</b><span class="sub">Every dollar you have sent</span></div>
        <div class="stat"><span class="k">Backing + bonuses</span><b class="num">${escapeHtml(fmtUsd2(lt.backingUsd + lt.promoPoints / s.pointsPerDollar))}</b><span class="sub">${escapeHtml(fmtPoints(lt.promoPoints))} of that is bonus points</span></div>
        <div class="stat"><span class="k">Available now</span><b class="num">${escapeHtml(fmtPoints(lt.available))}</b><span class="sub">${escapeHtml(pointsUsd(lt.available, s.pointsPerDollar))}${lt.committed ? ` · ${fmtPoints(lt.committed)} committed` : ''}</span></div>
      </div>
      <p class="small muted" style="margin-top:12px">You have turned ${escapeHtml(fmtUsd2(lt.paidUsd))} into ${escapeHtml(fmtUsd2(lt.balance / s.pointsPerDollar + lt.burnedPoints / s.pointsPerDollar))} of hotel so far — every dollar backed a point, and the bonuses are on top. Committed points still count against the Circle’s coverage until they are burned.</p>

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

  const contribs = store.contributionsFor(me.id).filter(c => !month || c.forMonth === month || (c.extra && (c.reviewedAt || '').slice(0, 7) === month));
  wrap.querySelector('#contrib-rows').innerHTML = contribs.map(c => `<tr>
      <td>${c.extra ? 'Extra' : escapeHtml(fmtMonth(c.forMonth))}<br><span class="small muted num">${escapeHtml(c.reference || (c.extra ? c.note || 'handed over' : '—'))}</span></td>
      <td class="num">${escapeHtml(fmtUsd2(c.expectedUsd))}</td>
      <td class="num">${c.receivedUsd == null ? '—' : escapeHtml(fmtUsd2(c.receivedUsd))}</td>
      <td style="min-width:150px">${c.status === 'confirmed' ? `<div class="split drawn" style="--cut:100%"><i style="width:100%"></i></div><span class="small muted num">${escapeHtml(fmtUsd2(c.backingUsd))} to the Reserve</span>` : '<span class="small muted">—</span>'}</td>
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

export function card({ store, go }) {
  const me = store.me, s = store.settings;
  const lt = store.lifetime(me.id);
  const tier = tierFor(s, me.monthlyUsd);
  const wrap = el(`<div class="nocturne" style="background:var(--ground);color:var(--ink);min-height:100vh">
    <section class="sec"><div class="wrap" style="max-width:560px">
      <p class="eyebrow">${escapeHtml(tierName(me.monthlyUsd))} · ${escapeHtml(VOCAB.clubName)}</p>
      <h1 style="font-size:1.6rem;margin-top:6px">Your card</h1>
      <div id="card" style="margin-top:20px"></div>
      <p class="small muted" style="margin-top:12px">Tap the card to turn it over. The face carries no numbers — a card someone can read your balance off is a card you cannot leave on a table.</p>

      <div class="panel" style="margin-top:20px;display:grid;gap:14px;justify-items:center">
        <p class="eyebrow">${icon('idCard')}Scan to identify you</p>
        <div class="qr-holder" id="qr"></div>
        <p class="tiny muted" style="text-align:center;max-width:34ch">Any phone camera reads it. It opens your entry in the Circle, so Victor or Ian can pull you up at a hotel desk without asking your surname twice.</p>
      </div>

      <div class="panel" style="margin-top:16px">
        <p class="eyebrow">${icon('idCard')}Keep it on your phone</p>
        <div class="stack" style="margin-top:12px">
          <button class="btn block" id="install">Put Hunto on your home screen</button>
          <button class="btn ghost block" id="save">Save the card to your photos</button>
          <button class="btn ghost block" id="print">Print it, card sized</button>
          <button class="btn ghost block" id="share">Send it to someone</button>
          <button class="btn ghost block" id="wallet" hidden>Add to Apple Wallet</button>
        </div>
        <p class="small muted" id="wallet-note" style="margin-top:12px"></p>
      </div>

      <div class="panel" style="margin-top:16px">
        <div class="row-between"><span class="small muted">Available</span><b class="num">${escapeHtml(fmtPoints(lt.available))}</b></div>
        <div class="row-between" style="margin-top:8px"><span class="small muted">Worth</span><b class="num">${escapeHtml(pointsUsd(lt.available, s.pointsPerDollar))}</b></div>
        <div class="row-between" style="margin-top:8px"><span class="small muted">Earning</span><b class="num">${escapeHtml(fmtPoints(pointsPerMonth(s, me.monthlyUsd)))} a month</b></div>
        <div class="row-between" style="margin-top:8px"><span class="small muted">Insider since</span><b class="num">${escapeHtml(fmtDay(me.joinedAt))}</b></div>
        <div class="row-between" style="margin-top:8px"><span class="small muted">Card code</span><b class="num">${escapeHtml(me.cardCode || '—')}</b></div>
      </div>
      <p style="margin-top:18px"><a class="btn ghost" href="#/home">Back</a></p>
    </div></section></div>`);
  wrap.querySelector('#card').appendChild(memberCard(me, { store }));

  import('../ui/wallet.js').then(async (W) => {
    import('../ui/qr.js').then(({ renderQr }) => renderQr(wrap.querySelector('#qr'), W.cardUrl(me), { size: 224 }))
      .catch(() => { wrap.querySelector('#qr').textContent = me.cardCode || ''; });

    const note = wrap.querySelector('#wallet-note');
    const walletBtn = wrap.querySelector('#wallet');
    const installBtn = wrap.querySelector('#install');
    // Apple Wallet only appears once the club actually holds a signing certificate. A button
    // that cannot do the thing it says is worse than no button, and this one sat at the top of
    // the list telling everybody who pressed it to go and read a README.
    const configured = !!store.walletConfig?.()?.url;
    walletBtn.hidden = !configured;

    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
    if (standalone) {
      installBtn.hidden = true;
      note.textContent = 'Hunto is already on your home screen, so the card is one tap away — no pass needed.';
    } else if (W.isIOS()) {
      note.innerHTML = 'On an iPhone this is two taps and it is free: the <b>share</b> button at the bottom of Safari, then <b>Add to Home Screen</b>. Hunto then opens like an app and the card is one tap away, with the QR always current — which a printed pass never is.';
    } else {
      note.textContent = 'It opens like an app, works offline, and the card is one tap away — with the QR always current, which a saved picture is not.';
    }
    if (configured) note.textContent += ' A Wallet pass is also available below.';

    installBtn.addEventListener('click', async () => {
      // Chrome and Edge can do this properly. Everyone else gets told exactly which taps.
      const outcome = await (window.__huntoInstall?.() ?? null);
      if (outcome === 'accepted') { toast('Added. Hunto is on your home screen.', { kind: 'good' }); installBtn.hidden = true; return; }
      if (outcome === 'dismissed') return;
      await sheet({ title: 'Put Hunto on your home screen', render: (body, close) => {
        body.innerHTML = W.isIOS()
          ? `<p class="sheet-text">Two taps, and it costs nothing.</p>
             <ol class="stack" style="gap:10px;padding-left:1.2em">
               <li>Tap the <b>share</b> button — the square with the arrow, at the bottom of Safari.</li>
               <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
               <li>Tap <b>Add</b>.</li>
             </ol>
             <p class="small muted" style="margin-top:14px">It has to be Safari — Chrome on an iPhone cannot do this. Once it is there, Hunto opens full screen and your card is one tap away.</p>
             <div class="sheet-actions"><button class="btn" data-close>Got it</button></div>`
          : `<p class="sheet-text">Open your browser's menu and choose <b>Install</b> or <b>Add to Home screen</b>. Hunto then opens like an app, and your card is one tap away.</p>
             <div class="sheet-actions"><button class="btn" data-close>Got it</button></div>`;
      } });
    });

    walletBtn.addEventListener('click', async () => {
      if (!configured) return;
      setBusy(walletBtn, true, 'Making your pass…');
      try {
        const blob = await W.fetchApplePass(store, me);
        if (!blob) throw new Error('No pass came back.');
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: `${VOCAB.clubName.toLowerCase()}-${me.cardCode || 'card'}.pkpass` });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        toast('Wallet should offer to add it. If nothing happens, open this page in Safari.', { kind: 'good', timeout: 7000 });
      } catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); }
      setBusy(walletBtn, false);
    });

    wrap.querySelector('#save').addEventListener('click', async () => {
      const blob = await W.cardImage(me);
      const file = new File([blob], `${VOCAB.clubName.toLowerCase()}-card.png`, { type: 'image/png' });
      // On iOS the share object must contain nothing but `files`, or the sheet never opens.
      if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch { /* fall through to a download */ } }
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(W.isIOS() ? 'Long-press the image to save it to your photos.' : 'Saved.', { kind: 'good' });
    });

    wrap.querySelector('#print').addEventListener('click', async () => {
      const blob = await W.cardImage(me);
      const url = URL.createObjectURL(blob);
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      frame.srcdoc = `<style>@page{size:85.6mm 53.98mm;margin:0}html,body{margin:0;padding:0}
        img{width:85.6mm;height:53.98mm;display:block}</style><img src="${url}" alt="">`;
      frame.addEventListener('load', () => {
        frame.contentWindow.focus(); frame.contentWindow.print();
        setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 30000);
      });
      document.body.appendChild(frame);
    });

    wrap.querySelector('#share').addEventListener('click', () => shareText({
      title: `${VOCAB.clubName} · ${me.name}`,
      text: `${me.name} — ${tierName(me.monthlyUsd)} Insider of the ${VOCAB.clubName}, card ${me.cardCode || ''}.`,
      url: W.cardUrl(me),
    }));
  });
  return wrap;
}

// The jobs a role opens, and what each one is for.
//
// There is no separate administrator's application and no second login. Victor, Ian and Vishnu
// hold seats like everybody else — they contribute, they hold points, they ask for stays — and
// the work they do for the Circle sits inside their own profile, under their level and their
// details. An Insider with no role never sees any of it.
const JOBS = [
  { roles: ['treasurer', 'deputy'], label: 'The Banker’s inbox', href: '#/bank', ico: 'vault',
    what: 'Confirm transfers against the statement, and close a month with a second officer co-signing.' },
  { roles: ['planner', 'comms', 'admin'], label: 'The Desk', href: '#/desk', ico: 'send',
    what: 'Price what people ask for, keep the catalog honest, post deals, write the notes.' },
  { roles: ['admin', 'treasurer'], label: 'Settings', href: '#/settings', ico: 'sliders',
    what: 'People and their logins, the levels, and the rules every number on every screen is worked out from.' },
];
const ROLE_WORDS = { treasurer: 'Banker', deputy: 'Deputy Banker', planner: 'Desk', comms: 'Voice', admin: 'Admin' };

/** The officer's half of a profile. Empty string for everybody else, which is most people. */
function jobsPanel(store) {
  if (!store.isOfficer()) return '';
  const held = (store.me.roles || []).filter(r => ROLE_WORDS[r]);
  const waiting = store.officerWork();
  const mine = JOBS.filter(j => store.hasRole(...j.roles));
  return `<div class="panel" style="margin-top:16px">
      <div class="row-between"><h2>Your jobs in the Circle</h2>
        <span class="row" style="gap:6px">${held.map(r => `<span class="chip">${escapeHtml(ROLE_WORDS[r])}</span>`).join('')}</span></div>
      <p class="small muted" style="margin-top:6px">On top of your own seat, not instead of it. You contribute, hold points and ask for stays like everyone else; these are the extra doors your roles open.</p>
      <ul class="job-list" style="margin-top:14px">${mine.map(j => {
        const due = waiting.filter(w => w.href.startsWith(j.href));
        const count = due.reduce((n, w) => n + (w.count || 0), 0);
        return `<li${due.some(w => w.urgent) ? ' class="urgent"' : ''}>
          <a href="${escapeHtml(j.href)}">
            <span class="job-ico">${icon(j.ico, { size: 19 })}</span>
            <span class="job-what"><b>${escapeHtml(j.label)}${count ? ` · ${count} waiting` : ''}</b>
              <span class="small muted">${escapeHtml(j.what)}</span></span>
            ${icon('chevronRight', { size: 18, cls: 'ico-muted' })}
          </a></li>`;
      }).join('')}</ul>
    </div>`;
}

/**
 * Badges: what you hold, what you have chosen to show, and what is for sale.
 *
 * Three kinds and the difference is the point. Earned ones are facts the club already records,
 * so nobody awards or withholds them. Founder ones are held by name — three of them, and there
 * will never be a fourth. Bought ones cost points, which means they cost hotel, so the dollar
 * figure is printed beside every price. Nobody should spend a night by accident.
 */
function drawBadges(panel, { store, me, refresh }) {
  const held = store.badgesOf(me.id);
  const shop = store.badgeShop(me.id);
  const pins = (me.badgePins || []);
  const s = store.settings;
  const lt = store.lifetime(me.id);

  panel.innerHTML = `
    <div class="row-between"><h2>Your badges</h2>
      <span class="tiny muted">${held.length} held${pins.length ? ` · ${pins.length} shown` : ''}</span></div>
    <p class="small muted" style="margin-top:6px">Pick up to three to show beside your name. Tap one to pin or unpin it.</p>
    <div class="badge-grid" style="margin-top:14px">${held.length ? held.map(h => `
      <button type="button" class="badge-card owned" data-pin="${escapeHtml(h.badgeKey)}"
              aria-pressed="${pins.includes(h.badgeKey)}">
        ${badgeMark(h.badge, { size: 26, tone: h.badge.kind === 'founder' ? 'is-founder' : h.badge.kind === 'bought' ? 'is-bought' : '' })}
        <span><b>${escapeHtml(h.badge.name)}</b><span class="why">${escapeHtml(h.badge.blurb)}</span></span>
      </button>`).join('') : '<p class="small muted">None yet. The earned ones arrive on their own.</p>'}</div>

    ${shop.length ? `<hr class="rule" style="margin:20px 0">
    <div class="row-between"><h2 style="font-size:1.1rem">For sale</h2>
      <span class="tiny muted">you have ${escapeHtml(fmtPoints(lt.available))}</span></div>
    <p class="small muted" style="margin-top:6px">Points spent here are hotel you are choosing not to have. That is the whole cost — nothing else changes.</p>
    <div class="badge-grid" style="margin-top:14px">${shop.map(b => {
      const afford = lt.available >= b.pricePoints;
      return `<button type="button" class="badge-card ${afford ? '' : 'locked'}" data-buy="${escapeHtml(b.key)}" ${afford ? '' : 'disabled'}>
        ${badgeMark(b, { size: 26, tone: 'is-bought' })}
        <span><b>${escapeHtml(b.name)}</b><span class="why">${escapeHtml(b.blurb)}</span>
          <span class="cost">${escapeHtml(fmtPoints(b.pricePoints))} · ${escapeHtml(fmtUsd2(b.pricePoints / s.pointsPerDollar))} of hotel</span></span>
      </button>`; }).join('')}</div>` : ''}`;

  panel.onclick = async (e) => {
    const pin = e.target.closest('[data-pin]');
    if (pin) {
      const key = pin.dataset.pin;
      const next = pins.includes(key) ? pins.filter(k => k !== key) : [...pins, key];
      if (next.length > 3) { toast('Three at most — unpin one first.', { kind: 'bad' }); return; }
      try { await store.pinBadges(next); refresh(); } catch (err) { toast(err.message, { kind: 'bad' }); }
      return;
    }
    const buy = e.target.closest('[data-buy]');
    if (!buy) return;
    const b = store.badge(buy.dataset.buy);
    const yes = await confirmDialog({ title: `Buy ${b.name}?`, confirmText: 'Buy it',
      message: `${fmtPoints(b.pricePoints)} — ${fmtUsd2(b.pricePoints / s.pointsPerDollar)} of hotel you are choosing not to have. It is yours for good and it cannot be sold back.` });
    if (!yes) return;
    try { await store.buyBadge(b.key); toast(`${b.name} is yours.`, { kind: 'good' }); refresh(); }
    catch (err) { toast(err.message, { kind: 'bad' }); }
  };
}

/** A member's own corner. Deliberately small — a line, an accent, a cover. */
function drawCorner(panel, { store, me, refresh }) {
  const ACCENTS = [['good', 'Sea'], ['flight', 'Gold'], ['flag', 'Coral'], ['ink', 'Ink'], ['sea', 'Deep'], ['sand', 'Sand']];
  const COVERS = [['', 'None'], ['hero', 'The shallows'], ['band-pool', 'Salt pans'], ['band-circle', 'The table'],
                  ['band-open', 'The colonnade'], ['season-carnival', 'Carnival'], ['season-winter', 'The west coast']];
  panel.innerHTML = `
    <h2>Your corner</h2>
    <p class="small muted" style="margin-top:6px">A line about you, a colour, and a picture. It shows on your card in the Circle and nowhere else.</p>
    <form id="corner" style="margin-top:14px">
      <label class="field"><span>A line about you</span>
        <input name="about" maxlength="200" placeholder="Always in the sea before breakfast."
               value="${escapeHtml(me.about || '')}">
        <span class="hint">200 characters. It is a line, not an essay.</span></label>
      <p class="eyebrow">Your colour</p>
      <div class="row" style="gap:8px;margin-top:8px">${ACCENTS.map(([k, n]) => `
        <button type="button" class="chip accent-chip" data-accent="${k}" aria-pressed="${(me.accent || '') === k}">
          <i style="background:var(--${k === 'sea' ? 'ink' : k === 'sand' ? 'share' : k})"></i>${escapeHtml(n)}</button>`).join('')}</div>
      <p class="eyebrow" style="margin-top:16px">Your cover</p>
      <label class="field" style="margin-top:8px"><select name="cover">
        ${COVERS.map(([k, n]) => `<option value="${k}"${(me.cover || '') === k ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}
      </select></label>
      <button class="btn" type="submit">Save your corner</button>
    </form>`;

  let accent = me.accent || '';
  panel.querySelectorAll('[data-accent]').forEach(b => b.addEventListener('click', () => {
    accent = b.dataset.accent === accent ? '' : b.dataset.accent;
    panel.querySelectorAll('[data-accent]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.accent === accent)));
  }));
  panel.querySelector('#corner').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await store.updateMember(me.id, { about: f.get('about'), accent, cover: f.get('cover') }, me.id);
      toast('Saved.', { kind: 'good' }); refresh();
    } catch (err) { toast(err.message, { kind: 'bad' }); }
  });
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
        <p class="small muted" style="margin-top:6px">A change takes effect on your next contribution and nothing you already hold is affected. Every level can ask for every stay and every trip — what changes is how fast the points build, and the perks.</p>
        <div class="choices" id="tiers" style="margin-top:14px"></div>
        <p class="eyebrow" style="margin-top:22px">What each level carries</p>
        <div style="margin-top:10px">${tierLadder(s, { mine: me.monthlyUsd })}</div>
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

      <div class="panel" style="margin-top:16px" id="badges-panel"></div>
      <div class="panel" style="margin-top:16px" id="corner-panel"></div>

      ${jobsPanel(store)}

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
        <p class="small muted" style="margin-top:6px">${store.mode === 'supabase'
          ? 'Everything you see here is held by the Circle, not by this phone — sign in anywhere and it follows you. A copy is still yours to keep whenever you want one.'
          : 'This is a preview running in your browser, and Safari clears it after about a week of not visiting. Keep a copy if you want it to survive.'}</p>
        <div class="row" style="margin-top:12px">
          <button class="btn ghost sm" id="export">Export everything as JSON</button>
          <button class="btn quiet sm" id="signout">Sign out</button>
        </div>
      </div>
    </div></section></div>`);

  wrap.querySelector('#tiers').innerHTML = s.tiers.map(t => `<button type="button" class="choice" aria-pressed="${t.monthlyUsd === me.monthlyUsd}" data-amt="${t.monthlyUsd}">
      <span class="amt">$${t.monthlyUsd}</span><span class="tier">${escapeHtml(tierName(t.monthlyUsd))} ${treeSvg(VOCAB.tierLean[t.monthlyUsd], { size: 14 })}</span>
      <span class="tiny muted">${escapeHtml(fmtPoints(pointsPerMonth(s, t.monthlyUsd)))} a month · ${t.holds} open request${t.holds > 1 ? 's' : ''} · ${t.guestCerts} guest passes</span></button>`).join('');
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
      message: `You hold ${fmtPoints(exit.basePoints)} base points. You have twelve months to use them on stays; after that ${fmtUsd2(exit.refundUsd)} comes back to you at face value. Bonus points are not refunded. Ian will be in touch.` });
    if (yes) { await store.leaveMember(me.id, me.id); toast('Notice given. Ian will be in touch this week.'); go('/home'); }
  });
  drawBadges(wrap.querySelector('#badges-panel'), { store, me, refresh });
  drawCorner(wrap.querySelector('#corner-panel'), { store, me, refresh });

  wrap.querySelector('#export').addEventListener('click', () => downloadText(`${VOCAB.clubName.toLowerCase()}-backup.json`, store.exportJson(), 'application/json'));
  wrap.querySelector('#signout').addEventListener('click', async () => { await store.signOut(); toast(`${VOCAB.pap.bye[0]} · ${VOCAB.pap.bye[1]}`); go('/'); });
  return wrap;
}
