#!/usr/bin/env python3
"""
Get a generated picture down to a weight the first paint can carry, without it looking cheap.

The models hand back 1.5–2 MB for a hero, which on Aruban mobile data is the difference between
a page that opens and a page somebody gives up on. Resizing to the largest size actually
displayed and re-encoding progressively gets that to ~150KB with no visible loss — the trick is
to resize FIRST, because most of those megabytes are pixels no screen will ever show.

  python3 shrink.py in.jpg out.jpg --width 1600 [--quality 82] [--webp]
"""
import sys, argparse
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('dst')
ap.add_argument('--width', type=int, default=1600)
ap.add_argument('--quality', type=int, default=82)
ap.add_argument('--webp', action='store_true')
a = ap.parse_args()

im = Image.open(a.src)
if im.mode in ('RGBA', 'P', 'LA'):
    im = im.convert('RGB')
if im.width > a.width:
    im = im.resize((a.width, round(im.height * a.width / im.width)), Image.LANCZOS)

if a.webp:
    im.save(a.dst, 'WEBP', quality=a.quality, method=6)
else:
    # progressive so it paints top-down on a slow connection instead of sitting blank
    im.save(a.dst, 'JPEG', quality=a.quality, optimize=True, progressive=True, subsampling=1)

import os
print(f'{a.dst}  {im.width}×{im.height}  {round(os.path.getsize(a.dst)/1024)}KB '
      f'(from {round(os.path.getsize(a.src)/1024)}KB)')
