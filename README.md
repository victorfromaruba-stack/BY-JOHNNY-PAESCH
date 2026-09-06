# BY-JOHNNY-PAESCH

Two Aruba projects live in this repository.

## Eagle & Palm — by Johnny Paesch

Aruba resale marketplace for timeshare weeks and property. Lives at the repository root
(`index.html`).

Live: https://victorfromaruba-stack.github.io/BY-JOHNNY-PAESCH/

## Hunto — the Inner Circle

A private travel club for Victor's circle of friends: monthly contributions confirmed by
the Banker, points at 100 to the dollar, and stays in Aruba and trips further afield.
Lives in [`circle/`](circle/) with [its own README](circle/README.md).

Live: https://victorfromaruba-stack.github.io/BY-JOHNNY-PAESCH/circle/

---

# Eagle & Palm — notes

## Before this goes live

This is currently a **demonstration** build. Four things must be replaced:

1. **Delete the demo banner** — the `<div class="demo-bar">` element near the top of `index.html`, and its CSS rule (both are commented `DEMO BANNER`).
2. **Listings** — replace the `LISTINGS` array at the bottom of `index.html` with real properties, and swap `listing-1/2/3.jpg` for real photographs.
3. **Commission rate** — the fee panel shows a placeholder 5%.
4. **Contact details** — WhatsApp is live (+297 630 1307). Still to add: email, street address, and Johnny’s portrait as `johnny.jpg` (replacing the JP medallion).
5. **Remove the `noindex` tag** in `<head>` — it currently keeps this demo out of search results so placeholder listings cannot be indexed under Johnny’s name.
