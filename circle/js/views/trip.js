// "Your trip": the plan a member builds with Ian, at the top of Ask Ian. Ian v2, slice 1.
//
// The member's own edits go straight in: every row is a native input. Ian fills blanks from what the
// member says and never overwrites; a change from Ian arrives as a card in the thread, and the member's
// tap makes it (`apply`). The plan holds ids, dates and counts, never a price: the week chosen is drawn
// with the board's own dealRow, so its figure is the board's. Flights have no dates of their own: out on
// the week's check-in, back on its check-out, every traveller, with links to the airline's own site.
//
// Folded by default, with the plan in one line: the conversation is what a member opens Ask Ian for.
import { escapeHtml } from '../core/util.js';
import { toast, confirmDialog } from '../ui/components.js';
import { dealRow, shortRange } from './deals.js';
import { airlineLinks } from '../core/airline-links.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
export const PLAN_FIELDS = ['stay_id', 'from', 'to', 'adults', 'children', 'infants', 'origin', 'deal_id', 'transfer', 'todo', 'open'];
const blank = () => Object.fromEntries(PLAN_FIELDS.map((f) => [f, null]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** "21 Nov": one day, read at noon UTC so no phone's clock moves it. */
const dayWords = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Who is travelling, in words: "3 adults, 1 lap infant". */
export const whoWords = (p) => [p.adults ? plural(p.adults, 'adult') : '', p.children ? plural(p.children, 'child').replace('childs', 'children') : '',
  p.infants ? plural(p.infants, 'lap infant') : ''].filter(Boolean).join(', ');

/** The plan in one line, for the fold and for a card. */
export function planSummary(p, store) {
  const stay = p.stay_id ? store.stay(p.stay_id) : null;
  const bits = [stay?.name, p.from && p.to ? shortRange(p.from, p.to) : '', whoWords(p), p.origin ? `from ${p.origin}` : ''].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'nothing planned yet';
}

/** What a change from Ian would do, in words, for the plan_change card. */
export function changeWords(change, plan, store) {
  const out = [];
  if (change.stay_id) out.push(`the place to ${store.stay(change.stay_id)?.name || 'another place'}`);
  if (change.from || change.to) out.push(`the dates to ${shortRange(change.from || plan.from, change.to || plan.to)}`);
  if (change.adults != null || change.children != null || change.infants != null) out.push(`who's travelling to ${whoWords({ ...plan, ...change }) || 'nobody'}`);
  if (change.origin) out.push(`flying from ${change.origin}`);
  if (change.deal_id && !change.from && !change.to) out.push('the week you chose');
  for (const [k, w] of [['transfer', 'getting from the airport'], ['todo', 'things to do'], ['open', 'open questions']]) if (change[k]) out.push(`${w} to "${change[k]}"`);
  return out.length ? `Change ${out.join(', and ')}?` : 'Change your trip?';
}

export function tripPanel({ store }) {
  let plan = blank();
  const node = el(`<details class="fineprint trip" id="trip">
      <summary><span>Your trip · <span data-sum>…</span></span></summary>
      <div data-body style="margin-top:var(--s-2)"></div>
    </details>`);
  const body = node.querySelector('[data-body]');
  const sum = node.querySelector('[data-sum]');
  const stays = () => (store.state?.stays || []).filter((s) => s.kind !== 'trip' && s.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const weeksHere = () => (plan.stay_id ? store.liveDeals().filter((d) => d.stayId === plan.stay_id) : []);

  const draw = () => {
    sum.textContent = planSummary(plan, store);
    const week = plan.deal_id ? store.liveDeals().find((d) => d.id === plan.deal_id) : null;
    const out = week?.from || plan.from, back = week?.to || plan.to;
    const links = out && back ? airlineLinks({ origin: plan.origin, out, back, adults: plan.adults || 0, children: plan.children || 0, infants: plan.infants || 0 }) : null;
    const v = (k) => escapeHtml(plan[k] ?? '');
    body.innerHTML = `
      <label class="field"><span>Where</span><select name="stay_id"><option value="">Not chosen yet</option>${stays().map((s) =>
        `<option value="${escapeHtml(s.id)}"${s.id === plan.stay_id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select></label>
      <div class="pair">
        <label class="field" style="margin:0"><span>Check-in</span><input type="date" name="from" value="${v('from')}"></label>
        <label class="field" style="margin:0"><span>Check-out</span><input type="date" name="to" value="${v('to')}"></label>
      </div>
      <div class="pair" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-top:var(--s-3)">
        <label class="field" style="margin:0"><span>Adults</span><input type="number" inputmode="numeric" min="1" max="12" name="adults" value="${v('adults')}"></label>
        <label class="field" style="margin:0"><span>Children</span><input type="number" inputmode="numeric" min="0" max="12" name="children" value="${v('children')}"></label>
        <label class="field" style="margin:0"><span>Lap infants</span><input type="number" inputmode="numeric" min="0" max="12" name="infants" value="${v('infants')}"></label>
      </div>
      <label class="field" style="margin-top:var(--s-3)"><span>Flying from <span class="muted">(airport code)</span></span>
        <input name="origin" maxlength="3" autocapitalize="characters" autocomplete="off" placeholder="LIM" pattern="[A-Za-z]{3}" value="${v('origin')}"></label>
      <label class="field"><span>The week</span><select name="deal_id"><option value="">${weeksHere().length ? 'Not chosen yet' : 'No week on the board here yet'}</option>${weeksHere().map((d) =>
        `<option value="${escapeHtml(d.id)}"${d.id === plan.deal_id ? ' selected' : ''}>${escapeHtml(shortRange(d.from, d.to))} · ${escapeHtml(d.source === 'interval' ? 'Interval' : d.source === 'redweek' ? 'RedWeek' : d.source)}</option>`).join('')}</select></label>
      ${week ? '<ul class="listing" data-week style="margin:0 0 var(--s-3);padding:0"></ul>' : ''}
      <div class="rule-block" style="margin:var(--s-2) 0">
        <p class="small"><b>Flights</b> · ${out && back
          ? `out ${escapeHtml(dayWords(out))}${plan.origin ? ` from ${escapeHtml(plan.origin)}` : ''}, back ${escapeHtml(dayWords(back))}${whoWords(plan) ? `, ${escapeHtml(whoWords(plan))}` : ''}`
          : 'they follow the week’s own dates, once there are dates'}</p>
        ${links ? `<div class="row" style="gap:var(--s-4);flex-wrap:wrap">${links.map((l) =>
          `<a class="link-rule" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.airline)} ↗</a>`).join('')}</div>
          <p class="tiny muted">On the airline’s own site, both ways, every traveller filled in. It shows the fare; nothing is booked here.</p>`
          : out && back ? '<p class="tiny muted">Add where you fly from and who is travelling for the airline links.</p>' : ''}
      </div>
      <label class="field"><span>Getting from the airport</span><input name="transfer" maxlength="200" autocomplete="off" value="${v('transfer')}"></label>
      <label class="field"><span>Things to do</span><input name="todo" maxlength="200" autocomplete="off" value="${v('todo')}"></label>
      <label class="field"><span>Open questions</span><input name="open" maxlength="200" autocomplete="off" value="${v('open')}"></label>
      <p><button type="button" class="link-rule" data-start-over>Start over</button></p>`;
    if (week) body.querySelector('[data-week]').appendChild(dealRow(week, { store, level: 3 }));
  };

  const save = async (next) => {
    const was = plan;
    plan = next;
    draw();
    try { await store.savePlan(PLAN_FIELDS.some((f) => plan[f] != null) ? plan : null); }
    catch (err) { plan = was; draw(); toast(err.message, { kind: 'bad' }); }
  };

  body.addEventListener('change', (e) => {
    const k = e.target.name;
    if (!PLAN_FIELDS.includes(k)) return;
    let val = e.target.value.trim();
    if (['adults', 'children', 'infants'].includes(k)) val = val === '' ? null : Math.max(0, Math.min(12, Math.round(Number(val)) || 0));
    else if (k === 'origin') { val = val.toUpperCase(); if (val && !/^[A-Z]{3}$/.test(val)) { toast('Three letters, the airport code: LIM, MIA, JFK…', { kind: 'bad' }); draw(); return; } }
    const next = { ...plan, [k]: val === '' ? null : val };
    // A chosen week brings its dates; a week at another place, or on other dates, is let go.
    if (k === 'deal_id' && val) { const w = store.liveDeals().find((d) => d.id === val); if (w) { next.from = w.from; next.to = w.to; next.stay_id = w.stayId; } }
    if (['stay_id', 'from', 'to'].includes(k) && next.deal_id) {
      const w = store.liveDeals().find((d) => d.id === next.deal_id);
      if (!w || w.stayId !== next.stay_id || w.from !== next.from || w.to !== next.to) next.deal_id = null;
    }
    save(next);
  });
  body.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-start-over]')) return;
    if (await confirmDialog({ title: 'Start over?', message: 'Your trip plan is cleared. Ian’s notes about how you travel stay.', confirmText: 'Start over', danger: true })) save(blank());
  });

  /** Read the plan again: Ian may have filled a blank during the turn. */
  node.reload = async () => {
    try { plan = { ...blank(), ...((await store.plan()) || {}) }; } catch { /* keep what is drawn */ }
    draw();
  };
  /** The member's tap on a plan_change card. */
  node.apply = (change) => save({ ...plan, ...change });
  node.current = () => plan;
  draw();
  node.reload();
  return node;
}
