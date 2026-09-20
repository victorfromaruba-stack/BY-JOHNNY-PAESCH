# One effect, ported end to end

This is the whole path for a single component, with the real code at every step: Aceternity UI's
`text-generate-effect` onto the signed-out landing hero. It shipped. It is four lines of CSS in
`circle/css/app.css` and no JavaScript, which is roughly what a faithful port of anything in that
library should cost once the React is gone.

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

## 1. Fetch the registry JSON, and let the status code decide

```
$ curl -s -o /tmp/tge.json -w "%{http_code}\n" \
    https://ui.aceternity.com/registry/text-generate-effect.json
200
```

`200` means free and portable. `401` means it is Pro and Victor has not bought it — stop there,
do not read it, do not reimplement it from the marketing page. `3d-card-effect` returns 401.

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
   Short enough that it reads as the page settling, not as a sequence being performed. */
.hero-cover .on .wrap > * { animation: enter var(--dur-water) var(--ease-out) both; }
.hero-cover .on .wrap > :nth-child(2) { animation-delay: 90ms; }
.hero-cover .on .wrap > :nth-child(3) { animation-delay: 180ms; }
```

Note what it reuses. `@keyframes enter` and `.enter` were already in the stylesheet — a 600ms
opacity fade driven by an inline `--d` delay. **The house already owned this effect at element
granularity.** The genuinely new part is three lines: doing the index-to-delay mapping in CSS
with `:nth-child` so the view does not have to carry a hand-written `--d` on each child.
`var(--dur-water)` and `var(--ease-out)` are the existing motion tokens, so this moves with the
same physics as everything else.

## 6. The reduced-motion guard, and the trap inside it

```css
/* The guard has to switch the animation off, not just shorten it: reduced motion zeroes
   --dur-water, and a 0ms animation with `both` and a delay still holds its `from` state for the
   length of the delay — so the invitation would blink in 180ms late with no motion to explain it. */
@media (prefers-reduced-motion: reduce) { .hero-cover .on .wrap > * { animation: none; } }
```

`tokens.css` already sets every duration to `0ms` under reduced motion, so it is tempting to
think the guard is redundant. It is not. `animation-fill-mode: both` makes an element hold its
`from` keyframe through the *delay*, and the delay is a literal, not a token. Without this rule a
reduced-motion visitor gets an invisible headline for 0ms, an invisible promise for 90ms, and an
invisible button for 180ms — no animation, just three things popping in out of order. Verified:

```
reduced-motion at 60ms: [["1","none"],["0.94","none"],["1","none"]]
```

Opacity settled, `animation-name: none`. (`0.94` is `.hero-cover .lede`'s own resting opacity,
not the animation.)

This adds a twelfth `@media` rule to `app.css`. That is fine and it is the *only* kind of `@media`
a port may add: the eleven that were there are eight reduced-motion guards, the print sheet, the
laptop frame and a display-mode rule, and none of them is a width breakpoint. **A port that wants
a width breakpoint is a port that does not belong** — there is one layout, the phone.

## 7. Wiring it into the markup

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

## 8. Render it, and read the picture

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

Then `Read` both PNGs. Settled light and settled dark are pixel-for-pixel what they were before
the change, which is the correct result for an entrance: an entrance that alters the resting
state is not an entrance, it is a redesign.

A settled screenshot cannot prove a stagger, so measure it instead of trusting the eye:

```js
els.forEach(e => e.getAnimations().forEach(a => { a.cancel(); a.play(); }));
// sample getComputedStyle(e).opacity over time
```

```
t≈216ms   h1 0.837   lede 0.640   row 0.212
t≈416ms   h1 0.970   lede 0.934   row 0.862
t≈880ms   1          1            1
```

Three curves, 90ms apart, everything at rest inside a second. That is the claim, checked.

Renders for this port: `scratchpad/borrow-example/landing-{light,dark}-{before,after}.png`,
plus `landing-light-mid.png` (caught mid-flight, the button visibly behind the headline) and
`landing-reduced-motion.png`.

## 9. Check that nothing moved

```
node .claude/skills/circle-feel/scripts/audit.mjs --role member --width 390
```

Before and after, diffed: **identical**. No overflow at 390 on any route, no console errors,
every control still 16px or more, tap targets unchanged. An effect that improves the feel should
move at least one number or none; it must never move one backwards.

## 10. Record where it came from

The house records provenance for every photograph and every price, so a borrowed effect records
it too. There is no separate manifest — the CSS comment is the record, and it carries all four
things a future reader needs: the library, the exact URL, the date it was fetched, and the
licence position.

> Ported from Aceternity UI's "text-generate-effect"
> (https://ui.aceternity.com/registry/text-generate-effect.json, fetched 2026-09-20; the free
> tier answers 200, and the licence permits modification inside an end product — what it forbids
> is republishing the item as source, which this is not).

Commit message names the same two facts, so `git log` answers the question too:

```
landing: stagger the hero caption (ported from Aceternity text-generate-effect)
```

## What this port actually taught

Four things, in the order they surprised me:

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
   not, because `animation-delay` is untouched and `fill-mode: both` honours it. Every port needs
   its own explicit `animation: none` guard, not a shortened duration.

And one that is not a surprise so much as a standing warning: the rejection table in §0 took
longer than the port and is worth more. The library's median component is a coloured glow, and a
coloured glow on this app is a lie about what it is.
