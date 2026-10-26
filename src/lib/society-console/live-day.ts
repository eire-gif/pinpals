/**
 * Live day on the website (Oct 2026): starting a society event's round from
 * the console, and the organiser's control room while it's played.
 *
 * Pure, tested in live-day.test.ts. The numbers come from live-scoring.ts —
 * the engine the app scores with — so a day started here is exactly the day
 * the app's "From a group" screen would have started from the same draw:
 *
 *   Stableford, stroke play   one round per tee group (live_fourball_day_create),
 *                             95% of each player's course handicap
 *   Foursomes, greensomes     each tee group is two pairs, seats 1 & 2 and 3 & 4
 *                             (live_scramble_day_create with foursomes_scoring)
 *   Scramble                  each tee group is one team of 2 or 4
 *
 * The page sends only the choices (tees, card, format, start); the Server
 * Action rebuilds everything here from the database's draw and handicaps,
 * so nothing a browser sends becomes a player, a handicap or a group.
 */

import {
  courseHandicap,
  foursomesHandicap,
  FOURSOMES_ALLOWANCE,
  GREENSOMES_ALLOWANCE,
  greensomesHandicap,
  playingHandicap,
  scrambleHandicap,
  shotgunCapacity,
  shotgunStarts,
  shotsSoFar,
  startLabel,
  type CardHole,
  type ShotgunStart,
} from "@/lib/live-scoring";
import { holeOn, type TvGame } from "@/lib/tv-board";

// ---------------------------------------------------------------------------
// Setting up
// ---------------------------------------------------------------------------

export type DayFormat = "stableford" | "stroke" | "foursomes" | "greensomes" | "scramble";
export type PairScoring = "stableford" | "stroke";
export type StartMode = "tees" | "shotgun";

export const DAY_FORMATS: { id: DayFormat; label: string; blurb: string; kind: "individual" | "pairs" | "team" }[] = [
  { id: "stableford", label: "Stableford", blurb: "Points per hole · 95% of course handicap", kind: "individual" },
  { id: "stroke", label: "Stroke play", blurb: "Net to par · 95% of course handicap", kind: "individual" },
  { id: "foursomes", label: "Foursomes", blurb: "Pairs, one ball, alternate shots · 50% combined", kind: "pairs" },
  { id: "greensomes", label: "Greensomes", blurb: "Pairs, both drive, best ball · 60% low + 40% high", kind: "pairs" },
  { id: "scramble", label: "Texas scramble", blurb: "Each tee group is a team of 2 or 4", kind: "team" },
];

export const SOCIETY_ALLOWANCE = 0.95;

export const isDayFormat = (v: unknown): v is DayFormat => typeof v === "string" && DAY_FORMATS.some((f) => f.id === v);

/** The tees the day is played off, and the card everyone is scored on. */
export type TeeCard = {
  teeName: string;
  courseRating: number | null;
  slope: number | null;
  par: number | null;
  card: CardHole[];
};

/** One person in the published draw. Guests have no member id. */
export type DrawnPlayer = { key: string; memberId: string | null; name: string; index: number | null; guest: boolean };
export type DrawnGroup = { number: number; teeTime: string | null; players: DrawnPlayer[] };

export type DaySetup = {
  title: string;
  courseName: string;
  clubId: number | null;
  tee: TeeCard;
  format: DayFormat;
  /** How pairs (foursomes, greensomes) are ranked. */
  pairScoring: PairScoring;
  start: StartMode;
  /** A shotgun's one start time (needed for a shotgun). */
  shotgunTime: string | null;
  /** Entered for the event but in no tee group: they'd be left out. */
  notDrawn?: string[];
};

/** What the preview table shows for each card in a group. */
export type PlannedLine = {
  /** "Niamh Kelly", or "Tom & Ruth" for a pair. */
  name: string;
  players: { name: string; index: number; courseHandicap: number; playingHandicap: number; guest: boolean }[];
  /** The handicap the card plays off: the player's, or the pair's/team's. */
  handicap: number;
  estimated: boolean;
};

export type PlannedGroup = { number: number; teeTime: string | null; start: string | null; lines: PlannedLine[] };

type RpcPlayer = {
  member_id: string | null;
  name: string;
  handicap_index: number;
  course_handicap: number;
  playing_handicap: number;
  handicap_estimated: boolean;
  tee_name: null;
  tee_extra: 0;
};
type RpcStart = { start_hole?: number; start_letter?: string };
type RpcDay = {
  title: string;
  course_name: string;
  club_id: number | null;
  tee_name: string | null;
  holes: number;
  course_rating: number | null;
  slope: number | null;
  par_total: number | null;
};

