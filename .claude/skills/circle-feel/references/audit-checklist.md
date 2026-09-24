# The full pass, screen by screen

Read this when sweeping the whole app rather than fixing one thing. Run
`node scripts/audit.mjs` first — it gives you the numbers, and numbers stop a "polish pass"
from becoming an opinion swap.

## The measured baseline (390px, as a plain member)

Captured before the first feel pass, so you can tell whether you actually moved anything. Every
route was free of horizontal overflow and console errors even at this point — the problems here
are density and touch, not breakage.

| route | screens tall | px to first figure | targets < 44px | text chars |
|---|---|---|---|---|
| `/` | 9 | 789 | 3 | 6425 |
| `/home` | 4.2 | 132 | 11 | 2576 |
| `/stays` | 10 | 780 | 11 | 5023 |
| `/stays/:id` | 10.1 | 552 | 5 | 7509 |
| `/trips` | 2.4 | 892 | 1 | 1541 |
| `/deals` | 8.3 | 1072 | 1 | 6292 |
| `/requests` | 1.0 | — | 1 | **102** |
| `/pay` | 2.0 | 516 | 4 | 1364 |
| `/ledger` | 4.6 | 245 | 3 | 3507 |
| `/profile` | 5.4 | 579 | 10 | 3717 |
| `/desk` | 2.4 | 465 | 11 | 855 |
| `/bank` | 3.7 | 300 | 11 | 1164 |
| `/settings` | 7.4 | **2883** | **32** | 4544 |

## After the first two passes (390px, as an admin)

Touch work landed first, then density. Re-measure with the same script; a pass that does not
move a column here did not do anything.

| route | screens tall | px to first figure | targets < 44px | what changed |
|---|---|---|---|---|
| `/` | 9 → 7.5 | 789 | 3 → 1 | price table folded on a phone, bands stopped growing |
| `/stays` | 10 → 9.6 | 780 → 464 | 11 → 2 | filters collapse, header tightened |
| `/trips` | 2.4 → 2.0 | 892 → 553 | 1 | level explainer folded, stale copy cut |
| `/settings` | 7.4 → 4.3 | 2883 → 532 | 32 → 0 | four panes behind a segmented control |

`/settings` is 1.9 screens on every pane but Insiders, which is fourteen people with three
actions each and is honestly long. `/stays` is 23 cards; length there is the catalog, not waste.
`/stays/:id` came down next: 10.5 → 5.5 screens. The rooms table was 6,216px of it, because
on a phone every cell became its own labelled block — 460px per room, thirteen rooms here and
twenty-three at the Hilton. Facts share lines now and the list opens with six.

Two defects that pass the audit and are still real, both found by eye on a screenshot:

- **`td.num` inherits `white-space: nowrap`** (line 42, so a figure never breaks mid-number).
  Correct in a column; on a wrapped line holding three figures it pushed the last one past the
  card edge. `.tablewrap` scrolls, so the page-level overflow check said nothing was wrong.
- **An inline `justify-content` on the element beat the stylesheet rule for it.** The mobile
  rule left-aligning those buttons had never once applied. That is the third time this project
  has lost to an inline style — check the markup, not just the cascade.

What those numbers mean in the owner's language:

- **"a lot of unresponsive things"** — 32 controls under 44px on `/settings`, 27 on a stay page.
  These are not broken, they are *hard to hit*, which feels identical to broken on a phone.
- **"space used for nothing"** — 780px before the first price on `/stays`. On an 844px screen a
  member scrolls almost a full screen past headings and filters to reach what they came for.
  `/settings` is worse: 2883px, about three and a half screens.
- **"looks complicated"** — a stay page is 10.4 screens long. That is a document, not a screen.
- The near-empty routes (`/requests` at 102 characters, `/watching`, `/deals`, `/crews`) are the
  same complaint from the other end: a whole destination, a nav slot and a tap, for one sentence.

## Targets

- No route over ~4 screens at 390px unless it is genuinely a document (`/rules` is allowed).
- First meaningful figure above the fold — under ~600px, ideally under 300.
- Zero interactive elements under 44px in either dimension.
- Zero horizontal overflow, zero console errors, both roles, at 390 / 768 / 1440.
- A near-empty route should either earn its place or fold into a neighbour.

