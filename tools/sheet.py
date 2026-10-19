import sys
from PIL import Image
files = sys.argv[2:]; ims = [Image.open(f) for f in files]
W = sum(i.width for i in ims) + 20 * (len(ims) + 1); H = max(i.height for i in ims) * 2 + 60
sheet = Image.new('RGB', (W, H), (59, 42, 26)); sheet.paste((255, 248, 236), (0, H // 2, W, H))
x = 20
for i in ims:
    sheet.paste(i, (x, 20), i); sheet.paste(i, (x, H // 2 + 20), i); x += i.width + 20
sheet.save(sys.argv[1])