export type DayRpc =
  | {
      fn: "live_fourball_day_create";
      args: { p_day: RpcDay & { format: "stableford" | "stroke"; allowance: number }; p_groups: ({ tee_time: string | null; players: RpcPlayer[] } & RpcStart)[]; p_card: RpcCard };
    }
  | {
      fn: "live_scramble_day_create";
      args: {
        p_day: RpcDay & { scramble_size: 2 | 4; drive_minimum: null; foursomes_scoring?: PairScoring; greensomes?: true };
        p_teams: ({ name: string | null; tee_time: string | null; team_handicap: number; players: RpcPlayer[] } & RpcStart)[];
        p_card: RpcCard;
      };
    };
type RpcCard = { hole: number; par: number; stroke_index: number | null }[];

export type DayPlan = {
  problems: string[];
  groups: PlannedGroup[];
  rpc: DayRpc | null;
  /** The draw again with each group's shotgun start, for the event (null for tee times). */
  starts: (ShotgunStart | null)[] | null;
};

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** What's wrong with a card, in words; empty when it's fine to play off. */
export function cardProblems(card: readonly CardHole[]): string[] {
  const out: string[] = [];
  const n = card.length;
  if (n !== 9 && n !== 18) return ["The card needs 9 or 18 holes."];
  const holes = [...card].map((h) => h.hole).sort((a, b) => a - b);
  if (holes.some((h, i) => h !== i + 1)) out.push(`The card's holes should run 1 to ${n}.`);
  const badPar = card.filter((h) => !Number.isInteger(h.par) || h.par < 3 || h.par > 6);
  if (badPar.length) out.push(`Check the par on ${badPar.length === 1 ? `hole ${badPar[0].hole}` : `holes ${badPar.map((h) => h.hole).join(", ")}`} (3 to 6).`);
  const missing = card.filter((h) => h.strokeIndex == null);
  if (missing.length) {
    out.push(`Fill in the stroke index for ${missing.length === n ? "every hole" : missing.length === 1 ? `hole ${missing[0].hole}` : `holes ${missing.map((h) => h.hole).join(", ")}`} — shots and countbacks need them.`);
  } else {
    const seen = new Map<number, number[]>();
    for (const h of card) seen.set(h.strokeIndex!, [...(seen.get(h.strokeIndex!) ?? []), h.hole]);
    const twice = [...seen.entries()].filter(([, hs]) => hs.length > 1);
    const outOfRange = card.filter((h) => h.strokeIndex! < 1 || h.strokeIndex! > n);
    if (outOfRange.length) out.push(`Stroke indexes run 1 to ${n}.`);
    else if (twice.length) out.push(`Stroke index ${twice[0][0]} is on ${twice[0][1].map((h) => `hole ${h}`).join(" and ")} — each index once.`);
  }
  return out;
}

/**
 * Turns the published draw and the organiser's choices into the day: a
 * preview for the page, and the exact database call the app would make.
 * `problems` empty and `rpc` set means it can start.
 */
