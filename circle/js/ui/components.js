// UI primitives: toasts (with undo), the one bottom sheet that every dialog is, status chips,
// avatars, form helpers, and the one odometer in the app.
import { escapeHtml, initials as initialsOf, prefersReducedMotion } from '../core/util.js';

let toastHost;
/* A toast belongs to the screen that raised it, and on a phone it sits over that screen's work,
   so two rules hold it in its place. It does not follow you: when the hash changes, every toast
   already on the screen is dismissed. The one exception is the message said in the same breath as
   the leaving (`toast('You left the crew.'); go('/crews')`) — that one is meant for the screen you
   are landing on, so a toast younger than a blink travels with you. And it does not pile up: two
   at a time at most — a message and its answer, as the Banker's 'minted' and its 'Undo?' — with
   the oldest making way for anything after that. */
const liveToasts = [];   // oldest first
const SAME_BREATH_MS = 400;
window.addEventListener('hashchange', () => {
  const now = performance.now();
  for (const t of [...liveToasts]) if (now - t.born > SAME_BREATH_MS) t.close();
});

export function toast(message, { kind = 'info', timeout = 3600, action = null } = {}) {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts'; toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.append(document.createTextNode(message));
  if (action) {
    const b = document.createElement('button');
    b.className = 'undo'; b.type = 'button'; b.textContent = action.label;
    b.addEventListener('click', () => { close(); action.fn(); });
    t.appendChild(b);
  }
  toastHost.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  let timer;
  const close = () => {
    clearTimeout(timer);
    const at = liveToasts.indexOf(entry);
    if (at < 0) return;
    liveToasts.splice(at, 1);
    t.classList.remove('in');
    setTimeout(() => t.remove(), prefersReducedMotion() ? 0 : 260);
  };
  const entry = { born: performance.now(), close };
  liveToasts.push(entry);
  while (liveToasts.length > 2) liveToasts[0].close();
  timer = setTimeout(close, timeout);
  return { close };
}

/* The sheet and the back gesture.
   Opening a sheet pushes one history entry ({ huntoSheet: id }, the page's own URL), so the
   phone's back gesture closes the sheet instead of leaving the page. Every way out — the X, the
   scrim, Escape, close(value) from a [data-ok] handler — goes through history.back() while that
   entry is the current one, and the sheet resolves from the popstate that follows. So a caller
   that awaits the sheet and then calls router.go() runs after the traversal has completed, and
   its new hash lands on top of the page, never on top of the sheet's entry. The entry keeps the
   page's URL, so the traversal fires no hashchange and the router (router.js listens to
   hashchange only) never re-renders for it. A hashchange while a sheet is open is a navigation
   from under the sheet: the sheet closes and leaves history alone. */
let sheetSeq = 0;
const openSheets = [];   // bottom-most first; the last one is on top
window.addEventListener('popstate', () => { openSheets[openSheets.length - 1]?.settle(); });
window.addEventListener('hashchange', () => { for (const s of [...openSheets].reverse()) s.settle(); });

/** A bottom sheet, at every width. The body is a form, so the keyboard's key submits: a submit
 *  clicks the [data-ok] button, and callers keep their [data-ok] click handlers. `tall` makes it
 *  a screen of its own. Resolves with whatever close(value) was given; undefined when dismissed. */
