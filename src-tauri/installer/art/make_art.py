"""Renders the Windows installer artwork (BMPs for NSIS) in the Agentic OS design.

    python src-tauri/installer/art/make_art.py        (from the repo root; output is committed)

Pages are drawn at several display scales (100/125/150/200 %) so they stay sharp; the installer picks the
closest one at runtime. Everything is supersampled 3x and downsampled for clean edges. Live text (titles,
body copy) is NOT baked in: the installer draws it with the app's own fonts (see assets/fonts).

Sources: the app's dot-matrix world (src/assets/world-dots.json), its colour tokens (src/styles/tokens.css,
Orbital theme) and fonts (Space Grotesk, JetBrains Mono).
"""
import json, math, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'src-tauri', 'installer', 'assets')
FONTS = os.path.join(OUT, 'fonts')
SCALES = [1.0, 1.25, 1.5, 2.0]
SS = 3                                   # supersampling

# Orbital tokens
VOID, HULL, HULL2 = '#05070A', '#0B1016', '#101821'
SEAM, SEAM2 = '#1A2430', '#263445'
INK, INK2, INK3 = '#E6EDF3', '#A7B4C2', '#6B7A8C'
SIGNAL, SIGNAL2, FLARE, PULSE, AMBER = '#4FE3FF', '#2AA9C9', '#FF4D5E', '#7CFFB2', '#FFC857'
# region tones, oklch(L C h) from tokens.css, in REGION_INDEX order of src/data/regions.js
TONES_OKLCH = {
    'europe': (.74, .11, 262), 'africa': (.76, .12, 62), 'asia': (.72, .13, 12), 'mideast': (.80, .10, 92),
    'namerica': (.78, .10, 185), 'samerica': (.80, .12, 138), 'oceania': (.74, .11, 300)
}

# base sizes at 100 % (measured from the MUI2 window: 745x458 page and 747x83 header at 150 %)
PAGE = (497, 305)
HEADER = (498, 55)
SPLASH = (300, 300)


