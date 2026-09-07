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
| `/stays/:id` | 10.4 | 552 | 27 | 5799 |
| `/trips` | 2.4 | 892 | 1 | 1541 |
| `/deals` | 1.1 | — | 4 | 534 |
| `/live` | 1.4 | — | 9 | 1066 |
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
`/stays/:id` at 10.5 screens is the one still untouched.

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
3. **Fold the near-empty routes together.** `/deals`, `/live` and `/watching` are one idea.
4. **Shorten the long pages** with progressive disclosure, not by removing information.
5. **Motion and state feedback** last — it is the layer that makes the rest feel intentional,
   and it is wasted effort under a layout that is still wrong.
