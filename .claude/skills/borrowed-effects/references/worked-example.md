# One effect, ported end to end

This is the whole path for a single component, with the real code at every step: Aceternity UI's
`text-generate-effect` onto the signed-out landing hero. It shipped. It is five lines of CSS in
`circle/css/app.css` and no JavaScript, which is roughly what a faithful port of anything in that
library should cost once the React is gone. It also shipped with a bug in the fill mode, which
§6 is now about, because a worked example that only shows the parts that went well is a
brochure.

Read this before porting your first one. The shape of the work is always the same; what changes
is how much of the original survives, and the honest answer is usually "less than you expected,
and that is the point".

## 0. Decide whether it belongs, before you fetch anything

The landing is the one screen in this app where atmosphere is allowed — it is all a guest sees,
and the hero is explicitly fair game. Everything behind the sign-in is a ledger, and a ledger
does not glow.

So the first pass over the library is a rejection pass. Rendered at 390 and judged against The
Edition, most of it fails on the same sentence: *a private club for forty friends where one man
books rooms with other people's money*. Specifically —

| Component | Why not |
| --- | --- |
| `aurora-background`, `background-beams` | A coloured wash behind text. This is the exact register Victor calls AI slop, and it needs hex values that are not in `tokens.css`. |
| `spotlight` | A white ellipse at 21% opacity, gaussian-blurred, laid over the hero. On this page the hero *is* a photograph of first light on the water; putting a fake light source on a real one is the visual version of a claim the app has not established. |
| `card-spotlight` | Follows the pointer. There is no pointer. The phone is the only layout, so this is dead on arrival — and it fails silently rather than loudly, which is worse. |
| `moving-border` | A gradient border that travels. The Edition is rules, not boxes, and certainly not glowing ones. |
| `evervault-card`, `typewriter-effect`, `flip-words` | All three perform. A page that performs at a member reads as a page that is selling. |
| `infinite-moving-cards` | The `.horizon` strip is already a thumb-swiped row of real stays. Replacing a control the member has with a carousel that moves on its own takes something away. |
| `text-generate-effect` | The only one left. See below. |

That table is most of the value of the exercise. **If you port nothing, you have not failed.**
And if someone is attached to one of the rows, build it in the scratchpad and render it rather
than arguing the paragraph again — §9's harness recipe works unchanged on a thing you intend to
throw away, and some objections (a borrowed effect colliding with a texture the surface already
has) are only visible in the picture.

## 1. Fetch the registry JSON, and let the status code decide

```
$ curl -s -o /tmp/tge.json -w "%{http_code}\n" \
    https://ui.aceternity.com/registry/text-generate-effect.json
200
```

`200` means free and portable, and it is the only reliable signal. **`401` does not mean paid.**
The registry answers 401 for a paid component and for a slug that does not exist, byte for byte
the same — so it means *not yours, or not a thing*, and the first move on one is to drop an
`-effect` suffix and try the bare noun. `3d-card-effect` returns 401 and `3d-card` returns 200.
The suffix is not the tell either — `google-gemini-effect` is 200. Only after every obvious
variant also 401s is "paid" even a guess, and telling Victor to buy a misspelling is the failure
this paragraph exists to prevent.

The body:

```json
{ "name": "text-generate-effect", "type": "registry:ui",
  "dependencies": ["motion"],
  "files": [{ "path": "components/ui/text-generate-effect.tsx", "content": "…" }] }
```

`dependencies: ["motion"]` is Framer Motion. It is a warning, not a blocker — nearly every
component in this library lists it, and nearly every one of them is using it for something CSS
does natively. Read the file before you believe the dependency.

## 2. Read the .tsx and split it in two

The whole component, trimmed to what matters:

```tsx
const [scope, animate] = useAnimate();
let wordsArray = words.split(" ");
useEffect(() => {
  animate("span",
    { opacity: 1, filter: filter ? "blur(0px)" : "none" },
    { duration: duration ? duration : 1, delay: stagger(0.2) });
}, [scope.current]);

// …
<motion.span className="dark:text-white text-black opacity-0"
             style={{ filter: filter ? "blur(10px)" : "none" }}>
  {word}{" "}
</motion.span>
```

