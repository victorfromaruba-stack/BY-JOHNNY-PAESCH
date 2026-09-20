# The Aceternity catalogue, judged against the Edition

This library was built for one job: a dark, full-bleed landing page that has three seconds to
impress a stranger who has never heard of the product. Glow, aurora, beams, a card that tilts
under the cursor — every one of those is a device for holding attention that has not been earned
yet. The Circle has the opposite problem. Forty people who already know each other read it every
week to find out what a week costs and whether Victor booked it. Attention is not the scarce
thing; trust in the figures is. So most of what follows is not merely unnecessary here, it works
against the app, and the honest answer to "can we add this one" is usually no. Two components
earn a place. Twelve would work if Victor points at them. Thirty-six are wrong for this app, and
the section at the end says what the phone alone rules out.

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

Two. Both replace an absence, not a plain thing with a fancier thing.

**stateful-button** — free, no declared deps (source uses `motion`). *Screen:* the one filled
action, `.btn.block` in the act bar on `/stays/<id>` and `/trips/<id>`, and the Ask button on
Home. *Replaces:* nothing, which is the point — there is no `aria-busy`, no pending class and no
disabled-while-sending state anywhere in `js/ui/` or `app.css`. A member on Aruban mobile data
taps "Ask for these dates", the request goes, and the button looks exactly as it did. Port the
state machine only: idle, a mark that turns while the write is in flight, a tick that holds about
two seconds. Ink on `--on-ink`, the tick `--good`, the 44px target unchanged because the mark
replaces the icon rather than being added beside it. Discard the gradient ring, the `layoutId`
and the spring — the width change is a transition, not a layout animation.

**text-generate-effect** — free, `motion`. *Screen:* `/home`, the serif masthead
("2 nights at *voco* Surfside Aruba"). *Replaces:* the instant paint of that title. Words fade up
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

## Wrong for this app

Thirty-six. Grouped by the reason, because the reason is the reusable part.

**Glow, gradient border or neon — the exact register Victor calls AI slop.** Every one of these
needs a colour that is not in `tokens.css`, and the ones that do not still put a light source on
a page that is printed paper.
`background-gradient` (motion), `hover-border-gradient` (motion), `moving-border` (motion),
`glowing-effect` (lucide-react), `card-spotlight` (motion), `spotlight` (none), `lamp` (motion),
`hero-highlight` (mini-svg-data-uri, motion), `colourful-text` (none), `tracing-beam` (motion),
`timeline` (motion — the only thing it adds over plain layout is a purple-to-blue beam),
`glare-card` (none). All free; all wrong.

**Aurora or particle field behind the content.** A full-screen background effect competes with
the one photograph the app already leads with, and on `/stays` the photograph is the evidence
that the week is real.
`aurora-background` (none), `background-beams` (motion), `background-beams-with-collision`
(motion), `background-lines` (motion), `background-boxes` (mini-svg-data-uri, motion), `meteors`
(none), `shooting-stars` (none), `vortex` (motion), `sparkles` (@tsparticles/react,
@tsparticles/engine, @tsparticles/slim, motion), `canvas-reveal-effect` (three,
@react-three/fiber). The last two also lose on the Content-Security-Policy: `script-src` allows
`'self'` and jsdelivr only, and neither tsparticles nor three.js belongs in a no-build app that
ships as ES modules.

**Needs a mouse, so it is dead on the only device that matters.** A hover-only reaction is no
reaction — this is already written into circle-feel and it disqualifies the largest group here.
`3d-card` (motion), `3d-pin` (motion), `direction-aware-hover` (motion), `wobble-card` (motion),
`following-pointer` (motion), `animated-tooltip` (motion), `text-hover-effect` (motion),
`text-reveal-card` (motion), `svg-mask-effect` (motion), `card-hover-effect` (motion),
`floating-dock` (@tabler/icons-react, motion — a dock that magnifies under the cursor; the app
has a tab bar), `evervault-card` (motion), `focus-cards` (none), `file-upload`
(@tabler/icons-react, react-dropzone, motion — drag-and-drop onto a phone).

**Prints a word over a photograph, or asserts something the app has not established.**
`focus-cards` again (the title paints onto the image on hover), `evervault-card` again (a field
of random hex characters that means nothing), `sticky-scroll-reveal` (motion — swaps the page
background per section from a baked palette).

**Landing-page set pieces.** Built to fill a viewport above the fold for a stranger.
`hero-parallax` (motion), `container-scroll-animation` (motion), `layout-grid` (motion),
`google-gemini-effect` (motion).

## What the phone changes

Three things decide most of the calls above before taste enters.

**There is no cursor.** Fourteen of these components have their entire effect on `:hover` or on
`mousemove`. On the device this club uses, they do nothing at all — not a degraded version, the
element simply sits there. If a port is attempted anyway, the hover rule goes inside
`@media (hover: hover)` and `:active` gets a state of its own, or the tap produces no visual
change and the screen feels broken rather than plain.

**Scroll-driven is still motion.** `tracing-beam`, `sticky-scroll-reveal`, `parallax-scroll`,
`timeline` and `text-generate-effect` all animate as the reader scrolls, and a scroll animation
is exactly the kind that gets forgotten under `prefers-reduced-motion`. Every one of them needs
the reduced-motion branch to render the **final** state on the first frame — not a faster
animation, not a shorter distance. `app.css` carries eight reduced-motion rules today and a
ninth is the price of any port that moves.

**The background is already spoken for.** Every screen worth looking at leads with one
photograph, sourced and credited, and that picture is the app's main claim that a week is real.
A beam field, an aurora or a meteor shower behind it does not decorate the photograph, it argues
with it. If a background effect ever seems necessary, the question to ask first is what the
photograph is failing to do.

And the standing constraints a port inherits whatever bucket it came from: colours from
`tokens.css` only — no Tailwind palette values, no new hex; `--r-pill` untouched; 44px minimum in
both dimensions; no horizontal overflow at 390px; **no width breakpoint**, because the eleven
`@media` rules in `app.css` contain not one and the phone is the only layout; transform and
opacity only. The licence permits the port (unlimited end products, modification, derivative
works; no redistributing the source files and no reselling), and it does not demand credit — but
this codebase records where every photograph and every price came from, so a ported effect
records its slug and the date it was fetched in a comment above the CSS, for the same reason.
