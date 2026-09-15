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
    // The user agent's [hidden] rule loses to any author display declaration, and this sheet sets
    // .foot{display:flex}. Without this the footer bar shows empty from first paint and every
    // `hidden = true` in the panel is a no-op.
    '[hidden]{display:none!important}',
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
    '.group{padding:12px 16px 10px;background:#E3E9E8;border-bottom:1px solid #C9D2D0}',
    '.group b{display:block;font-size:14px}',
    '.group span{display:block;font-size:12px;color:#5C6A6F;margin-top:3px}',
    '.group .ghost{margin-top:10px;min-height:44px;font-size:14px}',
    '.group:empty{padding:0;border-bottom:0}',
    '@media (prefers-color-scheme:dark){',
    '  .wrap{color:#E8EEF0;background:#0B1220;border-top-color:rgba(255,255,255,.14)}',
    '  .head,.foot{background:#131C2B;border-color:rgba(255,255,255,.08)}',
    '  .mark{color:#5CD3DF}.said,.sub,.num span,.note{color:#9AA8AD}',
    '  .row{border-bottom-color:rgba(255,255,255,.08)}.row.no{background:#060B14;color:#9AA8AD}',
  '  .group{background:#060B14;border-bottom-color:rgba(255,255,255,.14)}.group span{color:#9AA8AD}',
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
  /** How long ago, in the words a person would use. */
  function ago(iso) {
    var ms = Date.now() - Date.parse(iso);
    if (!(ms >= 0)) return 'just now';
    var mins = Math.round(ms / 6e4);
    if (mins < 2) return 'just now';
    if (mins < 60) return mins + ' minutes ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hrs / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  var WORD = { posted: ['ok', 'On the board'], 'would-post': null, already: ['was', 'Already up'],
               refreshed: ['was', 'Still there'], back: ['ok', 'Back on'],
               skipped: null, failed: ['warn', 'Would not save'] };

  function draw(res) {
    list.replaceChildren();
    if (res.missing && res.missing.length) {
      var head = el('div', 'group');
      head.appendChild(el('b', null, res.missing.length + (res.missing.length === 1 ? ' week on the board was not on this page' : ' weeks on the board were not on this page')));
      head.appendChild(el('span', null, 'They may be gone, or they may be on a page you have not scrolled to. Clearing them is your call.'));
      var ids = res.missing.map(function (m) { return m.dealId; });
      var clear = button('ghost', 'Take ' + (ids.length === 1 ? 'it' : 'them') + ' off the board', function () {
        clear.disabled = true;
        clear.textContent = 'Taking them off\u2026';
        send(false, tokenHeld, function (done) {
          said.textContent = (done.retired || 0) + (done.retired === 1 ? ' week is off the board.' : ' weeks are off the board.');
          res.missing = [];
          draw(res);
        }, { retire: ids });
      });
      head.appendChild(clear);
      list.appendChild(head);
      res.missing.forEach(function (m) {
        var row = el('div', 'row no');
        var who = el('div', 'who');
        who.appendChild(el('div', 'name', m.title || 'A week'));
        who.appendChild(el('div', 'sub', span(m) + (m.lastSeen ? ' · last seen ' + ago(m.lastSeen) : '')));
        row.appendChild(who);
        var num = el('div', 'num');
        if (m.pointsPerNight) { num.appendChild(el('span', null, m.pointsPerNight.toLocaleString('en-US'))); num.appendChild(el('span', null, 'pts a night')); }
        row.appendChild(num);
        list.appendChild(row);
      });
      list.appendChild(el('div', 'group'));
    }
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

  /** How many rows the Circle already holds and this page has just confirmed are still there. */
  function standing(res) {
    return (res.results || []).filter(function (r) { return r.state === 'refreshed' || r.state === 'already' || r.state === 'back'; }).length;
  }

  function summarise(res) {
    var n = res.read || 0, ready = res.ready || 0, up = res.posted || 0, held = standing(res);
    var from = res.sourceLabel ? ' on ' + res.sourceLabel : '';
    if (res.mode === 'confirmation') return 'A Getaway confirmation, not a page of them.';
    if (!n) return res.why || 'Nothing on this page read as a week.';
    if (up || (!ready && !res.dryRun)) {
      return [up ? up + (up === 1 ? ' week added' : ' weeks added') : '',
              held ? held + ' still there' : ''].filter(Boolean).join(' · ') || 'The board is up to date.';
    }
    if (ready) return n + ' read' + from + ' · ' + ready + ' the Circle does not have yet.';
    return n + ' read' + from + ' · the Circle already has ' + (held === 1 ? 'it' : 'them') + '.';
  }

  // ---------------------------------------------------------------- the two taps
  //
  // The page is read ONCE, on the first tap, and the second tap posts those same words.
  //
  // Reading it again would quietly undo the whole point of asking. A results page is live: it
  // lazy-loads as you scroll, re-renders when a filter settles, and drops a week the moment
  // somebody else takes it. Re-reading on the second tap would mean Victor approves four weeks
  // and the Circle posts whatever the page happened to say a few seconds later — which is exactly
  // the unchecked number the confirmation exists to prevent.
  var SEEN = null;
  var tokenHeld = null;

  function send(dry, tok, then, instead) {
    tokenHeld = tok;
    if (!instead && (dry || SEEN === null)) SEEN = { subject: document.title, origin: location.hostname, text: document.body.innerText };
    var body = JSON.stringify(instead
      || { subject: SEEN.subject, origin: SEEN.origin, text: SEEN.text, dryRun: !!dry });
    fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': tok }, body: body })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); })
      .then(function (out) {
        if (out.status === 401) {
          said.textContent = 'The Circle did not accept that token.';
          note('Tap Try another token and paste the one the Desk was given.');
          foot.hidden = false;
          foot.replaceChildren(button('ghost', 'Try another token', function () {
            var t = token(true);
            if (!t) return;
            said.textContent = 'Reading this page…'; note(''); foot.hidden = true;
            // The continuation matters, and so does passing the NEW token through it: `afterDry`
            // closes over whichever token it is handed, and that is the one the posting tap uses.
            // Without it the retry threw on success and the panel blamed the network.
            send(true, t, function (res) { afterDry(t, res); });
          }));
          return;
        }
        if (out.status >= 400) { said.textContent = 'The Circle answered ' + out.status + '.'; note(String(out.json && out.json.error || '')); return; }
        if (typeof then === 'function') then(out.json);
      })
      .catch(function (err) {
        said.textContent = 'Could not reach the Circle.';
        // A read that fails has certainly changed nothing. A POST that fails has not: the Circle
        // saves the weeks one at a time and answers at the end, so a dropped answer can sit on
        // either side of the save. Saying "nothing was sent" there would be a guess presented as
        // a fact, and the Desk would find rows it had been told were not posted.
        note(dry
          ? 'That is the connection, not this page. Nothing was sent. (' + (err && err.message || 'no detail') + ')'
          : 'The answer never came back, so some weeks may have been saved and some not. Open the Desk and look before tapping again. ('
            + (err && err.message || 'no detail') + ')');
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
    var ready = res.ready || 0, held = standing(res);
    // Confirming a week is STILL there is worth a tap of its own. The board stamps every row with
    // when it was last seen, and that stamp is the only thing a member browsing on their own has
    // to go on — so a page with nothing new on it still has something to tell the Circle.
    var label = ready ? 'Put ' + ready + (ready === 1 ? ' week' : ' weeks') + ' on the board'
      : held ? 'Mark ' + (held === 1 ? 'it' : 'these ' + held) + ' as still there'
      : 'Nothing to put up';
    foot.hidden = false;
    var go = button('go', label, function () {
      go.disabled = true;
      go.textContent = ready ? 'Putting them up…' : 'Marking them…';
      send(false, tok, function (done) {
        said.textContent = summarise(done);
        draw(done);
        foot.replaceChildren(button('ghost', 'Close', function () { host.remove(); }));
      });
    });
    go.disabled = !(ready || held);
    foot.replaceChildren(go, button('ghost', 'Close', function () { host.remove(); }));
  }

  var tok = token(false);
  if (!tok) { host.remove(); return; }
  send(true, tok, function (res) { afterDry(tok, res); });
}());
