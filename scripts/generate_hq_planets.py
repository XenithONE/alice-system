from __future__ import annotations

import colorsys
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "public" / "assets"
WIDTH = 2048
HEIGHT = 1024
WORK_W = 1024
WORK_H = 512
RING_W = 2048
RING_H = 256


def hex_rgb(value: int) -> np.ndarray:
    return np.array([(value >> 16) & 255, (value >> 8) & 255, value & 255], dtype=np.float32) / 255.0


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / max(1e-6, edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def normalize(a: np.ndarray) -> np.ndarray:
    mn = float(a.min())
    mx = float(a.max())
    if mx - mn < 1e-6:
        return np.zeros_like(a)
    return (a - mn) / (mx - mn)


def wave_field(rng: np.random.Generator, lon: np.ndarray, lat: np.ndarray, terms: int, max_freq: int, warp: float = 0.0) -> np.ndarray:
    field = np.zeros_like(lon, dtype=np.float32)
    weight_sum = 0.0
    for _ in range(terms):
        k = int(rng.integers(1, max_freq + 1))
        m = int(rng.integers(-max_freq // 2, max_freq // 2 + 1))
        phase = float(rng.random() * math.tau)
        amp = float(1.0 / (0.65 + k * 0.28 + abs(m) * 0.18))
        field += np.sin(lon * k + lat * m + phase + warp * np.sin(lat * (m + 2.0))) * amp
        weight_sum += amp
    return normalize(field / max(weight_sum, 1e-6))


def palette_map(field: np.ndarray, colors: list[int]) -> np.ndarray:
    stops = [hex_rgb(c) for c in colors]
    scaled = np.clip(field, 0.0, 0.999) * (len(stops) - 1)
    idx = np.floor(scaled).astype(np.int32)
    local = (scaled - idx)[..., None]
    a = np.stack([stops[i] for i in idx.reshape(-1)]).reshape(field.shape + (3,))
    b_idx = np.minimum(idx + 1, len(stops) - 1)
    b = np.stack([stops[i] for i in b_idx.reshape(-1)]).reshape(field.shape + (3,))
    return a * (1.0 - local) + b * local


def to_image(rgb: np.ndarray) -> Image.Image:
    arr = np.clip(rgb * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGB").resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)


def add_glow_line(layer: Image.Image, points: list[tuple[float, float]], color: tuple[int, int, int], width: int, alpha: int) -> None:
    glow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    sharp = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    s = ImageDraw.Draw(sharp)
    rgba = (*color, alpha)
    g.line(points, fill=rgba, width=max(width * 5, 5), joint="curve")
    glow = glow.filter(ImageFilter.GaussianBlur(max(2, width * 2)))
    s.line(points, fill=(*color, min(255, int(alpha * 1.35))), width=width, joint="curve")
    layer.alpha_composite(glow)
    layer.alpha_composite(sharp)


def draw_theme_detail(img: Image.Image, spec: dict[str, object], rng: np.random.Generator) -> Image.Image:
    layer = img.convert("RGBA")
    accent = tuple(int(v) for v in spec["accent_rgb"])  # type: ignore[index]
    warm = tuple(int(v) for v in spec["warm_rgb"])  # type: ignore[index]
    mode = str(spec["mode"])

    if mode in {"rift", "core", "observer"}:
        count = {"rift": 34, "core": 28, "observer": 22}[mode]
        for _ in range(count):
            x0 = float(rng.random() * WIDTH)
            y0 = float((0.14 + rng.random() * 0.72) * HEIGHT)
            pts: list[tuple[float, float]] = []
            length = int(6 + rng.integers(4, 12))
            angle = float((rng.random() - 0.5) * 1.4)
            for i in range(length):
                t = i / max(1, length - 1)
                x = (x0 + (t - 0.5) * WIDTH * (0.18 + rng.random() * 0.24) + math.sin(t * math.tau * 2.0 + x0) * 46) % WIDTH
                y = y0 + math.sin(t * math.pi + angle) * HEIGHT * (0.05 + rng.random() * 0.05) + (t - 0.5) * HEIGHT * 0.12 * math.sin(angle)
                pts.append((x, y))
            add_glow_line(layer, pts, accent if rng.random() > 0.18 else warm, int(rng.integers(1, 4)), int(rng.integers(54, 116)))

    if mode == "constellation":
        draw = ImageDraw.Draw(layer)
        stars: list[tuple[float, float]] = []
        for _ in range(170):
            x = float(rng.random() * WIDTH)
            y = float((0.1 + rng.random() * 0.78) * HEIGHT)
            stars.append((x, y))
            r = float(1.0 + rng.random() * 2.8)
            draw.ellipse((x - r, y - r, x + r, y + r), fill=(*accent, int(120 + rng.random() * 105)))
        for _ in range(78):
            a = stars[int(rng.integers(0, len(stars)))]
            b = stars[int(rng.integers(0, len(stars)))]
            if abs(a[0] - b[0]) < WIDTH * 0.18 and abs(a[1] - b[1]) < HEIGHT * 0.16:
                draw.line([a, b], fill=(*accent, int(32 + rng.random() * 60)), width=1)

    if mode == "locker":
        draw = ImageDraw.Draw(layer)
        for _ in range(95):
            x = float(rng.random() * WIDTH)
            y = float(rng.random() * HEIGHT)
            w = float(18 + rng.random() * 110)
            h = float(5 + rng.random() * 38)
            col = warm if rng.random() > 0.55 else accent
            draw.rounded_rectangle((x, y, x + w, y + h), radius=3, outline=(*col, int(24 + rng.random() * 70)), width=1)

    if mode == "iwbtg":
        draw = ImageDraw.Draw(layer)
        for _ in range(150):
            x = float(rng.random() * WIDTH)
            y = float(rng.random() * HEIGHT)
            s = float(8 + rng.random() * 42)
            col = accent if rng.random() > 0.4 else warm
            pts = [(x, y - s), (x + s * 0.72, y + s * 0.72), (x - s * 0.72, y + s * 0.72)]
            draw.polygon(pts, outline=(*col, int(28 + rng.random() * 82)))

    if mode == "eidolon":
        draw = ImageDraw.Draw(layer)
        for _ in range(9):
            x = float(rng.random() * WIDTH)
            y = float((0.18 + rng.random() * 0.64) * HEIGHT)
            r = float(40 + rng.random() * 145)
            draw.ellipse((x - r, y - r * 0.55, x + r, y + r * 0.55), outline=(*accent, int(18 + rng.random() * 48)), width=int(1 + rng.random() * 3))

    layer = layer.filter(ImageFilter.UnsharpMask(radius=1.6, percent=126, threshold=3))
    return layer.convert("RGB")


def height_from_diffuse(img: Image.Image) -> np.ndarray:
    source = img.convert("RGB").resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    arr = np.asarray(source, dtype=np.float32) / 255.0
    lum = arr[..., 0] * 0.2126 + arr[..., 1] * 0.7152 + arr[..., 2] * 0.0722
    broad = np.asarray(Image.fromarray(np.uint8(np.clip(lum * 255, 0, 255)), "L").filter(ImageFilter.GaussianBlur(14)), dtype=np.float32) / 255.0
    fine = np.asarray(Image.fromarray(np.uint8(np.clip(lum * 255, 0, 255)), "L").filter(ImageFilter.UnsharpMask(radius=2.0, percent=165, threshold=3)), dtype=np.float32) / 255.0
    highpass = normalize(fine - broad)
    height = normalize(lum * 0.52 + highpass * 0.34 + normalize(lum - broad) * 0.14)
    return height.astype(np.float32)


def normal_from_height(height: np.ndarray, strength: float = 5.6) -> Image.Image:
    dx = np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)
    dy = np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(height)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack((nx / length, ny / length, nz / length), axis=-1)
    normal = (normal * 0.5 + 0.5) * 255.0
    return Image.fromarray(np.clip(normal, 0, 255).astype(np.uint8), "RGB").filter(ImageFilter.GaussianBlur(0.18))


def roughness_from_height(height: np.ndarray) -> Image.Image:
    edge = normalize(np.abs(np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) + np.abs(np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)))
    roughness = 0.74 - height * 0.28 + edge * 0.24
    roughness = np.clip(roughness, 0.36, 0.92)
    return Image.fromarray(np.uint8(roughness * 255), "L").filter(ImageFilter.GaussianBlur(0.22))


def derivative_path(path: Path, suffix: str) -> Path:
    return path.with_name(f"{path.stem}-{suffix}.jpg")


def save_derivatives(source_path: Path, img: Image.Image) -> None:
    height = height_from_diffuse(img)
    normal_path = derivative_path(source_path, "normal")
    roughness_path = derivative_path(source_path, "roughness")
    normal_from_height(height).save(normal_path, quality=92, optimize=True, progressive=True, subsampling=1)
    roughness_from_height(height).save(roughness_path, quality=90, optimize=True, progressive=True)
    print(f"saved {normal_path.relative_to(ROOT)} {normal_path.stat().st_size:,} bytes")
    print(f"saved {roughness_path.relative_to(ROOT)} {roughness_path.stat().st_size:,} bytes")


def make_planet(spec: dict[str, object]) -> Image.Image:
    rng = np.random.default_rng(int(spec["seed"]))
    x = np.linspace(-math.pi, math.pi, WORK_W, endpoint=False, dtype=np.float32)
    y = np.linspace(-math.pi / 2, math.pi / 2, WORK_H, dtype=np.float32)
    lon, lat = np.meshgrid(x, y)

    continents = wave_field(rng, lon, lat, 26, 12, 0.7)
    ridges = wave_field(rng, lon, lat, 34, 34, 1.6)
    fine = wave_field(rng, lon, lat, 22, 72, 2.2)
    bands = normalize(np.sin(lat * float(spec["band_scale"]) + (continents - 0.5) * 3.4 + np.sin(lon * 3.0) * 0.32))
    terrain = normalize(continents * 0.58 + ridges * 0.28 + bands * 0.14)
    rgb = palette_map(terrain, spec["palette"])  # type: ignore[arg-type]

    ridge_mask = smoothstep(0.54, 0.88, np.abs(ridges - 0.5) * 2.0)
    rgb *= 0.82 + fine[..., None] * 0.24
    rgb = rgb * (1.0 - ridge_mask[..., None] * 0.18) + hex_rgb(int(spec["accent"])) * ridge_mask[..., None] * float(spec["accent_mix"])

    mode = str(spec["mode"])
    crack_freq = float(spec["crack_freq"])
    cracks = np.exp(-np.abs(np.sin(lon * crack_freq + lat * float(spec["crack_lat"]) + ridges * 4.5)) * float(spec["crack_sharp"]))
    cracks *= smoothstep(float(spec["crack_gate"]), 0.98, fine)
    rgb = rgb * (1.0 - cracks[..., None] * 0.28) + hex_rgb(int(spec["accent"])) * cracks[..., None] * float(spec["crack_mix"])

    if mode == "locker":
        grid = np.maximum(np.exp(-np.abs(np.sin(lon * 18.0)) * 42.0), np.exp(-np.abs(np.sin(lat * 11.0)) * 54.0))
        rgb = rgb * (1.0 - grid[..., None] * 0.16) + hex_rgb(0xd8f0bc) * grid[..., None] * 0.14
    elif mode == "core":
        waveform = np.exp(-np.abs(np.sin(lon * 14.0 + np.sin(lat * 8.0) * 1.8)) * 26.0)
        rgb += hex_rgb(0xd0a6ff) * waveform[..., None] * 0.28
    elif mode == "constellation":
        ice = smoothstep(0.48, 0.95, ridges)
        rgb = rgb * (1.0 - ice[..., None] * 0.12) + hex_rgb(0xffffff) * ice[..., None] * 0.16
    elif mode == "observer":
        eye = np.exp(-((lon * 0.9) ** 2 + (lat * 2.2) ** 2)) * 0.85
        rgb = rgb * (1.0 - eye[..., None] * 0.18) + hex_rgb(0x33e7c8) * eye[..., None] * 0.24

    latitude_light = 0.7 + 0.3 * np.power(np.clip(np.cos(lat), 0.0, 1.0), 0.35)
    rgb *= latitude_light[..., None]
    rgb = np.power(np.clip(rgb, 0.0, 1.0), 0.92)

    img = to_image(rgb)
    spec = dict(spec)
    spec["accent_rgb"] = tuple((hex_rgb(int(spec["accent"])) * 255).astype(np.uint8).tolist())
    spec["warm_rgb"] = tuple((hex_rgb(int(spec["warm"])) * 255).astype(np.uint8).tolist())
    return draw_theme_detail(img, spec, rng)


def make_clouds() -> Image.Image:
    rng = np.random.default_rng(77991)
    x = np.linspace(-math.pi, math.pi, WORK_W, endpoint=False, dtype=np.float32)
    y = np.linspace(-math.pi / 2, math.pi / 2, WORK_H, dtype=np.float32)
    lon, lat = np.meshgrid(x, y)
    wide = wave_field(rng, lon, lat, 30, 18, 1.2)
    fine = wave_field(rng, lon, lat, 36, 56, 2.0)
    bands = normalize(np.sin(lat * 7.5 + wide * 4.2 + np.sin(lon * 2.0) * 0.5))
    clouds = smoothstep(0.48, 0.86, wide * 0.58 + fine * 0.3 + bands * 0.12)
    clouds *= 0.62 + 0.38 * np.power(np.clip(np.cos(lat), 0.0, 1.0), 0.5)
    alpha = np.clip(clouds * 255.0, 0, 255).astype(np.uint8)
    img = Image.fromarray(alpha, "L").resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    img = img.filter(ImageFilter.GaussianBlur(0.45)).filter(ImageFilter.UnsharpMask(radius=1.0, percent=95, threshold=2))
    return img


def make_ring_texture() -> Image.Image:
    rng = np.random.default_rng(424231)
    x = np.linspace(0.0, 1.0, RING_W, dtype=np.float32)
    y = np.linspace(-1.0, 1.0, RING_H, dtype=np.float32)
    u, v = np.meshgrid(x, y)

    profile = np.zeros(RING_W, dtype=np.float32)
    color_line = np.zeros((RING_W, 3), dtype=np.float32)
    weights = np.zeros(RING_W, dtype=np.float32)
    bands = [
        (0.075, 0.030, 0.48, 0xd9b887),
        (0.155, 0.018, 0.62, 0x66fff0),
        (0.235, 0.044, 0.72, 0xc6d4ff),
        (0.345, 0.020, 0.58, 0xffd17a),
        (0.455, 0.058, 0.86, 0x8df6ff),
        (0.570, 0.030, 0.66, 0xeed7b0),
        (0.700, 0.064, 0.82, 0xa8bdff),
        (0.835, 0.026, 0.60, 0xfff0c4),
        (0.925, 0.022, 0.44, 0x74fff1),
    ]
    for center, width, strength, color in bands:
        band = np.exp(-((x - center) / width) ** 2).astype(np.float32) * strength
        band *= 0.82 + 0.18 * np.sin((x * 97.0 + center * 19.0) * math.tau)
        profile += band
        color_line += band[:, None] * hex_rgb(color)
        weights += band

    for _ in range(130):
        center = float(rng.uniform(0.025, 0.975))
        width = float(rng.uniform(0.0016, 0.009))
        strength = float(rng.uniform(0.035, 0.17))
        color = hex_rgb(int(rng.choice([0xbcecff, 0xffdba0, 0x92ffe9, 0xffffff, 0xbba4ff])))
        strand = np.exp(-((x - center) / width) ** 2).astype(np.float32) * strength
        profile += strand
        color_line += strand[:, None] * color
        weights += strand

    gap_mask = np.ones(RING_W, dtype=np.float32)
    for center, width, depth in (
        (0.118, 0.006, 0.82),
        (0.305, 0.010, 0.78),
        (0.520, 0.014, 0.86),
        (0.647, 0.007, 0.66),
        (0.782, 0.011, 0.74),
    ):
        gap_mask *= 1.0 - np.exp(-((x - center) / width) ** 2).astype(np.float32) * depth
    profile *= np.clip(gap_mask, 0.05, 1.0)

    color_line = color_line / np.maximum(weights[:, None], 1e-4)
    color_line = color_line * (0.72 + np.clip(profile, 0.0, 1.4)[:, None] * 0.24) + hex_rgb(0x0b1021) * 0.06

    radial = normalize(profile)[None, :]
    vertical = np.exp(-((np.abs(v) / 0.78) ** 2.75)).astype(np.float32)
    fine_noise = rng.random((RING_H, RING_W), dtype=np.float32)
    strand_noise = rng.random((1, RING_W), dtype=np.float32)
    shear = 0.92 + 0.08 * np.sin((u * 43.0 + v * 2.4) * math.tau)
    alpha = radial * vertical * shear * (0.78 + fine_noise * 0.18 + strand_noise * 0.22)
    alpha *= 0.88 + np.exp(-(np.abs(v) / 0.22) ** 2.0) * 0.22
    alpha = np.clip(alpha, 0.0, 1.0)

    rgb = color_line[None, :, :] * (0.82 + alpha[..., None] * 0.28)
    rgb += np.array([0.035, 0.055, 0.090], dtype=np.float32) * (1.0 - vertical[..., None]) * alpha[..., None]
    rgba = np.dstack((np.clip(rgb * 255.0, 0, 255), np.clip(alpha * 235.0, 0, 255))).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA")
    return img.filter(ImageFilter.GaussianBlur(0.16)).filter(ImageFilter.UnsharpMask(radius=0.9, percent=118, threshold=1))


PLANETS: list[dict[str, object]] = [
    {
        "filename": "planet-eidolon-hq.jpg",
        "seed": 6117,
        "mode": "eidolon",
        "palette": [0x050716, 0x111f3f, 0x32446f, 0x6f7bb0],
        "accent": 0x9fb6ff,
        "warm": 0x7b4dff,
        "accent_mix": 0.19,
        "band_scale": 4.2,
        "crack_freq": 7.0,
        "crack_lat": 4.2,
        "crack_sharp": 26.0,
        "crack_gate": 0.67,
        "crack_mix": 0.34,
    },
    {
        "filename": "planet-rift-hq.jpg",
        "seed": 9121,
        "mode": "rift",
        "palette": [0x021815, 0x063732, 0x117a78, 0x44f0dc],
        "accent": 0x7fffea,
        "warm": 0xffd98a,
        "accent_mix": 0.24,
        "band_scale": 5.8,
        "crack_freq": 10.0,
        "crack_lat": -5.4,
        "crack_sharp": 34.0,
        "crack_gate": 0.58,
        "crack_mix": 0.58,
    },
    {
        "filename": "planet-iwbtg-hq.jpg",
        "seed": 1559,
        "mode": "iwbtg",
        "palette": [0x170711, 0x42112d, 0x8a285f, 0xff5c9d],
        "accent": 0xff8ebc,
        "warm": 0xffd24a,
        "accent_mix": 0.2,
        "band_scale": 9.0,
        "crack_freq": 18.0,
        "crack_lat": 8.0,
        "crack_sharp": 42.0,
        "crack_gate": 0.72,
        "crack_mix": 0.38,
    },
    {
        "filename": "planet-locker-hq.jpg",
        "seed": 4283,
        "mode": "locker",
        "palette": [0x08120b, 0x183825, 0x517f55, 0xa1d088],
        "accent": 0x9bffc0,
        "warm": 0xf0b36b,
        "accent_mix": 0.16,
        "band_scale": 6.6,
        "crack_freq": 11.0,
        "crack_lat": 2.8,
        "crack_sharp": 30.0,
        "crack_gate": 0.68,
        "crack_mix": 0.26,
    },
    {
        "filename": "planet-constellation-hq.jpg",
        "seed": 7321,
        "mode": "constellation",
        "palette": [0x111a35, 0x2c4c80, 0x9bb5e8, 0xe7f0ff],
        "accent": 0xe5ecff,
        "warm": 0xfff0c8,
        "accent_mix": 0.18,
        "band_scale": 3.4,
        "crack_freq": 6.0,
        "crack_lat": -3.0,
        "crack_sharp": 24.0,
        "crack_gate": 0.72,
        "crack_mix": 0.24,
    },
    {
        "filename": "planet-core-hq.jpg",
        "seed": 8227,
        "mode": "core",
        "palette": [0x10051f, 0x2c1850, 0x7044a8, 0xc997ff],
        "accent": 0xd0a6ff,
        "warm": 0x33e7c8,
        "accent_mix": 0.22,
        "band_scale": 8.5,
        "crack_freq": 14.0,
        "crack_lat": 5.0,
        "crack_sharp": 34.0,
        "crack_gate": 0.62,
        "crack_mix": 0.4,
    },
    {
        "filename": "planet-observer-hq.jpg",
        "seed": 9907,
        "mode": "observer",
        "palette": [0x02070a, 0x062128, 0x0d4454, 0x27798b],
        "accent": 0x33e7c8,
        "warm": 0x7b4dff,
        "accent_mix": 0.22,
        "band_scale": 5.2,
        "crack_freq": 8.0,
        "crack_lat": 4.0,
        "crack_sharp": 36.0,
        "crack_gate": 0.64,
        "crack_mix": 0.46,
    },
    {
        "filename": "planet-archive-hq.jpg",
        "seed": 12037,
        "mode": "constellation",
        "palette": [0x071225, 0x203a66, 0x83a8df, 0xe8f0ff],
        "accent": 0xe2ecff,
        "warm": 0xb9cfff,
        "accent_mix": 0.2,
        "band_scale": 3.8,
        "crack_freq": 7.0,
        "crack_lat": -2.6,
        "crack_sharp": 28.0,
        "crack_gate": 0.7,
        "crack_mix": 0.28,
    },
    {
        "filename": "planet-harbor-hq.jpg",
        "seed": 14591,
        "mode": "rift",
        "palette": [0x02110f, 0x06342f, 0x177f7a, 0x6ffff0],
        "accent": 0x9fffee,
        "warm": 0xffd98a,
        "accent_mix": 0.24,
        "band_scale": 6.2,
        "crack_freq": 12.0,
        "crack_lat": -4.6,
        "crack_sharp": 36.0,
        "crack_gate": 0.6,
        "crack_mix": 0.5,
    },
    {
        "filename": "planet-vesper-hq.jpg",
        "seed": 17239,
        "mode": "core",
        "palette": [0x13061f, 0x351449, 0x7d3f95, 0xff9bd6],
        "accent": 0xff9bd6,
        "warm": 0xb265ff,
        "accent_mix": 0.23,
        "band_scale": 7.6,
        "crack_freq": 13.0,
        "crack_lat": 5.8,
        "crack_sharp": 34.0,
        "crack_gate": 0.64,
        "crack_mix": 0.4,
    },
]


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    for spec in PLANETS:
        img = make_planet(spec)
        out = ASSET_DIR / str(spec["filename"])
        img.save(out, quality=94, optimize=True, progressive=True, subsampling=1)
        print(f"saved {out.relative_to(ROOT)} {out.stat().st_size:,} bytes")
        save_derivatives(out, img)
    clouds = make_clouds()
    out = ASSET_DIR / "planet-clouds-hq.png"
    clouds.save(out, optimize=True)
    print(f"saved {out.relative_to(ROOT)} {out.stat().st_size:,} bytes")

    ring = make_ring_texture()
    out = ASSET_DIR / "planet-ring-hq.png"
    ring.save(out, optimize=True)
    print(f"saved {out.relative_to(ROOT)} {out.stat().st_size:,} bytes")

    for filename in ("planet-dragons-hq.png", "planet-signal-hq.png"):
        source = ASSET_DIR / filename
        if source.exists():
            save_derivatives(source, Image.open(source))


if __name__ == "__main__":
    main()
