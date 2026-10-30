/**
 * Course leaderboards (0197): the pure half of course-boards.ts — words and
 * sums for the screens, tested in course-board-rules.test.ts.
 */

export type BoardMetric = "stableford" | "net" | "gross";

export type BoardRow = {
  place: number;
  memberId: string;
  name: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  handicap: number | null;
  playedOn: string;
  points: number;
  gross: number;
  netToPar: number;
  isMe: boolean;
};

// ---------------------------------------------------------------------------
// Words (pure)
// ---------------------------------------------------------------------------

/** Monday of the week a date is in, YYYY-MM-DD. */
export function mondayOf(d: Date): string {
  const day = (d.getDay() + 6) % 7;
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(m.getDate()).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "26 Oct – 1 Nov" for the week starting that Monday. */
export function weekLabel(mondayIso: string): string {
  const [y, mo, da] = mondayIso.split("-").map(Number) as [number, number, number];
  const start = new Date(y, mo - 1, da);
  const end = new Date(y, mo - 1, da + 6);
  return `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
}

/** "Tue" for a played-on date. */
export function dayLabel(iso: string): string {
  const [y, mo, da] = iso.split("-").map(Number) as [number, number, number];
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(y, mo - 1, da).getDay()]!;
}

/** The score the board is ordered by, as shown. */
export function scoreFor(row: Pick<BoardRow, "points" | "gross" | "netToPar">, metric: BoardMetric): string {
  if (metric === "stableford") return String(row.points);
  if (metric === "gross") return String(row.gross);
  return row.netToPar === 0 ? "E" : row.netToPar > 0 ? `+${row.netToPar}` : String(row.netToPar);
}

/** A hole champion's net score in words. */
export function netName(netToPar: number): string {
  if (netToPar <= -3) return "ALBATROSS";
  if (netToPar === -2) return "EAGLE";
  if (netToPar === -1) return "BIRDIE";
  if (netToPar === 0) return "PAR";
  if (netToPar === 1) return "BOGEY";
  return `+${netToPar}`;
}

/** "2 pts off the top 5" / "Leading" / "3rd of 42" — what the viewer's row says. */
export function myLine(rows: readonly BoardRow[], metric: BoardMetric): string | null {
  const me = rows.find((r) => r.isMe);
  if (!me) return null;
  if (me.place === 1) return rows.filter((r) => r.place === 1).length > 1 ? "Joint leader" : "Leading this week";
  const fifth = rows.find((r) => r.place <= 5 && rows.indexOf(r) === Math.min(4, rows.length - 1));
  if (me.place > 5 && fifth) {
    const gap =
      metric === "stableford" ? fifth.points - me.points : metric === "gross" ? me.gross - fifth.gross : me.netToPar - fifth.netToPar;
    if (gap > 0) return `${gap} ${metric === "stableford" ? (gap === 1 ? "pt" : "pts") : gap === 1 ? "shot" : "shots"} off the top 5`;
  }
  return null;
}
