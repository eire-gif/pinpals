import {
  buildBoard,
  isOneBallPerSide,
  shotsSoFar,
  stablefordPoints,
  teamMatchState,
  toParLabel,
  type CardHole,
  type MatchPlayer,
} from "@/lib/live-scoring";
import { ordinal, teamBoard, type WidgetGame } from "@/lib/widget-board";

/**
 * "Follow my round" (0158): the one card a follower sees — a parent at home,
 * a friend at work — built from the live game.
 *
 * Pure, like widget-board.ts: the route loads the game (follow-data.ts) and
 * this turns it into finished strings and numbers, so the web page, the app
 * screen and the Home Screen widget all say the same thing.
 *
 * PRIVACY. Only the shared player's own card (or, where a side plays one
 * ball — scramble, foursomes, greensomes — their side's) and where they
 * stand as a place: "2nd of 4". Never another player's name or score:
 * they didn't share anything.
 */

export type FollowTone = "ace" | "albatross" | "eagle" | "birdie" | "par" | "bogey" | "double" | "pickup" | "none";

export type FollowHole = {
  hole: number;
  par: number;
  strokeIndex: number | null;
  /** Shots received on this hole (dots on a card). */
  shots: number;
  /** Gross strokes; null = picked up; undefined = not played yet. */
  strokes: number | null | undefined;
  /** The figure that counts in this format: "3" points, "+1" net, "W"/"L"/"½". Empty if not played. */
  value: string;
  /** Gross against par, for colouring. */
  tone: FollowTone;
};

export type FollowHalf = { label: "Out" | "In"; par: number; strokes: string; value: string };

export type FollowCard = {
  v: 1;
  state: "live" | "final";
  updatedAt: string;
  /** "Aoife" or "The Blues" (a scramble team) — whose card this is. */
  name: string;
  firstName: string;
  /** "Plays off 18" / "Team handicap 8". */
  handicapLine: string;
  course: string;
  /** "Stableford", "Stroke play", "Singles matchplay"… */
  formatLabel: string;
  /** "Sat 17 Oct" */
  dateLabel: string;
  /** What the value column means: PTS, NET or MATCH. */
  valueHeading: string;
  summary: {
    /** "32" / "+4" / "2 UP" / "Won 3&2" */
    big: string;
    /** "pts" / "net" / "" */
    unit: string;
    /** "Thru 11", "Finished", "Not started" */
    progress: string;
    /** "2nd of 4", or null when it means nothing (alone, or a match). */
    place: string | null;
    /** "Gross 51" */
    extra: string | null;
  };
  /** The hole they're playing now, if live and not done. */
  nowPlaying: number | null;
  holes: FollowHole[];
  halves: FollowHalf[];
  /** The holes are partly without stroke indexes, so nets are approximate. */
  cardIncomplete: boolean;
};

const FORMAT_LABEL: Record<string, string> = {
  stableford: "Stableford",
  stroke: "Stroke play",
  matchplay: "Singles matchplay",
  fourball: "Fourball matchplay",
  foursomes: "Foursomes matchplay",
  greensomes: "Greensomes matchplay",
};

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export function toneOf(strokes: number | null | undefined, par: number): FollowTone {
  if (strokes === undefined) return "none";
  if (strokes === null) return "pickup";
  const d = strokes - par;
  if (strokes === 1) return "ace";
  if (d <= -3) return "albatross";
  if (d === -2) return "eagle";
  if (d === -1) return "birdie";
  if (d === 0) return "par";
  if (d === 1) return "bogey";
  return "double";
}

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" }).replace(",", "");
}

/** The ball that's followed: the player's own, or their side's one ball. */
function ballOf(game: WidgetGame, playerId: number): { ballId: number; label: string; handicap: number; handicapLine: string } | null {
  const me = game.players.find((p) => p.id === playerId);
  if (!me) return null;
  const r = game.round;
  if (r.scramble) {
    const lead = [...game.players].sort((a, b) => a.position - b.position)[0];
    const label = r.scramble.teamName ?? `${r.scramble.foursomes ? "Pair" : "Team"} ${r.matchNumber ?? r.scramble.teamNumber ?? ""}`.trim();
    return { ballId: lead.id, label: `${first(me.name)} · ${label}`, handicap: r.scramble.teamHandicap, handicapLine: `Team handicap ${r.scramble.teamHandicap}` };
  }
  if (r.matchFormat && isOneBallPerSide(r.matchFormat)) {
    const side = me.side ?? 1;
    const lead = game.players.filter((p) => (p.side ?? 1) === side).sort((a, b) => a.position - b.position)[0] ?? me;
    return { ballId: lead.id, label: me.name, handicap: me.playingHandicap, handicapLine: "Plays with a partner, one ball" };
  }
  return { ballId: me.id, label: me.name, handicap: me.playingHandicap, handicapLine: `Plays off ${me.playingHandicap}` };
}