def rgb(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def oklch(L, C, hdeg):
    h = math.radians(hdeg)
    a, b = C * math.cos(h), C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    def enc(x):
        x = max(0.0, min(1.0, x))
        return round(255 * (12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055))
    return (enc(r), enc(g), enc(bb))


def regions_order():
    src = open(os.path.join(ROOT, 'src', 'data', 'regions.js'), encoding='utf8').read()
    keys = []
    for k in ['europe', 'africa', 'asia', 'mideast', 'namerica', 'samerica', 'oceania']:
        keys.append((src.find("'" + k + "'"), k))
    return [k for _, k in sorted(keys)]


WORLD = json.load(open(os.path.join(ROOT, 'src', 'assets', 'world-dots.json')))
DOTS = [(WORLD['dots'][i] / 10, WORLD['dots'][i + 1] / 10, WORLD['dots'][i + 2]) for i in range(0, len(WORLD['dots']), 3)]
ORDER = regions_order()
TONES = [oklch(*TONES_OKLCH[k]) for k in ORDER]


def mix(c1, c2, t):
    return tuple(round(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


def font(name, px):
    return ImageFont.truetype(os.path.join(FONTS, name), max(1, round(px)))


# ---------------------------------------------------------------- primitives (all sizes in final px * SS)
class Canvas:
    def __init__(self, w, h, scale):
        self.w, self.h, self.s = w, h, scale          # final pixel size and display scale
        self.k = scale * SS                           # design unit (1 px @100 %) -> canvas px
        self.img = Image.new('RGBA', (w * SS, h * SS), rgb(VOID))

    def u(self, v):
        return v * self.k

    def layer(self):
        return Image.new('RGBA', self.img.size, (0, 0, 0, 0))

    def put(self, lay, blur=0):
        if blur:
            lay = lay.filter(ImageFilter.GaussianBlur(self.u(blur)))
        self.img = Image.alpha_composite(self.img, lay)

    def final(self):
        # no film grain here: noise defeats the installer's LZMA compression
        return self.img.resize((self.w, self.h), Image.LANCZOS).convert('RGB')


def dot_grid(c, step=12, alpha=40, box=None):
    lay = c.layer(); d = ImageDraw.Draw(lay)
    x0, y0, x1, y1 = box or (0, 0, c.w / c.s, c.h / c.s)
    r = c.u(0.5)
    y = y0 + step / 2
    while y < y1:
        x = x0 + step / 2
        while x < x1:
            d.ellipse([c.u(x) - r, c.u(y) - r, c.u(x) + r, c.u(y) + r], fill=rgb(SEAM2, alpha))
            x += step
        y += step
    c.put(lay)


def radial(c, cx, cy, r, color, alpha):
    lay = c.layer(); d = ImageDraw.Draw(lay)
    steps = 40
    for i in range(steps, 0, -1):
        t = i / steps
        a = round(alpha * (1 - t) ** 1.6)
        rr = c.u(r * t)
        d.ellipse([c.u(cx) - rr, c.u(cy) - rr, c.u(cx) + rr, c.u(cy) + rr], fill=rgb(color, a))
    c.put(lay, blur=4)


def vignette(c, strength=150):
    lay = c.layer(); d = ImageDraw.Draw(lay)
    w, h = c.img.size
    steps = 30
    for i in range(steps):
        t = i / steps
        a = round(strength * (1 - t) ** 3 / steps * 3)
        inset = round(t * min(w, h) * 0.18)
        d.rectangle([inset, inset, w - inset, h - inset], outline=(0, 0, 0, a), width=max(1, round(min(w, h) * 0.18 / steps)))
    c.put(lay, blur=6)


# ---------------------------------------------------------------- the globe
def project(lon, lat, lon0, lat0):
    lam, phi, l0, p0 = map(math.radians, (lon, lat, lon0, lat0))
    x = math.cos(phi) * math.sin(lam - l0)
    y = math.cos(p0) * math.sin(phi) - math.sin(p0) * math.cos(phi) * math.cos(lam - l0)
    z = math.sin(p0) * math.sin(phi) + math.cos(p0) * math.cos(phi) * math.cos(lam - l0)
    return x, y, z


def globe(c, cx, cy, R, lon0=14, lat0=32, sun=(0.86, 0.28, 0.42), online=False, mono=None):
    sl = math.sqrt(sum(v * v for v in sun)); sun = tuple(v / sl for v in sun)
    # dark disc + limb shading so the planet reads as a sphere even where there is ocean
    lay = c.layer(); d = ImageDraw.Draw(lay)
    d.ellipse([c.u(cx - R), c.u(cy - R), c.u(cx + R), c.u(cy + R)], fill=rgb('#070B10', 255))
    c.put(lay)
    # graticule
    lay = c.layer(); d = ImageDraw.Draw(lay)
    for lon in range(-180, 180, 30):
        pts = []
        for lat in range(-90, 91, 3):
            x, y, z = project(lon, lat, lon0, lat0)
            if z > 0: pts.append((c.u(cx + R * x), c.u(cy - R * y)))
            elif len(pts) > 1: d.line(pts, fill=rgb(SEAM, 150), width=max(1, round(c.u(0.6)))); pts = []
        if len(pts) > 1: d.line(pts, fill=rgb(SEAM, 150), width=max(1, round(c.u(0.6))))
    for lat in range(-60, 90, 30):
        pts = []
        for lon in range(-180, 181, 3):
            x, y, z = project(lon, lat, lon0, lat0)
            if z > 0: pts.append((c.u(cx + R * x), c.u(cy - R * y)))
            elif len(pts) > 1: d.line(pts, fill=rgb(SEAM, 150), width=max(1, round(c.u(0.6)))); pts = []
        if len(pts) > 1: d.line(pts, fill=rgb(SEAM, 150), width=max(1, round(c.u(0.6))))
    c.put(lay)
    # dots: region tones on the day side, dimmed on the night side, a few warm city lights
    lay = c.layer(); d = ImageDraw.Draw(lay)
    base = R * 0.0064
    rnd = random.Random(42)
    for lon, lat, reg in DOTS:
        x, y, z = project(lon, lat, lon0, lat0)
        if z <= 0.02: continue
        light = x * sun[0] + y * sun[1] + z * sun[2]
        day = max(0.0, min(1.0, (light + 0.10) / 0.22))             # soft terminator
        tone = mono or TONES[reg]
        night = mix(tone, rgb(VOID)[:3], 0.78)
        col = mix(night, tone, day)
        a = round(255 * (0.30 + 0.55 * day) * (0.55 + 0.45 * z))
        r = base * (0.6 + 0.4 * z) * (1.0 + 0.15 * day)
        px, py = c.u(cx + R * x), c.u(cy - R * y)
        rr = c.u(r)
        d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=col + (a,))
        if day < 0.15 and not mono and rnd.random() < 0.07:            # city lights
            rl = c.u(r * 0.7)
            d.ellipse([px - rl, py - rl, px + rl, py + rl], fill=rgb(AMBER, 200))
    c.put(lay)
    # atmosphere: a thin cyan rim, brighter on the lit side
    lay = c.layer(); d = ImageDraw.Draw(lay)
    for i in range(180):
        a0 = i * 2
        t = math.radians(a0 + 1)
        lit = max(0.0, math.cos(t) * sun[0] - math.sin(t) * sun[1])
        col = rgb(mono and INK3 or SIGNAL, round(60 + 150 * lit))
        d.arc([c.u(cx - R), c.u(cy - R), c.u(cx + R), c.u(cy + R)], a0, a0 + 2.2, fill=col, width=max(1, round(c.u(1.2))))
    c.put(lay, blur=1.6)
    c.put(lay)


def berlin(c, cx, cy, R, lon0=14, lat0=32, pulse=False, color=SIGNAL):
    x, y, z = project(13.405, 52.52, lon0, lat0)
    px, py = cx + R * x, cy - R * y
    lay = c.layer(); d = ImageDraw.Draw(lay)
    w = max(1, round(c.u(0.8)))
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        d.line([c.u(px + dx * 4), c.u(py + dy * 4), c.u(px + dx * 10), c.u(py + dy * 10)], fill=rgb(color, 200), width=w)
    if pulse:
        for i, rr in enumerate((7, 12, 18)):
            d.ellipse([c.u(px - rr), c.u(py - rr), c.u(px + rr), c.u(py + rr)], outline=rgb(color, 170 - i * 50), width=w)
    c.put(lay)
    glow = c.layer(); ImageDraw.Draw(glow).ellipse([c.u(px - 3.5), c.u(py - 3.5), c.u(px + 3.5), c.u(py + 3.5)], fill=rgb(color, 255))
    c.put(glow, blur=3)
    dotl = c.layer(); ImageDraw.Draw(dotl).ellipse([c.u(px - 2), c.u(py - 2), c.u(px + 2), c.u(py + 2)], fill=rgb(INK))
    c.put(dotl)
    return px, py


def links(c, cx, cy, R, lon0=14, lat0=32):
    """Online: glowing great-circle arcs from Berlin to cities on the visible side."""
    cities = [(-0.13, 51.5, 0), (3.38, 6.52, 1), (36.82, -1.29, 1), (55.27, 25.2, 3), (77.2, 28.6, 2), (18.42, -33.9, 1), (-9.14, 38.7, 0), (31.2, 30.0, 3)]
    b = (13.405, 52.52)
    lay = c.layer(); d = ImageDraw.Draw(lay)
    ends = []
    for lon, lat, reg in cities:
        # slerp between the two points on the unit sphere, lifted above the surface mid-way
        def v(lo, la):
            lo, la = math.radians(lo), math.radians(la)
            return (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))
        p, q = v(*b), v(lon, lat)
        om = math.acos(max(-1, min(1, sum(p[i] * q[i] for i in range(3)))))
        pts = []
        for i in range(41):
            t = i / 40
            s0, s1 = math.sin((1 - t) * om) / math.sin(om), math.sin(t * om) / math.sin(om)
            w = [s0 * p[k] + s1 * q[k] for k in range(3)]
            la, lo = math.degrees(math.asin(w[2])), math.degrees(math.atan2(w[1], w[0]))
            x, y, z = project(lo, la, lon0, lat0)
            lift = 1 + 0.10 * math.sin(math.pi * t) * om
            if z > 0: pts.append((c.u(cx + R * x * lift), c.u(cy - R * y * lift)))
        if len(pts) > 2:
            d.line(pts, fill=rgb(SIGNAL, 150), width=max(1, round(c.u(0.9))))
            ends.append((pts[-1], TONES[reg]))
    c.put(lay, blur=1.2)
    c.put(lay)
    lay = c.layer(); d = ImageDraw.Draw(lay)
    for (px, py), col in ends:
        rr = c.u(2.2)
        d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=col + (255,))
    c.put(lay)


