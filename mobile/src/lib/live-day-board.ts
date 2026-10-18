import type { Match } from "./live-match-days";
import { buildBoard, startLabel, type BoardRow } from "./live-scoring";

/**
 * The society day's leaderboard (0121): every player from every tee group on
 * one table, ranked the same way a single round ranks — Stableford by
 * points, stroke play by net to par — with the same ties (T2) and the same
 * "not started" rows at the foot.
 *
 * Each group's card is scored on its own by buildBoard() (its own shots per
 * hole, its own picked-up holes), then the rows are merged and ranked
 * together. Groups go out at different times, so "thru" sits beside every
 * row; Stableford pace (points against two a hole) is there for the same
 * reason. Pure, like every other leaderboard: nothing scored is stored.
 */

export type DayRow = BoardRow & {
  /** Tee group number, 1-based. */
  group: number;
  roundId: number;
  teeTime: string | null;
  /** Shotgun start (0173): "7B", else null. */
  start: string | null;
};

export type DayBoard = {
  format: "stableford" | "stroke";
  rows: DayRow[];
  /** Some group's card is still missing stroke indexes. */
  cardIncomplete: boolean;
};

export function dayBoard(matches: readonly Match[]): DayBoard {
  const format = matches.find((m) => m.round.format === "stroke") ? "stroke" : "stableford";
  let cardIncomplete = false;
  const rows: DayRow[] = [];

  for (const m of matches) {
    const board = buildBoard(
      format,
      m.card,
      m.players.map((p) => ({ id: p.id, name: p.name, playingHandicap: p.playingHandicap })),
      m.scores
    );
    if (board.cardIncomplete) cardIncomplete = true;
    for (const r of board.rows) {
      rows.push({
        ...r,
        position: "",
        group: m.round.matchNumber ?? 0,
        roundId: m.round.id,
        teeTime: m.round.teeTime,
        start: m.round.start ? startLabel(m.round.start, !matches.some((o) => o !== m && o.round.start?.hole === m.round.start?.hole)) : null,
      });
    }
  }

  const key = (r: DayRow) => (format === "stroke" ? r.netToPar : -r.points);
  const started = rows.filter((r) => r.thru > 0).sort((a, b) => key(a) - key(b) || b.thru - a.thru || a.name.localeCompare(b.name));
  for (const r of started) {
    const first = started.findIndex((o) => key(o) === key(r));
    const tied = started.filter((o) => key(o) === key(r)).length > 1;
    r.position = `${tied ? "T" : ""}${first + 1}`;
  }
  const waiting = rows.filter((r) => r.thru === 0).sort((a, b) => a.group - b.group || a.name.localeCompare(b.name));
  return { format, rows: [...started, ...waiting], cardIncomplete };
}
