// Public and entry screens: the landing page, the rules, sign-in, and the invitation.
import { escapeHtml, html, raw, fmtUsd2, fmtAfl2, fmtPoints, fmtPointsUsd, fmtDay, fmtPct, initials } from '../core/util.js';
import { VOCAB, tierName } from '../core/vocab.js';
import { splitContribution, tierFor, projectPoints, seasonPoints, SEASONS, REACH, pointsPerMonth, monthsToAfford } from '../core/money.js';
import { splitBar, poolGauge, memberCard, ring } from '../ui/pieces.js';
import { sceneSvg, treeSvg, starSvg } from '../ui/art.js';
import { toast, setBusy, sheet } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { copyText } from '../core/share.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
export const stayStrip = (stay) => {
  const d = document.createElement('div');
  d.className = 'scene';
  d.innerHTML = sceneSvg(stay);
  return d;
};

/** A stay or trip card, used on the landing page and throughout the catalog. */
export function stayCard(stay, { store, season = 'low', href = null, footer = '' } = {}) {
  const per = stay.kind === 'trip' ? stay.pointsPerSeat : seasonPoints(stay, season);
  const node = el(`<a class="stay-card" href="${escapeHtml(href || `#/${stay.kind === 'trip' ? 'trips' : 'stays'}/${stay.id}`)}">
      <span class="strip"><span class="duo"></span><span class="ph-note">illustration</span></span>
      <span class="body">
        <h3>${escapeHtml(stay.name)}</h3>
        <span class="where">${escapeHtml(stay.area)}${stay.country !== 'Aruba' ? `, ${escapeHtml(stay.country)}` : ''}${stay.kind === 'trip' ? ` · ${stay.nights} nights` : stay.onSand ? ' · on the sand' : ' · across the road'}</span>
        <span class="price"><b class="num">${escapeHtml(fmtPoints(per))}</b><small>${escapeHtml(stay.kind === 'trip' ? `a seat · ${fmtUsd2(per / 100)}` : `a night · ${fmtUsd2(per / 100)}`)}</small></span>
        <span class="flags">${stay.house ? '<span class="tag house">Where we stay</span>' : ''}${(stay.features || []).slice(0, stay.house ? 2 : 3).map(f => `<span class="tag">${escapeHtml(f)}</span>`).join('')}</span>
        ${footer}
      </span></a>`);
  node.querySelector('.strip').prepend(stayStrip(stay));
  return node;
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
        <p class="eyebrow enter">${escapeHtml(VOCAB.subtitle)} · by invitation</p>
        <h1 class="enter" style="--d:40ms;max-width:15ch">A private travel circle in Aruba.</h1>
        <p class="lede enter" style="--d:80ms;margin-top:14px">${escapeHtml(VOCAB.tagline)} You put in $100, $150 or $200 a month. Vishnu confirms the money has landed, and only then do your points appear — 100 points to the dollar, fixed forever.</p>
        <p class="lede enter" style="--d:100ms;margin-top:12px">This is not a business and it is not open to the public. Every Insider is someone Victor or Ian knows, and you join because one of them asked you. ${blind ? `There are ${s.memberCap} seats in all.` : `${escapeHtml(store.activeMembers().length)} of ${s.memberCap} seats are taken.`}</p>
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

  // Horizon — the dream, before the ledger
  const horizon = el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><div><p class="eyebrow">The horizon</p><h2>Where the points go</h2>
      <p>Twenty-three places on the island and the trips Victor and Ian put together. Every price is the Circle’s all-in rate — taxes, levies and resort fees included.</p>
      <p class="small muted" style="margin-top:8px">These four are where we actually end up. The trips this cycle go to the Dominican Republic, Mexico and Japan.</p></div>
      <a class="btn ghost sm" href="#/stays">${icon('chevronRight', { size: 15 })}All twenty-three</a></div>
      <div class="horizon-wrap"><div class="horizon" id="horizon"></div></div></div></section>`);
  const hz = horizon.querySelector('#horizon');
  featured.forEach(st => hz.appendChild(stayCard(st, { store, season: 'low' })));
  wrap.appendChild(horizon);

  // The split — the honest 85/15
  const split = el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><div><p class="eyebrow">The split</p><h2>Where every dollar goes</h2>
      <p>The Circle takes 15% for setting this up and running it. The other 85% backs your points and stays yours until you spend it on a stay.</p></div></div>
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
    const slot = split.querySelector('#split-slot'); slot.replaceChildren(splitBar({ amountUsd: chosen, shareRate: s.serviceRate, points: sp.basePoints }));
    split.querySelector('#split-figures').innerHTML = `
      <div class="stat"><span class="k">Points credited</span><b class="num">${escapeHtml(fmtPoints(sp.points))}</b><span class="sub">${escapeHtml(fmtUsd2(sp.points / 100))} of hotel${sp.bonusPoints ? ` · includes a ${Math.round(tier.bonusRate * 100)}% ${escapeHtml(tierName(chosen))} bonus the Circle funds` : ''}</span></div>
      <div class="stat"><span class="k">${escapeHtml(VOCAB.share)}</span><b class="num">${escapeHtml(fmtUsd2(sp.shareUsd))}</b><span class="sub">Runs the app and the Desk’s time. Not refundable.</span></div>`;
    const p12 = projectPoints(chosen, 12, s);
    split.querySelector('#projection').innerHTML = `
      <ul class="ledger" style="margin:0">
        <li><span class="what"><b>You send</b><span class="meta">12 × ${escapeHtml(fmtUsd2(chosen))}</span></span><span class="delta"><b>${escapeHtml(fmtUsd2(p12.paidUsd))}</b></span></li>
        <li><span class="what"><b>${escapeHtml(VOCAB.share)}</b><span class="meta">15%, taken once, at the start</span></span><span class="delta"><b>${escapeHtml(fmtUsd2(p12.shareUsd))}</b></span></li>
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
  wrap.appendChild(el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><div><p class="eyebrow">What each level is for</p><h2>Everyone comes on everything</h2>
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
            <li class="small muted">${t.holds} open request${t.holds > 1 ? 's' : ''} · ${t.windowMonths} months ahead · ${t.guestCerts} guest passes${t.firstLookHours ? ` · first look ${t.firstLookHours}h early` : ''}</li>
          </ul></div>`;
        }).join('')}
      </div>
      <p class="small muted" style="margin-top:16px">Move between levels any month; it starts on your next contribution and nothing you already hold changes. Short of a trip you want? Ask for it anyway — Victor quotes it and you accept when the points are there, or you close the gap with a cash top-up.</p>
      </div></section>`));

  // How a contribution becomes a stay
  wrap.appendChild(el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><div><p class="eyebrow">The path</p><h2>How a contribution becomes a stay</h2></div></div>
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
      <div class="sec-head"><div><p class="eyebrow">Planning bands</p><h2>What a night costs</h2>
      <p>Published once a year and never changed after you have booked against them. Your binding quote is Victor’s negotiated all-in rate, which is usually better.</p></div></div>
      <div class="tablewrap"><table>
        <caption class="sr-only">Indicative points per night by category and season</caption>
        <thead><tr><th>Category</th><th>Summer · ${escapeHtml(SEASONS.low.range)}</th><th>Winter · ${escapeHtml(SEASONS.high.range)}</th></tr></thead>
        <tbody>${bands.map(([n, ex, a, b, c, d]) => `<tr><td><b>${escapeHtml(n)}</b><br><span class="small muted">${escapeHtml(ex)}</span></td>
          <td class="num">${a.toLocaleString('en-US')}–${b.toLocaleString('en-US')}</td><td class="num">${c.toLocaleString('en-US')}–${d.toLocaleString('en-US')}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="small muted" style="margin-top:12px">Peak — 20 December to 3 January, and Carnival week — runs 15–20% above Winter with a seven-night minimum at most resorts.</p>
      <p class="small muted" style="margin-top:8px">The two Marriott villa resorts are the odd ones out: they are vacation-ownership weeks, so they come as seven nights Saturday to Saturday and there is no resort fee. A villa there sleeps four to eight, which is why the per-night number looks high and the per-person number does not — chip in with three others and it is the cheapest week on Palm Beach.</p>
      </div></section>`));

  // The people
  const officers = ['mem_victor', 'mem_ian', 'mem_vishnu'].map(id => store.member(id)).filter(Boolean);
  wrap.appendChild(el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><div><p class="eyebrow">Who runs it</p><h2>Three people, three jobs</h2></div></div>
      <div class="grid g3">${officers.map(m => `<div class="panel"><div class="row" style="gap:12px">
          <span class="avatar" style="--h:${m.hue};width:44px;height:44px;font-size:.95rem">${escapeHtml(initials(m.name))}</span>
          <div><b>${escapeHtml(m.name)}</b><br><span class="small muted">${escapeHtml(m.title)}</span></div></div>
        <p class="small muted" style="margin-top:12px">${escapeHtml(
          m.id === 'mem_victor' ? 'Finds the deals around the world and plans the trips. He quotes every request within 72 hours.'
          : m.id === 'mem_ian' ? 'Every message you get from the Circle comes from Ian. He plans the trips with Victor and nobody chases anybody in a group chat.'
          : 'Holds the money and confirms every transfer. Points are minted only by him, and every line in your ledger carries his name and the time.')}</p></div>`).join('')}</div>
      </div></section>`));

  // Rules in six sentences
  wrap.appendChild(el(`<section class="sec"><div class="wrap">
      <div class="sec-head"><div><p class="eyebrow">The rules, short</p><h2>What you are agreeing to</h2></div></div>
      <div class="grid g2">
        <ol class="stack" style="padding-left:1.1em">
          <li>100 points = $1.00 of hotel. That never changes.</li>
          <li>The only fee is 15%, taken when you contribute and itemised on every line. There are never special assessments.</li>
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
    ['The only fee is the Circle’s 15% share.', 'It is taken when you contribute, itemised on every row, and it funds the app, the Desk’s time and your tier bonus. The Circle never levies special assessments.'],
    ['Points are minted only when the Banker confirms money has arrived.', 'Marking a transfer as sent creates a pending row and nothing else. Vishnu matches it against the bank statement and confirms; the ledger line carries his name and the timestamp.'],
    ['Base points never expire while you are active or paused.', 'Promotional points — tier bonus, streak and founding — expire 24 months after they are issued, which shows on your statement as an expiry line and returns the matching cash to Operating.'],
    ['No borrowing.', 'If a quote is more than your available points, you pay the difference as a top-up to the Banker. No 15% is taken on a top-up, and nothing is ever booked on credit.'],
    ['A quote is locked for 72 hours; accepting it commits your points.', `Open requests at a time: ${s.tiers.map(t => `${t.holds} for ${tierName(t.monthlyUsd)}`).join(', ')}. An expired quote releases the points automatically.`],
    ['Cancellation mirrors the hotel’s terms, in points.', 'Whatever the hotel charges us is what comes off your points; the rest is restored. Any refund the hotel sends returns to the Reserve and re-credits points — never cash. You get a reminder seven days and two days before the hotel’s deadline.'],
    ['Pause for up to three consecutive months per year, with one tap.', 'Your streak freezes rather than resets and your points stay fully usable. Fifteen days late without contact auto-pauses you; three unpaid months makes you inactive, and you keep every point.'],
    ['Leave any time.', `Thirty days’ notice, twelve months to use what you hold, then base points are refunded at face value minus $${s.exitFeeUsd} from the Reserve within thirty days. Promotional points are forfeited and the 15% is not refunded. In hardship or death the refund is immediate, at face value, with no fee.`],
    ['Household is always covered; guests use a certificate.', `Your partner and children travel on your points with no extra charge. Non-members use a guest certificate (${s.tiers.map(t => `${t.guestCerts} for ${tierName(t.monthlyUsd)}`).join(', ')} a year) or pay the same negotiated rate in cash.`],
    ['Points and bookings cannot be sold, transferred or advertised.', 'This is a private circle of friends. Reselling a booking ends a membership and returns the backing.'],
    ['The Circle is by invitation only.', `Every Insider is invited by someone already in and the club is capped at ${s.memberCap} seats. It is not advertised, there is no public sign-up, and nobody joins who Victor or Ian does not know. If you leave and want to come back later, you come back the same way.`],
    ['Every Insider can ask for every stay and every trip.', `No level is a wall. What a level changes is how fast your points build — ${s.tiers.map(t => `${fmtUsd2(t.monthlyUsd)} earns ${fmtPoints(pointsPerMonth(s, t.monthlyUsd))} a month`).join(', ')} — and the perks: open requests at a time, how far ahead you can book, guest passes, and first look at a new trip. Move between levels any month; it takes effect on your next contribution and nothing you already hold changes.`],
    ['You can chip in to each other’s bookings.', 'Open a booking to the Circle and anyone can add their own points to it — for a room you are sharing, or as a gift. Their points are committed the moment they chip in and released if it falls through; when the hotel is paid, each person’s share burns from their own ledger. Nobody can chip in more than the booking still needs, and points never change hands as points.'],
    [`${VOCAB.clubName} is a private members’ club for prepaid, club-arranged travel.`, 'Points are not deposits and not an investment. There is no interest, no return, and no payout that depends on new members joining: your points are backed by your own money, held in the Reserve.'],
  ];
  const wrap = el(`<div><section class="sec"><div class="wrap">
      <p class="eyebrow">Version ${escapeHtml(s.rulesVersion)} · ${escapeHtml(fmtDay(s.rulesDate))}</p>
      <h1>How the Circle works</h1>
      <p class="lede" style="margin-top:12px">In plain words. Everything the app does follows from these, and nothing here changes without telling you first.</p>
      <ol class="stack" style="margin-top:26px;padding-left:1.2em">
        ${clauses.map(([t, b]) => `<li style="margin-bottom:16px"><b>${escapeHtml(t)}</b><p class="small muted" style="margin-top:5px;max-width:72ch">${escapeHtml(b)}</p></li>`).join('')}
      </ol>
      <div class="notice" style="margin-top:24px"><b>The two accounts</b>
        <p class="small">The <b>Reserve</b> holds the 85% that backs points; nothing leaves it except to pay a hotel for a confirmed booking or to refund someone who leaves. <b>Operating</b> holds the 15% and funds the bonuses. Coverage is the Reserve divided by everything the Circle owes in points, and it is on <a href="#/pool">the Pool page</a> for everyone to see.</p></div>
      <p class="small muted" style="margin-top:20px">${escapeHtml(VOCAB.legal)} An Aruban accountant should review these rules before the first real contribution.</p>
    </div></section></div>`);
  return wrap;
}

export function signIn({ store, go, refresh }) {
  const live = store.mode === 'supabase';
  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:520px">
      <p class="eyebrow">${icon('lock')}<span lang="pap" class="pap">${escapeHtml(VOCAB.pap.welcome[0])}</span> · ${escapeHtml(VOCAB.pap.welcome[1])} back</p>
      <h1>Sign in</h1>
      <p class="lede" style="margin-top:10px">The Circle is invitation only. If Victor or Ian sent you a link to join, open that one instead — it sets up your account and your card.</p>

      <form id="pw" class="panel" style="margin-top:20px" autocomplete="on">
        <label class="field"><span>Email</span>
          <input type="email" name="email" autocomplete="username" inputmode="email" placeholder="you@example.aw" required autofocus></label>
        <label class="field"><span>Password</span>
          <span class="pw-wrap"><input type="password" name="password" autocomplete="current-password" required minlength="8">
          <button type="button" class="pw-peek" id="peek" aria-label="Show the password">${icon('eye', { size: 18 })}</button></span></label>
        <div class="row" style="margin-top:4px">
          <button class="btn" type="submit">${icon('unlock', { size: 18 })}Sign in</button>
          <button class="btn quiet sm" type="button" id="forgot">I forgot my password</button>
        </div>
      </form>

      <div class="panel" style="margin-top:14px">
        <div class="row-between" style="gap:12px;align-items:flex-start">
          <div><b>${icon('key', { size: 16, cls: 'ico-muted' })} First time here?</b>
            <p class="small muted" style="margin-top:6px">If Victor or Ian has put you on the list, set your password now with the same email they used.</p></div>
          <button class="btn ghost sm" type="button" id="claim" style="flex:none">Set it up</button>
        </div>
      </div>

      <div class="panel flat" style="margin-top:14px">
        <p class="small muted">${icon('shield', { size: 16, cls: 'ico-muted' })} ${live
          ? 'Your password is held by the club’s own server and never by this page. Ian can reset it for you, but nobody — including him — can read it.'
          : 'This browser is running on preview data, so the password locks this browser only. Connect the backend and the same email and password work on every device.'}</p>
      </div>
      <p class="small muted" style="margin-top:16px">Not an Insider yet? The Circle is capped at ${store.settings.memberCap} seats and everyone in it was asked personally. <a href="#/">What it is</a>.</p>
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
    const email = form.email.value, password = form.password.value;
    setBusy(btn, true, 'Signing in…');
    try {
      await store.signInWithPassword(email, password);
      toast(`${VOCAB.pap.welcome[0]}, ${store.me?.name.split(' ')[0] || ''}.`, { kind: 'good' });
      go('/home');
    } catch (err) {
      setBusy(btn, false);
      form.password.value = '';
      form.password.focus();
      toast(err.message, { kind: 'bad', timeout: 6000 });
    }
  });

  wrap.querySelector('#claim').addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) { form.email.focus(); toast('Put the email they have for you in first.'); return; }
    if (!live) {
      const m = store.memberByEmail(email);
      if (!m) { toast('No Insider with that email in this browser.', { kind: 'bad' }); return; }
      if (store.hasPassword(m.id)) { toast('That one already has a password. Sign in, or reset it.', { kind: 'bad' }); return; }
      const { generatePassword } = await import('../core/passwords.js');
      const pw = generatePassword();
      await store.setPasswordFor(m.id, pw);
      await showGeneratedPassword(pw, m);
      form.password.value = pw;
      toast('Set. Sign in with it now.', { kind: 'good' });
      return;
    }
    const known = await store.lookupInvite(email);
    if (known?.claimed) { toast('That account already exists — sign in, or reset the password.', { kind: 'bad', timeout: 6000 }); return; }
    const out = await sheet({ title: 'Set up your account', render: (body, close) => {
      body.innerHTML = `<p class="sheet-text">Choose a password for <b>${escapeHtml(email)}</b>. Twelve characters at least — longer beats complicated.</p>
        <label class="field"><span>Password</span><input name="pw" type="password" autocomplete="new-password" minlength="12" required></label>
        <div class="row"><button class="btn ghost sm" type="button" data-gen>${icon('sparkles', { size: 16 })}Make one up for me</button></div>
        <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>Create it</button></div>`;
      body.querySelector('[data-gen]').addEventListener('click', async () => {
        const { generatePassword } = await import('../core/passwords.js');
        const pw = generatePassword();
        body.querySelector('[name=pw]').value = pw;
        body.querySelector('[name=pw]').type = 'text';
        const ok = await copyText(pw);
        toast(ok ? 'Made one up and copied it. Save it before you continue.' : `Your password: ${pw}`, { kind: 'good', timeout: 9000 });
      });
      body.querySelector('[data-ok]').addEventListener('click', () => close(body.querySelector('[name=pw]').value));
    } });
    if (!out) return;
    try {
      const r = await store.signUpWithPassword(email, out);
      if (r.confirmNeeded) toast('Almost. Open the link we just emailed you, then sign in.', { kind: 'good', timeout: 9000 });
      else { toast(`${VOCAB.pap.welcome[0]}, ${store.me?.name.split(' ')[0] || ''}.`, { kind: 'good' }); go('/home'); }
    } catch (err) { toast(err.message, { kind: 'bad', timeout: 7000 }); }
  });

  wrap.querySelector('#forgot').addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) { form.email.focus(); toast('Put your email in first, then tap it again.'); return; }
    if (live) {
      try {
        await store.sendPasswordReset(email);
        toast('If that address is an Insider’s, a reset link is on its way. It lasts an hour.', { kind: 'good', timeout: 7000 });
      } catch (err) { toast(err.message, { kind: 'bad', timeout: 6000 }); }
      return;
    }
    // Preview mode has no mail server, so the honest thing is to say so and offer the
    // only reset that can work here: generate a new one for this browser, shown once.
    const m = store.memberByEmail(email);
    if (!m) { toast('No Insider with that email in this browser.', { kind: 'bad' }); return; }
    const { generatePassword } = await import('../core/passwords.js');
    const fresh = generatePassword();
    await store.setPasswordFor(m.id, fresh);
    await showGeneratedPassword(fresh, m, { reset: true });
    form.password.value = '';
  });
  return wrap;
}

/**
 * A generated password, shown once. Deliberately not emailed, not logged, and not written
 * anywhere it could be committed — the person copies it now or resets it again later.
 */
export async function showGeneratedPassword(password, member, { reset = false } = {}) {
  return sheet({
    title: reset ? 'A new password for this browser' : `${member.name.split(' ')[0]}’s password`,
    render: (body, close) => {
      body.innerHTML = `
        <p class="sheet-text">${reset ? 'Your old one is gone.' : 'This is the only time it is shown.'}
        Copy it into your password manager now — nobody can read it back to you, and the only way out is to reset it again.</p>
        <div class="copyline pw-reveal" style="margin-top:14px">
          <code class="num" style="font-size:1.35rem;letter-spacing:.06em">${escapeHtml(password)}</code>
          <button class="btn sm" data-copy="${escapeHtml(password)}">${icon('copy', { size: 16 })}Copy</button>
        </div>
        <p class="small muted" style="margin-top:12px">${icon('shield', { size: 15, cls: 'ico-muted' })} Sixteen characters from an alphabet with no look-alikes, so it can be read off a screen without a mistake.</p>
        <div class="sheet-actions"><button class="btn" data-ok>I have saved it</button></div>`;
      body.addEventListener('click', async (e) => {
        const c = e.target.closest('[data-copy]');
        if (c) { const ok = await copyText(c.dataset.copy); toast(ok ? 'Copied. Paste it somewhere safe.' : 'Select it and copy by hand.'); }
        if (e.target.closest('[data-ok]')) close(true);
      });
    },
  });
}

/** Where an emailed reset link lands: set a new password, then straight into the Circle. */
export function setPassword({ store, go }) {
  const live = store.mode === 'supabase';
  const wrap = el(`<div><section class="sec"><div class="wrap" style="max-width:520px">
      <p class="eyebrow">${icon('key')}Your account</p>
      <h1>Choose a password</h1>
      <p class="lede" style="margin-top:10px">Twelve characters at least. Longer beats complicated — three unrelated words and a number will outlast anything with a $ in it.</p>
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
      if (live) await store.setPassword(form.password.value);
      else {
        const me = store.me;
        if (!me) throw new Error('Sign in first, then change it from your profile.');
        await store.setPasswordFor(me.id, form.password.value);
      }
      toast('Password set. That is the one from now on.', { kind: 'good' });
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
      <p class="lede" style="margin-top:14px">Victor or Ian has put you on the list. Nothing was emailed to you and there is
        no code to type — you choose your own password, and nobody here ever sees it.</p>
      <ol class="stack small" style="margin-top:20px;line-height:1.6">
        <li>Open the sign-in screen.</li>
        <li>Tap <b>First time here? Set it up</b>.</li>
        <li>Put in the email address they have for you, and pick a password.</li>
      </ol>
      <p class="row" style="margin-top:22px">
        <a class="btn" href="#/sign-in">${icon('key', { size: 17 })}Go to sign in</a>
        <a class="btn ghost" href="#/rules">How the Circle works</a></p>
      <p class="small muted" style="margin-top:18px">If it says it does not know that address, they have you under a different
        one — ask them which, or ask them to change it.</p></div>`);
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
    body.querySelector('#split').replaceChildren(splitBar({ amountUsd: state.monthlyUsd, shareRate: s.serviceRate, points: sp.basePoints }));
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