def chrono_ring(c, cx, cy, r, arc=(-90, 90), color=SIGNAL, ticks=True, dashed=False):
    """The Chronosphere dial: hairline ring, 24 hour ticks, a glowing signal arc."""
    lay = c.layer(); d = ImageDraw.Draw(lay)
    w1 = max(1, round(c.u(0.8)))
    box = [c.u(cx - r), c.u(cy - r), c.u(cx + r), c.u(cy + r)]
    d.ellipse(box, outline=rgb(SEAM2, 255), width=w1)
    if ticks:
        for i in range(24):
            a = math.radians(i * 15 - 90)
            l = 7 if i % 6 == 0 else 3.5
            p0 = (c.u(cx + (r - 2) * math.cos(a)), c.u(cy + (r - 2) * math.sin(a)))
            p1 = (c.u(cx + (r - 2 - l) * math.cos(a)), c.u(cy + (r - 2 - l) * math.sin(a)))
            d.line([p0, p1], fill=rgb(SEAM2 if i % 6 else INK3, 255), width=w1)
    c.put(lay)
    if arc:
        a0, a1 = arc
        lay = c.layer(); d = ImageDraw.Draw(lay)
        wa = max(1, round(c.u(2.2)))
        if dashed:
            a = a0
            while a < a1:
                d.arc(box, a, min(a1, a + 9), fill=rgb(color), width=wa); a += 16
        else:
            d.arc(box, a0, a1, fill=rgb(color), width=wa)
        c.put(lay, blur=2.5)
        c.put(lay)
        if a1 - a0 < 360:
            for ang in (a0, a1):
                t = math.radians(ang)
                px, py = cx + r * math.cos(t), cy + r * math.sin(t)
                dl = c.layer(); ImageDraw.Draw(dl).ellipse([c.u(px - 2.6), c.u(py - 2.6), c.u(px + 2.6), c.u(py + 2.6)], fill=rgb(color))
                c.put(dl, blur=1.5); c.put(dl)


