# SIGNAL SIEGE cover — procedural grid/path/tower motif in champagne gold on
# near-black. One-shot: python scripts/generate_td_cover.py
from PIL import Image, ImageDraw, ImageFilter

W, H = 1200, 630
BG = (10, 10, 12)
GOLD = (205, 170, 109)
ROSE = (224, 90, 122)
MUTE = (60, 58, 66)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# faint grid
CELL = 42
for x in range(0, W, CELL):
    d.line([(x, 0), (x, H)], fill=(20, 20, 24), width=1)
for y in range(0, H, CELL):
    d.line([(0, y), (W, y)], fill=(20, 20, 24), width=1)

# S-path in gold (glow underlay + core)
path = [(-20, 168), (798, 168), (798, 336), (252, 336), (252, 504), (1220, 504)]
glow = Image.new("RGB", (W, H), (0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.line(path, fill=(120, 96, 56), width=34)
glow = glow.filter(ImageFilter.GaussianBlur(18))
img = Image.blend(img, Image.composite(glow, Image.new("RGB", (W, H), (0, 0, 0)), Image.new("L", (W, H), 255)), 0.55)
d = ImageDraw.Draw(img)
d.line(path, fill=(150, 122, 74), width=14)
d.line(path, fill=GOLD, width=4)

# creeps on the path (rose orbs marching)
for cx, cy, r in [(120, 168, 9), (210, 168, 7), (300, 168, 8), (700, 336, 10), (560, 336, 7), (420, 504, 11), (760, 504, 8), (920, 504, 9)]:
    halo = Image.new("RGB", (W, H), (0, 0, 0))
    hd = ImageDraw.Draw(halo)
    hd.ellipse([cx - r * 3, cy - r * 3, cx + r * 3, cy + r * 3], fill=(90, 30, 44))
    halo = halo.filter(ImageFilter.GaussianBlur(10))
    img = Image.blend(img, halo, 0.18)
    d = ImageDraw.Draw(img)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ROSE)

# towers (gold squares with glyphs) off-path
towers = [(504, 84), (924, 252), (126, 420), (546, 420), (1008, 378), (672, 84), (336, 252)]
for tx, ty in towers:
    d.rounded_rectangle([tx - 26, ty - 26, tx + 26, ty + 26], radius=6, fill=(18, 18, 24), outline=GOLD, width=2)
    d.ellipse([tx - 10, ty - 10, tx + 10, ty + 10], outline=GOLD, width=3)
    # range circles (hairline)
    d.ellipse([tx - 92, ty - 92, tx + 92, ty + 92], outline=(48, 42, 34), width=1)

# projectile streaks
for (x1, y1, x2, y2) in [(504, 110, 300, 160), (924, 278, 760, 496), (546, 446, 430, 500), (336, 278, 215, 172)]:
    d.line([(x1, y1), (x2, y2)], fill=(255, 224, 160), width=2)

# vignette
vig = Image.new("L", (W, H), 0)
vd = ImageDraw.Draw(vig)
vd.ellipse([-W * 0.25, -H * 0.35, W * 1.25, H * 1.35], fill=110)
vig = vig.filter(ImageFilter.GaussianBlur(120))
dark = Image.new("RGB", (W, H), (0, 0, 0))
img = Image.composite(img, dark, vig)

img.save("public/assets/tower-defense-cover.jpg", quality=90)
print("cover written")
