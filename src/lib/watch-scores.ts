/**
 * The body of POST /api/widget/live/scores — the group's scores from a watch
 * (watch v2, claude/watch-v2.md). Pure, tested in watch-scores.test.ts.
 *
 *   { hole: 1–18, scores: [{ player_id, strokes: 1–20 | null, clear?: true }] }
 *
 * strokes null = picked up, as in the app; clear removes the hole's score.
 * At most 8 rows (a fourball is 4; a big group or a guest list never 8).
 */

export type WatchScore = { player_id: number; strokes: number | null; clear?: true };
export type WatchScoresBody = { hole: number; scores: WatchScore[] };

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** The checked body, or a reason it can't be accepted. */
export function parseWatchScores(body: unknown): WatchScoresBody | { error: string } {
  if (body == null || typeof body !== "object") return { error: "Expected JSON" };
  const b = body as { hole?: unknown; scores?: unknown };
  if (!isInt(b.hole, 1, 18)) return { error: "hole (1-18) is required" };
  if (!Array.isArray(b.scores) || b.scores.length === 0 || b.scores.length > 8) return { error: "Between 1 and 8 scores" };
  const scores: WatchScore[] = [];
  for (const raw of b.scores as unknown[]) {
    if (raw == null || typeof raw !== "object") return { error: "Each score needs a player_id" };
    const s = raw as { player_id?: unknown; strokes?: unknown; clear?: unknown };
    if (!isInt(s.player_id, 1, Number.MAX_SAFE_INTEGER)) return { error: "Each score needs a player_id" };
    if (s.clear === true) {
      scores.push({ player_id: s.player_id, strokes: null, clear: true });
      continue;
    }
    if (s.strokes !== null && !isInt(s.strokes, 1, 20)) return { error: "strokes (1-20, or null for picked up) are required" };
    scores.push({ player_id: s.player_id, strokes: s.strokes });
  }
  return { hole: b.hole, scores };
}