def panel(c, x0, y0, x1, y1, chamfer=12, fill_alpha=215):
    """An app panel: hull glass, hairline outline, 12 px chamfer top-right, two signal corner brackets."""
    pts = [(x0, y0), (x1 - chamfer, y0), (x1, y0 + chamfer), (x1, y1), (x0, y1)]
    P = [(c.u(x), c.u(y)) for x, y in pts]
    lay = c.layer(); d = ImageDraw.Draw(lay)
    d.polygon(P, fill=rgb(HULL, fill_alpha))
    c.put(lay)
    lay = c.layer(); d = ImageDraw.Draw(lay)
    w = max(1, round(c.u(0.8)))
    d.line(P + [P[0]], fill=rgb(SEAM2), width=w)
    # inner top edge highlight
    d.line([(c.u(x0 + 1), c.u(y0 + 1.2)), (c.u(x1 - chamfer - 0.5), c.u(y0 + 1.2))], fill=(255, 255, 255, 14), width=w)
    bw = max(1, round(c.u(1.4))); L = 10
    d.line([(c.u(x0), c.u(y0 + L)), (c.u(x0), c.u(y0)), (c.u(x0 + L), c.u(y0))], fill=rgb(SIGNAL), width=bw)
    d.line([(c.u(x1 - L), c.u(y1)), (c.u(x1), c.u(y1)), (c.u(x1), c.u(y1 - L))], fill=rgb(SIGNAL), width=bw)
    c.put(lay)


