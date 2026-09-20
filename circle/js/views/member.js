// The member's own screens: home, sending a contribution, the ledger, the card, the profile.
import { escapeHtml, fmtUsd2, fmtAfl2, fmtPoints, fmtPointsUsd, pointsUsd, fmtDay, fmtDayTime, fmtMonth, fmtPct, monthKey, countdownTo, initials, toCsv, downloadText, arubaDate, fmtClock } from '../core/util.js';
import { RANKS, nextRank } from '../core/standing.js';
import { VOCAB, tierName, refFor } from '../core/vocab.js';
import { splitContribution, tierFor, fromPoints, seatPoints, pointsPerMonth } from '../core/money.js';
import { memberCard, poolGauge, rankCrest, ring, tierLadder, badgeMark, badgeRow } from '../ui/pieces.js';
import { treeSvg } from '../ui/art.js';
import { toast, sheet, confirmDialog, setBusy, countUp, statusLabel, avatar } from '../ui/components.js';
import { dropWhen } from './deals.js';
import { postCard, postcardSheet, cheersLine } from './postcards.js';
import { sparkline, columns, tableFor } from '../ui/charts.js';
import { waLink, TEMPLATES, copyText, shareText } from '../core/share.js';
import { icon } from '../ui/icons.js';
import { shiftMonth } from '../core/store.js';
import { getTheme, setTheme } from '../ui/theme.js';
import { showInstall, wantsInstallNudge, dismissInstallNudge, isStandalone } from '../ui/install.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const KIND_LABEL = { earn: 'Contribution', bonus: 'Tier bonus', streak: 'Streak bonus', founding: 'Founding bonus', burn: 'Stay', refund: 'Refund', adjust: 'Adjustment', expire: 'Expired', reverse: 'Reversal' };
// One glyph per kind of officer work, so the Home list reads at a glance.
const WORK_ICON = { bank: 'vault', close: 'scale', quote: 'send', logins: 'key' };
const chevron = () => icon('chevronRight', { size: 18, cls: 'ico-muted' });

/** Every figure in the mono, one at a time; the words between stay in the sans. Escapes first,
 *  so it takes raw text — a points figure, a dollar amount, a percentage, a comma-grouped count.
 *  Small counts and years are left alone: "7 nights" and "2026" are read, not tabulated. */
const figs = (text) => escapeHtml(String(text ?? ''))
  .replace(/✦\s?\d[\d,]*|\$\d[\d,]*(?:\.\d+)?|\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b/g, (m) => `<b class="num">${m}</b>`);
const num = (text) => `<b class="num">${escapeHtml(String(text ?? ''))}</b>`;

