#!/usr/bin/env python3
"""
The rank emblems — prestige crests, not icons.

Victor's brief was "cool like Call of Duty prestige", and that idiom is specific: a metal
shield, laurel either side, wings once you are high enough, a star per rung, and each rank
visibly outranking the one below at a glance. The escalation has to be legible in silhouette,
because that is how anyone actually reads a ladder.

Everything is drawn from the site's own palette — the teal is --good, the dark field is --ink —
so the metal reads as belonging to this club rather than to a game. Written as a generator
rather than five hand-drawn files so the family stays a family: change the shield here and all
five change together.

  python3 crests.py <out-dir>
"""
import sys, os, math

INK   = '#121A26'
TEAL  = '#1E9FAE'
TEAL_D= '#0B5560'

# Three metals, each a five-stop gradient so the bevel reads as a rolled edge rather than a
# flat ramp. Light comes from the top left throughout; nothing looks forged if the highlights
# disagree with each other.
METALS = {
    'bronze': ['#F6D9AE', '#D9A05B', '#A86A2A', '#7A4715', '#C98F45'],
    'steel':  ['#F2F6F8', '#C6D3DB', '#8FA3B0', '#5B6B78', '#AEBECA'],
    'gold':   ['#FFF3C4', '#F2CE60', '#C9962C', '#8A5F12', '#E8BE55'],
}

def grad(gid, stops, x1=0, y1=0, x2=0, y2=1):
    n = len(stops)
    s = ''.join(f'<stop offset="{i/(n-1):.3f}" stop-color="{c}"/>' for i, c in enumerate(stops))
    return (f'<linearGradient id="{gid}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{s}</linearGradient>')

def star(cx, cy, r, rot=-90, points=5, inner=0.42):
    pts = []
    for i in range(points * 2):
        rad = r if i % 2 == 0 else r * inner
        a = math.radians(rot + i * 180.0 / points)
        pts.append(f'{cx + rad*math.cos(a):.2f},{cy + rad*math.sin(a):.2f}')
    return 'M' + 'L'.join(pts) + 'Z'

# A heater shield with a hard shoulder — angular at the top, drawn to a point. The straight
# shoulders are what make it read as a crest at 28px; a rounded top turns to mush.
SHIELD = ('M64 14 L104 26 L104 60 C104 84 88 102 64 114 '
          'C40 102 24 84 24 60 L24 26 Z')
SHIELD_IN = ('M64 24 L95 33.5 L95 60 C95 78 82.5 92.5 64 102.5 '
             'C45.5 92.5 33 78 33 60 L33 33.5 Z')

def _bez(p0, p1, p2, p3, t):
    """Point and tangent on a cubic, so a leaf can sit ON the branch and lie along it."""
    mt = 1 - t
    x = (mt**3*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t**3*p3[0])
    y = (mt**3*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t**3*p3[1])
    dx = 3*mt*mt*(p1[0]-p0[0]) + 6*mt*t*(p2[0]-p1[0]) + 3*t*t*(p3[0]-p2[0])
    dy = 3*mt*mt*(p1[1]-p0[1]) + 6*mt*t*(p2[1]-p1[1]) + 3*t*t*(p3[1]-p2[1])
    return x, y, math.degrees(math.atan2(dy, dx))

