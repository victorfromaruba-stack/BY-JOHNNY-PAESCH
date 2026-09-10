# Hunto — the Inner Circle

A private travel club for a group of friends in Aruba. It is invitation only: every
Insider is someone Victor or Ian knows, there is no public sign-up, and the club is
capped at 40 seats.

Members contribute $100, $150 or $200 a month by bank transfer. The Banker confirms the
money has arrived; only then are points minted. The club keeps 15% for running it, the
other 85% backs the points, and points pay for stays on the island and trips the Desk
organizes.

**Where we actually stay.** The catalog lists twenty-three places on Aruba, but four of them
are where the Circle keeps ending up, and they carry a *Where we stay* badge and sort first:
Marriott's Aruba Ocean Club and Marriott's Aruba Surf Club (the two Marriott Vacation Club
villa resorts on Palm Beach — villas with kitchens, rented as owner weeks, so seven nights
Saturday to Saturday), the Divi Aruba All Inclusive on Druif Beach (which buys the Tamarijn
next door as well), and the Renaissance Wind Creek in Oranjestad (whose beach is a
forty-acre private island reached by water taxi from the lobby). Planners can move the badge
from the Desk — it is a checkbox on every stay.

**The trips this cycle** go to three countries: the Dominican Republic (seven nights, two in
the Zona Colonial and five on the Samaná peninsula in whale season), Mexico (nine nights
across Mexico City and Oaxaca), and Japan (ten nights in Kyoto and Tokyo, which is honestly
fourteen days door to door — there is no same-day connection from Aruba). Nobody is shut out
of any of them; the level only changes how fast the points build.

**What a level is for.** No level shuts anyone out of anything: every Insider can ask for
every stay and every trip. What the level changes is how fast the points build — and that
is what decides, in practice, whether you are doing long weekends on the island or leaving
it with the group.

| | Watapana · $100 | Fofoti · $150 | Kibrahacha · $200 |
|---|---|---|---|
| Earns a month | ✦ 8,500 | ✦ 13,050 | ✦ 17,800 |
| 3 nights on Eagle Beach | 8 months | 6 months | 4 months |
| Your quarter of a Surf Club villa for a week | 6 months | 4 months | 3 months |
| A seat on the Samaná week | 15 months | 10 months | 8 months |
| Ten nights in Japan | 25 months | 17 months | 12 months |
| Open requests · booked ahead | 1 · 10 months | 2 · 12 months | 2 · 13 months |
| Guest passes · first look | 2 · — | 3 · 48h | 4 · 72h |

Short of something you want? Ask for it anyway — Victor prices it and you say yes when the
points are there — or close the gap with a cash top-up, or have the Circle chip in. Moving
between levels takes effect on your next contribution and changes nothing already held.

### How a booking happens

Nobody books anything themselves, and nothing is automatic. You **ask** — dates, guests, a
word for Victor — and see the indicative price before you send it. Victor **looks** at the
listing, writes down what he saw, and **prices** it, all-in, within your level's promise.
You **say yes** and your points are committed. Victor then **picks it up** — the app says
"Victor is booking it" only once he has, not the moment you accept — **books it himself, in
your name**, and writes down the hotel's confirmation. That is when the points burn and the
room is yours. The request page shows which of those six steps has happened and which is next;
the Desk sees the same requests in three lanes: to approve and price, to book, waiting on the
member.

## Signing in

The club runs on its own Supabase project now, so accounts are real: one email and one
password, working on your phone and Ian's and Vishnu's at the same time, against one shared
database. There is no persona picker any more and no way to look at someone else's account.

- **First time:** on the sign-in screen, put in the email Victor or Ian has for you and tap
  *Set it up*. If that address is on the members list you choose a password — there is a
  *make one up for me* button that generates sixteen characters from an alphabet with no
  look-alikes, so it can be read off a screen without a mistake. An email nobody invited
  gets nowhere.
- **Forgot it:** *I forgot my password* sends a reset link, good for an hour. It lands on a
  screen that sets a new one. Nobody, including Ian, can read your password back to you.
- **Nothing is stored in this repository.** The publishable key in `config.js` is designed
  to be public and row-level security does the guarding. The service-role key is never here.