export function home({ store, go, refresh }) {
  const me = store.me, s = store.settings;
  const lt = store.lifetime(me.id);
  const t = store.treasury();
  const month = monthKey();
  const status = store.monthStatus(me.id, month);
  const tier = tierFor(s, me.monthlyUsd);
  const held = store.state.redemptions.filter(r => r.memberId === me.id && r.status === 'held');
  const asked = store.state.redemptions.filter(r => r.memberId === me.id && r.status === 'requested');
  const quoted = store.state.redemptions.filter(r => r.memberId === me.id && r.status === 'quoted');
  const upcoming = store.state.redemptions.filter(r => r.memberId === me.id && r.status === 'confirmed');
  const note = store.announcements()[0];
  const dream = store.stay(me.dreamStayId) || store.arubaStays()[0];
  const streak = store.streak(me.id);
  const next = store.nextMilestone(me.id);

  // One column, in the order a thumb meets it: what you can have, what you hold, what needs
  // you, then the rest of the paper.
  const wrap = el(`<div><section class="sec"><div class="wrap">
    <div id="masthead"></div>
    <div class="stack" id="body"></div>
  </div></section></div>`);
  const body = wrap.querySelector('#body');

  // 1 — what the points are actually worth, in nights, before anything else.
  //
  // This screen used to open on "✦ 28,850" in the biggest type on the page. Nobody holds a
  // conversion rate in their head: a member wants to know whether they can go somewhere, and
  // the app knew the answer and never said it. The five-digit figure is still here — it is
  // just no longer the headline, because it is not the question.
  // The page opens the way the board does: a line of standing type saying what you can have,
  // the figure it rests on in the mono face underneath, and the one button that acts on it,
  // with the one ruled link beside it. The balance bar follows, under the masthead's rule — it
  // is the evidence, not the headline.
  const book = store.canBookNow(me.id);
  const head = !book
    ? { eyebrow: '', h1: 'Your corner of the Circle', cta: `<a class="btn" href="#/stays">${icon('bed', { size: 17 })}See what is open</a>` }
    : book.can
      ? { eyebrow: 'What you can book today',
          h1Html: `${book.nights}${book.capped ? '+' : ''} night${book.nights === 1 ? '' : 's'} at <em class="ac">${escapeHtml(book.stay.name)}</em>`,
          cta: `<a class="btn" href="#/book/${escapeHtml(book.stay.id)}">${icon('send', { size: 17 })}Ask for these dates</a>
                <a class="link-rule" href="#/stays">Other places</a>` }
      : { eyebrow: 'The first thing within reach',
          h1Html: `${book.nights} night${book.nights === 1 ? '' : 's'} at <em class="ac">${escapeHtml(book.stay.name)}</em>`,
          cta: `<a class="btn" href="#/pay">${icon('arrowUp', { size: 17 })}Send a contribution</a>
                <a class="link-rule" href="#/stays">Other places</a>` };
  wrap.querySelector('#masthead').innerHTML = `<div class="masthead">
      <p class="eyebrow"><span lang="pap" class="pap">${escapeHtml(VOCAB.pap.welcome[0])}</span>, ${escapeHtml(me.name.split(' ')[0])}${head.eyebrow ? ` · ${escapeHtml(head.eyebrow)}` : ''}</p>
      <h1>${head.h1Html || escapeHtml(head.h1)}</h1>
      <p class="dateline"><b class="num" id="avail">0</b> <span id="avail-usd"></span></p>
      <div class="row no-print">${head.cta}</div>
    </div>`;
  const top = el(`<div class="rule-block">
      <div id="balbar"></div>
      <div class="row no-print">
        <a class="link-rule" href="#/pay">Send a contribution</a>
        <a class="link-rule" href="#/ledger">Statement</a>
        <a class="link-rule" href="#/card">Your card</a>
      </div>
    </div>`);
  body.appendChild(top);
  countUp(wrap.querySelector('#avail'), lt.available, { format: (n) => `✦ ${Math.round(n).toLocaleString('en-US')}` });
  wrap.querySelector('#avail-usd').textContent = `· ${pointsUsd(lt.available, s.pointsPerDollar)} of hotel${lt.committed ? ` · ${fmtPoints(lt.committed)} committed` : ''}`;
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

  // 1b — anything the Circle is waiting on you for, if you hold a job
  const jobs = store.officerWork();
  if (jobs.length) {
    body.appendChild(el(`<div class="panel job-panel">
      <p class="eyebrow">${icon('crown')}Waiting on you</p>
      <ul class="job-list" style="margin-top:12px">${jobs.map(j => `
        <li${j.urgent ? ' class="urgent"' : ''}>
          <a href="${escapeHtml(j.href)}">
            <span class="job-ico">${icon(WORK_ICON[j.id] || 'clipboard', { size: 19 })}</span>
            <span class="job-what"><b>${escapeHtml(j.what)}</b><span class="small muted">${escapeHtml(j.why)}</span></span>
            ${chevron()}
          </a>
        </li>`).join('')}</ul>
      <a class="link-rule" href="#/profile">Your jobs</a>
    </div>`));
  }

  // 2 — what needs you, in the order it needs you
  const blocks = [];
  // A deal that answers something you asked for goes above everything else: these go fast.
  for (const m of store.matchesForMember(me.id).slice(0, 3)) {
    const st = store.stay(m.deal.stayId);
    blocks.push(`<div class="notice good"><b>${icon('bellRing', { size: 16 })} ${escapeHtml(st?.name || 'A place you asked for')} came free</b>
      <p class="small">${m.deal.nights} nights from ${escapeHtml(fmtDay(m.deal.from))} · ${figs(fmtPoints(m.deal.pointsTotal))}.
      ${m.affordable ? 'You have the points.' : `You are ${figs(fmtPoints(m.short))} short — ask anyway and close it with a top-up.`}</p>
      <p style="margin-top:8px"><a class="btn sm" href="#/stays">${icon('eye', { size: 15 })}Look at it</a></p></div>`);
  }
  if (status === 'due') blocks.push(`<div class="notice warn"><b>Your ${escapeHtml(fmtMonth(month))} contribution is due</b>
      <p class="small">${figs(fmtUsd2(me.monthlyUsd))} to the Reserve with reference ${num(refFor(me, month))}, then tap “I sent it”.</p>
      <p style="margin-top:8px"><a class="btn sm" href="#/pay">Send it</a></p></div>`);
  if (status === 'pending') {
    const c = store.contributionsFor(me.id).find(x => x.forMonth === month && x.status === 'pending');
    blocks.push(`<div class="notice"><b>Sent · awaiting the Banker</b>
      <p class="small">${figs(fmtUsd2(c.expectedUsd))} marked as sent on ${escapeHtml(fmtDay(c.submittedAt))}. Vishnu confirms within ${num(s.bankerSlaHours)} hours of the money arriving; your points appear the moment he does.</p></div>`);
  }
  if (status === 'paused') blocks.push(`<div class="notice"><b>You are paused until ${escapeHtml(fmtMonth(me.pausedUntil))}</b>
      <p class="small">Your streak is frozen at ${num(streak)}, not reset, and your points stay fully usable.</p>
      <p><a class="link-rule" href="#/profile">Resume any time</a></p></div>`);
  for (const q of quoted) {
    const st = store.stay(q.stayId); const left2 = countdownTo(q.quoteExpiresAt);
    blocks.push(`<div class="notice warn"><b>A quote is waiting for you</b>
      <p class="small">${escapeHtml(st?.name || 'a stay')} · ${q.nights} nights from ${escapeHtml(fmtDay(q.checkIn))} · ${figs(fmtPoints(q.quotedPoints))}${q.topUpUsd ? ` plus ${figs(fmtUsd2(q.topUpUsd))} top-up` : ''}.
      ${left2 ? `Expires in ${num(left2)}.` : 'It has expired.'}</p>
      <p style="margin-top:8px"><a class="btn sm" href="#/requests/${q.id}">Look at it</a></p></div>`);
  }
  // A freshly sent ask used to be invisible here — the member had nowhere that said Victor had it.
  for (const a of asked) {
    const st = store.stay(a.stayId);
    blocks.push(`<div class="notice"><b>Victor has your ask for ${escapeHtml(st?.name || 'a stay')}</b>
      <p class="small">${a.nights} nights from ${escapeHtml(fmtDay(a.checkIn))}. He prices it within ${num(tier.slaHours ?? s.slaHours)} hours; nothing is committed until you say yes.</p>
      <p><a class="link-rule" href="#/requests/${a.id}">Details</a></p></div>`);
  }
  for (const h of held) {
    const st = store.stay(h.stayId);
    blocks.push(`<div class="notice"><b>${figs(fmtPoints(h.points))} committed to ${escapeHtml(st?.name || 'a stay')}</b>
      <p class="small">${h.nights} nights from ${escapeHtml(fmtDay(h.checkIn))}. ${h.approvedAt ? 'Victor has it and is booking it himself, in your name; your points burn when the room is yours.' : 'Victor picks it up next; you hear the moment he has it.'}</p>
      <p><a class="link-rule" href="#/requests/${h.id}">Details</a></p></div>`);
  }
  for (const u of upcoming) {
    const st = store.stay(u.stayId);
    blocks.push(`<div class="notice good"><b>Booked: ${escapeHtml(st?.name || 'a stay')}</b>
      <p class="small">${u.nights} nights from ${escapeHtml(fmtDay(u.checkIn))} · confirmation ${num(u.confirmationRef)}${u.hotelDeadline ? ` · free cancellation until ${escapeHtml(fmtDay(u.hotelDeadline))}` : ''}.</p></div>`);
  }
  const chipIn = store.openToChipIn().filter(r => r.memberId !== me.id);
  for (const r of chipIn.slice(0, 2)) {
    const st = store.stay(r.stayId); const owner = store.member(r.memberId);
    const target = r.quotedPoints || r.indicativePoints || 0;
    const gap = Math.max(0, target - store.coveredPoints(r));
    const pct = target ? Math.min(1, store.coveredPoints(r) / target) : 0;
    // Not `.notice.ask`: the ask form owns the `ask` class, and its grid rules would take this box apart.
    blocks.push(`<div class="notice" style="border-left:2px solid var(--ink)">
      <div class="row" style="gap:11px;align-items:flex-start;flex-wrap:nowrap">
        ${avatar(owner, 40)}
        <div style="min-width:0;flex:1">
          <b>${escapeHtml(owner?.name.split(' ')[0] || 'An Insider')} is ${figs(fmtPoints(gap))} short for ${escapeHtml(st?.name || 'a stay')}</b>
          <p class="small muted" style="margin-top:3px">${r.nights} nights from ${escapeHtml(fmtDay(r.checkIn))}. Anyone can put their own points in — yours are committed only until it is booked or falls through.</p>
          <div class="goal-bar" style="margin-top:10px" role="img"
            aria-label="${escapeHtml(fmtPct(pct))} of the way there"><span style="width:${(pct * 100).toFixed(1)}%"></span></div>
          <p class="tiny muted" style="margin-top:6px">${figs(fmtPoints(store.coveredPoints(r)))} of ${figs(fmtPoints(target))} together — ${figs(fmtPct(pct))} there</p>
          <p style="margin-top:10px"><a class="btn sm" href="#/requests/${r.id}">${icon('chipIn', { size: 15 })}Chip in</a></p>
        </div>
      </div></div>`);
  }
  if (blocks.length) body.appendChild(el(`<div class="stack">${blocks.join('')}</div>`));
  // The list of everything asked, which had no way in from the chrome at all.
  if (store.state.redemptions.some(r => r.memberId === me.id)) body.appendChild(el(`<p><a class="link-rule" href="#/requests">Everything you have asked for</a></p>`));

  // 2b — the one-line nudge to put Hunto on the home screen, on a phone that has not, until
  // the member says not now. It never says the app is installed: the display mode does.
  if (wantsInstallNudge()) {
    const nudge = el(`<p class="rule-block small">Hunto works best from your home screen<span class="row" style="gap:20px"><button type="button" class="link-rule" id="install-how">Show me</button><button type="button" class="link-rule quiet muted" id="install-no">Not now</button></span></p>`);
    nudge.querySelector('#install-how').addEventListener('click', () => showInstall());
    nudge.querySelector('#install-no').addEventListener('click', () => { dismissInstallNudge(); nudge.remove(); });
    body.appendChild(nudge);
  }

  // 3 — THE BOARD, if Victor has one lined up.
  //
  // The whole mechanic is anticipation, and anticipation does not survive being filed on another
  // screen: a member who has to go looking for the drop is not spending Thursday evening guessing
  // at it. So the names come to the home screen the moment they are posted, and the price stays
  // behind until the hour. It says nothing it has not established — six places and a time — and
  // it disappears by itself the moment the board opens, because the weeks stop being teased.
  {
    const teased = typeof store.teasedDeals === 'function' ? store.teasedDeals() : [];
    if (teased.length) {
      const when = dropWhen(teased[0].dropAt);
      const names = [...new Set(teased.map(d => store.stay(d.stayId)?.name).filter(Boolean))];
      body.appendChild(el(`<div class="panel board-tease">
        <p class="eyebrow">${icon('zap')}The Board</p>
        <p class="big-line">${teased.length} week${teased.length === 1 ? '' : 's'}, priced ${escapeHtml(when)}</p>
        <p class="small muted" style="margin-top:8px">${escapeHtml(names.join(' · '))}</p>
        <p class="tiny muted" style="margin-top:10px">Victor looked at these himself. The prices go up ${escapeHtml(when)} and the board stays open all weekend — there is no race.</p>
        <a class="link-rule" href="#/stays">See it</a>
      </div>`));
    }
  }

  // 4 — what you are saving for, and exactly how far off it is
  const goalPanel = el(`<div class="panel" id="goal-panel"></div>`);
  body.appendChild(goalPanel);
  const drawGoal = () => {
    const g = store.goalFor(me.id);
    if (!g) {
      goalPanel.innerHTML = `
        <p class="eyebrow">${icon('target')}What you are saving for</p>
        <h2 style="margin-top:8px">Pick something and watch it come closer</h2>
        <p class="small muted" style="margin-top:8px">Every contribution moves a bar instead of a number. Choose a place and how many nights, and the app works out how many months it takes at your level — and what would get you there sooner.</p>
        <div class="stack tight" style="margin-top:14px">
          <p><button type="button" class="link-rule" id="set-goal">Choose one</button></p>
          <p><a class="link-rule" href="#/stays">Look at the places</a></p>
        </div>`;
      return;
    }
    const pct = Math.round(g.pct * 100);
    const others = g.ways.filter(w => !w.mine && w.months < g.months);
    goalPanel.innerHTML = `
      <p class="eyebrow">${icon('target')}What you are saving for</p>
      <h2 style="margin-top:10px">${escapeHtml(g.stay.name)}</h2>
      <p class="small muted" style="margin-top:4px">${g.isTrip
        ? `A seat · ${g.nights} nights · ${escapeHtml(fmtDay(g.stay.dates.from))}`
        : `${g.nights} night${g.nights === 1 ? '' : 's'} · from ${figs(fmtPointsUsd(g.target, s.pointsPerDollar))}`}</p>

      <div class="goal-bar" style="margin-top:16px" role="img"
           aria-label="${fmtPoints(g.have)} of ${fmtPoints(g.target)}, ${pct} per cent of the way">
        <span style="width:${pct}%"></span>
        <b class="goal-pct">${pct}%</b>
      </div>
      <div class="row-between small" style="margin-top:8px">
        <span>${num(fmtPoints(g.have))} <span class="muted">you hold</span></span>
        <span class="muted">of ${num(fmtPoints(g.target))} · ${num(pointsUsd(g.target, s.pointsPerDollar))}</span>
      </div>

      ${g.short === 0
        ? `<div class="notice good" style="margin-top:14px"><b>${icon('checkCircle', { size: 16 })} You can ask for this now</b>
             <p class="small">The points are there. Victor quotes it, and it is held the moment you accept.</p>
             <p style="margin-top:10px"><a class="btn sm" href="#/book/${escapeHtml(g.stay.id)}">${icon('send', { size: 15 })}Ask for it</a></p></div>`
        : `<div class="notice" style="margin-top:14px">
             <b>${figs(fmtPoints(g.short))} to go</b>
             <p class="small" style="margin-top:6px">At ${figs(fmtUsd2(me.monthlyUsd))} a month you earn ${figs(fmtPoints(g.perMonth))}, so that is
               <b>${num(g.months)} more month${g.months === 1 ? '' : 's'}</b> — around ${escapeHtml(fmtMonth(shiftMonth(monthKey(), g.months)))}.</p>
             <ul class="stack tight" style="margin-top:10px;padding-left:1.1em">
               <li class="small muted">${figs(fmtUsd2(g.topUpUsd))} as a cash top-up closes it today — at face value, the Circle's share is already in the quote</li>
               ${others.length ? `<li class="small muted">At ${figs(fmtUsd2(others[0].monthlyUsd))} a month it would be ${num(others[0].months)} months instead of ${num(g.months)}</li>` : ''}
               <li class="small muted">Or ask for it anyway and open it to the Circle — others put their own points in</li>
             </ul>
             ${others.length ? '<p><a class="link-rule" href="#/profile">Change your level</a></p>' : ''}
           </div>`}
      <p class="small muted" style="margin-top:12px">${icon('bell', { size: 14, cls: 'ico-muted' })} You hear the moment one comes free, once the Desk knows you want it.</p>
      <div class="stack tight">
        <p><a class="link-rule" href="#/watching">Tell the Desk you want it</a></p>
        <p><button type="button" class="link-rule" id="set-goal">Change what you are saving for</button></p>
      </div>`;
  };
  drawGoal();
  goalPanel.addEventListener('click', async (e) => {
    if (!e.target.closest('#set-goal')) return;
    const picked = await goalSheet({ store });
    try {
      if (picked === CLEAR_GOAL) { await store.setGoal(me.id, null, me.id); drawGoal(); }
      else if (picked?.stayId) { await store.setGoal(me.id, picked, me.id); drawGoal(); }
    } catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); }
  });

  // 5 — a postcard, when there is one to show.
  //
  // On a day this member is on the island (their own approved booking covers today in Aruba) the
  // panel asks for one, and once one is sent it shows it. On any other day it shows the newest
  // postcard from the last fortnight. When neither applies nothing is drawn: Home never gains an
  // empty box, and booking stays the headline — the postcard is the second thing, like the board.
  if (typeof store.postcardsOn === 'function' && store.postcardsOn()) {
    const day = store.islandDay(me.id);
    const today = arubaDate(new Date());
    const sentToday = store.moments({ mine: true }).find(m => arubaDate(m.createdAt) === today);
    const latest = store.moments().find(m => Date.now() - new Date(m.createdAt) < 14 * 86400000);
    const send = (capture) => postcardSheet({ store, prefill: { capture, redemptionId: day?.redemption?.id || null } }).then(m => { if (m) refresh?.(); });
    if (day) {
      const box = el(`<div class="panel" id="postcard-day">
        <p class="eyebrow">${icon('camera')}Today’s postcard</p>
        <p class="mono tiny muted place-line" style="margin-top:6px">DAY ${day.day} OF ${day.days} · ${escapeHtml(String(day.stay?.name || '').toUpperCase())}</p>
        ${sentToday ? '<div id="today-card" style="margin-top:12px"></div>' : '<p class="big-line">Send one from the island.</p>'}
        <div class="stack tight" style="margin-top:14px">
          ${sentToday
            ? `<p><button type="button" class="link-rule" data-postcard="capture">Another one</button></p><p><a class="link-rule" href="#/postcards">All of them</a></p>`
            : `<button type="button" class="btn block" data-postcard="capture">Take one now</button><p><button type="button" class="link-rule" data-postcard="roll">From your roll</button></p>`}
        </div>
      </div>`);
      if (sentToday) {
        store.momentUrls([sentToday.path]).then(urls => { box.querySelector('#today-card')?.replaceChildren(postCard(sentToday, { store, urls, compact: true })); });
      }
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-postcard]'); if (b) send(b.dataset.postcard === 'capture'); });
      body.appendChild(box);
    } else if (latest) {
      const block = el(`<div class="rule-block">
        <p class="eyebrow">${icon('camera')}The latest postcard</p>
        <div id="latest-card" style="margin-top:12px"></div>
        <a class="link-rule" href="#/postcards">All of them</a>
      </div>`);
      store.momentUrls([latest.path]).then(urls => { block.querySelector('#latest-card')?.replaceChildren(postCard(latest, { store, urls, compact: true })); });
      body.appendChild(block);
    }
  }

  // 6 — what being in the Circle has been worth, in dollars, from real bookings.
  //
  // "I want people to see their savings real price vs what on the page so they appreciate being
  // a member." It only appears once there is a paid booking to build it from: a savings panel
  // reading $0.00 on somebody's first week is the opposite of the intended feeling, and an
  // estimate would make the number worthless on the day it finally matters.
  {
    const sv = store.savingsFor(me.id);
    if (sv.trips) {
      const good = sv.savedUsd > 0;
      body.appendChild(el(`<div class="panel">
        <p class="eyebrow">${icon('trend')}What the Circle has saved you</p>
        <p class="big-figure num" style="color:${good ? 'var(--good-text)' : 'var(--ink)'}">${escapeHtml(fmtUsd2(Math.abs(sv.savedUsd)))}</p>
        <p class="small muted" style="margin-top:4px">${good
          ? `across ${num(sv.trips)} booking${sv.trips === 1 ? '' : 's'} — ${figs(fmtUsd2(sv.publicUsd))} of hotel for ${figs(fmtUsd2(sv.oursUsd))}, ${num(`${sv.pct}%`)} off the public rate`
          : `${figs(fmtUsd2(sv.oursUsd))} against a public ${figs(fmtUsd2(sv.publicUsd))} — the Circle has cost you more so far, and it says so`}</p>
        <ul class="ledger" style="margin-top:14px">
          ${sv.lines.slice(0, 3).map(l => `<li>
            <span class="what"><b>${escapeHtml(l.stayName)}</b><span class="meta">${l.nights} night${l.nights === 1 ? '' : 's'} · booked alone ${figs(fmtUsd2(l.publicUsd))}</span></span>
            <span class="delta"><b class="${l.savedUsd > 0 ? 'pos' : ''}">${l.savedUsd >= 0 ? '' : '+'}${escapeHtml(fmtUsd2(Math.abs(l.savedUsd)))}</b><small>${l.savedUsd >= 0 ? 'saved' : 'more than direct'} · paid ${escapeHtml(fmtUsd2(l.oursUsd))}</small></span></li>`).join('')}
        </ul>
        <p class="small muted" style="margin-top:10px">Against the public rate for the same nights, taken when you asked for them. ${sv.paidIn ? `You have put in ${figs(fmtUsd2(sv.paidIn))} altogether.` : ''}</p>
        <a class="link-rule" href="#/ledger">Every line</a>
      </div>`));
    }
  }

  // 7 — the ledger, last five lines
  const recent = store.ledgerFor(me.id).slice(0, 5);
  body.appendChild(el(`<div class="panel">
      <h2>Your ledger</h2>
      <ul class="ledger" style="margin-top:10px">${recent.map(l => ledgerRow(l, s)).join('') || '<li><span class="what"><b>No lines yet</b><span class="meta">Your first confirmed contribution will appear here with its split.</span></span></li>'}</ul>
      <a class="link-rule" href="#/ledger">All of it</a>
    </div>`));

  // 8 — standing, roll call, coverage, the note from Ian
  const myStanding = store.standingOf(me.id);
  const nextUp = nextRank(myStanding?.monthsHeld ?? 0);
  const toGo = nextUp ? nextUp.months - (myStanding?.monthsHeld ?? 0) : 0;
  const standing = el(`<div class="rule-block">
      <p class="eyebrow">${icon('crown')}Your standing</p>
      <div id="crest-slot" style="margin-top:10px"></div>
      <p class="small muted" style="margin-top:8px">${nextUp ? `${num(toGo)} more month${toGo === 1 ? '' : 's'} to ${escapeHtml(nextUp.name)}.` : 'Nothing above this one.'} ${escapeHtml(RANKS[myStanding?.rankIndex ?? 0].unlocks)}</p>
      <hr class="rule" style="margin:14px 0">
      <div class="row" style="gap:11px;margin-top:10px;align-items:flex-start;flex-wrap:nowrap">
        <span style="flex:none;margin-top:-4px">${treeSvg(VOCAB.tierLean[me.monthlyUsd], { size: 30 })}</span>
        <div style="min-width:0"><b>${escapeHtml(tierName(me.monthlyUsd))}</b> · ${num(fmtUsd2(me.monthlyUsd))} a month
        <br><span class="small muted">${figs(fmtPointsUsd(store.lifetime(me.id).balance, s.pointsPerDollar))} held${me.founding ? ` · ${escapeHtml(VOCAB.founding)}` : ''}</span></div>
      </div>
      <p class="small" style="margin-top:14px">${num(streak)} consecutive contribution${streak === 1 ? '' : 's'}${next ? ` · ${num(next - streak)} more to the ${num(next)}-month bonus of ${num(fmtPoints(s.streakBonuses[next]))}` : ''}.</p>
      <div style="margin-top:12px">${sparkSlot()}</div>
      <a class="link-rule" href="#/profile">Your corner</a>
    </div>`);
  body.appendChild(standing);
  {
    // The crest escapes its sub line, so the count goes in flat and comes back in the mono here:
    // "8 months in the Circle" sitting in the sans, one line under a mono figure, was the one
    // number on this panel reading as a word.
    const monthsHeld = myStanding?.monthsHeld ?? 0;
    const months = `month${monthsHeld === 1 ? '' : 's'} in the Circle`;
    const crest = rankCrest(myStanding, { size: 54, sub: `${monthsHeld} ${months}` });
    const subLine = crest.querySelector('.small.muted');
    if (subLine) subLine.innerHTML = `${num(monthsHeld)} ${escapeHtml(months)}`;
    standing.querySelector('#crest-slot')?.replaceChildren(crest);
  }
  {
    const series = store.balanceSeries(me.id).map(p => p.points);
    standing.querySelector('.spark-slot')?.replaceChildren(sparkline(series.length ? series : [0, 0], { width: 340, height: 46 }));
  }
  const roll = el(`<div class="rule-block">
      <p class="eyebrow">${icon('users')}This month in the Circle</p>
      <div class="row" style="gap:14px;margin-top:12px;align-items:center">
        <span id="rollcall"></span>
        <div class="small">${num(t.confirmedThisMonth)} of ${num(t.expectedThisMonth)} contributions confirmed for ${escapeHtml(fmtMonth(month))}.
        <br><span class="muted">Names stay private unless an Insider opts in.</span></div>
      </div>
      <a class="link-rule" href="#/circle">Everyone</a></div>`);
  body.appendChild(roll);
  roll.querySelector('#rollcall').replaceChildren(ring({ total: t.expectedThisMonth, filled: t.confirmedThisMonth, size: 76 }));
  const cov = el(`<div class="rule-block"><p class="eyebrow">${icon('shield')}Proof of reserves</p><div id="cov" style="margin-top:12px"></div>
      <a class="link-rule" href="#/pool">The whole Pool</a></div>`);
  cov.querySelector('#cov').appendChild(poolGauge({ coverage: t.coverage, reserveUsd: t.reserveUsd, outstandingPoints: t.outstandingPoints, verifiedAt: t.verified?.at, verifiedVarianceUsd: t.verifiedVarianceUsd, liabilityUsd: t.liabilityUsd, configured: t.accountsConfigured }));
  body.appendChild(cov);
  // The Voice's note reads as a note: set as a pull quote, in his words, signed.
  if (note) body.appendChild(el(`<div class="rule-block"><p class="eyebrow">${icon('inbox')}From the Voice</p>
      <blockquote class="pull"><b>${escapeHtml(note.title)}</b><br>${escapeHtml(note.body.slice(0, 180))}${note.body.length > 180 ? '…' : ''}
        <cite>${escapeHtml(store.member(note.authorId)?.name || 'Ian')}</cite></blockquote>
      <a class="link-rule" href="#/circle">All the notes</a></div>`));
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
            <optgroup label="Cruises and trips">${trips.map(x => `<option value="${escapeHtml(x.id)}"${x.id === current.stayId ? ' selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</optgroup>
          </select></label>
        <label class="field" id="stay-only"><span>Nights</span><input name="nights" type="number" min="1" max="30" value="${current.nights || 3}" inputmode="numeric"></label>
        <div id="prev" class="notice"></div>
        <div class="sheet-actions">
          ${me.goal ? '<button type="button" class="link-rule" data-clear>Stop saving for it</button>' : ''}
          <button type="button" class="btn block" data-ok>Set it</button></div>`;
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
          <b>${num(fmtPoints(target))} · ${num(pointsUsd(target, s.pointsPerDollar))}</b>
          <p class="small" style="margin-top:6px">${short
            ? `You hold ${figs(fmtPoints(have))}, so ${figs(fmtPoints(short))} to go — about ${num(months)} month${months === 1 ? '' : 's'} at ${figs(fmtUsd2(me.monthlyUsd))}.`
            : 'You already hold enough for this. Ask for it whenever you like.'}</p>
          ${stay?.minNights > 1 && !isTrip ? `<p class="small muted" style="margin-top:6px">${escapeHtml(stay.name)} takes a minimum of ${num(stay.minNights)} nights.</p>` : ''}`;
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
  return `<li><span class="what"><b>${figs(l.note)}</b>
      <span class="meta">${escapeHtml(KIND_LABEL[l.kind] || l.kind)} · ${escapeHtml(fmtDay(l.at))}</span></span>
    <span class="delta"><b class="${positive ? 'pos' : 'neg'}">${positive ? '+' : ''}${Math.round(l.points).toLocaleString('en-US')}</b>
      <small>${escapeHtml(pointsUsd(Math.abs(l.points), s.pointsPerDollar))}</small></span></li>`;
}

/** "5 Oct" — the day the next contribution is due, for a dateline. */
const dueOn = (s, month) => `${s.dueDay} ${fmtMonth(shiftMonth(month, 1)).slice(0, 3)}`;

export function pay({ store, go }) {
  const me = store.me, s = store.settings;
  const month = monthKey();
  const status = store.monthStatus(me.id, month);
  const tier = tierFor(s, me.monthlyUsd);
  const sp = splitContribution(me.monthlyUsd, s, tier);
  const reference = refFor(me, month);
  const pending = store.contributionsFor(me.id).find(c => c.forMonth === month && c.status === 'pending');
  // A member who has already paid, and been confirmed, must never be told to pay again. This is
  // the one screen where a misread costs real money: the likely outcome is a second $200 landing
  // in the Reserve that Vishnu then has to spot and refund. So when the month is settled the page
  // says THAT first and the instructions step aside — still reachable, behind a disclosure, for
  // anyone deliberately sending something extra.
  const settled = status === 'confirmed';
  const landed = store.contributionsFor(me.id).find(c => c.forMonth === month && c.status === 'confirmed');
  const banker = (id) => store.member(id)?.name.split(' ')[0] || 'the Banker';
  // What a member carries to WhatsApp when the month is already settled. It says "extra" in so
  // many words, because the Banker's own screen distinguishes an extra from a monthly and the
  // reference alone would read as a duplicate of the transfer he has already confirmed.
  const extraNote = `Hi Vishnu, I am sending something extra on top of my monthly — ${fmtMonth(month)} is already settled. Reference: ${reference}. Please record it as an extra. — ${me.name}`;
  // The reference first: it is the one thing Vishnu reads off the statement.
  const bankDetails = `<div class="stack" style="margin-top:14px">
          <div><p class="eyebrow">${icon('tag')}Put this in the description</p>
            <div class="copyline" style="margin-top:6px"><code class="num">${escapeHtml(reference)}</code><button type="button" class="btn ghost sm" data-copy="${escapeHtml(reference)}">Copy</button></div>
            <p class="small muted" style="margin-top:6px">It is how Vishnu matches your transfer against the statement in seconds. Same reference every month, with the month on the end.</p></div>
          <div class="copyline"><code>${escapeHtml(s.reserveAccount.bank)}</code></div>
          <div class="copyline"><code>${escapeHtml(s.reserveAccount.holder)}</code></div>
          <div class="copyline"><code class="num">${escapeHtml(s.reserveAccount.number)}</code><button type="button" class="btn ghost sm" data-copy="${escapeHtml(s.reserveAccount.number)}">Copy</button></div>
        </div>`;
  const h1 = settled ? `${escapeHtml(fmtMonth(month))} is settled` : pending ? `${escapeHtml(fmtMonth(month))} is marked as sent` : `${escapeHtml(fmtMonth(month))} is due`;
  const dateline = settled
    ? `${num(fmtUsd2(landed?.amountUsd ?? landed?.expectedUsd ?? me.monthlyUsd))} landed · confirmed by ${escapeHtml(landed?.reviewedBy ? banker(landed.reviewedBy) : 'the Banker')} · next due ${escapeHtml(dueOn(s, month))}`
    : pending
      ? `${num(fmtUsd2(pending.expectedUsd))} · marked as sent ${escapeHtml(fmtDay(pending.submittedAt))} · awaiting the Banker`
      : `${num(fmtUsd2(me.monthlyUsd))} · ${escapeHtml(fmtAfl2(me.monthlyUsd, s.awgPerUsd))} · becomes ${num(fmtPoints(sp.points))} · all of it to the Reserve`;
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">${settled ? 'Your contribution' : 'Send a contribution'}</p>
      <h1>${h1}</h1>
      <p class="dateline">${dateline}</p>

      ${settled ? `<div class="panel flat" style="margin-top:20px"><b><span lang="pap" class="pap">${escapeHtml(VOCAB.pap.thanks[0])}</span> · ${escapeHtml(VOCAB.pap.thanks[1])}</b>
        <p class="small" style="margin-top:6px">${escapeHtml(fmtMonth(month))} is confirmed${landed?.confirmedAt ? ` — ${escapeHtml(fmtDay(landed.confirmedAt))}` : ''}. Your next one is due on the ${num(`${s.dueDay}th`)} of next month.</p></div>

      <details class="fineprint" style="margin-top:16px">
        <summary>Send something extra</summary>
        <p class="small muted" style="margin-top:10px">Only if you mean to. This month is already paid, and a second transfer has to be spotted and returned by hand.</p>
        ${bankDetails}
        <!-- The disclosure handed over the bank details and then dropped the member: the "I sent
             it" form, the docked action and the WhatsApp line all lived in the not-settled arm of
             the ternary below, so on a settled month the page invited a transfer and left no way
             to tell anyone about it. The form cannot simply move up here — submitContribution
             refuses a month that already holds a confirmed row, and only the Banker may enter an
             extra — so what moves is the part that does work, with what happens to the money
             after it lands said plainly. -->
        <p class="small muted" style="margin-top:14px">Nothing here records a second transfer. Tell Vishnu and he enters it by hand as an extra: base points at the plain rate, no tier bonus, and it covers no month.</p>
        <p><a class="link-rule" id="wa-extra" target="_blank" rel="noopener"
              href="${escapeHtml(waLink(store.member('mem_vishnu')?.phone || '', extraNote))}">Message Vishnu on WhatsApp</a></p>
      </details>

      <label class="row-between ask-switch" style="margin-top:20px">
        <span><b>Autopilot</b><span class="small muted">A standing order for the ${num(`${s.dueDay}th`)} — Aruba Bank and Banco di Caribe both do it free, online — with the reference in the description, once.</span></span>
        <input class="switch" type="checkbox" id="autopilot" name="standingOrder" ${me.standingOrder ? 'checked' : ''}>
      </label>` : `
      <div class="panel" style="margin-top:22px">
        <h2>1 · Make the transfer</h2>
        ${bankDetails}
        <p class="small muted" style="margin-top:14px">Florins between local banks land in seconds through I-Pago. A US-dollar transfer can take a business day. Your points follow the amount that actually arrives — bank fees and exchange spread are yours, and the Circle never rounds in its own favour.</p>
      </div>

      <div class="panel">
        <h2>2 · Tell Vishnu</h2>
        ${pending ? `<div class="notice" style="margin-top:12px"><b>Already sent</b>
            <p class="small">You marked ${figs(fmtUsd2(pending.expectedUsd))} as sent on ${escapeHtml(fmtDay(pending.submittedAt))}, reference ${num(pending.reference)}. It is in the Banker’s queue.</p>
            <button type="button" class="link-rule" id="withdraw">Withdraw it</button></div>`
          : `<form id="sent" style="margin-top:12px">
            <div class="pair">
              <label class="field"><span>Amount sent</span><input name="amountUsd" type="number" inputmode="decimal" step="0.01" min="1" value="${me.monthlyUsd}" required></label>
              <label class="field"><span>Currency</span><select name="currency"><option value="USD">US dollars</option><option value="AWG">Aruban florin</option></select></label>
            </div>
            <label class="field"><span>Date sent</span><input name="sentOn" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
            <label class="field"><span>From which bank</span><select name="bank">${['Aruba Bank', 'Banco di Caribe', 'CMB', 'RBC Royal Bank', 'Other'].map(b => `<option>${b}</option>`).join('')}</select></label>
            <label class="field"><span>Anything Vishnu should know</span><textarea name="note" rows="2" placeholder="Optional — for example, my wife sent it from her account."></textarea></label>
            <label class="field"><span>Screenshot of the transfer (optional)</span><input name="proof" type="file" accept="image/*" style="padding:10px">
              <span class="hint">Helpful, never required. The bank statement is what actually matches.</span></label>
          </form>`}
      </div>
      ${pending ? '' : `<div class="act-bar"><button class="btn block" type="submit" form="sent">${icon('send', { size: 17 })}I sent it</button>
        <a class="link-rule" id="wa" target="_blank" rel="noopener" href="${escapeHtml(waLink(store.member('mem_vishnu')?.phone || '', TEMPLATES.transferSent({ member: me, amountUsd: me.monthlyUsd, month, reference })))}">Message Vishnu on WhatsApp</a></div>`}`}
    </div></section></div>`);
  wrap.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { const ok = await copyText(c.dataset.copy); toast(ok ? 'Copied.' : 'Select and copy it by hand.'); return; }
    if (e.target.id === 'withdraw') {
      const yes = await confirmDialog({ title: 'Withdraw this contribution?', message: 'It disappears from the Banker’s queue. You can mark it as sent again at any time.', confirmText: 'Withdraw' });
      if (yes) { await store.withdrawContribution(pending.id, store.me.id); toast('Withdrawn.'); }
    }
  });
  // The same fact the Details pane keeps: a standing order is set, so nothing here needs doing.
  wrap.querySelector('#autopilot')?.addEventListener('change', async (e) => {
    const on = e.target.checked;
    try { await store.updateMember(me.id, { standingOrder: on }, me.id); toast(on ? 'On autopilot. The reference still has to be in the description.' : 'Autopilot off.'); }
    catch (err) { e.target.checked = !on; toast(err.message, { kind: 'bad', timeout: 7000 }); }
  });
  wrap.querySelector('#sent')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    // The submit lives in the docked bar under the form, tied to it by its form attribute.
    const btn = e.submitter || wrap.querySelector('button[type=submit][form="sent"]');
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
  const confirmedN = store.contributionsFor(me.id).filter(c => c.status === 'confirmed').length;
  const backing = lt.backingUsd ?? lt.paidUsd;

  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">${month ? escapeHtml(fmtMonth(month)) + ' statement' : 'Every line, since you joined'}</p>
      <h1>${month ? escapeHtml(fmtMonth(month)) : 'Your ledger'}</h1>
      <label class="field no-print" style="margin-top:16px"><span>Month</span>
        <select id="month-pick" aria-label="Choose a month">
          <option value="">Everything</option>
          ${months.map(m => `<option value="${m}"${m === month ? ' selected' : ''}>${escapeHtml(fmtMonth(m))}</option>`).join('')}
        </select></label>
      ${closed ? `<div class="notice good"><b>Sealed</b>
        <p class="small">${escapeHtml(fmtMonth(month))} was closed by ${escapeHtml(store.member(closed.closedBy)?.name || 'the Banker')} on ${escapeHtml(fmtDay(closed.closedAt))} and co-signed by ${escapeHtml(store.member(closed.cosignedBy)?.name || 'an officer')}. Coverage at close: ${num(fmtPct(closed.coverage))}.</p></div>` : ''}

      <p class="dateline">Sent ${num(fmtUsd2(lt.paidUsd))} · ${num(confirmedN)} confirmed · ${backing === lt.paidUsd ? 'all of it' : num(fmtUsd2(backing))} to the Reserve</p>
      <p class="dateline">Available ${num(fmtPoints(lt.available))} (${num(pointsUsd(lt.available, s.pointsPerDollar))})${lt.committed ? ` · ${num(fmtPoints(lt.committed))} committed` : ''}</p>
      ${lt.promoPoints ? `<p class="small muted" style="margin-top:8px">${num(fmtPoints(lt.promoPoints))} of that is bonus points</p>` : ''}

      <div class="panel" style="margin-top:20px">
        <h2>Points, line by line</h2>
        <ul class="ledger" style="margin-top:10px" id="rows"></ul>
        <button class="btn ghost block" id="rows-more" type="button" style="margin-top:12px" hidden></button>
      </div>

      <div class="panel">
        <h2>Contributions</h2>
        <ul class="ledger" style="margin-top:10px" id="contrib-rows"></ul>
      </div>

      ${!month && months.length ? `<div class="panel no-print">
        <h2>Statements, month by month</h2>
        <ul class="job-list" style="margin-top:12px" id="month-list"></ul>
      </div>` : ''}

      <div class="stack tight no-print">
        <p><button type="button" class="link-rule" id="csv">Download as CSV</button></p>
        <p><button type="button" class="link-rule" id="print">Print</button></p>
      </div>
    </div></section></div>`);

  const contribs = store.contributionsFor(me.id).filter(c => !month || c.forMonth === month || (c.extra && (c.reviewedAt || '').slice(0, 7) === month));
  // The state is an ink tag; a returned transfer is the one flagged, with the Banker's reason.
  const stateTag = (c) => {
    const st = c.status === 'rejected' ? 'rejected' : c.status;
    const flagged = st === 'rejected';
    return `<span class="tag"${flagged ? ' style="color:var(--flag);border-color:var(--flag)"' : ''}>${escapeHtml(statusLabel(st)).toUpperCase()}</span>`;
  };
  wrap.querySelector('#contrib-rows').innerHTML = contribs.map(c => `<li>
      <span class="what"><b>${c.extra ? 'Extra' : escapeHtml(fmtMonth(c.forMonth))}</b>
        <span class="meta">${num(c.reference || (c.extra ? c.note || 'handed over' : '—'))}${c.reviewedAt && c.status === 'confirmed' ? ` · by ${escapeHtml(store.member(c.reviewedBy)?.name.split(' ')[0] || 'the Banker')} · ${escapeHtml(fmtDayTime(c.reviewedAt))}` : ''}</span>
        ${c.reason ? `<span class="meta">${escapeHtml(c.reason)}</span>` : ''}</span>
      <span class="delta">${c.points == null ? '' : `<b class="${c.points > 0 ? 'pos' : ''}">${c.points > 0 ? '+' : ''}${Math.round(c.points).toLocaleString('en-US')}</b>`}
        <small>${escapeHtml(fmtUsd2(c.expectedUsd))} sent${c.receivedUsd == null ? '' : ` · ${escapeHtml(fmtUsd2(c.receivedUsd))} received`}</small></span>
      <span>${stateTag(c)}</span>
    </li>`).join('') || '<li><span class="what"><b>Nothing yet</b></span></li>';

  let running = 0;
  const ordered = [...rows].reverse();
  const withRunning = ordered.map(l => ({ ...l, running: (running += l.points) })).reverse();

  // The ledger is every line since you joined and it only ever gets longer — twenty-eight lines
  // is already 2,287px on a phone, and a member three years in would be scrolling for a minute
  // to reach the bottom. The newest are the ones anyone is looking for; the rest are one tap
  // away, and the month picker and the CSV are there for going properly digging.
  const FIRST = 20;
  const moreBtn = wrap.querySelector('#rows-more');
  let allRows = withRunning.length <= FIRST + 4;
  const drawRows = () => {
    const shown = allRows ? withRunning : withRunning.slice(0, FIRST);
    moreBtn.hidden = allRows;
    wrap.querySelector('#rows').innerHTML = shown.map(l => `<li>
      <span class="what"><b>${figs(l.note)}</b>
        <span class="meta">${escapeHtml(KIND_LABEL[l.kind] || l.kind)} · ${escapeHtml(fmtDayTime(l.at))}${l.by ? ` · ${escapeHtml(store.member(l.by)?.name.split(' ')[0] || '')}` : ''}${l.expiresAt ? ` · expires ${escapeHtml(fmtDay(l.expiresAt))}` : ''}</span></span>
      <span class="delta"><b class="${l.points > 0 ? 'pos' : 'neg'}">${l.points > 0 ? '+' : ''}${Math.round(l.points).toLocaleString('en-US')}</b>
        <small>balance ${Math.round(l.running).toLocaleString('en-US')}</small></span></li>`).join('')
      || '<li><span class="what"><b>No lines yet</b><span class="meta">Your first confirmed contribution will appear here with its split.</span></span></li>';
  };
  if (!allRows) {
    moreBtn.textContent = `Show all ${withRunning.length} lines`;
    moreBtn.addEventListener('click', () => { allRows = true; drawRows(); });
  }
  drawRows();

  // Every month's statement is a real screen, so it gets a real door. The picker above is a
  // shortcut for a member who already knows the month they want; a <select> is not a link, and
  // a screen whose only way in is a change handler cannot be found by anything that reads the
  // page — not the browser's own history, not a shared link, not the crawl that proves the app
  // has no stranded routes. The rows are whole-row anchors, as every listing here is.
  const monthList = wrap.querySelector('#month-list');
  if (monthList) monthList.innerHTML = months.map(m => {
    const lines = all.filter(l => l.at.slice(0, 7) === m);
    const pts = lines.reduce((n, l) => n + l.points, 0);
    const sealed = store.state.monthCloses.some(c => c.month === m);
    return `<li><a href="#/ledger/${escapeHtml(m)}">
      <span class="job-what"><b>${escapeHtml(fmtMonth(m))}</b>
        <span class="small muted">${num(`${pts > 0 ? '+' : ''}${Math.round(pts).toLocaleString('en-US')}`)} points · ${num(lines.length)} ${lines.length === 1 ? 'line' : 'lines'}${sealed ? ' · sealed' : ''}</span></span>
      ${chevron()}</a></li>`;
  }).join('');

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
  const wrap = el(`<div class="nocturne nocturne-page" style="background:var(--ground);color:var(--ink)">
    <section class="sec"><div class="wrap">
      <p class="eyebrow">${escapeHtml(tierName(me.monthlyUsd))} · ${escapeHtml(VOCAB.clubName)}</p>
      <h1 style="margin-top:6px">Your card</h1>
      <div id="card" style="margin-top:20px"></div>
      <p class="stamp" style="margin-top:12px">TAP TO TURN OVER</p>

      <div class="panel" style="margin-top:20px;display:grid;gap:14px;justify-items:center">
        <p class="eyebrow">${icon('idCard')}Scan to identify you</p>
        <div class="qr-holder" id="qr"></div>
        <p class="tiny muted" style="text-align:center">Any phone camera reads it. It opens your entry in the Circle, so Victor or Ian can pull you up at a hotel desk without asking your surname twice.</p>
      </div>

      <div class="panel">
        <p class="eyebrow">${icon('idCard')}Keep it on your phone</p>
        <p class="small muted" id="wallet-note" style="margin-top:8px"></p>
        <div class="stack tight" style="margin-top:12px">
          <button class="btn block" id="install">Put Hunto on your home screen</button>
          <button class="btn ghost block" id="save">Save the card to your photos</button>
          <button class="btn ghost block" id="share">Send it to someone</button>
          <button class="btn ghost block" id="wallet" hidden>Add to Apple Wallet</button>
          <p><button type="button" class="link-rule" id="print">Print it, card sized</button></p>
        </div>
      </div>

      <div class="panel">
        <div class="row-between"><span class="small muted">Available</span><b class="num">${escapeHtml(fmtPoints(lt.available))}</b></div>
        <div class="row-between" style="margin-top:8px"><span class="small muted">Worth</span><b class="num">${escapeHtml(pointsUsd(lt.available, s.pointsPerDollar))}</b></div>
        <div class="row-between" style="margin-top:8px"><span class="small muted">Earning</span><b class="num">${escapeHtml(fmtPoints(pointsPerMonth(s, me.monthlyUsd)))} a month</b></div>
        <div class="row-between" style="margin-top:8px"><span class="small muted">Insider since</span><b class="num">${escapeHtml(fmtDay(me.joinedAt))}</b></div>
        <div class="row-between" style="margin-top:8px"><span class="small muted">Card code</span><b class="num">${escapeHtml(me.cardCode || '—')}</b></div>
      </div>
    </div></section></div>`);
  wrap.querySelector('#card').appendChild(memberCard(me, { store }));

  const note = wrap.querySelector('#wallet-note');
  const installBtn = wrap.querySelector('#install');
  if (isStandalone()) {
    installBtn.hidden = true;
    note.textContent = 'Hunto is already on your home screen, so the card is one tap away — no pass needed.';
  } else {
    note.textContent = 'It opens like an app, works offline, and the card is one tap away — with the QR always current, which a saved picture is not.';
  }
  installBtn.addEventListener('click', async () => {
    if (await showInstall() === 'accepted') installBtn.hidden = true;
  });

  import('../ui/wallet.js').then(async (W) => {
    import('../ui/qr.js').then(({ renderQr }) => renderQr(wrap.querySelector('#qr'), W.cardUrl(me), { size: 224 }))
      .catch(() => { wrap.querySelector('#qr').textContent = me.cardCode || ''; });

    const walletBtn = wrap.querySelector('#wallet');
    // Apple Wallet only appears once the club actually holds a signing certificate. A button
    // that cannot do the thing it says is worse than no button, and this one sat at the top of
    // the list telling everybody who pressed it to go and read a README.
    const configured = !!store.walletConfig?.()?.url;
    walletBtn.hidden = !configured;
    if (configured) note.textContent += ' A Wallet pass is also available below.';

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

// The jobs a role opens.
//
// There is no separate administrator's application and no second login. Victor, Ian and Vishnu
// hold seats like everybody else — they contribute, they hold points, they ask for stays — and
// the work they do for the Circle sits inside their own profile, at the top of the door list.
// An Insider with no role never sees any of it.
const JOBS = [
  { roles: ['planner', 'comms', 'admin'], label: 'The Desk', href: '#/desk' },
  // 'admin' sits in this list because the router lets an administrator through every guarded
  // route (app.js appends it to each roles list). Without it here Victor was admitted to the
  // bank but offered no door to it.
  { roles: ['treasurer', 'deputy', 'admin'], label: 'The Banker’s inbox', href: '#/bank' },
  { roles: ['admin', 'treasurer'], label: 'Settings', href: '#/settings' },
];
// Every screen that has no tab, one visible row from the name in the bar.
const DOORS = [
  ['#/card', 'Your card'], ['#/pay', 'Send a contribution'], ['#/ledger', 'Your ledger'],
  ['#/requests', 'Everything you have asked for'], ['#/watching', 'What you are watching'],
  ['#/pool', 'The Pool'], ['#/cruises', 'Cruises and trips'], ['#/rules', 'How it works'],
];

/** The door list: the officer's doors first, with what is waiting behind each, then everyone's. */
function doorList(store) {
  const row = (href, label, count = 0) => `<li><a href="${escapeHtml(href)}"><span class="job-what">${escapeHtml(label)}${
    count ? `<span class="nav-badge">${count > 9 ? '9+' : count}</span><span class="sr-only">, ${count} waiting</span>` : ''}</span>${chevron()}</a></li>`;
  let officer = '';
  if (store.isOfficer()) {
    // The same call the bar makes for the badge on the name, split by the door each job is behind.
    const waiting = (() => { try { return store.officerWork(); } catch { return []; } })();
    officer = JOBS.filter(j => store.hasRole(...j.roles)).map(j => {
      const due = waiting.filter(w => w.href.startsWith(j.href));
      return row(j.href, j.label, due.reduce((n, w) => n + (w.count ?? 1), 0));
    }).join('');
  }
  return `<ul class="job-list" id="doors">${officer}${DOORS.map(([h, l]) => row(h, l)).join('')}</ul>`;
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
      <span class="tiny muted">${num(held.length)} held${pins.length ? ` · ${num(pins.length)} shown` : ''}</span></div>
    <p class="small muted" style="margin-top:6px">Pick up to three to show beside your name. Tap one to pin or unpin it.</p>
    <div class="badge-grid" style="margin-top:14px">${held.length ? held.map(h => `
      <button type="button" class="badge-card owned" data-pin="${escapeHtml(h.badgeKey)}"
              aria-pressed="${pins.includes(h.badgeKey)}">
        ${badgeMark(h.badge, { size: 26, tone: h.badge.kind === 'founder' ? 'is-founder' : h.badge.kind === 'bought' ? 'is-bought' : '' })}
        <span><b>${escapeHtml(h.badge.name)}</b><span class="why">${escapeHtml(h.badge.blurb)}</span></span>
      </button>`).join('') : '<p class="small muted">None yet. The earned ones arrive on their own.</p>'}</div>

    ${shop.length ? `<hr class="rule" style="margin:20px 0">
    <div class="row-between"><h2>For sale</h2>
      <span class="tiny muted">you have ${num(fmtPoints(lt.available))}</span></div>
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

