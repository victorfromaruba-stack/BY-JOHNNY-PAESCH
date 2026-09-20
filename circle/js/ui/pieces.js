// The signature pieces: the Split bar, the Pool gauge, the Ring, the member Card.
import { escapeHtml, fmtUsd2, fmtPoints, fmtPct, prefersReducedMotion } from '../core/util.js';
import { contourSvg } from './art.js';
import { VOCAB, tierName } from '../core/vocab.js';
import { pointsPerMonth } from '../core/money.js';

/**
 * The three levels side by side, once.
 *
 * This used to be three identical panels, each repeating the same six labels with a different
 * number in it — 2,812px of phone scroll, a quarter of the landing page, to convey six small
 * differences. Nobody compares three levels by scrolling between three lists. One grid: the
 * labels down the left, the levels across the top, the numbers where they meet.
 *
 * Every figure is read off settings.tiers, so a rule change in the Desk changes this too. The
 * extra rows are the concrete ones the caller can price — "3 nights at Amsterdam Manor: 4
 * months / 3 months / 2 months" — because a difference you can book beats a difference you
 * have to work out.
 */
export function tierLadder(s, { mine = null, rows: extra = [], caption = '' } = {}) {
  const tiers = [...s.tiers].sort((a, b) => a.monthlyUsd - b.monthlyUsd);
  // app.css dresses every <b> inside a level column as a main row figure — 14px, weight 600, on
  // its own line — and `.lad-v b.num` then sets the mono face at 13px. A figure that belongs to
  // the small grey sub-line needs the face without the size and the weight, and app.css is not
  // this file's to change, so those two are handed back here. The class stays `num`: it is a
  // figure and it reads in the figure face, which is the whole point.
  const subFig = (txt) => `<b class="num" style="display:inline;font-size:inherit;font-weight:inherit">${escapeHtml(txt)}</b>`;
  // Days, not hours, once it divides evenly: "2 days" and "7 days" line up in a 74px column
  // and read as the same kind of thing. "48 hours" wrapped onto two lines and made the row
  // twice as tall as the ones around it. The count is split off from its unit so it can sit in
  // its own mono <b class="num"> like every other figure in the grid — it was the one row that
  // printed its number in the reading face — and the unit goes to the sub-line with "early",
  // which is the shape "Book ahead" and "Guest passes" already use.
  const firstLook = (t) => {
    if (!t.firstLookHours) return '<b>Same time</b>';
    const evenDays = t.firstLookHours % 24 === 0;
    const n = evenDays ? t.firstLookHours / 24 : t.firstLookHours;
    const unit = evenDays ? `day${t.firstLookHours === 24 ? '' : 's'}` : 'h';
    return `<b class="num">${n}</b><span class="lad-sub">${escapeHtml(unit)} early</span>`;
  };
  // The row label stands alone at 390: the one-line "why" under each label was the widest thing
  // in the grid and pushed the three figure columns into the gutter, so it is gone rather than
  // hidden. Every figure sits in its own mono <b class="num">; the words beside it stay in the
  // small face.
  const rows = [
    { k: 'Points a month',
      vals: tiers.map(t => `<b class="num">${escapeHtml(fmtPoints(pointsPerMonth(s, t.monthlyUsd)))}</b>
        <span class="lad-sub">${subFig(fmtUsd2(pointsPerMonth(s, t.monthlyUsd) / s.pointsPerDollar))}</span>`) },
    { k: 'Points on top',
      vals: tiers.map(t => (t.bonusRate ? `<b class="num good">+${Math.round(t.bonusRate * 100)}%</b>` : '<span class="lad-no">—</span>')) },
    { k: 'Open requests',
      vals: tiers.map(t => `<b class="num">${t.holds}</b>`) },
    { k: 'Book ahead',
      vals: tiers.map(t => `<b class="num">${t.windowMonths}</b><span class="lad-sub">months</span>`) },
    { k: 'Guest passes',
      vals: tiers.map(t => `<b class="num">${t.guestCerts}</b><span class="lad-sub">a year</span>`) },
    { k: 'First look at a trip',
      vals: tiers.map(t => firstLook(t)) },
    { k: 'Answered within',
      vals: tiers.map(t => `<b class="num">${t.slaHours ?? s.slaHours}</b><span class="lad-sub">hours</span>`) },
    ...extra,
  ];
  // The three column heads are the money the member is choosing between — the most consequential
  // figures on the page — and they were the only ones in the grid still set in the reading face.
  // `num` puts them in the figure face. The inline size only holds the head where it already
  // renders: `.lad-amt` asks for --t-lede but `.lad-v b` has always outranked it and served
  // --t-small, and `.lad-v b.num` would now pull it down again to the row figure's size. Which
  // of those two app.css means is a question for app.css; this changes the face, not the scale.
  const head = `<div class="lad-r lad-head" role="row">
      <div class="lad-k" role="columnheader"><span class="lad-cap">${escapeHtml(caption || 'A month costs')}</span></div>
      ${tiers.map(t => `<div class="lad-v${t.monthlyUsd === mine ? ' mine' : ''}" role="columnheader">
        ${t.monthlyUsd === mine ? '<span class="lad-you">You</span>' : ''}
        <b class="lad-amt num" style="font-size:var(--t-small)">$${t.monthlyUsd}</b>
        <span class="lad-name">${escapeHtml(tierName(t.monthlyUsd))}</span>
      </div>`).join('')}
    </div>`;
  return `<div class="ladder" role="table" aria-label="What each level carries">${head}
    ${rows.map(r => `<div class="lad-r" role="row">
      <div class="lad-k" role="rowheader"><b>${escapeHtml(r.k)}</b></div>
      ${r.vals.map((v, i) => `<div class="lad-v${tiers[i].monthlyUsd === mine ? ' mine' : ''}" role="cell">${v}</div>`).join('')}
    </div>`).join('')}</div>`;
}

