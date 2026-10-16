/**
 * One open game at a time (0157). When a game can't start because one of its
 * players is already in an open game — two people on a tee time both tapping
 * Start — the database refuses it and names the game in the error's hint:
 * "open-game:round:12" or "open-game:day:4". This reads that, so the app can
 * open the game that's already going instead.
 *
 * Pure, no imports: tested in open-game.test.ts.
 */

export type OpenGame = { kind: "round" | "day"; id: number };

export function openGameFrom(err: unknown): OpenGame | null {
  if (!err || typeof err !== "object") return null;
  const hint = (err as { hint?: unknown }).hint;
  if (typeof hint !== "string") return null;
  const m = hint.match(/^open-game:(round|day):(\d{1,15})$/);
  return m ? { kind: m[1] as OpenGame["kind"], id: Number(m[2]) } : null;
}

/** The screen a game opens on. */
export const openGamePath = (g: OpenGame): string => (g.kind === "day" ? `/live/day/${g.id}` : `/live/round/${g.id}`);
