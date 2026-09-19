// The one appearance choice a member makes: follow the phone, or light, or dark.
//
// Three things have to agree on it. The stylesheet reads `data-theme` on <html> (tokens.css
// answers to `dark`, and to no attribute at all under a dark system setting); the choice is kept
// under the same localStorage key the old bar toggle used, so a member who already picked one
// keeps it; and the two `<meta name="theme-color">` lines in index.html, which paint the status
// bar of the installed app, are rewritten to the ground colour of the chosen theme — otherwise a
// member who chose dark on a light phone gets a light strip above a dark page.
//
// No colour is written in this file. The ground the metas get is read back from the stylesheet
// once the attribute is set, so tokens.css stays the only place a colour is defined.

const KEY = 'hunto.theme';
const MODES = ['system', 'light', 'dark'];

const metas = () => [...document.querySelectorAll('meta[name="theme-color"]')];
// What index.html shipped, one per meta, so `system` can hand the choice back to the browser.
let shipped = null;

/** 'system' | 'light' | 'dark' — what is kept, or 'system' when nothing is. */
export function getTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return MODES.includes(v) ? v : 'system';
  } catch { return 'system'; }
}

/** Keep a choice and show it. Anything that is not a mode is read as 'system'. */
export function setTheme(mode) {
  const m = MODES.includes(mode) ? mode : 'system';
  try { localStorage.setItem(KEY, m); } catch { /* private window, or storage refused */ }
  paint(m);
  return m;
}

/** Show the kept choice. Called once on boot, before anything is drawn. */
export function applyTheme() {
  paint(getTheme());
}

function paint(mode) {
  const root = document.documentElement;
  const ms = metas();
  if (!shipped) shipped = ms.map(m => m.getAttribute('content'));
  if (mode === 'system') {
    delete root.dataset.theme;
    ms.forEach((m, i) => { if (shipped[i] != null) m.setAttribute('content', shipped[i]); });
    return;
  }
  root.dataset.theme = mode;
  const ground = getComputedStyle(root).getPropertyValue('--ground').trim();
  // Before the stylesheet has arrived there is nothing to read; the shipped metas stay.
  if (ground) ms.forEach(m => m.setAttribute('content', ground));
}
