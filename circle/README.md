# Hunto — the Inner Circle

A private travel club for a group of friends in Aruba. Members contribute $100, $150 or
$200 a month by bank transfer. The Banker confirms the money has arrived; only then are
points minted. The club keeps 15% for running it, the other 85% backs the points, and
points pay for stays on the island and trips the Desk organizes.

**Everything in this build runs in the browser with seeded demo data.** Nothing real is
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
3. **Kimberly** has a live quote with a cash top-up. Accept it as her, then pay the
   hotel as Vishnu — the top-up has to arrive first.
4. **Victor** → *Desk* to quote Priya's open request, edit the catalog, or write a note.
5. **Vishnu** → *Bank* → *Close September* — it will not close while transfers are
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

The rules a member agrees to are in the app at `#/rules`, and they are what the code does.

## Roles

| | Member | Banker (Vishnu) | Planner (Victor) | Comms (Ian) | Admin |
|---|---|---|---|---|---|
| Send and withdraw own contribution | ✓ | ✓ | ✓ | ✓ | ✓ |
| Confirm, return or correct money | | ✓ | | | |
| Undo a confirmation (60 s) | | ✓ | | | |
| Quote and decline requests | | | ✓ | trips | |
| Pay a hotel and burn points | | ✓ | ✓ | | |
| Edit the catalog | | | ✓ | trips | ✓ |
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
5. Which resorts have actually been negotiated so far?
6. The club is named **Hunto** — Papiamento for "together". The name lives in
   `js/core/vocab.js`; change it there and every screen, reference and message follows.

## Notes on the build

- No framework, no bundler, no dependencies to install. Two libraries load lazily from a
  CDN when they are needed: `@supabase/supabase-js` (only in Supabase mode) and
  `qrcodejs` (only on the card screen).
- The service worker caches the shell but never Supabase traffic.
- A strict `Content-Security-Policy` is set in `index.html`; there are no inline scripts.
- The demo lives in `localStorage`, so on iOS Safari it is cleared after about a week of
  not visiting. Profile → *Export everything as JSON* keeps a copy.