Two columns. On the left, **plumbing**: `useAnimate`, `scope`, `useEffect`, `motion.span`, the
`key`, the `cn()` merge, the `filter`/`duration` props. None of that is the effect; it is React
being told to do what a stylesheet does on its own. On the right, **the effect**, and it is
three things:

1. an element starts at `opacity: 0` and ends at `opacity: 1`;
2. each element's **index becomes its delay** — that is all `stagger(0.2)` is;
3. a `blur(10px)` clears to `blur(0px)` alongside the fade.

That is the entire mechanism. `motion` is doing nothing here that `@keyframes` and
`animation-delay` do not, so the dependency evaporates on contact.

## 3. Throw away the parts that are wrong for this app

Two of those three survive. Say out loud why the third does not, because the reason generalises:

- **Word granularity goes.** Six words revealing one at a time is a sentence being typed by a
  machine. On a page whose whole job is to make forty people trust that a real person is holding
  their money, that is the single worst impression available. The stagger stays; the unit changes
  from a word to a line of the caption.
- **The blur goes.** Two reasons, and both are house rules. `filter` is not transform and it is
  not opacity, so it re-composites every frame and stutters on the phones this club actually
  uses. And the Edition's motion rule is one sentence long: *motion is a fade*.
- **The stagger stays**, tightened. `stagger(0.2)` over six words is 1.2s of performance. Over
  three elements at 90ms it is 180ms, which you feel and do not watch.

## 4. Map the Tailwind strings to real CSS

This is the step people skip, and it is where the tokens get violated. Take every class off the
component and decide what it becomes here. The type classes are the instructive ones:

**Before** — what the component ships:

```tsx
<div className={cn("font-bold", className)}>
  <div className="mt-4">
    <div className="dark:text-white text-black text-2xl leading-snug tracking-wide">
```

**After** — what any of that is allowed to be in this codebase:

```css
/* nothing. Every one of those declarations already exists, correctly, on .hero-cover h1: */
.hero-cover h1 { color: var(--on-photo); font-size: var(--t-masthead); line-height: 1; }
```

Line by line, so the reasoning is reusable:

| Tailwind | What it wants | What it becomes here |
| --- | --- | --- |
| `font-bold` | `font-weight: 700` | **Nothing — this is forbidden.** Instrument Serif ships one weight and `font-synthesis-weight: none` is set on purpose; a faux bold is the cheapest thing a serif can do. |
| `text-black` / `dark:text-white` | two hard-coded colours plus a dark variant | `var(--on-photo)`. The token is one value in both themes *because the photograph does not change*, which is exactly the fact the Tailwind pair cannot express. |
| `text-2xl` | 24px | `var(--t-masthead)` (44px) — the size the headline already is. A size that is not on the nine-step scale was not chosen. |
| `leading-snug` | `line-height: 1.375` | `line-height: 1`, already set. |
| `tracking-wide` | `letter-spacing: .025em` | Nothing. Letterspacing in this app belongs to the mono apparatus, not to a serif title. |
| `mt-4` | 16px | `var(--s-4)` if it were needed. It is not; the caption's rhythm is already set. |
| `opacity-0` | the animation's start | survives, as `from { opacity: 0 }` — this is the one class that was actually the effect. |

Seven classes in, one class out. That ratio is normal, and it is the clearest signal that what
you are porting is a *mechanism*, not a design.

**Colour rule, stated plainly:** if a port needs a hex, the port is wrong. `#3b82f6` and friends
are Tailwind's palette, not this club's. The only colours are in `css/tokens.css`. If the effect
cannot be expressed in them, that is the effect telling you it does not belong.

## 5. Write the CSS, where the thing it decorates lives

It goes next to `.hero-cover .on .row` in `circle/css/app.css`, not in a "borrowed" section at
the bottom. A rule that lives beside its subject gets read by the next person who touches the
hero; a rule in a quarantine block gets read by nobody.

