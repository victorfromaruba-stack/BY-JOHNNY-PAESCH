// Public and entry screens: the landing page, the rules, sign-in, and the invitation.
import { escapeHtml, html, raw, fmtUsd2, fmtAfl2, fmtPoints, fmtPointsUsd, fmtDay, fmtPct, initials } from '../core/util.js';
import { VOCAB, tierName } from '../core/vocab.js';
import { splitContribution, tierFor, projectPoints, seasonPoints, SEASONS, REACH, pointsPerMonth, monthsToAfford } from '../core/money.js';
import { splitBar, poolGauge, memberCard, ring, tierTable } from '../ui/pieces.js';
import { sceneSvg, treeSvg, starSvg } from '../ui/art.js';
import { toast, setBusy, sheet, avatar } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { copyText } from '../core/share.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
export const stayStrip = (stay) => {
  const d = document.createElement('div');
  d.className = 'scene';
  d.innerHTML = sceneSvg(stay);
  return d;
};

/**
 * Where a week at this place actually comes from. Interval's Getaway inventory is the
 * cheapest most of the time — a Surf Club week at $90 a night against a published $850 — but
 * it is surplus, so it is not always there, and an owner on RedWeek sometimes beats it. Both
 * numbers below were seen on the real sites, on the date shown.
 */
export function sourceLine(stay) {
  const src = stay.sources;
  if (!src) return '';
  const bits = [];
  if (src.interval?.seenUsd) bits.push(`Interval from ${fmtUsd2(src.interval.seenUsd)}`);
  if (src.redweek?.fromUsd) bits.push(`RedWeek from ${fmtUsd2(src.redweek.fromUsd)}`);
  if (!bits.length) return '';
  return `<span class="sourced">${icon('search', { size: 13 })}<span>${escapeHtml(bits.join(' · '))}
    <em>a night, seen ${escapeHtml(fmtDay(src.interval?.seenOn || src.redweek?.seenOn))}</em></span></span>`;
}

