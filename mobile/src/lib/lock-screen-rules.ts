// Pure: tested in lock-screen-rules.test.ts (no React Native here).
//
// The small translations between the round screen's data and the lock
// screen card (lock-screen.ts → Swift in mobile/targets/widget/_shared).

import { holeGeometry, type LayoutPoint } from "./hole-geo";

type Hole = { hole: number };

/** Scores for the card: hole number (as a string) → strokes, picked up = 0. */
export function lockScreenStrokes(scores: ReadonlyMap<number, number | null>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [hole, strokes] of scores) out[String(hole)] = strokes == null ? 0 : strokes;
  return out;
}

/** The hole the card shows: the first on the card with no score yet, else the last. */
export function lockScreenHole(card: readonly Hole[], scores: ReadonlyMap<number, number | null>): number {
  const next = card.find((h) => !scores.has(h.hole));
  return next?.hole ?? card[card.length - 1]?.hole ?? 1;
}

const ordinal = (n: number): string => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};

/** "2nd of 4", "T2 of 4"; null before anyone has a position or alone. */
export function positionLine(position: string, of: number): string | null {
  if (!position || of < 2) return null;
  const tied = position.startsWith("T");
  const n = Number(tied ? position.slice(1) : position);
  if (!Number.isInteger(n) || n < 1) return null;
  return tied ? `Joint ${ordinal(n)} of ${of}` : `${ordinal(n)} of ${of}`;
}

/**
 * Where each hole's green centre and tee are, for the card's distance to
 * the green: [lat, lng] pairs, null where the hole isn't mapped. The
 * provider's points first (golfapi.io), OpenStreetMap's where it has none —
 * the same order as the hole map.
 */
export type LockScreenSpot = {
  n: number;
  green: [number, number] | null;
  tee: [number, number] | null;
  /** Watch v2 (claude/watch-v2.md): front and back of the green, where mapped. The card reads only green and tee. */
  front?: [number, number];
  back?: [number, number];
  /** Hazards and markers on the hole: kind, a name for the watch, and where. */
  hz?: { k: string; l: string; p: [number, number] }[];
};

/** What the watch calls a hazard when the course data gives it no name. */
const HAZARD_NAMES: Record<string, string> = {
  green_bunker: "Greenside bunker",
  fairway_bunker: "Fairway bunker",
  water: "Water",
  trees: "Trees",
  marker_100: "100 marker",
  marker_150: "150 marker",
  marker_200: "200 marker",
  dogleg: "Dogleg",
  other: "Hazard",
};

export function lockScreenSpots(card: readonly Hole[], provider: readonly LayoutPoint[], osm: readonly LayoutPoint[]): LockScreenSpot[] {
  const pair = (p: { lat: number; lng: number } | null): [number, number] | null => (p ? [p.lat, p.lng] : null);
  return card.map(({ hole }) => {
    const fromProvider = holeGeometry(provider, hole);
    const g = fromProvider.mapped ? fromProvider : holeGeometry(osm, hole);
    const spot: LockScreenSpot = { n: hole, green: pair(g.greenCentre), tee: pair(g.tee) };
    if (g.greenFront) spot.front = [g.greenFront.lat, g.greenFront.lng];
    if (g.greenBack) spot.back = [g.greenBack.lat, g.greenBack.lng];
    // A watch screen holds about eight rows; a course rarely maps more on one hole.
    const hz = g.hazards.slice(0, 12).map((h) => ({ k: h.kind, l: (h.label?.trim() || HAZARD_NAMES[h.kind]) ?? "Hazard", p: [h.lat, h.lng] as [number, number] }));
    if (hz.length > 0) spot.hz = hz;
    return spot;
  });
}

// ---- Watch v2 (claude/watch-v2.md): what else the watch needs ----

/** One player on the watch's group page. */
export type WatchPlayer = {
  id: number;
  /** "Tom", or "Tom B." when two share a first name. */
  name: string;
  me: boolean;
  /** Shots received on each hole, in the card's order. */
  shots: number[];
  /** Saved scores, hole number → strokes; picked up = 0. */
  strokes: Record<string, number>;
};

export type WatchExtras = {
  /** The group page: everyone's own ball, and more than one of them. */
  group: WatchPlayer[] | null;
  /** Competition mode (competition-mode-rules.ts): distances only. */
  competition: boolean;
  /** Premium features the member has (all of them while paid plans are off). */
  premium: { map: boolean; playsLike: boolean };
  /** The wind at the course, for "plays like"; null when unknown or in a competition. */
  wind: { kmh: number; from: number; at: string } | null;
  /** GET /api/widget/live/board, for the leaderboard page. */
  board: string;
};

/** Short names for the watch: first names, with an initial where two clash. */
export function watchNames(names: readonly string[]): string[] {
  const parts = names.map((n) => n.trim().split(/\s+/).filter(Boolean));
  const first = parts.map((p) => p[0] ?? "Player");
  return parts.map((p, i) => {
    const clash = first.filter((f) => f.toLowerCase() === first[i].toLowerCase()).length > 1;
    const initial = p.length > 1 ? ` ${p[p.length - 1][0].toUpperCase()}.` : "";
    return (clash ? `${first[i]}${initial}` : first[i]).slice(0, 14);
  });
}

/**
 * The group page's players, or null when there isn't one: a pair or team
 * shares one card, a foursomes or greensomes match is scored in the app,
 * and on your own there's nobody else to score.
 */
export function watchGroup(
  input: {
    shared: boolean;
    players: readonly { id: number; name: string; memberId: string | null; position: number }[];
    me: string;
    card: readonly Hole[];
    shotsAt: (playerId: number, hole: number) => number | null;
    scores: ReadonlyMap<number, ReadonlyMap<number, number | null>>;
  }
): WatchPlayer[] | null {
  if (input.shared || input.players.length < 2 || input.players.length > 8) return null;
  const ordered = [...input.players].sort((a, b) => a.position - b.position);
  // You first: it's your card you're most likely changing.
  const mine = ordered.findIndex((p) => p.memberId === input.me);
  if (mine < 0) return null;
  const list = [ordered[mine], ...ordered.filter((_, i) => i !== mine)];
  const names = watchNames(list.map((p) => p.name));
  return list.map((p, i) => ({
    id: p.id,
    name: names[i],
    me: i === 0,
    shots: input.card.map((h) => input.shotsAt(p.id, h.hole) ?? 0),
    strokes: lockScreenStrokes(input.scores.get(p.id) ?? new Map()),
  }));
}

/** Any hole with a green to measure to: worth sending to the card. */
export const anySpots = (spots: readonly LockScreenSpot[]): boolean => spots.some((s) => s.green != null);

/** The card's links: append the hole number. Voice opens the round listening; the map opens on the hole. */
export function lockScreenLinks(
  roundId: number,
  clubId: number | null,
  on: { voice: boolean; map: boolean }
): { voiceUrl: string | null; mapUrl: string | null } {
  return {
    voiceUrl: on.voice ? `pinpals://live/round/${roundId}?voice=1&hole=` : null,
    mapUrl: on.map && clubId != null ? `pinpals://hole-map?clubId=${clubId}&roundId=${roundId}&hole=` : null,
  };
}