export function sheet({ title, render, tall = false }) {
  return new Promise((resolve) => {
    const id = ++sheetSeq;
    const dlg = document.createElement('dialog');
    dlg.className = `sheet${tall ? ' tall' : ''}`;
    dlg.innerHTML = `<div class="sheet-head"><h2 class="sheet-title">${escapeHtml(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">${X}</button></div><form class="sheet-body" novalidate></form>`;
    const body = dlg.querySelector('.sheet-body');
    document.body.appendChild(dlg);
    const opener = document.activeElement;
    let value, leaving = false, done = false;

    const finish = () => {
      if (done) return;
      done = true;
      const i = openSheets.indexOf(entry); if (i >= 0) openSheets.splice(i, 1);
      types.disconnect();
      dlg.remove();
      opener?.focus?.();
      resolve(value);
    };
    // The traversal has completed (or history was never involved): close the dialog and resolve.
    const settle = () => { leaving = true; if (dlg.open) dlg.close(); finish(); };
    const close = (v) => {
      if (leaving) return;                 // one back per sheet, whichever way out was first
      value = v; leaving = true;
      if (history.state?.huntoSheet === id) history.back(); else settle();
    };
    const entry = { id, settle };

    dlg.addEventListener('close', () => {
      if (leaving) return;                 // our own dlg.close(): finish() has already run
      // Closed from under us (an Escape the browser would not let us cancel): the sheet's entry
      // is still the current one, so take it back and resolve once the traversal has completed.
      leaving = true;
      if (history.state?.huntoSheet === id) history.back(); else finish();
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(undefined); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) close(undefined); });
    body.addEventListener('submit', (e) => {
      e.preventDefault();
      // A tap on a button has already clicked it. Only the keyboard's key (or requestSubmit)
      // arrives without a submitter and needs the primary clicked for it.
      if (!e.submitter) body.querySelector('[data-ok]')?.click();
    });
    // Inside a form, a button with no type is a submit button, and the keyboard's key clicks the
    // first of them in the sheet — so the primary is the one submit button and every other
    // button is a plain button. Re-applied whenever a caller redraws the body.
    const fixTypes = () => body.querySelectorAll('button:not([type])').forEach((b) => { b.type = b.hasAttribute('data-ok') ? 'submit' : 'button'; });
    const types = new MutationObserver(fixTypes);
    types.observe(body, { childList: true, subtree: true });

    render(body, close);
    fixTypes();
    // No caller's autofocus: focus is chosen below, and never an input.
    body.querySelectorAll('[autofocus]').forEach((n) => n.removeAttribute('autofocus'));
    dlg.showModal();
    history.pushState({ huntoSheet: id }, '');
    openSheets.push(entry);
    /* Focus goes to the sheet's one action and to nothing else. Never an input, so no keyboard
       rises over the sheet's text. Never the first button the body happens to hold: a form full
       of helpers (Post a deal's 'Next Friday, 8pm') opened the sheet scrolled 369px past its own
       first question, and a picker, where every name is a button, opened with a stranger one
       keypress from being added. So: the primary, then whatever else the sticky actions carry,
       then their labelled way out, and otherwise the X — and always with preventScroll, so the
       body opens at its first line however far down the action sits. */
    const action = body.querySelector('[data-ok]:not([disabled])')
      || body.querySelector('.sheet-actions :is(button, a.btn):not([data-close]):not([disabled])')
      || body.querySelector('.sheet-actions [data-close]')
      || dlg.querySelector('[data-close]');
    /* The one width branch in the whole app, and it stays this narrow. Every reason above is
       about a soft keyboard or a thumb, and on a computer there is neither: a person who opens a
       sheet with a field in it means to type. So above the breakpoint, and ONLY when the body
       actually holds a text field, the first field takes focus instead. The picker sheets are all
       buttons and find nothing here, so they are unaffected at every width.
       These two numbers are hand-copied from the media query at the foot of app.css — a media
       query cannot read a custom property and JS cannot read a media query's text. If one moves,
       the other moves. */
    const wide = window.matchMedia?.('(min-width: 900px) and (min-height: 600px)').matches;
    const field = wide && body.querySelector(
      'input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select');
    (field || action)?.focus({ preventScroll: true });
  });
}

/** A yes-or-no sheet. The negative is a ruled link above the one filled action, so a money or
 *  destructive question always has a labelled no as well as the X, the scrim and the back gesture. */
export async function confirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Not yet', danger = false, requireReason = false, reasonLabel = 'Reason' }) {
  return sheet({ title, render: (body, close) => {
    body.innerHTML = `<p class="sheet-text">${escapeHtml(message)}</p>
      ${requireReason ? `<label class="field"><span>${escapeHtml(reasonLabel)}</span><textarea rows="3" name="reason" required></textarea>
        <span class="err" hidden>A reason is required — the other person reads it word for word.</span></label>` : ''}
      <div class="sheet-actions"><button type="button" class="link-rule" data-close>${escapeHtml(cancelText)}</button>
        <button type="button" class="btn ${danger ? 'danger ' : ''}block" data-ok>${escapeHtml(confirmText)}</button></div>`;
    const ok = body.querySelector('[data-ok]');
    const ta = body.querySelector('textarea');
    ok.addEventListener('click', () => {
      if (requireReason && !ta.value.trim()) { ta.closest('.field').classList.add('invalid'); ta.nextElementSibling.hidden = false; ta.focus(); return; }
      close(requireReason ? ta.value.trim() : true);
    });
  } });
}

export function avatar(member, size = 36) {
  return `<span class="avatar" style="--h:${member?.hue ?? 200};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px"
    aria-hidden="true">${escapeHtml(initialsOf(member?.name || '?'))}</span>`;
}

