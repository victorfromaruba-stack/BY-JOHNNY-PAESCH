---
name: interval-board
description: Keep Interval International and RedWeek weeks flowing onto the Hunto Circle's board, and fix the reader fast when a site changes its page. Use this skill whenever anyone mentions Interval, Getaways, RedWeek, the Grab bookmark, the ingest-deal function, a week showing the wrong price or the wrong hotel, the board being empty or stale, "it read it wrong", a screenshot of the Grab panel, Getaway Alerts, a forwarded confirmation or cancellation email, or asks to automate/scan/scrape/poll either site on a schedule. Also use it before touching parseListings, parsePrice, parseDates or matchStay in either copy, because those exist twice on purpose and a fix applied to one is a bug in the other.
---

# The Interval board

The Circle's board carries weeks Victor can book for his friends. Members browse it alone and
spend real points against what they see, so two things matter more than throughput: a price on the
board must be the price on the source, and a row must be honest about how old it is.

This skill is how weeks get on, how the reader is fixed when a site changes, and where the line is.

## The line, and why it is where it is

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
do not argue the ethics at length. Say it in a sentence, then give them the route that genuinely
delivers it, which is better anyway: **Interval's own Getaway Alerts scan continuously and email
every hit, and the Circle already turns those emails into board rows within five minutes.** That
beats four times a day. See "The automatic routes" below.

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
4. **Occupancy and kitchen are ICONS.** `innerText` will not contain them, so `unit` and `sleeps`
   are usually blank on a real Interval page. That is correct, not a miss.

The host is `vip.intervalworld.com` once signed in. Dates are `Sep 17 2026 - Sep 24 2026` — no
comma, both years.

Price precedence, which is the rule that keeps all of this straight: **labels beat column headers
beat guessing.** A row saying "Average Night" answers outright. A row with a bare figure falls back
to the Weekly Rate column it sits in. A page with neither is left guessing, and a guessed figure is
flagged so the Desk sees it before anyone else does.

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
carry is listed separately with a button — **reported, never retired automatically**, because
Interval paginates and absence from one page is not proof. A week the Circle has *booked* is never
revived.

Past two days a card tells members in words. The Desk sees how long since anyone looked.

## The automatic routes

These are the ones that scan without anybody breaking anything, and they are the answer to "make it
run four times a day":

- **Getaway Alerts** — Interval's own machines watch continuously and email every hit;
  `gmail-forwarder.gs` posts each one within five minutes. Only Victor can switch it on, and as of
  September 2026 it was still off.

  **Do not tell him to do it in the Interval To Go app.** His app login has never worked — this was
  suggested four times before anyone thought to ask, which is four wasted rounds. His *web* login
  is fine: his own screen recording shows him signed in at `vip.intervalworld.com` searching
  Getaways, and the watcher's notes record those credentials working by hand. Interval's app often
  needs a separate registration from the website account, so the fix is a call to member services,
  not a retry. Until then, look for alerts on the web — inside the Getaways area, or under account
  and email preferences. Say "look here", not "it is here": nobody should fetch their site to
  check, and an instruction he cannot follow is worse than none.
- **Ongoing Search** — Interval's own standing request: keeps looking until a week appears and books
  it. Needs three resorts *or* three time periods; runs overnight; auto-charges with 24 hours to
  cancel.
- **VakayMood** — the one source with a public documented API (60 req/min, no login). Poll it
  freely; that is what a sanctioned feed looks like, and it is the contrast worth drawing when
  someone asks why Interval is different.

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
.claude/skills/interval-board/scripts/parser-check.mjs   the regression cases, runnable
```
