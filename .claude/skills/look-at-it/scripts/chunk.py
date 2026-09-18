#!/usr/bin/env python3
"""Slice a tall screenshot into readable pieces.

  python3 chunk.py shot.jpg [max_height]

A 12,000px full-page shot read as one image gets downscaled until the type is gone - and type is
usually what you were sent to look at. This cuts it into ~1800px pieces at full resolution, named
in reading order, and prints how many there are. That count is itself informative: seven pieces of
a phone-width landing page means sixteen screens of scrolling.
"""
import sys, os
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
src = sys.argv[1]
step = int(sys.argv[2]) if len(sys.argv) > 2 else 1800
im = Image.open(src)
w, h = im.size
stem, _ = os.path.splitext(src)
if h <= step:
    print(f"{w}x{h} - short enough to read as one image, no slicing needed")
    sys.exit(0)
i = y = 0
while y < h:
    out = f"{stem}-p{i:02d}.jpg"
    im.crop((0, y, w, min(y + step, h))).convert("RGB").save(out, "JPEG", quality=88, optimize=True)
    print("wrote", out)
    y += step
    i += 1
print(f"\n{w}x{h} -> {i} pieces. Read them in order.")
