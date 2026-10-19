# cut a generated card out of its white background (soft edges, no white halo), crop, and fit it in a 3:4 box
import sys, numpy as np
from PIL import Image, ImageDraw
src, dst = sys.argv[1], sys.argv[2]
W, H = int(sys.argv[3]) if len(sys.argv) > 3 else 300, int(sys.argv[4]) if len(sys.argv) > 4 else 400
im = Image.open(src).convert('RGB')
w, h = im.size
mark = im.copy()
for xy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]:
    if sum(mark.getpixel(xy)) > 690: ImageDraw.floodfill(mark, xy, (255, 0, 255), thresh=28)
m = np.array(mark).astype(int); a0 = np.array(im).astype(float)
bg = (m[..., 0] == 255) & (m[..., 1] == 0) & (m[..., 2] == 255)
# the band next to the background: alpha from how far the pixel is from white, then un-mix the white
near = np.zeros_like(bg)
for dy in range(-3, 4):
    for dx in range(-3, 4):
        near |= np.roll(np.roll(bg, dy, 0), dx, 1)
band = near & ~bg
alpha = np.ones(bg.shape); alpha[bg] = 0
lo = a0.min(axis=2)
ab = np.clip((255 - lo) / 150.0, 0, 1)
alpha[band] = ab[band]
rgb = a0.copy()
safe = np.maximum(alpha, 1e-3)[..., None]
un = (a0 - 255 * (1 - alpha[..., None])) / safe
rgb[band] = np.clip(un[band], 0, 255)
out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
img = Image.fromarray(out)
ys, xs = np.where(alpha > 0.05)
img = img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
s = min(W / img.width, H / img.height)
img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
box = Image.new('RGBA', (W, H), (0, 0, 0, 0)); box.paste(img, ((W - img.width) // 2, H - img.height), img)  # (standing on the bottom edge)
box.save(dst, 'WEBP', quality=90, method=6)
print(dst, img.size)
