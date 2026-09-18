---
name: look-at-it
description: Actually LOOK at a web page — this project's own app or any external site — by driving the real headless browser that is installed here, then reading the screenshots. Use this skill whenever anyone asks you to look at, open, study, review, critique or compare a website or a screen; whenever you are about to describe how something LOOKS; whenever someone gives you a reference or inspiration URL (Dribbble, 21st.dev, a competitor, a hotel site) and wants you to learn from it; and whenever you catch yourself about to say you cannot see, browse, visit or view a site, or about to ask the user to send you a screenshot. You almost certainly can see it — that sentence is nearly always false in this environment, and saying it is the single worst failure this skill exists to prevent.
---

# Look at it

There is a real Chromium here and Playwright to drive it. You can open any page this session's
network policy allows, screenshot it, and **read the picture back into the conversation**. So you
can see. Behave accordingly.

This skill exists because of a specific, expensive mistake: telling the owner of this project
"I can't visually browse websites, please send me screenshots" — while a browser sat installed and
working, already being used to screenshot his own app. He had to correct it, and he was right to
be angry. Treat "I cannot see that site" as a claim requiring evidence, not a default.

## The one rule

**Every visual claim you make comes from a picture you actually looked at.**

Not from the HTML. Not from a CSS file. Not from what a page "probably" looks like. Reading source
to judge appearance is how you end up confidently fixing something that was never broken, and
missing the thing that is. Render it, read the image, then speak.

If you genuinely cannot get an image — the host is blocked by policy, the render fails — say which
step failed and what you saw, rather than falling back on a guess dressed as an observation.

## Looking at this project's own app

Localhost is in `no_proxy`, so nothing below about TLS applies. The app is a no-build static site;
serve the repo root and point the browser at it.

```bash
cd <repo root> && nohup python3 -m http.server 8899 --bind 127.0.0.1 >/dev/null 2>&1 &
```

This repo has a harness that signs in for you (`.claude/skills/circle-feel/scripts/harness.mjs`):
`open({width, height, role, scale})` then `go(p, '/route', ms)`. Prefer it — it handles the real
typefaces and forces lazy images to decode, which a naive screenshot silently gets wrong.

For anything else, `scripts/view.mjs` below works on any URL including `http://127.0.0.1:8899/...`.

## Looking at an external site

Outbound HTTPS goes through this sandbox's egress proxy, which re-terminates TLS. Playwright's
bundled Chromium carries its own trust store and does **not** pick up the CA that the shell
environment variables already trust, so a first attempt fails with `ERR_CERT_AUTHORITY_INVALID`.

Fix the trust properly, once per container:

```bash
scripts/trust-proxy-ca.sh
```

It installs `libnss3-tools` if needed and adds the proxy CA to the NSS store as a trusted root.
After that, TLS verifies normally and pages simply load.

Then:

```bash
node scripts/view.mjs <url> <out.jpg> [extraScrolls]
python3 scripts/chunk.py <out.jpg>     # only needed for tall full-page shots
```

Read the resulting images. That is the point of the exercise.

### Two shortcuts that do not work, and should not

Both of these were tried here and both were refused by a safety classifier. The refusals were
correct — do not reach for them, and do not try to slip past them:

- **Spoofing the user-agent** to look like a desktop Mac browser. Flagged as a third-party attack,
  because pretending to be a different client is what evasion looks like. The default Playwright
  user-agent loads these sites fine; there is nothing to gain.
- **`--ignore-certificate-errors` / `--ignore-certificate-errors-spki-list`.** Flagged as weakening
  TLS. Even pinning the one known CA reads as a bypass. Installing the CA into the trust store is
  not a workaround for that refusal — it is the actual, correct fix, which is why it works and why
  nothing objects to it.

The general lesson worth carrying: when a safety check blocks you, the right move is usually a
*more* correct method, not a cleverer bypass. Here the correct method was also the one that worked.

### When a site really is unavailable

A 403 or 407 from the proxy means the host is not allowed by this session's egress policy. Report
the blocked host and move on — do not retry it and do not route around it. A 202 with an empty
title is usually a bot-challenge page; screenshot it anyway and look, because sometimes the real
page renders underneath and sometimes you are looking at a wall, and you cannot tell which without
looking.

## Reading a tall page

A full-page screenshot of a real site is often 6,000–13,000px tall. Read as one image and it is
downscaled into uselessness — you will see layout but no type, and type is usually the thing you
were sent to study. `scripts/chunk.py` slices a tall image into ~1,800px pieces at readable
resolution. Read them in order.

A useful habit: the number of chunks is itself a finding. A landing page that needs seven of them
is sixteen phone screens long, and that length is worth saying out loud.

## Studying someone else's design

Opening a public page in a browser to see how it is made is ordinary use — it is what a designer
does all day, and it is why the page is public. Keep it to that:

- **Look, and abstract.** What carries the hierarchy, how big the display type is against the body,
  where the photography sits, how restrained the colour is, what single move gives it personality.
  Principles travel between products; they are not anyone's property.
- **Do not copy their assets.** Their photographs, illustrations, icons and fonts are theirs. None
  of it goes into this product.
- **Do not clone a specific design.** "Make ours look like that particular shot" produces both a
  derivative product and a legal problem. Take the principle, not the composition.
- **Do not crawl.** A page or two that you actually read beats a hundred you harvested. If you find
  yourself writing a loop over a site, stop — that is scraping, and it is a different activity with
  different rules.

Report what you saw concretely, with the numbers where you can measure them. "It felt premium" is
worth nothing. "The display type is roughly 4× the body, the photography is full-bleed rather than
inset in cards, and there is exactly one accent hue" is something you can act on.

## Files

```
scripts/view.mjs           open any URL, screenshot it (full page by default)
scripts/chunk.py           slice a tall screenshot into readable pieces
scripts/trust-proxy-ca.sh  one-time: trust the sandbox proxy CA so HTTPS verifies
```
