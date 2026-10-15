/**
 * Wind on the hole map (Oct 2026) — pure, tested in wind.test.ts.
 *
 * The website gives the wind (speed, gusts, where it blows FROM). This
 * turns it into what a golfer wants on this shot: into or behind, from
 * which side, and how far the shot "plays like".
 *
 * Plays like — the rule of thumb tour caddies use, deliberately simple:
 * each mph of headwind adds about 1% to the distance, each mph of tailwind
 * takes off about half that. Crosswind changes the aim, not the length.
 * Capped so a gale doesn't produce nonsense.
 */

export type Wind = { speedKmh: number; gustKmh: number | null; fromDeg: number; credit: string; creditUrl: string; at: string };

export const KMH_PER_MPH = 1.609344;

export type WindOnShot = {
  /** Into the player: positive; behind: negative. In the wind's speed unit. */
  head: number;
  /** From the right (blowing right to left): positive. */
  cross: number;
  /** "Into you", "Behind you", "Across", "Calm". */
  along: "into" | "behind" | "across" | "calm";
  /** Which way it's pushing the ball, or null when it's dead on or calm. */
  push: "left to right" | "right to left" | null;
};

const norm = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** The wind relative to a shot played on `shotBearing` (degrees from north). */
export function windOnShot(speed: number, fromDeg: number, shotBearing: number): WindOnShot {
  const rel = (norm(fromDeg - shotBearing) * Math.PI) / 180;
  const head = speed * Math.cos(rel);
  const cross = speed * Math.sin(rel);
  if (speed < 3) return { head: 0, cross: 0, along: "calm", push: null };
  const along = Math.abs(head) >= Math.abs(cross) * 0.58 ? (head > 0 ? "into" : "behind") : "across"; // within ~60° of the line counts as into/behind
  const push = Math.abs(cross) < 2.5 ? null : cross > 0 ? "right to left" : "left to right";
  return { head, cross, along, push };
}

/** How far a shot of `distanceM` plays with `headMph` of head (+) or tail (−) wind. */
export function playsLikeM(distanceM: number, headMph: number): number {
  const pct = headMph >= 0 ? 0.01 * headMph : 0.005 * headMph;
  return distanceM * (1 + Math.max(-0.15, Math.min(0.3, pct)));
}

/**
 * Which way to point the arrow on the map, in degrees clockwise from the
 * top of the screen: the map is turned so the hole runs up (`mapRotation`
 * is the compass bearing at the top), and the arrow shows where the wind
 * is blowing TO.
 */
export function arrowOnScreen(fromDeg: number, mapRotation: number): number {
  return (((fromDeg + 180 - mapRotation) % 360) + 360) % 360;
}

/** "14 mph" or "22 km/h", in the member's unit (yards → mph, metres → km/h). */
export function windSpeed(kmh: number, yards: boolean): string {
  return yards ? `${Math.round(kmh / KMH_PER_MPH)} mph` : `${Math.round(kmh)} km/h`;
}

/** One line for the chip: "Into you, left to right". */
export function windLine(w: WindOnShot): string {
  if (w.along === "calm") return "Calm";
  const a = w.along === "into" ? "Into you" : w.along === "behind" ? "Behind you" : "Across";
  return w.push ? `${a}, ${w.push}` : a;
}

/** How strong, for the arrows across the map: 1 light (under 10 mph),
 *  2 moderate (10–17), 3 strong (18+). Null when it's calm. */
export function windLevel(mph: number): 1 | 2 | 3 | null {
  if (mph < 3) return null;
  if (mph < 10) return 1;
  if (mph < 18) return 2;
  return 3;
}
