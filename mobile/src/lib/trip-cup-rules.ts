/**
 * Ryder Cup mode for trips (0200, claude/ryder-cup-mode.md): the pure half.
 *
 * Two teams over a trip, a format for each round, one running points total.
 * Every match is worth a point, a halved match half each. The Cup is won
 * with more than half the points; the holders keep it on a tie.
 *
 * Pure, no imports: tested in trip-cup-rules.test.ts.
 */

export type CupFormat = "fourball" | "foursomes" | "greensomes" | "singles";
export type Team = 1 | 2;
export type PickMode = "captains" | "balanced" | "random";

export const CUP_FORMATS: readonly CupFormat[] = ["fourball", "foursomes", "greensomes", "singles"];

export const CUP_FORMAT_LABEL: Record<CupFormat, string> = {
  fourball: "Fourballs",
  foursomes: "Foursomes",
  greensomes: "Greensomes",
  singles: "Singles",
};

/** The handicap allowance each format is played off (as Match Day Fun, 0104). */
export const CUP_ALLOWANCE_LABEL: Record<CupFormat, string> = {
  fourball: "90% allowance",
  foursomes: "50% of the pair's combined",
  greensomes: "60% / 40%",
  singles: "full difference",
};

/** Players a side in one match. */
export const perSide = (f: CupFormat): 1 | 2 => (f === "singles" ? 1 : 2);

/** Matches a session can have with these team sizes: as many as the smaller team fills. */
export function matchesFor(format: CupFormat, team1: number, team2: number): number {
  return Math.floor(Math.min(team1, team2) / perSide(format));
}

/** "6½", "½", "0". */
export function pts(n: number): string {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  if (whole === 0 && half) return "½";
  return `${whole}${half ? "½" : ""}`;
}

export type SessionScore = {
  /** Points on offer: the started day's matches, or what the teams would fill. */
  points: number;
  /** Points from finished matches. */
  final: [number, number];
  /** If every match ended as it stands now. */
  projected: [number, number];
  started: boolean;
  /** Every match in it finished. */
  done: boolean;
};

export type CupState = {
  points: number;
  final: [number, number];
  projected: [number, number];
  /** What a team needs to win it outright (more than half). */
  toWin: number;
  /** What the holders need to keep it (half), or null with no holders. */
  toRetain: number | null;
  /** Points still to be decided (not yet finished). */
  remaining: number;
  /** Decided: the team that has it, and how. */
  decided: { team: Team; how: "won" | "retained" } | null;
  /** Every session done. */
  over: boolean;
  /** Points each team still needs (0 once they have it), from the final score. */
  needs: [number, number];
};

export function cupState(sessions: readonly SessionScore[], holders: Team | null): CupState {
  const points = sessions.reduce((n, s) => n + s.points, 0);
  const final: [number, number] = [0, 0];
  const projected: [number, number] = [0, 0];
  for (const s of sessions) {
    final[0] += s.final[0];
    final[1] += s.final[1];
    projected[0] += s.projected[0];
    projected[1] += s.projected[1];
  }
  const toWin = points / 2 + 0.5;
  const toRetain = holders ? points / 2 : null;
  const remaining = Math.max(0, points - final[0] - final[1]);
  const over = sessions.length > 0 && sessions.every((s) => s.done);

  let decided: CupState["decided"] = null;
  for (const t of [1, 2] as const) {
    if (points > 0 && final[t - 1] >= toWin) decided = { team: t, how: "won" };
  }
  if (!decided && holders && toRetain != null && points > 0) {
    const other = holders === 1 ? 2 : 1;
    // The holders keep it once the other side can no longer get past half.
    if (final[holders - 1] >= toRetain || final[other - 1] + remaining < toWin) decided = { team: holders, how: "retained" };
  }

  const need = (t: Team): number => {
    const target = holders === t && toRetain != null ? toRetain : toWin;
    return Math.max(0, target - final[t - 1]);
  };
  return { points, final, projected, toWin, toRetain, remaining, decided, over, needs: [need(1), need(2)] };
}

/** The Cup's result in words, once it's decided or over. */
export function cupResultLine(state: CupState, names: readonly [string, string], holders: Team | null): string | null {
  const score = `${pts(state.final[0])} – ${pts(state.final[1])}`;
  if (state.decided) {
    const name = names[state.decided.team - 1];
    if (state.decided.how === "retained") return `${name} keep the Cup, ${score}`;
    return holders && holders !== state.decided.team ? `${name} take the Cup, ${score}` : `${name} win the Cup, ${score}`;
  }
  if (state.over) return `Shared, ${score}`;
  return null;
}

