/**
 * Multi-day championships — one leaderboard over 2 to 4 days, a course and
 * a format each day (Oct 2026).
 *
 * Pure, and byte-identical in mobile/src/lib/championship.ts
 * (championship.test.ts fails if the copies drift): the app's leaderboard,
 * the website's board, the TV and the widgets all add the days up the same
 * way.
 *
 * HOW THE DAYS ADD UP (decided by Eire, 23 Oct 2026):
 *
 *   - Every day scored the same way (all points, all net strokes or all
 *     gross strokes) → the scores are ADDED UP: total points, or strokes to
 *     par over all the days. The PGA-style board.
 *   - Days that mix points and strokes → PLACES POINTS each day: the day's
 *     finishing order earns 25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2,
 *     1, and 1 for everyone else who finishes. Raw scores in different units
 *     can't be added fairly; places can.
 *   - The organiser can choose either rule instead ("add" / "places").
 *
 * Team and pair days: every player on the side gets the side's score (and
 * its places points). Ties on a day split the places points (three level
 * for 2nd share the points for 2nd, 3rd and 4th). A day's order comes from
 * its published results when there are any — so its countbacks count —
 * otherwise from the scores, ties shared.
 *
 * Movement: each player's place against the standings at the end of the
 * previous day, as on the PGA Tour, so the arrows mean the same thing all
 * day while a round is live.
 *
 * Level on the total once every day is final: the better place on the
 * final day decides (its published place, so its countback, where there is
 * one), then the day before, and so on. Still level, the place is shared.
 */

export type DayKind = "points" | "net" | "gross";
export type ChampionshipRule = "auto" | "add" | "places";
export type ResolvedRule = "add" | "places";
export type DayStatus = "upcoming" | "live" | "final";

/** One side's score on a day: a player, or a pair or team on one ball. */
export type DayRow = {
  /** Members on the side (a team's every member). */
  memberIds: string[];
  /** Guests, by name, when there's no member. */
  guestNames?: string[];
  /** Points, or strokes to par (net or gross, as the day is played) so far. */
  score: number | null;
  /** Holes played, 0–18. */
  thru: number;
  /** Has a full card in (or the day is final). */
  finished: boolean;
  /** Published place, after countbacks (1-based); null when not ranked. */
  position?: number | null;
  /** The card's par (stroke days), so published net scores can be put to par. */
  par?: number;
};

export type ChampionshipDay = {
  /** 1-based. */
  round: number;
  kind: DayKind;
  team: boolean;
  status: DayStatus;
  rows: DayRow[];
};

export type Player = {
  key: string;
  name: string;
  detail: string | null;
  memberId: string | null;
};

export type BoardCell = {
  /** What the round column shows: points, to par, or places points. */
  label: string;
  /** Places points earned that day (places rule), else null. */
  placesPoints: number | null;
  /** The raw score that day, in its own units ("38", "−2"). */
  scoreLabel: string;
  played: boolean;
  good: boolean;
};

export type BoardRow = {
  key: string;
  name: string;
  detail: string | null;
  memberId: string | null;
  position: number | null;
  positionLabel: string;
  /** Places gained (+) or lost (−) since the end of the previous day; null on day 1 or new to the board. */
  move: number | null;
  total: number;
  totalLabel: string;
  /** The viewed day's score, in its own units. */
  todayLabel: string;
  /** "F", "13", "—" (not started), or a tee time the caller supplies. */
  thruLabel: string;
  cells: BoardCell[];
  /** Days already final that this player has no score for. */
  missed: number[];
};

export type Board = {
  rule: ResolvedRule;
  /** The units of the total: "points", "to par", "places points". */
  unit: "points" | "to par" | "places points";
  /** Higher totals are better (points, places points). */
  higherWins: boolean;
  /** The day the board is "after" (1-based). */
  through: number;
  live: boolean;
  final: boolean;
  rows: BoardRow[];
};

