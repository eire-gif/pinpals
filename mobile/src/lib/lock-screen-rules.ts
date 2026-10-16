// Pure: tested in lock-screen-rules.test.ts (no React Native here).
//
// The small translations between the round screen's data and the lock
// screen card (lock-screen.ts → Swift in mobile/targets/widget/_shared).

type Hole = { hole: number };

/** Scores for the card: hole number (as a string) → strokes, picked up = 0. */
export function lockScreenStrokes(scores: ReadonlyMap<number, number | null>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [hole, strokes] of scores) out[String(hole)] = strokes == null ? 0 : strokes;
  return out;
}

/** The hole the card shows: the first on the card with no score yet, else the last. */
export function lockScreenHole(card: readonly Hole[], scores: ReadonlyMap<number, number | null>): number {
  const next = card.find((h) => !scores.has(h.hole));
  return next?.hole ?? card[card.length - 1]?.hole ?? 1;
}

const ordinal = (n: number): string => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};

/** "2nd of 4", "T2 of 4"; null before anyone has a position or alone. */
export function positionLine(position: string, of: number): string | null {
  if (!position || of < 2) return null;
  const tied = position.startsWith("T");
  const n = Number(tied ? position.slice(1) : position);
  if (!Number.isInteger(n) || n < 1) return null;
  return tied ? `Joint ${ordinal(n)} of ${of}` : `${ordinal(n)} of ${of}`;
}
