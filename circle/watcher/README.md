# The Circle's watcher

Checks RedWeek and Interval for weeks at the places the Circle uses, and puts anything that
undercuts our own rate on the board — so Victor and Ian can book it the same day.

Runs on Victor's VPS. Nothing about it lives in this repository except the code: every
credential is read from `.env` on that machine.

## What it does

**RedWeek** needs no login. Each listing carries its own data attributes — check-in, check-out,
nights, bedrooms, sleeps, view, price — so this reads structured values rather than guessing at
text. One request per resort, 2.5 seconds apart, identifying itself in the user agent.

**Interval** is Victor's account, and it needs a real browser — see *Interval needs a browser*
below for the three reasons, each read off the live site. Signing in is a form POST
(`j_username` / `j_password` to `/web/my/auth/login`, a Spring application), but the session
only survives if a JavaScript engine runs what comes back. The Getaway search sits behind that
login; see *Finishing Interval*.

**Posting** happens as an ordinary account calling the same `post_deal` the Desk calls. There
is no service key on the VPS, and the account holds no role at all — `post_deal` lets a member
marked as a robot through on its own account. If the `.env` on the VPS were ever read by
somebody else, that password could post a deal, read the catalog and the board, read the member
list, and file a contribution in its own name that a human still has to confirm. It could not
mint a point, move money, change a member, or touch the catalog.

## Setting it up

```sh
git clone https://github.com/victorfromaruba-stack/BY-JOHNNY-PAESCH.git
cd BY-JOHNNY-PAESCH/circle/watcher
cp .env.example .env && nano .env          # fill it in
node index.mjs --once --dry                # find things, post nothing
```

Run the `--dry` pass first and read what it found.

Make the watcher an account before that: in the app, **Settings → Add an Insider**, name it
"Watcher", username `watcher`, and tick **This is a robot, not a person** — that one checkbox is
what keeps it out of the forty seats, out of the month close and off the front page, and what
lets it post a deal. Give it no roles.
Put the password it shows you straight into `CIRCLE_PASS` — a robot is not asked to change its
password on first use, because there would be nobody to ask.

One already exists on the live Circle, so this is only if you ever want a second.

Then, for real:

```sh
node index.mjs --once                      # one pass, posts what it finds
node index.mjs                             # every WATCH_EVERY_MIN minutes, forever
```

## Keeping it running

```ini
# /etc/systemd/system/hunto-watcher.service
[Unit]
Description=Hunto Circle watcher
After=network-online.target

[Service]
Type=simple
User=hunto
WorkingDirectory=/home/hunto/BY-JOHNNY-PAESCH/circle/watcher
ExecStart=/usr/bin/node index.mjs
Restart=always
RestartSec=60

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now hunto-watcher
journalctl -u hunto-watcher -f
```

Needs Node 20 or newer. RedWeek and the posting path use nothing but the standard library.
Interval additionally needs Playwright and one browser (`npx playwright install firefox`); if it
is missing the watcher says so and carries on with RedWeek rather than dying.

## Finishing Interval

The Getaway search form is behind the login, so its exact shape is not in this code yet. Run
this once on the VPS:

```sh
node index.mjs --dump
```

It signs in, saves the pages that session lands on into `watcher/dump/`, and stops. Those are
ordinary HTML pages and **no password appears in them** — the trace records cookie *names*
only. Send them over and `INTERVAL_SEARCH_PATH` and `INTERVAL_SEARCH_FIELDS` get filled in
for good.

Until then the watcher runs RedWeek only and says so in the log.

### Interval needs a browser. RedWeek does not.

Three things stand between a plain `fetch()` and the Getaway pages, each read off the live
site rather than guessed:

1. **The login answer has no `Location` header.** It has a script:
   `window.location.replace("https://vip.intervalworld.com/web/cs?a=0")`. A browser runs it.
2. **`JSESSIONID` is host-only, `path=/web`, set separately on `www` and on `vip`.** The
   session made at the front door is not the one the VIP host wants, and no correct cookie jar
   will send it there. Something has to establish a session on `vip`, and that something runs
   in the page.
3. **`__uzma`/`__uzmb`/`__uzmc`/`__uzmd`/`__uzme` are Radware Bot Manager**, minted by a
   JavaScript challenge. A client that never runs it never earns them, and gets a polite `200`
   carrying the signed-out page instead of an honest `401`.
4. **A correct password lands on a "Please wait…" page, not on the account.** It holds the
   browser while the bot layer finishes and then moves on — sometimes by itself, sometimes only
   when its Continue button is pressed. Navigating away too early leaves the session signed
   out, which looks identical to a wrong password.
5. **A cookie-consent panel covers the login form.** It is a fixed overlay, so an automated
   click on Sign In lands on the banner instead and the form is never submitted — which again
   looks identical to a wrong password. The banner is dismissed first (known handlers, then
   acceptance words inside something that mentions cookies), and if the click still cannot
   land the form is submitted through its own `requestSubmit()`, which runs Interval's
   `onSubmit="return submitOnce(this)"` where `form.submit()` would skip it.