def text(c, x, y, s, fnt, px, color, tracking=0.0, anchor='la'):
    """Draws text at design coords; tracking in em."""
    f = font(fnt, c.u(px))
    lay = c.layer(); d = ImageDraw.Draw(lay)
    if not tracking:
        d.text((c.u(x), c.u(y)), s, font=f, fill=rgb(color) if isinstance(color, str) else color, anchor=anchor)
    else:
        total = sum(f.getlength(ch) for ch in s) + c.u(px) * tracking * (len(s) - 1)
        cx = c.u(x) - (total if anchor[0] == 'r' else 0)
        for ch in s:
            d.text((cx, c.u(y)), ch, font=f, fill=rgb(color) if isinstance(color, str) else color, anchor='l' + anchor[1])
            cx += f.getlength(ch) + c.u(px) * tracking
    c.put(lay)


def wordmark(c, x, y, px, anchor='la'):
    f = font('aos-grotesk-medium.ttf', c.u(px))
    parts = [('AGENTIC', INK), ('/', SIGNAL), ('OS', INK)]
    tr = c.u(px) * 0.02
    total = sum(f.getlength(ch) + tr for p, _ in parts for ch in p) - tr
    cx = c.u(x) - (total / 2 if anchor[0] == 'm' else 0)
    lay = c.layer(); d = ImageDraw.Draw(lay)
    for p, col in parts:
        for ch in p:
            d.text((cx, c.u(y)), ch, font=f, fill=rgb(col), anchor='l' + anchor[1]); cx += f.getlength(ch) + tr
    c.put(lay)


STAGES = ['WELCOME', 'SETUP', 'INSTALL', 'ONLINE']


def track(c, x0, x1, y, current, done_all=False, labels=True, label_y=None, color=SIGNAL):
    """The four setup stages as nodes on a line; the current one glows."""
    n = len(STAGES)
    xs = [x0 + (x1 - x0) * i / (n - 1) for i in range(n)]
    lay = c.layer(); d = ImageDraw.Draw(lay)
    w = max(1, round(c.u(0.8)))
    d.line([(c.u(x0), c.u(y)), (c.u(x1), c.u(y))], fill=rgb(SEAM2), width=w)
    if current > 0:
        d.line([(c.u(x0), c.u(y)), (c.u(xs[current]), c.u(y))], fill=rgb(color, 200), width=w)
    c.put(lay)
    for i, x in enumerate(xs):
        state = 'done' if (i < current or done_all) else 'now' if i == current else 'next'
        lay = c.layer(); d = ImageDraw.Draw(lay)
        if state == 'now':
            r = 4.2
            d.ellipse([c.u(x - r), c.u(y - r), c.u(x + r), c.u(y + r)], fill=rgb(color))
            c.put(lay, blur=3); c.put(lay)
            lay = c.layer(); d = ImageDraw.Draw(lay); r = 1.8
            d.ellipse([c.u(x - r), c.u(y - r), c.u(x + r), c.u(y + r)], fill=rgb(INK))
            c.put(lay)
        elif state == 'done':
            r = 2.6
            d.ellipse([c.u(x - r), c.u(y - r), c.u(x + r), c.u(y + r)], fill=rgb(color, 230))
            c.put(lay)
        else:
            r = 2.8
            d.ellipse([c.u(x - r), c.u(y - r), c.u(x + r), c.u(y + r)], fill=rgb(VOID), outline=rgb(SEAM2), width=w)
            c.put(lay)
        if labels:
            col = INK if state == 'now' else (INK3 if state == 'done' else '#4A5868')
            ly = label_y or (y + 7)
            if i == 0:
                text(c, x - 3, ly, STAGES[i], 'aos-mono.ttf', 6.4, col, tracking=0.08)
            elif i == n - 1:
                text(c, x + 3, ly, STAGES[i], 'aos-mono.ttf', 6.4, col, tracking=0.08, anchor='ra')
            else:
                text_center(c, x, ly, STAGES[i], 6.4, col)


