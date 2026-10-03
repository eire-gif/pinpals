"""
Photographs for the Tee times tab redesign (Oct 2026).

    python3 tools/prep-tee-time-images.py ~/originals

Writes:
  assets/images/tee-times/hero.jpg   the tab's full-bleed header
  assets/images/courses/course-N.jpg card photos, 4:3, no scrim

THE HERO carries two baked fades, for the same reason the scene bands do
(see prep-scene-images.py — a runtime gradient is a native module, which
costs over-the-air updates): navy across the top so the menu and + buttons
read against a bright sky, and a deeper navy across the bottom where the
title and the round count sit.

THE CARD PHOTOS are decoration, not the course in question — no course in
the directory has a photograph of its own yet. Each round gets one picked
steadily from its club, so a club always shows the same picture. When
clubs carry real photos, the card should use them instead.

The originals live in the Pinpals project on claude.ai, not in this repo.
"""
import sys
from pathlib import Path

from PIL import Image, ImageEnhance

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "assets" / "images"
NAVY = (12, 32, 56)

SOURCES = [
    ("Ballybunion_Golf_Club__10th_hole.jpg", 0.55),
    ("oldheadgolflinks_070704_full.jpg", 0.5),
    ("876EB0E22F8147EA89A741F3842E5A11.PNG", 0.55),
    ("A46D89CAD3B2466C842CD83C87A77968.PNG", 0.5),
    ("3MKAYK1.JPG", 0.45),
    ("9A11606111834E5C97E05F27C8F9F01A.PNG", 0.5),
    ("Codex Image Aug 30 2026 08_09_17 PM.png", 0.5),
    ("Codex Image Aug 30 2026 08_10_59 PM.png", 0.5),
]


def find(src_dir, filename):
    stem = filename.replace(",", "").replace(" ", "_")
    for p in sorted(src_dir.iterdir()):
        flat = p.name.replace(",", "").replace(" ", "_")
        if flat == stem or flat.endswith("-" + stem) or flat.endswith("_" + stem):
            return p
    return None


def crop(im, ratio, focus):
    w, h = im.size
    if w / h > ratio:
        nw = round(h * ratio)
        left = round((w - nw) / 2)
        return im.crop((left, 0, left + nw, h))
    nh = round(w / ratio)
    top = round((h - nh) * focus)
    return im.crop((0, top, w, top + nh))


def ramp(h, stops):
    """stops: list of (fraction, alpha 0-1); smoothstep between them."""
    col = Image.new("L", (1, h))
    px = col.load()
    for y in range(h):
        f = y / (h - 1)
        a = 0.0
        for (f0, a0), (f1, a1) in zip(stops, stops[1:]):
            if f0 <= f <= f1:
                t = (f - f0) / (f1 - f0) if f1 > f0 else 0
                t = t * t * (3 - 2 * t)
                a = a0 + (a1 - a0) * t
                break
        px[0, y] = round(255 * a)
    return col


def main(argv):
    src = Path(argv[1]).expanduser().resolve()

    # Hero: 1170 x 620, fades top and bottom.
    W, H = 1170, 620
    # Warm, low sun over links — the mood the tab was designed around.
    hero_src = find(src, SOURCES[7][0])
    im = Image.open(hero_src).convert("RGB")
    im = crop(im, W / H, 0.6).resize((W, H), Image.LANCZOS)
    mask = ramp(H, [(0, 0.55), (0.28, 0.0), (0.45, 0.0), (1.0, 0.82)]).resize((W, H))
    im = Image.composite(Image.new("RGB", (W, H), NAVY), im, mask)
    (ASSETS / "tee-times").mkdir(parents=True, exist_ok=True)
    im.save(ASSETS / "tee-times" / "hero.jpg", quality=80, optimize=True, progressive=True)

    # Card photos: 600 x 450, a touch of warmth and contrast, no scrim.
    (ASSETS / "courses").mkdir(parents=True, exist_ok=True)
    for i, (name, focus) in enumerate(SOURCES, start=1):
        p = find(src, name)
        if p is None:
            print("missing", name, file=sys.stderr)
            return 1
        im = Image.open(p).convert("RGB")
        im = crop(im, 4 / 3, focus).resize((600, 450), Image.LANCZOS)
        im = ImageEnhance.Contrast(im).enhance(1.05)
        im = ImageEnhance.Color(im).enhance(1.06)
        im.save(ASSETS / "courses" / f"course-{i}.jpg", quality=78, optimize=True, progressive=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
