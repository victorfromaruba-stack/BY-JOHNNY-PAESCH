---
name: borrowed-effects
description: Take an effect from a React component library — Aceternity UI, 21st.dev, shadcn — and either rebuild it as plain CSS inside the Circle or say plainly why it does not belong. Use this skill whenever anyone names one of those libraries or a named effect (spotlight, aurora, meteors, moving border, text generate, infinite moving cards, beams, glowing border, typewriter, flip words, card hover), says they saw an animation or an effect on another site and wants it here, pastes a ui.aceternity.com or 21st.dev link, asks to "install" or "add" a component or a UI library, or asks why a component will not work in this app. Use it BEFORE running any install command: this app has no build step and no React, so nothing from those libraries can be installed as shipped — but most of the effects can be ported, and this is how.
---

# Borrowed effects

Someone has seen something they like and wants it here. That is a good instinct and it is worth
serving, but not by the route they are expecting.

Three facts decide everything below.

**Nothing in those libraries can be installed here.** The Circle is vanilla ES modules and a hash
router, served straight from `circle/` with no build step, no React and no Tailwind, behind a
Content-Security-Policy that allows scripts from `'self'` and jsDelivr only. A `.tsx` file cannot
run in it. `npx shadcn add`, `npm i motion` and the 21st.dev CLI all assume a bundler that does
not exist. So "install this" is never the job.

**Most of that library is the register this app deliberately does not use.** Aceternity was built
for a dark landing page that has three seconds to impress a stranger: aurora, beams, glowing
borders, a card that tilts under a cursor. The Circle is read weekly by forty people who already
know each other, to find out what a week costs and whether Victor booked it. Victor's own word for
the other register is *AI slop*, and he is describing exactly this. Read **The Edition** in
`circle-feel/SKILL.md` before judging any of it.

**And the CSS underneath is often worth having anyway.** Strip the React and most of these
components turn out to be four lines of `@keyframes`, a custom property and a gradient. That part
crosses over cleanly.

So the job is never *install*. It is: **read the mechanism, decide whether it belongs, rebuild it
in the house's own CSS and tokens, and record where it came from.**

## 1. Run the script first, always

Aceternity publishes a free public registry — no account, no API key:

```
https://ui.aceternity.com/registry/<slug>.json
```

A `200` returns `{ name, dependencies, files: [{ path, content }] }` with the whole `.tsx` in the
body. `scripts/borrow.mjs` fetches that and tells you, in one call, what the licence position is,
what the dependencies really are, what every Tailwind class means in plain CSS, which colours are
hard-coded, and whether the effect can live in CSS alone:

```
node borrow.mjs <slug> [<slug>...]          print the verdict and the source
node borrow.mjs --save <dir> <slug>...      also write the raw .tsx and the report to <dir>
node borrow.mjs --list                      probe the known slugs and print a table
node borrow.mjs --no-source <slug>...       the report without the full source
```

Run it with an absolute path from anywhere:

```bash
node /home/user/BY-JOHNNY-PAESCH/.claude/skills/borrowed-effects/scripts/borrow.mjs spotlight
```

`--list` probes 61 empirically-confirmed slugs and prints slug, status, dependencies and a
one-word mechanism verdict — roughly 20 port as CSS alone, 28 need a small module, 8 are not worth
porting. That verdict is about **mechanism only**. It never says an effect is good.

### A 401 does not mean paid

This is the trap, and it is worth stating loudly because the obvious reading is wrong. The
registry answers `401` for a paid component **and** for a slug that does not exist, with a
byte-identical body. There is no `404`. Verified: `3d-card-effect` is 401 but `3d-card` is 200;
`lamp-effect` is 401 but `lamp` is 200; `loader-one` is 401 but `loader` is 200; and
`zzz-nope-xyz` is 401 like the rest.

So **never report a 401 as "Victor has to buy this"**. It means *not yours, or not a thing*. The
documentation page's name is often not the registry name, so drop an `-effect` suffix and try the
bare noun, check the spelling on ui.aceternity.com, and take the near matches the script offers.
Only after every obvious variant also 401s is "paid" even a guess — and it is still a guess.

`200` is the only reliable signal.

### The dependency list under-reports

`dependencies` is the author's habits, not the effect's cost. `loader` and `stateful-button`
declare none and both import `motion/react`. And in the other direction, `motion` (Framer Motion)
is listed by nearly every component in the library and is almost never load-bearing: `stagger()`
is `animation-delay` and a fade is `@keyframes`. Icon sets and `mini-svg-data-uri` are chrome.

