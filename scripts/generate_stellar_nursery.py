from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "public" / "assets"
WORK_W = 1024
WORK_H = 512
OUT_W = 2048
OUT_H = 1024


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


def palette_mix(field: np.ndarray, stops: list[int]) -> np.ndarray:
    colors = [hex_rgb(stop) for stop in stops]
    scaled = np.clip(field, 0.0, 0.999) * (len(colors) - 1)
    idx = np.floor(scaled).astype(np.int32)
    local = (scaled - idx)[..., None]
    a = np.stack([colors[i] for i in idx.reshape(-1)]).reshape(field.shape + (3,))
    b = np.stack([colors[min(i + 1, len(colors) - 1)] for i in idx.reshape(-1)]).reshape(field.shape + (3,))
    return a * (1.0 - local) + b * local


def save_rgba(filename: str, rgba: np.ndarray, blur: float = 0.25, sharp: int = 120) -> None:
    img = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")
    img = img.resize((OUT_W, OUT_H), Image.Resampling.LANCZOS)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    img = img.filter(ImageFilter.UnsharpMask(radius=1.35, percent=sharp, threshold=2))
    out = ASSET_DIR / filename
    img.save(out, optimize=True)
    print(f"saved {out.relative_to(ROOT)} {out.stat().st_size:,} bytes")


def make_stellar_nursery() -> None:
    rng = np.random.default_rng(120731)
    x = np.linspace(-1.0, 1.0, WORK_W, dtype=np.float32)
    y = np.linspace(-1.0, 1.0, WORK_H, dtype=np.float32)
    u, v = np.meshgrid(x, y)

    broad = fbm(rng, [250, 132, 66, 33, 17])
    curl = fbm(rng, [96, 48, 24, 12])
    fine = fbm(rng, [34, 17, 9, 5])
    micro = fbm(rng, [9, 5, 3])

    arm_a = np.sin((u * 2.25 + broad * 2.15) * math.tau + np.sin(v * 4.1) * 1.15)
    arm_b = np.cos((v * 4.65 - curl * 2.7) * math.tau + np.sin(u * 3.4) * 1.42)
    filament = np.exp(-np.abs(arm_a * 0.62 + arm_b * 0.38) * 2.85)
    channel = np.exp(-np.abs(v + np.sin(u * 3.0 + broad * 3.2) * 0.19) * 2.1)
    knots = smoothstep(0.58, 0.92, broad * 0.58 + fine * 0.42)
    aperture = 1.0 - smoothstep(0.16, 1.34, np.sqrt((u * 0.78) ** 2 + (v * 1.18) ** 2))
    vertical = smoothstep(-0.98, -0.74, v) * (1.0 - smoothstep(0.76, 1.0, v))
    stars = smoothstep(0.986, 0.999, micro) * smoothstep(0.42, 0.94, broad)
    star_core = smoothstep(0.994, 0.9996, micro) * smoothstep(0.54, 0.98, curl)
    ionized = smoothstep(0.7, 0.98, fine + channel * 0.26)

    alpha = (channel * 0.2 + filament * knots * 0.78 + ionized * 0.24 + stars * 0.88) * aperture * vertical
    alpha = np.clip(alpha * (0.5 + curl * 0.74), 0.0, 1.0)

    field = normalize(broad * 0.36 + curl * 0.34 + fine * 0.22 + (u + 1.0) * 0.08)
    color = palette_mix(field, [0x050816, 0x0c2740, 0x1a8fa2, 0x40ffe5, 0xff68ae, 0xffdf9b])
    color *= 0.24 + filament[..., None] * 1.18 + ionized[..., None] * 0.52 + stars[..., None] * 2.2
    color += hex_rgb(0xffe2a0) * star_core[..., None] * 1.8
    color += hex_rgb(0x7fffea) * knots[..., None] * filament[..., None] * 0.18

    rgba = np.dstack((color * 255.0, alpha * 250.0))
    save_rgba("stellar-nursery-hq.png", rgba, blur=0.18, sharp=135)


def make_dark_molecular_cloud() -> None:
    rng = np.random.default_rng(50021)
    x = np.linspace(-1.0, 1.0, WORK_W, dtype=np.float32)
    y = np.linspace(-1.0, 1.0, WORK_H, dtype=np.float32)
    u, v = np.meshgrid(x, y)

    broad = fbm(rng, [210, 96, 48, 24, 12])
    fine = fbm(rng, [44, 21, 10, 5])
    thread = np.sin((u * 3.4 + broad * 2.3) * math.tau + np.cos(v * 4.0) * 1.2)
    thread_b = np.cos((v * 5.6 - fine * 2.1) * math.tau + np.sin(u * 2.7) * 1.0)
    vein = np.exp(-np.abs(thread * 0.58 + thread_b * 0.42) * 2.55)
    ridge = smoothstep(0.48, 0.88, broad * 0.72 + fine * 0.28)
    aperture = 1.0 - smoothstep(0.1, 1.28, np.sqrt((u * 0.92) ** 2 + (v * 1.04) ** 2))
    ragged = smoothstep(0.48, 0.82, fine + vein * 0.32)
    alpha = np.clip((ridge * 0.46 + vein * ragged * 0.72) * aperture * (0.52 + fine * 0.54), 0.0, 1.0)
    holes = smoothstep(0.72, 0.96, fbm(rng, [72, 36, 18, 9]))
    alpha *= 1.0 - holes * 0.28

    color = palette_mix(normalize(broad * 0.64 + v * 0.16), [0x00030a, 0x020917, 0x06142a, 0x10203d])
    color *= 0.66 + fine[..., None] * 0.24
    rgba = np.dstack((color * 255.0, alpha * 190.0))
    save_rgba("stellar-dust-mask-hq.png", rgba, blur=0.45, sharp=95)


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    make_stellar_nursery()
    make_dark_molecular_cloud()


if __name__ == "__main__":
    main()
