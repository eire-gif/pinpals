import {
  buildBoard,
  matchPoints,
  pointsLabel,
  teamMatchState,
  toParLabel,
  type CardHole,
  type MatchFormat,
  type ScoreSheet,
} from "@/lib/live-scoring";

/**
 * What the PinPals Home Screen widgets draw (Oct 2026).
 *
 * Pure: the route loads a member's live game (widget-data.ts) and this
 * turns it into finished strings, so the Swift widget only lays out text
 * and never does golf. The three sizes, as on the approved mock-up:
 *
 *   small   `mine`      your match ("2 UP") or your place ("2nd")
 *   medium  `teams` + `matches` for a match day; the top of `board` else
 *   large   `board` (or every match of a match day)
 *
 * Numbers come from live-scoring.ts, the same engine as the app's screens.
 */

export type WidgetPayload = {
  v: 1;
  state: "live" | "final" | "none";
  /** ISO time this was worked out. */
  updatedAt: string;
  /** Where a tap goes: the game in the app. */
  url: string;
  /** "PINPALS · BIG TEST" */
  eyebrow: string;
  /** "Portmarnock Links · Net" */
  title: string;
  /** Match day team totals: none, or both sides. */
  teams: { name: string; points: string; side: 1 | 2 }[];
  matches: { label: string; names: string; status: string; side: 0 | 1 | 2; mine: boolean }[];
  board: { heading: string; rows: { pos: string; name: string; thru: string; score: string; mine: boolean; good: boolean }[] } | null;
  mine: { eyebrow: string; title: string; big: string; line1: string; line2: string } | null;
};

export type WidgetRound = {
  id: number;
  matchDayId: number | null;
  matchNumber: number | null;
  /** stableford | stroke | matchplay (a scramble team is stored as stroke). */
  format: string;
  matchFormat: MatchFormat | null;
  status: "live" | "finished";
  courseName: string;
  teeTime: string | null;
  /** A scramble team, or (0136) a foursomes pair — `foursomes` says how it's ranked. */
  scramble: { teamName: string | null; teamNumber: number | null; teamHandicap: number; foursomes?: "stableford" | "stroke" | null } | null;
};

export type WidgetPlayer = {
  id: number;
  memberId: string | null;
  name: string;
  playingHandicap: number;
  courseHandicap: number;
  side: number | null;
  position: number;
};

export type WidgetGame = { round: WidgetRound; players: WidgetPlayer[]; card: CardHole[]; scores: ScoreSheet };

export type WidgetDay = { id: number; title: string; teamNames: [string, string] | null; kind: "match" | "scramble" };

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const MAX_ROWS = 8;

