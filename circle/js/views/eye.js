// God's Eye View: a live 3D globe of planes, ships, satellites, earthquakes and public cameras
// (github.com/bilawalsidhu/gods-eye-view, MIT). It does not run here. It runs on Victor's hq
// server, on the public internet behind a door that only lets in browsers sent from the Circle
// (ai-hq: gods-eye/gate.mjs and scripts/install-gods-eye.sh).
//
// "Open" asks the club's server for a one-time pass (supabase/functions/gev-pass), which only a
// signed-in, active Insider gets, and sends a new tab through the door with it. The door then
// remembers that browser for two weeks. Nothing to install, and no address in this repository.
import { toast, setBusy } from '../ui/components.js';
import { icon } from '../ui/icons.js';

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };

export function eye({ store }) {
  const wrap = el(`<div><section class="sec"><div class="wrap">
    <p class="eyebrow">${icon('target')}God’s Eye View</p>
    <h1>The world, <em class="ac">live</em></h1>
    <p class="lede">Planes, ships, satellites, earthquakes and public cameras on one 3D globe. Ride in a cockpit, follow a ship into port.</p>
    <button type="button" class="btn block" style="margin-top:var(--s-5)" id="open-eye">${icon('external', { size: 17 })}<span>Open God’s Eye View</span></button>
    <p class="dateline">Opens in a new tab, for Insiders only. That browser stays let in for two weeks; after that, open it from here again.</p>
    <p class="small muted" style="margin-top:var(--s-4)">It runs on Victor’s own server. The data is public: flight transponders, ship beacons, satellite orbits, seismographs and city traffic cameras. It works best on a computer or a recent phone.</p>
  </div></section></div>`);

  wrap.querySelector('#open-eye').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    // The tab is opened inside the tap, before the pass arrives: a tab opened after an await is
    // no longer the member's own action, and phones block it as a pop-up.
    const tab = window.open('', '_blank');
    setBusy(btn, true, 'Getting your pass…');
    try {
      const { url } = await store.godsEyePass();
      if (tab) { tab.opener = null; tab.location.href = url; }
      else location.assign(url);
    } catch (err) {
      tab?.close();
      toast(err.message, { kind: 'bad', timeout: 8000 });
    } finally {
      setBusy(btn, false);
    }
  });
  return wrap;
}