/** A stay or trip card, used on the landing page and throughout the catalog. */
export function stayCard(stay, { store, season = 'low', href = null, footer = '' } = {}) {
  // store.settings, not the defaults. Without it the whole catalog priced itself off
  // DEFAULT_SETTINGS and silently ignored every rate Victor edits in the Desk — so the number
  // on the card and the number in the quote could disagree, which is the one thing a price
  // must never do.
  const per = stay.kind === 'trip' ? stay.pointsPerSeat : seasonPoints(stay, season, store?.settings);
  const node = el(`<a class="stay-card" href="${escapeHtml(href || `#/${stay.kind === 'trip' ? 'trips' : 'stays'}/${stay.id}`)}">
      <span class="strip"><span class="duo"></span><span class="ph-note">illustration</span></span>
      <span class="body">
        <h3>${escapeHtml(stay.name)}</h3>
        <span class="where">${escapeHtml(stay.area)}${stay.country !== 'Aruba' ? `, ${escapeHtml(stay.country)}` : ''}${stay.kind === 'trip' ? ` · ${stay.nights} nights` : stay.onSand ? ' · on the sand' : ' · across the road'}</span>
        <span class="price"><b class="num">${escapeHtml(fmtPoints(per))}</b><small>${escapeHtml(stay.kind === 'trip' ? `a seat · ${fmtUsd2(per / 100)}` : `a night · ${fmtUsd2(per / 100)}`)}</small></span>
        <span class="flags">${stay.house ? '<span class="tag house">Where we stay</span>' : ''}${(stay.features || []).slice(0, stay.house ? 2 : 3).map(f => `<span class="tag">${escapeHtml(f)}</span>`).join('')}</span>
        ${sourceLine(stay)}
        ${footer}
      </span></a>`);
  node.querySelector('.strip').prepend(stayStrip(stay));
  return node;
}

/**
 * A full-bleed photograph between two sections, with a line of type on it.
 *
 * These are atmosphere, not evidence: none of them is a picture of a room the Circle books, and
 * none is captioned as though it were. Lazy below the fold, and every one carries an aspect
 * ratio so the page does not jump when it loads.
 */
function band(src, alt, line, { ratio = '21/9' } = {}) {
  return `<figure class="band" style="--ratio:${ratio}">
      <img src="assets/${escapeHtml(src)}.jpg" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">
      ${line ? `<figcaption>${escapeHtml(line)}</figcaption>` : ''}
    </figure>`;
}

export function landing({ store, go }) {
  const s = store.settings;
  const t = store.treasury();
  // Signed out on the real backend, row-level security hands this browser nothing — so the
  // seat count is 0 and coverage is unverifiable, neither of which is true. Say what we
  // cannot see instead of publishing a number we did not read.
  const blind = !!store.publicOnly;
  const wrap = el('<div></div>');
  const featured = ['stay_oceanclub', 'stay_surfclub', 'stay_divi', 'stay_renaissance', 'trip_japan'].map(id => store.stayLike(id)).filter(Boolean);

  wrap.appendChild(el(`<section class="sec hero-sec">
    <div class="wrap hero">
      <div class="hero-copy">
        <h1 class="enter" style="max-width:14ch">A private travel circle in Aruba.</h1>
        <p class="lede enter" style="--d:60ms;margin-top:16px;max-width:46ch">Put in a hundred dollars a month. Take it out as hotel, at cost, with people you know.</p>
        <div class="row enter" style="--d:120ms;margin-top:22px">
          <a class="btn" href="#/sign-in">${icon('key', { size: 17 })}I have an invitation</a>
          <a class="btn ghost" href="#/rules">${icon('compass', { size: 17 })}How the Circle works</a>
        </div>
      </div>
      <figure class="hero-shot enter" style="--d:140ms">
        <picture>
          <source media="(max-width:760px)" srcset="assets/hero-tall.jpg">
          <img src="assets/hero.jpg" alt="The shallows off Aruba's west coast on a clear morning" fetchpriority="high" decoding="async">
        </picture>
        <figcaption>${icon('mapPin', { size: 14 })}The west coast — every place on the list is on this water or ten minutes from it.</figcaption>
      </figure>
      <div class="hero-gauge enter" style="--d:180ms">
        <div id="gauge-slot">${blind ? `<p class="eyebrow">${icon('shield', { size: 14 })}Proof of reserves</p>
          <p class="small muted" style="margin-top:4px;max-width:46ch">Every point is backed by money in a Reserve account that is checked against the bank
          and published inside the Circle. Sign in to see the current figure.</p>` : ''}</div>
        <div class="hero-facts">
          <div><p class="eyebrow">${icon('users', { size: 14 })}Seats</p>
            <p>${blind ? `<b class="num">${s.memberCap}</b> in all · by invitation only` : `<b class="num">${escapeHtml(String(store.activeMembers().length))}</b> of ${s.memberCap} taken · by invitation only`}</p></div>
          <div><p class="eyebrow">${icon('bed', { size: 14 })}On the list</p>
            <p><b class="num">${escapeHtml(String(store.stays.filter(x => x.kind !== 'trip').length))}</b> places · <b class="num">${escapeHtml(String(store.stays.filter(x => x.kind === "trip").length))}</b> trips</p></div>
        </div>
      </div>
    </div></section>`));
  if (!blind) wrap.querySelector('#gauge-slot').appendChild(poolGauge({ coverage: t.coverage, reserveUsd: t.reserveUsd, outstandingPoints: t.outstandingPoints, verifiedAt: t.verified?.at, verifiedVarianceUsd: t.verifiedVarianceUsd, configured: t.accountsConfigured, size: 'full' }));

  wrap.appendChild(el(`<section class="sec statement"><div class="wrap">
      <p>This is not a business, and it is not open to the public.
        <span>Every Insider is someone Victor or Ian knows, and you are here because one of them asked you.</span></p>
    </div></section>`));

  // Horizon — the dream, before the ledger
  const horizon = el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><div><h2>Where the points go</h2>
      <p>Twenty-three places on the island and the trips Victor and Ian put together. Every price is the Circle’s all-in rate — taxes, levies and resort fees included.</p>
      <p class="small muted" style="margin-top:8px">These four are where we actually end up. The trips this cycle go to the Dominican Republic, Mexico and Japan.</p></div>
      <a class="btn ghost sm" href="${blind ? '#/sign-in' : '#/stays'}">${icon('chevronRight', { size: 15 })}${blind ? 'Sign in to see them all' : 'All twenty-three'}</a></div>
      <div class="horizon-wrap"><div class="horizon" id="horizon"></div></div></div></section>`);
  const hz = horizon.querySelector('#horizon');
  // Signed out, every one of these opened a password form with no explanation — someone was
  // browsing hotels and got a login screen. Send them somewhere deliberate instead.
  featured.forEach(st => hz.appendChild(stayCard(st, { store, season: 'low', href: blind ? '#/sign-in' : null })));
  wrap.appendChild(horizon);

  // Where the money goes. Nothing is taken on the way in; the Circle is paid on the room.
  const split = el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><div><h2>Every dollar backs a point</h2>
      <p>Nothing is taken when you put money in. The Circle is paid 15% when you spend points on a room — on the thing it actually does, which is find the room and book it.</p></div></div>
      <div class="side">
        <div class="panel">
          <div class="choices" id="tier-choices" role="group" aria-label="Choose a monthly contribution"></div>
          <div id="split-slot" style="margin-top:18px"></div>
          <dl id="split-figures" class="grid g2" style="margin-top:18px"></dl>
        </div>
        <div class="panel flat"><h3>Twelve months at this level</h3><div id="projection" style="margin-top:10px"></div></div>
      </div></div></section>`);
  wrap.appendChild(split);
  let chosen = 150;
  const choices = split.querySelector('#tier-choices');
  const draw = () => {
    choices.innerHTML = s.tiers.map(t2 => `<button type="button" class="choice" aria-pressed="${t2.monthlyUsd === chosen}" data-amt="${t2.monthlyUsd}">
        <span class="amt">$${t2.monthlyUsd}</span><span class="tier">${escapeHtml(tierName(t2.monthlyUsd))} ${treeSvg(VOCAB.tierLean[t2.monthlyUsd], { size: 14 })}</span>
        <span class="tiny muted">${escapeHtml(fmtAfl2(t2.monthlyUsd, s.awgPerUsd))}</span></button>`).join('');
    const tier = tierFor(s, chosen);
    const sp = splitContribution(chosen, s, tier);
    const slot = split.querySelector('#split-slot'); slot.replaceChildren(splitBar({ amountUsd: chosen, shareRate: 0, points: sp.points }));
    split.querySelector('#split-figures').innerHTML = `
      <div class="stat"><span class="k">Points credited</span><b class="num">${escapeHtml(fmtPoints(sp.points))}</b><span class="sub">${escapeHtml(fmtUsd2(sp.points / 100))} of hotel${sp.bonusPoints ? ` · includes a ${Math.round(tier.bonusRate * 100)}% ${escapeHtml(tierName(chosen))} bonus the Circle funds` : ''}</span></div>
      <div class="stat"><span class="k">Into the Reserve</span><b class="num">${escapeHtml(fmtUsd2(sp.backingUsd))}</b><span class="sub">All of it. Held in a named account until you spend it on a room.</span></div>`;
    const p12 = projectPoints(chosen, 12, s);
    split.querySelector('#projection').innerHTML = `
      <ul class="ledger" style="margin:0">
        <li><span class="what"><b>You send</b><span class="meta">12 × ${escapeHtml(fmtUsd2(chosen))}</span></span><span class="delta"><b>${escapeHtml(fmtUsd2(p12.paidUsd))}</b></span></li>
        <li><span class="what"><b>${escapeHtml(VOCAB.share)}</b><span class="meta">Nothing now — 15% when you book</span></span><span class="delta"><b>${escapeHtml(fmtUsd2(0))}</b></span></li>
        <li><span class="what"><b>Points after a year</b><span class="meta">Includes the 6- and 12-month streak bonuses</span></span><span class="delta"><b>${escapeHtml(fmtPoints(p12.points))}</b><small>${escapeHtml(fmtUsd2(p12.points / 100))}</small></span></li>
      </ul>
      ${(() => {
        const nights = (id) => { const st = store.stayLike(id); if (!st) return null;
          const per = seasonPoints(st, 'low'); return per > 0 ? { n: Math.floor(p12.points / per), name: st.name } : null; };
        const villa = nights('stay_surfclub'), ai = nights('stay_divi');
        const both = [villa && `about ${villa.n} nights in a villa at ${escapeHtml(villa.name)} in Summer`,
                      ai && `${ai.n} all-inclusive at ${escapeHtml(ai.name)}`].filter(Boolean);
        return `<p class="small muted" style="margin-top:12px">That is ${escapeHtml(fmtPct(p12.effectiveBacking, 1))} of everything you sent, back as hotel${both.length ? ` — and ${both.join(', or ')}` : ''}.</p>`;
      })()}`;
  };
  draw();
  choices.addEventListener('click', (e) => { const b = e.target.closest('[data-amt]'); if (!b) return; chosen = Number(b.dataset.amt); draw(); });

  // What each level is for
  wrap.appendChild(el(band('band-circle', 'A long table laid for a dozen people, seen from above',
    'Forty seats. Everyone comes on everything.')));
  wrap.appendChild(el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><div><h2>Everyone comes on everything</h2>
      <p>No level shuts anyone out of a stay or a trip. What the level changes is how quickly the points build — and that is what decides, in practice, whether you are doing long weekends on the island or leaving it with the group.</p></div></div>
      <div class="grid g3">
        ${s.tiers.map(t => {
          const perMonth = pointsPerMonth(s, t.monthlyUsd);
          const aruba = store.stayLike('stay_amsterdam'), villa = store.stayLike('stay_surfclub'), trip = store.stayLike('trip_samana'), far = store.stayLike('trip_japan');
          const nights = 3;
          // A Surf Club villa sleeps eight and rents by the week; four of you chipping in is the real number.
          // Every one of these is a lookup that can come back empty on a catalog that has been
          // edited, and a missing place must cost one bullet, not the whole page.
          const villaShare = villa ? Math.round(seasonPoints(villa, 'low', s) * (villa.minNights || 7) / 4) : 0;
          const line = (ok, text) => (ok ? `<li class="small muted">${text}</li>` : '');
          return `<div class="panel">
          <div class="row-between"><div><p class="eyebrow" style="color:var(--ink-2)">$${t.monthlyUsd} a month</p>
            <h3 style="margin-top:6px">${escapeHtml(tierName(t.monthlyUsd))}</h3></div>${treeSvg(VOCAB.tierLean[t.monthlyUsd], { size: 26 })}</div>
          <p class="small" style="margin-top:10px"><b>${escapeHtml(fmtPoints(perMonth))} a month</b>${t.bonusRate ? `, including a ${Math.round(t.bonusRate * 100)}% bonus the Circle funds` : ''} — ${escapeHtml(fmtUsd2(perMonth / s.pointsPerDollar))} of hotel.</p>
          <ul class="stack" style="margin-top:10px;padding-left:1.1em;gap:6px">
            ${line(aruba, `${monthsToAfford(s, seasonPoints(aruba, 'low', s) * nights, t.monthlyUsd)} months for ${nights} nights at ${escapeHtml(aruba?.name || '')} in Summer`)}
            ${line(villa, `${monthsToAfford(s, villaShare, t.monthlyUsd)} months for your quarter of a Surf Club villa for a week`)}
            ${line(trip, `${monthsToAfford(s, trip?.pointsPerSeat, t.monthlyUsd)} months for a seat on the Samaná week`)}
            ${line(far, `${monthsToAfford(s, far?.pointsPerSeat, t.monthlyUsd)} months for ten nights in Japan`)}
          </ul>
          <p class="eyebrow" style="margin-top:16px">What the level carries</p>
          ${tierTable(t, s)}
          </div>`;
        }).join('')}
      </div>
      <p class="small muted" style="margin-top:16px">Move between levels any month; it starts on your next contribution and nothing you already hold changes. Short of a trip you want? Ask for it anyway — Victor quotes it and you accept when the points are there, or you close the gap with a cash top-up.</p>
      </div></section>`));

  // How a contribution becomes a stay
  wrap.appendChild(el(band('band-how', 'Stone steps descending to still water at first light',
    'Four steps, in order, every time.')));
  wrap.appendChild(el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><div><h2>How a contribution becomes a stay</h2></div></div>
      <div class="grid g4">
        <div class="panel"><p class="eyebrow" style="color:var(--ink-2)">1 · You</p><h3>Send the transfer</h3><p class="small muted" style="margin-top:6px">Bank transfer to the Circle’s Reserve account with your reference, then tap “I sent it”. No points yet.</p></div>
        <div class="panel"><p class="eyebrow" style="color:var(--good-text)">2 · Vishnu</p><h3>Confirms it landed</h3><p class="small muted" style="margin-top:6px">He matches the reference on the bank statement. The moment he confirms, your points are minted and dated.</p></div>
        <div class="panel"><p class="eyebrow" style="color:var(--ink-2)">3 · Victor</p><h3>Quotes the stay</h3><p class="small muted" style="margin-top:6px">You ask for dates; he comes back within 72 hours with an all-in price in points, locked for three days.</p></div>
        <div class="panel"><p class="eyebrow" style="color:var(--ink-2)">4 · The Circle</p><h3>Pays the hotel</h3><p class="small muted" style="margin-top:6px">Your points burn, the Reserve pays the hotel, and Ian sends you the confirmation.</p></div>
      </div></div></section>`));

  // Award bands
  const bands = [
    ['Boutique and low-rise', 'Amsterdam Manor · Boardwalk · voco Surfside · Eagle Aruba', 18000, 24000, 26000, 34000],
    ['Villas, rented by the week', 'Marriott’s Aruba Surf Club · Marriott’s Aruba Ocean Club', 28000, 31000, 45000, 48000],
    ['Full-service Palm Beach', 'Hilton · Holiday Inn · Courtyard · Radisson Blu · Embassy Suites', 25000, 32000, 36000, 48000],
    ['Premium', 'Aruba Marriott · Hyatt Regency · Renaissance · Manchebo · Ocean Z', 33000, 42000, 50000, 65000],
    ['Luxury', 'Ritz-Carlton · Bucuti & Tara · Aruba Ocean Villas', 55000, 75000, 85000, 120000],
    ['All-inclusive, two adults', 'Divi · Tamarijn · Barceló · RIU Palace Antillas', 45000, 55000, 60000, 75000],
  ];
  wrap.appendChild(el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><div><h2>What a night costs</h2>
      <p>Published once a year and never changed after you have booked against them. Your binding quote is Victor’s negotiated all-in rate, which is usually better.</p></div></div>
      <div class="seasons-row">
        ${[['season-summer', 'Summer', SEASONS.low.range, 'The quiet half of the year, and the cheapest.'],
           ['season-winter', 'Winter', SEASONS.high.range, 'When everyone wants to be here.'],
           ['season-peak', 'Peak', SEASONS.peak.range, 'Christmas and New Year, priced accordingly.'],
           ['season-carnival', 'Carnival', 'the weeks before Lent', 'Moves every year with Easter.']]
          .map(([img, name, when, note]) => `<figure class="season-card">
            <img src="assets/${img}.jpg" alt="" loading="lazy" decoding="async">
            <figcaption><b>${escapeHtml(name)}</b><span class="tiny muted">${escapeHtml(when)}</span>
              <span class="small muted">${escapeHtml(note)}</span></figcaption>
          </figure>`).join('')}
      </div>
      <div class="tablewrap"><table>
        <caption class="sr-only">Indicative points per night by category and season</caption>
        <thead><tr><th>Category</th><th>Summer · ${escapeHtml(SEASONS.low.range)}</th><th>Winter · ${escapeHtml(SEASONS.high.range)}</th></tr></thead>
        <tbody>${bands.map(([n, ex, a, b, c, d]) => `<tr><td><b>${escapeHtml(n)}</b><br><span class="small muted">${escapeHtml(ex)}</span></td>
          <td class="num">${a.toLocaleString('en-US')}–${b.toLocaleString('en-US')}</td><td class="num">${c.toLocaleString('en-US')}–${d.toLocaleString('en-US')}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="small muted" style="margin-top:12px">Peak — 20 December to 3 January, and Carnival week — runs 15–20% above Winter with a seven-night minimum at most resorts.</p>
      <p class="small muted" style="margin-top:8px">The two Marriott villa resorts are the odd ones out: they are vacation-ownership weeks, so they come as seven nights Saturday to Saturday and there is no resort fee. A villa there sleeps four to eight, which is why the per-night number looks high and the per-person number does not — chip in with three others and it is the cheapest week on Palm Beach.</p>
      </div></section>`));

  // The people. Found by the job they do, not by a seed id — on the real backend every row
  // has a uuid, so looking them up as mem_victor rendered an empty grid. And a signed-out
  // visitor can read no members at all, so the three jobs are described either way: those
  // are facts about how the Circle is arranged, not anybody's personal data.
  const JOBS = [
    { role: 'planner', job: 'The Desk', name: 'Victor Rosario', what: 'Finds the deals, plans the trips, and quotes every request within 72 hours.' },
    { role: 'comms', job: 'The Voice', name: 'Ian Hekman', what: 'Every message from the Circle comes from one person, so nobody is chased in a group chat.' },
    { role: 'treasurer', job: 'The Banker', name: 'Vishnu', what: 'Holds the money and confirms every transfer. Points are minted only by him, and every line in your ledger carries his name and the time.' },
  ];
  wrap.appendChild(el(band('band-pool', 'Salt pans from above, pale shapes divided by thin channels',
    'The Reserve, checked against the bank every month.')));
  wrap.appendChild(el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><div><h2>Three people, three jobs</h2></div></div>
      <div class="jobs">${JOBS.map(({ role, job, what, name }) => {
        // A signed-out browser is handed no members at all by row-level security, so looking
        // the officer up returned nothing and the section that exists to prove real people
        // hold the money printed "not yet filled" three times — on the live site, to every
        // stranger. The three names are already in prose twice on this same page, so naming
        // them here exposes nothing and is simply true.
        const m = store.people().find(x => (x.roles || []).includes(role) && x.status !== 'left');
        return `<div class="job">
          <h3>${escapeHtml(job)}</h3>
          <p class="job-who">${m ? `${avatar(m, 30)}<span>${escapeHtml(m.name)}</span>`
            : `<span>${escapeHtml(name)}</span>`}</p>
          <p class="small muted">${escapeHtml(what)}</p></div>`;
      }).join('')}</div>
      </div></section>`));

  // Rules in six sentences
  wrap.appendChild(el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><div><h2>What you are agreeing to</h2></div></div>
      <div class="grid g2">
        <ol class="stack" style="padding-left:1.1em">
          <li>100 points = $1.00 of hotel. That never changes.</li>
          <li>The only fee is 15%, and it is charged when you spend points on a room, never when you put money in. It is itemised on the quote before you accept it. There are never special assessments.</li>
          <li>Points appear only when Vishnu confirms the money arrived.</li>
        </ol>
        <ol class="stack" start="4" style="padding-left:1.1em">
          <li>Your points never expire while you are active. Bonus points expire after 24 months.</li>
          <li>Pause for up to three months a year with one tap; your streak freezes rather than resets.</li>
          <li>Every Insider can ask for every stay and every trip; the level only changes how fast points build.</li>
          <li>Chip in to a friend's booking with your own points — each share burns from its own ledger.</li>
          <li>Leave whenever you like: unused base points come back at face value, minus $25, after a 12-month window.</li>
        </ol>
      </div>
      <p class="small muted" style="margin-top:18px">Rules version ${escapeHtml(s.rulesVersion)}, ${escapeHtml(fmtDay(s.rulesDate))}. <a href="#/rules">Read all twelve</a>.</p>
      <p class="small muted" style="margin-top:10px;max-width:70ch">${escapeHtml(VOCAB.legal)}</p>
      </div></section>`));
  return wrap;
}

export function rules({ store }) {
  const s = store.settings;
  const clauses = [
    ['100 points = $1.00 of backing, fixed forever.', 'The value of a point never changes, in either direction. Every balance in the app prints the dollar beside it so you never have to work it out.'],
    ['The only fee is the Circle’s 15% share.', 'It is charged when you spend points on a room, not when you put money in, and the quote shows it before you accept. Every dollar you contribute backs a point from the day it lands. The Circle never levies special assessments.'],
    ['Points are minted only when the Banker confirms money has arrived.', 'Marking a transfer as sent creates a pending row and nothing else. Vishnu matches it against the bank statement and confirms; the ledger line carries his name and the timestamp.'],
    ['Base points never expire while you are active or paused.', 'Promotional points — tier bonus, streak and founding — expire 24 months after they are issued, which shows on your statement as an expiry line and returns the matching cash to Operating.'],
    ['No borrowing.', 'If a quote is more than your available points, you pay the difference as a top-up to the Banker at face value — the 15% is already inside the quote, so it is not charged twice. Nothing is ever booked on credit.'],
    ['A quote is locked for 72 hours; accepting it commits your points.', `Open requests at a time: ${s.tiers.map(t => `${t.holds} for ${tierName(t.monthlyUsd)}`).join(', ')}. An expired quote releases the points automatically.`],
    ['Cancellation mirrors the hotel’s terms, in points.', 'Whatever the hotel charges us is what comes off your points; the rest is restored. Any refund the hotel sends returns to the Reserve and re-credits points — never cash. You get a reminder seven days and two days before the hotel’s deadline.'],
    ['Pause for up to three consecutive months per year, with one tap.', 'Your streak freezes rather than resets and your points stay fully usable. Fifteen days late without contact auto-pauses you; three unpaid months makes you inactive, and you keep every point.'],
    ['Leave any time.', `Thirty days’ notice, twelve months to use what you hold, then base points are refunded at face value minus $${s.exitFeeUsd} from the Reserve within thirty days — at the full dollar, because nothing was taken on the way in. Promotional points are forfeited. In hardship or death the refund is immediate, at face value, with no fee.`],
    ['Household is always covered; guests use a certificate.', `Your partner and children travel on your points with no extra charge. Non-members use a guest certificate (${s.tiers.map(t => `${t.guestCerts} for ${tierName(t.monthlyUsd)}`).join(', ')} a year) or pay the same negotiated rate in cash.`],
    ['Points and bookings cannot be sold, transferred or advertised.', 'This is a private circle of friends. Reselling a booking ends a membership and returns the backing.'],
    ['The Circle is by invitation only.', `Every Insider is invited by someone already in and the club is capped at ${s.memberCap} seats. It is not advertised, there is no public sign-up, and nobody joins who Victor or Ian does not know. If you leave and want to come back later, you come back the same way.`],
    ['Every Insider can ask for every stay and every trip.', `No level is a wall. What a level changes is how fast your points build — ${s.tiers.map(t => `${fmtUsd2(t.monthlyUsd)} earns ${fmtPoints(pointsPerMonth(s, t.monthlyUsd))} a month`).join(', ')} — and the perks: open requests at a time, how far ahead you can book, guest passes, and first look at a new trip. Move between levels any month; it takes effect on your next contribution and nothing you already hold changes.`],
    ['You can chip in to each other’s bookings.', 'Open a booking to the Circle and anyone can add their own points to it — for a room you are sharing, or as a gift. Their points are committed the moment they chip in and released if it falls through; when the hotel is paid, each person’s share burns from their own ledger. Nobody can chip in more than the booking still needs, and points never change hands as points.'],
    [`${VOCAB.clubName} is a private members’ club for prepaid, club-arranged travel.`, 'Points are not deposits and not an investment. There is no interest, no return, and no payout that depends on new members joining: your points are backed by your own money, held in the Reserve.'],
  ];
  const wrap = el(`<div>${band('band-rules', 'Still water at dawn, fine ripples catching cool light', '', { ratio: '32/9' })}
    <section class="sec"><div class="wrap">
      <p class="eyebrow">Version ${escapeHtml(s.rulesVersion)} · ${escapeHtml(fmtDay(s.rulesDate))}</p>
      <h1>How the Circle works</h1>
      <p class="lede" style="margin-top:12px">In plain words. Everything the app does follows from these, and nothing here changes without telling you first.</p>
      <ol class="stack" style="margin-top:26px;padding-left:1.2em">
        ${clauses.map(([t, b]) => `<li style="margin-bottom:16px"><b>${escapeHtml(t)}</b><p class="small muted" style="margin-top:5px;max-width:72ch">${escapeHtml(b)}</p></li>`).join('')}
      </ol>
      <div class="notice" style="margin-top:24px"><b>The two accounts</b>
        <p class="small">The <b>Reserve</b> holds every dollar contributed, so a point is backed by a full dollar from the day it is minted; nothing leaves it except to pay a hotel for a confirmed booking or to refund someone who leaves. <b>Operating</b> is paid its 15% out of each booking and funds the bonuses. Coverage is the Reserve divided by everything the Circle owes in points, and it is on <a href="#/pool">the Pool page</a> for everyone to see.</p></div>
      <p class="small muted" style="margin-top:20px">${escapeHtml(VOCAB.legal)} An Aruban accountant should review these rules before the first real contribution.</p>
    </div></section></div>`);
  return wrap;
}

export function signIn({ store, go, refresh }) {
  const live = store.mode === 'supabase';
  const wrap = el(`<div><section class="sec"><div class="wrap signin-wrap">
      <figure class="signin-art"><img src="assets/signin.jpg"
        alt="Dark water at dusk with the last of the light along the horizon" decoding="async"></figure>
      <div class="signin-form">
      <h1>Sign in</h1>
      <p class="lede" style="margin-top:10px">Victor or Ian gives you a username and a password. Nothing is emailed to you.</p>

      <form id="pw" class="panel" style="margin-top:20px" autocomplete="on">
        <label class="field"><span>Username</span>
          <input type="text" name="username" autocomplete="username" autocapitalize="none"
                 spellcheck="false" placeholder="victor" required autofocus></label>
        <label class="field"><span>Password</span>
          <span class="pw-wrap"><input type="password" name="password" autocomplete="current-password" required>
          <button type="button" class="pw-peek" id="peek" aria-label="Show the password">${icon('eye', { size: 18 })}</button></span></label>
        <button class="btn block" type="submit" style="margin-top:4px">${icon('unlock', { size: 18 })}Sign in</button>
      </form>

      <p class="small muted" style="margin-top:16px">${icon('shield', { size: 15, cls: 'ico-muted' })}
        Forgotten it? Ask Victor or Ian — they set you a new one and tell you what it is. Nobody,
        them included, can read the one you are using now.</p>
      <p class="small muted" style="margin-top:10px">Not an Insider yet? The Circle is capped at ${store.settings.memberCap} seats and everyone in it was asked personally. <a href="#/">What it is</a>.</p>
      </div>
    </div></section></div>`);

  const form = wrap.querySelector('#pw');
  wrap.querySelector('#peek').addEventListener('click', () => {
    const i = form.password;
    i.type = i.type === 'password' ? 'text' : 'password';
    wrap.querySelector('#peek').innerHTML = icon(i.type === 'password' ? 'eye' : 'x', { size: 18 });
    i.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const username = form.username.value.trim().toLowerCase();
    setBusy(btn, true, 'Signing in…');
    try {
      await store.signInWithUsername(username, form.password.value);
      if (store.me?.mustChangePassword) { go('/set-password'); return; }
      toast(`${VOCAB.pap.welcome[0]}, ${store.me?.name.split(' ')[0] || ''}.`, { kind: 'good' });
      go('/home');
    } catch (err) {
      setBusy(btn, false);
      form.password.value = '';
      form.password.focus();
      toast(err.message, { kind: 'bad', timeout: 6000 });
    }
  });
  return wrap;
}

export function setPassword({ store, go }) {
  const live = store.mode === 'supabase';
  const forced = !!store.me?.mustChangePassword;
  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:480px">
      <h1>${forced ? 'Choose your own password' : 'Choose a password'}</h1>
      <p class="lede" style="margin-top:10px">${forced
        ? 'The one you just used was handed to you. Pick your own now — it is the last thing between your points and anyone else.'
        : 'Twelve characters at least. Longer beats complicated — three unrelated words will outlast anything with a $ in it.'}</p>
      <form id="set" class="panel" style="margin-top:20px">
        <label class="field"><span>New password</span>
          <input type="password" name="password" autocomplete="new-password" minlength="12" required autofocus></label>
        <div id="meter" class="pw-meter" aria-live="polite"></div>
        <label class="field"><span>And again</span>
          <input type="password" name="again" autocomplete="new-password" minlength="12" required></label>
        <div class="row">
          <button class="btn" type="submit">${icon('check', { size: 18 })}Set it</button>
          <button class="btn ghost sm" type="button" id="gen">${icon('sparkles', { size: 16 })}Make one up for me</button>
        </div>
      </form>
      ${live ? '' : '<p class="small muted" style="margin-top:14px">Preview mode: this locks this browser only.</p>'}
    </div></section></div>`);
  const form = wrap.querySelector('#set'), meter = wrap.querySelector('#meter');

  const draw = async () => {
    const { passwordStrength } = await import('../core/passwords.js');
    const s = passwordStrength(form.password.value);
    meter.innerHTML = form.password.value
      ? `<div class="pw-bar"><span style="width:${Math.round(s.score * 100)}%;background:${s.ok ? 'var(--good)' : 'var(--flag)'}"></span></div>
         <span class="small ${s.ok ? 'muted' : ''}">${escapeHtml(s.label)}</span>` : '';
  };
  form.addEventListener('input', draw);

  wrap.querySelector('#gen').addEventListener('click', async () => {
    const { generatePassword } = await import('../core/passwords.js');
    const pw = generatePassword();
    form.password.value = pw; form.again.value = pw;
    form.password.type = 'text';
    await draw();
    const ok = await copyText(pw);
    toast(ok ? 'Made one up and copied it. Save it before you set it.' : `Your password: ${pw}`, { kind: 'good', timeout: 8000 });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    if (form.password.value !== form.again.value) { toast('Those two do not match.', { kind: 'bad' }); form.again.focus(); return; }
    setBusy(btn, true, 'Saving…');
    try {
      await store.setPassword(form.password.value);
      toast(forced ? 'That is your password now. Nobody else has it.' : 'Password set. That is the one from now on.', { kind: 'good' });
      go(store.me ? '/home' : '/sign-in');
    } catch (err) { setBusy(btn, false); toast(err.message, { kind: 'bad', timeout: 6000 }); }
  });
  return wrap;
}

