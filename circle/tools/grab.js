/**
 * Grab — the Circle's button on a page Victor is already looking at.
 *
 * WHAT IT IS. A bookmark. Victor is signed in to Interval as himself, on the Getaways results
 * page he opened himself, looking at it. He taps Grab. This reads the text his browser has
 * already drawn on that page, sends it to the Circle, and shows him what it made of it. Nothing
 * is on the board until he taps again.
 *
 * WHAT IT IS NOT, and why the difference matters. It does not log in — there is no second
 * session, no stored password, no cookie of anyone's held anywhere. It does not crawl — it asks
 * for no page, follows no link, and cannot reach a page he has not opened. It does not run on a
 * schedule — it runs when a finger touches it and never otherwise. It is his clipboard with the
 * retyping taken out, which is the whole of it. That is why it is safe for his membership: the
 * thing Interval's terms forbid is automated access to their service, and this is a person
 * reading his own screen.
 *
 * WHY NOTHING POSTS ON THE FIRST TAP. The page is read as text, and text can be misread. A week
 * with the wrong price on it is worse than no week at all, because a member spends points against
 * it. So the first tap only asks "what do you see?" and shows every row, the unreadable ones
 * included, with the price it read. The second tap is the one that puts them up.
 *
 * INSTALL (once). Make a bookmark, any name, with this as the address:
 *
 *   javascript:(function(){var d=document,s=d.createElement('script');s.src='https://victorfromaruba-stack.github.io/BY-JOHNNY-PAESCH/circle/tools/grab.js?'+Date.now();d.documentElement.appendChild(s);})()
 *
 * On a phone: save any page as a bookmark, then edit it and paste that over the address. To use
 * it, open the Getaways page, then pick the bookmark from the address bar.
 *
 * The first tap asks for the Desk's ingest token and keeps it in this browser only. It is not in
 * the bookmark and not in this file, so a bookmark someone copies off a shared screen is useless.
 */
