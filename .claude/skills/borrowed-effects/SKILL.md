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

**And the CSS underneath is often worth having anyway.** Strip the React and most of these turn
out to be four lines of `@keyframes`, a custom property and a gradient. That part crosses cleanly.

So the job is never *install*. It is: **read the mechanism, decide whether it belongs, rebuild it
in the house's own CSS and tokens, and record where it came from.**

## 1. Look the slug up before you fetch it

**`references/catalog.md` first.** It judges 67 components against The Edition, grouped by the
reason rather than by the component, because the reason is the reusable part. If the slug is
there, **the decision is already made** — two *Fits*, fourteen *only if asked*, fifty-one *wrong
for this app*. You still run the script afterwards, but for the source and the Tailwind mapping,
not to make the call. A mechanism verdict read without the catalogue points the opposite way
often enough to matter: `meteors` declares no dependencies and looks cheap, and the catalogue has
had it in the *wrong for this app* column since before anyone proposed it.

The catalogue is not complete and never will be. It covers the 61 slugs the registry serves free
as of 2026-09-20 plus six the script does not probe; Aceternity ships new ones. **If a slug is
not in the file that says nothing about whether it is free** — put it through the five questions
in §2 yourself, and write the verdict into the catalogue afterwards so the next person does not
repeat the work.

### Then the script, for the source

Aceternity publishes a free public registry — no account, no API key:

```
https://ui.aceternity.com/registry/<slug>.json
```

A `200` returns `{ name, dependencies, files: [{ path, content }] }` with the whole `.tsx` in the
body. `scripts/borrow.mjs` fetches that and tells you, in one call, what the catalogue already
ruled, the licence position, what the dependencies really are, what every Tailwind class means in
plain CSS, which colours are hard-coded, and whether the effect can live in CSS alone:

```bash
node /home/user/BY-JOHNNY-PAESCH/.claude/skills/borrowed-effects/scripts/borrow.mjs spotlight
#  --save <dir>   write the raw .tsx and the report   |   --no-source   report only
#  --list         probe every known slug and print the table
```

`--list` probes the known slugs live and prints, per slug, the house ruling and a one-word
mechanism verdict, then tallies both. **Read the tally off the script, not out of this file** —
the counts move whenever Aceternity ships a component, and a number written into a skill file is
a number that will be wrong next quarter. That verdict is about **mechanism only**: it never says
an effect is good.

### 21st.dev and shadcn have no registry to read

The script is Aceternity-only. 21st.dev and shadcn publish the component source on the page
itself, so there is no call to make: save the `.tsx` to a scratch file and walk §2–§5 by hand.
Nothing else changes — the Tailwind mapping, the token rule, the reduced-motion guard and the
provenance comment are identical once the source is in front of you. The paid 21st.dev CLI
(`npx @21st-dev/cli`, `API_KEY_21ST`) is not needed and should only be mentioned if someone asks
what the paid alternative is.

### A 401 does not mean paid

This is the trap, and it is worth stating loudly because the obvious reading is wrong. The
registry answers `401` for a paid component **and** for a slug that does not exist, with a
byte-identical body. There is no `404`. Verified: `3d-card-effect` is 401 but `3d-card` is 200;
`lamp-effect` is 401 but `lamp` is 200; `loader-one` is 401 but `loader` is 200; and
`zzz-nope-xyz` is 401 like the rest. The suffix itself is not the tell — `google-gemini-effect`
returns 200.

So **never report a 401 as "Victor has to buy this"**. It means *not yours, or not a thing*. The
documentation page's name is often not the registry name, so drop an `-effect` suffix and try the
bare noun, check the spelling on ui.aceternity.com, and take the near matches the script offers.
Only after every obvious variant also 401s is "paid" even a guess — and it is still a guess.
`200` is the only reliable signal.

### The dependency list under-reports

`dependencies` is the author's habits, not the effect's cost. `loader` and `stateful-button`
declare none and both import `motion/react`. And in the other direction, `motion` (Framer Motion)
is listed by nearly every component and is almost never load-bearing: `stagger()` is
`animation-delay` and a fade is `@keyframes`. Icon sets and `mini-svg-data-uri` are chrome. Read
`files[].content`. The deps that genuinely disqualify a component are the ones that **are** the
effect: `three` / `@react-three/fiber`, `@tsparticles/*`, `simplex-noise`, `react-dropzone`,
`@radix-ui/*`. Those also lose on the CSP, which is a hard blocker rather than a judgement.