def text_center(c, x, y, s, px, color, fnt='aos-mono.ttf', tracking=0.08):
    f = font(fnt, c.u(px))
    total = sum(f.getlength(ch) for ch in s) + c.u(px) * tracking * (len(s) - 1)
    text(c, x - total / c.k / 2, y, s, fnt, px, color, tracking=tracking)


def dot_strip(c, x0, y0, y1, fade=(0.0, 0.25), alpha=150, mono=None, lat_top=74, lat_bot=-44):
    """The dot world in true equirectangular proportion (2:1), fading in from the left."""
    lay = c.layer(); d = ImageDraw.Draw(lay)
    x1 = x0 + (y1 - y0) * 360 / (lat_top - lat_bot)
    for lon, lat, reg in DOTS:
        if lat > lat_top or lat < lat_bot: continue
        tx = (lon + 180) / 360
        x = x0 + (x1 - x0) * tx
        y = y0 + (y1 - y0) * (lat_top - lat) / (lat_top - lat_bot)
        f = max(0.0, min(1.0, (tx - fade[0]) / max(1e-6, fade[1] - fade[0])))
        a = round(alpha * f)
        if a < 4: continue
        col = mono or TONES[reg]
        rr = c.u(0.5)
        d.ellipse([c.u(x) - rr, c.u(y) - rr, c.u(x) + rr, c.u(y) + rr], fill=col + (a,))
    c.put(lay)
    return x1


# ---------------------------------------------------------------- compositions
GCX, GCY, GR = 112, 176, 132          # globe centre and radius on the full-window pages


def page(scale, kind):
    W, H = round(PAGE[0] * scale), round(PAGE[1] * scale)
    c = Canvas(W, H, scale)
    radial(c, GCX + 30, GCY - 10, 260, HULL2, 255)
    dot_grid(c, 12, 34)
    radial(c, GCX, GCY, GR * 1.35, SIGNAL, 26 if kind == 'welcome' else 40)
    online = kind == 'finish'
    globe(c, GCX, GCY, GR, online=online)
    if online:
        links(c, GCX, GCY, GR)
    berlin(c, GCX, GCY, GR, pulse=online)
    chrono_ring(c, GCX, GCY, GR + 13, arc=(-90, 270) if online else (-90, 90))
    vignette(c, 120)
    # the text column is an app panel; live text is drawn on top by the installer
    panel(c, 258, 22, 482, 283, fill_alpha=255)   # solid: the installer's labels sit on an exact HULL background
    if kind == 'welcome':
        track(c, 274, 466, 262, 0, label_y=249)
    else:
        track(c, 274, 466, 262, 3, done_all=True, label_y=249, color=SIGNAL)
    text(c, 274, 32, '52.52°N  13.40°E', 'aos-mono.ttf', 6.6, INK3, tracking=0.06)
    text(c, 466, 32, 'ONLINE' if online else 'SETUP', 'aos-mono.ttf', 6.6, PULSE if online else SIGNAL, tracking=0.12, anchor='ra')
    return c.final()