The same credentials were signed in by hand and worked, so the password was never the problem
and (3) is established rather than inferred.

Two of those need a JavaScript engine. So **Interval is driven by Playwright**
(`interval-browser.mjs`) and **RedWeek stays on plain fetch** (`redweek.mjs`) — it needs no
login and already works, finding around 138 open weeks a pass.

```sh
WATCH_BROWSER=firefox        # or chromium; whichever is installed
WATCH_INTERVAL_MODE=browser  # the default. `fetch` uses the old plain-HTTP client.
```

If Playwright is missing the watcher says so and carries on with RedWeek rather than dying.

`interval.mjs` is kept, and not as a fallback that will work: its anonymous fetches are what
the dump compares against, and its parser is shared. It cannot hold an Interval session, and
its tests now say so out loud rather than pretending otherwise.

### Victor's account is served from a different host

Signing in happens at `www.intervalworld.com`. The answer to the login POST carries **no
`Location` header** — it carries a script:

```js
function doRedirect() { window.location.replace("https://vip.intervalworld.com/web/cs?a=0"); }
```

A browser runs that and moves. Victor is VIP Gold, and VIP members are served from
`vip.intervalworld.com`. A `fetch()` client sees a plain 200, follows nothing, and keeps asking
`www.` for pages the session now lives on at `vip.` — which answers, cheerfully, with the
logged-out version. That was the bug.

The watcher now reads that redirect out of the page (`followTo`), goes there, and **moves its
origin** so everything afterwards is asked of that host. Signing in always starts back at
`www.` regardless of where the last session ended.

The cookie jar scopes cookies the way a browser does — name, domain and path — because
`JSESSIONID` is host-only with `path=/web` and each host has its own. An earlier version keyed
them on name alone, which sent `www`'s session to `vip` (something no browser would do) and then
let one overwrite the other. A redirect to anything that is not `*.intervalworld.com` is **not
followed** either, on both the HTTP and the script path.

None of which is enough on its own: the fetch client can now follow the move correctly and still
not hold a session, because `vip` wants its own and the bot layer is what grants it. That is
what the browser is for.

### How to tell whether it actually got in

Interval does not bounce an anonymous caller to the login page. It answers the very same URL,
200 and all, with the public version of the page. Verified against the live site with no
credentials:

| asked for | got | says |
|---|---|---|
| `/web/cs?a=1000` | 200, lands on `/web/my/home` | Sign In |
| `/web/my/home` | 200 | Sign In |
| `/web/my/info/benefits/getaways` | 200 | Sign In |

So the URL a login lands on proves nothing, and neither does an HTTP 200. `--dump` therefore
fetches every page **twice** — once with the session, once with a brand-new jar and no login —
and writes both, with sizes, into `02_what_happened.html`. If the two match, the password was
not accepted. That file also carries every hop with its status, its redirect and which cookies
it set, so a failed run can be read afterwards without another trip to the VPS.

The login form itself, read off the live page: one form, `POST /web/my/auth/login`, fields
`j_username` / `j_password` / `_spring_security_remember_me`, and **no CSRF token**. The
password box is `maxlength="14"` and the login ID box `maxlength="33"` — a browser truncates
silently as you type, so if `INTERVAL_PASS` is longer than 14 characters the site has never
been shown that string. The watcher reads those limits off the form and refuses with a plain
message rather than reporting a wrong password.

Two suites, both stub-driven, no network and no credentials:

```sh
node session.test.mjs    # 48 assertions — the fetch client, cookie scoping, the host guard
node browser.test.mjs    # 23 assertions — the browser client end to end (skips if no Playwright)
```

The ones that matter most: a refused login that still redirects to a normal page is reported
as **refused**; a redirect off Interval is never followed; `www`'s session cookie is never
sent to `vip`; and the password appears in none of the dumped files.

Every failure so far has looked the same from the outside — a polite 200 carrying the
signed-out page — which is why the dump now names which step it was: consent panel, form
submission, waiting room, or the session itself.

The browser suite covers all three shapes of holding page: one that moves on its own, one that
only moves when Continue is pressed, and one that never moves at all — which must be reported
as not-cleared rather than hanging a pass that runs unattended for months.

What no stub can prove is the Radware challenge itself, which only the real site issues.

## What it will and will not post

`WATCH_MUST_BEAT_OURS=true` means it only speaks up about a week that undercuts the Circle's
own rate by at least `WATCH_BEAT_BY_PCT`. Without it, RedWeek alone finds around a hundred
open weeks a day at our resorts, which is a list rather than news.

One consequence worth knowing: now that the Marriott villa rates are set against what Interval
charges, RedWeek rarely beats them. That is the point — but it means most of what this finds
at the Surf Club and Ocean Club will come from Interval, and RedWeek will earn its keep at the
resorts where our published rate is higher.

A week it cannot price against the catalog is not posted either. "We could not work out what
this is worth" is not a reason to put something in front of forty people.

It never posts the same week twice. Each find carries a `source_ref` — RedWeek's own posting
id, not the price, so a listing that drops a dollar is still the same week — and that is checked
against **every** deal on the board, not only the live ones. A deal you take down stays down.