## Per-screen questions

**Landing (`/`)** — a stranger's only impression. Does the first screen say what this is and who
it is for, without scrolling? Is there exactly one thing to do?

**Home (`/home`)** — the screen a member opens most. Their balance and what it can reach should
be the first thing, not a greeting. 132px is good; protect it.

**Stays (`/stays`, `/stays/:id`)** — the shop. Filters must not push the goods below the fold.
On the detail page, the price and the ask-button are the point; rooms, provenance and history are
reference and belong lower or behind a disclosure.

**The money screens (`/pay`, `/ledger`, `/pool`, `/bank`)** — figures in the mono face with
tabular numerals, aligned on the decimal, never reflowing as they change. A member should be able
to answer "how much do I have and what did I put in" without reading a sentence.

**Officer screens (`/desk`, `/bank`, `/settings`)** — used one-handed, often on the move, often
under time pressure. Density is a feature here; the tap targets are not. `/settings` is the worst
screen in the app on both counts and is the best single place to start.

**Empty states everywhere** — say what is missing and what would fill it. Never sample data,
never a placeholder that implies a person or a room. An honest blank is the house style.

## Order of attack

Cheapest first, because each one is independently shippable:

1. **Tap targets.** A handful of CSS rules; fixes the loudest complaint. `--h-touch: 48px`
   already exists in tokens — the sizes drifted, the token did not.
2. **Get the first figure above the fold** on `/stays`, `/settings`, `/trips`, `/`. Mostly
   deleting headings that repeat the nav and eyebrows that repeat their content.
3. **Fold the near-empty routes together.** `/deals`, `/live` and `/watching` are one idea. *Done for `/live`: it is the third section of Deals and redirects; `/watching` stays a screen because it is a form.*
4. **Shorten the long pages** with progressive disclosure, not by removing information.
5. **Motion and state feedback** last — it is the layer that makes the rest feel intentional,
   and it is wasted effort under a layout that is still wrong.


## Does it work, though — the interaction sweep

`scripts/interact.mjs` clicks every visible control on every route as three roles and reports
any where nothing observable happens. Last full run:

**537 controls clicked across 3 roles × 22 routes in 9.5 minutes. Every one of them did
something.** The only suspects were `/bank` "Copy", which the verify pass found working on a
clean page — the sweep had already put the same text on the clipboard, so the second click
genuinely changed nothing.

That is a real answer to "I am not convinced it is 100% functional", but be precise about what
it proves: every control *reacts*. It does not prove any of them does the *right* thing. For
that, the gate tests and the smoke test are the evidence.

Four ways this script lied before it could be trusted, all worth knowing if you write another
like it:

- **`'#app ' + 'button, a[href]'` scopes only the first clause.** It swept in the whole topbar
  and bottom nav, then could not find them again under `#app`, and skipped three quarters of
  what it claimed to cover — while reporting a confident-looking control count.
- **A click that acts outside the page looks identical to a dead one.** Share (`window.open`),
  Print, Export CSV and every `target="_blank"` link were all reported dead. Count the calls in
  the page rather than waiting on `page.on('popup')`, which arrives seconds later — long after
  any sane probe window.
- **One control can poison every route after it.** `/profile` has a Sign out button; once the
  sweep pressed it, `/settings` reported three controls instead of forty-seven, and the number
  looked plausible enough to believe.
- **Hidden is not dead.** A control inside a collapsed pane still matches `querySelectorAll` and
  still takes a `.click()`, and reports dead because it is not there to react.

## Re-baselined 8 Sept, after the live feed folded into Deals (390px, as admin)

`/deals` went from 1.1 screens of nothing to 8.3 screens of twelve live cards under an empty board; the first figure is the live section's count line at 1072px, because the board's one-line empty state and the section head sit above it. `/stays/:id` gained the "Open right now" panel and the room lines and stayed at 10.1 screens. `/live` is gone (it redirects). No overflow, no errors at 390 or 1440.

## Re-baselined 10 Sept, with fifty owner weeks on the board (390px, as admin)

