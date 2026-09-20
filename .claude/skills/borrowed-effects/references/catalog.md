# The Aceternity catalogue, judged against the Edition

This library was built for one job: a dark, full-bleed landing page that has three seconds to
impress a stranger who has never heard of the product. Glow, aurora, beams, a card that tilts
under the cursor — every one of those is a device for holding attention that has not been earned
yet. The Circle has the opposite problem. Forty people who already know each other read it every
week to find out what a week costs and whether Victor booked it. Attention is not the scarce
thing; trust in the figures is. So most of what follows is not merely unnecessary here, it works
against the app, and the honest answer to "can we add this one" is usually no. Two components
were filed as earning a place; **one of those, `stateful-button`, was withdrawn on 2026-09-20
when the flow was driven in the harness and the absence it was filed against turned out not to
exist**, so the standing count is one Fit, and it has shipped. Fourteen would work if Victor
points at them. Fifty-one are wrong for this app, and the section at the end says what the phone
alone rules out.

**Sixty-seven judged, and that is not all of them.** `borrow.mjs --list` probes sixty-one slugs
and every one answered 200 on 2026-09-20; this file judges those sixty-one plus six the script
does not probe. Aceternity keeps shipping. **A slug missing from this file says nothing about
whether it is free** — it means nobody has ruled on it yet. Put it through the five questions in
`SKILL.md` §2 and write the answer in here afterwards.

Judged after rendering `/home`, `/stays`, `/stays/stay_surfclub` and the signed-out landing at
390x844 and looking at them: paper ground, ink serif titles with one italic word, mono figures,
hairline rules instead of boxes, one filled dark button, teal only on money. Nothing on those
four screens glows.

## Reading the status column

`https://ui.aceternity.com/registry/<slug>.json` with no account. **200 means free, portable and
the full .tsx is in the body.** It is the only reliable signal.

**401 does not mean paid.** A slug that does not exist returns 401 with
`{"error":"Unauthorized - Please provide a valid API token or sign in"}` — the same body a real
paid component returns, and the same body `zzz-nope.json` returns. The documentation URL is often
not the registry name: `lamp-effect` is 401 but `lamp` is 200; `loader-one` is 401 but `loader`
is 200 and exports `LoaderOne`; `3d-card-effect` is 401 but `3d-card` is 200. So on a 401, drop
the `-effect` suffix and try the bare noun before concluding anything. Only after the obvious
variants also 401 is "paid" the likely reading, and it is still a guess.

`deps` is the registry's `dependencies` array and it under-reports: `loader` declares none and
imports `motion/react`. Read the source, not the field. `motion` is Framer Motion; on the target
it is never installed, because a port becomes CSS.

## Fits

Two were listed. **One survives: `text-generate-effect`, and it has shipped.** `stateful-button`
was struck on 2026-09-20 after the flow was driven rather than argued about — the absence it was
filed against does not exist. Both entries are kept below, because the reason a Fit fails is
worth as much as the reason one passes.

**stateful-button — WITHDRAWN 2026-09-20. Do not port it.** The clause below said "there is no
`aria-busy`, no pending class and no disabled-while-sending state anywhere in `js/ui/` or
`app.css`". That was wrong on both halves. `setBusy()` at `circle/js/ui/components.js:201` sets
`btn.disabled`, writes `aria-busy`, and lays the word over the button, `app.css:140` draws
`[disabled]` at `opacity: .45`, and both of the screens this entry named already call it —
`catalog.js:932` on the `/book/<id>` ask and `member.js:579` on the `/pay` contribution,
synchronously, before the first `await`, so there is no window in which a second tap can land.
Driven in the harness at 390 on the preview backend with the write slowed to 900ms, sampling the
docked action from the tap: `/book/stay_voco` goes `[0ms, enabled, opacity 1]` →
`[3ms, disabled, aria-busy=true, "Sending…", opacity 0.45]`, held at 40, 200, 500 and 860ms →
`[1300ms, route now #/requests/<id>]`; `/pay` the same at 3ms, held to 700ms, gone to `#/home` by
1599ms. Picture: `scratchpad/skills-run/fix-catalog.md/pay-slow-during.png`, the docked action
greyed and reading "Sending…". ("The Ask button on Home" was never a submit either —
`member.js:71` is an `<a class="btn" href="#/book/…">`, a link to the ask form, with nothing to be
pending about; rendered, it is `<a href="#/book/stay_voco">Ask for these dates</a>`.) The
component's own payload is also homeless here: its tick "holds about two seconds" after the write,
and both of these flows navigate away on success (`/requests/<id>`, `/home`) and say it in a
toast, so a tick would be painted onto a screen that is already gone.

