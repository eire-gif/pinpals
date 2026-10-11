/**
 * The pure half of live-highlights.ts: which scores count, who made them,
 * and the words. Tested in live-highlight-rules.test.ts.
 */

export type HighlightKind = "hole_in_one" | "albatross" | "eagle" | "birdie";

/** Gross score against par. A hole in one beats everything (an ace on a
 *  par 4 is still announced as a hole in one). Null for par or worse, or a
 *  pick-up. */
export function highlightKind(strokes: number | null, par: number): HighlightKind | null {
  if (strokes == null || !Number.isInteger(strokes) || strokes < 1) return null;
  if (strokes === 1) return "hole_in_one";
  const diff = strokes - par;
  if (diff <= -3) return "albatross";
  if (diff === -2) return "eagle";
  if (diff === -1) return "birdie";
  return null;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Who to credit: the player, a foursomes pair ("Eire & Tom"), or a scramble team. */
export function scorerLabel(input: {
  scorer: { name: string; side: number | null };
  roundPlayers: { name: string; side: number | null; position: number }[];
  scramble: { teamName: string | null; teamNumber: number | null } | null;
  oneBallPerSide: boolean;
}): string {
  if (input.scramble) return input.scramble.teamName?.trim() || `Team ${input.scramble.teamNumber ?? ""}`.trim();
  if (input.oneBallPerSide) {
    return input.roundPlayers
      .filter((p) => p.side === input.scorer.side)
      .sort((a, b) => a.position - b.position)
      .map((p) => first(p.name))
      .join(" & ");
  }
  return first(input.scorer.name);
}

const WORDS: Record<HighlightKind, { emoji: string; label: string }> = {
  hole_in_one: { emoji: "⛳️", label: "HOLE IN ONE" },
  albatross: { emoji: "🔥", label: "Albatross" },
  eagle: { emoji: "🦅", label: "Eagle" },
  birdie: { emoji: "🐦", label: "Birdie" },
};

export function highlightMessage(input: { kind: HighlightKind; who: string; hole: number; par: number; strokes: number; course: string }) {
  const w = WORDS[input.kind];
  const title = `${w.emoji} ${w.label} for ${input.who}!`;
  const how = input.kind === "hole_in_one" ? `an ace on the ${ordinalHole(input.hole)} (par ${input.par})` : `${input.strokes} on the par-${input.par} ${ordinalHole(input.hole)}`;
  return { title, body: `${how.charAt(0).toUpperCase()}${how.slice(1)} at ${input.course}. Tap for the leaderboard.` };
}

function ordinalHole(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const s = teen ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
}
