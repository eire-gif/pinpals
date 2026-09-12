"""Generates the Pinpals PWA icon set from the brand tokens in globals.css.

Run from the repo root:  python3 tools/make-icons.py

Everything is drawn at 4x and downsampled with LANCZOS, which is what keeps
the flag edge and the ball clean at 192px. Colours are the literal values
from src/app/globals.css — navy-900, green-700, green-600, red-600,
cream-50 — not approximations, so the icon sits in the same palette as the
site it opens.

Outputs (public/icons/):
  icon-192.png            manifest, "any"
  icon-512.png            manifest, "any"
  icon-maskable-512.png   manifest, "maskable" — artwork inside the 80% safe
                          zone, because Android crops this one to whatever
                          shape the launcher uses (circle, squircle, teardrop)
  apple-touch-icon.png    180px. iOS ignores the manifest icons and reads
                          this instead; without it an installed Pinpals gets
                          a screenshot of the page as its home-screen icon.
  badge-96.png            Android status-bar badge: a white silhouette on
                          transparency, which the OS tints. Any colour or
                          detail here is thrown away, so it is the flag
                          shape alone.
"""

from PIL import Image, ImageDraw

NAVY_900 = (12, 32, 56)
GREEN_700 = (31, 92, 46)
GREEN_600 = (44, 122, 61)
RED_600 = (168, 58, 43)
CREAM_50 = (247, 243, 234)
WHITE = (255, 255, 255)

SS = 4  # supersampling factor


def draw_icon(size: int, inset: float = 0.0) -> Image.Image:
    """inset=0.0 fills the tile; inset=0.1 pulls the artwork into the
    central 80%, which is the maskable safe zone."""
    s = size * SS
    img = Image.new("RGB", (s, s), NAVY_900)
    d = ImageDraw.Draw(img)

    # Map artwork coordinates (0..1) into the inset box.
    lo = inset
    span = 1.0 - 2 * inset

    def x(u: float) -> float:
        return (lo + u * span) * s

    def y(v: float) -> float:
        return (lo + v * span) * s

    # Two overlapping fairway swells. Drawn as ellipses far wider than the
    # tile so only the crest shows, which reads as a horizon rather than as
    # a circle sitting in a box.
    d.ellipse([x(-0.40), y(0.52), x(1.40), y(1.95)], fill=GREEN_700)
    d.ellipse([x(-0.18), y(0.64), x(1.55), y(2.10)], fill=GREEN_600)

    # Flag pole.
    pole_w = 0.030
    d.rectangle([x(0.545), y(0.19), x(0.545 + pole_w), y(0.745)], fill=WHITE)

    # Pennant, flying right off the top of the pole.
    d.polygon(
        [(x(0.575), y(0.195)), (x(0.845), y(0.285)), (x(0.575), y(0.375))],
        fill=RED_600,
    )

    # Ball on the green, left of the pin.
    br = 0.055
    d.ellipse([x(0.315 - br), y(0.700 - br), x(0.315 + br), y(0.700 + br)], fill=CREAM_50)

    return img.resize((size, size), Image.LANCZOS)


def draw_badge(size: int) -> Image.Image:
    """Monochrome silhouette on transparency — Android tints it and discards
    everything else, so detail and colour are wasted here."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    d.rectangle([0.455 * s, 0.135 * s, 0.495 * s, 0.865 * s], fill=WHITE)
    d.polygon(
        [(0.495 * s, 0.145 * s), (0.865 * s, 0.285 * s), (0.495 * s, 0.425 * s)],
        fill=WHITE,
    )

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    out = "public/icons"

    draw_icon(192).save(f"{out}/icon-192.png", optimize=True)
    draw_icon(512).save(f"{out}/icon-512.png", optimize=True)
    draw_icon(512, inset=0.10).save(f"{out}/icon-maskable-512.png", optimize=True)
    draw_icon(180).save(f"{out}/apple-touch-icon.png", optimize=True)
    draw_badge(96).save(f"{out}/badge-96.png", optimize=True)

    print("wrote 5 icons to", out)


if __name__ == "__main__":
    main()
