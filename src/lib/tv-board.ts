import { highlightKind, scorerLabel, type HighlightKind } from "@/lib/live-highlight-rules";
import {
  buildBoard,
  isOneBallPerSide,
  matchPoints,
  pointsLabel,
  shotsSoFar,
  stablefordPoints,
  teamHandicapLabel,
  teamMatchState,
  toParLabel,
  type CardHole,
  type MatchFormat,
  type ScoreSheet,
} from "@/lib/live-scoring";

/**
 * What the clubhouse TV draws (Oct 2026) — the leaderboard on a bar or lobby
 * screen while a society day, scramble, match day or single round is out.
 *
 * Pure, like widget-board.ts: tv-data.ts loads the day and this turns it into
 * finished strings, so the TV page only lays them out. Numbers come from
 * live-scoring.ts, the engine behind the app's own boards, so the TV can
 * never disagree with the phones.
 *
 * Three boards, as on the approved mock-ups (canvas "PinPals TV Leaderboard"):
 *   players  a society day or one round — Stableford by points, stroke by net
 *   teams    a scramble or foursomes-pairs day
 *   matches  a match day: team totals, "if it ended now", each match
 * plus `highlights`, every birdie or better so far (newest first), which the
 * TV both lists and flashes up as they arrive.
 */

export type TvRound = {
  id: number;
  matchNumber: number | null;
  /** stableford | stroke | matchplay (a scramble team is stored as stroke). */
  format: string;
  matchFormat: MatchFormat | null;
  status: "live" | "finished";
  courseName: string;
  teeTime: string | null;
  scramble: {
    teamName: string | null;
    teamNumber: number | null;
    teamHandicap: number;
    /** Set by hand (0189): the worked-out figure it replaced. */
    teamHandicapAuto?: number | null;
    foursomes: "stableford" | "stroke" | null;
    greensomes?: boolean;
  } | null;
};

export type TvPlayer = {
  id: number;
  memberId: string | null;
  name: string;
  /** Home club as on their profile; null for a guest or none given. */
  club: string | null;
  playingHandicap: number;
  courseHandicap: number;
  side: number | null;
  position: number;
};

/** One score as entered, with when — for "what hole are they on" and the feed. */
export type TvEntry = { playerId: number; hole: number; strokes: number | null; at: string };

export type TvGame = { round: TvRound; players: TvPlayer[]; card: CardHole[]; scores: ScoreSheet; entries: TvEntry[] };

export type TvDay = { id: number; title: string; teamNames: [string, string] | null; kind: "match" | "scramble" | "fourballs" };

export type TvRow = {
  key: string;
  pos: string;
  name: string;
  /** Club for a player; the players' first names for a team. */
  sub: string;
  hcp: string;
  /** The hole being played ("14"), "F" when done, a tee time or "–" before. */
  on: string;
  out: string;
  inn: string;
  score: string;
  started: boolean;
  done: boolean;
};

export type TvMatch = { key: string; label: string; left: string; right: string; status: string; side: 0 | 1 | 2; thru: string };

export type TvHighlight = {
  id: string;
  kind: HighlightKind;
  /** The board row it belongs to (TvRow.key), for the row's badge. */
  rowKey: string;
  /** "Birdie!" */
  headline: string;
  who: string;
  sub: string;
  hole: number;
  par: number;
  strokes: number;
  /** "+3" Stableford points on the hole, when the board is on points. */
  points: string | null;
  /** Their place on the board now ("T3"), when there is one. */
  now: string | null;
  at: string;
};

export type TvPayload = {
  v: 1;
  state: "live" | "final";
  updatedAt: string;
  kind: "players" | "teams" | "matches";
  /** "PINPALS · AUTUMN OUTING" */
  eyebrow: string;
  /** "Autumn Outing · The Island" */
  title: string;
  /** "Individual Stableford · Net · 24 players · 3 groups out" */
  subtitle: string;
  /** Column headings for OUT / IN and the score. */
  ninesHeading: "PTS" | "GROSS";
  scoreHeading: "PTS" | "NET";
  nineHoles: boolean;
  rows: TvRow[];
  teams: { name: string; points: string; side: 1 | 2 }[];
  /** "If it ended now: 6 – 4", each side's points as they stand (team colours either side on the TV). */
  projected: { left: string; right: string } | null;
  toWin: string | null;
  matches: TvMatch[];
  highlights: TvHighlight[];
  stats: { label: string; value: string }[];
  /** The footnote: provisional until the organiser publishes, or published. */
  note: string;
};

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

const HEADLINE: Record<HighlightKind, string> = { birdie: "Birdie!", eagle: "Eagle!", albatross: "Albatross!", hole_in_one: "Hole in one!" };