export function planDay(setup: DaySetup, draw: readonly DrawnGroup[]): DayPlan {
  const problems: string[] = [];
  const { tee, format } = setup;
  const card = [...tee.card].sort((a, b) => a.hole - b.hole);
  problems.push(...cardProblems(card));
  if (!setup.title.trim()) problems.push("The event needs a name.");
  const groups = draw.filter((g) => g.players.length > 0);
  if (groups.length === 0) problems.push("Publish the draw first — the round is played in its tee groups.");
  if (groups.length > 60) problems.push("A day has 60 tee groups at most.");
  const left = setup.notDrawn ?? [];
  if (left.length) problems.push(`${left.length === 1 ? `${left[0]} is` : `${left.length} people are`} entered but not in the draw${left.length > 1 ? ` (${left.slice(0, 4).join(", ")}${left.length > 4 ? "…" : ""})` : ""} — change the draw so everyone has a group.`);

  const noIndex = groups.flatMap((g) => g.players.filter((p) => p.index == null));
  for (const p of noIndex) problems.push(`${p.name} has no handicap index${p.guest ? " — add it on the event's guest list" : " — set a society handicap for them"}.`);

  let starts: (ShotgunStart | null)[] | null = null;
  if (setup.start === "shotgun") {
    if (setup.shotgunTime == null || !CLOCK.test(setup.shotgunTime)) problems.push("Give the shotgun's start time, like 09:00.");
    if (card.length === 9 || card.length === 18) {
      if (groups.length > shotgunCapacity(card.length)) problems.push(`A shotgun takes ${shotgunCapacity(card.length)} groups at most on ${card.length} holes.`);
      else starts = shotgunStarts(card, groups.length);
    }
  }

  const pairs = format === "foursomes" || format === "greensomes";
  if (pairs) {
    for (const g of groups) if (g.players.length !== 2 && g.players.length !== 4) problems.push(`Group ${g.number} has ${g.players.length} — ${format} needs groups of 2 or 4 (pairs are seats 1 & 2 and 3 & 4).`);
    const pairCount = groups.reduce((n, g) => n + Math.floor(g.players.length / 2), 0);
    if (pairCount > 100) problems.push(`That's ${pairCount} pairs — a pairs day has 100 at most.`);
  }
  let teamSize: 2 | 4 | null = null;
  if (format === "scramble") {
    const sizes = new Set(groups.map((g) => g.players.length));
    if (sizes.size === 1 && (sizes.has(2) || sizes.has(4))) teamSize = groups[0].players.length as 2 | 4;
    else problems.push("A scramble needs every tee group the same size, 2 or 4 — each group is a team. Change the draw.");
  }
  if (!pairs && format !== "scramble") {
    for (const g of groups) if (g.players.length > 5) problems.push(`Group ${g.number} has ${g.players.length} — 5 at most.`);
  }

  const par = tee.par ?? (card.length ? card.reduce((n, h) => n + h.par, 0) : null);
  const handicapOf = (index: number) => courseHandicap(index, { slope: tee.slope, courseRating: tee.courseRating, par, holes: card.length === 9 ? 9 : 18 });
  const timeOf = (g: DrawnGroup) => (setup.start === "shotgun" ? (setup.shotgunTime ?? g.teeTime) : g.teeTime);
  const startOf = (i: number): RpcStart => (starts?.[i] ? { start_hole: starts[i]!.hole, start_letter: starts[i]!.letter } : {});
  const startText = (i: number) => (starts?.[i] ? startLabel(starts[i]!, !starts.some((s, j) => j !== i && s?.hole === starts![i]!.hole)) : null);
  const rpcPlayer = (p: DrawnPlayer, ch: number, ph: number, est: boolean): RpcPlayer => ({
    member_id: p.memberId,
    name: p.name,
    handicap_index: p.index ?? 0,
    course_handicap: ch,
    playing_handicap: ph,
    handicap_estimated: est,
    tee_name: null,
    tee_extra: 0,
  });

  const planned: PlannedGroup[] = [];
  const fourballGroups: Extract<DayRpc, { fn: "live_fourball_day_create" }>["args"]["p_groups"] = [];
  const teams: Extract<DayRpc, { fn: "live_scramble_day_create" }>["args"]["p_teams"] = [];
  const ready = problems.length === 0;

  groups.forEach((g, gi) => {
    const lines: PlannedLine[] = [];
    if (!ready && noIndex.length) {
      // Still show the groups, without numbers that can't be worked out.
      planned.push({ number: g.number, teeTime: timeOf(g), start: startText(gi), lines: g.players.map((p) => ({ name: p.name, players: [], handicap: 0, estimated: false })) });
      return;
    }
    const hc = g.players.map((p) => handicapOf(p.index ?? 0));
    if (format === "stableford" || format === "stroke") {
      const players = g.players.map((p, i) => {
        const ph = playingHandicap(hc[i], SOCIETY_ALLOWANCE);
        lines.push({ name: p.name, players: [{ name: p.name, index: p.index ?? 0, courseHandicap: hc[i].courseHandicap, playingHandicap: ph, guest: p.guest }], handicap: ph, estimated: hc[i].estimated });
        return rpcPlayer(p, hc[i].courseHandicap, ph, hc[i].estimated);
      });
      fourballGroups.push({ tee_time: timeOf(g), ...startOf(gi), players });
    } else if (pairs) {
      for (const at of [0, 2]) {
        if (at >= g.players.length) continue;
        const pair = g.players.slice(at, at + 2);
        const chs = hc.slice(at, at + 2).map((x) => x.courseHandicap);
        // The pair's figure comes from the EXACT course handicaps, rounded once (WHS).
        const exs = hc.slice(at, at + 2).map((x) => x.exact);
        if (pair.length !== 2) continue;
        const low = Math.min(...exs);
        const team = format === "greensomes" ? greensomesHandicap(exs) : foursomesHandicap(exs);
        const phs = exs.map((c, k) =>
          format === "greensomes" ? playingHandicap(c, c === low && exs.indexOf(low) === k ? GREENSOMES_ALLOWANCE : 0.4) : playingHandicap(c, FOURSOMES_ALLOWANCE)
        );
        const name = pair.map((p) => first(p.name)).join(" & ");
        const estimated = hc.slice(at, at + 2).some((x) => x.estimated);
        lines.push({
          name,
          players: pair.map((p, k) => ({ name: p.name, index: p.index ?? 0, courseHandicap: chs[k], playingHandicap: phs[k], guest: p.guest })),
          handicap: team,
          estimated,
        });
        teams.push({ name, tee_time: timeOf(g), ...startOf(gi), team_handicap: team, players: pair.map((p, k) => rpcPlayer(p, chs[k], phs[k], hc[at + k].estimated)) });
      }
    } else {
      const chs = hc.map((x) => x.courseHandicap);
      const sh = g.players.length === 2 || g.players.length === 4 ? scrambleHandicap(hc.map((x) => x.exact)) : { team: 0, shares: chs.map(() => 0) };
      lines.push({
        name: g.players.map((p) => first(p.name)).join(", "),
        players: g.players.map((p, k) => ({ name: p.name, index: p.index ?? 0, courseHandicap: chs[k], playingHandicap: Math.round(sh.shares[k]), guest: p.guest })),
        handicap: sh.team,
        estimated: hc.some((x) => x.estimated),
      });
      // No name, as the app: the results then name the team by its players.
      teams.push({ name: null, tee_time: timeOf(g), ...startOf(gi), team_handicap: sh.team, players: g.players.map((p, k) => rpcPlayer(p, chs[k], Math.round(sh.shares[k]), hc[k].estimated)) });
    }
    planned.push({ number: g.number, teeTime: timeOf(g), start: startText(gi), lines });
  });

  const day: RpcDay = {
    title: setup.title.trim().slice(0, 80),
    course_name: setup.courseName,
    club_id: setup.clubId,
    tee_name: tee.teeName.trim() || null,
    holes: card.length,
    course_rating: tee.courseRating,
    slope: tee.slope,
    par_total: par,
  };
  const rpcCard: RpcCard = card.map((h) => ({ hole: h.hole, par: h.par, stroke_index: h.strokeIndex }));

  let rpc: DayRpc | null = null;
  if (problems.length === 0) {
    if (format === "stableford" || format === "stroke") {
      rpc = { fn: "live_fourball_day_create", args: { p_day: { ...day, format, allowance: SOCIETY_ALLOWANCE }, p_groups: fourballGroups, p_card: rpcCard } };
    } else {
      rpc = {
        fn: "live_scramble_day_create",
        args: {
          p_day: {
            ...day,
            scramble_size: pairs ? 2 : (teamSize ?? 4),
            drive_minimum: null,
            ...(pairs ? { foursomes_scoring: setup.pairScoring } : {}),
            ...(format === "greensomes" ? { greensomes: true as const } : {}),
          },
          p_teams: teams,
          p_card: rpcCard,
        },
      };
    }
  }
  return { problems, groups: planned, rpc, starts };
}

