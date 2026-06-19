from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "public" / "assets"
WORK = 1024
OUT = 2048


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


def value_noise(rng: np.random.Generator, cell: int) -> np.ndarray:
    gw = max(3, math.ceil(WORK / cell) + 3)
    gh = max(3, math.ceil(WORK / cell) + 3)
    grid = rng.random((gh, gw), dtype=np.float32)
    x = np.linspace(0, gw - 2, WORK, dtype=np.float32)
    y = np.linspace(0, gh - 2, WORK, dtype=np.float32)
    xx, yy = np.meshgrid(x, y)
    x0 = np.floor(xx).astype(np.int32)
    y0 = np.floor(yy).astype(np.int32)
    xf = xx - x0
    yf = yy - y0
    xf = xf * xf * (3.0 - 2.0 * xf)
    yf = yf * yf * (3.0 - 2.0 * yf)
    a = grid[y0, x0]
    b = grid[y0, x0 + 1]
    c = grid[y0 + 1, x0]
    d = grid[y0 + 1, x0 + 1]
    return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf


def fbm(rng: np.random.Generator, cells: list[int]) -> np.ndarray:
    total = np.zeros((WORK, WORK), dtype=np.float32)
    amp = 1.0
    weight = 0.0
    for cell in cells:
        total += value_noise(rng, cell) * amp
        weight += amp
        amp *= 0.52
    return normalize(total / max(weight, 1e-6))


def palette(field: np.ndarray, colors: list[int]) -> np.ndarray:
    stops = [hex_rgb(color) for color in colors]
    scaled = np.clip(field, 0.0, 0.999) * (len(stops) - 1)
    idx = np.floor(scaled).astype(np.int32)
    local = (scaled - idx)[..., None]
    a = np.stack([stops[i] for i in idx.reshape(-1)]).reshape(field.shape + (3,))
    b = np.stack([stops[min(i + 1, len(stops) - 1)] for i in idx.reshape(-1)]).reshape(field.shape + (3,))
    return a * (1.0 - local) + b * local


def make_volume(filename: str, seed: int, colors: list[int], accent: int, warm: int, dark: bool, roll: float) -> None:
    rng = np.random.default_rng(seed)
    axis = np.linspace(-1.0, 1.0, WORK, dtype=np.float32)
    u, v = np.meshgrid(axis, axis)
    xr = u * math.cos(roll) - v * math.sin(roll)
    yr = u * math.sin(roll) + v * math.cos(roll)

    broad = fbm(rng, [360, 180, 90, 45, 22])
    curl = fbm(rng, [140, 70, 35, 18, 9])
    fine = fbm(rng, [42, 21, 11, 6, 3])
    micro = fbm(rng, [12, 6, 3])

    spiral = np.sin((xr * 2.1 + broad * 2.2) * math.tau + np.cos(yr * 3.7 + curl * 1.4) * 1.1)
    lane = np.cos((yr * 2.8 - curl * 2.6) * math.tau + np.sin(xr * 4.2) * 1.3)
    filament = np.exp(-np.abs(spiral * 0.68 + lane * 0.32) * 2.05)
    knots = smoothstep(0.66, 0.98, curl * 0.44 + fine * 0.56)
    dust = smoothstep(0.46, 0.9, broad * 0.64 + fine * 0.36)
    stars = smoothstep(0.989, 0.9994, micro) * smoothstep(0.54, 0.96, curl)

    radius = np.sqrt((u * 0.86) ** 2 + (v * 1.08) ** 2)
    aperture = 1.0 - smoothstep(0.18, 1.15, radius)
    torn_edge = 0.58 + broad * 0.46 + np.sin(xr * 21.0 + curl * 4.0) * 0.06
    alpha = (filament * dust * 0.76 + knots * 0.34 + stars * 0.9) * aperture * torn_edge
    alpha = np.clip(alpha, 0.0, 1.0)

    field = normalize(broad * 0.28 + curl * 0.36 + fine * 0.22 + (xr + 1.0) * 0.14)
    color = palette(field, colors)
    if dark:
        color *= 0.08 + dust[..., None] * 0.38 + filament[..., None] * 0.18
        color += hex_rgb(accent) * (knots * 0.08)[..., None]
        alpha *= 0.62
    else:
        color *= 0.14 + filament[..., None] * 1.18 + knots[..., None] * 0.42 + stars[..., None] * 2.2
        color += hex_rgb(accent) * (filament * dust * 0.28)[..., None]
        color += hex_rgb(warm) * stars[..., None] * 1.8

    rgba = np.dstack((np.clip(color * 255.0, 0, 255), np.clip(alpha * (220 if dark else 245), 0, 255))).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA").resize((OUT, OUT), Image.Resampling.LANCZOS)
    img = img.filter(ImageFilter.GaussianBlur(0.18)).filter(ImageFilter.UnsharpMask(radius=1.15, percent=135, threshold=2))
    out = ASSET_DIR / filename
    img.save(out, optimize=True)
    print(f"saved {out.relative_to(ROOT)} {out.stat().st_size:,} bytes")


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    make_volume(
        "volumetric-nebula-core-hq.png",
        603077,
        [0x01030a, 0x06142d, 0x0a5f76, 0x33e7c8, 0xffd99c],
        0x8ffff2,
        0xffe3a8,
        False,
        -0.18,
    )
    make_volume(
        "volumetric-nebula-shadow-hq.png",
        774221,
        [0x000105, 0x030818, 0x07172f, 0x16213f, 0x314058],
        0x4ff7e8,
        0xffb66d,
        True,
        0.27,
    )


if __name__ == "__main__":
    main()