/**
 * One sentence about the published rate, whichever way it falls.
 *
 * It is a sentence rather than a badge because two of the three outcomes need a reason after
 * them: being level with the published rate is fine, and being above it this week is a thing a
 * member should be told plainly, with what to do about it.
 */
export function versusLine(v, unit = 'a night') {
  if (!v) return '';
  if (v.same) return `<p class="vs same">Level with the published ${escapeHtml(fmtUsd2(v.publicUsd))} ${escapeHtml(unit)}. What you are buying here is the booking being done for you.</p>`;
  if (v.better) return `<p class="vs win">${escapeHtml(fmtUsd2(v.diffUsd))} under the published ${escapeHtml(fmtUsd2(v.publicUsd))} ${escapeHtml(unit)} — ${v.pct}% off, all in.</p>`;
  return `<p class="vs over">Above the published ${escapeHtml(fmtUsd2(v.publicUsd))} ${escapeHtml(unit)} by ${escapeHtml(fmtUsd2(v.diffUsd))} at today\u2019s board rate. Ask anyway: what Victor quotes is the rate he finds on the day, and this is the one we publish in advance and do not move.</p>`;
}

/**
 * The Split bar — wherever a dollar amount appears: backing (yours) | the Circle's share.
 * Same proportions everywhere, hairline exactly at the cut.
 */
