---
name: circle-feel
description: Make the Hunto Circle app feel like a considered, high-quality product rather than a form with a stylesheet — interaction feedback, responsive layout, information density, and cutting complexity. Use this skill whenever anyone says the site looks complicated, cheap, dated, empty, cluttered or "like AI", whenever they mention spacing, wasted space, an Apple feel, polish, responsiveness, mobile, or things not reacting when tapped, and before you change any screen, panel, button, card or stylesheet in circle/. Also use it when adding a new screen, so it is born matching the rest, and when auditing whether the app is actually usable end to end.
---

# The feel of the Circle

This is a private club for forty friends where one man books real hotel rooms with other
people's money. The product's job is to make forty people trust a spreadsheet they cannot see.
That is why "feel" is not decoration here: a screen that looks improvised reads as *money handled
improvisedly*.

The owner's recurring words are the specification: *"looks a bit complicated"*, *"a lot of space
being used for nothing"*, *"a lot of unresponsive things"*, *"AI slop"*, *"I want Apple feel"*.
Everything below is what those complaints turned out to mean in this codebase.

## Before you change anything: go and look

Judging a screen from its source is how you end up fixing things that were never broken. Render
it and **read the PNG** — it comes back into the conversation and you will see in one second what
an hour of reading the DOM would not tell you.

```js
import { open, go } from '/tmp/harness.mjs';   // see scripts/harness.mjs in this skill
const { b, p, errors } = await open({ width: 390, height: 844, role: 'member', scale: 2 });
await go(p, '/home');
await p.screenshot({ path: '/tmp/x.png', fullPage: true });
await b.close();
```

Then `Read /tmp/x.png`. Every visual claim you make should come from a picture you looked at.

Two traps that have already cost time here: `fullPage` screenshots skip `loading="lazy"` images,
and `img.complete` does not mean decoded. Force them eager and `await img.decode()` before
shooting, or you will "fix" a layout that was never wrong. The harness does this for you.

## The five things that actually make it feel cheap

Ranked by how much they cost per unit of effort to fix.

### 1. Controls that do not look like controls, and do not answer when pressed

This is most of what the owner means by "unresponsive". Two distinct failures, both here:

`.btn.quiet` is transparent and borderless. A row of them reads as a row of **bold words**, not
buttons — this has been found twice, on the stays filters and again on the look buttons. A
control needs a resting boundary. Use `.btn.ghost` when it is secondary; keep `.quiet` for
things that genuinely are text.

And every control needs to answer within ~100ms of being touched. Not a transition to a hover
state — phones have no hover. An `:active` state that visibly moves or darkens, and a disabled
state that explains itself. If an action goes to the network, it needs a pending state; `setBusy`
in `js/ui/components.js` already exists for exactly this, so use it rather than inventing one.

A button that does nothing for 400ms gets pressed again. That is where double-submits come from.

### 2. Space spent on nothing

The complaint is not "too much whitespace" — it is **space that carries no information**. The
shapes it takes here:

- A panel whose entire content is one short sentence. Panels cost a border, a radius and 32px of
  padding; earn them or use a paragraph.
- An eyebrow label above content that says the same thing (`WHAT YOU CAN DO` over two buttons).
- A page heading that repeats the nav item you just tapped.
- Cards stacked vertically at desktop width, each 90% empty, when they could be a grid or a
  table.

The test: **how far down the page is the first fact the member came for?** Measure it, do not
guess. If a member on a phone has to scroll before seeing their points balance, the header is
too tall. Good density is not cramped — it is putting the thing they came for above the fold and
letting the rest breathe below it.

### 3. Too many doors

Twenty-nine routes and eleven nav items is a filing cabinet, not a product. A plain member does
not need the Desk, the Bank or the Settings. Ask of every nav item: *does a member use this in a
normal month?* If not, it belongs behind a profile menu or an officer-only section.

Watch for concepts that are one thing wearing three names. `/deals`, `/live` and `/watching` are
all "rooms that might be available" — a member does not hold three mental models for that. When
you find that, merge the screens rather than renaming the tabs.

Every screen should answer, in under two seconds: *what is this, and what do I do here?* One
primary action, visually dominant. Everything else quieter.

### 4. Type and rhythm that were never decided

Apple's feel is not a font — it is that nothing looks accidental. Concretely:

- A small set of type sizes, used consistently. If a heading is 1.15rem here and 1.1rem there,
  that is not a design, it is drift. `css/tokens.css` is the only place a value should be born.
