/**
 * Post types and the golf details a post can carry — the one definition.
 *
 * KEPT IDENTICAL in two places, because the app and the website are two
 * packages with two toolchains and cannot import from each other:
 *
 *   src/lib/post-details.ts          (website, server validation)
 *   mobile/src/lib/post-details.ts   (app, composer and card)
 *
 * src/lib/post-details.test.ts fails if the two files ever differ. Edit one,
 * copy it over the other. No imports, no React, no Supabase — plain data and
 * functions, so it runs anywhere.
 *
 * The database (0095_post_kinds.sql, post_details_valid()) enforces the same
 * shapes. This file exists so a member is told what is wrong before a check
 * constraint is, and so nothing else has to spell "round" as a string.
 *
 * TWO LISTS, ON PURPOSE.
 *
 *   PostKind — what a post IS, stored in posts.kind. Four values.
 *   PostType — what a member CHOOSES in the composer. Six, because two of
 *              them are not new kinds of post: "Photo / Video" is a general
 *              post that opens on the photo picker, and "Find players" is a
 *              tee time, which already has its own table and flow.
 *
 * ROLLOUT. Each type has a `status`. "live" types appear and work; "soon"
 * types appear greyed out with "Coming soon"; "hidden" types don't appear.
 * Flipping one is a one-line change here (and an over-the-air update).
 *
 * WHAT IS NOT HERE, AND WHY. No hole maps, shot coordinates or shot paths:
 * nothing in PinPals captures them yet, and the brief was not to invent
 * fields for data that doesn't exist. No per-hole par or yardage lookup
 * either — `clubs` has no hole data — so members type them. When either
 * arrives, add the key here and to post_details_valid() in a migration.
 */

// ---------------------------------------------------------------------------
// Kinds (stored) and types (chosen)
// ---------------------------------------------------------------------------