If the server cannot be reached the app says so and stops. It no longer falls back to demo
data, because invented balances that look real are worse than an error message. Add
`?preview=1` to the URL to see the seeded preview deliberately.

### One step Victor has to do by hand

Supabase sends the confirmation and reset emails, and it will only send people back to a URL
on its allow-list. The default is `http://localhost:3000`, which would make every link in
those emails dead. There is no API for this, so it has to be set in the dashboard once:

**Authentication → URL Configuration**

- **Site URL:** `https://victorfromaruba-stack.github.io/BY-JOHNNY-PAESCH/circle/`
- **Redirect URLs:** add `https://victorfromaruba-stack.github.io/BY-JOHNNY-PAESCH/circle/**`

Until that is done, nobody can finish signing up. Everything else is already configured.

Two things worth knowing while you are in there:

- Supabase's built-in mail server is rate-limited to a handful of messages an hour and often
  lands in spam. Fine for three people setting up once; if the Circle grows past a dozen,
  put a real SMTP provider in **Authentication → Emails**.
- **Authentication → Policies** has a *Leaked password protection* switch that checks new
  passwords against HaveIBeenPwned. It is off. Turn it on — it costs nothing.

### Adding people

**Settings → Insiders → Add an Insider.** Name, email, level, and tick what they can do —
Insider, Banker, Desk, Voice, Deputy Banker, Admin. It writes the member row and copies a
message you can send them. They open the site, tap *Set it up* with that same email, choose
their own password, and the account links itself to the row. Nobody opens the table editor
and nobody writes SQL.

The same guards run in the browser and in the database, so both refuse the same things: a
name is required, a duplicate email is refused, a role that is not a real role is refused
rather than silently dropped, only an admin can add anyone, and the 40-seat cap holds.

Roles are `member`, `treasurer`, `deputy`, `planner`, `comms`, `admin`.

**In the SQL editor, do not call `admin_add_member`.** The editor connects as the database
owner rather than as a signed-in member, so `auth.uid()` is null, the function cannot tell
who you are, and it correctly refuses with *Only an admin can add a member*. The guard is
right; calling it from there is the mistake. In the editor you already hold the highest
privilege, so write the row:

```sql
insert into members (name, email, monthly_usd, roles, status, title, founding, card_code)
values
  ('Ian Hekman', 'ian@example.aw',    150, '{comms}'::member_role[],     'invited', 'Voice of the Circle',  true,
   upper(substr(md5(random()::text), 1, 6))),
  ('Vishnu',     'vishnu@example.aw', 150, '{treasurer}'::member_role[], 'invited', 'Banker of the Circle', true,
   upper(substr(md5(random()::text), 1, 6)))
on conflict do nothing;

select name, email, roles, status from members order by name;
```

Safe to run twice — `email` is unique, case-insensitively, so a second run adds nothing.
A misspelled role fails on the `member_role[]` cast rather than going in wrong.

## Where the deals come from — and what is honestly automatable

Victor asked for a system that logs into Interval, RedWeek, Iberostar and Airbnb and watches
for rooms. Most of that is not possible, and the parts that are possible are worth doing
properly. This is what the research found:

| Source | Can a robot watch it? | What the club does instead |
|---|---|---|
| **Interval International** | **No.** Membership terms clause (s) prohibits automated access and clause (k) restricts to personal, non-commercial use. Sharing a login is grounds for termination. No API exists. | Turn on **Getaway Alerts** in the Interval To Go app, and use **Ongoing Search** — Interval's own standing request, which is exactly "keep looking until it appears" and books it for you. Note it needs three resorts *or* three time periods, runs as an overnight batch, and auto-charges with 24 hours to cancel. |
| **RedWeek** | **No.** Terms of service carry an explicit anti-scraping clause; they publish an `llms.txt` saying the same. No API. | Turn on **Posting Alerts** — RedWeek emails you when a matching posting appears. Sanctioned, and it is the fastest legitimate signal there is. |
| **Marriott Vacation Club / Abound** | No API. | The owner-site **waitlist** emails you when inventory frees up. |
| **Airbnb** | **No.** No public API; the Partner API is closed to operators this size; scraping is forbidden and has been litigated. | Vrbo through the Expedia Rapid partner API is the nearest legitimate equivalent, and needs an application. |
| **Iberostar** | Employee and friends-and-family rates are a rate code, not a feed. | For a group, the **group desk** (10+ rooms) beats any published rate. Iberostar PRO is the agent channel; the affiliate feed is marketing content, not availability. |
| **Real hotel APIs** | **Yes.** LiteAPI (Nuitée) has genuine self-signup and live availability. Expedia Rapid, RateHawk and Hotelbeds are partner APIs behind an application. | Any of these can be polled on a schedule without breaking anyone's terms. |