An earlier draft of this withdrawal closed by claiming the looking had turned up a live defect in
`setBusy` — that it swaps `textContent` and flattens the button's markup. **That claim was itself
false and is struck.** `setBusy` has not swapped `textContent` since before this entry was
written: it gathers the resting children once into a `display: contents` sleeve
(`components.js:226`) and lays a `.busy-say` over them, so the same nodes stay in the page, live.
Measured in the same run: the `<b class="num">` inside the `/book` action is still there on every
frame of the busy window, and the send mark on `/pay` still counts one `<svg>` throughout. Filing
a defect that had already been repaired is the same failure that sank the entry above, and it is
recorded here rather than quietly deleted for the same reason the entry is kept.

**text-generate-effect** — free, `motion`. **Shipped** on the signed-out landing hero
(`app.css:534`, `@keyframes enter-to-rest`, applied at `app.css:535` to
`.hero-cover .on .wrap > *`); see `references/worked-example.md`. *Screen as
filed:* `/home`, the serif masthead ("2 nights at *voco* Surfside Aruba") — **not recommended,
and the Fit should be treated as spent by the landing port.** `/home` is the ledger: the line
under that masthead carries the member's available points and the filled action sits directly
beneath it, so a stagger there stages the figures a member opened the app to read. And it would
not be an entrance felt once — `app.js:140` is `if (reason !== 'render') render();` inside
`store.subscribe`, so the current view is re-rendered on every store change that is not itself a
render, not only on navigation, and the masthead would replay its fade whenever anything in the
store moved while the member sat on Home. That is question 4 answered in the wrong direction.
*Replaces:* the instant paint of that title. Words fade up
staggered, which is the one gesture the Edition already names ("motion is a fade"). Port with
`filter` off: **opacity only, no blur** — the blur is the tell that marks this as a template
effect, and it also animates a filter, which the house rule against animating anything but
transform and opacity forbids. Under `prefers-reduced-motion` the words must render at full
opacity on the first frame, not fade faster. Never on body copy, never on a figure, never on more
than one element per screen. This one is the closest thing here to a borderline call: if it ever
reads as a chatbot typing rather than a line setting itself, it is wrong and should come out.

## Only if asked

Mechanically sound, palette-neutral once ported, and solving a problem the app has not had.

| slug | free | deps | why it is only decoration here |
| --- | --- | --- | --- |
| infinite-moving-cards | 200 | none | Duplicate the list, translate -50%, loop. Could carry postcards on `/circle`. A bulletin does not have a ticker. |
| loader | 200 | none declared (`motion`) | Three dots, staggered translateY. Shape for a spinner the app does not yet have. Strip the gradient fill for `--ink-3`. |
| pointer-highlight | 200 | none | Despite the name it does not follow a pointer: it draws a corner-ticked rectangle round a phrase on mount. Close to a printed annotation, but the Edition already has one emphasis device and a second competes with the italic word. |
| flip-words | 200 | motion | Swaps one word in a line. The only variable word here is the italic accent, and animating it points at the machinery. |
| typewriter-effect | 200 | motion | Same family, slower. A serif line that types reads like a chat window. |
| card-stack | 200 | motion | A shuffling stack of quotes. Could hold postcards. Nothing asked for it. |
| compare | 200 | @tabler/icons-react, motion | Before/after slider, drags by touch so it survives the phone. No screen has a before and an after. |
| images-slider | 200 | motion | Full-bleed carousel. The app leads with one photograph on purpose. |
| parallax-scroll | 200 | motion | Three photo columns at different speeds. Needs a photo wall that does not exist. |
| animated-modal | 200 | motion | If a sheet ever wants a spring, this is the maths. Transform and opacity only; keep the `--wrap` cap or it spans a laptop. |
| placeholders-and-vanish-input | 200 | motion | The cycling placeholder is harmless if `/stays` ever gets a search field. The vanish is canvas particles — leave that half. |
| multi-step-loader | 200 | @tabler/icons-react, motion | A checklist that ticks through steps. Would suit a long wait. Nothing here waits that long. |
| container-text-flip | 200 | none | One word swaps inside a box that resizes to fit it. Same family as flip-words and the same objection — the only variable word here is the italic accent — but the resizing box is a genuinely nice piece of maths if a figure ever has to change in place. Needs a module: it measures the word and steps on a timer. |
| carousel | 200 | @tabler/icons-react | An arrow-and-drag slider that writes its position to a custom property. The `.horizon` strip already scrolls by thumb and does it natively; this would only matter if a row ever needed arrows. |

