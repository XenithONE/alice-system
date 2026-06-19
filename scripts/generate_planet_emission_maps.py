from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "public" / "assets"
WIDTH = 2048
HEIGHT = 1024


def hex_rgb(value: int) -> np.ndarray:
    return np.array([(value >> 16) & 255, (value >> 8) & 255, value & 255], dtype=np.float32) / 255.0


def normalize(a: np.ndarray) -> np.ndarray:
    mn = float(a.min())
    mx = float(a.max())
    if mx - mn < 1e-6:
        return np.zeros_like(a)
    return (a - mn) / (mx - mn)


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / max(1e-6, edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def hash_field(x: np.ndarray, y: np.ndarray, seed: float) -> np.ndarray:
    p = np.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
    return p - np.floor(p)


def emission_path(source: Path) -> Path:
    return source.with_name(f"{source.stem}-emission.jpg")


def make_emission(filename: str, seed: int, accent: int, warm: int, mode: str) -> None:
    source = ASSET_DIR / filename
    if not source.exists():
        print(f"skip missing {source.relative_to(ROOT)}")
        return

    img = Image.open(source).convert("RGB").resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    lum = arr[..., 0] * 0.2126 + arr[..., 1] * 0.7152 + arr[..., 2] * 0.0722
    blurred = np.asarray(
        Image.fromarray(np.uint8(np.clip(lum * 255, 0, 255)), "L").filter(ImageFilter.GaussianBlur(10)),
        dtype=np.float32,
    ) / 255.0
    edge = normalize(np.abs(lum - blurred))

    x = np.linspace(-math.pi, math.pi, WIDTH, endpoint=False, dtype=np.float32)
    y = np.linspace(-math.pi / 2, math.pi / 2, HEIGHT, dtype=np.float32)
    lon, lat = np.meshgrid(x, y)
    latitude = 1.0 - smoothstep(0.58, 1.0, np.abs(lat) / (math.pi / 2))
    polar = smoothstep(0.54, 0.92, np.abs(lat) / (math.pi / 2))

    h1 = hash_field(np.floor((lon + math.pi) * 18.0), np.floor((lat + math.pi / 2) * 28.0), seed)
    h2 = hash_field(np.floor((lon + math.pi) * 74.0), np.floor((lat + math.pi / 2) * 43.0), seed * 1.71)
    h3 = hash_field(np.floor((lon + math.pi) * 138.0), np.floor((lat + math.pi / 2) * 78.0), seed * 2.19)

    lane_a = np.exp(-np.abs(np.sin(lon * (8.0 + seed % 7) + lat * (3.0 + seed % 5) + edge * 4.8)) * 30.0)
    lane_b = np.exp(-np.abs(np.sin(lon * (17.0 + seed % 11) - lat * (7.0 + seed % 3) + blurred * 5.6)) * 42.0)
    circuit = np.maximum(lane_a * smoothstep(0.55, 0.95, h1), lane_b * smoothstep(0.65, 0.98, h2))
    nodes = smoothstep(0.972, 0.999, h3) * smoothstep(0.08, 0.62, edge + lum * 0.28)
    fissures = np.exp(-np.abs(np.sin(lon * (5.0 + seed % 9) + lat * (11.0 + seed % 7) + edge * 10.0)) * 18.0)
    fissures *= smoothstep(0.18, 0.78, edge)
    aurora = polar * smoothstep(0.64, 0.96, hash_field(lon * 22.0, lat * 14.0, seed * 0.33))

    if mode in {"rift", "signal", "core", "observer"}:
        intensity = circuit * 0.42 + nodes * 0.88 + fissures * 0.14 + aurora * 0.22
        color_a = hex_rgb(accent)
        color_b = hex_rgb(0xffffff)
    elif mode in {"dragons", "iwbtg"}:
        lava = fissures * 0.9 + circuit * 0.16 + nodes * 0.42
        intensity = lava * (0.72 + edge * 0.32)
        color_a = hex_rgb(warm)
        color_b = hex_rgb(accent)
    elif mode == "constellation":
        intensity = nodes * 1.0 + circuit * 0.22 + aurora * 0.18
        color_a = hex_rgb(accent)
        color_b = hex_rgb(0xfff0c8)
    elif mode == "locker":
        intensity = circuit * 0.26 + nodes * 0.76 + fissures * 0.08
        color_a = hex_rgb(accent)
        color_b = hex_rgb(warm)
    else:
        intensity = circuit * 0.28 + nodes * 0.72 + aurora * 0.2
        color_a = hex_rgb(accent)
        color_b = hex_rgb(warm)

    intensity *= latitude * (0.62 + smoothstep(0.0, 0.82, edge) * 0.5)
    intensity = np.clip(intensity, 0.0, 1.0)
    color_mix = smoothstep(0.35, 0.92, nodes + fissures * 0.4)[..., None]
    rgb = (color_a * (1.0 - color_mix) + color_b * color_mix) * intensity[..., None]
    rgb += hex_rgb(warm) * (aurora * 0.08)[..., None]
    rgb = np.clip(rgb, 0.0, 1.0)

    out_img = Image.fromarray(np.uint8(rgb * 255.0), "RGB")
    layer = out_img.convert("RGBA")
    draw = ImageDraw.Draw(layer, "RGBA")
    rng = np.random.default_rng(seed)

    if mode == "constellation":
        accent_rgb = tuple(int(v) for v in (hex_rgb(accent) * 255).astype(np.uint8))
        points: list[tuple[float, float]] = []
        for _ in range(120):
            px = float(rng.random() * WIDTH)
            py = float((0.16 + rng.random() * 0.68) * HEIGHT)
            points.append((px, py))
            r = 1.0 + rng.random() * 2.2
            draw.ellipse((px - r, py - r, px + r, py + r), fill=(*accent_rgb, 120))
        for _ in range(56):
            a = points[int(rng.integers(0, len(points)))]
            b = points[int(rng.integers(0, len(points)))]
            if abs(a[0] - b[0]) < WIDTH * 0.16 and abs(a[1] - b[1]) < HEIGHT * 0.12:
                draw.line([a, b], fill=(*accent_rgb, 62), width=1)

    layer = layer.filter(ImageFilter.GaussianBlur(0.24)).filter(ImageFilter.UnsharpMask(radius=0.9, percent=118, threshold=1))
    out = emission_path(source)
    layer.convert("RGB").save(out, quality=92, optimize=True, progressive=True, subsampling=1)
    print(f"saved {out.relative_to(ROOT)} {out.stat().st_size:,} bytes")


PLANETS = [
    ("planet-eidolon-hq.jpg", 6117, 0x9FB6FF, 0x7B4DFF, "eidolon"),
    ("planet-rift-hq.jpg", 9121, 0x7FFFEA, 0xFFD98A, "rift"),
    ("planet-iwbtg-hq.jpg", 1559, 0xFF8EBC, 0xFFD24A, "iwbtg"),
    ("planet-locker-hq.jpg", 4283, 0x9BFFC0, 0xF0B36B, "locker"),
    ("planet-constellation-hq.jpg", 7321, 0xE5ECFF, 0xFFF0C8, "constellation"),
    ("planet-dragons-hq.png", 2407, 0xFFC16E, 0xFF5C2B, "dragons"),
    ("planet-signal-hq.png", 5309, 0x6FFFF0, 0xFFD98A, "signal"),
    ("planet-core-hq.jpg", 8227, 0xD0A6FF, 0x33E7C8, "core"),
    ("planet-observer-hq.jpg", 9907, 0x33E7C8, 0x7B4DFF, "observer"),
]


def main() -> None:
    for args in PLANETS:
        make_emission(*args)


if __name__ == "__main__":
    main()