The watcher filled the board for real: 50 RedWeek weeks at five places (Renaissance 19, Ocean Club
11, Surf Club 10, Eagle 6, Barceló 4). Measured with the same fifty seeded into the local backend:

| route | before | after | what changed |
|---|---|---|---|
| `/deals` | 41.3 screens, 50 full cards | 7.3 screens, 10 cards open | the board is by place: a small photograph and the name once, the cheapest two weeks a night under it, "Show the other N"; cards under a place drop the strip, the area line and the place from the title |
| `/stays/stay_renaissance` | 19.1 screens, 19 cards | 7.8 screens, 3 cards open | the posted list opens with three, same button |

The opened groups survive the route re-render that a commit causes (the Desk taking a week off
the board no longer folds the other groups), the "Gone" flow still works through the delegated
handler, a member sees no edit buttons, and the place name in a group head is a link to the stay.
No overflow, no errors, at 390. The live section below the board is unchanged and is most of the
7.3 screens now.

## Re-baselined 10 Sept, the ask and the Desk's lanes (390px)

The ask (`/book/:id`) is a brief now, not a form: date tiles with the native picker underneath,
a nights figure, a stepper, chips, a switch, the all-in price with its room/share bar, four
steps, one button. 2.3 screens as a member, no overflow, every control 44px or the whole row
(the switch is 50×30 inside a full-width label). Pressing anything answers: the number, the
chip, the price. The request page carries six steps with the one happening now marked, and a
closed request ends on a red step with "Ask again". The Desk's Requests tab is three lanes —
to look and price, to book, waiting on the member — with the action on the row; the sheets
carry the look buttons, so nothing the Desk taps from the queue can end in a refusal it has to
go elsewhere to fix. Interaction sweeps: `/desk admin` 14 of 16 controls did something (2
skipped as hand-offs), `/book/stay_surfclub member` 11 of 13, `/requests member` 2 of 2.

## Re-baselined 11 Sept, the look (390px)

Victor, on the live site: "many images missing, it looks empty, the main picture is shit, the
website looks low quality, not exclusive." What changed and what it measures:

- **The hero** is a fofoti at first light (generated, as the house rule allows for the hero
  and nowhere else), 4:5 on every width; on a phone it is the first thing on the page, above
  the headline. The moving-water video layer is gone with the old still it was cut from.
- **No card is empty.** The eleven stays with no photograph of their own show a licensed
  photograph of their beach (Commons, CC BY / BY-SA / CC0), with the beach named ON the
  picture and the credit under the hero saying it is not a photograph of the hotel.
- **The stay page** leads with the picture, then dates and the price for those nights in the
  same tiles as the ask, then the rooms; the price provenance text sits below. First figure at
  498px on the Ritz page; 5.2 screens.
- **Deals** opens with the four lowest prices a night, then the board by place; the live
  section shows six first. With fifty posted weeks: 12.4 screens as the Desk, 10.7 as a
  member (cards 305–343px). Without any: 5.0.
- Whole-app audit at 390: no overflow, no errors; landing 7.8 screens, stays 9.6.

## Re-baselined 11 Sept, after Deals folded into Stays and the room catalog went (390px, as admin)

Victor: "difficult to pick a place, hard to understand how it works, I don't need a million
rooms, I only need the best deals on the market; instead of Stays and Deals only have Stays;
make Cruise — Interval has cruise." So: one Stays tab that IS the deals (posted + owner weeks
open on VakayMood, one list, cheapest a night first, the first eight spread across places),
a strip of the places under it, no rooms table, no room chips, no filters; a Cruises tab
(cruises, then the land trips); /deals, /live and /trips redirect. No overflow, no errors on
any route.

| route | screens | first figure | note |
|---|---|---|---|
| `/stays` | 6.0 | 704px | 55 open with the Circle's copy of VakayMood; 8 cards open, "Show the other 47"; 23 places in the strip |
| `/stays/:id` | 4.6 | 831px | hero → tags → "Open right now" (4 of 20) → date tiles + one afford line → About the place / Where this price comes from, both folded |
| `/cruises` | 2.6 | 441px | the demo cruise, then three trips |
| `/cruises/:id` | 2.2 | 1312px | ship, ports, dates, cabins held, hold deadline |
| `/book/:id` (cruise) | — | — | "Ask for a cabin", a Cabins stepper, "Ask for the cabin" |

