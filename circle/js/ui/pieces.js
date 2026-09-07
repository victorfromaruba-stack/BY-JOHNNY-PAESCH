// The signature pieces: the Split bar, the Pool gauge, the Ring, the member Card.
import { escapeHtml, fmtUsd2, fmtPoints, fmtPct, prefersReducedMotion } from '../core/util.js';
import { contourSvg, treeSvg } from './art.js';
import { VOCAB, tierName } from '../core/vocab.js';
import { pointsPerMonth } from '../core/money.js';

/**
 * What a level actually carries, one line per thing, with the ones that differ from the level
 * below marked. It used to be a single run-on line — "2 open requests · 12 months ahead · 3
 * guest passes · first look 48h early" — which is all of it and none of it: nobody comparing
 * three levels can hold that in their head, and the differences are the entire point.
 *
 * Every figure is read off settings.tiers, so a rule change in the app changes this page too.
 */
export function tierTable(tier, s) {
  const tiers = [...s.tiers].sort((a, b) => a.monthlyUsd - b.monthlyUsd);
  const below = tiers[tiers.indexOf(tiers.find(x => x.monthlyUsd === tier.monthlyUsd)) - 1] || null;
  const rows = [
    ['Points a month', `${fmtPoints(pointsPerMonth(s, tier.monthlyUsd))}`,
      tier.bonusRate ? `${Math.round(tier.bonusRate * 100)}% of it a bonus the Circle funds` : 'face value, nothing taken',
      below && pointsPerMonth(s, tier.monthlyUsd) > pointsPerMonth(s, below.monthlyUsd)],
    ['Open requests', `${tier.holds} at a time`,
      'things you can have in front of the Desk at once',
      below && tier.holds > below.holds],
    ['Booking window', `${tier.windowMonths} months ahead`,
      'how far out you can ask for a week in Aruba',
      below && tier.windowMonths > below.windowMonths],
    ['Guest passes', `${tier.guestCerts} a year`,
      'for somebody who is not in the Circle; household is always free',
      below && tier.guestCerts > below.guestCerts],
    ['First look at a deal',
      tier.firstLookHours >= 168 ? `${Math.round(tier.firstLookHours / 24)} days early`
        : tier.firstLookHours ? `${tier.firstLookHours} hours early` : 'when it reaches the board',
      'before a new week is shown to everyone',
      below && tier.firstLookHours > below.firstLookHours],
    ['Answered within', `${tier.slaHours ?? s.slaHours} hours`,
      'how fast the Desk comes back with a price',
      below && (tier.slaHours ?? 0) < (below.slaHours ?? 999)],
  ];
  return `<dl class="tier-detail">${rows.map(([k, v, why, better]) => `
    <div${better ? ' class="up"' : ''}>
      <dt>${escapeHtml(k)}</dt>
      <dd><b>${escapeHtml(v)}</b>${better ? '<span class="more" aria-label="more than the level below">▲</span>' : ''}
        <span class="small muted">${escapeHtml(why)}</span></dd>
    </div>`).join('')}</dl>`;
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
 * A rank crest with its name. The emblems live as SVG in circle/assets/ranks and are drawn by
 * .claude/skills/circle-images/scripts/crests.py, so the five stay a family — change the shield
 * once and all of them change.
 *
 * `size` is the emblem's width. At 28 it sits beside a name; at 96 it is the thing you are
 * looking at. Standing is deliberately not the tier: the crest says how long, the tree says
 * how much, and a member can hold a high one of either.
 */
export function rankCrest(standing, { size = 28, withName = true, sub = '' } = {}) {
  const KEY = ['seated', 'steady', 'anchor', 'oldguard', 'pillar'];
  const i = Math.max(0, Math.min(KEY.length - 1, standing?.rankIndex ?? 0));
  const el = document.createElement('span');
  el.className = 'rank-crest';
  el.innerHTML = `<img src="assets/ranks/${KEY[i]}.svg" width="${size}" height="${size}" alt=""
      loading="lazy" decoding="async" style="flex:none;display:block">
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
export function poolGauge({ coverage = 1, reserveUsd = 0, outstandingPoints = 0, verifiedAt = null, verifiedVarianceUsd = null, configured = true, size = 'chip' }) {
  const w = size === 'full' ? 220 : 132, h = size === 'full' ? 76 : 44;
  const level = configured ? Math.max(0, Math.min(coverage, 1.06)) : 0;
  const bowlTop = 8, bowlBottom = h - 8;
  const waterY = bowlBottom - (bowlBottom - bowlTop) * level;
  const el = document.createElement('div');
  el.className = 'gauge';
  el.innerHTML = `
    <svg width="${w * 0.42}" height="${h}" viewBox="0 0 ${w * 0.42} ${h}" role="img"
         aria-label="${configured ? `Coverage ${fmtPct(coverage)}` : 'Coverage not yet verifiable'}">
      <defs><clipPath id="bowl-${size}"><path d="M4 ${bowlTop} L${w * 0.42 * 0.22} ${bowlBottom} H${w * 0.42 - w * 0.42 * 0.22} L${w * 0.42 - 4} ${bowlTop} Z"/></clipPath></defs>
      <rect class="water" x="0" y="${waterY}" width="${w * 0.42}" height="${bowlBottom - waterY + 2}" fill="var(--good)" clip-path="url(#bowl-${size})" opacity=".9"/>
      <path d="M4 ${bowlTop} L${w * 0.42 * 0.22} ${bowlBottom} H${w * 0.42 - w * 0.42 * 0.22} L${w * 0.42 - 4} ${bowlTop}" fill="none" stroke="var(--ink)" stroke-width="1.25" stroke-linejoin="round"/>
      <line x1="2" y1="${bowlTop}" x2="${w * 0.42 - 2}" y2="${bowlTop}" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="2 3"/>
    </svg>
    <div class="g-read">
      ${configured
        ? `<b>Coverage ${escapeHtml(fmtPct(coverage))}</b>
           <span>Reserve ${escapeHtml(fmtUsd2(reserveUsd))} · backs ${escapeHtml(fmtPoints(outstandingPoints))}</span>
           <span>${verifiedAt
             ? `checked against the bank ${escapeHtml(new Date(verifiedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }))}${
                 verifiedVarianceUsd === null ? '' : Math.abs(verifiedVarianceUsd) < 0.005 ? ' · matched to the cent' : ` · ${escapeHtml(fmtUsd2(Math.abs(verifiedVarianceUsd)))} ${verifiedVarianceUsd > 0 ? 'more' : 'less'} in the account`}`
             : 'not yet checked against the bank'}</span>`
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
      <div class="sheen"></div>
      <div class="card-face">
        <div class="c-top">
          <span class="c-brand">${escapeHtml(VOCAB.wordmark)}</span>
          <span class="c-tier">${escapeHtml(tierName(tier))}${treeSvg(VOCAB.tierLean[tier] || 12, { size: 15, stroke: etch })}</span>
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
        <p style="font-size:.62rem;opacity:.85">Leave any time: base points are refunded at face minus $25 after a 12-month window. Points are not deposits or investments.</p>
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
  // Touch devices have no pointer to follow: a slow idle sheen keeps the card alive.
  if (window.matchMedia('(hover: none)').matches) {
    let on = false;
    setInterval(() => { on = !on; wrap.querySelector('.card-obj')?.classList.toggle('shine', on); set(on ? 78 : 22, 50); }, 8000);
  }
}

/**
 * A badge mark. Flat single-weight line art, deliberately not the prestige-crest treatment:
 * these appear at 26px in a grid of two dozen, and a bevelled gold shield at that size is a
 * dark blob. Silhouette first, and the same stroke weight across the whole set so one heavy
 * mark cannot ruin a row.
 */
export function badgeMark(badge, { size = 26, tone = '' } = {}) {
  const mark = badge?.mark || 'star';
  return `<span class="badge-mark ${tone}" style="--s:${size}px" role="img"
    aria-label="${escapeHtml(badge?.name || 'Badge')}"><img src="assets/badges/${escapeHtml(mark)}.svg"
    width="${size}" height="${size}" alt="" loading="lazy"></span>`;
}

/** The three badges someone chose to show, beside their name. */
export function badgeRow(pinned, { size = 22 } = {}) {
  if (!pinned?.length) return '';
  return `<span class="badge-row">${pinned.map(p => badgeMark(p.badge, {
    size, tone: p.badge.kind === 'founder' ? 'is-founder' : p.badge.kind === 'bought' ? 'is-bought' : '',
  })).join('')}</span>`;
}