export function splitBar({ amountUsd, shareRate = 0, points = null, showLegend = true, animate = true }) {
  const share = Math.round(amountUsd * shareRate * 100) / 100;
  const backing = Math.round((amountUsd - share) * 100) / 100;
  const pct = amountUsd ? (backing / amountUsd) * 100 : 100;
  const whole = share <= 0;                          // nothing is taken when points are bought
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="split${animate && !prefersReducedMotion() ? ' draw' : ' drawn'}" style="--cut:${pct.toFixed(2)}%" role="img"
         aria-label="${whole ? `all ${escapeHtml(fmtUsd2(backing))} backs your points`
                             : `${escapeHtml(fmtUsd2(backing))} backs your points, ${escapeHtml(fmtUsd2(share))} is the Circle's share`}">
      <i style="transform-origin:left"></i></div>
    ${showLegend ? `<div class="split-legend">
      <span><i style="background:var(--good)"></i>${whole ? 'All of it backs your points' : 'Backing'} <b>${escapeHtml(fmtUsd2(backing))}</b>${points != null ? ` <b>${escapeHtml(fmtPoints(points))}</b>` : ''}</span>
      ${whole ? '' : `<span><i style="background:var(--share)"></i>${escapeHtml(VOCAB.share)} <b>${escapeHtml(fmtUsd2(share))}</b></span>`}
    </div>` : ''}`;
  const bar = el.querySelector('.split');
  const fill = el.querySelector('.split i');
  fill.style.width = `${pct}%`;
  if (animate && !prefersReducedMotion()) requestAnimationFrame(() => { bar.classList.remove('draw'); bar.classList.add('drawn'); });
  return el;
}

/**
 * The five crests are one drawing: a shield, and one rule more inside it at each rung, with the
 * top rung the frame filled. Drawn inline in the text colour, so the same mark holds in both
 * themes and reads beside a name at 28px — the bevelled gold shield it replaces was a dark blob
 * at that size and the most template-looking object in the app at any size.
 */
function crestSvg(rung, size) {
  const n = Math.min(rung + 1, 5);
  const gap = 11, top = 62 - ((n - 1) * gap) / 2;
  const bars = Array.from({ length: n }, (_, i) => {
    const half = 15 - i * 1.6, y = top + i * gap;
    return `<path d="M${64 - half} ${y}H${64 + half}" stroke="${n === 5 ? 'var(--ground)' : 'currentColor'}" stroke-width="3.2" stroke-linecap="round"/>`;
  }).join('');
  return `<svg viewBox="0 0 128 128" width="${size}" height="${size}" fill="none" aria-hidden="true">
    <path d="M64 16 L102 27 L102 60 C102 83 87 100 64 112 C41 100 26 83 26 60 L26 27 Z" fill="${n === 5 ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="3.6" stroke-linejoin="round"/>${bars}</svg>`;
}

/**
 * A rank crest with its name. `size` is the emblem's width. At 28 it sits beside a name; at 96
 * it is the thing you are looking at. Standing is deliberately not the tier: the crest says how
 * long, the tree says how much, and a member can hold a high one of either.
 */
export function rankCrest(standing, { size = 28, withName = true, sub = '' } = {}) {
  const i = Math.max(0, Math.min(4, standing?.rankIndex ?? 0));
  const el = document.createElement('span');
  el.className = 'rank-crest';
  el.innerHTML = `${crestSvg(i, size)}
    ${withName ? `<span style="min-width:0"><b>${escapeHtml(standing?.rankName || 'Seated')}</b>${
      sub ? `<br><span class="small muted">${escapeHtml(sub)}</span>` : ''}</span>` : ''}`;
  el.style.cssText = 'display:inline-flex;align-items:center;gap:10px;min-width:0';
  if (!withName) el.title = standing?.rankName || 'Seated';
  return el;
}

/**
 * The other half of the same story, and the only place a fee now appears: what a stay costs,
 * split into the room and the Circle's share of it. Shown at the quote, where the member is
 * deciding to spend, rather than at the contribution, where they are only saving.
 */