export const PLACES_POINTS: readonly number[] = [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

/** Places points for a 0-based finishing slot. Everyone past the table who finishes gets 1. */
export function placesPointsFor(slot: number): number {
  return slot < PLACES_POINTS.length ? PLACES_POINTS[slot] : 1;
}

/** Scores only add up when every day is in the same units, so "add" falls back to places when they mix. */
export function resolveRule(rule: ChampionshipRule, kinds: readonly DayKind[]): ResolvedRule {
  const same = new Set(kinds).size <= 1;
  if (rule === "places") return "places";
  return same ? "add" : "places";
}

/** Whether the organiser can choose to add the scores up (every day in the same units). */
export const canAddUp = (kinds: readonly DayKind[]) => new Set(kinds).size <= 1;

/** A line for the set-up screen and the board's footnote. */
export function ruleLine(rule: ResolvedRule, kinds: readonly DayKind[]): { title: string; body: string } {
  if (rule === "places") {
    return {
      title: "Overall: places points each day",
      body: "Each day ranks the field and awards 25, 20, 16, 13… down the field. Team members share their team's points; ties split them.",
    };
  }
  const k = kinds[0] ?? "points";
  return {
    title: "Overall: scores added up",
    body:
      k === "points"
        ? "Every day is scored in points, so the board adds each player's points across the days."
        : `Every day is ${k} stroke play, so the board adds each player's strokes to par across the days.`,
  };
}

export const higherIsBetter = (kind: DayKind) => kind === "points";

export function toParLabel(v: number): string {
  if (v === 0) return "E";
  const n = Number.isInteger(v) ? String(Math.abs(v)) : Math.abs(v).toFixed(1);
  return v > 0 ? `+${n}` : `−${n}`;
}

const pointsLabel = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function scoreLabel(kind: DayKind, v: number | null): string {
  if (v == null) return "—";
  return kind === "points" ? pointsLabel(v) : toParLabel(v);
}

/** Keys for a row's players: members by id, guests by name. */
export function rowKeys(row: DayRow): string[] {
  return [...row.memberIds.map((m) => `m:${m}`), ...(row.guestNames ?? []).map((g) => `g:${g.trim().toLowerCase()}`)];
}

/** A side counts on a day once it has a score — on a final day only with a full card or a published place. */
const counts = (day: ChampionshipDay, r: DayRow) => r.score != null && (day.status !== "final" || r.finished || r.position != null);

/**
 * Each side's finishing order on a day, as a 0-based slot shared by sides
 * that are level (null: not counted). Published places come first — so
 * countbacks count — then anyone without one (a guest, a second division)
 * by score, ties shared.
 */
export function dayOrder(day: ChampionshipDay): (number | null)[] {
  const better = higherIsBetter(day.kind);
  const scored = day.rows.map((r, i) => ({ r, i })).filter((x) => counts(day, x.r));
  const placed = scored.filter((x) => x.r.position != null).sort((a, b) => (a.r.position as number) - (b.r.position as number));
  const rest = scored
    .filter((x) => x.r.position == null)
    .sort((a, b) => (better ? (b.r.score as number) - (a.r.score as number) : (a.r.score as number) - (b.r.score as number)));
  const ordered = [...placed, ...rest];
  const level = (a: { r: DayRow }, b: { r: DayRow }) =>
    a.r.position != null || b.r.position != null ? a.r.position != null && a.r.position === b.r.position : a.r.score === b.r.score;
  const out: (number | null)[] = day.rows.map(() => null);
  let k = 0;
  while (k < ordered.length) {
    let j = k;
    while (j + 1 < ordered.length && level(ordered[j + 1], ordered[k])) j++;
    for (let q = k; q <= j; q++) out[ordered[q].i] = k;
    k = j + 1;
  }
  return out;
}

/**
 * Places points for every side on a day, by its finishing order (dayOrder);
 * level sides split the points for the places they cover. Returns points by
 * row index; sides that don't count get nothing.
 */
export function dayPlacesPoints(day: ChampionshipDay): (number | null)[] {
  const order = dayOrder(day);
  const size = new Map<number, number>();
  for (const o of order) if (o != null) size.set(o, (size.get(o) ?? 0) + 1);
  return order.map((o) => {
    if (o == null) return null;
    const n = size.get(o) as number;
    let sum = 0;
    for (let q = o; q < o + n; q++) sum += placesPointsFor(q);
    return Math.round((sum / n) * 10) / 10;
  });
}

type PerDay = { score: number | null; places: number | null; slot: number | null; thru: number; finished: boolean; position: number | null };

function collect(days: readonly ChampionshipDay[]): Map<string, PerDay[]> {
  const byKey = new Map<string, PerDay[]>();
  days.forEach((day, di) => {
    const pp = dayPlacesPoints(day);
    const order = dayOrder(day);
    day.rows.forEach((row, ri) => {
      for (const key of rowKeys(row)) {
        if (!byKey.has(key)) byKey.set(key, days.map(() => ({ score: null, places: null, slot: null, thru: 0, finished: false, position: null })));
        const slot = (byKey.get(key) as PerDay[])[di];
        // An unfinished card on a final day (no return) counts under neither rule.
        slot.score = counts(day, row) ? row.score : null;
        slot.places = pp[ri];
        slot.slot = order[ri];
        slot.thru = row.thru;
        slot.finished = row.finished;
        slot.position = row.position ?? null;
      }
    });
  });
  return byKey;
}

type Standing = { key: string; total: number; position: number; label: string };

/** A day's finishing slot, for breaking a tie at the end: lower is better; no score is last. */
function dayPlaceOf(per: PerDay[], di: number): number {
  return per[di].slot ?? Number.POSITIVE_INFINITY;
}

function standingsAfter(
  days: readonly ChampionshipDay[],
  byKey: Map<string, PerDay[]>,
  through: number,
  rule: ResolvedRule,
  breakTies: boolean,
): Map<string, Standing> {
  const higher = rule === "places" || higherIsBetter(days[0]?.kind ?? "points");
  const list: { key: string; total: number; any: boolean; missedFinal: boolean }[] = [];
  for (const [key, per] of byKey) {
    let total = 0;
    let any = false;
    let missedFinal = false;
    for (let d = 0; d < through; d++) {
      const p = per[d];
      const v = rule === "places" ? p.places : p.score;
      if (v != null) {
        total += v;
        any = true;
      } else if (days[d].status === "final" && rule === "add" && !higher) {
        missedFinal = true;
      }
    }
    if (any) list.push({ key, total: Math.round(total * 10) / 10, any, missedFinal });
  }
  // A missed final day can't be scored in strokes to par — those players go to the bottom, unranked.
  const ranked = list.filter((x) => !x.missedFinal);
  const tieBreak = (a: string, b: string) => {
    if (!breakTies) return 0;
    const pa = byKey.get(a) as PerDay[];
    const pb = byKey.get(b) as PerDay[];
    for (let d = through - 1; d >= 0; d--) {
      const x = dayPlaceOf(pa, d);
      const y = dayPlaceOf(pb, d);
      if (x !== y) return x - y;
    }
    return 0;
  };
  ranked.sort((a, b) => (higher ? b.total - a.total : a.total - b.total) || tieBreak(a.key, b.key));
  const out = new Map<string, Standing>();
  ranked.forEach((x, i) => {
    const first = ranked.findIndex((y) => y.total === x.total && tieBreak(y.key, x.key) === 0);
    const level = ranked.filter((y) => y.total === x.total && tieBreak(y.key, x.key) === 0).length;
    out.set(x.key, { key: x.key, total: x.total, position: first + 1, label: (level > 1 ? "T" : "") + (first + 1) });
    void i;
  });
  return out;
}

export type BoardInput = {
  days: readonly ChampionshipDay[];
  rule: ChampionshipRule;
  players: ReadonlyMap<string, Player>;
  /** Show the board after this day (1-based); defaults to the latest day that has started. */
  view?: number;
};

export function latestStartedDay(days: readonly ChampionshipDay[]): number {
  let r = 1;
  days.forEach((d, i) => {
    if (d.status !== "upcoming") r = i + 1;
  });
  return r;
}

export function buildBoard(input: BoardInput): Board {
  const { days } = input;
  const kinds = days.map((d) => d.kind);
  const rule = resolveRule(input.rule, kinds);
  const higherWins = rule === "places" || higherIsBetter(kinds[0] ?? "points");
  const through = Math.max(1, Math.min(days.length, input.view ?? latestStartedDay(days)));
  const day = days[through - 1];
  const live = day ? day.status === "live" : false;
  const final = days.length > 0 && days.every((d) => d.status === "final");
  const byKey = collect(days);
  const now = standingsAfter(days, byKey, through, rule, final && through === days.length);
  const before = through > 1 ? standingsAfter(days, byKey, through - 1, rule, false) : null;

  const rows: BoardRow[] = [];
  for (const [key, per] of byKey) {
    const info = input.players.get(key) ?? { key, name: key.startsWith("g:") ? key.slice(2) : "Player", detail: null, memberId: null };
    const st = now.get(key) ?? null;
    const prev = before?.get(key) ?? null;
    const cells: BoardCell[] = days.map((d, di) => {
      const p = per[di];
      const playedSoFar = di < through && p.score != null;
      const done = playedSoFar && (d.status === "final" || p.finished);
      const raw = scoreLabel(d.kind, p.score);
      let label = "";
      if (di < through) {
        if (!playedSoFar) label = d.status === "final" ? "–" : "";
        else if (!done) label = "—";
        else label = rule === "places" ? pointsLabel(p.places ?? 0) : raw;
      }
      const good = done && (rule === "places" ? (p.places ?? 0) >= 16 : d.kind === "points" ? (p.score ?? 0) >= (d.team ? 42 : 37) : (p.score ?? 0) < 0);
      return { label, placesPoints: rule === "places" ? p.places : null, scoreLabel: raw, played: playedSoFar, good };
    });
    const today = per[through - 1];
    const missed = days.map((d, di) => (d.status === "final" && per[di].score == null && di < through ? di + 1 : 0)).filter((x) => x > 0);
    let thruLabel = "—";
    if (today && today.score != null) thruLabel = day.status === "final" || today.finished || today.thru >= 18 ? "F" : String(today.thru);
    const total = st?.total ?? 0;
    rows.push({
      key,
      name: info.name,
      detail: info.detail,
      memberId: info.memberId,
      position: st?.position ?? null,
      positionLabel: st ? st.label : missed.length ? "—" : "",
      move: st && prev ? prev.position - st.position : null,
      total,
      totalLabel: st ? (rule === "places" || higherWins ? pointsLabel(total) : toParLabel(total)) : "—",
      todayLabel: today ? scoreLabel(day.kind, today.score) : "—",
      thruLabel,
      cells,
      missed,
    });
  }
  rows.sort((a, b) => {
    if (a.position == null && b.position == null) return a.name.localeCompare(b.name);
    if (a.position == null) return 1;
    if (b.position == null) return -1;
    return a.position - b.position || a.name.localeCompare(b.name);
  });
  return {
    rule,
    unit: rule === "places" ? "places points" : higherWins ? "points" : "to par",
    higherWins,
    through,
    live,
    final,
    rows,
  };
}

/** The biggest climbers on the viewed day, for "Biggest movers". */
export function biggestMovers(board: Board, n = 3): BoardRow[] {
  return board.rows.filter((r) => (r.move ?? 0) > 0).sort((a, b) => (b.move as number) - (a.move as number) || (a.position ?? 0) - (b.position ?? 0)).slice(0, n);
}

/** Shots or points between the leader and the next player down. */
export function leadMargin(board: Board): number {
  const top = board.rows.find((r) => r.position === 1);
  const next = board.rows.find((r) => r.position != null && r.total !== top?.total);
  if (!top || !next) return 0;
  return Math.round(Math.abs(top.total - next.total) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Formats a day can be played in
// ---------------------------------------------------------------------------

/** As the app's Start a Round names them (and society_outings.championship_format). */
export type DayFormat = "stableford" | "stroke" | "scramble2" | "scramble4" | "foursomesPts" | "foursomesNet" | "greensomesPts" | "greensomesNet";

export const DAY_FORMATS: readonly { id: DayFormat; label: string; short: string; kind: DayKind; team: boolean }[] = [
  { id: "stableford", label: "Stableford", short: "STB", kind: "points", team: false },
  { id: "stroke", label: "Net stroke play", short: "NET", kind: "net", team: false },
  { id: "scramble4", label: "Texas scramble (4)", short: "SCR", kind: "net", team: true },
  { id: "scramble2", label: "Scramble pairs", short: "SCR", kind: "net", team: true },
  { id: "foursomesPts", label: "Foursomes · Stableford", short: "4S", kind: "points", team: true },
  { id: "foursomesNet", label: "Foursomes · stroke", short: "4S", kind: "net", team: true },
  { id: "greensomesPts", label: "Greensomes · Stableford", short: "GRN", kind: "points", team: true },
  { id: "greensomesNet", label: "Greensomes · stroke", short: "GRN", kind: "net", team: true },
];

export function dayFormat(id: string | null | undefined): (typeof DAY_FORMATS)[number] {
  return DAY_FORMATS.find((f) => f.id === id) ?? DAY_FORMATS[0];
}

/** A trip round's itinerary format → the closest day format; matchplay doesn't go on a leaderboard. */
export function fromTripFormat(f: string | null | undefined): DayFormat | null {
  switch (f) {
    case "strokeplay":
      return "stroke";
    case "scramble":
      return "scramble4";
    case "foursomes":
      return "foursomesPts";
    case "matchplay":
      return null;
    default:
      return "stableford";
  }
}

// ---------------------------------------------------------------------------
// What the website sends the app, the TV page and the widgets
// ---------------------------------------------------------------------------

export type ChampionshipDayInfo = {
  round: number;
  playsOn: string;
  courseName: string;
  /** "08:30" */
  firstTee: string | null;
  formatLabel: string;
  short: string;
  kind: DayKind;
  team: boolean;
  status: DayStatus;
  /** The day out it is (a championship's day), or the trip's round item. */
  outingId: number | null;
  itemId: number | null;
  matchDayId: number | null;
  /** The organiser is keeping the leaderboard secret until the results. */
  hidden: boolean;
  /** Matchplay: played, but not on the leaderboard. */
  excluded: boolean;
};

export type ChampionshipPayload = {
  v: 1;
  id: number;
  groupId: number;
  title: string;
  rule: ChampionshipRule;
  tripOutingId: number | null;
  status: "open" | "cancelled";
  days: ChampionshipDayInfo[];
  /** The days that count, in order, as buildBoard reads them. */
  scoring: ChampionshipDay[];
  players: Player[];
  updatedAt: string;
};

/** The board straight from a payload. */
export function boardOf(p: ChampionshipPayload, view?: number): Board {
  return buildBoard({ days: p.scoring, rule: p.rule, players: new Map(p.players.map((x) => [x.key, x])), view });
}

/** Day count rules for set-up: 2 to 4 consecutive days. */
export const MIN_DAYS = 2;
export const MAX_DAYS = 4;
