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