Not a regression: `/stays` is taller than the old catalog grid because it is now the board.


## Re-baselined 12 Sept, the rooms, the island and the editorial Home (390px, as admin)

Victor: "I also need more pictures of the rooms on each packages how they look like a map of the
room map etc" and, before it, "be more creative with everything, make it HIGH QUALITY". So: the
stay page opens on the place (photograph edge to edge on a phone, the name and the from-price set
on it), a row on the board opens the place with that week pinned rather than jumping to the ask,
"The rooms" carries every picture on file per room plus the property's own floor plans, "Where it
is" draws the island, and Home opens on a masthead instead of eight stacked panels. No overflow,
no console error on any route at 390 or 1440, light or dark.

| route | screens | first figure | note |
|---|---|---|---|
| `/home` | 3.5 | 131px | masthead: greeting, "2 nights at voco Surfside Aruba", the balance in mono, one button; the card and the bar under a hairline; the right column is four hairline blocks, not four boxes |
| `/stays` | 5.5 | 96px | unchanged board; rows now open the place, carrying the week |
| `/stays/stay_boardwalk` | 5.2 | ~3000px | hero → 6 rooms, 33 pictures and 3 plans → the island → the quote |
| `/stays/stay_surfclub` | 4.7 | 1066px | no photographs (Marriott 403s) but four sizes from the units owners hold, and the reason in a footnote |
| `/book/:id` | 2.0 | — | the room being asked for, in pictures, above the dates |

Deliberate, not a regression: a stay page is taller because it now answers "what does the room
look like" and "where is it" without leaving the page. The under-44px controls the sweep reports
on a stay page are words inside sentences (an address, a phone number, a site link), not controls.

## Re-baselined 20 Sept, after the phone-only rebuild (390px, both roles; checked again at 1440)

The numbers above are all pre-rebuild. The stylesheet now carries twelve `@media` rules and not
one is a layout breakpoint (nine reduced-motion, the print sheet, the display-mode rule, and the
`min-width: 431px` block that draws the table under the column and holds no layout). `--wrap` is
430px, the body IS the column, five tabs, six `.act-bar` sites, every dialog a bottom sheet.
Measured with `audit.mjs --width 390` for each role, `--width 1440` as admin, and a second probe
that walks the WHOLE document (the audit only looks inside `<main>`) for sub-44px targets and for
figures set outside the mono face.

| route | screens (member / admin) | to 1st figure | targets < 44 | chars (member) |
|---|---|---|---|---|
| `/` `/sign-in` | 3.5 / 3.9 (redirect to `/home`) | 203 / 219 | 0 | 1952 |
| `/home` | 3.5 / 3.9 | 203 / 219 | 0 | 1952 |
| `/stays` | 5.0 / 5.8 | **88** | 0 | 2684 |
| `/stays/:id` | 4.6 / 4.9 | 478 | 0 | 3284 |
| `/cruises` | 2.7 | 187 | 0 | 1351 |
| `/cruises/:id` | 2.3 | 606 | 0 | 1264 |
| `/trips/:id` | 2.2 | 658 | 0 | 1536 |
| `/postcards` | 2.7 / 2.9 | 176 | 0 | 801 |
| `/requests` | 1.0 | 138 | 0 | **320** |
| `/pay` | 1.0 / 1.4 | 155 / 192 | 0 | **366** |
| `/ledger` | 5.7 / 5.3 | 248 | 0 | 3781 |
| `/pool` | 2.5 | 165 | 0 | 1509 |
| `/circle` | 1.9 | — | 0 | 855 |
| `/crews` | 1.0 | 434 / 383 | 0 | **291** |
| `/watching` | 1.0 | — | 0 | **264** |
| `/card` | 1.7 | 183 | 0 | 641 |
| `/profile` | 1.7 / 1.9 | 145 | 0 | 693 |
| `/rules` | 3.9 | 226 | 0 | 4866 |
| `/desk` | — / 2.2 | 224 | 0 | 771 |
| `/bank` | — / 2.5 | 161 | 0 | 1236 |
| `/settings` | — / 3.3 | 239 | 0 | 1305 |

