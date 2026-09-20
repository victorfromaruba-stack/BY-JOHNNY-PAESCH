---
name: real-rooms
description: Get REAL room information and REAL photographs from a hotel's own website into the Inner Hotel Circle catalog — room names, sizes, occupancy, bed configuration and pictures, each recorded with the URL it came from and the date it was fetched. Use this skill whenever anyone mentions adding or updating a property or a room in the catalog, says the pictures look fake, generic, drawn, AI-made or "ghost", asks where a room photo or a room size came from, wants to replace an illustration with a real photograph, doubts whether a room actually exists, asks to check what a hotel really offers, or wants scraped or sourced hotel data of any kind. Also use it before publishing any room a member could book, so nothing on the board is invented.
---

# Real rooms, real pictures

The catalog draws every place as an SVG illustration and carries eleven room types whose
sizes nobody published — they were estimated. Victor's objection is exact: *"I don't want fantasy
rooms only rooms that are actual there… it's all ghost fantasy pictures."*

A member is choosing a room they will actually sleep in. A drawn picture and an estimated size
are worse than a blank, because a blank is honest and a plausible number is not checkable.

**The rule everything here follows: never invent.** A size nobody publishes stays `null`. A room
nobody lists does not go on the board. If that leaves a gap, the gap is the truth and the app is
built to say so.

## The tool

`scripts/fetch-rooms.mjs` does the fetching. It checks robots.txt properly (longest-match, named
user-agent before `*`), stops if the answer is no, and records provenance for everything it
returns.

```bash
node scripts/fetch-rooms.mjs --check   <url>              # robots verdict only, fetches nothing
node scripts/fetch-rooms.mjs --find    <homepage>         # which page holds their rooms
node scripts/fetch-rooms.mjs <rooms-url> --out DIR --images --max-images 12
```

Exit codes: `0` fine · `2` robots.txt says no · `3` fetch failed · `4` nothing extractable.

## How to work

**1. Find the rooms page — don't guess it.** Paths are never guessable (`/accommodations/`,
`/stay-eagle-beach-aruba/aruba-beachfront-hotel-room`), and a guess costs a 404 and a retry.
`--find` reads the property's own navigation and ranks the candidates. Take the top one, and
check the URL you pass matches the one it printed — a truncated copy-paste is the likeliest
failure in this whole workflow.

**2. Check robots first when you are unsure.** The main command checks anyway, but `--check` is
free and tells you before you plan around a page you may not use.

**If robots.txt says no, that is the answer.** Do not route around it, do not switch user-agent
to something that matches a different group, do not fetch the page "just to look". The Circle
books real rooms from these properties and Victor's name is on the booking; the cost of being
the client who scraped a site that asked them not to is not worth a room description. Ask the
property for a media kit instead, or link out to their page and show no photo.

**A 403 is also a no, even though the script says `allowed`.** When robots.txt itself returns
403, or the page does, the standard says an unreachable robots.txt leaves the site unrestricted
and the verdict comes back `allowed: true` with `why` naming the 403 — but a site answering a
plain scripted request with 403 is telling you it does not serve scripts, in the only way it
has. Read `why`, not just `allowed`. Every big chain does this: Marriott and Hilton 403 the
page, Hyatt, IHG and Radisson 403 robots.txt. Take the no there too. Changing the user-agent,
or reaching for a proxy or a bot-management workaround, would be exactly the thing the rule
above exists to prevent, and it would be taking copyrighted photographs on top of it.

