// UI primitives: toasts (with undo), dialogs that behave as bottom sheets on phones,
// status chips, avatars, form helpers, and the one odometer in the app.
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

/** A dialog that is a centred sheet on desktop and a bottom sheet on a phone. */
export function sheet({ title, render, wide = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = `sheet${wide ? ' wide' : ''}`;
    dlg.innerHTML = `<div class="sheet-head"><h2 class="sheet-title">${escapeHtml(title)}</h2>
        <button class="icon-btn" data-close aria-label="Close">${X}</button></div><div class="sheet-body"></div>`;
    document.body.appendChild(dlg);
    let value;
    const close = (v) => { value = v; dlg.close(); };
    dlg.addEventListener('close', () => { dlg.remove(); resolve(value); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) close(undefined); });
    render(dlg.querySelector('.sheet-body'), close);
    dlg.showModal();
    dlg.querySelector('input, textarea, select, button:not([data-close])')?.focus();
  });
}

export async function confirmDialog({ title, message, confirmText = 'Confirm', danger = false, requireReason = false, reasonLabel = 'Reason' }) {
  return sheet({ title, render: (body, close) => {
    body.innerHTML = `<p class="sheet-text">${escapeHtml(message)}</p>
      ${requireReason ? `<label class="field"><span>${escapeHtml(reasonLabel)}</span><textarea rows="3" name="reason" required></textarea>
        <span class="err" hidden>A reason is required — the other person reads it word for word.</span></label>` : ''}
      <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button>
        <button class="btn ${danger ? 'danger' : ''}" data-ok>${escapeHtml(confirmText)}</button></div>`;
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
  requested: 'With Victor', quoted: 'Quoted · waiting on you', held: 'Committed', paid: 'Paid', completed: 'Stayed',
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