What moved, and why:

- **Every target is 44px or bigger, everywhere.** The old baseline had 32 under 44 on `/settings`
  and 11 on five other routes; the count is now zero on all 22 routes for both roles — and zero
  again when the probe is widened past `<main>` to the running head and the tab bar. The loudest
  complaint in this file is answered.
- **The first figure is above the fold on every route that has one.** Worst is `/trips/:id` at
  658px; `/stays` is 88px, better than anything in the file. `/settings` went 2883 → 239.
- **Nothing overflows and nothing errors**, member and admin, at 390 and 1440. The 1440 run
  matches the 390 run on overflow, small taps and character count, route for route; only the
  first-figure position moves, because the column is 430 there and a line wraps differently.
  The laptop draws the phone: body 430px wide at left 505 on a 1440 window, hairline round it,
  ground on the well, and the tab bar and the sheets carry the same cap (a sheet measures 430px
  at 1440 and 390px at 390).
- **Reachability**: 58 link targets as a member, 63 as an admin; every authed route in `app.js`
  is reached within two hops of `/home` or `/profile`.
- **Interaction sweep**: 392 controls clicked (57 skipped) across 2 roles × 22 routes in 6.0
  minutes. Every one of them did something. No dead controls this run — the `/bank` "Copy"
  false positive from the 12 Sept run did not recur.
- **Sheets**: 8 opened as a member, 21 as an admin; no control under 16px inside any of them,
  no segmented control scrolls, never more than one `.act-bar`, and every listing row is tappable
  to its right edge.

The near-empty routes are the one number that has not moved. `/crews` holds a tab slot for 291
characters; `/watching` is 264 and its empty state is a single bold line where every other
`.empty` in the app names what would fill it; `/requests` is 320 and `/pay` 366 when the month is
settled. Each ends at 1.0 screens with roughly half a screen of blank above the tab bar.

Two families of drift the rebuild did not carry over, both measured rather than eyeballed — and
**both closed on 20 Sept**, in the same sweep that found them. Kept here because the shapes recur,
not as open work:

- **Figures outside the mono face.** `app.css` gave the mono face to `inputmode="decimal"`,
  `type="date"` and `.mono` only — so 16 of the 20 `inputmode="numeric"` fields typed in Instrument
  Sans, and in the watch sheet "Spend up to US$" typed mono while "In points" typed sans, side by
  side, same placeholder. The same gap showed in rendered text: the tier ladder's heads and
  sub-line, the board cover's "sleeps 4 · the owner asks $194.25 a night" (`.why`), and the
  `/bank` confirm buttons. `app.css:337` now lists `inputmode="numeric"` too, the ladder carries
  `.num`, and `.why` is built as HTML so its two figures can be wrapped (everything interpolated
  into it is escaped at the source, because the line that prints it no longer escapes).
- **Prose in the apparatus face.** `.listing-row .sub` is mono, and `/requests` put the Desk's
  free-text decision inside it — so a decline reason printed as a mono paragraph on the one row
  carrying bad news. `.l2` now takes the body face; the date and the night count beside it stay
  mono, which is the right split.

Re-measured 20 Sept across `/home /stays /stays/:id /ledger /pool /pay /requests /card /circle
/watching /profile /rules` for both roles: every remaining digit outside the mono face is a date
or a month name inside a sentence ("Contribution · 04 Sept 2026", "since 05 Jan 2026"), or a count
inside a display heading ("2 nights at *voco Surfside Aruba*"). Those belong in the reading face —
a sweep that counts them reports about 70 false positives, which is what the first one did. The
rule worth checking is narrower than "every digit": **money, points and the counts in apparatus
lines are mono; dates and counts inside prose are not.** Deliberately left in mono: the bank
reference (`HUNTO-SW-2026-09` — someone types it into a transfer), the dated facts on `/pool` and
`/card`, and the room spec strip ("sleeps 4 · 1 bath · full kitchen"), which is apparatus under a
mono eyebrow and reads as a spec line rather than a sentence.