- Numbers are the content of this app. They are in the mono face with `tabular-nums` for a
  reason: figures that shift width as they change look broken. Keep every money and points
  figure on that face.
- One spacing scale. Padding of 14px, 16px and 17px in three adjacent panels is visible even to
  someone who cannot name what is wrong.
- Optical alignment beats mathematical: an icon centred by its bounding box usually looks low.

### 5. Anything that claims something the app has not established

This is the house rule that outranks aesthetics, and it is why fifteen stay cards deliberately
show **no picture** rather than a plausible one. A blank that is honest reads as confidence; a
fake that is pretty reads as a lie the moment someone checks.

So: no placeholder avatars that imply a person, no "available" without a look behind it, no
sample data in an empty state, no stock photo of a room nobody has seen. When there is nothing
to show, say what is missing and what would fill it.

## Working in this codebase

**No build step.** Vanilla ES modules, hash router, served straight from `circle/`. A missing
named export is a load-time `SyntaxError` that blanks the entire app, so renaming an export means
finding every import. Renaming is often *safer* than changing a signature: a missed call site
becomes a loud load error instead of a silently wrong number.

**Tokens are the palette.** `css/tokens.css` defines light on bare `:root`, and the dark blocks
redefine only the tokens. If you need a colour that is not there, that is a signal to reconsider,
not to add a hex. A baked hex is how a component ends up looking correct in light mode and
broken for half the club.

**CSS specificity here is a real hazard.** `.stay-card .strip .scene` sets `display:block` at
(0,3,0); a bare `.scene.plate { display:flex }` silently loses and your layout quietly does
nothing. When a rule does not take, check specificity before rewriting the markup — and prefer
changing a property the other rule does not set (position, not display).

**And check the markup before the cascade.** Half the layout in this app is written as `style="…"`
on the element, and an inline declaration beats any stylesheet rule without `!important`. Three
separate rules here have turned out never to have applied even once — a mobile `justify-content`,
a `min-height` on a Desk button, three checkbox sizes — because the value was also inline. A rule
that appears to do nothing is more often being outranked by the element than by another selector,
so open the template and look. Fixing it inline is usually right; reach for `!important` only when
the desktop and phone layouts genuinely want different values.

**Ship-visibility.** The service worker's cache name is stamped with the commit SHA at deploy
time, and the page reloads once when a new worker takes over. If you touch `sw.js`, do not break
that: a deploy nobody can see is worse than no deploy, and it already happened once — a whole run
of work was invisible because the cache name never changed.

**Both backends or neither.** Every rule exists twice, in `js/core/store.js` and in SQL. If they
disagree, the demo teaches a rule the server does not enforce. Changing one means changing both.

## How to judge whether it worked

Not "does it look nicer to me". Measure:

- **Time to the first useful fact** on each route, at 390px. Should be zero scrolls.
- **Horizontal overflow**: `document.documentElement.scrollWidth > innerWidth` must be false on
  every route at 390, 768 and 1440.
- **Touch targets**: nothing interactive under 44px in either dimension. Measure with
  `getBoundingClientRect()`, do not eyeball.
- **Taps to the common journey**: browse → pick dates → ask. Count them before and after.
- **Console clean**: no errors on any route, either role.

`scripts/audit.mjs` in this skill runs all of these across every route and prints a table. Run it
before and after; a change that improves the feel should move at least one number, and must move
none of them backwards.

## Things worth adding, and how not to make them cheap

**Video.** Motion sells quality faster than any static screen, and this app has a genuine subject
— the water, the island. Rules that keep it from looking like a template: it must be muted,
`playsinline`, `loop`, and `autoplay` only when it is decoration; it needs a `poster` so the
first paint is instant; and it must be small enough for Aruban mobile data — a 6-second loop at
under 2MB, not a 30-second showreel. Always pair it with `@media (prefers-reduced-motion:
reduce)` falling back to the poster. And never put video behind text without a scrim; legibility
outranks atmosphere.

**Motion generally.** `--dur-fast`, `--dur-water` and `--ease-out` already exist in tokens. Use
them, so everything moves with the same physics. Animate transform and opacity only — animating
height or top gives the janky feel you are trying to remove. Anything over ~300ms starts to feel
slow rather than smooth.

## References

- `references/audit-checklist.md` — the full pass, screen by screen, with what "good" looks like
  for each. Read it when doing a whole-app sweep rather than a single fix.
- `scripts/harness.mjs` — open the app signed in as any role, at any size.
- `scripts/audit.mjs` — the measurements above, across every route, as a table.
