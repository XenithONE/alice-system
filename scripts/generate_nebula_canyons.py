from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "public" / "assets"
WORK_W = 1280
WORK_H = 720
OUT_W = 2560
OUT_H = 1440


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


def fbm(rng: np.random.Generator, cells: list[int]) -> np.ndarray:
    out = np.zeros((WORK_H, WORK_W), dtype=np.float32)
    weight = 0.0
    amp = 1.0
    for cell in cells:
        out += value_noise(rng, WORK_W, WORK_H, cell) * amp
        weight += amp
        amp *= 0.52
    return normalize(out / max(weight, 1e-6))


def palette(field: np.ndarray, colors: list[int]) -> np.ndarray:
    stops = [hex_rgb(color) for color in colors]
    scaled = np.clip(field, 0.0, 0.999) * (len(stops) - 1)
    idx = np.floor(scaled).astype(np.int32)
    local = (scaled - idx)[..., None]
    a = np.stack([stops[i] for i in idx.reshape(-1)]).reshape(field.shape + (3,))
    b = np.stack([stops[min(i + 1, len(stops) - 1)] for i in idx.reshape(-1)]).reshape(field.shape + (3,))
    return a * (1.0 - local) + b * local


def make_canyon(filename: str, seed: int, colors: list[int], accent: int, warm: int, roll: float) -> None:
    rng = np.random.default_rng(seed)
    x = np.linspace(-1.0, 1.0, WORK_W, dtype=np.float32)
    y = np.linspace(-1.0, 1.0, WORK_H, dtype=np.float32)
    u, v = np.meshgrid(x, y)
    xr = u * math.cos(roll) - v * math.sin(roll)
    yr = u * math.sin(roll) + v * math.cos(roll)

    broad = fbm(rng, [320, 160, 80, 40, 20])
    curl = fbm(rng, [120, 60, 30, 15])
    fine = fbm(rng, [36, 18, 9, 5])
    micro = fbm(rng, [10, 5, 3])

    arm_a = np.sin((xr * 2.2 + broad * 2.9) * math.tau + np.sin(yr * 4.6) * 1.2)
    arm_b = np.cos((yr * 5.9 - curl * 3.1) * math.tau + np.sin(xr * 3.6) * 1.7)
    canyon = np.exp(-np.abs(arm_a * 0.62 + arm_b * 0.38) * 2.35)
    lane = np.exp(-np.abs(yr + np.sin(xr * 3.8 + broad * 2.7) * 0.24) * 1.9)
    edge = smoothstep(0.5, 0.92, broad * 0.54 + fine * 0.46)
    knots = smoothstep(0.68, 0.98, curl * 0.52 + fine * 0.48)
    stars = smoothstep(0.987, 0.9992, micro) * smoothstep(0.48, 0.96, broad)
    hot_stars = smoothstep(0.994, 0.9996, micro) * smoothstep(0.62, 0.99, curl)

    radius = np.sqrt((u * 0.78) ** 2 + (v * 1.18) ** 2)
    aperture = 1.0 - smoothstep(0.18, 1.32, radius)
    ragged = 0.76 + fine * 0.36 + np.sin(xr * 18.0 + curl * 2.5) * 0.06
    alpha = (lane * 0.22 + canyon * edge * 0.88 + knots * 0.26 + stars * 0.96) * aperture * ragged
    alpha = np.clip(alpha, 0.0, 1.0)

    field = normalize(broad * 0.36 + curl * 0.34 + fine * 0.2 + (xr + 1.0) * 0.1)
    color = palette(field, colors)
    color *= 0.22 + canyon[..., None] * 1.2 + knots[..., None] * 0.42 + stars[..., None] * 2.4
    color += hex_rgb(accent) * (canyon * edge)[..., None] * 0.24
    color += hex_rgb(warm) * hot_stars[..., None] * 1.8

    rgba = np.dstack((np.clip(color * 255.0, 0, 255), np.clip(alpha * 248.0, 0, 255))).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA").resize((OUT_W, OUT_H), Image.Resampling.LANCZOS)
    img = img.filter(ImageFilter.GaussianBlur(0.22)).filter(ImageFilter.UnsharpMask(radius=1.2, percent=145, threshold=2))
    out = ASSET_DIR / filename
    img.save(out, optimize=True)
    print(f"saved {out.relative_to(ROOT)} {out.stat().st_size:,} bytes")


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    make_canyon(
        "nebula-canyon-cyan-hq.png",
        731927,
        [0x02050d, 0x07182c, 0x0c4d64, 0x27e9d5, 0xd7fff6],
        0xffbd78,
        0xffe1a8,
        -0.28,
    )
    make_canyon(
        "nebula-canyon-magenta-hq.png",
        915331,
        [0x05030d, 0x171136, 0x462468, 0xff559d, 0xffdca8],
        0x62fff0,
        0xffefbf,
        0.24,
    )


if __name__ == "__main__":
    main()