/**
 * A member's own corner. Deliberately small — one line.
 *
 * It used to open on "A line about you, a colour, and a picture. It shows on your card in the
 * Circle and nowhere else", and every word of the second sentence was untrue: nothing in the app
 * reads member.cover or member.accent back. memberCard() draws the guilloche, the wordmark, the
 * name, the tier and the foot line, and has no slot for a picture at all — so the cover the
 * member chose was written to both backends and then never looked at again. One of the six
 * covers, 'hero', did not even name a file in the repo (it is hero-tall.jpg), so wiring it up as
 * written would have 404'd. The colour went the same way, and could not be painted as it stood
 * either: 'Coral' is --flag, which tokens.css reserves for returned, declined or expired and
 * always with a sentence, and 'Ink' and 'Deep' resolve to the same token.
 *
 * So both pickers come out rather than stand under a promise the app cannot keep. The columns
 * stay on the member in both backends and in SQL, untouched by the patch below, so whoever gives
 * the card a cover layer can put the picker back the same day.
 */
function drawCorner(panel, { store, me, refresh }) {
  panel.innerHTML = `
    <h2>Your corner</h2>
    <form id="corner" style="margin-top:14px">
      <label class="field"><span>A line about you</span>
        <input name="about" maxlength="200" placeholder="Always in the sea before breakfast."
               value="${escapeHtml(me.about || '')}">
        <span class="hint">200 characters. It is a line, not an essay.</span></label>
      <button class="btn block" type="submit">Save your corner</button>
    </form>`;

  panel.querySelector('#corner').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      // Only `about` goes in the patch. A key left out is a key left alone on both backends, so
      // a member who set a colour or a cover before today keeps what they set.
      await store.updateMember(me.id, { about: f.get('about') }, me.id);
      toast('Saved.', { kind: 'good' }); refresh();
    } catch (err) { toast(err.message, { kind: 'bad' }); }
  });
}