(function () {
  'use strict';

  var ENDPOINT = 'https://cdkopyphjvfxjqhasrae.supabase.co/functions/v1/ingest-deal';
  var KEY = 'hunto.ingest.token';
  var HOST = 'hunto-grab';

  // ---------------------------------------------------------------- the token, kept locally
  function token(force) {
    var held = null;
    try { held = window.localStorage.getItem(KEY); } catch (e) { held = null; }
    if (held && !force) return held;
    var asked = window.prompt('The Circle’s ingest token. It is kept in this browser and nowhere else.', held || '');
    if (!asked) return null;
    asked = asked.trim();
    try { window.localStorage.setItem(KEY, asked); } catch (e) { /* private window: this tap still works */ }
    return asked;
  }

  // ---------------------------------------------------------------- the panel
  var old = document.getElementById(HOST);
  if (old) old.remove();
  var host = document.createElement('div');
  host.id = HOST;
  host.style.cssText = 'all:initial;position:fixed;inset:auto 0 0 0;z-index:2147483647';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = [
    '<style>',
    ':host,*{box-sizing:border-box}',
    '.wrap{font:400 15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;',
    '  color:#121A26;background:#EDF1F0;border-top:1px solid #C9D2D0;',
    '  max-height:76vh;display:flex;flex-direction:column;',
    '  padding-bottom:env(safe-area-inset-bottom,0px)}',
    '.head{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid #DDE4E3;background:#FFFFFF}',
    '.mark{font:700 12px/1 -apple-system,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#136D78}',
    '.said{flex:1;min-width:0;color:#5C6A6F;font-size:13px}',
    '.x{all:unset;cursor:pointer;min-width:44px;min-height:44px;display:grid;place-items:center;',
    '  border-radius:9999px;color:#5C6A6F;font-size:20px;line-height:1}',
    '.x:focus-visible{outline:2px solid #136D78;outline-offset:2px}',
    '.list{overflow:auto;-webkit-overflow-scrolling:touch;padding:4px 0}',
    '.row{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-bottom:1px solid #DDE4E3}',
    '.row:last-child{border-bottom:0}',
    // A row set aside should recede, not glow: it goes DARKER than the ground, not lighter.
    '.row.no{background:#E3E9E8;color:#5C6A6F}',
    '.who{flex:1;min-width:0}',
    // The name wraps. An ellipsis here cut off which Marriott it was and cut off the tag saying
    // whether the week is going up — the two things the panel exists to tell him.
    '.name{font-weight:600;line-height:1.32}',
    '.row.no .name{font-weight:400}',
    '.sub{font-size:13px;color:#5C6A6F;margin-top:3px}',
    // A fixed narrow column. Left to size itself it demanded 190px for the points figure and
    // squeezed the name to nothing.
    '.num{width:86px;flex:none;font:500 15px/1.3 ui-monospace,"SF Mono",Menlo,Consolas,monospace;',
    '  font-variant-numeric:tabular-nums;text-align:right}',
    '.num b{font-weight:600;display:block;font-size:17px}',
    '.num span{display:block;font-size:12px;color:#5C6A6F;font-weight:400;white-space:nowrap}',
    '.tag{display:inline-block;font:600 11px/1.6 -apple-system,system-ui,sans-serif;letter-spacing:.06em;',
    '  text-transform:uppercase;padding:0 7px;border-radius:8px;margin-left:6px;white-space:nowrap}',
    '.tag.ok{background:#DDF2F4;color:#136D78}',
    '.tag.was{background:#E3E9E8;color:#5C6A6F}',
    '.tag.warn{background:#F7ECC4;color:#121A26}',
    '.foot{display:flex;gap:10px;align-items:center;padding:12px 16px;border-top:1px solid #C9D2D0;background:#FFFFFF}',
    '.go{all:unset;cursor:pointer;flex:1;min-height:48px;display:grid;place-items:center;',
    '  background:#121A26;color:#EDF1F0;border-radius:12px;font-weight:600;text-align:center;padding:0 16px}',
    '.go[disabled]{background:#C9D2D0;color:#6E7D83;cursor:default}',
    '.go:focus-visible{outline:2px solid #136D78;outline-offset:2px}',
    '.ghost{all:unset;cursor:pointer;min-height:48px;padding:0 16px;display:grid;place-items:center;',
    '  border:1px solid #C9D2D0;border-radius:12px;color:#121A26;font-weight:500}',
    '.ghost:focus-visible{outline:2px solid #136D78;outline-offset:2px}',
    '.note{padding:12px 16px;color:#5C6A6F;font-size:13px}',
    '@media (prefers-color-scheme:dark){',
    '  .wrap{color:#E8EEF0;background:#0B1220;border-top-color:rgba(255,255,255,.14)}',
    '  .head,.foot{background:#131C2B;border-color:rgba(255,255,255,.08)}',
    '  .mark{color:#5CD3DF}.said,.sub,.num span,.note{color:#9AA8AD}',
    '  .row{border-bottom-color:rgba(255,255,255,.08)}.row.no{background:#060B14;color:#9AA8AD}',
    '  .tag.ok{background:#0E3A41;color:#8FE3EC}.tag.was{background:#1B2637;color:#9AA8AD}',
    '  .tag.warn{background:#4A3B08;color:#F7ECC4}',
    '  .go{background:#E8EEF0;color:#0B1220}.go[disabled]{background:#1B2637;color:#7A8A90}',
    '  .ghost{border-color:rgba(255,255,255,.14);color:#E8EEF0}}',
    '</style>',
    '<div class="wrap">',
    '  <div class="head"><span class="mark">Hunto</span><span class="said" id="said">Reading this page…</span>',
    '    <button class="x" id="close" aria-label="Close">×</button></div>',
    '  <div class="list" id="list"></div>',
    '  <div class="foot" id="foot" hidden></div>',
    '</div>',
  ].join('');
  document.documentElement.appendChild(host);

  var $ = function (id) { return root.getElementById(id); };
  var said = $('said'), list = $('list'), foot = $('foot');
  $('close').addEventListener('click', function () { host.remove(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape' && document.getElementById(HOST)) { host.remove(); document.removeEventListener('keydown', esc); }
  });

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function note(text) { list.replaceChildren(el('p', 'note', text)); }

  // ---------------------------------------------------------------- what came back
  var DAY = { month: 'short', day: 'numeric' };
  function span(r) {
    if (!r.from) return 'no dates on it';
    var a = new Date(r.from + 'T12:00:00'), b = r.to ? new Date(r.to + 'T12:00:00') : null;
    return a.toLocaleDateString('en-GB', DAY) + (b ? ' – ' + b.toLocaleDateString('en-GB', DAY) : '')
      + (r.nights ? ' · ' + r.nights + ' nights' : '');
  }
  var WORD = { posted: ['ok', 'On the board'], 'would-post': null, already: ['was', 'Already up'],
               skipped: null, failed: ['warn', 'Would not save'] };

  function draw(res) {
    list.replaceChildren();
    (res.results || []).forEach(function (r) {
      var gone = r.state === 'skipped';
      var row = el('div', 'row' + (gone ? ' no' : ''));
      var who = el('div', 'who');
      var name = el('div', 'name', r.place || 'Not one of our places');
      var tag = WORD[r.state];
      if (tag) { var t = el('span', 'tag ' + tag[0], tag[1]); name.appendChild(t); }
      if (r.guessedPrice) name.appendChild(el('span', 'tag warn', 'Price unlabelled'));
      who.appendChild(name);
      who.appendChild(el('div', 'sub', gone ? span(r) + ' — ' + (r.why || 'could not be read')
        : span(r) + (r.unit ? ' · ' + r.unit : '')));
      row.appendChild(who);
      var num = el('div', 'num');
      if (r.usdNightly) {
        num.appendChild(el('b', null, '$' + Math.round(r.usdNightly)));
        num.appendChild(el('span', null, 'a night'));
        if (r.pointsPerNight) num.appendChild(el('span', null, r.pointsPerNight.toLocaleString('en-US') + ' pts'));
      } else { num.appendChild(el('span', null, 'no price')); }
      row.appendChild(num);
      list.appendChild(row);
    });
  }

  function summarise(res) {
    var n = res.read || 0, ready = res.ready || 0, up = res.posted || 0;
    if (res.mode === 'confirmation') return 'A Getaway confirmation, not a page of them.';
    if (!n) return res.why || 'Nothing on this page read as a week.';
    if (up) return up + (up === 1 ? ' week is' : ' weeks are') + ' on the board.';
    if (ready) return n + ' read · ' + ready + ' the Circle does not have yet.';
    return n + ' read · none of them are new.';
  }

  // ---------------------------------------------------------------- the two taps
  function send(dry, tok, then) {
    var body = JSON.stringify({ subject: document.title, text: document.body.innerText, dryRun: !!dry });
    fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': tok }, body: body })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); })
      .then(function (out) {
        if (out.status === 401) {
          said.textContent = 'The Circle did not accept that token.';
          note('Tap Try another token and paste the one the Desk was given.');
          foot.hidden = false;
          foot.replaceChildren(button('ghost', 'Try another token', function () {
            var t = token(true); if (t) { said.textContent = 'Reading this page…'; note(''); foot.hidden = true; send(true, t); }
          }));
          return;
        }
        if (out.status >= 400) { said.textContent = 'The Circle answered ' + out.status + '.'; note(String(out.json && out.json.error || '')); return; }
        then(out.json);
      })
      .catch(function (err) {
        said.textContent = 'Could not reach the Circle.';
        note('That is the connection, not this page. Nothing was sent. (' + (err && err.message || 'no detail') + ')');
      });
  }

  function button(cls, label, fn) {
    var b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }

  function afterDry(tok, res) {
    said.textContent = summarise(res);
    if (!res.results || !res.results.length) { note(res.why || 'Nothing on this page read as a week. Scroll the results into view and tap again — a page only shows what it has drawn.'); return; }
    draw(res);
    var ready = res.ready || 0;
    foot.hidden = false;
    var go = button('go', ready ? 'Put ' + ready + (ready === 1 ? ' week' : ' weeks') + ' on the board' : 'Nothing new to put up', function () {
      go.disabled = true;
      go.textContent = 'Putting them up…';
      send(false, tok, function (done) {
        said.textContent = summarise(done);
        draw(done);
        foot.replaceChildren(button('ghost', 'Close', function () { host.remove(); }));
      });
    });
    go.disabled = !ready;
    foot.replaceChildren(go, button('ghost', 'Close', function () { host.remove(); }));
  }

  var tok = token(false);
  if (!tok) { host.remove(); return; }
  send(true, tok, function (res) { afterDry(tok, res); });
}());