export function quoteBar({ basePoints, servicePoints, settings, showLegend = true, animate = true }) {
  const total = (basePoints || 0) + (servicePoints || 0);
  const pct = total ? (basePoints / total) * 100 : 100;
  const usd = (p) => fmtUsd2((p || 0) / (settings?.pointsPerDollar || 100));
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="split${animate && !prefersReducedMotion() ? ' draw' : ' drawn'}" style="--cut:${pct.toFixed(2)}%" role="img"
         aria-label="${escapeHtml(fmtPoints(basePoints))} for the room, ${escapeHtml(fmtPoints(servicePoints))} the Circle's share">
      <i style="transform-origin:left"></i></div>
    ${showLegend ? `<div class="split-legend">
      <span><i style="background:var(--good)"></i>The room <b>${escapeHtml(fmtPoints(basePoints))}</b> <span class="muted">${escapeHtml(usd(basePoints))}</span></span>
      <span><i style="background:var(--share)"></i>${escapeHtml(VOCAB.share)} <b>${escapeHtml(fmtPoints(servicePoints))}</b> <span class="muted">${escapeHtml(usd(servicePoints))}</span></span>
    </div>` : ''}`;
  const bar = el.querySelector('.split'), fill = el.querySelector('.split i');
  fill.style.width = `${pct}%`;
  if (animate && !prefersReducedMotion()) requestAnimationFrame(() => { bar.classList.remove('draw'); bar.classList.add('drawn'); });
  return el;
}

/**
 * The Pool gauge — proof of reserves. A bowl silhouette filled to the coverage
 * level, with the live mono pair beside it (the gauge confirms; the figures inform).
 */
export function poolGauge({ coverage = 1, reserveUsd = 0, outstandingPoints = 0, verifiedAt = null, verifiedVarianceUsd = null, liabilityUsd = null, configured = true, size = 'chip' }) {
  const w = size === 'full' ? 220 : 132, h = size === 'full' ? 76 : 44;
  // `coverage` off the store is reserveExpectedUsd / liabilityUsd — the ledger divided by its own
  // liability. That is a real fact about the ledger's internal consistency, but it is NOT proof
  // that the money is in the account, and this gauge is the club's proof of reserves. The only
  // externally checked number in the object is the variance the Banker recorded against the bank
  // statement. So when a check exists, lead with what the BANK said and name the date; the
  // ledger's own figure drops to the line underneath, where it belongs.
  // Every figure in these three lines sits in its own mono <b class="num"> — on the one screen
  // whose whole job is to be believed, the numbers cannot be the only thing in the reading face.
  // The separator before "owes"/"backs" is glued to the figure before it with a non-breaking
  // space, so a narrow column never starts a line with a bare mid-dot.
  // The third line used to read "$153.00 less was there", three lines under "Coverage 100.0%".
  // Both were true — coverage is the bank against what is owed, the variance is the bank against
  // what the books expected — but stacked without a frame the second reads as money missing and
  // the first as a lie, on the one page a member opens to decide whether to believe us. It is a
  // reconciliation, so it is named as one. The direction is still readable: the account figure
  // sits on the line above.
  const bankUsd = verifiedAt && verifiedVarianceUsd !== null ? reserveUsd + verifiedVarianceUsd : null;
  const bankCoverage = bankUsd !== null && liabilityUsd ? bankUsd / liabilityUsd : null;
  const shown = bankCoverage === null ? coverage : bankCoverage;
  const level = configured ? Math.max(0, Math.min(shown, 1.06)) : 0;
  const bowlTop = 8, bowlBottom = h - 8;
  const waterY = bowlBottom - (bowlBottom - bowlTop) * level;
  const el = document.createElement('div');
  el.className = 'gauge';
  el.innerHTML = `
    <svg width="${w * 0.42}" height="${h}" viewBox="0 0 ${w * 0.42} ${h}" role="img"
         aria-label="${configured ? `Coverage ${fmtPct(shown)}${bankUsd === null ? ', from the ledger, not yet checked against the bank' : ', checked against the bank'}` : 'Coverage not yet verifiable'}">
      <defs><clipPath id="bowl-${size}"><path d="M4 ${bowlTop} L${w * 0.42 * 0.22} ${bowlBottom} H${w * 0.42 - w * 0.42 * 0.22} L${w * 0.42 - 4} ${bowlTop} Z"/></clipPath></defs>
      <rect class="water" x="0" y="${waterY}" width="${w * 0.42}" height="${bowlBottom - waterY + 2}" fill="var(--good)" clip-path="url(#bowl-${size})" opacity=".9"/>
      <path d="M4 ${bowlTop} L${w * 0.42 * 0.22} ${bowlBottom} H${w * 0.42 - w * 0.42 * 0.22} L${w * 0.42 - 4} ${bowlTop}" fill="none" stroke="var(--ink)" stroke-width="1.25" stroke-linejoin="round"/>
      <line x1="2" y1="${bowlTop}" x2="${w * 0.42 - 2}" y2="${bowlTop}" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="2 3"/>
    </svg>
    <div class="g-read">
      ${configured
        ? `<b>Coverage <b class="num">${escapeHtml(fmtPct(shown))}</b></b>
           <span>${bankUsd === null
             ? `Reserve <b class="num">${escapeHtml(fmtUsd2(reserveUsd))}</b> by the ledger&nbsp;· backs <b class="num">${escapeHtml(fmtPoints(outstandingPoints))}</b>`
             : `<b class="num">${escapeHtml(fmtUsd2(bankUsd))}</b> in the account on <b class="num">${escapeHtml(new Date(verifiedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }))}</b>&nbsp;· owes <b class="num">${escapeHtml(fmtPoints(outstandingPoints))}</b>`}</span>
           <span>${bankUsd === null
             ? 'from the ledger — not yet checked against the bank'
             : Math.abs(verifiedVarianceUsd) < 0.005
               ? `the ledger expected the same, to the cent`
               : `the books and the bank differ by <b class="num">${escapeHtml(fmtUsd2(Math.abs(verifiedVarianceUsd)))}</b> — the ledger expected <b class="num">${escapeHtml(fmtUsd2(reserveUsd))}</b>`}</span>`
        : `<b>Coverage: not yet verifiable</b><span>The Banker has not registered separate Reserve and Operating accounts.</span>`}
    </div>`;
  return el;
}

/**
 * The Ring — one segment per thing: contributions expected this month, nights you
 * can cover, seats on a trip. Falls back to a count above 40 segments.
 */
export function ring({ total, filled, size = 96, label = '', sub = '', stroke = 8 }) {
  const el = document.createElement('div');
  el.className = 'ring-wrap';
  if (total > 40 || size < 28) {
    el.innerHTML = `<b class="num">${filled} / ${total}</b>`;
    return el;
  }
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const segs = Math.max(1, total);
  const gap = segs > 1 ? Math.min(6, c / segs * 0.28) : 0;
  const seg = c / segs - gap;
  const parts = [];
  for (let i = 0; i < segs; i++) {
    parts.push(`<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${i < filled ? 'var(--ring-fill)' : 'var(--ring-track)'}"
      stroke-width="${stroke}" stroke-linecap="butt" stroke-dasharray="${seg} ${c - seg}"
      stroke-dashoffset="${-(i * (seg + gap))}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`);
  }
  el.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${filled} of ${total}">${parts.join('')}</svg>
    ${label ? `<span class="ring-center"><b>${escapeHtml(label)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span>` : ''}`;
  return el;
}

/**
 * The member card. Tier is a finish, never a different design; the face carries
 * a name, a tier and a tree — no numbers. Pointer tilts it; tapping flips it.
 */
export function memberCard(member, { store, flippable = true, compact = false } = {}) {
  const tier = member.monthlyUsd;
  const face = `var(--card-${tier})`, etch = `var(--card-${tier}-etch)`, line = `var(--card-${tier}-line)`;
  const wrap = document.createElement('div');
  wrap.className = 'card-tilt';
  const since = new Date(member.joinedAt).getFullYear();
  const front = `
    <div class="card-obj front" style="--face:${face};--etch:${etch};--line:${line};color:${etch}">
      <div class="contours">${contourSvg(member.id, { stroke: etch })}</div>
      <div class="card-face">
        <div class="c-top">
          <span class="c-brand">${escapeHtml(VOCAB.wordmark)}</span>
          <span class="c-tier">${escapeHtml(tierName(tier))}</span>
        </div>
        <div class="c-name">${escapeHtml(member.name)}</div>
        <div class="c-foot">
          <span>Insider since ${since}</span>
          ${member.founding ? `<span>${escapeHtml(VOCAB.founding)}</span>` : member.standingOrder ? '<span>Autopilot</span>' : '<span></span>'}
        </div>
      </div>
    </div>`;
  if (compact) { wrap.innerHTML = front; attachTilt(wrap); return wrap; }
  const last = store ? store.ledgerFor(member.id).slice(0, 3) : [];
  const back = `
    <div class="card-obj back" style="--face:${face};--etch:${etch};--line:${line};color:${etch}">
      <div class="contours" style="opacity:.25">${contourSvg(member.id + 'b', { stroke: etch })}</div>
      <div class="card-back-body">
        <div class="row-between"><span class="c-brand">${escapeHtml(VOCAB.wordmark)}</span><span class="num">${escapeHtml(member.cardCode || '')}</span></div>
        <ul style="list-style:none;margin:0;padding:0;display:grid;gap:4px;align-content:start">
          ${last.map(l => `<li class="row-between"><span>${escapeHtml(l.note)}</span><span class="num">${l.points > 0 ? '+' : ''}${l.points.toLocaleString('en-US')}</span></li>`).join('') || '<li>No lines yet.</li>'}
        </ul>
        <p style="opacity:.85">Leave any time: base points are refunded at face minus $25 after a 12-month window. Points are not deposits or investments.</p>
      </div>
    </div>`;
  const flip = document.createElement('div');
  flip.className = 'card-flip';
  flip.style.aspectRatio = '1.586';
  flip.innerHTML = front + back;
  wrap.appendChild(flip);
  if (flippable) {
    flip.tabIndex = 0; flip.setAttribute('role', 'button'); flip.setAttribute('aria-label', 'Member card — activate to turn over');
    const toggle = () => flip.classList.toggle('flipped');
    flip.addEventListener('click', toggle);
    flip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }
  attachTilt(wrap);
  return wrap;
}

function attachTilt(wrap) {
  if (prefersReducedMotion()) return;
  const set = (x, y) => { wrap.style.setProperty('--x', x); wrap.style.setProperty('--y', y); };
  wrap.addEventListener('pointermove', (e) => {
    const r = wrap.getBoundingClientRect();
    set((((e.clientX - r.left) / r.width) * 100).toFixed(1), (((e.clientY - r.top) / r.height) * 100).toFixed(1));
  });
  wrap.addEventListener('pointerleave', () => set(50, 50));
}

/**
 * The twenty-four marks, drawn here rather than fetched.
 *
 * They were <img src="assets/badges/x.svg"> and every one of them came out pure black in both
 * themes. An SVG loaded through an <img> is its own document: the stroke="currentColor" those
 * files are drawn with resolves against THAT document's initial colour, so .badge-mark's colour
 * — --ink-2, or --flight on a founder chip — never reached them. In the dark theme that is a
 * black mark on a near-black chip: 1.38:1, a chip with nothing legible in it. Inline, the marks
 * are part of this page again and currentColor is the chip's colour, which is how the rank crest
 * two hundred lines up has always done it. Twenty-four requests fall away with them.
 *
 * Every drawing is the file's, unchanged, and the files in assets/badges/ stay where they are.
 * The wrapper below carries the attributes they all shared, so the set keeps its one stroke
 * weight: a mark added here must be drawn on the same 48-unit square at the same weight.
 */
const MARKS = {
  camera: '<rect x="7" y="15" width="34" height="22" rx="4"/><circle cx="24" cy="26" r="7"/><path d="M18 15l3-4h6l3 4"/>',
  clock: '<circle cx="24" cy="24" r="15"/><path d="M24 15v10l7 4"/>',
  crown: '<path d="M8 32h32M10 32 8 16l9 7 7-11 7 11 9-7-2 16" fill="currentColor" fill-opacity=".18"/>',
  door: '<rect x="14" y="9" width="20" height="30" rx="2"/><circle cx="29" cy="25" r="1.6" fill="currentColor"/>',
  eye: '<path d="M6 24s7-10 18-10 18 10 18 10-7 10-18 10S6 24 6 24Z"/><circle cx="24" cy="24" r="4.5"/>',
  flag: '<path d="M14 40V9M14 11h20l-4 6 4 6H14"/>',
  hands: '<path d="M10 28l7-7 7 7M38 28l-7-7-7 7"/><path d="M12 30v6h24v-6"/>',
  map: '<path d="M9 13l10-4 10 4 10-4v26l-10 4-10-4-10 4Z"/><path d="M19 9v26M29 13v26"/>',
  moon: '<path d="M32 8a16 16 0 1 0 8 26A16 16 0 0 1 32 8Z"/>',
  pen: '<path d="M11 37l3-8 18-18 5 5-18 18Z"/><path d="M29 14l5 5"/>',
  pin: '<path d="M24 41s12-12 12-20a12 12 0 1 0-24 0c0 8 12 20 12 20Z"/><circle cx="24" cy="21" r="4.5"/>',
  plane: '<path d="M40 26 8 34l7-10L8 14l32 8a2.2 2.2 0 0 1 0 4Z"/>',
  plus: '<circle cx="24" cy="24" r="15"/><path d="M24 17v14M17 24h14"/>',
  pot: '<path d="M12 20h24v10a8 8 0 0 1-8 8h-8a8 8 0 0 1-8-8Z"/><path d="M9 20h30M20 14v-3M28 14v-3"/>',
  quill: '<path d="M14 34c8-18 16-22 22-22 0 12-6 20-16 22l-6 2Z" fill="currentColor" fill-opacity=".18"/><path d="M14 34l-4 4"/>',
  repeat: '<path d="M12 20a12 12 0 0 1 21-7M36 28a12 12 0 0 1-21 7"/><path d="M33 8v6h-6M15 40v-6h6"/>',
  ring: '<circle cx="19" cy="26" r="9"/><circle cx="29" cy="26" r="9"/>',
  star: '<path d="m24 9 4.6 9.7 10.4 1.5-7.5 7.5 1.8 10.6L24 33.3l-9.3 5 1.8-10.6-7.5-7.5 10.4-1.5Z"/>',
  sunrise: '<path d="M8 34h32M14 34a10 10 0 0 1 20 0M24 12v5M12 18l3 3M36 18l-3 3"/>',
  tf: '<circle cx="24" cy="24" r="15"/><path d="M17 18v7h5M22 18v13M26 18h4v13"/>',
  twelve: '<circle cx="24" cy="24" r="15"/><path d="M20 18h2v13M26 18h4v6h-4v7h4"/>',
  vault: '<rect x="9" y="10" width="30" height="28" rx="4" fill="currentColor" fill-opacity=".14"/><circle cx="24" cy="24" r="7"/><path d="M24 13v4M24 31v4M13 24h4M31 24h4"/>',
  wave: '<path d="M7 20c5-5 10-5 15 0s10 5 15 0M7 30c5-5 10-5 15 0s10 5 15 0"/>',
  wheel: '<circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="5"/><path d="M24 9v10M11 30l9-4M37 30l-9-4"/>',
};

/**
 * A badge mark. Flat single-weight line art, deliberately not the prestige-crest treatment:
 * these appear at 26px in a grid of two dozen, and a bevelled gold shield at that size is a
 * dark blob. Silhouette first, and the same stroke weight across the whole set so one heavy
 * mark cannot ruin a row. A mark nobody has drawn falls back to the star rather than to an
 * empty chip.
 */
export function badgeMark(badge, { size = 26, tone = '' } = {}) {
  const mark = MARKS[badge?.mark] ? badge.mark : 'star';
  return `<span class="badge-mark ${tone}" style="--s:${size}px" role="img"
    aria-label="${escapeHtml(badge?.name || 'Badge')}"><svg viewBox="0 0 48 48" width="${size}" height="${size}"
    fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${MARKS[mark]}</svg></span>`;
}

/** The three badges someone chose to show, beside their name. */
export function badgeRow(pinned, { size = 22 } = {}) {
  if (!pinned?.length) return '';
  return `<span class="badge-row">${pinned.map(p => badgeMark(p.badge, {
    size, tone: p.badge.kind === 'founder' ? 'is-founder' : p.badge.kind === 'bought' ? 'is-bought' : '',
  })).join('')}</span>`;
}