export function profile({ store, go, refresh }) {
  const me = store.me, s = store.settings;
  const exit = store.exitQuote(me.id);
  const theme = getTheme();
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">${escapeHtml(tierName(me.monthlyUsd))}${me.founding ? ` · ${escapeHtml(VOCAB.founding)}` : ' Insider'}</p>
      <h1>${escapeHtml(me.name)}</h1>
      <!-- An officer holds a seat like everybody else, so the head says the seat first and the
           job after it. Printing the title alone opened Victor's own profile on no figure at
           all, where every other member's opens on what they send and the day they joined. -->
      <p class="lede" style="margin-top:10px">${num(fmtUsd2(me.monthlyUsd))} a month · joined ${escapeHtml(fmtDay(me.joinedAt))}${me.title ? ` · ${escapeHtml(me.title)}` : ''}</p>

      <!-- Every screen without a tab, one row from the name in the bar; an officer's doors first. -->
      <div class="rule-block" style="margin-top:16px">${doorList(store)}</div>

      <!-- Seven unrelated panels on one scroll — level, details, badges, your corner, jobs,
           pausing, data — ran to 5.4 screens on a phone. Same shape as Settings had, so the
           same answer: four rooms, and you land on the level, which is the thing anyone comes
           here to change. Every pane stays in the DOM and is only hidden, so the forms below
           keep the handlers they are given at build time. -->
      <div class="segmented even no-print" role="group" aria-label="Profile sections" id="tabs">
        <button type="button" data-tab="level" aria-pressed="true">Level</button>
        <button type="button" data-tab="details" aria-pressed="false">Details</button>
        <button type="button" data-tab="badges" aria-pressed="false">Badges</button>
        <button type="button" data-tab="account" aria-pressed="false">Account</button>
      </div>

      <div data-pane="level">
      <div class="panel" style="margin-top:20px">
        <h2>Your contribution level</h2>
        <div class="choices" id="tiers" style="margin-top:14px"></div>
        <p class="eyebrow" style="margin-top:22px">What each level carries</p>
        <div style="margin-top:10px">${tierLadder(s, { mine: me.monthlyUsd })}</div>
      </div>
      </div>

      <div data-pane="details" hidden>
      <div class="panel" style="margin-top:20px">
        <h2>Details</h2>
        <form id="details" style="margin-top:12px">
          <label class="field"><span>Name</span><input name="name" value="${escapeHtml(me.name)}" required autocomplete="name"></label>
          <label class="field"><span>Phone</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" enterkeyhint="done" value="${escapeHtml(me.phone || '')}" placeholder="+297 000 0000"></label>
          <label class="field"><span>Your dream stay</span><select name="dreamStayId">
            ${store.arubaStays().map(st => `<option value="${st.id}"${st.id === me.dreamStayId ? ' selected' : ''}>${escapeHtml(st.name)}</option>`).join('')}</select>
            <span class="hint">This is the one your home screen counts nights toward.</span></label>
          <label class="row-between ask-switch" style="margin-bottom:12px"><span><b>Standing order</b><span class="small muted">I have one set for the ${num(`${s.dueDay}th`)}.</span></span><input class="switch" type="checkbox" name="standingOrder" ${me.standingOrder ? 'checked' : ''}></label>
          <label class="row-between ask-switch" style="margin-bottom:12px"><span><b>Roll call</b><span class="small muted">Show my name on the monthly roll call. Off by default; only the count is public.</span></span><input class="switch" type="checkbox" name="showOnRollcall" ${me.showOnRollcall ? 'checked' : ''}></label>
          <button class="btn block" type="submit">Save</button>
        </form>
      </div>
      </div>

      <div data-pane="badges" hidden>
      <div class="panel" style="margin-top:20px" id="badges-panel"></div>
      <div class="panel" id="corner-panel"></div>
      </div>

      <div data-pane="account" hidden>
      <div class="panel" style="margin-top:20px">
        <h2>Appearance</h2>
        <div class="segmented even" role="group" aria-label="Appearance" id="theme">
          ${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" data-theme="${k}" aria-pressed="${theme === k}">${l}</button>`).join('')}
        </div>
      </div>

      <div class="panel">
        <h2>Pausing and leaving</h2>
        <p class="small muted" style="margin-top:6px">Both are yours to do, whenever you like. Neither costs you the points you hold.</p>
        <div class="stack tight" style="margin-top:14px">
          ${me.status === 'paused'
            ? `<button class="btn ghost block" id="resume">Resume contributing</button>`
            : `<button class="btn ghost block" id="pause">Pause for a few months</button>`}
        </div>
        <p class="small muted" style="margin-top:12px">If you left today you hold ${figs(fmtPoints(exit.basePoints))} base points. After a twelve-month window to use them, ${figs(fmtUsd2(exit.basePoints / s.pointsPerDollar))} − ${figs(fmtUsd2(exit.feeUsd))} = <b>${num(fmtUsd2(exit.refundUsd))}</b> comes back to you. ${figs(fmtPoints(exit.promoPoints))} of bonus points and the Circle’s share are not refunded.</p>
        <button type="button" class="link-rule danger" id="leave" style="color:var(--flag)">Leave the Circle</button>
      </div>

      <div class="panel">
        <h2>Your data</h2>
        <p class="small muted" style="margin-top:6px">${store.mode === 'supabase'
          ? 'Everything you see here is held by the Circle, not by this phone — sign in anywhere and it follows you. A copy is still yours to keep whenever you want one.'
          : 'This is a preview running in your browser, and Safari clears it after about a week of not visiting. Keep a copy if you want it to survive.'}</p>
        <div class="stack tight" style="margin-top:12px">
          <p><button type="button" class="link-rule" id="export">Export everything as JSON</button></p>
          <button class="btn ghost block" id="signout">Sign out</button>
        </div>
      </div>
      </div>
    </div></section></div>`);

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
    // The one appearance choice, kept in theme.js so the whole app and the status bar follow it.
    const seg = wrap.querySelector('#theme');
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-theme]'); if (!b) return;
      const mode = setTheme(b.dataset.theme);
      seg.querySelectorAll('[data-theme]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.theme === mode)));
    });
  }

  wrap.querySelector('#tiers').innerHTML = s.tiers.map(t => `<button type="button" class="choice" aria-pressed="${t.monthlyUsd === me.monthlyUsd}" data-amt="${t.monthlyUsd}">
      <span class="amt">$${t.monthlyUsd}</span><span class="tier">${escapeHtml(tierName(t.monthlyUsd))}</span></button>`).join('');
  wrap.querySelector('#tiers').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-amt]'); if (!b) return;
    const amt = Number(b.dataset.amt); if (amt === me.monthlyUsd) return;
    try {
      await store.updateMember(me.id, { monthlyUsd: amt }, me.id);
      wrap.querySelectorAll('#tiers [data-amt]').forEach(x => x.setAttribute('aria-pressed', String(Number(x.dataset.amt) === amt)));
      toast(`${VOCAB.pap.congrats[0]}! From your next contribution you are ${tierName(amt)}.`, { kind: 'good' });
    } catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); }
  });
  wrap.querySelector('#details').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const btn = e.submitter || e.target.querySelector('[type=submit]');
    setBusy(btn, true, 'Saving…');
    try {
      await store.updateMember(me.id, { name: f.get('name'), phone: f.get('phone'), dreamStayId: f.get('dreamStayId'), standingOrder: !!f.get('standingOrder'), showOnRollcall: !!f.get('showOnRollcall') }, me.id);
      toast('Saved.', { kind: 'good' });
    } catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); }
    finally { setBusy(btn, false); }
  });
  wrap.querySelector('#pause')?.addEventListener('click', async () => {
    const until = await sheet({ title: 'Pause your contributions', render: (body, close) => {
      body.innerHTML = `<p class="sheet-text">Up to three months. Your streak freezes at ${num(store.streak(me.id))} rather than resetting, and everything you hold stays usable.</p>
        <label class="field"><span>Resume from</span><select name="until">${[1, 2, 3].map(n => { const d = new Date(); d.setMonth(d.getMonth() + n); const m = monthKey(d); return `<option value="${m}">${escapeHtml(fmtMonth(m))}</option>`; }).join('')}</select></label>
        <div class="sheet-actions"><button type="button" class="btn block" data-ok>Pause</button></div>`;
      body.querySelector('[data-ok]').addEventListener('click', () => close(body.querySelector('select').value));
    } });
    if (until) { try { await store.pauseMember(me.id, until, me.id); toast(`Paused until ${fmtMonth(until)}. Your streak is frozen, not reset.`); } catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); } }
  });
  wrap.querySelector('#resume')?.addEventListener('click', async () => { try { await store.resumeMember(me.id, me.id); toast('Welcome back.', { kind: 'good' }); } catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); } });
  wrap.querySelector('#leave').addEventListener('click', async () => {
    const yes = await confirmDialog({ title: 'Leave the Circle?', danger: true, confirmText: 'Give notice',
      message: `You hold ${fmtPoints(exit.basePoints)} base points. You have twelve months to use them on stays; after that ${fmtUsd2(exit.refundUsd)} comes back to you at face value. Bonus points are not refunded. Ian will be in touch.` });
    // The one that must never fail silently: a member who confirmed "Give notice" and then saw
    // nothing had no idea whether they had resigned.
    if (yes) { try { await store.leaveMember(me.id, me.id); toast('Notice given. Ian will be in touch this week.'); go('/home'); } catch (err) { toast(`That did not go through — you have NOT left. ${err.message}`, { kind: 'bad', timeout: 9000 }); } }
  });
  drawBadges(wrap.querySelector('#badges-panel'), { store, me, refresh });
  drawCorner(wrap.querySelector('#corner-panel'), { store, me, refresh });

  wrap.querySelector('#export').addEventListener('click', () => downloadText(`${VOCAB.clubName.toLowerCase()}-backup.json`, store.exportJson(), 'application/json'));
  wrap.querySelector('#signout').addEventListener('click', async () => { await store.signOut(); toast(`${VOCAB.pap.bye[0]} · ${VOCAB.pap.bye[1]}`); go('/'); });
  return wrap;
}