/** The organiser's card, as posted: [{hole, par, si}] → CardHole[], or null if it isn't one. */
export function parseCard(raw: unknown): CardHole[] | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value) || (value.length !== 9 && value.length !== 18)) return null;
  const out: CardHole[] = [];
  for (const h of value) {
    if (!h || typeof h !== "object") return null;
    const { hole, par, strokeIndex } = h as { hole?: unknown; par?: unknown; strokeIndex?: unknown };
    if (!Number.isInteger(hole) || !Number.isInteger(par)) return null;
    if (strokeIndex != null && !Number.isInteger(strokeIndex)) return null;
    out.push({ hole: hole as number, par: par as number, strokeIndex: (strokeIndex as number | null | undefined) ?? null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The control room
// ---------------------------------------------------------------------------

/** How a hole went, net of shots — the colours of the hole-by-hole strip. */
export type HoleMark = "eagle" | "birdie" | "par" | "bogey" | "double" | "pickup" | "none";

export type GroupStatus = {
  roundId: number;
  number: number;
  label: string;
  names: string;
  teeTime: string | null;
  start: string | null;
  /** Holes every card in the group has a score for. */
  thru: number;
  holes: number;
  /** "On the 7th", "Finished", "Not started". */
  state: "waiting" | "playing" | "done";
  on: string;
  lastAt: string | null;
  /** Minutes since the group's last score, while it's out. */
  quietFor: number | null;
};

export type Attention = { key: string; level: "warn" | "stop"; title: string; detail: string; roundId: number | null };

export type ControlRoom = {
  groups: GroupStatus[];
  /** Hole number → group numbers on it now. */
  onHole: Record<number, number[]>;
  /** Board row key (as tv-board: p<player>, t<round>) → its holes in card order. */
  strips: Record<string, { hole: number; mark: HoleMark }[]>;
  attention: Attention[];
  totals: { lines: number; holesScored: number; holesTotal: number; groupsOut: number; groupsDone: number; groupsWaiting: number };
};

/** Quiet this long while out on the course, and the control room flags it. */
export const QUIET_MINUTES = 25;

const markFor = (strokes: number | null | undefined, par: number, shots: number): HoleMark => {
  if (strokes === undefined) return "none";
  if (strokes === null) return "pickup";
  const net = strokes - shots - par;
  return net <= -2 ? "eagle" : net === -1 ? "birdie" : net === 0 ? "par" : net === 1 ? "bogey" : "double";
};

const minutesOfDay = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** "HH:MM" in Ireland, for comparing with tee times. */
export function irishClock(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

/**
 * Everything the organiser watches: each group's progress and silence, which
 * hole each group is on, a coloured hole-by-hole strip per card, and what
 * needs them — a group gone quiet, a group not off its tee time, a score
 * worth a second look. `today` false (the day was earlier) turns off the
 * clock-based checks.
 */
export function controlRoom(
  games: readonly TvGame[],
  now: Date,
  opts: { today: boolean; kind: "fourballs" | "scramble" | "match"; starts?: Readonly<Record<number, string>> }
): ControlRoom {
  const sorted = [...games].sort((a, b) => (a.round.matchNumber ?? 0) - (b.round.matchNumber ?? 0) || a.round.id - b.round.id);
  const groups: GroupStatus[] = [];
  const onHole: Record<number, number[]> = {};
  const strips: ControlRoom["strips"] = {};
  const attention: Attention[] = [];
  let lines = 0;
  let holesScored = 0;
  let holesTotal = 0;
  const clockNow = minutesOfDay(irishClock(now));

  for (const g of sorted) {
    const scramble = !!g.round.scramble;
    const ordered = [...g.players].sort((a, b) => a.position - b.position);
    const scoring = scramble ? ordered.slice(0, 1) : ordered;
    const number = g.round.matchNumber ?? g.round.scramble?.teamNumber ?? groups.length + 1;
    const handicapOf = (p: (typeof ordered)[number]) => (scramble ? (g.round.scramble?.teamHandicap ?? 0) : p.playingHandicap);

    for (const p of scoring) {
      const shots = shotsSoFar(handicapOf(p), g.card);
      const mine = g.scores.get(p.id);
      strips[scramble ? `t${g.round.id}` : `p${p.id}`] = [...g.card]
        .sort((a, b) => a.hole - b.hole)
        .map((h) => ({ hole: h.hole, mark: markFor(mine?.has(h.hole) ? (mine.get(h.hole) ?? null) : undefined, h.par, shots.get(h.hole) ?? 0) }));
      lines += 1;
      holesTotal += g.card.length;
      holesScored += g.card.filter((h) => mine?.has(h.hole)).length;
    }

    const thru = g.card.filter((h) => scoring.length > 0 && scoring.every((p) => g.scores.get(p.id)?.has(h.hole))).length;
    const anyScore = g.entries.length > 0;
    const done = g.round.status === "finished" || (thru > 0 && thru >= g.card.length);
    const on = holeOn(g, thru);
    let lastAt: string | null = null;
    for (const e of g.entries) if (!lastAt || e.at > lastAt) lastAt = e.at;
    const quietFor = !done && lastAt ? Math.max(0, Math.floor((now.getTime() - new Date(lastAt).getTime()) / 60000)) : null;
    const state: GroupStatus["state"] = done ? "done" : anyScore ? "playing" : "waiting";
    if (state === "playing" && /^\d+$/.test(on)) {
      const h = Number(on);
      onHole[h] = [...(onHole[h] ?? []), number];
    }
    const label = scramble ? g.round.scramble?.teamName?.trim() || `Team ${number}` : `Group ${number}`;
    groups.push({
      roundId: g.round.id,
      number,
      label,
      names: ordered.map((p) => first(p.name)).join(", "),
      teeTime: g.round.teeTime,
      start: opts.starts?.[g.round.id] ?? null,
      thru,
      holes: g.card.length,
      state,
      on,
      lastAt,
      quietFor,
    });

    if (opts.today && state === "playing" && quietFor != null && quietFor >= QUIET_MINUTES) {
      attention.push({ key: `quiet-${g.round.id}`, level: "warn", title: `No scores from ${label.toLowerCase().startsWith("group") ? label.toLowerCase() : label} for ${quietFor} min`, detail: `Last on hole ${lastHole(g) ?? "?"} · ${ordered.map((p) => first(p.name)).join(", ")}`, roundId: g.round.id });
    }
    if (opts.today && state === "waiting" && g.round.teeTime && g.round.status === "live" && clockNow - minutesOfDay(g.round.teeTime) >= 20) {
      attention.push({ key: `late-${g.round.id}`, level: "warn", title: `${label} hasn't entered a score`, detail: `Tee time ${g.round.teeTime} · ${ordered.map((p) => first(p.name)).join(", ")} — check they've opened the round on a phone.`, roundId: g.round.id });
    }
    const parOf = new Map(g.card.map((h) => [h.hole, h.par]));
    for (const p of scoring) {
      for (const [hole, strokes] of g.scores.get(p.id) ?? []) {
        const par = parOf.get(hole);
        if (strokes == null || par == null) continue;
        if (strokes >= par + 5 || (strokes === 1 && par > 3)) {
          attention.push({
            key: `odd-${p.id}-${hole}`,
            level: "warn",
            title: `${scramble ? label : p.name}: ${strokes} on the ${ordinal(hole)}`,
            detail: `Par ${par}. Worth a word with the group before the cards are in.`,
            roundId: g.round.id,
          });
        }
      }
    }
  }

  if (sorted.some((g) => g.card.some((h) => h.strokeIndex == null))) {
    attention.unshift({ key: "si", level: "stop", title: "A card is missing stroke indexes", detail: "Shots and countbacks can't be worked out exactly until every hole has one.", roundId: null });
  }

  return {
    groups,
    onHole,
    strips,
    attention,
    totals: {
      lines,
      holesScored,
      holesTotal,
      groupsOut: groups.filter((g) => g.state === "playing").length,
      groupsDone: groups.filter((g) => g.state === "done").length,
      groupsWaiting: groups.filter((g) => g.state === "waiting").length,
    },
  };
}

function lastHole(g: TvGame): number | null {
  let last: { at: string; hole: number } | null = null;
  for (const e of g.entries) if (!last || e.at > last.at) last = e;
  return last?.hole ?? null;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

// ---------------------------------------------------------------------------
// A set-up saved ahead of the day (0184)
// ---------------------------------------------------------------------------

/** What the organiser saved on the event, read back into the form. Never trusted to start a round. */
export type SavedSetup = {
  cardId: number | null;
  teeName: string;
  rating: string;
  slope: string;
  card: CardHole[] | null;
  format: DayFormat;
  pairScoring: PairScoring;
  start: StartMode;
  shotgunTime: string | null;
  hidden: boolean;
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/** live_setup as stored, made safe for the form; null when there's nothing usable. */
export function parseSavedSetup(raw: unknown): SavedSetup | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    cardId: Number.isInteger(r.cardId) && (r.cardId as number) > 0 ? (r.cardId as number) : null,
    teeName: str(r.teeName, 40),
    rating: str(r.rating, 8),
    slope: str(r.slope, 4),
    card: r.card == null ? null : parseCard(r.card),
    format: isDayFormat(r.format) ? r.format : "stableford",
    pairScoring: r.pairScoring === "stroke" ? "stroke" : "stableford",
    start: r.start === "shotgun" ? "shotgun" : "tees",
    shotgunTime: typeof r.shotgunTime === "string" && CLOCK.test(r.shotgunTime) ? r.shotgunTime : null,
    hidden: r.hidden === true,
  };
}