**3. Read what comes back before trusting it.** The script marks each room `official` (from the
property's schema.org data — their own machine-readable claim) or `page-text` (read off the
page's headings, which is weaker). Both are real; the difference is how sure you can be — and
there is a third tier, `page-image`, that the script never writes; see *The three source tiers*
below before you add one by hand. If
`rooms` is empty, the page is probably built in the browser — the script renders it with
Chromium automatically. If the render fails too, say so; do not fall back to typing in numbers.

**4. Keep provenance attached.** `rooms.json` carries `url` and `fetchedAt`; `images.json`
carries the source URL, the alt text and the fetch date per file. Never move an image into
`circle/assets/` without carrying its record across. An undated photograph of a room that has
since been refurbished is how a member ends up in a room that does not look like the picture.

## The rights position, honestly

Hotel photographs are the hotel's copyright. Reachable is not licensed. The script records this
on every result rather than staying quiet about it, because whoever publishes the picture should
be deciding knowingly.

For a private members' club showing a member the room being booked *for them*, this is ordinary
use — the same picture the booking confirmation would carry. A public marketing page is a
different question. When it matters, ask the property for a media kit; hotels give them out
readily to people sending them bookings, and then the position is documented.

Prefer, in this order: the property's own media kit → the property's own site → an aggregator.
Never take a photo from another travel club or a competitor's marketing.

## Getting it into the catalog

The catalog shape lives in **`circle/js/data/places.js`** — one `PLACES[catalogId]` record per
property, keyed by the bundled catalog id (`stay_divi`, `stay_surfclub`); resolve a live stay with
`seedIdOf()` before looking it up. There is no `circle/js/data/rooms.js`; `circle/js/views/rooms.js`
is the view that reads this file, not the data.

**That file is generated, not hand-kept.** Its own header says it is built by
`scratchpad/build-places.py` from the fetch output. That script is *not* in the repository — the
scratchpad is a working directory, not a tracked one — so before you edit `places.js` by hand,
look for the script and regenerate if you have it. If you do hand-edit, keep the shape below
exactly, keep the header's claim true (every fact traceable to a recorded source), and say in the
commit that you edited the generated file directly.

A record holds four lists:

- **`rooms[]`** — the rooms the property itself lists. 7 of the 14 places have one.
- **`units[]`** — what owners actually hold there, from VakayMood, for the resorts whose own site
  refuses a scripted read. 3 places have only this. `roomsOf()` derives a room list from it when
  `rooms[]` is empty (`circle/js/views/rooms.js:60`); it prints spans, not picked numbers. Never
  hand-write a `rooms[]` entry for one of these to fill the gap — that is inventing.
- **`photos[]`** — `file`, `thumb`, `room` (the catalog room name it shows, matched by `normName`),
  `alt` (the property's own), `kind` (`room`, `inside`, `plan`, `property`), `page`, `seenOn`.
- **`sources[]`** — `kind` (`site` or `vakaymood`), `label`, `url`, `seenOn`. Every fact in the
  record has to be answerable from one of these.

Map a fetched room like this:

| fetched | `rooms[]` field | if missing |
|---|---|---|
| `name` | `name` — as the property writes it | skip the room entirely |
| — | `catalogName` — the Circle's name for the same room, so photographs match | `null` |
| `sqft` / `sqm` | `sqft` / `sqm` | leave `null` — the app prints "not published" |
| `sleeps` | `sleeps` | leave `null` |
| `bedrooms` | `bedrooms` | leave `null` |
| `beds` | `beds` | leave `null` |
| `view` | `view` | leave `null` |
| `description` | `description` — the property's own words, not a summary of them | `null` |
| `source` | `source` | `official`, `page-text` or `page-image`, never `inferred` |

### The three source tiers

Strongest first. All three are traceable; the difference is what the property actually committed to.

- **`official`** — out of the property's own schema.org data. Their machine-readable claim.
- **`page-text`** — read off the page's headings. Their words, less structured. 22 of the 24 rooms
  on file today.
- **`page-image`** — the room appears only in the property's own *pictures*: the name comes from
  the alt text or caption the property wrote under its own photograph. The fetch script never emits
  this (it writes `official` or `page-text` only); it is applied by hand when the property shows a
  room but does not list it. Two rooms use it, both at Divi: *Garden View King Room* (alt "Divi
  Aruba Gardenview King Room") and *Two Bedroom Suite* (alt "Two bedroom suite floor plan").

**A `page-image` room carries a name and photographs and nothing else.** Every figure —
`sqft`, `sqm`, `sleeps`, `bedrooms`, `beds` — stays `null`, because a picture publishes no
measurements. Both rooms on file honour this.

**Should the app mark it?** It does not today, and that is the right answer while the rule above
holds. `roomsOf()` drops `source` on the way to the view — the room objects it returns carry
`name`, `bits`, `description`, `photos` and nothing more (`circle/js/views/rooms.js:106`) — so a
`page-image` room renders exactly like a `page-text` one: the name, the property's own
photographs, an "Ask for this one" link, no figures — checked on the Divi page at 390.
Nothing is asserted that the property did not itself print under its own picture, so there is
nothing for a mark to warn about. The moment a `page-image` room carries a figure, that changes:
mark the tier in the view, or drop the figure. The second is usually right.

### Two different things called `source`

`places.js` is the bundled dossier and is not a database table. The `room_types` table in
`circle/supabase/schema.sql:428` has its own `source` column with a different vocabulary —
`official`, `aggregator`, `inferred` — and its own `rate_factor`. That is the Desk's bookable
room list, not this one, and no view reads it today. Do not carry a `page-image` value into it:
the CHECK constraint rejects it, and widening the constraint is a both-backends change
(`circle/js/core/store.js` and `circle/supabase/schema.sql` together).

`rateFactor` there is the Circle's own commercial judgement — what this room costs relative to the
property's headline room. It is not on the hotel's page and must not be invented from the size.
Leave it out and let Victor set it.

## When you find nothing

Say so plainly and stop. "Their site is built in the browser and the render was blocked, so I
have no rooms for this one" is a useful answer. A room list you assembled from a general
impression of what a beach resort in Aruba probably offers is the exact thing this skill exists
to prevent, and it will end up in front of somebody deciding where to spend $2,000.