### VakayMood — the one source that can genuinely be watched

After that table was written, Victor found [vakaymood.com/developers](https://vakaymood.com/developers),
and it changes the picture. It is a free, read-only, **unauthenticated** JSON API of live
timeshare rental availability, with `Access-Control-Allow-Origin: *`. So the member's own
browser calls it directly: no key, no server, nothing secret in this repository, and no
term of service broken. It is the one source in the whole plan that permits exactly what
Victor asked for.

And it carries the right inventory. A query for Aruba returns about 2,800 live listings
across fourteen resorts, including **Marriott's Aruba Surf Club** (roughly 1,700 of them),
**Marriott's Aruba Ocean Club** and the **Renaissance Wind Creek** — three of our four. The
Divi is all-inclusive rather than a timeshare, so owner weeks for it do not exist.

**Open right now** is the third section of **Deals** (`#/deals`; the old `#/live` address
redirects there) and the "Open right now at …" panel on every stay page VakayMood carries,
where each room row also says when an owner has that size open. It used to be a screen of its
own, ten tabs along, that nobody opened while Deals sat empty. It stays an extra, not a
destination, because the Circle's model is that **members never book anything themselves**.
They put points in, alone or pooled with others, and Victor books the room in their name.
That is the whole product, and a feed of clickable outside inventory would quietly route
members around the club and around the 15%. The copy calls it what it is — owner rentals on
VakayMood, never "Interval" and never "available".

So the outbound "go and book it" link is **planner-and-comms only**. A member sees the week,
sees what it costs in points, and gets one button: *Ask the Circle for it*. Verified by
role in the suite — a member's view contains zero links to the outside site, Victor's
contains one per card.

It shows live weeks priced in points at the club's own rate, filterable by resort, size,
price and dates, says plainly when a week comes in under our own published rate, and badges a
week "You asked for this" when it answers a watch the member set — matched on room size, never
guessed. The default view asks VakayMood once per catalog resort and merges: one island-wide
page filtered afterwards showed five of ours under a count of two thousand.

A phone in Aruba could not reach vakaymood.com at all, so the Circle keeps its own copy:
`.github/workflows/open-weeks.yml` runs `circle/scripts/open-weeks.mjs` every half hour and
publishes `data/open-weeks.json` with the site (no commit, no credential — a scheduled fetch of a
public API and a Pages deploy), and `pages.yml` takes a fresh copy on every code deploy. When the
live feed does not answer, the page reads the copy from its own address and says when it was
taken. It is never presented as live.

Two things it is careful about, both learned by getting them wrong first:

- **It compares like with like.** Each property's catalog rate is modelled on one room — a
  two-bedroom at the Surf Club, a one-bedroom at the Ocean Club. Comparing a live *studio*
  against that invented a saving that was really just a smaller room; the first build
  claimed six bargains out of six. It now matches on bedroom count and takes the cheapest
  of our rooms at that size, so a reported saving is understated rather than flattering.
  Same data, same screen: one genuine bargain out of six.
- **Several owners list the identical week at the identical price.** They are distinct
  listings, but six identical cards are noise, so they collapse into one that says how many
  owners have it.

Two corrections to their published docs, found by calling it:

- the `resort` filter needs the **full slug** (`marriotts-aruba-surf-club-palm-beach-RR17209859`).
  The RR code alone returns zero results, though the docs say it is accepted.
- `limit` caps at **100**; 101 is rejected.

Rate limit is 60 requests a minute per IP, and because each member's browser makes its own
call that budget is per person rather than shared. Responses are cached in memory for the
same 60 seconds their CDN caches them, so moving between tabs costs nothing. If the feed is
slow or down the section says so and the rest of the app is untouched — it is someone else's
server and it is treated that way.

`connect-src` in the page's Content Security Policy was widened by exactly one origin,
`https://vakaymood.com`, to allow it.

So the design is: **the sites' own alerts do the watching, the Desk does the booking, and
the club turns both into something every member sees at once.**

The point of Interval and RedWeek was never automation for its own sake — it is that Victor
and Ian are the ones who go and book, and they need to know the moment something appears.

1. Victor and Ian switch on Getaway Alerts, RedWeek Posting Alerts and the MVC waitlist.
2. Those emails forward to a club address. A free Cloudflare Email Worker parses each one and
   POSTs it to `supabase/functions/ingest-deal`, which matches the property against the
   catalog and puts the deal on the board.
3. **The watch list** does the rest. A member says "a one-bedroom at the Ocean Club, some
   week in March, not more than 220,000 points". When a deal arrives it is matched against
   every open watch, and the people who asked for exactly that get it on their home screen
   and a badge in the navigation — in the same minute the email landed.
4. Anything the Desk finds by hand is **four fields and one tap**, and the posting screen
   tells Victor who is about to hear about it before he posts.

What the app does *not* do is pretend. It never asks for anyone's Interval or RedWeek
password, and there is no scraper in this repository.

**Deploying the ingest function**

```
supabase functions deploy ingest-deal --no-verify-jwt
supabase secrets set INGEST_SECRET="$(openssl rand -hex 32)" DEAL_POSTER_MEMBER_ID="<victor's members.id>"
```

The email worker POSTs JSON — `{property, roomType, from, to, points | usd, source, sourceUrl, note}`
— with an `x-ingest-secret` header. Property names are matched against the catalog, so
"Marriott's Aruba Surf Club" in an email finds the right row.

## The rooms

Every property in the catalog now carries its real room types: 184 of them across the sixteen
properties where an operator publishes the detail — name, square feet and metres, occupancy,
bed configuration, bathrooms, whether there is no kitchen, a kitchenette or a full one, the
view grade and what each type has that the others do not.

Pricing works off one number per property. `rateFactor` says what a type costs relative to
the room the property's seasonal rate is modelled on, so the Surf Club's studio is 0.39 and
its oceanfront two-bedroom is 1.29 of the same rate. Negotiate a better rate in the Desk and
every room in the property moves with it. A row marked *inferred* is one nobody publishes a
size for; *aggregator* means it came from a booking site rather than the operator.

Seven of the twenty-three Aruba properties have no room rows yet — Radisson Blu, Holiday Inn,
Courtyard, Boardwalk, Amsterdam Manor, voco Surfside and Eagle Aruba. The app handles that:
it simply does not offer the choice there.

## Money that never went through the queue

Someone hands Vishnu $300 in cash. **The Banker's inbox → Money came in** records it: pick the
person, type the amount, and the sheet shows exactly what it mints before he commits — how
much goes to the Circle, how much into the Reserve, how many points, and whether it earns a
tier bonus. Two shapes:

- **A month they missed** — it *is* that month's contribution and earns everything a normal
  one does, bonus and streak included.
- **An extra** — base points only at the plain rate. No tier bonus, no streak, and it does
  not count as covering a month. It needs a written note, because the member reads it on
  their ledger.

Either way it is one transaction: the contribution, the ledger lines and the Reserve all move
together, and it can be undone for a minute afterwards like any other confirmation.

**Everything in this build runs in the browser with seeded demo data.** Nothing real is**Everything in this build runs in the browser with seeded demo data.** Nothing real is
stored anywhere and no money moves. See *Going live* below for what has to happen first.

```
circle/
├── index.html            the whole app shell (no build step, no framework)
├── config.js             which backend to use — local demo or Supabase
├── css/                  tokens.css (the palette, in both themes) + app.css
├── js/
│   ├── core/             store.js (all the rules) · money.js (the arithmetic)
│   │                     router.js · util.js · vocab.js · share.js · supabase-store.js
│   ├── data/             seed.js (the demo) · stays.js (the catalog)
│   ├── ui/               pieces.js (card, gauge, ring, split bar) · components.js
│   │                     charts.js · art.js · qr.js
│   ├── views/            public.js · member.js · catalog.js · officer.js
│   └── app.js            boot, routes, the shell
├── supabase/schema.sql   tables, row-level security, and the money rules in SQL
├── sw.js                 offline shell
└── manifest.webmanifest  installable on a phone
```

## Try it

Open `circle/` on any static server:

```sh
npx http-server -p 8123 -c-1      # then http://127.0.0.1:8123/circle/
```

On the sign-in screen, pick a person. Each browser tab can be a different one, and they
update each other live — open **Vishnu** in one tab and a member in another, mark a
contribution as sent, then confirm it and watch the points land.

Worth doing in this order:

1. **Sasha** — the home screen: her card, what she can afford, her committed points.
2. **Marcus, Daniela, Victor, Fabian** have transfers waiting. Sign in as **Vishnu** →
   *Bank* and confirm one. You have a minute to undo it.
3. **Kimberly** has a live quote with a cash top-up. Accept it as her, then book it as
   **Victor** from the Desk's *To book* lane — the top-up has to reach Vishnu first, and the
   sheet says so.
4. **Kimberly** has also opened her Eagle Beach weekend to the Circle: Diego and Priya have
   already chipped in, and 9,000 points are still to cover. Sign in as anyone and put the
   rest in — *Circle* → *Chip in*, or straight from your home screen.
5. **Victor** → *Desk* to look at and price Priya's open request from its lane, edit the catalog, or write a note.
   The catalog editor takes **dollars or points in either box** — type one and the other
   follows — and *Settings* has the same converter for checking a price before you enter it.
6. **Vishnu** → *Bank* → *Close September* — it will not close while transfers are
   waiting, or if the Reserve is short.

## How the money works

| | $100 | $150 | $200 |
|---|---|---|---|
| Tier | Watapana | Fofoti | Kibrahacha |
| The Circle's share (15%) | $15.00 | $22.50 | $30.00 |
| Backs your points | $85.00 | $127.50 | $170.00 |
| Points a month | 8,500 | 13,050 | 17,800 |
| Of which bonus | — | 300 | 800 |
| Net to the Circle | $15.00 | $19.50 | $22.00 |

- **100 points = $1.00 of hotel, fixed forever.** Every balance prints the dollar beside it.
- **Points are minted only by the Banker**, when he has matched the transfer against the
  bank statement. Marking a transfer as sent creates a pending row and nothing else.
- **Bonuses are funded by the Circle out of its own 15%**, never out of another member's
  backing, and are capped at 40% of that month's service charges.
- **Points follow the money that actually arrived.** A short month earns proportionally
  fewer points, no tier bonus, and does not extend a streak.
- **Coverage** is the Reserve divided by everything the club owes in points. It is on the
  Pool page for every member to see, together with the date the Banker last checked it
  against the bank and by how much the two differed.
- **No borrowing.** If a quote is more than a member holds, the difference is a cash
  top-up to the Banker — with no 15% taken on it — and the hotel is not paid until it lands.
- **The Circle can chip in together.** Open a booking to everyone and any Insider can put
  their own points toward it — for a room you are sharing, or as a gift. Their points are
  committed the moment they chip in, released if it falls through, and when the hotel is
  paid each person's share burns from their own ledger. Nobody can chip in more than the
  booking still needs, and points never change hands as points.

The rules a member agrees to are in the app at `#/rules`, and they are what the code does.

## Roles

| | Member | Banker (Vishnu) | Planner (Victor) | Comms (Ian) | Admin |
|---|---|---|---|---|---|
| Send and withdraw own contribution | ✓ | ✓ | ✓ | ✓ | ✓ |
| Confirm, return or correct money | | ✓ | | | |
| Undo a confirmation (60 s) | | ✓ | | | |
| Quote and decline requests | | | ✓ | trips | |
| Pay a hotel and burn points | | ✓ | ✓ | | |
| Edit the catalog and its prices | | | ✓ | trips | ✓ |
| Chip in to someone's booking | ✓ | ✓ | ✓ | ✓ | ✓ |
| Write notes to the Circle | | | | ✓ | ✓ |
| Close a month (needs a second officer) | | ✓ | | | |
| Invite people, change the rules | | bank details | | | ✓ |

## Going live

The demo is deliberately self-contained. To run this for real:

1. **Create a Supabase project**, open the SQL editor and run `supabase/schema.sql`. It
   creates the tables, turns on row-level security, and puts every money rule in a
   `SECURITY DEFINER` function so a browser can never mint points.
2. **Set the redirect URLs** in Authentication → URL Configuration to include
   `https://<user>.github.io/BY-JOHNNY-PAESCH/circle/**`, and configure your own SMTP —
   the built-in mail server is rate-limited to a handful of messages an hour.
3. **Point the app at it** in `config.js`:
   ```js
   export const CONFIG = {
     backend: 'supabase',
     supabaseUrl: 'https://xxxxxxxx.supabase.co',
     supabaseKey: 'sb_publishable_...',   // publishable, not secret — RLS is the guard
   };
   ```
4. **Add the real people** in Settings → Insiders, and give Vishnu `treasurer`, Victor
   `planner` + `admin`, Ian `comms`.
5. **Register the two bank accounts** in Settings. Until the Reserve and Operating are
   two different accounts, the app says "Coverage: not yet verifiable" and refuses to
   close a month — which is the honest thing for it to say.
6. **Replace the planning rates.** Every price in the catalog is a planning band, marked
   as such. Put Victor's actual negotiated all-in rates in through the Desk.
7. **Have the rules read by an Aruban accountant** before the first real contribution —
   the turnover tax treatment of the 15%, and how the club is framed relative to the
   Centrale Bank van Aruba's rules on taking deposits.

### Open questions for Victor

1. Does the club open its own account (a *vereniging* or *stichting*), or at least two
   clearly labelled accounts in Vishnu's name? Coverage cannot be verified without it.
2. Who is the deputy Banker when Vishnu is away?
3. Is "within 48 hours of the money arriving" a promise Vishnu can keep?
4. Founding cohort of 20 and a cap of 40 members — right numbers?
5. Every rate in `js/data/stays.js` is a modeled planning band, not a quote. The four
   *Where we stay* properties need a written rate before members book against them —
   and the two Marriott Vacation Club resorts are rented as owner weeks (RedWeek/Vrbo),
   which is a different negotiation from a hotel contract. The three trips likewise: the
   hotel and villa figures behind them are aggregator ranges, not held blocks.
6. The club is named **Hunto** — Papiamento for "together". The name lives in
   `js/core/vocab.js`; change it there and every screen, reference and message follows.
7. *Settled:* anyone can join any trip at any level, and someone who wants a bigger trip
   moves up for the year rather than buying into one. `reach` is now only a description of
   how far a trip goes, not a gate.
8. Wallet passes: pay Apple the $99 so the pass says Hunto, or use a free shared
   certificate and accept someone else's name on it?

## The back office

Everything the club charges is editable, and always in both units:

- **Desk → Stays & trips** — each property has a dollar box and a points box per season
  (Summer, Winter, Peak); type into either and the other follows at 100 points to the
  dollar. Minimum nights, the Peak minimum, the public rate used for the “you save” line,
  and whether it is live for members are all here too. Trips are priced per seat, with the
  cash price a non-member guest pays.
- **Settings → Dollars and points** — a converter that also tells you how many months of
  contributions at each tier a price works out to, and the amount in Aruban florin.
- **Settings → The rules of the club** (admin) — the 15% share, the points-per-dollar rate,
  the seat cap, how long a quote is locked, the Banker's promised turnaround, and the
  leaving fee. Changing the share or the value of a point asks for confirmation, because
  both are promises to every member.
- **Settings → Insiders** — invite someone (it makes a code and copies the link), change
  roles or tiers, and write a correcting line into anyone's ledger with a reason attached.

## The membership card

Every Insider has a card with their name, their level and a QR code. The QR is generated
in the app itself (`js/ui/qrcode.js` — byte mode, error correction M, versions 1–10,
checked module-for-module against a reference implementation and decoded back in the
tests) so there is no CDN script and no external dependency. It encodes a link to the
member's entry, which any phone camera opens.

Four ways to keep the card, in the order they cost anything:

1. **Save it as an image** — works on every phone today. Credit-card proportions at
   300dpi with the QR on it, so it is scannable on its own.
2. **Print it, card sized** — the print dialog is set to 85.6 × 53.98 mm, so it comes out
   as a card rather than a card floating on A4.
3. **Put Hunto on the home screen** — this is the default and it costs nothing. On Chrome
   and Edge the button triggers the browser's real install prompt; on iPhone it opens a
   sheet with the two taps (Safari's Share button, then *Add to Home Screen*), because iOS
   gives a page no way to offer it directly. Afterwards the card is one tap away and its QR
   is always current, which a saved picture is not.
4. **Add to Apple Wallet** — **off, and hidden**. See below; it is not needed.

### Apple Wallet is optional, and the club does not have it

**The button does not appear unless a signing certificate is configured**, because a button
that cannot do what it says is worse than no button — it used to sit at the top of the card
telling anyone who pressed it to go and read this file.

A `.pkpass` is a zip containing `pass.json`, a `manifest.json` of SHA-1 hashes, a detached
PKCS#7 `signature`, and the images. The signature has to be made with a certificate Apple
issues, which is a **$99-a-year developer account**. There is no free way to make Apple's
own pass format for your own club — that price is the whole obstacle, and Victor has
decided against it.

Nothing is lost by that. A pass shows a QR and some text; the home-screen app shows the same
QR, always current, plus the balance, the ledger and everything else. The one thing Wallet
does better is opening without unlocking, which is not worth $99 a year to a club of forty.

If it is ever wanted anyway:

A `.pkpass` is a zip containing `pass.json`, a `manifest.json` of SHA-1 hashes, a
detached PKCS#7 `signature`, and the images. The signature has to be made with a
certificate Apple issues, which means it cannot happen in the browser — the private key
would be sitting in the page. `supabase/functions/issue-pass/` does it on the server and
`js/ui/wallet.js` calls it; paste the function's URL into *Settings → Apple Wallet
passes* and the button appears on every member's card.

Three ways to get there, honestly compared:

| | Cost | Whose name is on the pass | Worth it when |
|---|---|---|---|
| **Apple developer account** | $99 a year | Hunto's | You want the club to own its pass and control updates |
| **A shared-certificate service** (PassSource is free; WalletWallet has a free tier well above 40 members) | $0 | Theirs | You want a pass in Wallet this weekend |
| **Home screen app, QR and a saved image** | $0 | — | **What the club does.** Honestly fine for forty people who know each other |

The paid path, end to end: enrol at developer.apple.com as an **Individual** (an
organisation enrolment wants a D-U-N-S number and a company website, which a friends'
club does not have); create a Pass Type ID (`pass.aw.hunto.card`); generate a certificate
for it and export it as a `.p12`; download the **WWDR G4** intermediate from
`apple.com/certificateauthority/AppleWWDRCAG4.cer` and convert it to PEM; then:

```sh
supabase secrets set PASS_TYPE_ID=pass.aw.hunto.card TEAM_ID=XXXXXXXXXX \
  PASS_CERT_P12_BASE64="$(base64 -i pass.p12)" PASS_CERT_PASSWORD=... \
  WWDR_PEM="$(cat AppleWWDRCAG4.pem)" CLUB_URL=https://…/circle/
supabase functions deploy issue-pass
```

Google Wallet is deliberately not built: it has no iPhone app, and the club is
iPhone-first. If enough members end up on Android it is the same Edge Function with a
different signature.

## Notes on the build

- No framework, no bundler, no dependencies to install, and one lazily-loaded library:
  `@supabase/supabase-js`, only in Supabase mode. Everything else — the QR encoder, the
  charts, the card artwork — is in the repository.
- The service worker caches the shell but never Supabase traffic.
- A strict `Content-Security-Policy` is set in `index.html`; there are no inline scripts.
- The demo lives in `localStorage`, so on iOS Safari it is cleared after about a week of
  not visiting. Profile → *Export everything as JSON* keeps a copy.