```css
/* The caption arrives in reading order — the claim, then the promise, then the invitation —
   instead of the three landing at once. Ported from Aceternity UI's "text-generate-effect"
   (https://ui.aceternity.com/registry/text-generate-effect.json, fetched 2026-09-20; the free
   tier answers 200, and the licence permits modification inside an end product — what it
   forbids is republishing the item as source, which this is not). Two thirds of that component
   did not survive the crossing and should not have: it reveals one WORD at a time, and it does
   it by animating a 10px blur away. A sentence typing itself out word by word is a machine
   writing, which is the single impression this page cannot afford, and `filter` is not a
   property we animate — it is composited per frame and janks on the phones this club uses.
   What is left is the only part that was ever the idea: turn an element's index into a delay.
   The stagger lives here rather than as inline `--d` on the view because these three children
   are fixed by the layout, so the template should not have to know their order.
   Short enough that it reads as the page settling, not as a sequence being performed.
   [the rest of the comment, on the fill mode and the keyframe, is in §6] */
@keyframes enter-to-rest { from { opacity: 0; } }
.hero-cover .on .wrap > * { animation: enter-to-rest var(--dur-water) var(--ease-out) backwards; }
.hero-cover .on .wrap > :nth-child(2) { animation-delay: 90ms; }
.hero-cover .on .wrap > :nth-child(3) { animation-delay: 180ms; }
```

Note what it reuses. `.enter` and `@keyframes enter` were already in the stylesheet — an opacity
fade driven by an inline `--d` delay. **The house already owned this effect at element
granularity.** The genuinely new part is the index-to-delay mapping in CSS with `:nth-child`, so
the view does not have to carry a hand-written `--d` on each child. `var(--dur-water)` (700ms)
and `var(--ease-out)` are the existing motion tokens, so this moves with the same physics as
everything else. The one thing it does *not* reuse is the keyframe, and §6 is why.

## 6. The fill mode quietly changed the design, and the first check caught it

The rule shipped as `animation: enter var(--dur-water) var(--ease-out) both`, and that was wrong
in a way nothing in the render showed. `.hero-cover .lede` is declared `opacity: .94`. The shared
`@keyframes enter` ends at `to { opacity: 1 }`, and `fill-mode: both` holds the end state
forever — so the lede rested at `1` when motion ran and at `.94` when it did not. Measured in the
real browser at 390:

```
settled, motion allowed:        1      0.94*  1        (* was 1 before this section's fix)
same elements, animation off:   1      0.94   1
reduced motion:                 1      0.94   1   animation-name: none
```

Those first two rows are the check in §9, and they used to disagree. The fix is two changes:

- **`backwards`, not `both`.** Backwards is the only half that was ever wanted: it holds
  `from { opacity: 0 }` through the *delay*, so the second and third children do not flash before
  their turn. It then releases the element to its own declared style when the run ends.
- **A keyframe with only a `from`.** `backwards` alone still leaves the lede climbing to 1 during
  the run and stepping back to .94 the instant it finishes — measured at t≈808ms, a 6% drop at
  exactly the moment the eye is on that element. `@keyframes enter-to-rest { from { opacity: 0 } }`
  writes no 100% keyframe, so the browser builds one from the element's own computed style and
  each child fades up to the opacity it was already assigned. Re-measured: the lede converges
  smoothly on 0.940 with no step.

The reusable lesson, and it is the second way after the delay trap that a shared entrance
misbehaves: **`to { opacity: 1 }` with `fill-mode: both` silently overwrites any resting opacity
the element already had.** If a borrowed entrance is going onto elements you did not author,
write the `from` and let the browser infer the `to`.

## 7. The reduced-motion guard, and the trap inside it

```css
/* The guard has to switch the animation off, not just shorten it: reduced motion zeroes
   --dur-water, and a 0ms animation with a backwards fill and a delay still holds its `from`
   state for the length of the delay — so the invitation would blink in 180ms late with no
   motion to explain it. */
@media (prefers-reduced-motion: reduce) { .hero-cover .on .wrap > * { animation: none; } }
```