## Wrong for this app

Fifty-one. Grouped by the reason, because the reason is the reusable part.

**Glow, gradient border or neon — the exact register Victor calls AI slop.** Every one of these
needs a colour that is not in `tokens.css`, and the ones that do not still put a light source on
a page that is printed paper.
`background-gradient` (motion), `hover-border-gradient` (motion), `moving-border` (motion),
`glowing-effect` (lucide-react), `card-spotlight` (motion), `spotlight` (none), `spotlight-new`
(motion — the same ellipse rebuilt from three `hsla(210, 100%, …)` radial gradients that drift
sideways forever), `lamp` (motion), `hero-highlight` (mini-svg-data-uri, motion), `colourful-text`
(none), `tracing-beam` (motion), `timeline` (motion — the only thing it adds over plain layout is
a purple-to-blue beam), `glare-card` (none), `tailwindcss-buttons` (@tabler/icons-react — a
gallery of twenty button treatments, most of them a gradient ring or a neon border; this app has
one filled action and one ruled link on purpose, and a second button style is a decision, not an
import). All free; all wrong.

**Aurora or particle field behind the content.** A full-screen background effect competes with
the one photograph the app already leads with, and on `/stays` the photograph is the evidence
that the week is real.
`aurora-background` (none), `background-beams` (motion), `background-beams-with-collision`
(motion), `background-lines` (motion), `background-boxes` (mini-svg-data-uri, motion),
`shooting-stars` (none), `vortex` (simplex-noise, motion), `wavy-background` (simplex-noise — a
canvas loop, so there is no CSS underneath to take at all), `sparkles` (@tsparticles/react,
@tsparticles/engine, @tsparticles/slim, motion), `canvas-reveal-effect` (three,
@react-three/fiber). The last three also lose on the Content-Security-Policy: `script-src` allows
`'self'` and jsdelivr only, and neither tsparticles nor three.js belongs in a no-build app that
ships as ES modules.

**meteors** (none) sits in that group but earns its own paragraph, because the group's reason
does not fit it and someone will notice. It is the only one here that needs no cursor and touches
no photograph, so it will look portable — and the one dark surface it suits, the tier-200
`.card-obj` on `/card`, is not a background at all but a drawn object whose `--etch` gold every
baked colour in the component maps onto cleanly. It fails on two other things instead. It is
`infinite`: a member opens `/card` to hold a QR code up at a hotel desk, and the surface under
the thing they came for would be permanently in motion. And `.card-obj`'s own comment in
`app.css` settled this before Aceternity was ever mentioned — *"a simulated highlight is a
lighting effect, and this house has none."* Rendered on the card it is worse than unwanted: the
tails are the same gold, the same 1px weight and close to the same angle as the `.contours`
hairlines already on it, so they read as the card's engraving coming loose rather than as
meteors. Mechanically it is not free either — twenty spans minted from a count, each with a
`Math.random()` delay, duration and offset, which means markup from `pieces.js` and a fixed
scatter, not four lines of CSS.

