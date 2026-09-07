---
name: real-rooms
description: Get REAL room information and REAL photographs from a hotel's own website into the Hunto Circle catalog — room names, sizes, occupancy, bed configuration and pictures, each recorded with the URL it came from and the date it was fetched. Use this skill whenever anyone mentions adding or updating a property or a room in the catalog, says the pictures look fake, generic, drawn, AI-made or "ghost", asks where a room photo or a room size came from, wants to replace an illustration with a real photograph, doubts whether a room actually exists, asks to check what a hotel really offers, or wants scraped or sourced hotel data of any kind. Also use it before publishing any room a member could book, so nothing on the board is invented.
---

# Real rooms, real pictures

The Hunto catalog draws every place as an SVG illustration and carries eleven room types whose
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

**3. Read what comes back before trusting it.** The script marks each room `official` (from the
property's schema.org data — their own machine-readable claim) or `page-text` (read off the
page's headings, which is weaker). Both are real; the difference is how sure you can be. If
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

The catalog shape lives in `circle/js/data/rooms.js`. Map like this:

| fetched | catalog | if missing |
|---|---|---|
| `name` | `name` | skip the room entirely |
| `sqft` / `sqm` | `sqft` / `sqm` | leave `null` — the app prints "not published" |
| `sleeps` | `sleeps` | leave `null` |
| `bedrooms` | `bedrooms` | leave `null` |
| `beds` | `beds` | leave `null` |
| `source` | `source` | `official` or `page-text`, never `inferred` |

`rateFactor` is the Circle's own commercial judgement — what this room costs relative to the
property's headline room. It is not on the hotel's page and must not be invented from the size.
Leave it out and let Victor set it.

Full field notes and worked examples: `references/catalog-shape.md`.

## When you find nothing

Say so plainly and stop. "Their site is built in the browser and the render was blocked, so I
have no rooms for this one" is a useful answer. A room list you assembled from a general
impression of what a beach resort in Aruba probably offers is the exact thing this skill exists
to prevent, and it will end up in front of somebody deciding where to spend $2,000.
