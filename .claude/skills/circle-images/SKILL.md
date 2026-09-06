---
name: circle-images
description: Render high-quality images for the Hunto Circle website — hero art, social/OG cards, stay illustrations, rank crests, badge marks, membership card art — from HTML/SVG through headless Chromium at retina scale, using the site's own design tokens so the output matches the app instead of sitting next to it. Use this whenever the task involves making, redrawing, resizing or exporting any image, illustration, icon, badge, crest, avatar, cover, banner, thumbnail or social preview for this site, or when someone says the artwork looks generic, wants a picture for a new stay or trip, or needs an asset at a bigger size. Also use it when adding anything to circle/assets/, when a new badge or rank needs a mark drawn, and when a PNG has to be produced from SVG or HTML.
---

# Images for the Circle

Every picture on this site is drawn, not photographed — because the club owns forty seats, not a
photo library, and a stock beach shot is exactly the "AI website" look Victor complained about.
Drawn art is also honest: it never implies the Circle has a photograph of a room it has not
booked.

The pipeline is HTML/SVG → headless Chromium → PNG at whatever pixel density you ask for. That
gives you real type rendering, real gradients, real layout, and files that are sharp on a phone.

## Before you draw anything

Read `circle/css/tokens.css` and use the variables from it. The whole reason the site hangs
together is that one palette, and art that invents its own colours is the thing that looks
bolted on. If you need a colour that is not there, that is a signal to reconsider, not to add a
hex code.

Then look at `circle/js/ui/art.js`. It already draws the sky palettes, the sea, the horizon and
the six property scenes. If what you need is a variation on a place, extend `sceneFor()` there
instead of making a one-off file — art that lives in code stays correct when the catalog changes.
Make a standalone image only when the thing is genuinely static: a social card, a crest, a mark.

## Rendering

`scripts/render.mjs` does the work. It takes an HTML or SVG file (or a string on stdin) and
writes a PNG.

```sh
node .claude/skills/circle-images/scripts/render.mjs \
  --in /tmp/card.html --out circle/assets/og-image.png \
  --width 1200 --height 630 --scale 2
```

| flag | what it does |
| --- | --- |
| `--in` | HTML or SVG file. Omit to read from stdin. |
| `--out` | where the PNG goes. Directories are created. |
| `--width` `--height` | the CSS-pixel box. The PNG comes out `width × scale` wide. |
| `--scale` | device pixel ratio. 2 for anything a phone shows, 3 for a crest that gets scaled up. |
| `--transparent` | no background paint — for marks and icons that sit on the page. |
| `--selector` | clip to one element instead of the whole viewport. |
| `--dark` | render with `data-theme="dark"` on the root, for a second copy. |

Two things it does for you that matter: it waits for web fonts to settle before shooting, so
type never renders in a fallback face, and it forces `prefers-reduced-motion` so nothing is
caught mid-animation.

## What each kind of asset needs

**Social / OG cards** — 1200×630 at scale 2. These are the one place the club is seen by people
who are not in it, so they carry the name, the seat count, and nothing else. No prices, no member
names, no coverage figure: that is all inside the Circle.

**Rank crests** (Seated, Steady, Anchor, Old Guard, Pillar) — square, transparent, scale 3, and
drawn as a family: the same frame with a mark inside that gets one element more at each rung.
The point of a ladder is that you can see where you are on it at a glance, so they must read as
a set, not five unrelated icons. Keep them legible at 28px, which is the size they actually get
used at next to a name.

**Badge marks** — transparent, scale 3, 96px box, single-weight line art. There are more than a
dozen and they sit in a grid, so a heavy one ruins the row. Draw the noun in the badge's name;
do not draw a trophy or a star for everything.

**Stay and trip illustrations** — prefer `art.js`. If you must make a standalone, match its sky
palettes and its horizon line exactly or the card will look wrong beside the others.

**Hero art** — the only place a wide, atmospheric image belongs. Ship a 16:9 and a 4:5 so the
phone crop is not an accident, and keep the file under ~250KB or the first paint suffers.

## Drawing well here

The house style is quiet: flat shapes, few colours, one clear silhouette, generous space. It
reads as expensive because it is restrained, and restraint is also what stops a drawing from
looking machine-made. Some things worth keeping in mind:

- One idea per image. A crest that is a shield *and* a wave *and* a number is three ideas and
  reads as none.
- Silhouette first. If it does not work as a solid black shape at 28px, detail will not save it.
- Let the palette do the work. Two tones and a background beat five tones.
- Aruba is the address, not the subject. A drawing does not need a palm tree in it to be from
  here, and Victor has said plainly that the site leans too hard on the island.

## Checking the result

Look at what you made — `Read` the PNG. It renders in the conversation and you will immediately
see a clipped edge, a fallback font or a muddy colour that you would never catch from the file
size. Then check it at the size it is really used: a crest that is going next to a name should be
looked at small, not at 300px.

For anything that goes into the app, also confirm it survives dark mode. The site paints its own
background per theme, so a mark with a baked-in white halo looks broken for half the members.

## If photographs are ever wanted

There is no image-generation API wired up here, and inventing photorealistic pictures of hotel
rooms the club has not stayed in would be a lie told to prospective members. If Victor does want
generated photography, it needs an API key on his side, and the honest place for such an image
is the hero — never a stay card, where a member would reasonably read it as the actual room.