`tokens.css` already sets every duration to `0ms` under reduced motion, so it is tempting to
think the guard is redundant. It is not. A fill mode that covers the delay — `backwards` here,
`both` before §6 — makes an element hold its `from` keyframe through the *delay*, and the delay
is a literal, not a token. Without this rule a reduced-motion visitor gets an invisible headline
for 0ms, an invisible promise for 90ms, and an invisible button for 180ms — no animation, just
three things popping in out of order. Verified:

```
reduced motion: [["1","none"],["0.94","none"],["1","none"]]
```

Opacities settled and `animation-name: none` on all three. The `0.94` is `.hero-cover .lede`'s
own resting opacity, and §6 is the story of how it came to be the same number here as it is with
the animation running.

`animation: none` is the right guard here because these three elements carry the page's content.
For a layer that is *purely* decorative, `display: none` on the container is the better guard: it
drops the elements as well as the motion, and it cannot leak a fill-mode state. So the check in
§9 is "confirm it is not animating", not "confirm `animation-name` reads `none`".

This adds a reduced-motion `@media` rule to `app.css`, and that is the *only* kind a port may
add. Everything else in the file is a reduced-motion guard, the print sheet, a display-mode rule,
or the laptop frame — the file's one `min-width` query, which holds no layout at all, only a
background and an outline, and says so in its own comment. **A port that wants a width breakpoint
is a port that does not belong** — there is one layout, the phone.

## 8. Wiring it into the markup

There is nothing to wire, and that was a deliberate constraint rather than luck. The selector
targets structure the view already emits:

```html
<figcaption class="on"><div class="wrap">
  <h1 style="max-width:16ch">A private travel circle <em class="ac">in Aruba</em>.</h1>
  <p class="lede" …>Put in a hundred dollars a month. …</p>
  <div class="row"><a class="btn" …>I have an invitation</a>
                   <a class="link-rule" …>How the Circle works</a></div>
</div></figcaption>
```

Three fixed children, so `:nth-child(2)` and `:nth-child(3)` are stable. This matters more than
it looks: the *faithful* port — per word — would have needed the `<h1>` split into one `<span>`
per word, which means a JS module walking the headline at runtime, which means splitting the
`<em class="ac">in Aruba</em>` the Edition cares about, and handing a screen reader six separate
text runs instead of one sentence. **The cheapest port was also the correct one.** If you find
yourself writing a DOM-walker to make a borrowed effect fit, stop and ask whether the coarser
version says the same thing.

If a port genuinely does need behaviour, it is one small ES module in `circle/js/ui/`, plain
modules, no build step, and it has to survive the CSP (`script-src 'self' https://cdn.jsdelivr.net`)
— no inline handlers, no `eval`, no CDN that is not jsDelivr.

## 9. Render it, and read the picture

Two things need to be seen: that it settles correctly in both themes, and that the stagger is
actually happening rather than just being declared.

```
cd /home/user/BY-JOHNNY-PAESCH && (python3 -m http.server 8899 --bind 127.0.0.1 >/dev/null 2>&1 &)
```

```js
import { open, go } from '…/circle-feel/scripts/harness.mjs';
const { b, p, errors } = await open({ width: 390, height: 844, role: null, scale: 2, touch: true });
await go(p, '/', 1800);
await p.screenshot({ path: `${OUT}/landing-light-after.png` });
await p.emulateMedia({ colorScheme: 'dark' });
await p.screenshot({ path: `${OUT}/landing-dark-after.png` });
```

Then `Read` both PNGs. Settled light and settled dark have to be pixel-for-pixel what they were
before the change: an entrance that alters the resting state is not an entrance, it is a
redesign. The eye is not good enough for this on its own — §6 is a case where the two differed by
6% on one element and no screenshot showed it — so read the number as well:

```js
// the element as it rests, then the same element with the animation taken away
getComputedStyle(e).opacity;
e.style.animation = 'none'; getComputedStyle(e).opacity;
```

```
settled, motion allowed:      1   0.94   1
same elements, animation off: 1   0.94   1
```

One trap in that snippet: writing `style.animation` restarts the animation from its first frame,
so a screenshot taken straight after that read catches the caption mid-fade and looks like a
regression. Take the settled pictures in a separate pass, before you touch any style.

