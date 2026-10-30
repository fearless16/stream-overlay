#!/usr/bin/env python3
"""Regenerate the DISGUSTING sticker assets from the original artwork.

The source JPEG has a flat near-white background plus a white die-cut border.
A plain white chroma-key would also punch holes in the teeth and the letter
highlights, so this uses a border flood fill:

  1. mark low-saturation bright pixels,
  2. flood only from the image frame (interior whites stay opaque),
  3. erode a couple of pixels to shave the remaining grey cut line,
  4. feather, then un-premultiply the white background to kill the halo.

Usage:
    python sticker-fx/tools/prepare-assets.py <source.jpeg>
"""

from collections import deque
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter


def remove_background(src: Path) -> Image.Image:
    rgb = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    h, w, _ = rgb.shape
    mn = rgb.min(axis=2)
    mx = rgb.max(axis=2)

    # Background candidate: bright and almost neutral (white paper + grey edge)
    bg_like = (mn >= 125) & ((mx - mn) <= 48)

    visited = np.zeros((h, w), dtype=bool)
    queue = deque()

    def push(y: int, x: int) -> None:
        if bg_like[y, x] and not visited[y, x]:
            visited[y, x] = True
            queue.append((y, x))

    for x in range(w):
        push(0, x)
        push(h - 1, x)
    for y in range(h):
        push(y, 0)
        push(y, w - 1)

    while queue:
        y, x = queue.popleft()
        if y > 0:
            push(y - 1, x)
        if y + 1 < h:
            push(y + 1, x)
        if x > 0:
            push(y, x - 1)
        if x + 1 < w:
            push(y, x + 1)

    alpha = np.where(visited, 0, 255).astype(np.uint8)
    alpha = np.asarray(Image.fromarray(alpha, "L").filter(ImageFilter.MinFilter(5)))
    alpha = np.asarray(Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.65)))
    a = alpha.astype(np.float32) / 255.0

    # Un-premultiply the ~247 white paper so soft edges have no light fringe
    safe = np.clip(a, 1e-4, 1.0)[..., None]
    out = np.clip((rgb - (1.0 - a[..., None]) * 247.0) / safe, 0, 255)

    return Image.fromarray(
        np.dstack([out.astype(np.uint8), alpha]), "RGBA"
    )


def make_glow(sticker: Image.Image) -> Image.Image:
    # Pad generously before blurring so the halo fades to zero inside the
    # texture; a tight crop produces a visible rectangular edge on stream.
    size = 768
    art = sticker.resize((420, 420), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(art, ((size - 420) // 2, (size - 420) // 2), art)
    blur = canvas.filter(ImageFilter.GaussianBlur(100))
    r, g, b, a = blur.split()
    a = a.point(lambda v: min(255, int(v * 1.9)))
    rgb = ImageEnhance.Color(Image.merge("RGB", (r, g, b))).enhance(1.55)
    rgb = ImageEnhance.Brightness(rgb).enhance(1.2)
    return Image.merge("RGBA", (*rgb.split(), a))


def main() -> None:
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(2)

    src = Path(sys.argv[1]).expanduser()
    if not src.is_file():
        raise SystemExit(f"source not found: {src}")

    out_dir = Path(__file__).resolve().parents[1] / "assets"
    out_dir.mkdir(parents=True, exist_ok=True)

    sticker = remove_background(src)
    sticker.save(out_dir / "disgusting.png", optimize=True)
    make_glow(sticker).save(out_dir / "disgusting-glow.png", optimize=True)

    print(f"wrote {out_dir / 'disgusting.png'} ({sticker.width}x{sticker.height})")
    print(f"wrote {out_dir / 'disgusting-glow.png'}")


if __name__ == "__main__":
    main()