Read `files[].content`. The deps that genuinely disqualify a component are the ones that **are**
the effect: `three` / `@react-three/fiber`, `@tsparticles/*`, `simplex-noise`, `react-dropzone`,
`@radix-ui/*`. Those also lose on the CSP, which is a hard blocker rather than a judgement.

The paid 21st.dev CLI (`npx @21st-dev/cli`, `API_KEY_21ST`) is not needed for any of this and
should only be mentioned if someone asks what the paid alternative is.

## 2. Decide whether it belongs — before any code

`references/catalog.md` has all 50 free components already judged against The Edition, grouped by
the reason rather than by the component, because the reason is the reusable part. It lands at two
*Fits*, twelve *only if asked*, and thirty-six *wrong for this app*. Read it before porting; if
the answer is there, take it.

For anything not in that file, four questions settle most cases:

1. **Does it need a cursor?** Fourteen of the fifty free components have their whole effect on
   `:hover` or `mousemove`. On a phone they do not degrade, they do nothing — and they fail
   silently, which is worse than failing loudly. The phone is the only layout here.
2. **Does it put anything on a photograph?** Nothing is printed on a photograph in this app, and
   the photograph is the app's main evidence that a week is real. A fake light source laid over a
   real photograph of first light is the visual form of asserting a fact the app has not
   established, which is the house rule that outranks aesthetics.
3. **Does it need a colour the palette does not have?** If a port needs a hex, the port is wrong.
   `#3b82f6` and `neutral-800` are Tailwind's palette, not this club's.
4. **Would a member notice it twice?** An entrance you feel once is fine. An effect that loops,
   performs, or asks to be watched reads as a page that is selling — and this page is a ledger.

**"No" is the most common right answer and it is not a failure.** Rejecting a component with a
reason is the most useful output this skill produces; the rejection table in the worked example
took longer than the port and is worth more. Say which question it failed and move on.

## 3. Port it

`references/worked-example.md` walks one component end to end with the real code at every step —
`text-generate-effect` onto the landing hero, which shipped as four lines of CSS and no
JavaScript. That is about what a faithful port of anything in this library should cost.

**Grep the stylesheet for the mechanism first.** `app.css` already had `.enter` with a `--d` delay
— which *is* `text-generate-effect` at element granularity — written months before anyone saw
Aceternity. The honest outcome of a port is often three lines and sometimes zero.

**The React wrapper is not the component.** `useAnimate`, `useEffect`, `motion.span`, `cn()`, the
props: that is React being told to do what a stylesheet does on its own. The effect is usually a
keyframe, an index-to-delay mapping, and a custom property.

**Tailwind strings are CSS in disguise, and this is the step people skip.** Take every class off
and decide what it becomes here; the script prints the mapping. Expect most of them to become
nothing, because the house already sets them correctly. `font-bold` is forbidden outright —
Instrument Serif ships one weight and `font-synthesis-weight: none` guards it. `dark:` variants
become one token, since dark mode here is `tokens.css` redefining tokens, not a second set of
rules. Every hard-coded colour becomes a token from `circle/css/tokens.css` or the port stops.

**Keyframes and SVG filters usually port unchanged** — an SVG filter often *is* the effect. But
an `animate-<name>` class frequently has **no keyframes in the file**: they live in the consumer's
Tailwind config, which the registry does not ship. `spotlight` and `aurora-background` both do
this. The timing simply is not in the JSON, so a porter who only reads the source will invent it.
Read the component page or write the keyframes deliberately.

**Anything that reads the pointer, the scroll position or a measurement needs a small ES module in
`circle/js/ui/`**, not CSS. So does anything that must duplicate DOM: `infinite-moving-cards`
looks like pure CSS until you see it `cloneNode` its children, because a seamless loop needs a
second copy and CSS cannot make one. Plain modules, no build step, CSP-clean — no inline handlers,
no `eval`, no CDN but jsDelivr.

**If you find yourself writing a DOM-walker to make a borrowed effect fit, stop.** Ask whether the
coarser version says the same thing. In the worked example the faithful per-word port needed a
runtime walker, would have split the `<em class="ac">` the Edition cares about, and would have
handed a screen reader six text runs instead of one sentence. The cheapest port was the correct
one.

