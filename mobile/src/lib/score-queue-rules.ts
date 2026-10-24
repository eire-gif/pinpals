// Pure: tested in score-queue.test.ts (no React Native here).

/**
 * No connection, as opposed to the database saying no. A refusal from the
 * database always carries a Postgres error code ("P0001", "42501"…); a
 * request that never got there has none (supabase-js reports it with an
 * empty code and "Network request failed").
 */
export function isNetworkError(e: unknown): boolean {
  if (!e) return false;
  const code = (e as { code?: unknown }).code;
  return !(typeof code === "string" && code.length > 0);
}

/** A score (or a scramble's drive) waiting for signal. Older saves have no `kind`: a score. */
export type PendingScore = {
  kind?: "score" | "drive";
  roundId: number;
  playerId: number;
  hole: number;
  /** The strokes, or for a drive the position of the player whose drive it was. */
  strokes: number | null;
  clear: boolean;
  at: number;
};

/** One waiting value per round, player (or drive) and hole. */
export function pendingKey(p: Pick<PendingScore, "kind" | "roundId" | "playerId" | "hole">): string {
  return p.kind === "drive" ? `d:${p.roundId}:${p.hole}` : `${p.roundId}:${p.playerId}:${p.hole}`;
}

/**
 * Two lists of waiting values as one: for the same hole the later list
 * wins, and the order of entry (oldest first) is kept.
 */
export function mergePending(earlier: PendingScore[], later: PendingScore[]): PendingScore[] {
  const replaced = new Set(later.map(pendingKey));
  return [...earlier.filter((p) => !replaced.has(pendingKey(p))), ...later].sort((a, b) => a.at - b.at);
}

/**
 * What the card should show: the server's scores and drives with anything
 * still waiting on this phone laid over them.
 */
export function overlayPending<
  T extends { scores: ReadonlyMap<number, ReadonlyMap<number, number | null>>; drives: ReadonlyMap<number, number> },
>(data: T, waiting: PendingScore[]): T {
  if (waiting.length === 0) return data;
  const scores = new Map(data.scores);
  const drives = new Map(data.drives);
  for (const w of [...waiting].sort((a, b) => a.at - b.at)) {
    if (w.kind === "drive") {
      if (w.clear || w.strokes == null) drives.delete(w.hole);
      else drives.set(w.hole, w.strokes);
      continue;
    }
    const mine = new Map(scores.get(w.playerId) ?? []);
    if (w.clear) mine.delete(w.hole);
    else mine.set(w.hole, w.strokes);
    scores.set(w.playerId, mine);
  }
  return { ...data, scores, drives } as T;
}

/**
 * A request on one bar of signal can hang for a minute before it fails.
 * Waits at most `ms`, then fails the way a lost connection does (no code), so
 * the score is kept on the phone instead. Sending twice is harmless: a
 * score is set, not added.
 */
export function withinTime<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject({ message: "No signal (timed out)", code: "" }), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
