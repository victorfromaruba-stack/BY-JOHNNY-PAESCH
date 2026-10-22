---
name: interval-board
description: Keep Interval International and RedWeek weeks flowing onto the Inner Hotel Circle's board, and fix the reader fast when a site changes its page. Use this skill whenever anyone mentions Interval, Getaways, RedWeek, the Grab bookmark, the ingest-deal function, a week showing the wrong price or the wrong hotel, the board being empty or stale, "it read it wrong", a screenshot of the Grab panel, Getaway Alerts, a forwarded confirmation or cancellation email, or asks to automate/scan/scrape/poll either site on a schedule. Also use it before touching parseListings, parsePrice, parseDates or matchStay in either copy, because those exist twice on purpose and a fix applied to one is a bug in the other.
---

# The Interval board

The Circle's board carries weeks Victor can book for his friends. Members browse it alone and
spend real points against what they see, so two things matter more than throughput: a price on the
board must be the price on the source, and a row must be honest about how old it is.

This skill is how weeks get on, how the reader is fixed when a site changes, and where the line is.

## The line, and why it is where it is

> **Victor moved the line on 2026-10-22, for one case only.** His words, typed to Muddy after being
> told in plain terms that the penalty is termination of the VIP Gold membership:
> 09:40 — *"I want the watch to watch it moment a member clicks on stays."*
> 09:50 — *"What I want it also scans interval when someone clicks stays."*
> Recorded in `/root/INBOX.md` (same timestamps) and in the gstack decision ledger,
> `3b066c79-64dd-4adf-850e-1abaa3602771`, author victor. Written here by Muddy, the way every rule
> in this operation is written: Victor says it, the file records it, dated and quoted.
>
> **So: automated Interval access is allowed ONLY on a member's tap of a stay — never on a timer —
> under these guardrails, which are part of the permission, not advice:**
> - sign in on `https://vip.intervalworld.com/web/my/auth/loginPage` as `Tagless`, the way the
>   17 Oct fixture was obtained (`iv-login.js` / `iv-map.js`, proxy from the locked box); add no new
>   evasion beyond what that flow already does;
> - reuse the session (saved storage state, 0600, gitignored); at most **3 sign-ins per day**;
> - **1 scan per resort per 30 minutes, 10 per hour** overall; later taps inside the window are
>   served from the last scan;
> - **full stop** on any captcha, challenge, lock, "unusual activity" page, 403, or 2 refused
>   sign-ins in a row: write the stop flag, raise the `interval-watcher` card, send Victor one ntfy
>   push saying it stopped and why; only Victor re-enables it (by deleting the flag). Never retry in
>   a loop;
> - when Interval is stopped or capped, the Grab nudge to his phone still fires.
>
> Everything below this box is still the rule for anything that is NOT a member's tap.

