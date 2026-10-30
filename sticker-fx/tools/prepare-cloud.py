#!/usr/bin/env python3
"""Sample the sticker artwork into a particle cloud.

Particles rebuild the sticker, so the cloud has to follow what the eye reads:
the silhouette and the feature outlines. A uniform random sample of bright
pixels just looks like confetti, so the sampler mixes three populations:

  * silhouette rim — every alpha-boundary pixel, painted hot gold so the
    die-cut outline is visible while the artwork is still black
  * feature edge   — luminance edges inside the artwork (eyes, teeth, letters)
  * interior fill  — random opaque pixels, never near-black (those vanish on
    a dark stage), weighted toward the bright ones

Each particle is one byte triple (x, y, palette index) on a 256 grid.

Output: assets/disgusting-cloud.js  (loaded before sticker-fx.js)

Usage:
    python sticker-fx/tools/prepare-cloud.py [--preview out.png] [--count 4600]
"""

from pathlib import Path
import argparse
import base64
import colorsys
import random

import numpy as np
from PIL import Image, ImageDraw

GRID = 256
DEFAULT_COUNT = 4600
PALETTE_SIZE = 16
MIN_ALPHA = 140
BOOST_S = 1.18
BOOST_V = 1.5
EDGE_SHARE = 0.68      # fraction of the budget reserved for rim + feature points
FEATURE_THRESHOLD = 70
MIN_FILL_LUM = 26      # skip the black body: invisible on the stage
RIM_RGB = (255, 178, 72)   # ember-gold die-cut outline


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    p = argparse.ArgumentParser()
    p.add_argument("--source", default=str(root / "assets" / "disgusting.png"))
    p.add_argument("--preview", default="")
    p.add_argument("--count", type=int, default=DEFAULT_COUNT)
    return p.parse_args()


def load(source: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    art = Image.open(source).convert("RGBA").resize((GRID, GRID), Image.LANCZOS)
    rgb = np.asarray(art.convert("RGB")).astype(np.float32)
    alpha = np.asarray(art.split()[-1])
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    return rgb, alpha, lum


def neighbours_all(mask: np.ndarray) -> np.ndarray:
    """True where all four orthogonal neighbours are inside the mask."""
    core = np.zeros_like(mask)
    core[1:-1, 1:-1] = (
        mask[1:-1, 1:-1]
        & mask[:-2, 1:-1] & mask[2:, 1:-1]
        & mask[1:-1, :-2] & mask[1:-1, 2:]
    )
    return core


def edges(lum: np.ndarray) -> np.ndarray:
    gx = np.zeros_like(lum)
    gy = np.zeros_like(lum)
    gx[:, 1:-1] = lum[:, 2:] - lum[:, :-2]
    gy[1:-1, :] = lum[2:, :] - lum[:-2, :]
    return np.abs(gx) + np.abs(gy)


def sample(source: Path, count: int):
    rgb, alpha, lum = load(source)
    mask = alpha >= MIN_ALPHA

    silhouette = mask & ~neighbours_all(mask)
    feature = mask & (edges(lum) > FEATURE_THRESHOLD)
    bright = mask & (lum >= MIN_FILL_LUM)

    def coords(sel: np.ndarray) -> list[tuple[int, int]]:
        ys, xs = np.nonzero(sel)
        return list(zip(xs.tolist(), ys.tolist()))

    sil: list[tuple[int, int]] = coords(silhouette)
    edge_px = edges(lum)
    ys, xs = np.nonzero(feature)
    # Strongest contours first, so the eyes, teeth and lettering survive the
    # budget instead of a random sprinkle of edge noise.
    order = np.argsort(edge_px[ys, xs])[::-1]
    feat: list[tuple[int, int]] = [(int(xs[i]), int(ys[i])) for i in order]
    fill: list[tuple[int, int]] = coords(bright)

    rng = random.Random(11)
    rng.shuffle(fill)

    budget_edge = int(count * EDGE_SHARE)
    picked: list[tuple[int, int]] = []

    # Every silhouette pixel first, then feature edges, then fill.
    sil_picked = sil[:budget_edge]
    picked += sil_picked
    remaining = budget_edge - len(picked)
    if remaining > 0:
        picked += feat[:remaining]

    rim = set(sil_picked)
    seen = set(picked)
    for p in fill:
        if len(picked) >= count:
            break
        if p not in seen:
            picked.append(p)
            seen.add(p)

    rng.shuffle(picked)
    points = [(x, y, tuple(int(c) for c in rgb[y, x])) for x, y in picked]
    flags = [(x, y) in rim for x, y in picked]
    return points, flags, set(feat)


def quantise(points, flags, size: int):
    """Quantise only the non-rim colours, then append the rim bucket."""
    body = [p for p, is_rim in zip(points, flags) if not is_rim]
    strip = Image.new("RGB", (len(body), 1))
    strip.putdata([p[2] for p in body])
    q = strip.quantize(colors=size, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[: size * 3]
    buckets = [(pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]) for i in range(size)]

    # Glowing embers read better than the flat ink colours, and lifting the
    # darkest buckets keeps the body visible on a near-black stage.
    lit = []
    for r, g, b in buckets:
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        v = 0.16 + 0.84 * v
        r, g, b = colorsys.hsv_to_rgb(h, min(1.0, s * BOOST_S), min(1.0, v * BOOST_V))
        lit.append((round(r * 255), round(g * 255), round(b * 255)))
    lit.append(RIM_RGB)

    rim_index = len(lit) - 1
    body_index = iter(q.getdata())
    index = [rim_index if is_rim else next(body_index) for is_rim in flags]
    return lit, index, rim_index


def main() -> None:
    args = parse_args()
    src = Path(args.source)
    if not src.is_file():
        raise SystemExit(f"source not found: {src}")

    points, flags, feature = sample(src, args.count)
    buckets, index, rim_index = quantise(points, flags, PALETTE_SIZE)

    blob = bytearray()
    for (x, y, _), bucket in zip(points, index):
        blob += bytes((x, y, bucket))

    out = Path(__file__).resolve().parents[1] / "assets" / "disgusting-cloud.js"
    out.write_text(
        "/* Generated by tools/prepare-cloud.py — do not edit by hand.\n"
        f"   {len(points)} particles sampled from disgusting.png on a {GRID}x{GRID} grid. */\n"
        "window.StickerFXCloud = {\n"
        f"  grid: {GRID},\n"
        f"  rim: {rim_index},\n"
        f"  buckets: {[list(b) for b in buckets]},\n"
        f"  data: '{base64.b64encode(bytes(blob)).decode()}',\n"
        "};\n",
        encoding="utf-8",
    )
    rim_count = sum(flags)
    print(f"wrote {out} ({len(points)} particles, {rim_count} rim, {len(blob)} bytes)")

    if args.preview:
        scale = 4
        canvas = Image.new("RGB", (GRID * scale, GRID * scale), (4, 1, 3))
        draw = ImageDraw.Draw(canvas)
        for (x, y, _), bucket, is_rim in zip(points, index, flags):
            r, g, b = buckets[bucket]
            cx, cy = x * scale, y * scale
            rad = 2.0 if is_rim else (1.6 if (x, y) in feature else 1.3)
            draw.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=(r, g, b))
        canvas.save(args.preview)
        print(f"preview {args.preview}")


if __name__ == "__main__":
    main()