def header(scale, kind):
    W, H = round(HEADER[0] * scale), round(HEADER[1] * scale)
    c = Canvas(W, H, scale)
    remove = kind == 'remove'
    # left of x=322 stays flat void: the installer draws the title there on an opaque void background
    lay = c.layer(); d = ImageDraw.Draw(lay)
    for i in range(round(c.u(322)), W * SS):                          # void -> hull towards the right edge
        t = (i - c.u(322)) / max(1, W * SS - c.u(322))
        d.line([(i, 0), (i, H * SS)], fill=mix(rgb(VOID)[:3], rgb(HULL)[:3], t) + (255,))
    c.put(lay)
    dot_grid(c, 12, 30, box=(324, 0, HEADER[0], HEADER[1]))
    dot_strip(c, 300, 7, 49, fade=(0.17, 0.42), alpha=125 if not remove else 60, mono=rgb(INK3)[:3] if remove else None)
    # the stage readout sits on a dark chip, like a HUD label over the map
    lay = c.layer(); d = ImageDraw.Draw(lay)
    d.rounded_rectangle([c.u(368), c.u(9), c.u(490), c.u(44)], radius=c.u(5), fill=rgb(VOID, 225), outline=rgb(SEAM2, 255), width=max(1, round(c.u(0.7))))
    c.put(lay)
    # bottom hairline with a short signal accent, like a panel edge
    lay = c.layer(); d = ImageDraw.Draw(lay)
    w = max(1, round(c.u(0.8)))
    d.line([(0, c.u(HEADER[1] - 0.6)), (W * SS, c.u(HEADER[1] - 0.6))], fill=rgb(SEAM2), width=w)
    d.line([(c.u(16), c.u(HEADER[1] - 0.6)), (c.u(44), c.u(HEADER[1] - 0.6))], fill=rgb(FLARE if remove else SIGNAL), width=max(1, round(c.u(1.4))))
    c.put(lay)
    if remove:
        # a broken dial: the system going offline
        cx, cy, r = 470, 26.5, 11
        chrono_ring(c, cx, cy, r, arc=(200, 330), color=FLARE, ticks=False, dashed=True)
        dl = c.layer(); ImageDraw.Draw(dl).ellipse([c.u(cx - 3), c.u(cy - 3), c.u(cx + 3), c.u(cy + 3)], fill=rgb(FLARE, 230))
        c.put(dl, blur=2); c.put(dl)
        text(c, 452, 16, 'UNINSTALL', 'aos-mono.ttf', 6.6, FLARE, tracking=0.12, anchor='ra')
        text(c, 452, 28, 'GOING OFFLINE', 'aos-mono.ttf', 6.0, INK3, tracking=0.08, anchor='ra')
    else:
        cur = {'setup': 1, 'install': 2}[kind]
        track(c, 380, 478, 20, cur, labels=False)
        text(c, 478, 28, f'{cur + 1:02d} / 04', 'aos-mono.ttf', 6.6, SIGNAL, tracking=0.06, anchor='ra')
        f = font('aos-mono.ttf', c.u(6.6))
        lab = STAGES[cur]
        text(c, 380, 28, lab, 'aos-mono.ttf', 6.6, INK2, tracking=0.12)
    return c.final()


