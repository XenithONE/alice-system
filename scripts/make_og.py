# -*- coding: utf-8 -*-
"""Generates the Open Graph card from the page's own tokens and headline.

## Why this is generated rather than drawn

The card it replaces, og-harbor.jpg, showed a walkable 3D harbour. That
harbour moved to harbor.html (noindex, unlinked) two versions ago, so every
share preview and every search result was advertising a page the link does
not lead to — 367,700 bytes of a picture of somewhere else.

The safest thing an OG card can be is a picture of the page it links to. This
one is: the same ground, the same amber, the same folio, and the same brand
lockup and signal line the masthead sets. Nothing here is invented, which is
the property that stops it going stale in a different way.

## Where the number comes from

`--live` is passed in by the caller, which reads it from bento.ts. It is not
typed here — the description in index.html already drifted from 14 to 16 once
by being written by hand, and cssSelftest [C9] now fails if index.html and
CATALOG.length disagree. The masthead itself only renders the playable count.

Run: python scripts/make_og.py --live 15
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# theme.css :root, verbatim.
BG = (6, 28, 49)
INK = (246, 241, 231)
AMBER = (230, 173, 70)
DIM = (185, 197, 206)
FAINT = (159, 176, 188)
LIVE = (87, 194, 116)
HAIRLINE = (44, 62, 80)

W, H = 1200, 630
MARGIN = 76

FONTS = "C:/Windows/Fonts"


def font(name: str, size: int, index: int = 0) -> ImageFont.FreeTypeFont:
    path = os.path.join(FONTS, name)
    if not os.path.exists(path):
        sys.exit(f"missing font: {path}")
    return ImageFont.truetype(path, size, index=index)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", type=int, required=True)
    ap.add_argument("--out", default="public/assets/og-catalog.jpg")
    args = ap.parse_args()

    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # The works section's wash, scoped and faint, same idea as the page. Blurred
    # hard: an un-blurred ellipse leaves a visible arc, which reads as a shape
    # someone drew rather than as light.
    glow = Image.new("RGB", (W, H), BG)
    ImageDraw.Draw(glow).ellipse([W * 0.34, -H * 0.60, W * 1.15, H * 0.78], fill=(20, 48, 72))
    glow = glow.filter(ImageFilter.GaussianBlur(110))
    img = Image.blend(img, glow, 0.65)
    d = ImageDraw.Draw(img)

    mono = font("consolab.ttf", 21)
    signal_font = font("consolab.ttf", 24)
    display = font("arialbd.ttf", 116)
    jp = font("YuGothB.ttc", 27)

    # Folio, on a rule the number breaks — the page's own device.
    folio = "00 / SIGNAL ISSUE"
    d.line([(MARGIN, MARGIN + 11), (W - MARGIN, MARGIN + 11)], fill=HAIRLINE, width=1)
    fw = d.textlength(folio, font=mono)
    d.rectangle([MARGIN - 2, MARGIN - 6, MARGIN + fw + 22, MARGIN + 28], fill=BG)
    d.text((MARGIN, MARGIN - 3), folio, font=mono, fill=AMBER)

    # The masthead, set as EditorialHero renders it: the brand over two lines,
    # the "Te" broken out in amber, then the signal line, then the JP lede.
    STEP = 122
    JP_BASELINE = H - 118
    SIGNAL_Y = JP_BASELINE - 52
    # Grow upward from the lede so the lockup can never land on it.
    y = SIGNAL_Y - 34 - STEP * 2

    d.text((MARGIN, y), "AlicE", font=display, fill=INK)
    y += STEP
    x = MARGIN
    for segment, colour in (("sYs", INK), ("Te", AMBER), ("M", INK)):
        d.text((x, y), segment, font=display, fill=colour)
        x += d.textlength(segment, font=display)

    live_text = f"{args.live} PLAYABLE"
    d.text((MARGIN, SIGNAL_Y), live_text, font=signal_font, fill=LIVE)
    x = MARGIN + d.textlength(live_text, font=signal_font)
    d.text((x, SIGNAL_Y), " · ", font=signal_font, fill=AMBER)
    x += d.textlength(" · ", font=signal_font)
    d.text((x, SIGNAL_Y), "AI-BUILT CATALOG", font=signal_font, fill=FAINT)

    d.text((MARGIN, JP_BASELINE), "AI と作る、いま遊べるゲームカタログ。", font=jp, fill=DIM)

    d.line([(MARGIN, H - 74), (W - MARGIN, H - 74)], fill=HAIRLINE, width=1)
    d.text((MARGIN, H - 58), "ALICE SYSTEM", font=mono, fill=INK)
    tail = "xenithone.github.io/alice-system"
    d.text((W - MARGIN - d.textlength(tail, font=mono), H - 58), tail, font=mono, fill=DIM)

    img.save(args.out, "JPEG", quality=88, optimize=True, progressive=True)
    print(f"OG WRITTEN: {args.out} {os.path.getsize(args.out)} bytes ({W}x{H})")


if __name__ == "__main__":
    main()