A settled screenshot also cannot prove a stagger, so measure that too. Sample from
`waitUntil: 'commit'` rather than replaying: a finished animation whose fill is not `forwards` is
removed from `getAnimations()`, so `cancel(); play()` after the fact silently does nothing.

```
t= 215ms   h1 0.837   lede 0.602   row 0.212
t= 425ms   h1 0.970   lede 0.934   row 0.862
t= 876ms   1.000      0.940        1.000
```

Three curves, 90ms apart, everything at rest inside a second, and each one landing on the opacity
that element already had. That is the claim, checked.

Renders for this port: `scratchpad/borrow-example/landing-{light,dark}-{before,after}.png`,
plus `landing-light-mid.png` (caught mid-flight, the button visibly behind the headline) and
`landing-reduced-motion.png`.

## 10. Check that nothing moved — when something ships

```
node .claude/skills/circle-feel/scripts/audit.mjs --role member --width 390
```

Before and after, diffed: **identical**. No overflow at 390 on any route, no console errors,
every control still 16px or more, tap targets unchanged. An effect that improves the feel should
move at least one number or none; it must never move one backwards.

This step, and §9's before/after pair, only apply to a port that ships. A rejection has no
"after", and a scratchpad demonstration injected at runtime is not in the audit's world at all —
for those, §9's harness recipe is still the tool, but the audit is not.

## 11. Record where it came from

The house records provenance for every photograph and every price, so a borrowed effect records
it too. There is no separate manifest — the comment is the record, and it carries all four
things a future reader needs: the library, the exact URL, the date it was fetched, and the
licence position. Two more rules that this port did not need and the next one will. If any timing
was **reconstructed** rather than read out of the registry response — which is the usual case for
an `animate-<name>` class, because those keyframes live in the consumer's Tailwind config and the
registry does not ship it — say so here, in that word. Otherwise an invented duration ships
looking sourced. And if the port lands in `circle/js/ui/`, the same four facts go in a header
comment at the top of the module, with a one-line pointer to it from the CSS the module feeds.

> Ported from Aceternity UI's "text-generate-effect"
> (https://ui.aceternity.com/registry/text-generate-effect.json, fetched 2026-09-20; the free
> tier answers 200, and the licence permits modification inside an end product — what it forbids
> is republishing the item as source, which this is not).

Commit message names the same two facts, so `git log` answers the question too:

```
landing: stagger the hero caption (ported from Aceternity text-generate-effect)
```

## What this port actually taught

Five things, in the order they surprised me:

1. **The dependency was a lie of omission.** `dependencies: ["motion"]` sounds like Framer Motion
   is load-bearing. It is not — `stagger()` is `animation-delay` and the fade is `@keyframes`.
   Read the source before you price the port; most of this library's `motion` dependency is
   React reaching for a library to do what CSS does for free.
2. **The house already owned the effect.** `.enter` + `--d` in `app.css` is
   `text-generate-effect` at element granularity, written months earlier by someone who had never
   seen it. Grep the stylesheet for the *mechanism* before porting anything — the honest outcome
   of a port is often three lines, and sometimes zero.
3. **The faithful port was the wrong port.** Per-word reveal is the component's whole identity
   and it is unusable here, not for a technical reason but because it makes the page read as
   machine-written. Judge the impression, not the fidelity.
4. **`0ms` is not `none`.** Reduced motion zeroing the duration token looks like enough and is
   not, because `animation-delay` is untouched and a fill mode that covers the delay honours it.
   Every port needs its own explicit guard, not a shortened duration.
5. **The keyframe's end is a declaration, not a no-op.** `to { opacity: 1 }` with `fill-mode:
   both` overwrote the `.94` the lede already rested at, and the port changed the settled design
   while §9 was busy asserting it had not. This one shipped wrong and was caught later by
   someone re-reading the claim — which is the argument for measuring the settled state rather
   than eyeballing it. Write the `from`; let the browser infer the `to`.

And one that is not a surprise so much as a standing warning: the rejection table in §0 took
longer than the port and is worth more. The library's median component is a coloured glow, and a
coloured glow on this app is a lie about what it is.
