// Putting Hunto on the home screen, from anywhere that asks.
//
// The card screen used to hold this on its own; Home now nudges for it too, so the one path
// lives here. Chrome and Edge hand the app a real one-tap prompt (app.js keeps it under
// window.__huntoInstall); Safari on an iPhone has no such thing, and a member is told the two
// taps instead. Nothing here asserts that the app IS installed — only the display mode says so.

import { sheet, toast } from './components.js';
import { isIOS } from './wallet.js';

const NUDGE_KEY = 'hunto.installNudge';

/** Opened from the home screen, on either platform. */
export const isStandalone = () =>
  !!(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);

/** Whether Home should carry the one-line nudge: not installed, a phone that can, not dismissed. */
export function wantsInstallNudge() {
  if (isStandalone()) return false;
  if (!(isIOS() || window.__huntoCanInstall?.())) return false;
  try { return !localStorage.getItem(NUDGE_KEY); } catch { return true; }
}

/** The member said not now; Home stops asking. */
export function dismissInstallNudge() {
  try { localStorage.setItem(NUDGE_KEY, new Date().toISOString()); } catch { /* storage refused */ }
}

/**
 * Offer the install. Resolves 'accepted' | 'dismissed' | 'shown' — 'shown' meaning the browser
 * had no prompt of its own and the member was told which taps to make instead.
 */
export async function showInstall() {
  // Chrome and Edge can do this properly. Everyone else gets told exactly which taps.
  const outcome = await (window.__huntoInstall?.() ?? null);
  if (outcome === 'accepted') { toast('Added. Hunto is on your home screen.', { kind: 'good' }); return outcome; }
  if (outcome === 'dismissed') return outcome;
  await sheet({ title: 'Put Hunto on your home screen', render: (body) => {
    body.innerHTML = isIOS()
      ? `<p class="sheet-text">Two taps, and it costs nothing.</p>
         <ol class="stack tight" style="padding-left:1.2em">
           <li>Tap the <b>share</b> button — the square with the arrow, at the bottom of Safari.</li>
           <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
           <li>Tap <b>Add</b>.</li>
         </ol>
         <p class="small muted" style="margin-top:14px">It has to be Safari — Chrome on an iPhone cannot do this. Once it is there, Hunto opens full screen and your card is one tap away.</p>
         <div class="sheet-actions"><button type="button" class="btn block" data-close>Got it</button></div>`
      : `<p class="sheet-text">Open your browser's menu and choose <b>Install</b> or <b>Add to Home screen</b>. Hunto then opens like an app, and your card is one tap away.</p>
         <div class="sheet-actions"><button type="button" class="btn block" data-close>Got it</button></div>`;
  } });
  return 'shown';
}
