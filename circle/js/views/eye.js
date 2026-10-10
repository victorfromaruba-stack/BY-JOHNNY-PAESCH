// God's Eye View: a live 3D globe of planes, ships, satellites, earthquakes and public cameras
// (github.com/bilawalsidhu/gods-eye-view, MIT). It does not run here. It runs on Victor's own
// server and answers only devices on his private Tailscale network, because the server behind it
// would spend whatever keys it holds for anyone who can reach it. Installed and updated by
// ai-hq's scripts/install-gods-eye.sh; the address lives in config.js.
//
// The screen says whether THIS device can reach it, from a request it actually made, never from
// a guess. A member who is not on the network yet gets the two steps that put them on it.
import { CONFIG } from '../../config.js';
import { escapeHtml } from '../core/util.js';
import { icon } from '../ui/icons.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };

export function eye() {
  const url = CONFIG.godsEyeUrl;
  const wrap = el(`<div><section class="sec"><div class="wrap">
    <p class="eyebrow">${icon('target')}God’s Eye View</p>
    <h1>The world, <em class="ac">live</em></h1>
    <p class="lede">Planes, ships, satellites, earthquakes and public cameras on one 3D globe. Ride in a cockpit, follow a ship into port.</p>
    ${url ? `
    <a class="btn block" style="margin-top:var(--s-5)" href="${escapeHtml(url)}" target="_blank" rel="noopener">${icon('external', { size: 17 })}<span>Open God’s Eye View</span></a>
    <p class="dateline" id="reach" role="status">Checking whether this device can reach it…</p>`
    : `<p class="dateline">Not switched on yet. Victor sets it up on his server first.</p>`}
  </div></section>
  <section class="sec"><div class="wrap">
    <div class="sec-head"><h2>Getting this device on</h2></div>
    <ol class="steps">
      <li><b>Install Tailscale</b><span>Free, from <a href="https://tailscale.com/download" target="_blank" rel="noopener">tailscale.com/download</a> or your phone’s app store.</span></li>
      <li><b>Ask Victor to share it with you</b><span>He sends an invite to your email. Accept it, sign in to Tailscale with the same email, and leave Tailscale on while you watch.</span></li>
    </ol>
    <p class="small muted" style="margin-top:var(--s-4)">It runs on Victor’s own server, not on the internet, so only devices he has let in can open it. The data is public: flight transponders, ship beacons, satellite orbits, seismographs and city traffic cameras.</p>
  </div></section></div>`);

  const reach = wrap.querySelector('#reach');
  if (reach) probe(url).then((ok) => {
    reach.textContent = ok
      ? 'This device can reach it.'
      : 'This device can’t reach it yet. Turn Tailscale on, or follow the two steps below.';
  });
  return wrap;
}

/** One real request, four seconds at most. An opaque answer still means the server answered. */
async function probe(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
