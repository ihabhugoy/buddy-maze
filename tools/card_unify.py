# One deck, one frame: every card is rebuilt on the same template (the cleanest generated card): its frame recolored
# to the card's color, a fresh cream panel with an even dot grid, and only the picture taken from each generated card,
# scaled to the same size. Then cut out of the white background (soft edges, no white halo).
import sys, json, colorsys, numpy as np
from PIL import Image, ImageDraw

def rgb2hsv(a):
    r, g, b = a[..., 0] / 255, a[..., 1] / 255, a[..., 2] / 255
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b); d = mx - mn
    h = np.zeros_like(mx); nz = d > 1e-6
    rm = nz & (mx == r); gm = nz & (mx == g) & ~rm; bm = nz & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6; h[gm] = (b - r)[gm] / d[gm] + 2; h[bm] = (r - g)[bm] / d[bm] + 4
    return np.dstack([h / 6, np.where(mx > 0, d / np.maximum(mx, 1e-6), 0), mx])

def hsv2rgb(h, s, v):
    i = np.floor(h * 6).astype(int) % 6; f = h * 6 - np.floor(h * 6)
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    r = np.choose(i, [v, q, p, p, t, v]); g = np.choose(i, [t, v, v, q, p, p]); b = np.choose(i, [p, p, t, v, v, q])
    return np.dstack([r, g, b]) * 255

def rgbf(h): h = h.lstrip('#'); return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)

def outer_bg(im):
    w, h = im.size; mark = im.copy()
    for xy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]:
        if sum(mark.getpixel(xy)) > 690: ImageDraw.floodfill(mark, xy, (255, 0, 255), thresh=28)
    m = np.array(mark); return (m[..., 0] == 255) & (m[..., 1] == 0) & (m[..., 2] == 255)

def panel(im, bg):
    """the cream inner panel: its shape (holes filled) and the picture's pixels (the holes)"""
    a = np.array(im).astype(int); ys, xs = np.where(~bg); x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    # flood the cream from many seeds on a ring well inside the card (never the old card's outer rings or the picture)
    cw, ch = x1 - x0, y1 - y0; pm = np.zeros(bg.shape, bool)
    for ins in (0.17, 0.24):
        X0, X1, Y0, Y1 = int(x0 + cw * ins), int(x1 - cw * ins), int(y0 + ch * ins), int(y1 - ch * ins)
        ring = [(x, Y0) for x in range(X0, X1, 30)] + [(x, Y1) for x in range(X0, X1, 30)] + [(X0, y) for y in range(Y0, Y1, 30)] + [(X1, y) for y in range(Y0, Y1, 30)]
        for (x, y) in ring:
            r, g, b = a[y, x]
            if pm[y, x] or not (r > 232 and g > 222 and b > 198 and r - b < 45): continue
            mark = im.copy(); ImageDraw.floodfill(mark, (x, y), (0, 255, 0), thresh=26)
            m = np.array(mark); f = (m[..., 0] == 0) & (m[..., 1] == 255) & (m[..., 2] == 0)
            if f.sum() > cw * ch * 0.08: pm |= f
    py, px = np.where(pm); bx0, bx1, by0, by1 = px.min(), px.max(), py.min(), py.max()
    # holes: what isn't panel inside the panel's box, minus everything connected to the box's edge (frame, notch)
    sub = (~pm[by0:by1 + 1, bx0:bx1 + 1]).astype(np.uint8) * 255
    simg = Image.fromarray(sub); H, W = sub.shape
    for x in range(W):
        for yy in (0, H - 1):
            if simg.getpixel((x, yy)) == 255: ImageDraw.floodfill(simg, (x, yy), 128)
    for yy in range(H):
        for x in (0, W - 1):
            if simg.getpixel((x, yy)) == 255: ImageDraw.floodfill(simg, (x, yy), 128)
    holes = np.zeros_like(pm); holes[by0:by1 + 1, bx0:bx1 + 1] = np.array(simg) == 255
    cream = np.median(a[pm], axis=0)
    return pm | holes, holes, (bx0, by0, bx1, by1), cream

def components(mask, min_area):
    """keep the parts of a mask bigger than min_area (drops the faint dots of the old panel)"""
    img = Image.fromarray(mask.astype(np.uint8) * 255); keep = np.zeros_like(mask); ys, xs = np.where(mask)
    done = np.zeros_like(mask); sizes = []
    for y, x in zip(ys, xs):
        if done[y, x]: continue
        c = img.copy(); ImageDraw.floodfill(c, (int(x), int(y)), 77); comp = np.array(c) == 77
        done |= comp; sizes.append((comp.sum(), comp))
    return sizes