def splash(scale):
    W = H = round(SPLASH[0] * scale)
    c = Canvas(W, H, scale)
    c.img = Image.new('RGBA', c.img.size, (255, 0, 255, 255))          # magenta = transparent for AdvSplash
    # card: hard-edged rounded rect (a colour key can't blend), everything inside is anti-aliased as usual
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, H - 1], radius=round(22 * scale), fill=255)
    card = Image.new('RGBA', c.img.size, rgb(HULL))
    c.img = card
    radial(c, 150, 128, 170, HULL2, 255)
    dot_grid(c, 12, 40)
    radial(c, 150, 128, 120, SIGNAL, 34)
    cx, cy, r = 150, 124, 56
    lay = c.layer(); d = ImageDraw.Draw(lay)
    d.ellipse([c.u(cx - r), c.u(cy - r), c.u(cx + r), c.u(cy + r)], outline=rgb(SEAM2), width=round(c.u(5)))
    c.put(lay)
    lay = c.layer(); d = ImageDraw.Draw(lay)
    d.arc([c.u(cx - r), c.u(cy - r), c.u(cx + r), c.u(cy + r)], -90, 90, fill=rgb(SIGNAL), width=round(c.u(5)))
    c.put(lay, blur=5); c.put(lay)
    lay = c.layer(); d = ImageDraw.Draw(lay); rr = 13
    d.ellipse([c.u(cx - rr), c.u(cy - rr), c.u(cx + rr), c.u(cy + rr)], fill=rgb(SIGNAL))
    c.put(lay, blur=6); c.put(lay)
    wordmark(c, 150, 216, 21, anchor='mm')
    text_center(c, 150, 248, 'INITIALISING SETUP', 7.2, INK3)
    out = c.img.resize((W, H), Image.LANCZOS).convert('RGB')
    # inner hairline + signal corner brackets
    d = ImageDraw.Draw(out)
    key = Image.new('RGB', (W, H), (255, 0, 255))
    out = Image.composite(out, key, mask)
    return out


def chime(path):
    """A soft two-tone boot chime (C5 -> G5), the installer's take on the app's synthesized ticks."""
    import struct, wave
    rate, dur = 22050, 1.1
    n = int(rate * dur)
    frames = bytearray()
    for i in range(n):
        t = i / rate
        v = 0.0
        for start, f in ((0.0, 523.25), (0.16, 783.99)):
            if t >= start:
                tt = t - start
                env = min(1.0, tt / 0.012) * math.exp(-tt * 4.2)
                v += env * (math.sin(2 * math.pi * f * tt) + 0.18 * math.sin(2 * math.pi * f * 2 * tt))
        frames += struct.pack('<h', int(max(-1, min(1, v * 0.16)) * 32767))
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(bytes(frames))


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path, 'BMP')
    return path


def main():
    os.makedirs(OUT, exist_ok=True)
    made = []
    for s in SCALES:
        tag = str(round(s * 100))
        made.append(save(page(s, 'welcome'), f'welcome-{tag}.bmp'))
        made.append(save(page(s, 'finish'), f'finish-{tag}.bmp'))
        for k in ('setup', 'install', 'remove'):
            made.append(save(header(s, k), f'header-{k}-{tag}.bmp'))
    for s in (1.0, 1.5, 2.0):
        made.append(save(splash(s), f'splash-{round(s * 100)}.bmp'))
    chime(os.path.join(OUT, 'boot.wav')); made.append(os.path.join(OUT, 'boot.wav'))
    # contact sheet for review, written to %TEMP% (not shipped)
    sheet_parts = [Image.open(os.path.join(OUT, n)) for n in ('welcome-150.bmp', 'finish-150.bmp', 'header-setup-150.bmp', 'header-install-150.bmp', 'header-remove-150.bmp', 'splash-150.bmp')]
    Wd = max(p.width for p in sheet_parts) * 2 + 30
    sheet = Image.new('RGB', (Wd, 1500), (40, 40, 40))
    sheet.paste(sheet_parts[0], (10, 10)); sheet.paste(sheet_parts[1], (sheet_parts[0].width + 20, 10))
    y = sheet_parts[0].height + 20
    for p in sheet_parts[2:5]:
        sheet.paste(p, (10, y)); y += p.height + 10
    sheet.paste(sheet_parts[5], (sheet_parts[2].width + 20, sheet_parts[0].height + 20))
    import tempfile
    sheet.save(os.path.join(tempfile.gettempdir(), 'agentic-os-installer-art.png'))
    print('\n'.join(os.path.relpath(p, ROOT) for p in made))


if __name__ == '__main__':
    main()