## 2. Decide whether it belongs — before any code

For anything the catalogue does not already judge, five questions settle most cases:

1. **Does it need a cursor?** Eighteen of the sixty-seven judged have their whole effect on
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
   `infinite` in the source is usually the whole answer.
5. **Does the surface already have a texture?** A borrowed effect that shares a colour, a weight
   or an angle with decoration already on the element does not layer over it, it corrupts it.
   `meteors` on `.card-obj` is the case: the tails are the same gold, the same 1px, close to the
   same angle as the `.contours` hairlines, so on screen the card reads as its own engraving
   coming loose. That is not reachable from the source. **Render it before you believe
   otherwise.**

**"No" is the most common right answer and it is not a failure.** Rejecting a component with a
reason is the most useful output this skill produces; the rejection table in the worked example
took longer than the port and is worth more.

**If the answer is no and the person is attached to the idea, build it and render it anyway.**
Injected at runtime in the harness, or in a viewing room built by `scripts/make-lab.sh` — never in
`circle/`, never committed. A picture of why it is wrong ends the conversation; a paragraph
invites a second round. The harness recipe in §4 works unchanged for this, and question 5 is only
answerable this way.

## 3. Port it

`references/worked-example.md` walks one component end to end with the real code at every step —
`text-generate-effect` onto the landing hero, which shipped as five lines of CSS and no
JavaScript. That is about what a faithful port of anything in this library should cost.

**Grep the stylesheet for the mechanism — and for the prohibition.** `app.css` already had
`.enter` with a `--d` delay, which *is* `text-generate-effect` at element granularity, written
months before anyone saw Aceternity; the honest outcome of a port is often three lines and
sometimes zero. But this stylesheet also argues with itself in comments, and **the rule you are
about to break is usually written directly above the selector you are about to touch.** The
comment over `.card-obj` says *"a simulated highlight is a lighting effect, and this house has
none"* — a decision taken before Aceternity was ever mentioned, sitting in the file, and a
procedure that greps only for the mechanism walks straight past it.

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
Tailwind config, which the registry does not ship. `spotlight`, `aurora-background` and `meteors`
all do this. The timing simply is not in the JSON, so a porter who only reads the source will
invent it and it will ship looking sourced. Read the component page, or write the keyframes
deliberately — and if you wrote them, **say so in the provenance comment in those words**:
*reconstructed, not verified against the registry response*. That line is the difference between
a record and a guess.

**CSS cannot mint elements and has no `random()`.** Anything that reads the pointer, the scroll
position or a measurement needs a small ES module in `circle/js/ui/`, and so does anything that
multiplies its own DOM. That second family hides well, because JSX does it declaratively:
`infinite-moving-cards` looks like pure CSS until you see it `cloneNode` its children, and
`meteors` looks like pure CSS until you notice `new Array(20)` and two `Math.random()` calls, one
per span. Both are the same wall. The script flags all three patterns; if you see them, the port
needs markup emitted from `pieces.js` or a module, and the scatter has to become a fixed value
per element rather than a random one. Plain modules, no build step, CSP-clean — no inline
handlers, no `eval`, no CDN but jsDelivr.

**If you find yourself writing a DOM-walker to make a borrowed effect fit, stop.** Ask whether the
coarser version says the same thing. In the worked example the faithful per-word port needed a
runtime walker, would have split the `<em class="ac">` the Edition cares about, and would have
handed a screen reader six text runs instead of one sentence. The cheapest port was the correct
one.

**Two ways a shared entrance keyframe misbehaves, both silent.**

- **`0ms` is not `none`.** `tokens.css` zeroes every duration under `prefers-reduced-motion`,
  which makes the guard look redundant. It is not: a fill mode that covers the delay holds the
  `from` keyframe through it, and delays are literals, not tokens. Without an explicit guard a
  reduced-motion visitor gets no motion and three elements popping in out of order.
- **`to { opacity: 1 }` plus `fill-mode: both` overwrites a resting opacity the element already
  had.** `.hero-cover .lede` is set to `.94`; the shared `enter` keyframe ends at 1 and `both`
  holds that forever, so the element rested at 1 with motion and `.94` without it — the port had
  changed the settled design while claiming not to. Prefer **`backwards`**, which holds the
  `from` through the delay and then releases the element, and write a keyframe with **only a
  `from`**: when no 100% keyframe is given the browser builds one from the element's own computed
  style, so every child fades up to the opacity it was already assigned. That is what
  `@keyframes enter-to-rest` is for.