/** 1st, 2nd, 3rd, 4th… and T3 for a tie. */
export function ordinal(pos: string): string {
  if (!pos) return "–";
  if (pos.startsWith("T")) return pos;
  const n = Number(pos);
  if (!Number.isInteger(n) || n <= 0) return pos;
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

export function emptyPayload(now: Date, siteScheme = "pinpals"): WidgetPayload {
  return {
    v: 1,
    state: "none",
    updatedAt: now.toISOString(),
    url: `${siteScheme}://live`,
    eyebrow: "PINPALS",
    title: "No game in play",
    teams: [],
    matches: [],
    board: null,
    mine: null,
  };
}

const isMine = (g: WidgetGame, me: string) => g.players.some((p) => p.memberId === me);

/** A match's line: names by side, where it stands, who leads. */
function matchLine(g: WidgetGame, sideName: (n: 1 | 2) => string) {
  const format = g.round.matchFormat ?? "matchplay";
  const mps = g.players.map((p) => ({ id: p.id, name: p.name, playingHandicap: p.playingHandicap, courseHandicap: p.courseHandicap, side: p.side ?? 1, position: p.position }));
  const st = teamMatchState(format, g.card, mps, g.scores);
  const names = ([1, 2] as const)
    .map((n) => g.players.filter((p) => (p.side ?? 1) === n).sort((a, b) => a.position - b.position).map((p) => first(p.name)).join(" & "))
    .join(" v ");
  const played = st?.holes.length ?? 0;
  let status: string;
  if (!st || played === 0) status = g.round.teeTime ? g.round.teeTime : "–";
  else if (st.finished || g.round.status === "finished") status = st.margin;
  else status = `${st.leader === 0 ? "AS" : st.margin} · ${played}`;
  const side = (st?.leader ?? 0) as 0 | 1 | 2;
  return { st, names, status, side, played, leaderName: side ? sideName(side) : null };
}

/** Rank scramble teams by net to par (as the app's scramble board does);
 *  foursomes Stableford pairs (0136) by points. */
function teamBoard(games: WidgetGame[], onPoints: boolean) {
  const rows = games.map((g) => {
    const scr = g.round.scramble;
    const lead = [...g.players].sort((a, b) => a.position - b.position)[0];
    const name = scr?.teamName ?? `${scr?.foursomes ? "Pair" : "Team"} ${g.round.matchNumber ?? scr?.teamNumber ?? ""}`.trim();
    const r = lead ? buildBoard(scr?.foursomes ?? "stroke", g.card, [{ id: lead.id, name, playingHandicap: scr?.teamHandicap ?? 0 }], g.scores).rows[0] : null;
    const thru = r?.thru ?? 0;
    return { g, name, thru, net: r?.netToPar ?? 0, points: r?.points ?? 0, done: g.round.status === "finished" || thru === g.card.length, pos: "" };
  });
  const key = (r: (typeof rows)[number]) => (onPoints ? -r.points : r.net);
  const started = rows.filter((r) => r.thru > 0).sort((a, b) => key(a) - key(b) || b.thru - a.thru || a.name.localeCompare(b.name));
  for (const r of started) {
    const at = started.findIndex((o) => key(o) === key(r));
    r.pos = `${started.filter((o) => key(o) === key(r)).length > 1 ? "T" : ""}${at + 1}`;
  }
  return [...started, ...rows.filter((r) => r.thru === 0)];
}

export function buildWidgetPayload(input: {
  me: string;
  focus: WidgetGame;
  day: WidgetDay | null;
  /** Every game in the day (focus included), or just [focus]. */
  games: WidgetGame[];
  now: Date;
}): WidgetPayload {
  const { me, focus, day, now } = input;
  const games = input.games.length ? input.games : [focus];
  const live = games.some((g) => g.round.status === "live");
  const base = {
    v: 1 as const,
    state: (live ? "live" : "final") as WidgetPayload["state"],
    updatedAt: now.toISOString(),
    url: day ? `pinpals://live/day/${day.id}` : `pinpals://live/round/${focus.round.id}`,
  };

  // --- Scramble day: a team leaderboard ------------------------------------
  if (day?.kind === "scramble" || focus.round.scramble) {
    const foursomes = focus.round.scramble?.foursomes ?? null;
    const onPoints = foursomes === "stableford";
    const ranked = teamBoard(games, onPoints);
    const score = (r: (typeof ranked)[number]) => (onPoints ? `${r.points}` : toParLabel(r.net));
    const mineRow = ranked.find((r) => isMine(r.g, me)) ?? ranked.find((r) => r.g.round.id === focus.round.id);
    const leader = ranked.find((r) => r.thru > 0);
    return {
      ...base,
      eyebrow: `PINPALS · ${(day?.title ?? (foursomes ? "Foursomes" : "Scramble")).toUpperCase()}`,
      title: `${focus.round.courseName} · ${onPoints ? "Points" : "Net"}`,
      teams: [],
      matches: [],
      board: {
        heading: onPoints ? "PTS" : "NET",
        rows: ranked.slice(0, MAX_ROWS).map((r) => ({
          pos: r.pos || "–",
          name: r === mineRow ? `${r.name} · You` : r.name,
          thru: r.thru === 0 ? (r.g.round.teeTime ?? "–") : r.done ? "F" : String(r.thru),
          score: r.thru === 0 ? "–" : score(r),
          mine: r === mineRow,
          good: r.thru > 0 && (onPoints ? r.points > r.thru * 2 : r.net < 0),
        })),
      },
      mine: mineRow
        ? {
            eyebrow: foursomes ? "FOURSOMES" : "SCRAMBLE",
            title: mineRow.name,
            big: mineRow.thru === 0 ? "–" : ordinal(mineRow.pos),
            line1: mineRow.thru === 0 ? "Not started" : `${onPoints ? `${mineRow.points} pts` : `Net ${toParLabel(mineRow.net)}`} · ${mineRow.done ? "F" : `thru ${mineRow.thru}`}`,
            line2: leader && leader !== mineRow ? `Leader: ${leader.name} ${score(leader)}` : leader ? "You're leading" : "",
          }
        : null,
    };
  }

  // --- Matches: a match day, or a single matchplay round --------------------
  if (day || focus.round.matchFormat || focus.round.format === "matchplay") {
    const sideNameFor = (g: WidgetGame) => (n: 1 | 2) =>
      day?.teamNames?.[n - 1] ?? g.players.filter((p) => (p.side ?? 1) === n).sort((a, b) => a.position - b.position).map((p) => first(p.name)).join(" & ");
    const lines = games
      .slice()
      .sort((a, b) => (a.round.matchNumber ?? 0) - (b.round.matchNumber ?? 0))
      .map((g) => ({ g, ...matchLine(g, sideNameFor(g)) }));
    const myLine = lines.find((l) => isMine(l.g, me)) ?? lines.find((l) => l.g.round.id === focus.round.id) ?? lines[0];

    const teams: WidgetPayload["teams"] = [];
    if (day?.teamNames) {
      const pts: [number, number] = [0, 0];
      for (const l of lines) {
        const [a, b] = matchPoints(l.st, true);
        pts[0] += a;
        pts[1] += b;
      }
      teams.push({ name: day.teamNames[0], points: pointsLabel(pts[0]) || "0", side: 1 }, { name: day.teamNames[1], points: pointsLabel(pts[1]) || "0", side: 2 });
    }

    const myBig = !myLine?.st || myLine.played === 0 ? "–" : myLine.st.leader === 0 ? (myLine.st.finished ? "Halved" : "AS") : myLine.st.margin;
    const myMeta = !myLine || myLine.played === 0
      ? myLine?.g.round.teeTime ? `Tees off ${myLine.g.round.teeTime}` : "Not started"
      : `${myLine.leaderName ?? "All square"} · ${myLine.st?.finished || myLine.g.round.status === "finished" ? "final" : `thru ${myLine.played}`}`;

    return {
      ...base,
      eyebrow: `PINPALS · ${(day?.title ?? "Match").toUpperCase()}`,
      title: focus.round.courseName,
      teams,
      matches: lines.slice(0, MAX_ROWS).map((l) => ({
        label: `M${l.g.round.matchNumber ?? 1}`,
        names: l.names,
        status: l.status,
        side: l.side,
        mine: l === myLine,
      })),
      board: null,
      mine: myLine
        ? {
            eyebrow: "YOUR MATCH",
            title: `Match ${myLine.g.round.matchNumber ?? 1}`,
            big: myBig,
            line1: myMeta,
            line2: myLine.names,
          }
        : null,
    };
  }

  // --- A round: Stableford or stroke play ----------------------------------
  const stableford = focus.round.format === "stableford";
  const board = buildBoard(stableford ? "stableford" : "stroke", focus.card, focus.players.map((p) => ({ id: p.id, name: p.name, playingHandicap: p.playingHandicap })), focus.scores);
  const meRow = board.rows.find((r) => focus.players.find((p) => p.id === r.playerId)?.memberId === me);
  const leader = board.rows.find((r) => r.thru > 0);
  const scoreOf = (r: (typeof board.rows)[number]) => (stableford ? String(r.points) : toParLabel(r.netToPar));
  return {
    ...base,
    eyebrow: `PINPALS · ${stableford ? "STABLEFORD" : "STROKE PLAY"}`,
    title: `${focus.round.courseName}${stableford ? "" : " · Net"}`,
    teams: [],
    matches: [],
    board: {
      heading: stableford ? "PTS" : "NET",
      rows: board.rows.slice(0, MAX_ROWS).map((r) => ({
        pos: r.position || "–",
        name: r === meRow ? `${first(r.name)} · You` : r.name,
        thru: r.thru === 0 ? "–" : r.thru === focus.card.length ? "F" : String(r.thru),
        score: r.thru === 0 ? "–" : scoreOf(r),
        mine: r === meRow,
        good: r.thru > 0 && (stableford ? r.points >= r.thru * 2 : r.netToPar < 0),
      })),
    },
    mine: meRow
      ? {
          eyebrow: stableford ? "STABLEFORD" : "STROKE PLAY",
          title: focus.round.courseName,
          big: meRow.thru === 0 ? "–" : ordinal(meRow.position),
          line1: meRow.thru === 0 ? "Not started" : `${stableford ? `${meRow.points} pts` : `Net ${toParLabel(meRow.netToPar)}`} · ${meRow.thru === focus.card.length ? "F" : `thru ${meRow.thru}`}`,
          line2: leader && leader !== meRow ? `Leader: ${first(leader.name)} ${scoreOf(leader)}` : leader ? "You're leading" : "",
        }
      : null,
  };
}