/** The invitation: choose a tier, watch the card mint, accept the rules. */
export function join({ store, params, go }) {
  const s = store.settings;
  // On the real backend an invitation cannot be read by a signed-out browser — the
  // invitations table is admin-only, deliberately — so the code in the link tells us
  // nothing. Rather than "that invitation is not valid", say what actually happens next.
  if (store.mode === 'supabase') {
    return el(`<div class="wrap sec" style="max-width:620px">
      <p class="eyebrow">${icon('key', { size: 14 })}You were invited</p>
      <h1>One step to get in</h1>
      <p class="lede" style="margin-top:14px">Victor or Ian has put you on the list. There is no code in this link to type
        and nothing to confirm — they give you a username and a password directly.</p>
      <ol class="stack small" style="margin-top:20px;line-height:1.6">
        <li>Ask them for your username and password — they have it, and they will send it to you.</li>
        <li>Open the sign-in screen and put both in.</li>
        <li>Choose your own password. The app will ask you to, before anything else.</li>
      </ol>
      <p class="row" style="margin-top:22px">
        <a class="btn" href="#/sign-in">${icon('key', { size: 17 })}Go to sign in</a>
        <a class="btn ghost" href="#/rules">How the Circle works</a></p>
      <p class="small muted" style="margin-top:18px">Nothing is emailed to you at any point. If the username and password
        do not work, ask them to set you a new one — it takes them ten seconds.</p></div>`);
  }
  const inv = store.invitation(params.code);
  const demo = String(params.code).toUpperCase() === 'DEMO';
  if (!inv && !demo) {
    return el(`<div class="wrap sec"><h1>That invitation is not valid</h1>
      <p class="lede" style="margin-top:12px">It may already have been used, or the link may be incomplete. Ask the Insider who invited you to send it again.</p>
      <p style="margin-top:18px"><a class="btn ghost" href="#/">Back to the start</a></p></div>`);
  }
  const sponsor = store.member(inv?.sponsorId || 'mem_victor');
  const state = { step: 1, monthlyUsd: inv?.monthlyUsd || 150, name: inv?.name || '', email: inv?.email || '', phone: '', standingOrder: false, accepted: false };
  const wrap = el('<div><section class="sec"><div class="wrap" style="max-width:760px" id="join-body"></div></section></div>');
  const body = wrap.querySelector('#join-body');

  const draw = () => {
    const tier = tierFor(s, state.monthlyUsd);
    const sp = splitContribution(state.monthlyUsd, s, tier);
    body.innerHTML = `
      <p class="eyebrow">Invitation from ${escapeHtml(sponsor?.name || 'the Circle')}</p>
      <h1>Join the ${escapeHtml(VOCAB.clubName)}</h1>
      <p class="lede" style="margin-top:12px">${escapeHtml(store.activeMembers().length)} of ${s.memberCap} seats are taken. ${store.activeMembers().length < s.foundingSeats ? 'You would be a Founding Insider — it stays on your card for good.' : ''}</p>
      <div class="side" style="margin-top:24px">
        <div>
          <div class="panel">
            <h2>Choose your monthly contribution</h2>
            <p class="small muted" style="margin-top:6px">You can change it any month; it takes effect on your next contribution.</p>
            <div class="choices" id="tiers" style="margin-top:14px"></div>
            <div id="split" style="margin-top:18px"></div>
            <p class="small muted" style="margin-top:12px">${escapeHtml(fmtPointsUsd(sp.points))} a month${sp.bonusPoints ? `, including the ${Math.round(tier.bonusRate * 100)}% ${escapeHtml(tierName(state.monthlyUsd))} bonus the Circle funds out of its own share` : ''}. ${escapeHtml(fmtAfl2(state.monthlyUsd, s.awgPerUsd))} at the peg.</p>
          </div>
          <form class="panel" id="details" style="margin-top:16px">
            <h2>Your details</h2>
            <label class="field"><span>Name as it should be etched on the card</span><input name="name" required value="${escapeHtml(state.name)}" autocomplete="name"></label>
            <label class="field"><span>Email</span><input name="email" type="email" required value="${escapeHtml(state.email)}" autocomplete="email"></label>
            <label class="field"><span>Phone (for Ian)</span><input name="phone" type="tel" placeholder="+297 000 0000" value="${escapeHtml(state.phone)}" autocomplete="tel"></label>
            <label class="row" style="gap:10px;align-items:flex-start;margin-bottom:14px">
              <input type="checkbox" name="standingOrder" ${state.standingOrder ? 'checked' : ''} style="width:20px;height:20px;margin-top:2px">
              <span class="small">I will set a standing order for the 5th of the month. <span class="muted">Aruba Bank and Banco di Caribe both do this free, online.</span></span></label>
            <div class="notice"><b>Where the money goes</b>
              <p class="small">${escapeHtml(s.reserveAccount.bank)} · ${escapeHtml(s.reserveAccount.holder)}<br>
              <span class="num">${escapeHtml(s.reserveAccount.number)}</span></p>
              <p class="small muted">Your reference will be <span class="num">${escapeHtml(VOCAB.refPrefix)}-${escapeHtml((state.name || 'XX').split(/\\s+/).map(x => x[0] || '').join('').slice(0, 2).toUpperCase() || 'XX')}-YYYY-MM</span>. Put it in the description field so Vishnu can match it in seconds.</p></div>
            <label class="row" style="gap:10px;align-items:flex-start;margin:16px 0">
              <input type="checkbox" name="accepted" required style="width:20px;height:20px;margin-top:2px">
              <span class="small">I have read <a href="#/rules">the rules</a> (version ${escapeHtml(s.rulesVersion)}) and I understand that points are prepaid travel credit with the Circle — not a deposit, not an investment.</span></label>
            <button class="btn block" type="submit">Mint my card</button>
          </form>
        </div>
        <div>
          <div id="card-preview"></div>
          <p class="small muted" style="margin-top:10px">Your tier is a finish, not a different card: ${s.tiers.map(t => `${escapeHtml(tierName(t.monthlyUsd))} $${t.monthlyUsd}`).join(' · ')}.</p>
        </div>
      </div>`;
    body.querySelector('#tiers').innerHTML = s.tiers.map(t => `<button type="button" class="choice" aria-pressed="${t.monthlyUsd === state.monthlyUsd}" data-amt="${t.monthlyUsd}">
        <span class="amt">$${t.monthlyUsd}</span><span class="tier">${escapeHtml(tierName(t.monthlyUsd))} ${treeSvg(VOCAB.tierLean[t.monthlyUsd], { size: 14 })}</span>
        <span class="tiny muted">${t.holds} open request${t.holds > 1 ? 's' : ''} · ${t.guestCerts} guest passes</span></button>`).join('');
    body.querySelector('#split').replaceChildren(splitBar({ amountUsd: state.monthlyUsd, shareRate: 0, points: sp.points }));
    body.querySelector('#card-preview').replaceChildren(memberCard(
      { id: 'preview', name: state.name || 'Your name', monthlyUsd: state.monthlyUsd, joinedAt: new Date().toISOString(), founding: store.activeMembers().length < s.foundingSeats, cardCode: '' },
      { store, flippable: false, compact: true }));
  };
  draw();
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-amt]'); if (!b) return;
    const form = body.querySelector('#details');
    state.name = form.name.value; state.email = form.email.value; state.phone = form.phone.value; state.standingOrder = form.standingOrder.checked;
    state.monthlyUsd = Number(b.dataset.amt); draw();
  });
  body.addEventListener('input', (e) => {
    if (e.target.name === 'name') body.querySelector('#card-preview .c-name').textContent = e.target.value || 'Your name';
  });
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    setBusy(btn, true, 'Minting…');
    try {
      await store.acceptInvitation(params.code, {
        name: f.get('name'), email: f.get('email'), phone: f.get('phone'), monthlyUsd: state.monthlyUsd,
        standingOrder: !!f.get('standingOrder'),
      });
      toast(`${VOCAB.pap.welcome[0]} · ${VOCAB.pap.welcome[1]}. Your card is minted.`, { kind: 'good' });
      go('/home');
    } catch (err) { setBusy(btn, false); toast(err.message, { kind: 'bad', timeout: 6000 }); }
  });
  return wrap;
}

export function denied() {
  return el(`<div class="wrap sec"><h1>That screen belongs to someone else</h1>
    <p class="lede" style="margin-top:12px">Only the Banker, the Desk or an admin can open it. If you think you should have access, ask Ian.</p>
    <p style="margin-top:18px"><a class="btn ghost" href="#/home">Back to your home</a></p></div>`);
}
export function notFound() {
  return el(`<div class="wrap sec"><h1>Nothing here</h1>
    <p class="lede" style="margin-top:12px">That link does not lead anywhere in the app.</p>
    <p style="margin-top:18px"><a class="btn ghost" href="#/home">Back to your home</a></p></div>`);
}
