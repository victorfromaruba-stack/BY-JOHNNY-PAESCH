// UI primitives: toasts (with undo), the one bottom sheet that every dialog is, status chips,
// avatars, form helpers, and the one odometer in the app.
import { escapeHtml, initials as initialsOf, prefersReducedMotion } from '../core/util.js';

let toastHost;
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
  const close = () => { t.classList.remove('in'); setTimeout(() => t.remove(), prefersReducedMotion() ? 0 : 260); };
  const timer = setTimeout(close, timeout);
  return { close: () => { clearTimeout(timer); close(); } };
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
    // Focus goes to a button, never an input, so no keyboard rises over the sheet's text.
    body.querySelectorAll('[autofocus]').forEach((n) => n.removeAttribute('autofocus'));
    dlg.showModal();
    history.pushState({ huntoSheet: id }, '');
    openSheets.push(entry);
    (body.querySelector('button:not([data-close]):not([disabled])') || dlg.querySelector('[data-close]'))?.focus();
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

export function setBusy(btn, busy, label) {
  if (!btn) return;
  btn.disabled = busy;
  if (busy) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Working…'; }
  else if (btn.dataset.label) { btn.textContent = btn.dataset.label; }
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
