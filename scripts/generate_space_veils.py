from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "public" / "assets"
WIDTH = 2048
HEIGHT = 1024
WORK_W = 1024
WORK_H = 512


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


def value_noise(rng: np.random.Generator, w: int, h: int, cell: int) -> np.ndarray:
    gw = max(2, math.ceil(w / cell) + 2)
    gh = max(2, math.ceil(h / cell) + 2)
    grid = rng.random((gh, gw), dtype=np.float32)
    y = np.linspace(0, gh - 2, h, dtype=np.float32)
    x = np.linspace(0, gw - 2, w, dtype=np.float32)
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
    return (a * (1.0 - xf) + b * xf) * (1.0 - yf) + (c * (1.0 - xf) + d * xf) * yf


def fbm(rng: np.random.Generator, w: int, h: int, cells: list[int]) -> np.ndarray:
    out = np.zeros((h, w), dtype=np.float32)
    weight = 0.0
    amp = 1.0
    for cell in cells:
        out += value_noise(rng, w, h, cell) * amp
        weight += amp
        amp *= 0.52
    return normalize(out / max(weight, 1e-6))


def make_veil(filename: str, seed: int, palette: list[int], accent: int, roll: float) -> None:
    rng = np.random.default_rng(seed)
    x = np.linspace(-1.0, 1.0, WORK_W, dtype=np.float32)
    y = np.linspace(-1.0, 1.0, WORK_H, dtype=np.float32)
    u, v = np.meshgrid(x, y)

    xr = u * math.cos(roll) - v * math.sin(roll)
    yr = u * math.sin(roll) + v * math.cos(roll)
    broad = fbm(rng, WORK_W, WORK_H, [220, 110, 56, 29, 15])
    fine = fbm(rng, WORK_W, WORK_H, [42, 21, 11, 6])
    micro = fbm(rng, WORK_W, WORK_H, [12, 6, 3])
    curl = np.sin((xr * 2.8 + broad * 2.4) * math.tau + np.sin(yr * 4.1) * 1.1)
    curl2 = np.sin((yr * 5.7 - fine * 3.5) * math.tau + np.cos(xr * 3.4) * 1.5)
    ribbon = np.exp(-np.abs(yr + np.sin(xr * 3.2 + broad * 3.0) * 0.2) * 2.6)
    tendrils = np.exp(-np.abs(curl * 0.58 + curl2 * 0.42) * 2.8)
    knots = smoothstep(0.66, 0.96, broad * 0.64 + fine * 0.36)
    stars = smoothstep(0.985, 0.999, micro) * smoothstep(0.52, 0.92, broad)
    aperture = 1.0 - smoothstep(0.14, 1.38, np.sqrt((u * 0.82) ** 2 + (v * 1.08) ** 2))
    vertical_gate = smoothstep(-0.98, -0.72, v) * (1.0 - smoothstep(0.82, 0.99, v))
    alpha = (ribbon * 0.24 + tendrils * knots * 0.82 + stars * 0.82) * aperture * vertical_gate
    alpha = np.clip(alpha * (0.52 + fine * 0.62), 0.0, 1.0)

    stops = [hex_rgb(c) for c in palette]
    field = normalize(broad * 0.46 + fine * 0.38 + xr * 0.16)
    scaled = np.clip(field, 0.0, 0.999) * (len(stops) - 1)
    idx = np.floor(scaled).astype(np.int32)
    local = (scaled - idx)[..., None]
    a = np.stack([stops[i] for i in idx.reshape(-1)]).reshape(field.shape + (3,))
    b = np.stack([stops[min(i + 1, len(stops) - 1)] for i in idx.reshape(-1)]).reshape(field.shape + (3,))
    color = a * (1.0 - local) + b * local
    color = color * (0.34 + tendrils[..., None] * 1.15 + stars[..., None] * 1.9)
    color += hex_rgb(accent) * (stars[..., None] * 0.9 + knots[..., None] * tendrils[..., None] * 0.18)

    rgba = np.dstack((np.clip(color * 255.0, 0, 255), np.clip(alpha * 245.0, 0, 255))).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA")
    img = img.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    img = img.filter(ImageFilter.GaussianBlur(0.35)).filter(ImageFilter.UnsharpMask(radius=1.4, percent=128, threshold=2))
    out = ASSET_DIR / filename
    img.save(out, optimize=True)
    print(f"saved {out.relative_to(ROOT)} {out.stat().st_size:,} bytes")


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    make_veil(
        "nebula-veil-cyan-hq.png",
        77219,
        [0x050816, 0x062033, 0x0d6b7b, 0x41ffe8, 0xd7fff8],
        0xffd98a,
        -0.22,
    )
    make_veil(
        "nebula-veil-magenta-hq.png",
        91877,
        [0x080414, 0x20113d, 0x5e2d88, 0xff5c9d, 0xffe2b2],
        0x7fffea,
        0.27,
    )


if __name__ == "__main__":
    main()
