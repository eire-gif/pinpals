import { toParLabel, type Board, type CardHole, type ScoreSheet } from "./live-scoring";
import { playedLabel } from "./scorecard-math";

/**
 * "Share scorecard" from live scoring (Oct 2026) — the whole game as one
 * message, for the group chat while it's being played or once it's done.
 *
 * Pure (no React, no supabase), so it runs in vitest: live-share.test.ts.
 * The screen hands in what it already has on screen — the rows it scores,
 * the leaderboard it built, the match line — and this only writes words.
 *
 * Your OWN card, with a link to its page, is a different share: that one
 * goes through scorecards (0110) and scorecard-math's shareText(), because
 * the link needs a saved card to point at.
 */

export type ShareGameRow = { id: number; name: string };

export type ShareGame = {
  courseName: string;
  teeName: string | null;
  playedOn: string;
  live: boolean;
  /** "Stableford", "Fourball", "4-person scramble"… */
  formatLabel: string;
  /** A match day's title and match number, when this is one of its matches. */
  heading?: string | null;
  card: readonly CardHole[];
  /** One per line on the card: players, pairs (foursomes) or the team. */
  rows: readonly ShareGameRow[];
  scores: ScoreSheet;
  /** Stroke or Stableford leaderboard; null for a match. */
  board: Board | null;
  /** Stroke play and scramble rank on net; Stableford on points. */
  strokeLike: boolean;
  /** A match's state in words: "Murphys 2 UP", "thru 12". */
  match?: { status: string; detail: string } | null;
  siteUrl?: string | null;
};

/** A hole's score as a card shows it: strokes, P for picked up, · not yet. */
const cellFor = (mine: ReadonlyMap<number, number | null> | undefined, hole: number): string => {
  if (!mine || !mine.has(hole)) return "·";
  const v = mine.get(hole);
  return v == null ? "P" : String(v);
};

/** Strokes over a set of holes; null when none of them is in yet. A
 *  pick-up adds nothing here — the card shows the P, the leaderboard has
 *  the Stableford-style gross. */
const strokesOver = (mine: ReadonlyMap<number, number | null> | undefined, holes: readonly CardHole[]): number | null => {
  let total = 0;
  let any = false;
  for (const h of holes) {
    const v = mine?.get(h.hole);
    if (typeof v === "number") {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
};

const holesThru = (game: ShareGame): number => {
  // The furthest any row has got: what "thru" means for the group.
  let best = 0;
  for (const r of game.rows) {
    const n = game.card.filter((h) => game.scores.get(r.id)?.has(h.hole)).length;
    if (n > best) best = n;
  }
  return best;
};

/** The leaderboard line for one row. */
function boardLine(game: ShareGame, r: Board["rows"][number]): string {
  const pos = r.position || "–";
  if (r.thru === 0) return `${pos}. ${r.name} · not started`;
  const thru = r.thru < game.card.length ? ` (thru ${r.thru})` : "";
  if (game.strokeLike) return `${pos}. ${r.name}  ${toParLabel(r.netToPar)} net · ${r.gross} gross${thru}`;
  return `${pos}. ${r.name}  ${r.points} pts${thru}`;
}

export function liveGameShareText(game: ShareGame): string {
  const sorted = [...game.card].sort((a, b) => a.hole - b.hole);
  const front = sorted.filter((h) => h.hole <= 9);
  const back = sorted.filter((h) => h.hole > 9);
  const thru = holesThru(game);
  const state = game.live ? (thru > 0 && thru < sorted.length ? `Live · thru ${thru}` : "Live") : "Final";

  const lines: string[] = [];
  if (game.heading) lines.push(game.heading);
  lines.push(`⛳ ${game.courseName}${game.teeName ? ` · ${game.teeName} tees` : ""}`);
  lines.push(`${playedLabel(game.playedOn)} · ${game.formatLabel} · ${state}`);
  lines.push("");

  if (game.match) {
    lines.push(`🏆 ${game.match.status}${game.match.detail ? ` · ${game.match.detail}` : ""}`);
  } else if (game.board) {
    for (const r of game.board.rows) lines.push(boardLine(game, r));
  }

  const parFront = front.reduce((n, h) => n + h.par, 0);
  const parBack = back.reduce((n, h) => n + h.par, 0);
  lines.push("");
  lines.push(`Par: ${front.map((h) => h.par).join(" ")}  (${parFront})${back.length ? ` | ${back.map((h) => h.par).join(" ")}  (${parBack})` : ""}`);

  for (const r of game.rows) {
    const mine = game.scores.get(r.id);
    const out = strokesOver(mine, front);
    const inn = back.length ? strokesOver(mine, back) : null;
    const total = strokesOver(mine, sorted);
    lines.push("");
    lines.push(`${r.name}${total != null ? ` — ${total}` : ""}`);
    lines.push(`Out: ${front.map((h) => cellFor(mine, h.hole)).join(" ")}${out != null ? `  (${out})` : ""}`);
    if (back.length) lines.push(`In:  ${back.map((h) => cellFor(mine, h.hole)).join(" ")}${inn != null ? `  (${inn})` : ""}`);
  }

  lines.push("");
  const site = game.siteUrl ? game.siteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : null;
  lines.push(`Scored live on PinPals${site ? ` · ${site}` : ""}`);
  return lines.join("\n");
}