/** Points or counted strokes over each nine for one card line (a player, or a team's ball). */
export function ninesFor(card: readonly CardHole[], playingHcp: number, mine: ReadonlyMap<number, number | null> | undefined) {
  const shots = shotsSoFar(playingHcp, card);
  const nine = (from: number, to: number) => {
    let points = 0;
    let counted = 0;
    let n = 0;
    for (const h of card) {
      if (h.hole < from || h.hole > to || !mine?.has(h.hole)) continue;
      const s = shots.get(h.hole) ?? 0;
      const strokes = mine.get(h.hole) ?? null;
      n += 1;
      points += stablefordPoints(strokes, h.par, s);
      counted += strokes ?? h.par + 2 + s;
    }
    return { points, counted, n };
  };
  return { out: nine(1, 9), inn: nine(10, 18) };
}

/** The hole a group is on: the one after the last hole scored (in card order,
 *  wrapping, so a two-tee start from the 10th reads right). */
export function holeOn(game: TvGame, thru: number): string {
  if (game.round.status === "finished" || (thru > 0 && thru >= game.card.length)) return "F";
  if (thru === 0) return game.round.teeTime ?? "–";
  let last: TvEntry | null = null;
  for (const e of game.entries) if (!last || e.at > last.at || (e.at === last.at && e.hole > last.hole)) last = e;
  const order = game.card.map((h) => h.hole);
  if (!last) return "–";
  const at = order.indexOf(last.hole);
  return String(order[(at + 1) % order.length] ?? "–");
}

function rankRows<T extends { started: boolean; key: string; name: string; thru: number; pos: string }>(rows: T[], sortKey: (r: T) => number): T[] {
  const started = rows.filter((r) => r.started).sort((a, b) => sortKey(a) - sortKey(b) || b.thru - a.thru || a.name.localeCompare(b.name));
  for (const r of started) {
    const at = started.findIndex((o) => sortKey(o) === sortKey(r));
    r.pos = `${started.filter((o) => sortKey(o) === sortKey(r)).length > 1 ? "T" : ""}${at + 1}`;
  }
  return [...started, ...rows.filter((r) => !r.started)];
}

const nineLabel = (x: { n: number; points: number; counted: number }, onPoints: boolean) => (x.n === 0 ? "–" : String(onPoints ? x.points : x.counted));

