#!/usr/bin/env python3
"""
Turn a full-size golf photograph into a header band for ScreenHeader.

    python3 tools/prep-scene-images.py ~/photos
    python3 tools/check-scene-contrast.py      # always, afterwards

Two things happen here, both on purpose.

CROP. Every screen header is a wide, shallow strip, so a 4:3 or square
original is cropped to 2.6:1 rather than scaled — scaling a square into a
strip either squashes the horizon or leaves the interesting third
off-screen. 1248px wide covers the largest iPhone at 3x (440pt) with room to
spare; taller than 480 is pixels nobody sees.

2.6:1 is not arbitrary and must not drift: ScreenHeader sizes the band by
aspectRatio rather than by a fixed height, precisely so that the photograph
is never cropped vertically at any screen width. That makes a fraction of
the JPEG's height the same fraction of the band's height on every phone,
which is the whole reason the contrast figures below mean anything. Change
this number and you must change it in ScreenHeader too.

SCRIM. The navy fade under the title is baked into the JPEG rather than laid
over it at runtime. A real gradient in React Native needs
expo-linear-gradient, which is a native module: adding one changes the
runtime fingerprint, so every member would need a new TestFlight build
before they saw any of this instead of an over-the-air update. The
alternatives at runtime are a flat scrim, which mutes the whole photograph,
or a stack of flat Views faking a ramp, which bands visibly against a clear
sky. Doing it here costs nothing at runtime, gives a true smooth ramp, and —
the real reason — means the contrast under the title is a measured property
of a file we ship rather than a guess about what the photograph is doing
underneath the text.

The originals live in the Pinpals project on claude.ai, not in this repo:
they are 2-4MB each and nothing builds from them.
"""
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "assets" / "images" / "scenes"

W, H = 1248, 480          # 2.6:1
RATIO = W / H

NAVY = (12, 32, 56)       # --navy-900, the site's header colour

# The title sits in the bottom of the band, so the ramp has to be AT full
# strength before the text starts rather than still on its way there. With
# a 14pt bottom inset and a rule, title and subtitle above it, the top of
# the text lands a little under halfway up the band — hence FADE_TO. The
# first cut faded in far later and looked completely fine by eye; it
# measured 1.89:1 under the top line of text, which is why the companion
# script exists. Change these and run it again.
FADE_FROM = 0.12          # fraction of the band where the fade starts
FADE_TO = 0.50            # fraction where it reaches full strength
FADE_MAX = 0.76           # navy opacity over the title

# (output name, source filename, vertical focus 0..1)
# The focus is where the band is centred on the original. 0.5 is the middle;
# lower pulls the band up towards sky and horizon, higher pulls it down into
# the fairway.
JOBS = [
    ("ballybunion.jpg",  "Ballybunion_Golf_Club__10th_hole.jpg",     0.52),
    ("old-head.jpg",     "oldheadgolflinks_070704_full.jpg",         0.50),
    ("links-dusk.jpg",   "Codex Image Aug 30 2026 08_09_17 PM.png",  0.48),
    ("links-sunset.jpg", "Codex Image Aug 30 2026 08_10_59 PM.png",  0.50),
    ("coast-aerial.jpg", "3MKAYK1.JPG",                              0.42),
    ("parkland.jpg",     "876EB0E22F8147EA89A741F3842E5A11.PNG",     0.52),
    ("dunes-gold.jpg",   "A46D89CAD3B2466C842CD83C87A77968.PNG",     0.45),
    ("lake-sunset.jpg",  "9A11606111834E5C97E05F27C8F9F01A.PNG",     0.45),
]


def find(src_dir, filename):
    """Match on the trailing name, so a download that gained a prefix or had
    its commas stripped still resolves."""
    stem = filename.replace(",", "").replace(" ", "_")
    for p in sorted(src_dir.iterdir()):
        flat = p.name.replace(",", "").replace(" ", "_")
        if flat == stem or flat.endswith("-" + stem) or flat.endswith("_" + stem):
            return p
    return None


def scrim_mask():
    """A one-pixel-wide alpha ramp, stretched to the band.

    smoothstep rather than a straight line: a linear ramp has a visible
    corner where it leaves zero, and that corner reads as a horizontal seam
    across a flat sky.
    """
    column = Image.new("L", (1, H))
    px = column.load()
    for y in range(H):
        t = (y / (H - 1) - FADE_FROM) / (FADE_TO - FADE_FROM)
        t = min(1.0, max(0.0, t))
        px[0, y] = round(255 * FADE_MAX * t * t * (3 - 2 * t))
    return column.resize((W, H))


def band_for(im, focus):
    w, h = im.size
    band_h = round(w / RATIO)
    if band_h <= h:
        top = round((h - band_h) * focus)
        box = (0, top, w, top + band_h)
    else:
        # Source is already wider than 2.5:1 — trim the sides instead.
        band_w = round(h * RATIO)
        left = round((w - band_w) / 2)
        box = (left, 0, left + band_w, h)
    return im.crop(box).resize((W, H), Image.LANCZOS)


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2

    src_dir = Path(argv[1]).expanduser().resolve()
    if not src_dir.is_dir():
        print(f"not a directory: {src_dir}", file=sys.stderr)
        return 2

    OUT.mkdir(parents=True, exist_ok=True)
    mask, wash = scrim_mask(), Image.new("RGB", (W, H), NAVY)

    missing = []
    for name, filename, focus in JOBS:
        found = find(src_dir, filename)
        if found is None:
            missing.append(filename)
            continue
        band = band_for(Image.open(found).convert("RGB"), focus)
        Image.composite(wash, band, mask).save(
            OUT / name, "JPEG", quality=72, optimize=True, progressive=True
        )
        print(f"{(OUT / name).stat().st_size // 1024:>4} KB  {name}")

    if missing:
        print(f"\nnot found in {src_dir}:", file=sys.stderr)
        for m in missing:
            print(f"  {m}", file=sys.stderr)
        return 1

    total = sum(p.stat().st_size for p in OUT.iterdir()) // 1024
    print(f"\ntotal {total} KB — now run tools/check-scene-contrast.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
