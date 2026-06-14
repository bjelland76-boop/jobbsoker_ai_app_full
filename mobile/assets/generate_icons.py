#!/usr/bin/env python3
"""Generate Aerlig app icons for all Android mipmap densities."""

import math
import os
from PIL import Image, ImageDraw

RES_DIR = os.path.join(os.path.dirname(__file__), "..", "android", "app", "src", "main", "res")
ORANGE = "#E8501A"
WHITE = "#FFFFFF"


def draw_icon_on(img: Image.Image, x: int, y: int, size: int, circular: bool = False) -> None:
    """Draw the Aerlig icon content into img at (x, y) with given size."""
    draw = ImageDraw.Draw(img)

    if circular:
        # Circular background
        draw.ellipse([x, y, x + size - 1, y + size - 1], fill=ORANGE)
    else:
        # Rounded-rectangle background
        corner_r = round(size * 0.176)  # ~90/512
        draw.rounded_rectangle([x, y, x + size - 1, y + size - 1], radius=corner_r, fill=ORANGE)

    cx = x + size / 2
    cy = y + size / 2
    s = size / 512.0

    # White ring
    ring_r = round(158 * s)
    ring_w = max(2, round(20 * s))
    draw.ellipse(
        [cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r],
        outline=WHITE,
        width=ring_w,
    )

    # White checkmark (round line caps/joins via end-dots)
    chk_w = max(2, round(30 * s))
    p1 = (x + round(178 * s), y + round(258 * s))
    p2 = (x + round(234 * s), y + round(320 * s))
    p3 = (x + round(348 * s), y + round(196 * s))
    draw.line([p1, p2], fill=WHITE, width=chk_w)
    draw.line([p2, p3], fill=WHITE, width=chk_w)
    # Round caps
    r = chk_w // 2
    for pt in [p1, p2, p3]:
        draw.ellipse([pt[0] - r, pt[1] - r, pt[0] + r, pt[1] + r], fill=WHITE)


def make_launcher(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_icon_on(img, 0, 0, size, circular=False)
    return img


def make_round(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_icon_on(img, 0, 0, size, circular=True)
    return img


def make_foreground(size: int) -> Image.Image:
    """Adaptive icon foreground: 108dp canvas, icon in central 72dp safe zone."""
    canvas = size
    # Content fills 72/108 = 2/3 of canvas
    content = round(size * 72 / 108)
    pad = (canvas - content) // 2
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw_icon_on(img, pad, pad, content, circular=False)
    return img


# density → (launcher_size, foreground_canvas_size)
DENSITIES = {
    "mipmap-mdpi":    (48,  108),
    "mipmap-hdpi":    (72,  162),
    "mipmap-xhdpi":   (96,  216),
    "mipmap-xxhdpi":  (144, 324),
    "mipmap-xxxhdpi": (192, 432),
}


def save(img: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG")
    print(f"  wrote {path.split('res/')[-1]}  ({img.size[0]}x{img.size[1]})")


def main() -> None:
    print("Generating Aerlig app icons...")

    # Play Store high-res
    store_path = os.path.join(os.path.dirname(__file__), "icon_512.png")
    save(make_launcher(512), store_path)

    for density, (lsize, fsize) in DENSITIES.items():
        d = os.path.join(RES_DIR, density)
        save(make_launcher(lsize), os.path.join(d, "ic_launcher.png"))
        save(make_round(lsize),    os.path.join(d, "ic_launcher_round.png"))
        save(make_foreground(fsize), os.path.join(d, "ic_launcher_foreground.png"))

    print("\nDone!")


if __name__ == "__main__":
    main()