def laurel(side, leaves, scale=1.0, top=26):
    """Half a wreath, hugging the shield. Leaves sit on the branch and lie along it — the first
    version scattered them into the air beside it, which read as wheat rather than laurel."""
    d = -1 if side == 'left' else 1
    p0 = (64 + d*20, 110)
    p1 = (64 + d*48, 104)
    p2 = (64 + d*54, 62)
    p3 = (64 + d*36, top)
    pts = [_bez(p0, p1, p2, p3, k/40) for k in range(41)]
    path = 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y, _ in pts)
    out = [f'<path d="{path}" stroke="url(#metd)" stroke-width="{3.4*scale:.1f}" fill="none" '
           f'stroke-linecap="round"/>']
    for i in range(leaves):
        t = 0.06 + 0.9 * i / max(leaves - 1, 1)
        x, y, ang = _bez(p0, p1, p2, p3, t)
        taper = 1 - 0.42 * t
        # two leaves per node, splayed off the branch on the outer side
        for lean in (-52, 14):
            rx, ry = 9.4*scale*taper, 3.9*scale*taper
            ox = x + d*rx*0.72*math.cos(math.radians(ang + d*lean))
            oy = y + rx*0.72*math.sin(math.radians(ang + d*lean))
            out.append(f'<ellipse cx="{ox:.1f}" cy="{oy:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" '
                       f'fill="url(#met)" stroke="{INK}" stroke-width="0.8" '
                       f'transform="rotate({ang + d*lean:.0f} {ox:.1f} {oy:.1f})"/>')
    return '<g>' + ''.join(out) + '</g>'

def wings(scale=1.0):
    """A wing per side: one swept silhouette with feathers cut into its trailing edge. Drawing
    the feathers as separate floating strokes — the first attempt — read as scattered wheat."""
    out = []
    for d in (-1, 1):
        rootx, rooty = 64 + d*24, 34
        tipx,  tipy  = 64 + d*60*scale, 21
        drop = 54                       # how far the trailing edge falls — enough to read as a
                                        # spread wing, high enough to clear the wreath below
        # leading edge sweeps out and slightly up; trailing edge comes back in scallops
        lead = f'M{rootx:.1f} {rooty:.1f} Q{64 + d*46:.1f} {12:.1f} {tipx:.1f} {tipy:.1f}'
        scallops, n = '', 6
        for k in range(n):
            t0, t1 = k / n, (k + 1) / n
            x0 = tipx + (rootx - tipx) * t0
            y0 = tipy + (drop - tipy) * t0
            x1 = tipx + (rootx - tipx) * t1
            y1 = tipy + (drop - tipy) * t1
            scallops += f' Q{(x0+x1)/2 + d*8:.1f} {(y0+y1)/2 + 8:.1f} {x1:.1f} {y1:.1f}'
        out.append(f'<path d="{lead} L{tipx + (rootx-tipx)*0:.1f} {tipy:.1f}{scallops} Z" '
                   f'fill="url(#met)" stroke="{INK}" stroke-width="1.7" stroke-linejoin="round"/>')
        # feather lines, following the sweep
        for k in range(1, n):
            t = k / n
            x1 = tipx + (rootx - tipx) * t
            y1 = tipy + (54 - tipy) * t
            xa = rootx + (tipx - rootx) * (t * 0.55)
            ya = rooty + (tipy - rooty) * (t * 0.55)
            out.append(f'<path d="M{xa:.1f} {ya:.1f} Q{(xa+x1)/2 + d*4:.1f} {(ya+y1)/2:.1f} '
                       f'{x1:.1f} {y1:.1f}" stroke="{INK}" stroke-width="1.1" fill="none" opacity=".55"/>')
    return '<g>' + ''.join(out) + '</g>'

def rays():
    """The burst behind the top rank. Restraint everywhere else; this one has earned it."""
    out = ['<g opacity="0.55">']
    for i in range(24):
        a = math.radians(i * 15)
        r0, r1 = 52, 76 if i % 2 == 0 else 66
        out.append(f'<path d="M{64 + r0*math.cos(a):.1f} {60 + r0*math.sin(a):.1f} '
                   f'L{64 + r1*math.cos(a):.1f} {60 + r1*math.sin(a):.1f}" '
                   f'stroke="{TEAL}" stroke-width="{2.6 if i % 2 == 0 else 1.4}" stroke-linecap="round"/>')
    out.append('</g>')
    return ''.join(out)

