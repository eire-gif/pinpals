#!/usr/bin/env python3
"""
Can you read a ScreenHeader title over the photograph behind it?

    python3 tools/check-scene-contrast.py

Run this after prep-scene-images.py, and any time the ramp, the band height
or ScreenHeader's padding changes. It exists because the first cut of the
scrim looked completely fine by eye and measured 1.89:1 — a bright sky under
cream text reads as "soft" rather than as "broken", right up until someone
tries to use it outdoors, which for this app is most of the time.

Exits non-zero if any pixel a title can land on fails WCAG AA.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SCENES = Path(__file__).resolve().parent.parent / "assets" / "images" / "scenes"

# Keep these in step with ScreenHeader: cream50 title, cream100 subtitle,
# gold400 rule. AA is 4.5:1 for text; the rule is decoration and needs 3:1.
SAMPLES = [
    ("title    cream50", (0xF7, 0xF3, 0xEA), 4.5),
    ("subtitle cream100", (0xEF, 0xE7, 0xD6), 4.5),
    ("rule     gold400", (0xE8, 0xC4, 0x6B), 3.0),
]

# The region the text block actually occupies, as a fraction of the band.
# ScreenHeader sizes the band by aspectRatio, so the photograph is never
# cropped vertically and these fractions hold at every screen width — which
# is the only reason a number measured here means anything on a phone.
#
# Bottom inset 14pt, then subtitle, title and rule going up, against a band
# that is 2.6:1. On the narrowest phone that puts the top of the text just
# under halfway up; the margin below is deliberate slack for a title that
# wraps to a second line.
X0, X1, Y0, Y1 = 0.03, 0.82, 0.42, 0.97


def luminance(rgb):
    c = np.asarray(rgb, dtype=float) / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def main():
    files = sorted(SCENES.glob("*.jpg"))
    if not files:
        print(f"no bands in {SCENES} — run prep-scene-images.py first", file=sys.stderr)
        return 2

    failed = False
    header = "band".ljust(18) + "".join(n.split()[0].ljust(11) for n, _, _ in SAMPLES)
    print(header)

    for path in files:
        pixels = np.asarray(Image.open(path).convert("RGB"), dtype=float)
        h, w, _ = pixels.shape
        behind = luminance(pixels[int(Y0 * h):int(Y1 * h), int(X0 * w):int(X1 * w)])

        cells = []
        for _, rgb, floor in SAMPLES:
            ink = luminance(rgb)
            # Contrast is always lighter-over-darker, so take whichever way
            # round gives the ratio >= 1 per pixel — that keeps this honest
            # if anyone ever puts dark text on a pale scene — and then the
            # worst pixel of those.
            worst = np.maximum(
                (ink + 0.05) / (behind + 0.05),
                (behind + 0.05) / (ink + 0.05),
            ).min()
            ok = worst >= floor
            failed = failed or not ok
            cells.append(f"{worst:.2f}{'' if ok else ' !'}".ljust(11))
        print(path.name.ljust(18) + "".join(cells))

    floors = ", ".join(f"{n.split()[0]} {f}" for n, _, f in SAMPLES)
    print(f"\nminimums: {floors}")
    print("FAIL — marked ! above" if failed else "all bands pass")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
