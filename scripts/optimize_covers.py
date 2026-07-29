"""Width derivatives for the works grid.

Every cover is 1280x800 and every poster 1024x1536, and the grid shows most of
them in a 344 CSS px tile. That is roughly a quarter of the pixels the file
carries, so the browser downloads four times what it draws and then throws the
rest away.

Rather than pick a quality and hope, each output is given a byte budget derived
from its area, and quality steps down until it fits. Two guards keep that
honest: nothing is written that came out larger than the source, and nothing is
upscaled - a 1280-wide source has no 1440 derivative to give.

Pillow only; no npm dependency and nothing new in CI, which runs `npm ci &&
npm run build`. The derivatives are committed.

  python scripts/optimize_covers.py [--check]

--check re-derives into memory and fails if any committed file is missing or
differs in size, so a new cover cannot be added without its derivatives.
"""

from __future__ import annotations

import io
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
OUT_DIR = os.path.join(PUBLIC, "assets", "derived")

# The widths live here and nowhere else. The grid reads this manifest to build
# its srcset, so a width this script does not emit is a width the markup cannot
# ask for - which is the point. Writing the list again in TypeScript would be
# the same defect this rebuild keeps finding: one fact, two places, drifting.
MANIFEST = os.path.join(ROOT, "src", "data", "imageDerivatives.json")

# The tiles are 344 CSS px except the XL at ~702. Doubling for dense screens
# lands on 720 and 1280; 400 and 960 fill the gaps between.
COVER_WIDTHS = (400, 720, 960, 1280)
POSTER_WIDTHS = (360, 560, 760, 1024)

# Bytes per pixel. 0.122 is what the current covers average; 0.027 has been hit
# with this same encoder on this same art, so 0.055 is a real target rather
# than an aspiration, and small sizes get more because overhead does not shrink.
def budget(width: int, height: int) -> int:
    px = width * height
    return int(px * (0.075 if px < 200_000 else 0.055)) + 3_000


def sources() -> list[str]:
    """Covers and posters named by the data layer, not everything in assets/."""
    text = ""
    for name in ("works.ts", "arenaGames.ts"):
        with io.open(os.path.join(ROOT, "src", "data", name), encoding="utf-8") as fh:
            text += fh.read()
    return sorted(set(re.findall(r'(?:cover|poster):\s*"([^"]+)"', text)))


def derive(rel: str, check: bool, manifest: dict) -> tuple[int, int, list[str]]:
    """Returns (bytes written, bytes of source, problems)."""
    src = os.path.join(PUBLIC, rel)
    problems: list[str] = []
    if not os.path.exists(src):
        return 0, 0, [f"missing source: {rel}"]

    with Image.open(src) as im:
        im = im.convert("RGB")
        sw, sh = im.size
        widths = POSTER_WIDTHS if sh > sw else COVER_WIDTHS
        stem = os.path.splitext(os.path.basename(rel))[0]
        written = 0
        emitted: list[int] = []

        for w in widths:
            if w > sw:
                continue  # never upscale
            h = round(sh * w / sw)
            small = im.resize((w, h), Image.LANCZOS) if w != sw else im
            cap = budget(w, h)

            best = None
            for quality in (82, 76, 70, 64, 58, 52):
                buf = io.BytesIO()
                small.save(buf, "WEBP", quality=quality, method=6)
                best = buf.getvalue()
                if len(best) <= cap:
                    break

            out = os.path.join(OUT_DIR, f"{stem}-{w}.webp")
            # A derivative bigger than the file it replaces is not a derivative.
            if len(best) >= os.path.getsize(src) and w == sw:
                if os.path.exists(out):
                    os.remove(out)
                continue
            emitted.append(w)

            if check:
                if not os.path.exists(out):
                    problems.append(f"{stem}-{w}.webp missing")
                elif os.path.getsize(out) != len(best):
                    problems.append(
                        f"{stem}-{w}.webp is {os.path.getsize(out)}, expected {len(best)}"
                    )
            else:
                os.makedirs(OUT_DIR, exist_ok=True)
                with open(out, "wb") as fh:
                    fh.write(best)
            written += len(best)

        manifest[rel] = {"w": sw, "h": sh, "widths": emitted}

    return written, os.path.getsize(src), problems


def main() -> int:
    check = "--check" in sys.argv
    total_new = total_old = 0
    problems: list[str] = []
    manifest: dict = {}
    for rel in sources():
        new, old, errs = derive(rel, check, manifest)
        total_new += new
        total_old += old
        problems.extend(errs)
        if not check and new:
            print(f"  {os.path.basename(rel):<34} {old:>8} -> {new:>8} across widths")

    text = json.dumps(manifest, indent=2, sort_keys=True) + chr(10)
    if check:
        with io.open(MANIFEST, encoding="utf-8") as fh:
            if fh.read().replace(chr(13) + chr(10), chr(10)) != text:
                problems.append("src/data/imageDerivatives.json is stale")
    else:
        with io.open(MANIFEST, "w", encoding="utf-8", newline=chr(10)) as fh:
            fh.write(text)

    if check:
        if problems:
            print("DERIVATIVES FAIL")
            for p in problems:
                print(f"  {p}")
            print("  fix: python scripts/optimize_covers.py")
            return 1
        print(f"DERIVATIVES PASS - every source has its widths, {total_new} bytes total")
        return 0

    print(f"\nsources {total_old} bytes -> derivatives {total_new} bytes (all widths)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