/** Whose pick it is in a captains' pick: team 1 when level, otherwise the smaller team. */
export function pickTurn(team1: number, team2: number): Team {
  return team1 <= team2 ? 1 : 2;
}

export type CupPlayer = { memberId: string; name: string; index: number | null };

/**
 * Balanced teams: by handicap index, best first, dealt in a snake (1, 2, 2,
 * 1, 1, 2…) so the averages come out close. Captains stay on their teams.
 */
export function balancedTeams(players: readonly CupPlayer[], captains: { 1?: string; 2?: string } = {}): Map<string, Team> {
  const out = new Map<string, Team>();
  const counts = { 1: 0, 2: 0 };
  const total = { 1: 0, 2: 0 };
  for (const t of [1, 2] as const) {
    const c = captains[t];
    const p = c ? players.find((x) => x.memberId === c) : undefined;
    if (p) {
      out.set(p.memberId, t);
      counts[t] += 1;
      total[t] += p.index ?? 28;
    }
  }
  const rest = players.filter((p) => !out.has(p.memberId)).sort((a, b) => (a.index ?? 54) - (b.index ?? 54) || a.name.localeCompare(b.name));
  for (const p of rest) {
    // The side with fewer players; level, the side with the higher total
    // handicap (the weaker side) gets the better player.
    const t: Team = counts[1] < counts[2] ? 1 : counts[2] < counts[1] ? 2 : total[1] >= total[2] ? 1 : 2;
    out.set(p.memberId, t);
    counts[t] += 1;
    total[t] += p.index ?? 28;
  }
  return out;
}

/** Random teams, captains kept on theirs. `rand` returns [0, 1). */
export function randomTeams(players: readonly CupPlayer[], captains: { 1?: string; 2?: string } = {}, rand: () => number = Math.random): Map<string, Team> {
  const out = new Map<string, Team>();
  for (const t of [1, 2] as const) if (captains[t]) out.set(captains[t]!, t);
  const rest = players.map((p) => p.memberId).filter((id) => !out.has(id));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  let n1 = [...out.values()].filter((t) => t === 1).length;
  let n2 = out.size - n1;
  for (const id of rest) {
    const t: Team = n1 <= n2 ? 1 : 2;
    out.set(id, t);
    if (t === 1) n1 += 1;
    else n2 += 1;
  }
  return out;
}

/** The average index of a team, to one place, or null with nobody known. */
export function averageIndex(players: readonly CupPlayer[]): number | null {
  const known = players.filter((p) => p.index != null);
  if (known.length === 0) return null;
  return Math.round((known.reduce((n, p) => n + (p.index as number), 0) / known.length) * 10) / 10;
}

/** A first lineup for a team: its players in the order given, in ones or twos. Anyone left over sits out. */
export function defaultLineup(memberIds: readonly string[], format: CupFormat): string[][] {
  const size = perSide(format);
  const out: string[][] = [];
  for (let i = 0; i + size <= memberIds.length; i += size) out.push(memberIds.slice(i, i + size));
  return out;
}

/**
 * The matches for a session from the two lineups: match n is team 1's nth
 * against team 2's nth. Extra entries on the longer side sit out.
 */
export function pairUp(team1: readonly string[][], team2: readonly string[][]): { one: string[]; two: string[] }[] {
  const n = Math.min(team1.length, team2.length);
  return Array.from({ length: n }, (_, i) => ({ one: [...team1[i]!], two: [...team2[i]!] }));
}

/** Is a lineup the right shape for a format: ones or twos, nobody twice. */
export function lineupProblem(lineup: readonly string[][], format: CupFormat): string | null {
  if (lineup.length === 0) return "Put your players in order";
  const size = perSide(format);
  if (lineup.some((m) => m.length !== size)) return size === 1 ? "Singles is one player a match" : "Pairs matches are two a side";
  const all = lineup.flat();
  if (new Set(all).size !== all.length) return "Someone is in two matches";
  return null;
}

/** A match's state on the Cup's pages: "Navy won 3&2", "Halved", "Gold 1 UP · thru 14", "All square · thru 3", "Not started". */
export function matchLine(m: { finished: boolean; leader: 0 | 1 | 2; margin: string; played: number } | null, names: readonly [string, string]): string {
  if (!m || (m.played === 0 && !m.finished)) return "Not started";
  if (m.finished) return m.leader ? `${names[m.leader - 1]} won ${m.margin}` : "Halved";
  return `${m.leader ? `${names[m.leader - 1]} ${m.margin}` : "All square"} · thru ${m.played}`;
}
