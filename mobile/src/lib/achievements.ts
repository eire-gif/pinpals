/**
 * Golf achievements — the one definition (Oct 2026 feed redesign, phase 8).
 *
 * KEPT IDENTICAL in two places, like post-details.ts and reactions.ts:
 *
 *   src/lib/achievements.ts          (website: validation, share card)
 *   mobile/src/lib/achievements.ts   (app: composer, achievement card)
 *
 * src/lib/achievements.test.ts fails if they differ. No imports.
 *
 * An achievement is a CLAIM the member makes on a round or hole post —
 * `details.achievement` — never something PinPals stamps on a post by
 * itself. A 78 isn't announced as "Broke 80" unless the member says so:
 * for a scratch golfer it's a bad day. What this file decides is which
 * claims a post's numbers SUPPORT (eligibleAchievements), so a 92 can't be
 * posted as "Broke 80"; the database (post_details_valid, 0100) and the
 * website check the same rules, and the website alone checks Personal Best
 * against the member's earlier rounds.
 *
 * Everything that draws an achievement — the feed card, the share card,
 * anything later — reads the same `Achievement` structure from
 * achievementOf(), so a new achievement is a new entry here, not a screen.
 */

export const ACHIEVEMENTS = [
  "hole_in_one",
  "eagle",
  "personal_best",
  "breaking_70",
  "breaking_80",
  "breaking_90",
  "breaking_100",
] as const;
export type AchievementType = (typeof ACHIEVEMENTS)[number];

export type AchievementInfo = {
  title: string;
  /** One line under the title on the card. */
  tagline: string;
  /** An Ionicons name (plain string: no icon package here). */
  icon: string;
  /** Which kinds of post can carry it. */
  kinds: ("round" | "hole")[];
};

export const ACHIEVEMENT_INFO: Record<AchievementType, AchievementInfo> = {
  hole_in_one: { title: "Hole in One", tagline: "One swing. In the cup.", icon: "flag", kinds: ["hole", "round"] },
  eagle: { title: "Eagle", tagline: "Two under on one hole.", icon: "trending-down", kinds: ["hole", "round"] },
  personal_best: { title: "Personal Best", tagline: "Best round on PinPals yet.", icon: "trophy", kinds: ["round"] },
  breaking_70: { title: "Broke 70", tagline: "Under 70 for eighteen.", icon: "ribbon", kinds: ["round"] },
  breaking_80: { title: "Broke 80", tagline: "Under 80 for eighteen.", icon: "ribbon", kinds: ["round"] },
  breaking_90: { title: "Broke 90", tagline: "Under 90 for eighteen.", icon: "ribbon", kinds: ["round"] },
  breaking_100: { title: "Broke 100", tagline: "Under 100 for eighteen.", icon: "ribbon", kinds: ["round"] },
};

const BREAKING: [AchievementType, number][] = [
  ["breaking_70", 70],
  ["breaking_80", 80],
  ["breaking_90", 90],
  ["breaking_100", 100],
];

export function isAchievement(value: unknown): value is AchievementType {
  return typeof value === "string" && (ACHIEVEMENTS as readonly string[]).includes(value);
}

type Num = number | undefined | null;
const n = (v: unknown): Num => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The score on a hole that makes it an ace or an eagle. */
function holeClaims(score: Num, par: Num): AchievementType[] {
  if (score === 1) return ["hole_in_one"];
  if (score !== undefined && score !== null && par !== undefined && par !== null && score === par - 2) return ["eagle"];
  return [];
}

/**
 * The achievements a post's numbers support, most remarkable first. Kind
 * and details as stored; anything malformed supports nothing.
 *
 *   hole:  a 1 → Hole in One; two under par → Eagle
 *   round: a full 18 under 70 / 80 / 90 / 100 → Broke 70… (the lowest
 *          threshold beaten first); any full 18 → Personal Best (the website
 *          checks it really is); a best hole that was an ace or eagle → those
 */
export function eligibleAchievements(kind: string, details: unknown): AchievementType[] {
  if (!details || typeof details !== "object") return [];
  const d = details as Record<string, unknown>;
  if (kind === "hole") return holeClaims(n(d.score), n(d.par));
  if (kind !== "round") return [];

  const out: AchievementType[] = [];
  const best = d.best_hole && typeof d.best_hole === "object" ? (d.best_hole as Record<string, unknown>) : null;
  if (best) out.push(...holeClaims(n(best.score), n(best.par)));
  const score = n(d.score);
  const full = d.holes !== 9;
  if (score !== undefined && score !== null && full) {
    out.push("personal_best");
    for (const [type, under] of BREAKING) if (score < under) out.push(type);
  }
  return out;
}

