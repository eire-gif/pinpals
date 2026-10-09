/**
 * The colour of a set of tees, from its name (Oct 2026).
 *
 * Tees are named for their markers — "Blue", "Yellow (Women)",
 * "Championship · White" — so the first colour word in the name is the
 * marker's colour. The chips are drawn in it, the way the markers look on
 * the tee. A name with no colour word ("Championship", "Medal") gets the
 * app's own navy.
 *
 * `text` is whichever of ink or cream reads on the fill (WCAG AA for the
 * chip's bold label); `border` keeps a white or yellow chip visible on the
 * cream background.
 */

export type TeeColour = { fill: string; text: string; border: string; named: boolean };

const INK = "#0e1520";
const CREAM = "#f7f3ea";

const PALETTE: Record<string, { fill: string; text: string; border?: string }> = {
  white: { fill: "#ffffff", text: INK, border: "#c9c2b0" },
  yellow: { fill: "#f6c915", text: INK },
  gold: { fill: "#d3a53f", text: INK },
  orange: { fill: "#f08a24", text: INK },
  red: { fill: "#c8372d", text: CREAM },
  blue: { fill: "#2160c4", text: CREAM },
  green: { fill: "#2f8f46", text: CREAM },
  black: { fill: "#15181d", text: CREAM },
  silver: { fill: "#c3c7cc", text: INK },
  grey: { fill: "#8a9099", text: CREAM },
  gray: { fill: "#8a9099", text: CREAM },
  purple: { fill: "#6d3fb0", text: CREAM },
  pink: { fill: "#e46aa6", text: INK },
  bronze: { fill: "#a8743a", text: CREAM },
  copper: { fill: "#b8693f", text: CREAM },
  burgundy: { fill: "#7a1f2b", text: CREAM },
  maroon: { fill: "#7a1f2b", text: CREAM },
  navy: { fill: "#0c2038", text: CREAM },
};

const FALLBACK: TeeColour = { fill: "#0c2038", text: CREAM, border: "#0c2038", named: false };

export function teeColour(name: string | null | undefined): TeeColour {
  if (!name) return FALLBACK;
  for (const word of name.toLowerCase().split(/[^a-z]+/)) {
    const c = PALETTE[word];
    if (c) return { fill: c.fill, text: c.text, border: c.border ?? c.fill, named: true };
  }
  return FALLBACK;
}