def art_of(path, largest_only=False):
    im = Image.open(path).convert('RGB'); bg = outer_bg(im); shape, holes, box, cream = panel(im, bg)
    a = np.array(im).astype(float); area = shape.sum()
    parts = components(holes, 1)
    bx0, by0, bx1, by1 = box; pw, ph = bx1 - bx0, by1 - by0
    def central(comp): # (leftovers of the old card's own frame: lines along the edges, the star's notch, corners)
        ys, xs = np.where(comp); w, h = xs.max() - xs.min(), ys.max() - ys.min(); cx, cy = xs.mean(), ys.mean()
        return w < pw * 0.95 and h < ph * 0.95 and bx0 + pw * 0.1 < cx < bx1 - pw * 0.1 and by0 + ph * 0.13 < cy < by1 - ph * 0.08
    parts = [p for p in parts if central(p[1])]
    keepm = np.zeros_like(holes)
    if largest_only: keepm = max(parts, key=lambda p: p[0])[1]
    else:
        for n, comp in parts:
            if n > area * 0.0004: keepm |= comp
    # grow the picture a little so soft glows and antialiased edges come along, then alpha by distance from cream
    grow = Image.fromarray(keepm.astype(np.uint8) * 255).filter(__import__('PIL.ImageFilter', fromlist=['x']).MaxFilter(25))
    near = (np.array(grow) > 0) & shape
    ys0, xs0 = np.where(keepm); m0 = np.zeros_like(near); m0[max(0, ys0.min() - 14):ys0.max() + 15, max(0, xs0.min() - 14):xs0.max() + 15] = True; near &= m0
    d = np.sqrt(((a - cream) ** 2).sum(axis=2))
    alpha = np.clip((d - 14) / 34, 0, 1); alpha[~near] = 0; alpha[keepm & (d > 40)] = 1
    sa = np.maximum(alpha, 1e-3)[..., None]
    rgb = np.clip((a - cream * (1 - alpha[..., None])) / sa, 0, 255)
    rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    ys, xs = np.where(alpha > 0.04)
    return Image.fromarray(rgba).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

def build(template, color, art, out, size=(288, 400), fill=0.8, lift=0.02):
    im = Image.open(template).convert('RGB'); bg = outer_bg(im); shape, holes, (bx0, by0, bx1, by1), cream = panel(im, bg)
    a = np.array(im).astype(float)
    # 1. recolor the frame: the template's own hue range -> the card's color, keeping its shading (lip, highlights)
    hsv = rgb2hsv(a)
    frame = ~bg & ~shape
    base = np.median(hsv[frame & (hsv[..., 1] > 0.25)], axis=0)
    dh = np.abs(((hsv[..., 0] - base[0] + 0.5) % 1) - 0.5)
    tint = frame & (dh < 0.11) & (hsv[..., 1] > 0.12)
    th, ts, tv = colorsys.rgb_to_hsv(*(rgbf(color) / 255))
    out_rgb = a.copy()
    new = hsv2rgb(np.full(a.shape[:2], th), np.minimum(1, hsv[..., 1] * ts / base[1]), np.minimum(1, hsv[..., 2] * tv / base[2]))
    out_rgb[tint] = new[tint]
    # 2. a fresh panel: flat cream with an even grid of faint dots
    panel_rgb = np.empty_like(a); panel_rgb[:] = cream
    dots = Image.new('L', im.size, 0); dd = ImageDraw.Draw(dots); step = 30
    for y in range(by0 + step // 2, by1, step):
        for x in range(bx0 + step // 2 + (step // 2 if ((y - by0) // step) % 2 else 0), bx1, step): dd.ellipse((x - 3, y - 3, x + 3, y + 3), fill=255)
    dm = np.array(dots) > 0
    panel_rgb[dm] = cream - np.array([9, 12, 16])
    # soften the panel edge into the frame's outline: only replace pixels well inside the panel
    inner = np.array(Image.fromarray(shape.astype(np.uint8) * 255).filter(__import__('PIL.ImageFilter', fromlist=['x']).MinFilter(3))) > 0
    out_rgb[inner] = panel_rgb[inner]
    card = Image.fromarray(out_rgb.astype(np.uint8))
    # 3. the picture, the same size on every card, centered a touch low (the star's notch is at the top)
    pw, ph = bx1 - bx0, by1 - by0
    s = min(pw * fill / art.width, ph * fill * 0.86 / art.height)
    art = art.resize((max(1, round(art.width * s)), max(1, round(art.height * s))), Image.LANCZOS)
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2 + ph * lift
    card.paste(art, (round(cx - art.width / 2), round(cy - art.height / 2)), art)
    # 4. out of the white background, soft edges, fitted to the size
    a2 = np.array(card).astype(float); bgm = bg
    near = np.zeros_like(bgm)
    for dy in range(-3, 4):
        for dx in range(-3, 4): near |= np.roll(np.roll(bgm, dy, 0), dx, 1)
    band = near & ~bgm; alpha = np.ones(bgm.shape); alpha[bgm] = 0
    alpha[band] = np.clip((255 - a2.min(axis=2)) / 150.0, 0, 1)[band]
    un = (a2 - 255 * (1 - alpha[..., None])) / np.maximum(alpha, 1e-3)[..., None]
    a2[band] = np.clip(un[band], 0, 255)
    img = Image.fromarray(np.dstack([a2, alpha * 255]).astype(np.uint8))
    ys, xs = np.where(alpha > 0.05); img = img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    img.resize(size, Image.LANCZOS).save(out, 'WEBP', quality=90, method=6)
    print(out, img.size)

if __name__ == '__main__':
    cfg = json.load(open(sys.argv[1]))
    for c in cfg['cards']:
        build(cfg['template'], c['color'], art_of(c['src'], c.get('largest', False)), c['out'], fill=c.get('fill', 0.8))