// Status is never colour alone: a filled disc plus a word, every time.
const STATUS_LABEL = {
  pending: 'Sent · awaiting the Banker', confirmed: 'Confirmed', rejected: 'Returned', withdrawn: 'Withdrawn', reversed: 'Reversed',
  requested: 'With Victor', quoted: 'Priced · waiting on you', held: 'Committed', paid: 'Paid', completed: 'Stayed',
  declined: 'Declined', cancelled: 'Cancelled', expired: 'Expired',
  due: 'Due', active: 'Active', paused: 'Paused', inactive: 'Inactive', invited: 'Invited', left: 'Left',
};
const STATUS_TONE = {
  pending: 'warn', quoted: 'warn', requested: 'warn', due: 'warn', invited: 'warn',
  confirmed: 'good', completed: 'good', active: 'good',
  held: 'info', paid: 'info',
  rejected: 'bad', declined: 'bad', expired: 'bad',
  withdrawn: 'muted', cancelled: 'muted', paused: 'muted', inactive: 'muted', left: 'muted', reversed: 'muted',
};
export const statusLabel = (s) => STATUS_LABEL[s] || s;
export function chip(status, label) {
  return `<span class="chip chip-${STATUS_TONE[status] || 'muted'}"><i></i>${escapeHtml(label || statusLabel(status))}</span>`;
}

/** A button says what it is doing without ceasing to be itself.
 *  It used to swap its textContent for the word and swap it back, which flattened everything
 *  inside it into one string: the live figure on /book came back as plain text — no
 *  <b class="num">, no mono face — the send mark on /pay was destroyed outright, and the
 *  separator lost its aria-hidden, so a reader said the bullet out loud. Worse, the view holds
 *  a reference to that figure (catalog.js closes over #ask-fig once) and the restored copy is
 *  a different node, so after one failed write the docked action showed a points total the app
 *  already knew to be wrong while the panel above it showed the right one.
 *  Nothing is removed now. The resting children are gathered once into a sleeve that is not a
 *  box (display:contents), so the row lays out exactly as before — gap, icon size, the lot —
 *  and the same nodes stay in the page, live, for the view to keep writing to. The sleeve is
 *  only hidden while the word lies over it, and the hidden children still hold the box open,
 *  so it does not move. The greyed look and the height are the stylesheet's own (.btn[disabled],
 *  --h-touch); no colour, no radius and no query is introduced here. */
export function setBusy(btn, busy, label) {
  if (!btn) return;
  btn.disabled = busy;
  btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  btn.classList.toggle('is-busy', busy);
  const sleeve = restingSleeve(btn);
  let say = btn.querySelector(':scope > .busy-say');
  if (busy) {
    if (sleeve) sleeve.style.visibility = 'hidden';
    if (!say) {
      say = document.createElement('span');
      say.className = 'busy-say';
      say.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;';
      if (getComputedStyle(btn).position === 'static') { btn.dataset.restPos = btn.style.position; btn.style.position = 'relative'; }
      btn.append(say);
    }
    say.textContent = label || 'Working…';
  } else {
    say?.remove();
    if (sleeve) sleeve.style.visibility = '';
    if ('restPos' in btn.dataset) { btn.style.position = btn.dataset.restPos; delete btn.dataset.restPos; }
  }
}
/** The sleeve the resting children live in, made on the first busy and kept afterwards: making
 *  it twice, or unwrapping it, would hand the view a fresh set of nodes — the very bug above. */
function restingSleeve(btn) {
  let sleeve = btn.querySelector(':scope > .btn-rest');
  if (sleeve) return sleeve;
  const rest = [...btn.childNodes].filter((n) => !(n.nodeType === 1 && n.classList.contains('busy-say')));
  if (!rest.length) return null;
  sleeve = document.createElement('span');
  sleeve.className = 'btn-rest';
  sleeve.style.display = 'contents';
  btn.insertBefore(sleeve, rest[0]);
  sleeve.append(...rest);
  return sleeve;
}

/** The odometer. Reserved for the balance — everything else lands instantly. */
export function countUp(node, to, { duration = 900, format = (n) => Math.round(n).toLocaleString('en-US') } = {}) {
  const from = Number(String(node.textContent).replace(/[^\d.-]/g, '')) || 0;
  if (prefersReducedMotion() || from === to) { node.textContent = format(to); return; }
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / duration);
    node.textContent = format(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export const X = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