Dead weight worth deleting while someone is in the file: `.grid` (app.css:179) has no usages left
in `js/`; `.island-wrap`'s `max-width: 560px` (app.css:1269) can never bind, because the element
renders at 358px inside a 430px column; `.badge-grid` (app.css:904) is the last layout that is a
function of width, and resolves to 174px × 2 at every width the app ever has.

## Re-baselined 20 Sept, after the photography pass (390px, as a member)

Five commits put pictures and material on the screens that had neither. These numbers are the
new floor; several of them are DELIBERATELY worse than the table above, and a sweep that reads
them as regressions will try to undo work that was asked for.

| route | screens | to 1st figure | targets < 44 | what changed |
|---|---|---|---|---|
| `/home` | 3.8 (was 3.5) | 333 (was 203) | 0 | the cover plate: a full-bleed 4:5 photograph of the place bookable today, the balance on it at `--t-fig-lg` |
| `/stays` | **6.4** (was 5.0) | 88 | 0 | 23 name-and-chevron rows became 23 photographic plates; the board groups by property under a 3:1 strip |
| `/circle` | 2.1 (was 1.9) | 235 | 0 | the roster on `.field-night`, three tier metals, the seat count drawn |
| `/crews` | 1.0 | 434 | 0 | a crew leads with its booking's picture — NOT exercised by the seed, see below |
| everything else | unchanged | | 0 | |

**The first figure on /home moved 203 → 333px and that is the design, not drift.** The picture is
above the figure now. It is still well inside the first screen.

**/stays at 6.4 screens is the known cost.** Plates are taller than text rows. The lever if it ever
has to come back: three plates to the column instead of two (`.plate-index`
`grid-template-columns`), or a lower `first` on the board's `dealList`. Do not reach for it
without asking — the length bought the pictures.

**Weight**: `assets/stays/thumb/` and `assets/areas/thumb/` are 18 files at 400px, 422 KB in all
against 3,819 KB for the same pictures full size. A first visit to /stays pulls most of them
(~420 KB, was 120 KB). They are lazy and the worker caches them; `APP_SHELL` precaches the app
and `hero-tall.jpg` only, so new pictures need no `sw.js` edit.

**The crew card is the one thing here not proven by a render of the real path.** The seed's two
crews carry no `redemptionId`, so `/crews` in the preview shows no picture and the 339px of grey
below the card is still there. `store.js:340` shows `createCrew` sets one and crews are gated on
an approved room, so a real crew has a booking and gets its picture. Verified by injecting the
view's own markup with a real stay and looking at it. Do not "fix" the preview by attaching the
seed crews to a booking: the only one Sasha has is the Ritz week the Desk DECLINED, and having
the demo tell a false story to make a feature look good is the thing this app does not do.

## Re-baselined 24 Sept, the statement pass (390px)

Proof of reserves is a figure, a bar and labelled lines instead of the bowl and one run-on
sentence (landing, Home, the Pool — same facts, same reconciliation wording). The Home ledger
shows three lines with the figure on the right (`.ledger.side`, also on `/ledger`); a stay page
prices the chosen nights as a boxed receipt (`.receipt`). A running head left transparent over
`/stays` after a skipped view transition is fixed in `app.js`, and skipped transitions no longer
log an error.

| route | before (member / admin) | after | note |
|---|---|---|---|
| `/home` | 3.8 / — | 3.5 / 3.9 | errors on `/` 1 → 0 |
| `/stays` | 5.9, first figure 88 | 5.9, 176 | the 88 was the count in the eyebrow, which repeated the dateline; the first price did not move |
| `/stays/:id` | 4.6 | 4.8 / 5.1 | the receipt is taller than the paragraph it replaced |
| `/ledger` | 5.6 | 5.3 / 5.0 | |

No overflow, no errors, zero small targets, both roles; every route reachable. Interaction sweep
on `/ /home /stays /stays/:id /pool /ledger`: 199 controls, 2 roles, every one did something.

Open, and deliberately not built: the per-tier grounds that would tint each member's whole app,
the season wash, and `coverPath` on a crew — reserved in `schema.sql` as `cover_path`,
initialised by `createCrew`, written nowhere and read nowhere.