export const POST_KINDS = ["general", "round", "hole", "shot"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const POST_TYPES = ["general", "round", "hole", "shot", "photo", "tee_time"] as const;
export type PostType = (typeof POST_TYPES)[number];

export type PostTypeStatus = "live" | "soon" | "hidden";

export type PostTypeInfo = {
  title: string;
  description: string;
  /** An Ionicons name. Plain string so this file needs no icon package. */
  icon: string;
  /** What it saves as, or null when it hands off to another flow. */
  kind: PostKind | null;
  status: PostTypeStatus;
};

export const POST_TYPE_INFO: Record<PostType, PostTypeInfo> = {
  general: {
    title: "General post",
    description: "Share a thought, photo or update.",
    icon: "create-outline",
    kind: "general",
    status: "live",
  },
  round: {
    title: "Share a round",
    description: "Your score and stats, with photos.",
    icon: "trophy-outline",
    kind: "round",
    status: "live",
  },
  hole: {
    title: "Share a hole",
    description: "A hole, a score, a moment.",
    icon: "flag-outline",
    kind: "hole",
    status: "live",
  },
  shot: {
    title: "Share a shot",
    description: "A great (or unlucky) shot.",
    icon: "locate-outline",
    kind: "shot",
    status: "live",
  },
  photo: {
    title: "Photo / video",
    description: "Photos from your round. Video is coming soon.",
    icon: "images-outline",
    kind: "general",
    status: "live",
  },
  tee_time: {
    title: "Find players",
    description: "Offer a tee time to other PinPals.",
    icon: "people-outline",
    kind: null,
    status: "live",
  },
};

/** The types a composer menu shows, in order. */
export function menuPostTypes(): PostType[] {
  return POST_TYPES.filter((t) => POST_TYPE_INFO[t].status !== "hidden");
}

export function isPostType(value: unknown): value is PostType {
  return typeof value === "string" && (POST_TYPES as readonly string[]).includes(value);
}

export function isPostKind(value: unknown): value is PostKind {
  return typeof value === "string" && (POST_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Details — the shape stored in posts.details (snake_case, as in the row)
// ---------------------------------------------------------------------------

export const TEES = ["Black", "Blue", "White", "Yellow", "Red", "Green"] as const;
export const LIES = ["tee", "fairway", "rough", "bunker", "fringe", "green", "recovery"] as const;
export type Lie = (typeof LIES)[number];
export const LIE_LABELS: Record<Lie, string> = {
  tee: "Tee",
  fairway: "Fairway",
  rough: "Rough",
  bunker: "Bunker",
  fringe: "Fringe",
  green: "Green",
  recovery: "Recovery",
};

export type BestHole = { hole: number; par?: number; score: number };

export type RoundDetails = {
  score: number;
  holes?: 9 | 18;
  course_par?: number;
  tee?: string;
  /** YYYY-MM-DD, the day it was played (a post can go up days later). */
  played_on?: string;
  /** Only if the member knows it — PinPals has no course or slope ratings. */
  differential?: number;
  fairways_hit?: number;
  fairways_total?: number;
  gir?: number;
  putts?: number;
  /** Added in 0098, for the share card. */
  birdies?: number;
  best_hole?: BestHole;
};

export type HoleDetails = { hole: number; par?: number; yards?: number; score?: number };

export type ShotDetails = {
  hole?: number;
  shot_number?: number;
  club?: string;
  distance_yards?: number;
  lie?: Lie;
  result?: string;
};

export type PostDetails =
  | { kind: "general"; details: null }
  | { kind: "round"; details: RoundDetails }
  | { kind: "hole"; details: HoleDetails }
  | { kind: "shot"; details: ShotDetails };

/** The limits, shared by the validator and the composer's inputs. */
export const LIMITS = {
  roundScore: [18, 200],
  coursePar: [27, 80],
  hole: [1, 27],
  par: [3, 6],
  holeScore: [1, 15],
  yards: [30, 800],
  shotNumber: [1, 15],
  distance: [1, 450],
  stat: [0, 18],
  putts: [0, 99],
  differential: [-10, 60],
  teeLength: 20,
  clubLength: 24,
  resultLength: 40,
} as const;

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const inRange = (v: unknown, [lo, hi]: readonly [number, number]) => isInt(v) && v >= lo && v <= hi;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const shortText = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const onlyKeys = (o: Record<string, unknown>, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));

function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const ROUND_KEYS = [
  "score", "holes", "course_par", "tee", "played_on", "differential",
  "fairways_hit", "fairways_total", "gir", "putts", "birdies", "best_hole",
] as const;
const HOLE_KEYS = ["hole", "par", "yards", "score"] as const;
const SHOT_KEYS = ["hole", "shot_number", "club", "distance_yards", "lie", "result"] as const;

/**
 * Null when `details` is right for `kind`; otherwise a sentence a member can
 * act on. Unknown keys are refused rather than dropped, so a newer app can't
 * quietly store something an older database check doesn't know about.
 */
export function detailsProblem(kind: PostKind, details: unknown): string | null {
  if (kind === "general") return details === null || details === undefined ? null : "A general post has no golf details.";
  if (!isObject(details)) return "Add the details for this post.";

  if (kind === "round") {
    const d = details;
    if (!onlyKeys(d, ROUND_KEYS)) return "Something in that round isn't recognised — please update the app.";
    if (!inRange(d.score, LIMITS.roundScore)) return "Enter your score for the round.";
    if (d.holes !== undefined && d.holes !== 9 && d.holes !== 18) return "A round is 9 or 18 holes.";
    if (d.course_par !== undefined && !inRange(d.course_par, LIMITS.coursePar)) return "That course par doesn't look right.";
    if (d.tee !== undefined && !shortText(d.tee, LIMITS.teeLength)) return "Choose the tees you played.";
    if (d.played_on !== undefined && !isIsoDate(d.played_on)) return "That date doesn't look right.";
    if (
      d.differential !== undefined &&
      !(typeof d.differential === "number" && d.differential >= LIMITS.differential[0] && d.differential <= LIMITS.differential[1])
    )
      return "That differential doesn't look right.";
    for (const key of ["fairways_hit", "fairways_total", "gir"] as const) {
      if (d[key] !== undefined && !inRange(d[key], LIMITS.stat)) return "Fairways and greens are counted 0 to 18.";
    }
    if (d.birdies !== undefined && !inRange(d.birdies, LIMITS.stat)) return "That birdie count doesn't look right.";
    if (d.fairways_hit !== undefined && d.fairways_total !== undefined && (d.fairways_hit as number) > (d.fairways_total as number))
      return "Fairways hit can't be more than fairways played.";
    if (d.putts !== undefined && !inRange(d.putts, LIMITS.putts)) return "That putt count doesn't look right.";
    if (d.best_hole !== undefined) {
      const b = d.best_hole;
      if (!isObject(b) || !onlyKeys(b, ["hole", "par", "score"])) return "Pick your best hole again.";
      if (!inRange(b.hole, LIMITS.hole) || !inRange(b.score, LIMITS.holeScore)) return "Your best hole needs a hole number and a score.";
      if (b.par !== undefined && !inRange(b.par, LIMITS.par)) return "A hole is a par 3, 4, 5 or 6.";
    }
    return null;
  }

  if (kind === "hole") {
    const d = details;
    if (!onlyKeys(d, HOLE_KEYS)) return "Something in that hole isn't recognised — please update the app.";
    if (!inRange(d.hole, LIMITS.hole)) return "Which hole was it?";
    if (d.par !== undefined && !inRange(d.par, LIMITS.par)) return "A hole is a par 3, 4, 5 or 6.";
    if (d.yards !== undefined && !inRange(d.yards, LIMITS.yards)) return "That yardage doesn't look right.";
    if (d.score !== undefined && !inRange(d.score, LIMITS.holeScore)) return "That score doesn't look right.";
    return null;
  }

  // shot
  const d = details;
  if (!onlyKeys(d, SHOT_KEYS)) return "Something in that shot isn't recognised — please update the app.";
  if (d.hole !== undefined && !inRange(d.hole, LIMITS.hole)) return "Which hole was it?";
  if (d.shot_number !== undefined && !inRange(d.shot_number, LIMITS.shotNumber)) return "That shot number doesn't look right.";
  if (d.club !== undefined && !shortText(d.club, LIMITS.clubLength)) return "Keep the club short — \"7 Iron\", \"Driver\".";
  if (d.distance_yards !== undefined && !inRange(d.distance_yards, LIMITS.distance)) return "That distance doesn't look right.";
  if (d.lie !== undefined && !(LIES as readonly string[]).includes(d.lie as string)) return "Choose where the ball was lying.";
  if (d.result !== undefined && !shortText(d.result, LIMITS.resultLength)) return "Keep the result short.";
  if (d.club === undefined && d.distance_yards === undefined && d.result === undefined)
    return "Add the club, the distance or how it finished.";
  return null;
}

/**
 * Drops empty values before saving: a composer field left blank is
 * `undefined` here, never `null` or "", so it isn't stored at all.
 */
export function cleanDetails<T extends Record<string, unknown>>(details: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      const t = v.trim();
      if (t) out[k] = t;
      continue;
    }
    if (typeof v === "number" && Number.isNaN(v)) continue;
    out[k] = isObject(v) ? cleanDetails(v) : v;
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** "Ace", "Eagle", "Birdie", "Par", "Bogey"… — or "+4" past a triple. */
export function scoreName(score: number, par: number | undefined): string | null {
  if (score === 1) return "Ace";
  if (par === undefined) return null;
  const diff = score - par;
  const names: Record<number, string> = {
    [-3]: "Albatross",
    [-2]: "Eagle",
    [-1]: "Birdie",
    0: "Par",
    1: "Bogey",
    2: "Double bogey",
    3: "Triple bogey",
  };
  return names[diff] ?? (diff < -3 ? `${diff}` : `+${diff}`);
}

/** "78 (+6)", "70 (-2)", "72 (E)" — or just "81" without a par. */
export function roundScoreLabel(score: number, coursePar: number | undefined): string {
  if (coursePar === undefined) return String(score);
  const rel = score - coursePar;
  return `${score} (${rel === 0 ? "E" : rel > 0 ? `+${rel}` : rel})`;
}

/**
 * The chips under a post's media, in the order a golfer would say them.
 * Empty for a general post.
 */
export function detailChips(post: { kind: PostKind; details: unknown }): string[] {
  const chips: string[] = [];
  if (post.kind === "round" && isObject(post.details)) {
    const d = post.details as RoundDetails;
    chips.push(roundScoreLabel(d.score, d.course_par));
    if (d.holes === 9) chips.push("9 holes");
    if (d.tee) chips.push(`${d.tee} tees`);
    if (d.fairways_hit !== undefined) chips.push(`${d.fairways_hit}${d.fairways_total ? `/${d.fairways_total}` : ""} fairways`);
    if (d.birdies !== undefined && d.birdies > 0) chips.push(`${d.birdies} ${d.birdies === 1 ? "birdie" : "birdies"}`);
    if (d.gir !== undefined) chips.push(`${d.gir} GIR`);
    if (d.putts !== undefined) chips.push(`${d.putts} putts`);
    if (d.differential !== undefined) chips.push(`Diff ${d.differential.toFixed(1)}`);
    if (d.best_hole) {
      const name = scoreName(d.best_hole.score, d.best_hole.par);
      chips.push(`Best: ${d.best_hole.hole}${name ? ` · ${name}` : ""}`);
    }
  } else if (post.kind === "hole" && isObject(post.details)) {
    const d = post.details as HoleDetails;
    chips.push(`Hole ${d.hole}`);
    if (d.par !== undefined) chips.push(`Par ${d.par}`);
    if (d.yards !== undefined) chips.push(`${d.yards} yds`);
    if (d.score !== undefined) chips.push(scoreName(d.score, d.par) ?? `Scored ${d.score}`);
  } else if (post.kind === "shot" && isObject(post.details)) {
    const d = post.details as ShotDetails;
    if (d.hole !== undefined) chips.push(`Hole ${d.hole}`);
    if (d.shot_number !== undefined) chips.push(`Shot ${d.shot_number}`);
    if (d.club) chips.push(d.club);
    if (d.distance_yards !== undefined) chips.push(`${d.distance_yards} yds`);
    if (d.lie) chips.push(`From the ${LIE_LABELS[d.lie].toLowerCase()}`);
    if (d.result) chips.push(d.result);
  }
  return chips;
}