/** Null when the post may carry `details.achievement` (or has none). */
export function achievementProblem(kind: string, details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const claim = (details as Record<string, unknown>).achievement;
  if (claim === undefined) return null;
  if (!isAchievement(claim)) return "That achievement isn't recognised — please update the app.";
  if (!eligibleAchievements(kind, details).includes(claim)) {
    return `Your numbers don't show a ${ACHIEVEMENT_INFO[claim].title.toLowerCase()} — check the score.`;
  }
  return null;
}

/** The structure everything that draws an achievement reads. */
export type Achievement = {
  achievementType: AchievementType;
  achievementTitle: string;
  tagline: string;
  icon: string;
  course: string | null;
  hole: number | null;
  club: string | null;
  /** Yards: the hole's length for a hole, the longest drive for a round. */
  distance: number | null;
  /** As a golfer says it: "78 (+6)", "Ace", "3". */
  score: string | null;
  /** YYYY-MM-DD: the day played if known, else the day posted. */
  date: string | null;
  /** Up to three supporting numbers for the card, e.g. Birdies 3. */
  stats: { label: string; value: string }[];
};

const SCORE_NAMES: Record<number, string> = { [-3]: "Albatross", [-2]: "Eagle", [-1]: "Birdie", 0: "Par" };

/**
 * The achievement on a post, or null. Only a claim its numbers still
 * support is returned, so a stored claim that no longer adds up (it can't,
 * past the database check, but cheaply re-checked) is simply not drawn.
 */
export function achievementOf(post: {
  kind: string;
  details: unknown;
  courseName: string | null;
  createdAt?: string | null;
}): Achievement | null {
  if (!post.details || typeof post.details !== "object") return null;
  const d = post.details as Record<string, unknown>;
  const type = d.achievement;
  if (!isAchievement(type) || achievementProblem(post.kind, post.details)) return null;
  const info = ACHIEVEMENT_INFO[type];
  const posted = typeof post.createdAt === "string" ? post.createdAt.slice(0, 10) : null;
  const base = {
    achievementType: type,
    achievementTitle: info.title,
    tagline: info.tagline,
    icon: info.icon,
    course: post.courseName,
  };

  if (post.kind === "hole") {
    const score = n(d.score);
    const par = n(d.par);
    const name = score === 1 ? "Ace" : score != null && par != null ? (SCORE_NAMES[score - par] ?? String(score)) : null;
    const stats: Achievement["stats"] = [];
    if (par != null) stats.push({ label: "Par", value: String(par) });
    if (n(d.yards) != null) stats.push({ label: "Yards", value: String(d.yards) });
    if (typeof d.club === "string" && d.club) stats.push({ label: "Club", value: d.club });
    return {
      ...base,
      hole: n(d.hole) ?? null,
      club: typeof d.club === "string" ? d.club : null,
      distance: n(d.yards) ?? null,
      score: name,
      date: posted,
      stats,
    };
  }

  // round
  const score = n(d.score);
  const par = n(d.course_par);
  const rel = score != null && par != null ? score - par : null;
  const best = d.best_hole && typeof d.best_hole === "object" ? (d.best_hole as Record<string, unknown>) : null;
  const holeClaim = type === "hole_in_one" || type === "eagle";
  const stats: Achievement["stats"] = [];
  if (n(d.birdies) != null) stats.push({ label: "Birdies", value: String(d.birdies) });
  if (n(d.gir) != null) stats.push({ label: "GIR", value: String(d.gir) });
  if (n(d.putts) != null) stats.push({ label: "Putts", value: String(d.putts) });
  if (stats.length < 3 && n(d.fairways_hit) != null) {
    stats.push({ label: "Fairways", value: `${d.fairways_hit}${n(d.fairways_total) ? `/${d.fairways_total}` : ""}` });
  }
  return {
    ...base,
    hole: holeClaim && best ? (n(best.hole) ?? null) : null,
    club: null,
    distance: n(d.longest_drive) ?? null,
    score:
      score == null
        ? null
        : rel === null
          ? String(score)
          : `${score} (${rel === 0 ? "E" : rel > 0 ? `+${rel}` : rel})`,
    date: typeof d.played_on === "string" ? d.played_on : posted,
    stats: stats.slice(0, 3),
  };
}