**A port may add a reduced-motion `@media` and must never add a width one.** There is exactly one
`min-width` query in `app.css` — the laptop frame, which holds no layout, only a background and an
outline, and says so in its own comment. Everything else is reduced-motion guards, the print
sheet and a display-mode rule. Take the value the phone would get and drop the variant. And the
standing constraints apply whatever the source did: transform and opacity only, `--r-pill`
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
`go(page, route, ms)`. Any claim about how something looks must come from a picture you looked
at. This is also how you build the case against an effect you are rejecting — see §2.

When something **ships**, three checks, in order of how often they catch something:

- **The settled render must be pixel-identical to before.** An entrance that alters the resting
  state is not an entrance, it is a redesign. Shoot before and after, both themes. Measure it as
  well as looking: read the element's opacity, then set `style.animation = 'none'` on the same
  element and read it again. If the two differ, the keyframe is overwriting a declared value.
- **A settled screenshot cannot prove motion**, so measure it. Sample `getComputedStyle(e).opacity`
  from `waitUntil: 'commit'` — a finished animation whose fill is not `forwards` is removed from
  `getAnimations()`, so it cannot be replayed after the fact. Then set `prefers-reduced-motion`
  and confirm the element **is not animating**: `animation-name: none`, or the layer absent from
  the render. For a purely decorative container `display: none` is the better guard, because it
  drops the elements as well as the motion and cannot leak a fill-mode state.
- **`node .claude/skills/circle-feel/scripts/audit.mjs --role member`** before and after. Overflow,
  tap targets, control sizes, console errors on every route. A port must move none of those
  numbers backwards, and no console errors on either role.

## 5. Record where it came from

This codebase records the URL and date behind every photograph and sources every price. Borrowed
code is no different, and there is no separate manifest — **the comment is the record**. It
carries four things: the library and component, the exact registry URL, the date it was fetched,
and the licence position.

```css
/* Ported from Aceternity UI's "text-generate-effect"
   (https://ui.aceternity.com/registry/text-generate-effect.json, fetched 2026-09-20; the free
   tier answers 200, and the licence permits modification inside an end product — what it forbids
   is republishing the item as source, which this is not). */
```

Say in the same comment what did **not** survive the crossing and why, because the next reader's
first instinct will be to restore it. If any timing was reconstructed rather than read out of the
registry, say that here too, in those words.

**If the port lands in `circle/js/ui/`, the same four facts go in a header comment at the top of
that module, and the CSS it feeds carries a one-line pointer to the module.** Neither half is
readable without the other, and a record that lives in only one of them is lost the first time
someone reads the other.

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
"no" sounds like a refusal to try: it cannot be installed (no build step, no React, no Tailwind,
and the CSP blocks what the interesting ones depend on); most of it is the wrong register, and
`references/catalog.md` says which ones and why, component by component, which is the useful
thing to hand over; and the two or three that do earn a place can be ported by hand, as CSS, this
week — while the rejected ones can be *shown* rather than argued about.

For showing: `sh scripts/make-lab.sh` builds a throwaway Vite + React + Tailwind project in a
minute, where a component can be installed and watched running. Aceternity's registry is public,
so shadcn takes the URL directly and no account is involved:
`npx shadcn@latest add https://ui.aceternity.com/registry/<slug>.json`. You need this only for an
effect you cannot read off the `.tsx` — a canvas, a shader, a physics loop. **Nothing from the lab
ships.** It is a viewing room, not a source directory; ported code lands in `circle/css/app.css`
and, if it truly needs behaviour, `circle/js/ui/`. Delete it when you are done looking.

## References

- `references/catalog.md` — 67 components judged against The Edition, with the reasons. Read it
  first; for anything in it the decision is already made.
- `scripts/borrow.mjs` — house ruling, source, Tailwind mapping and behaviour signals, in one
  call. Aceternity registry only.
- `scripts/make-lab.sh` — builds the viewing room and its own `add.mjs` installer, for an effect
  you cannot read off the source. Takes a minute, gitignored, delete it afterwards.
- `references/worked-example.md` — one port end to end, with the rejection table and its lessons.
- `circle-feel/SKILL.md` — The Edition, and the house rules a port inherits. Read before judging.