**The reduced-motion guard is not optional, and `0ms` is not `none`.** `tokens.css` zeroes every
duration under `prefers-reduced-motion`, which makes the guard look redundant. It is not:
`animation-fill-mode: both` holds the `from` keyframe through the *delay*, and delays are
literals. Without an explicit `animation: none` a reduced-motion visitor gets no motion and three
elements popping in out of order. Write the guard every time.

**A port may add a reduced-motion `@media` and must never add a width one.** The eleven `@media`
rules in `app.css` contain not one width breakpoint — eight reduced-motion, the print sheet, the
laptop frame, a display-mode rule. Take the value the phone would get and drop the variant. And
the standing constraints apply whatever the source did: transform and opacity only, `--r-pill`
untouched, 44px minimum in both dimensions, no horizontal overflow at 390.

Put the CSS **beside the thing it decorates**, not in a "borrowed" block at the bottom. A rule
next to its subject gets read by the next person who touches that screen; a quarantine block gets
read by nobody.

## 4. Verify by looking

Start the server, render at 390 in both themes, and **read the PNGs**:

```bash
cd /home/user/BY-JOHNNY-PAESCH && (python3 -m http.server 8899 --bind 127.0.0.1 >/dev/null 2>&1 &)
```

`circle-feel/scripts/harness.mjs` exports `open({ width, height, role, scale, touch })` and
`go(page, route, ms)`. Any claim about how something looks must come from a picture you looked at.

Three checks, in order of how often they catch something:

- **The settled render must be pixel-identical to before.** An entrance that alters the resting
  state is not an entrance, it is a redesign. Shoot before and after, both themes.
- **A settled screenshot cannot prove motion**, so measure it. Replay with
  `element.getAnimations()` and sample `getComputedStyle(e).opacity` over time. Then set
  `prefers-reduced-motion` and confirm `animation-name` is `none`, not merely fast.
- **`node .claude/skills/circle-feel/scripts/audit.mjs --role member`** before and after. Overflow,
  tap targets, control sizes, console errors on every route. A port must move none of those
  numbers backwards, and no console errors on either role.

## 5. Record where it came from

This codebase records the URL and date behind every photograph and sources every price. Borrowed
code is no different, and there is no separate manifest — **the CSS comment is the record**. It
carries four things: the library and component, the exact registry URL, the date it was fetched,
and the licence position.

```css
/* Ported from Aceternity UI's "text-generate-effect"
   (https://ui.aceternity.com/registry/text-generate-effect.json, fetched 2026-09-20; the free
   tier answers 200, and the licence permits modification inside an end product — what it forbids
   is republishing the item as source, which this is not). */
```

Say in the same comment what did **not** survive the crossing and why, because the next reader's
first instinct will be to restore it.

The licence allows unlimited end products, modification, combination and derivative works; it
forbids redistributing the item as source files and selling it on a marketplace. Building the
Circle with a ported effect is squarely permitted. Attribution is not demanded — we do it because
this house does it. Name the component in the commit subject too, so `git log` answers the
question:

```
landing: stagger the hero caption (ported from Aceternity text-generate-effect)
```

## When someone asks for the whole library

They are asking for a look, not a dependency. Answer with all three parts, in this order, or the
"no" sounds like a refusal to try:

1. It cannot be installed — no build step, no React, no Tailwind, and the CSP would block the
   libraries the interesting ones depend on.
2. Most of it is the wrong register for this app, and `references/catalog.md` already says which
   ones and why, component by component. That file is the useful thing to hand over.
3. The two or three that do earn a place can be ported by hand, as CSS, this week — and the
   rejected ones can be *shown* rather than argued about.

For showing: `/home/user/BY-JOHNNY-PAESCH/aceternity-lab` is a working Vite + React + Tailwind v4
scratch project (gitignored) where a component can be installed and run. Use it when an effect
cannot be judged by reading the `.tsx` — the worked example never needed it. **Nothing from the lab
ships.** It is a viewing room, not a source directory; ported code lands in `circle/css/app.css`
and, if it truly needs behaviour, `circle/js/ui/`.

## References

- `scripts/borrow.mjs` — fetch, verdict, Tailwind mapping, behaviour signals. Run it first.
- `references/catalog.md` — all 50 free components judged against The Edition, with the reasons.
- `references/worked-example.md` — one port end to end, including the rejection table and the four
  things it taught.
- `circle-feel/SKILL.md` — The Edition, and the house rules a port inherits. Read before judging.