export function buildFollowCard(input: {
  game: WidgetGame;
  playerId: number;
  /** The other teams of a scramble / foursomes day, for the place. */
  dayGames?: WidgetGame[];
  playedOn?: string | null;
  now: Date;
}): FollowCard | null {
  const { game, playerId, now } = input;
  const ball = ballOf(game, playerId);
  const me = game.players.find((p) => p.id === playerId);
  if (!ball || !me) return null;

  const r = game.round;
  const card: CardHole[] = [...game.card].sort((a, b) => a.hole - b.hole);
  const mine = game.scores.get(ball.ballId) ?? new Map<number, number | null>();
  const match = r.scramble ? null : (r.matchFormat ?? (r.format === "matchplay" ? "matchplay" : null));
  const stableford = r.scramble ? r.scramble.foursomes === "stableford" : r.format === "stableford";

  // Shots on each hole. In a match they're the competitor's match shots.
  let shotMap: Map<number, number>;
  let matchState: ReturnType<typeof teamMatchState> = null;
  if (match) {
    const mps: MatchPlayer[] = game.players.map((p) => ({
      id: p.id,
      name: p.name,
      playingHandicap: p.playingHandicap,
      courseHandicap: p.courseHandicap,
      side: p.side ?? 1,
      position: p.position,
    }));
    matchState = teamMatchState(match, card, mps, game.scores);
    const comp = matchState?.competitors.find((c) => c.playerIds.includes(me.id));
    shotMap = shotsSoFar(comp?.shots ?? 0, card);
  } else {
    shotMap = shotsSoFar(ball.handicap, card);
  }

  const mySide = (me.side ?? 1) as 1 | 2;
  const resultOf = new Map((matchState?.holes ?? []).map((h) => [h.hole, h.result]));

  const holes: FollowHole[] = card.map((h) => {
    const played = mine.has(h.hole);
    const strokes = played ? (mine.get(h.hole) ?? null) : undefined;
    const shots = shotMap.get(h.hole) ?? 0;
    let value = "";
    if (match) {
      const res = resultOf.get(h.hole);
      if (res) {
        const won = mySide === 1 ? res === "won" : res === "lost";
        const lost = mySide === 1 ? res === "lost" : res === "won";
        value = won ? "W" : lost ? "L" : "½";
      }
    } else if (played) {
      value = stableford ? String(stablefordPoints(strokes ?? null, h.par, shots)) : strokes == null ? "NR" : toParLabel(strokes - shots - h.par);
    }
    return { hole: h.hole, par: h.par, strokeIndex: h.strokeIndex, shots, strokes, value, tone: toneOf(strokes, h.par) };
  });

  const thru = holes.filter((h) => h.strokes !== undefined).length;
  const done = r.status === "finished" || (thru === card.length && card.length > 0);
  const state: FollowCard["state"] = r.status === "finished" ? "final" : "live";
  const nowPlaying = done ? null : (holes.find((h) => h.strokes === undefined)?.hole ?? null);
  const progress = thru === 0 ? "Not started" : done ? "Finished" : `Thru ${thru}`;

  // Running totals, from the same engine as the leaderboard.
  const board = buildBoard(stableford ? "stableford" : "stroke", card, [{ id: ball.ballId, name: ball.label, playingHandicap: ball.handicap }], new Map([[ball.ballId, mine]]));
  const row = board.rows[0];
  const grossShown = holes.some((h) => h.strokes === null) ? null : holes.reduce((s, h) => s + (h.strokes ?? 0), 0);

  let summary: FollowCard["summary"];
  if (match) {
    const st = matchState;
    const played = st?.holes.length ?? 0;
    const rel = (st?.up ?? 0) * (mySide === 1 ? 1 : -1);
    let big: string;
    if (!st || played === 0) big = "–";
    else if (st.finished) big = st.leader === 0 ? "Halved" : `${st.leader === mySide ? "Won" : "Lost"} ${st.margin}`;
    else big = rel === 0 ? "All square" : `${Math.abs(rel)} ${rel > 0 ? "UP" : "DOWN"}`;
    summary = { big, unit: "", progress: st?.finished ? "Finished" : played === 0 ? progress : `Thru ${played}`, place: null, extra: st?.dormie ? "Dormie" : null };
  } else {
    // Place: among the round's players, or among the day's teams.
    let place: string | null = null;
    if (r.scramble) {
      const games = input.dayGames && input.dayGames.length ? input.dayGames : [game];
      if (games.length > 1) {
        const ranked = teamBoard(games, stableford);
        const mineRow = ranked.find((x) => x.g.round.id === r.id);
        if (mineRow && mineRow.thru > 0) place = `${ordinal(mineRow.pos)} of ${ranked.length}`;
      }
    } else if (game.players.length > 1) {
      const all = buildBoard(stableford ? "stableford" : "stroke", card, game.players.map((p) => ({ id: p.id, name: p.name, playingHandicap: p.playingHandicap })), game.scores);
      const mineRow = all.rows.find((x) => x.playerId === me.id);
      if (mineRow && mineRow.thru > 0) place = `${ordinal(mineRow.position)} of ${all.rows.length}`;
    }
    summary = {
      big: thru === 0 ? "–" : stableford ? String(row?.points ?? 0) : toParLabel(row?.netToPar ?? 0),
      unit: thru === 0 ? "" : stableford ? "pts" : "net",
      progress,
      place,
      extra: thru > 0 && grossShown != null ? `Gross ${grossShown}` : null,
    };
  }

  const halves: FollowHalf[] = [];
  if (card.length === 18) {
    for (const [label, from, to] of [["Out", 1, 9], ["In", 10, 18]] as const) {
      const part = holes.filter((h) => h.hole >= from && h.hole <= to);
      const playedPart = part.filter((h) => h.strokes !== undefined);
      const anyPickup = playedPart.some((h) => h.strokes === null);
      const strokes = playedPart.length === 0 ? "" : anyPickup ? "NR" : String(playedPart.reduce((s, h) => s + (h.strokes ?? 0), 0));
      let value = "";
      if (playedPart.length && !match) {
        value = stableford
          ? String(playedPart.reduce((s, h) => s + Number(h.value || 0), 0))
          : anyPickup
            ? "NR"
            : toParLabel(playedPart.reduce((s, h) => s + ((h.strokes as number) - h.shots - h.par), 0));
      }
      halves.push({ label, par: part.reduce((s, h) => s + h.par, 0), strokes, value });
    }
  }

  const formatLabel = r.scramble
    ? r.scramble.foursomes
      ? `Foursomes ${r.scramble.foursomes === "stableford" ? "Stableford" : "stroke play"}`
      : "Scramble"
    : (FORMAT_LABEL[match ?? r.format] ?? "Live round");

  return {
    v: 1,
    state,
    updatedAt: now.toISOString(),
    name: ball.label,
    firstName: first(me.name),
    handicapLine: ball.handicapLine,
    course: r.courseName,
    formatLabel,
    dateLabel: dateLabel(input.playedOn ?? null),
    valueHeading: match ? "MATCH" : stableford ? "PTS" : "NET",
    summary,
    nowPlaying,
    holes,
    halves,
    cardIncomplete: board.cardIncomplete,
  };
}

/** "Ciara: birdie on 7" — what changed between two polls worth a flash. */
export function newHighlight(before: FollowCard | null, after: FollowCard): { hole: number; tone: FollowTone } | null {
  if (!before) return null;
  const was = new Map(before.holes.map((h) => [h.hole, h.strokes]));
  for (const h of after.holes) {
    if (h.strokes === undefined || h.strokes === was.get(h.hole)) continue;
    if (h.tone === "birdie" || h.tone === "eagle" || h.tone === "albatross" || h.tone === "ace") return { hole: h.hole, tone: h.tone };
  }
  return null;
}