> **Added 22 Oct 2026, with the dates control** (the task that built it, relayed by the coordinator for Victor,
> who wanted to "see a month or two in advance"; the line it works from was *"a window of 60 days is one scan
> per resort with multiple pages, not 60 scans"*). A tap now carries the dates the member is looking for, and
> the scan searches Getaways for THOSE dates. Interval shows at most three rows per resort per results page, so
> one scan may make up to **five searches** (each from the last check-in a full page ended on) and, on the
> island-wide read, press the page's own **Next Page** up to three pages deep, never into "Areas Surrounding".
> It is still ONE scan against the caps above (one count, one session, at most one sign-in), every page goes
> through the same wall/stop check, and `--interval-read` stays one search. `interval-scan.mjs` (`SCAN`,
> `planWindow`, `nextCursor`) and its tests hold the numbers. The permission is still a member's tap, nothing
> on a timer.

**Never build, restore, or schedule automated sign-in to Interval or RedWeek. Never work around
bot management. A block, a challenge, a 403 or a robots.txt disallow is a full stop — not a puzzle.**

This is not squeamishness and it is not about legality. Nothing here is illegal. The stake is
Victor's Interval VIP Gold membership, which is the Circle's entire supply of cheap inventory.
Interval's membership terms forbid automated access, and the penalty is termination, not a warning.
A scheduled headless login is the exact pattern their bot layer exists to catch. Lose the
membership and there is no board to keep fresh.

Two specific temptations, both of which have already been tried in this repo:

- `circle/watcher/interval-browser.mjs` exists and can sign in with a real browser. It is not
  wired to a schedule, and it stays that way. Its own comments describe waiting out Radware Bot
  Manager's interstitial — that is the thing not to automate, however real the browser is.
- `INTERVAL_SEARCH_PATH` is deliberately unset. Filling it in is what would start the scanning.
  Leave it.

If someone asks for scheduled scanning — and they will, because it is the obvious thing to want —
say it in one sentence and do not argue the ethics at length. Then be straight about the rest,
because there is no clever substitute to offer: **nothing watches Interval for the Circle, and
nothing can.** Alerts do not exist on this account (see below). A person has to look. The useful
work is making that look cost almost nothing — Grab, and a reminder — not finding a way around it.

Do not offer a route without checking he can reach it. Four rounds went on recommending the app,
alerts and Ongoing Search before anyone asked, and all three turned out to be closed to him.

## How a week actually reaches the board

Three doors. All three end at the same endpoint, so the reading is fixed in one place.

| door | who runs it | what it is |
|---|---|---|
| **Grab** (`circle/tools/grab.js`) | Victor, one tap, on a page he already has open | A bookmarklet. Reads `document.body.innerText`, shows him what it made of it, posts on a second tap. |
| **Email** (`gmail-forwarder.gs`) | An Apps Script on his own account, every 5 min | Posts Interval's own mail. Confirmations go up; cancellations take the week down. |
| **Paste sheet** (`listing-paste.js`) | The Desk, by hand | Same parser, in the browser, for one listing or a whole page pasted in. |

The endpoint is `circle/supabase/functions/ingest-deal` — deployed, `verify_jwt` false, authed by a
token hashed in `ingest_tokens`. Its modes:

- **page** — `{subject, origin, text, dryRun?}`. `origin` is the browser's own `location.hostname`
  and decides the source; a host that is not Interval, RedWeek or VakayMood is refused rather than
  filed under a guess. `dryRun: true` reports and writes nothing.
- **confirmation** — mail carrying `Confirmation Number:`. Posts the week at the all-in price.
- **cancellation** — the same number with cancellation wording. Takes the week down. The test is
  narrow on purpose: the word in the SUBJECT, or a whole phrase like "has been cancelled". Every
  ordinary confirmation carries a *cancellation policy* in its small print, and matching that
  anywhere would clear live weeks.
- **retire** — `{retire: [dealId, ...]}`. Only ever called because a person tapped the button.

## What Interval's results page actually looks like

Read off Victor's own screen. Getting this wrong is how the board ends up with a $2.43 night and a
price on the wrong hotel, so it is worth holding in mind:

```
Marriott's Aruba Surf Club        <- the resort, named ONCE
Palm Beach , ARUBA - DCB          <- always under it: town, REGION - code
MSU / Overall Rating / 48 Member Ratings / Resort Details & Photos
from US$90.50 Average Night       <- the CHEAPEST week here, not any particular one
Weekly Rate                       <- the column the figures below sit in
Sep 17 2026 - Sep 24 2026   US$633.46    Book     <- THREE weeks under one resort
Sep 18 2026 - Sep 25 2026   US$633.46    Book
Sep 19 2026 - Sep 26 2026   US$1,172.54  Book
```

Four consequences, each of which was a real bug:

1. **One resort, many weeks.** The name is carried forward from its header. Cutting the page one
   chunk per date range left weeks two and three unnamed — or worse, gave them the *next* resort's
   name.
2. **A row's figure is a WEEK, not a night.** The page says so twice (column header, footnote). Read
   as nightly, US$633.46 goes up at seven times the real price. The arithmetic checks three ways:
   633.46/7 = 90.49 against the header's own "from US$90.50"; 1,008.01/7 = 144.00; 1,172.54/7 = 167.51.
3. **The header's price is not the row's.** Only money *after* a row's dates belongs to it.
4. **Occupancy and kitchen are ICONS**, and their digits are drawn inside the image, so
   `innerText` will not contain them: `unit` and `sleeps` come back blank from a paste or a Grab.
   That is correct, not a miss — but it is not the whole story, because a person looking at the
   page CAN read them, and they carry the four facts that name the unit.

### Reading the blue icons

Victor had to explain this after a round was wasted saying the icons were unreadable. They are
readable — three digits in one square, plus an optional kitchen tile beside it:

```
 2   4      <- top-left = BEDS,  top-right = SLEEPS
   0        <- bottom-centre = BEDROOMS, and 0 means a STUDIO
```

So `2 / 0 / 4` is a studio with two beds beading four; `6 / 2 / 8` is a two-bedroom with six beds
sleeping eight. The tile next to it is the kitchen: **K** a full kitchen, **LK** a limited one,
and no tile at all means Interval showed none.

The reading checks itself against the money, which is the reason to trust it: on a real page the
studio sleeping two is always the cheapest row at that resort and the two-bedroom sleeping eight
the dearest. If a unit you have read does not sit in that order against its neighbours, you have
read a digit wrong — go back and look rather than posting it.

Worth holding on to for the catalog as well: Interval, which is the source of the cheapest
inventory the Circle has, describes a unit with exactly four facts — beds, bedrooms, sleeps,
kitchen. The Circle's own catalog carries 184 room types across 23 places. The source of truth is
simpler than our model of it, and that is a hint about which one is wrong.

The host is `vip.intervalworld.com` once signed in. Dates are `Sep 17 2026 - Sep 24 2026` — no
comma, both years.

Price precedence, which is the rule that keeps all of this straight: **labels beat column headers
beat refusing.** A row saying "Average Night" answers outright. A row with a bare figure falls back
to the Weekly Rate column it sits in. A page with neither gives a figure whose meaning is unknown,
and that is REFUSED rather than quoted — the two readings are a factor of seven apart, so a guess
is not a price. The Desk sees the figure and the words "could not read whether that figure is a
night or a week", which is a two-second fix by eye and never a wrong number in front of a member.

## When a week reads wrong

Almost always a layout change. Work from evidence, never from a guess about what the page "probably"
says now.

1. **Get the real text.** Ask for a screenshot of the Grab panel, or better, the page text itself.
   Never fetch the page to find out — that is the line above.
2. **Reproduce it locally** against `parseListings` in `circle/js/data/listing-paste.js` before
   changing anything. If you cannot reproduce it, you do not yet understand it.
3. **Fix both copies.** The parser exists twice on purpose: `circle/js/data/listing-paste.js` for
   the browser, and the same functions inside `circle/supabase/functions/ingest-deal/index.ts` for
   the two callers that have no browser. A fix in one and not the other is a bug, and the two drift
   silently because nothing imports across that boundary.
4. **Check the edge cases that have bitten before** (`scripts/parser-check.mjs` runs these):
   - a week over New Year with one year printed — `Dec 28 - Jan 4, 2027` once read as −358 nights
   - a resort not in the catalog — must be refused by name, never inherit the one above it
   - a row carrying both a nightly and a weekly figure
   - a single listing pasted on its own
5. **Verify against the live endpoint with `dryRun: true`** before deploying. Deploying and then
   looking is how a wrong price reaches a member.
6. **Deploy**, then re-run the same dry call and confirm it agrees with the local run.

Never make a misread "safe" by widening a regex until something matches. A miss is cheap — the row
is skipped and the Desk sees why. A confident wrong number is what costs somebody points.

## Freshness

Every week carries `seen_at`: when it was last seen on the source's page, not when it was posted.
Those diverge after a day, and only the first answers "is this still there?".

One Grab re-syncs the page: a week already held has its clock moved (**Still there**); one taken
down that the page carries again goes back up (**Back on**); one the board has that the page did not
carry is listed separately with a button — **a Grab still only reports it**, because Interval
paginates and absence from one page is not proof. A week the Circle has *booked* is never revived.

### Not seen for 7 days is retired — changed 22 Oct 2026

> **Victor's decision, 2026-10-22 14:16**, recorded in the gstack decision ledger (author victor), after
> a screenshot of a Barceló 2BR "owner asking $9 a night", last seen 16 Oct, sitting at No. 1 on
> Stays: a live deal row the watcher has not seen again for 7 days is retired automatically (status
> `gone`, reason "not seen for 7 days"); the Stays page sorts by freshness and shows "seen N days ago"
> plainly, never "newest" for an old row; the watcher's sweep re-verifies EVERY live RedWeek row, not
> only the cheapest few it posts, so last-seen clocks are honest; Interval and VakayMood rows get the
> same 7-day rule from their own last-seen; and Ian only recommends rows seen in the last 48 hours,
> showing older ones as "last seen N days ago, tap to re-check". Written here as relayed by the
> coordinator; the ledger entry has his own wording.
> The same afternoon: *"The watcher needs to update the moment someone clicks Stays."* — and, looking
> at the list: *"All I see is RedWeek. Interval should be on top since it's the cheapest."*

This reverses the old line "reported, never retired automatically", for the watcher and the database:

- **The rule** (`retire_stale_deals`, `supabase/migrations/20261022_board_freshness.sql`, called by the
  watcher on every pass): RedWeek, Interval and VakayMood rows, `coalesce(seen_at, posted_at)` older than
  7 days. A rate typed in by hand (`iberostar`, `hotel`, `member`...) is not on a clock: nothing could
  see it again. The app applies the same test (`js/core/freshness.js`, `liveDeals()`), so a watcher that
  is down cannot leave last week's prices on the front page.
- **The re-check** (`watcher/verify.mjs`, `board.mjs verifyBoard`): every live RedWeek row is compared
  with what RedWeek shows for its resort in the same read. Still listed: the clock moves, a changed
  price is repriced (title and note with it). Rented: retired, "gone from RedWeek on 22 Oct". No longer
  listed: retired the same way — **only** when the page listed something and the absences are fewer than
  half the resort's rows at once, because a short or empty page is not proof (the old reason for "never
  retired" was exactly that; this keeps it where it still applies). A resort that did not answer
  verifies nothing. Any watched row whose price a night is under $40 or over $1,500 is retired as "price
  not credible", whatever its age: a figure can be parsed correctly and still be impossible.
- **The tap** (`record_board_tap`, opening the Stays LIST, not a place): a board re-check, at most once
  per 15 minutes, that reads **no RedWeek** (see below); later lists are served by it and the top of Stays
  says "Board checked N min ago". Interval is read on that tap only inside the box at the top (the Aruba
  search for the member's dates, same caps), with the Grab nudge as fallback.
- **Interval weeks** reach the board through a Grab or the tap scan, and get the 7-day rule from their
  own last-seen. A scan never retires one by absence: a week the 7 days takes down is one nobody saw
  for a week, which is the honest meaning of it.

Past two days a card tells members in words ("seen N days ago"). The Desk sees how long since anyone
looked. Stays lists what was seen in the last 48 hours first, Interval above the rest, cheapest a
night first within each; Ian recommends only those, and shows the rest as old with the tap that
re-checks them.

### RedWeek is read twice a day, and waits a day when it does not answer — 22 Oct 2026

Victor: *"RedWeek can be scanned 2 times a day automatically"*, and, when this server's address stopped
being answered (every request times out), *"Wait"* — not the proxy. So: two scans at 06:00 and 18:00 Aruba time
(`WATCH_REDWEEK_TIMES`, `schedule.mjs`), every resort 10 s apart, every live RedWeek row compared; **a tap reads
no RedWeek** and is served from the last scan ("RedWeek checked at 06:00"). The first request that times out
stops the pass and writes `.redweek-backoff.json` (a day); every RedWeek path checks it first; the next request
after it is ONE probe (`robots.txt`, fresh). While RedWeek is backed off or stopped the database is told
(`source_outages`), the 7-day rule does not count those days against RedWeek rows (`retire_stale_deals`, and
`freshness.js` in the app), no row's "seen" time is altered, and the top of Stays says "RedWeek not reachable
since 14:20; weeks shown as last seen". Not routing around it is the same rule as everywhere on this page.

### The dates a member is looking for — 22 Oct 2026

Stays has a "Looking for" row (`js/core/window.js`: two date boxes, the chips Next 2 weeks / Next month / 2
months / Christmas, default today to two months, remembered per device). The list shows only the weeks that
overlap it, Interval first, cheapest a night. A tap carries the dates (`stay_taps.from_date/to_date`,
`record_stay_tap(p_stay, p_from, p_to)`, `record_board_tap(p_from, p_to)`, a second member's dates widen the
waiting row's; `supabase/migrations/20261022_tap_window.sql`) to the Interval scan, above.

## There is no automatic route, and stop looking for one

Checked, in this order, and all three are closed:

| route | why not |
|---|---|
| **Getaway Alerts** | Victor looked: there is no email alert option at all on his account. |
| **Interval To Go app** | His app login has never worked. Web login is fine — his own screen recording shows him signed in at `vip.intervalworld.com` searching Getaways. The app commonly needs its own registration; that is a call to member services, not a retry. |
| **Ongoing Search** | Lives behind the same app. Worth asking member services about, not worth suggesting again until someone confirms he can reach it. |

Four rounds were spent recommending these before anyone asked whether he could use them. If the
board looks empty, do not open with "switch on alerts" — it is not there. **Somebody has to look at
Interval, and that somebody is a person, not this repo.** Say that plainly and spend the effort on
making the looking cheap.

What actually exists, and is the whole system:

- **Grab** — he is on the page anyway; two taps put the whole page on the board, refresh what is
  still there, and flag what has gone. This is not a fallback. It is the mechanism.
- **The reminder** — `circle/tools/check-interval.ics`, a subscribed calendar that nudges him four
  times a day with the link. Automation of the person, since the site cannot be automated.
- **The tap nudge** (22 Oct 2026, `circle/watcher/taps.mjs`) — when a member opens a place and the newest
  Interval week the Circle holds there is over a day old, the watcher pushes Victor's phone once per resort per
  12 h: *a member is looking at X, Interval last grabbed N ago, sign in and tap Grab.* Victor asked on 22 Oct for
  the watch to "watch it the moment a member clicks on stays". (It used to read that resort's RedWeek page on
  the tap too; RedWeek is read twice a day now, below, and a tap reads none.)
- **The tap scan** (22 Oct 2026, `circle/watcher/interval-scan.mjs` + `interval-session.mjs`) — the one
  case the box at the top allows, and only while `WATCH_INTERVAL_SCAN=on` is in `.env` (off until Victor
  says; the migration comes first). On a tap at a place with an Interval code on file (`INTERVAL_ARUBA`;
  add a code only when a real page shows it) the watcher reuses the saved session or signs in (3 a day),
  searches that one resort by its code for the dates the member is looking for (the Stays "Looking for" row,
  carried by the tap; none sent means today to 60 days), and posts its weeks through `board.mjs` like any other. Caps and
  full stops are exactly the box above, enforced in code and on trial in `interval-scan.test.mjs`; a stop
  writes `.interval-stop.json`, raises the `interval-watcher` card and sends one push, and the tap nudge
  above is the fallback whenever the scan is off, stopped, capped or fails. A scan that worked replaces it.
  Never schedule it, never retry it, never add to what `iv-login.js` does.
- **The mail pipe** — still live and still worth having: confirmations post the weeks the Circle
  holds, and cancellations take them down by themselves. That half needs no alerts.
- **VakayMood** — the one source with a public documented API (60 req/min, no login). Poll it
  freely. It is what a sanctioned feed looks like, and the contrast worth drawing when someone asks
  why Interval is different.

## House rules that apply to anything you touch here

- The app never asserts what it has not established. Never "available", "confirmed", "verified",
  "sold out". VakayMood rows are owner rentals and are never called Interval.
- Victor books everything himself. Nothing implies a member books, and nothing says the Circle
  holds a week unless it does.
- No emoji. Tap targets ≥ 44px. No horizontal overflow at 390px. Numbers in the mono face. Colours
  from `circle/css/tokens.css` only.
- No secret or service-role key in the repo — it is public on GitHub Pages. The ingest token lives
  in the caller's own browser or environment, never in a file.
- Both backends or neither: a change to `Store` needs the same change in `SupabaseStore`.

## Files worth knowing

```
circle/tools/grab.js                              the bookmarklet, two-tap
circle/supabase/functions/ingest-deal/index.ts    the endpoint + the authoritative parser
circle/supabase/functions/ingest-deal/gmail-forwarder.gs   the mail pipe
circle/js/data/listing-paste.js                   the browser twin of the parser
circle/js/views/deals.js                          stampFor() — the last-seen mark on a row
circle/js/views/officer.js                        the Desk's Grab panel and freshness line
circle/watcher/                                   RedWeek on Victor's VPS. Interval stays manual.
circle/watcher/taps.mjs                           what a member opening a stay sets off (RedWeek read, Interval scan, Grab nudge)
circle/watcher/interval-scan.mjs                  the tap scan: caps, sign-in cap, full stop, weeks -> finds
circle/watcher/interval-session.mjs               its browser: iv-login.js's flow, saved session, nothing added
circle/watcher/board.mjs                          judge + post_deal + last-seen clocks + the re-check of the whole board; RedWeek and the scan share it
circle/watcher/verify.mjs                         what a re-check decides: seen, repriced, rented, gone, not credible
circle/js/core/freshness.js                       7 days (less the days a source was out), 48 hours, "seen N days ago", the Stays order — one file for the app, the watcher and Ian
circle/js/core/window.js                          the dates a member is looking for: chips, clamp, overlap, remembered per device
circle/watcher/schedule.mjs                       the two daily RedWeek times (Aruba), and whether the latest was served
circle/watcher/redweek.mjs                        the reader, its stop file, its one-day back-off and probe, its 10 s pacing
circle/supabase/migrations/20261022_board_freshness.sql   the board tap, board_checks, retire_deals_gone / retire_stale_deals / reprice_deal
circle/supabase/migrations/20261022_stay_taps.sql  the taps table, redweek_checks, and the seen_at grant
circle/supabase/migrations/20261022_tap_window.sql the dates a tap carries (record_* and take_stay_taps)
circle/supabase/migrations/20261022_source_outage.sql source_outages: a source being out pauses its rows' 7-day clock
.claude/skills/interval-board/scripts/parser-check.mjs   the regression cases, runnable
```
