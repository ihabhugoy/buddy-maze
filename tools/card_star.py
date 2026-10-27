# The star on top of every card: the unified frame left its two bottom points hidden under the cream panel, so the star
# looked cut off. This draws a whole star (same place, size and colors: cream-gold to warm gold, a dark brown outline,
# rounded points, a soft shine) over each card, its lower points overlapping the panel like a badge pinned on.
# usage: python3 tools/card_star.py game/assets/cards/*.webp
import sys, numpy as np
from PIL import Image, ImageDraw, ImageFilter

CX, CY, R = 143.6, 31.4, 17.0   # where the frame's star sits on a 288 x 400 card (outer radius, outline included)
SS = 8                          # drawn 8x larger, then scaled down for smooth edges
OUTLINE, ROUND = 1.6, 2.8       # outline width and corner rounding, in card pixels

def star_points(cx, cy, ro, ri):
    pts = []
    for k in range(10):
        a = -np.pi / 2 + k * np.pi / 5; r = ro if k % 2 == 0 else ri
        pts.append((cx + r * np.cos(a), cy + r * np.sin(a)))
    return pts

def mask(ro, grow):
    """a star of outer radius ro with its corners rounded by growing a smaller star (a disc dilation)"""
    size = int(2 * (R + 4) * SS); c = size / 2; m = Image.new('L', (size, size), 0)
    core = max(1, (ro - ROUND) * SS)
    ImageDraw.Draw(m).polygon(star_points(c, c, core, core * 0.54), fill=255) # (a chubby star, like the frame's)
    k = int(round((ROUND + grow) * SS)) * 2 + 1
    return m.filter(ImageFilter.MaxFilter(k)) if k > 1 else m

def badge():
    size = int(2 * (R + 4) * SS)
    out_m = np.asarray(mask(R - OUTLINE, OUTLINE)) / 255          # the outline's outer edge
    fill_m = np.asarray(mask(R - OUTLINE, 0)) / 255               # the gold inside it
    y = np.linspace(0, 1, size)[:, None] * np.ones((1, size))
    top, bot = np.array([252, 238, 168]), np.array([255, 186, 52])
    t = np.clip((y - 0.25) / 0.55, 0, 1)[..., None]
    gold = top * (1 - t) + bot * t
    # a soft shine on the upper left, like the frame's own star
    yy, xx = np.mgrid[0:size, 0:size] / size
    shine = np.exp(-(((xx - 0.42) / 0.11) ** 2 + ((yy - 0.36) / 0.08) ** 2))[..., None]
    gold = gold * (1 - 0.55 * shine) + 255 * 0.55 * shine
    # a deeper gold rim just inside the outline, heavier at the bottom: the star looks puffy, not flat
    inner = np.asarray(mask(R - OUTLINE, -1.4)) / 255
    rim = np.clip(fill_m - inner, 0, 1)[..., None] * (0.35 + 0.65 * y[..., None])
    gold = gold * (1 - rim) + np.array([226, 140, 30]) * rim
    rgb = np.where(fill_m[..., None] > 0.5, gold, np.array([104, 62, 18]))
    img = np.dstack([rgb, out_m * 255]).astype(np.uint8)
    small = int(size / SS)
    star = Image.fromarray(img, 'RGBA').resize((small, small), Image.LANCZOS)
    # a faint shadow under it on the panel, so it sits on top like a badge
    sh = Image.new('RGBA', star.size, (70, 40, 10, 0)); sh.putalpha(star.getchannel('A').point(lambda v: v * 0.28))
    sh = sh.filter(ImageFilter.GaussianBlur(1.2)); out = Image.new('RGBA', star.size, (0, 0, 0, 0))
    out.alpha_composite(sh, (0, 1)); out.alpha_composite(star)
    return out

if __name__ == '__main__':
    b = badge(); half = b.size[0] / 2
    for f in sys.argv[1:]:
        card = Image.open(f).convert('RGBA')
        card.alpha_composite(b, (int(round(CX - half)), int(round(CY - half))))
        card.save(f, 'WEBP', quality=92, method=6)
        print('star fixed:', f)