export function buildTvPayload(input: { day: TvDay | null; games: TvGame[]; published: boolean; now: Date }): TvPayload {
  const { day, now } = input;
  const games = [...input.games].sort((a, b) => (a.round.matchNumber ?? 0) - (b.round.matchNumber ?? 0) || a.round.id - b.round.id);
  const lead = games[0];
  const live = games.some((g) => g.round.status === "live");
  const courseName = lead?.round.courseName ?? "";
  const nineHoles = (lead?.card.length ?? 18) <= 9;
  const base = {
    v: 1 as const,
    state: (live ? "live" : "final") as TvPayload["state"],
    updatedAt: now.toISOString(),
    eyebrow: `PINPALS${day ? ` · ${day.title.toUpperCase()}` : ""}`,
    title: day ? `${day.title} · ${courseName}` : courseName,
    nineHoles,
    note: input.published ? "Results published · see them in the PinPals app" : "Scores are provisional until the organiser publishes the results",
  };

  const groupsOut = games.filter((g) => g.round.status === "live" && g.entries.length > 0 && new Set(g.entries.map((e) => e.hole)).size < g.card.length).length;

  // --- Matches: a match day, or one matchplay round -------------------------
  const isMatch = day ? day.kind === "match" : lead ? lead.round.format === "matchplay" && !lead.round.scramble : false;
  if (isMatch) {
    const sideNames = (g: TvGame, n: 1 | 2) =>
      g.players
        .filter((p) => (p.side ?? 1) === n)
        .sort((a, b) => a.position - b.position)
        .map((p) => first(p.name))
        .join(" & ");
    const pts: [number, number] = [0, 0];
    const proj: [number, number] = [0, 0];
    const matches: TvMatch[] = games.map((g) => {
      const format = g.round.matchFormat ?? "matchplay";
      const mps = g.players.map((p) => ({ id: p.id, name: p.name, playingHandicap: p.playingHandicap, courseHandicap: p.courseHandicap, side: p.side ?? 1, position: p.position }));
      const st = teamMatchState(format, g.card, mps, g.scores);
      const done = !!st?.finished || g.round.status === "finished";
      const [a, b] = done ? matchPoints(st, true) : [0, 0];
      pts[0] += a;
      pts[1] += b;
      const [pa, pb] = matchPoints(st, true);
      proj[0] += pa;
      proj[1] += pb;
      const played = st?.holes.length ?? 0;
      const status = !st || played === 0 ? "–" : st.leader === 0 ? (done ? "Halved" : "AS") : st.margin;
      return {
        key: `m${g.round.id}`,
        label: `M${g.round.matchNumber ?? 1}`,
        left: sideNames(g, 1),
        right: sideNames(g, 2),
        status,
        side: (st?.leader ?? 0) as 0 | 1 | 2,
        thru: done && played > 0 ? "Final" : played > 0 ? `thru ${played}` : g.round.teeTime ? `Tees off ${g.round.teeTime}` : "Not started",
      };
    });
    const names: [string, string] = day?.teamNames ?? [lead ? sideNames(lead, 1) : "", lead ? sideNames(lead, 2) : ""];
    const toWin = games.length / 2 + 0.5;
    const highlights = highlightsFor(games, null, false);
    return {
      ...base,
      kind: "matches",
      subtitle: [`${games.length} ${games.length === 1 ? "match" : "matches"}`, live ? `${matches.filter((m) => m.thru.startsWith("thru")).length} out on the course` : "All in"].join(" · "),
      ninesHeading: "PTS",
      scoreHeading: "PTS",
      rows: [],
      teams: day?.teamNames
        ? [
            { name: names[0], points: pointsLabel(pts[0]) || "0", side: 1 },
            { name: names[1], points: pointsLabel(pts[1]) || "0", side: 2 },
          ]
        : [],
      projected: day?.teamNames ? { left: pointsLabel(proj[0]) || "0", right: pointsLabel(proj[1]) || "0" } : null,
      toWin: day?.teamNames && games.length > 1 ? `${pointsLabel(toWin)} to win` : null,
      matches,
      highlights,
      stats: [
        { label: "Matches finished", value: `${matches.filter((m) => m.thru === "Final").length} of ${matches.length}` },
        { label: "Birdies or better", value: String(highlights.length) },
      ],
    };
  }

  // --- Teams: a scramble day, or foursomes pairs -----------------------------
  if (day?.kind === "scramble" || lead?.round.scramble) {
    const foursomes = lead?.round.scramble?.foursomes ?? null;
    const onPoints = foursomes === "stableford";
    const rows = games.map((g) => {
      const scr = g.round.scramble;
      const leadPlayer = [...g.players].sort((a, b) => a.position - b.position)[0];
      const name = scr?.teamName?.trim() || `${scr?.foursomes ? "Pair" : "Team"} ${g.round.matchNumber ?? scr?.teamNumber ?? ""}`.trim();
      const hcp = scr?.teamHandicap ?? 0;
      const r = leadPlayer ? buildBoard(scr?.foursomes ?? "stroke", g.card, [{ id: leadPlayer.id, name, playingHandicap: hcp }], g.scores).rows[0] : null;
      const thru = r?.thru ?? 0;
      const nines = ninesFor(g.card, hcp, leadPlayer ? g.scores.get(leadPlayer.id) : undefined);
      return {
        key: `t${g.round.id}`,
        pos: "",
        name,
        // A team handicap set by hand (0189) says so on the screen, with the worked-out figure.
        sub:
          [...g.players].sort((a, b) => a.position - b.position).map((p) => first(p.name)).join(", ") +
          (scr?.teamHandicapAuto != null ? ` · handicap set by hand (worked out ${teamHandicapLabel(scr.teamHandicapAuto)})` : ""),
        hcp: teamHandicapLabel(hcp),
        on: holeOn(g, thru),
        out: nineLabel(nines.out, onPoints),
        inn: nineHoles ? "–" : nineLabel(nines.inn, onPoints),
        score: thru === 0 ? "–" : onPoints ? String(r?.points ?? 0) : toParLabel(r?.netToPar ?? 0),
        started: thru > 0,
        done: g.round.status === "finished" || thru >= g.card.length,
        thru,
        sortKey: onPoints ? -(r?.points ?? 0) : r?.netToPar ?? 0,
      };
    });
    const ranked = rankRows(rows, (r) => r.sortKey);
    const highlights = highlightsFor(games, ranked, onPoints);
    return {
      ...base,
      kind: "teams",
      subtitle: [foursomes ? `${lead?.round.scramble?.greensomes ? "Greensomes" : "Foursomes"} · ${onPoints ? "Stableford" : "Stroke play"}` : `${lead?.players.length ?? 4}-person scramble · Net`, `${games.length} ${foursomes ? "pairs" : "teams"}`, live && groupsOut ? `${groupsOut} out on the course` : null]
        .filter(Boolean)
        .join(" · "),
      ninesHeading: onPoints ? "PTS" : "GROSS",
      scoreHeading: onPoints ? "PTS" : "NET",
      rows: ranked.map(strip),
      teams: [],
      projected: null,
      toWin: null,
      matches: [],
      highlights,
      stats: statsFor(ranked, highlights),
    };
  }

  // --- Players: a society day (every tee group on one board) or one round ----
  const stroke = games.some((g) => g.round.format === "stroke");
  const rows = games.flatMap((g) => {
    const board = buildBoard(stroke ? "stroke" : "stableford", g.card, g.players.map((p) => ({ id: p.id, name: p.name, playingHandicap: p.playingHandicap })), g.scores);
    return board.rows.map((r) => {
      const p = g.players.find((x) => x.id === r.playerId)!;
      const nines = ninesFor(g.card, p.playingHandicap, g.scores.get(p.id));
      return {
        key: `p${p.id}`,
        pos: "",
        name: p.name,
        sub: p.club ?? (p.memberId ? "" : "Guest"),
        hcp: String(p.playingHandicap),
        on: holeOn(g, r.thru),
        out: nineLabel(nines.out, !stroke),
        inn: nineHoles ? "–" : nineLabel(nines.inn, !stroke),
        score: r.thru === 0 ? "–" : stroke ? toParLabel(r.netToPar) : String(r.points),
        started: r.thru > 0,
        done: g.round.status === "finished" || r.thru >= g.card.length,
        thru: r.thru,
        sortKey: stroke ? r.netToPar : -r.points,
      };
    });
  });
  const ranked = rankRows(rows, (r) => r.sortKey);
  const highlights = highlightsFor(games, ranked, !stroke);
  return {
    ...base,
    kind: "players",
    subtitle: [
      `Individual ${stroke ? "stroke play" : "Stableford"} · Net`,
      `${rows.length} ${rows.length === 1 ? "player" : "players"}`,
      games.length > 1 && live ? `${groupsOut} ${groupsOut === 1 ? "group" : "groups"} out` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    ninesHeading: stroke ? "GROSS" : "PTS",
    scoreHeading: stroke ? "NET" : "PTS",
    rows: ranked.map(strip),
    teams: [],
    projected: null,
    toWin: null,
    matches: [],
    highlights,
    stats: statsFor(ranked, highlights),
  };
}

function strip(r: TvRow & { thru: number; sortKey: number }): TvRow {
  const { key, pos, name, sub, hcp, on, out, inn, score, started, done } = r;
  return { key, pos, name, sub, hcp, on, out, inn, score, started, done };
}

function statsFor(rows: { done: boolean; started: boolean }[], highlights: TvHighlight[]) {
  return [
    { label: "Cards in", value: `${rows.filter((r) => r.done).length} of ${rows.length}` },
    { label: "Birdies or better", value: String(highlights.length) },
  ];
}

/** Every birdie or better on every card, newest first. A scramble team or
 *  foursomes pair is credited as one, as the app's alerts do. */
function highlightsFor(games: TvGame[], ranked: { key: string; pos: string }[] | null, onPoints: boolean): TvHighlight[] {
  const out: TvHighlight[] = [];
  for (const g of games) {
    const oneBall = !!g.round.scramble || (g.round.matchFormat ? isOneBallPerSide(g.round.matchFormat) : false);
    const parOf = new Map(g.card.map((h) => [h.hole, h.par]));
    const seen = new Set<string>();
    for (const e of g.entries) {
      const par = parOf.get(e.hole);
      if (par == null) continue;
      const kind = highlightKind(e.strokes, par);
      if (!kind || e.strokes == null) continue;
      const scorer = g.players.find((p) => p.id === e.playerId);
      if (!scorer) continue;
      // A one-ball side is stored against its first player; never twice.
      const side = oneBall ? `${g.round.id}-${scorer.side ?? 0}-${e.hole}` : `${scorer.id}-${e.hole}`;
      if (seen.has(side)) continue;
      seen.add(side);
      const who = g.round.scramble || oneBall
        ? scorerLabel({ scorer: { name: scorer.name, side: scorer.side }, roundPlayers: g.players, scramble: g.round.scramble, oneBallPerSide: oneBall })
        : scorer.name;
      const handicap = g.round.scramble ? g.round.scramble.teamHandicap : scorer.playingHandicap;
      const shots = shotsSoFar(handicap, g.card).get(e.hole) ?? 0;
      const rowKey = g.round.scramble ? `t${g.round.id}` : `p${scorer.id}`;
      const pos = ranked?.find((r) => r.key === rowKey)?.pos || null;
      out.push({
        id: `${g.round.id}-${e.playerId}-${e.hole}-${e.strokes}`,
        kind,
        rowKey,
        headline: HEADLINE[kind],
        who,
        sub: g.round.scramble ? "" : scorer.club ?? "",
        hole: e.hole,
        par,
        strokes: e.strokes,
        points: onPoints ? `+${stablefordPoints(e.strokes, par, shots)}` : null,
        now: pos,
        at: e.at,
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
}
