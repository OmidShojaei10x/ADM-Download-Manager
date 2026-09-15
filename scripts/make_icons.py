#!/usr/bin/env python3
"""Generate MediaCatch extension icons (rounded blue square + white download arrow)."""
from PIL import Image, ImageDraw
import os

OUT = "/home/user/media-catch/icons"
os.makedirs(OUT, exist_ok=True)


def make_icon(size: int, path: str) -> None:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size

    # rounded square background (blue)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=max(2, int(s * 0.22)), fill=(37, 99, 235, 255))

    # subtle darker bottom strip for depth
    if s >= 32:
        d.rounded_rectangle([0, int(s * 0.55), s - 1, s - 1], radius=max(2, int(s * 0.22)), fill=(29, 78, 216, 255))
        d.rectangle([0, int(s * 0.55), s - 1, int(s * 0.55) + s * 0.18], fill=(29, 78, 216, 255))

    cx = s / 2
    white = (255, 255, 255, 255)

    # arrow shaft
    shaft_w = max(2, s * 0.16)
    top = s * 0.16
    mid = s * 0.50
    d.rectangle([cx - shaft_w / 2, top, cx + shaft_w / 2, mid], fill=white)

    # arrow head
    head_w = s * 0.36
    tip = s * 0.72
    d.polygon([(cx, tip), (cx - head_w / 2, mid), (cx + head_w / 2, mid)], fill=white)

    # tray / baseline
    tray_t = max(1, s * 0.10)
    tray_y = s * 0.80
    d.rounded_rectangle([s * 0.24, tray_y, s * 0.76, tray_y + tray_t], radius=tray_t / 2, fill=white)

    img.save(path, "PNG")
    print("wrote", path)


for sz in (16, 32, 48, 128):
    make_icon(sz, os.path.join(OUT, f"icon{sz}.png"))
print("done")