**Needs a mouse, so it is dead on the only device that matters.** A hover-only reaction is no
reaction — this is already written into circle-feel and it disqualifies the largest group here.
`3d-card` (motion), `3d-pin` (motion), `direction-aware-hover` (motion), `wobble-card` (motion),
`following-pointer` (motion), `animated-tooltip` (motion), `text-hover-effect` (motion),
`text-reveal-card` (motion), `svg-mask-effect` (motion), `card-hover-effect` (motion),
`floating-dock` (@tabler/icons-react, motion — a dock that magnifies under the cursor; the app
has a tab bar), `evervault-card` (motion), `focus-cards` (none), `file-upload`
(@tabler/icons-react, react-dropzone, motion — drag-and-drop onto a phone), `lens` (motion — a
magnifier that follows `clientX`/`clientY` over an image), `sidebar` (@tabler/icons-react,
motion — a rail that expands from 60px to 300px `onMouseEnter`; the app has a tab bar and no
desktop), `navbar-menu` (motion — a dropdown that opens `onMouseEnter` and closes
`onMouseLeave`, so on a phone it never opens), `link-preview` (@radix-ui/react-hover-card, qss,
motion — and it fetches a screenshot of the linked page from `api.microlink.io`, a third-party
request this app makes nowhere and would not start making for a hover card).

**Prints a word over a photograph, or asserts something the app has not established.**
`focus-cards` again (the title paints onto the image on hover), `evervault-card` again (a field
of random hex characters that means nothing), `sticky-scroll-reveal` (motion — swaps the page
background per section from a baked palette), `animated-testimonials` (@tabler/icons-react,
motion — rotates head-and-shoulders photographs on a 5s timer with the quote typing in beneath;
every photograph in this app is sourced and dated, and there is nobody to quote).

**Landing-page set pieces.** Built to fill a viewport above the fold for a stranger.
`hero-parallax` (motion), `container-scroll-animation` (motion), `layout-grid` (motion),
`google-gemini-effect` (motion), `apple-cards-carousel` (@tabler/icons-react, motion — a
full-bleed card rail that drives its own scroll container and opens a modal per card),
`resizable-navbar` (none declared — a header that shrinks and blurs as you scroll; this app's
chrome does not move, and a header that resizes while a ledger scrolls under it is motion the
figures did not ask for).

## What the phone changes

Three things decide most of the calls above before taste enters.

**There is no cursor.** Eighteen of these components have their entire effect on `:hover` or on
`mousemove`. On the device this club uses, they do nothing at all — not a degraded version, the
element simply sits there. If a port is attempted anyway, the hover rule goes inside
`@media (hover: hover)` and `:active` gets a state of its own, or the tap produces no visual
change and the screen feels broken rather than plain.

**Scroll-driven is still motion.** `tracing-beam`, `sticky-scroll-reveal`, `parallax-scroll`,
`timeline` and `text-generate-effect` all animate as the reader scrolls, and a scroll animation
is exactly the kind that gets forgotten under `prefers-reduced-motion`. Every one of them needs
the reduced-motion branch to render the **final** state on the first frame — not a faster
animation, not a shorter distance. A reduced-motion guard of its own is the price of any port
that moves, and `app.css` has a rule for every one that ships.

**The background is already spoken for.** Every screen worth looking at leads with one
photograph, sourced and credited, and that picture is the app's main claim that a week is real.
A beam field or an aurora behind it does not decorate the photograph, it argues with it. If a
background effect ever seems necessary, the question to ask first is what the photograph is
failing to do. Where there is no photograph — the member card, the one drawn object in the app —
the argument is different and is spelled out under `meteors` above: the surface has a texture of
its own, and a borrowed effect that shares its colour and weight corrupts it rather than layering
over it.

And the standing constraints a port inherits whatever bucket it came from: colours from
`tokens.css` only — no Tailwind palette values, no new hex; `--r-pill` untouched; 44px minimum in
both dimensions; no horizontal overflow at 390px; **no width breakpoint** — `app.css` has exactly
one `min-width` query, the laptop frame, and it holds no layout at all, only a background and an
outline; transform and opacity only. The licence permits the port (unlimited end products,
modification, derivative works; no redistributing the source files and no reselling), and it does
not demand credit — but this codebase records where every photograph and every price came from,
so a ported effect records its slug and the date it was fetched in a comment above the CSS, for
the same reason. If it needs a module, the same record goes at the top of the module too.