def crest(metal, stars, laurel_leaves=0, winged=False, burst=False, crown=False):
    m = METALS[metal]
    body = []
    defs = [
        grad('met', m), grad('metd', [m[3], m[2], m[1]]),
        grad('field', [TEAL_D, INK]),
        f'<linearGradient id="sheen" x1="0" y1="0" x2="0.3" y2="1">'
        f'<stop offset="0" stop-color="#fff" stop-opacity=".55"/>'
        f'<stop offset=".45" stop-color="#fff" stop-opacity=".06"/>'
        f'<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>',
        '<filter id="glow" x="-40%" y="-40%" width="180%" height="180%">'
        f'<feDropShadow dx="0" dy="0" stdDeviation="3.2" flood-color="{TEAL}" flood-opacity=".75"/></filter>',
        '<filter id="lift" x="-30%" y="-30%" width="160%" height="160%">'
        f'<feDropShadow dx="0" dy="2.4" stdDeviation="2" flood-color="{INK}" flood-opacity=".45"/></filter>',
    ]
    if burst: body.append(rays())
    if winged: body.append(wings())
    if laurel_leaves:
        # A wreath that climbs to the shoulder would swallow the wings whole — which is what
        # happened the first time. On a winged rank it stops lower and leaves them the air.
        ltop = 44 if winged else 26
        body.append(laurel('left', laurel_leaves, top=ltop))
        body.append(laurel('right', laurel_leaves, top=ltop))
    if crown:
        body.append(f'<path d="M46 20 L52 8 L58 17 L64 4 L70 17 L76 8 L82 20 Z" '
                    f'fill="url(#met)" stroke="{INK}" stroke-width="1.6" stroke-linejoin="round"/>')
        body.append(f'<path d="{star(64, 7, 4.6)}" fill="{TEAL}" stroke="{INK}" stroke-width="1"/>')

    # the shield: metal rim, dark field, sheen over the top half
    body.append(f'<g filter="url(#lift)">'
                f'<path d="{SHIELD}" fill="url(#met)" stroke="{INK}" stroke-width="2.6" stroke-linejoin="round"/>'
                f'<path d="{SHIELD_IN}" fill="url(#field)" stroke="{INK}" stroke-width="1.6"/>'
                f'<path d="{SHIELD_IN}" fill="url(#sheen)"/></g>')

    # a star per rung, arced across the shield face
    # The shield's inner field is about 58 wide where the stars sit, so the spacing and the
    # radius both have to come down as the count goes up or the top ranks spill over the rim.
    n = stars
    r  = {1: 13, 2: 11, 3: 9.2, 4: 7.6, 5: 6.6}[n]
    gap = {1: 0, 2: 20, 3: 17.5, 4: 14.4, 5: 12.2}[n]
    for i in range(n):
        t = (i - (n - 1) / 2)
        cx = 64 + t * gap
        cy = 57 + abs(t) * 2.2
        body.append(f'<path d="{star(cx, cy, r)}" fill="url(#met)" stroke="{INK}" '
                    f'stroke-width="1.4" stroke-linejoin="round"/>')
        body.append(f'<path d="{star(cx, cy - r*0.07, r*0.45)}" fill="{TEAL}" opacity=".92"/>')

    # the base bar — the one thing every rank shares, so the family is obvious
    body.append(f'<path d="M50 88 H78" stroke="url(#met)" stroke-width="4" stroke-linecap="round"/>')

    halo = ' filter="url(#glow)"' if burst else ''
    g = f'<g{halo}>' + ''.join(body) + '</g>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">'
            f'<defs>{"".join(defs)}</defs>{g}</svg>')

RANKS = [
    ('seated',   dict(metal='bronze', stars=1)),
    ('steady',   dict(metal='bronze', stars=2, laurel_leaves=5)),
    ('anchor',   dict(metal='steel',  stars=3, laurel_leaves=7)),
    ('oldguard', dict(metal='gold',   stars=4, laurel_leaves=8, winged=True)),
    ('pillar',   dict(metal='gold',   stars=5, laurel_leaves=9, winged=True, burst=True, crown=True)),
]

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    for name, kw in RANKS:
        with open(os.path.join(out, f'{name}.svg'), 'w') as f:
            f.write(crest(**kw))
        print(f'{name}.svg')
