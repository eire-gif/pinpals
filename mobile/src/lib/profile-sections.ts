import { ACHIEVEMENTS, ACHIEVEMENT_INFO, isAchievement, type AchievementType } from "./achievements";

/**
 * The social profile (Oct 2026 feed redesign, phase 10) — pure, so it's
 * tested without rendering (profile-sections.test.ts).
 *
 * A member's page leads with their golf identity — handicap, home course,
 * courses played, PinPals — and then five sections: Posts, Rounds, Courses,
 * Highlights, Achievements. Every piece of it is optional, and each respects
 * the setting that already governs it:
 *
 *   handicap        profiles.handicap_visible — hidden from everyone else
 *                   when off; its owner sees it marked "Only you"
 *   age             member_age_bands view (0059) — no row unless shared
 *   posts, rounds,  RLS on posts (0088): audience + blocks. A section can
 *   highlights,     only ever show what the feed would show this reader
 *   achievements
 *   courses         member_courses / course_reviews (0093): readable by
 *                   members by design — the lists are for comparing notes
 *   PinPals         member_pinpal_count() (0101): a number, never who;
 *                   nothing across a block
 */

export const PROFILE_TABS = ["posts", "rounds", "courses", "highlights", "achievements"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export const PROFILE_TAB_LABELS: Record<ProfileTab, string> = {
  posts: "Posts",
  rounds: "Rounds",
  courses: "Courses",
  highlights: "Highlights",
  achievements: "Achievements",
};

export function isProfileTab(value: unknown): value is ProfileTab {
  return typeof value === "string" && (PROFILE_TABS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type IdentityInput = {
  /** Null when not set OR not shared with this reader. */
  handicap: number | null;
  /** The owner's own handicap when they've chosen not to share it — only
   *  ever set when the reader is the owner. */
  privateHandicap: number | null;
  coursesPlayed: number;
  /** Null across a block, or before 0101 is applied. */
  pinpals: number | null;
  postCount: number;
};

export type IdentityTile = {
  key: "handicap" | "courses" | "pinpals" | "posts";
  label: string;
  value: string;
  /** A note under the label: "Only you" for a hidden handicap. */
  note?: string;
  /** The owner's prompt to fill it in, when empty. */
  empty?: boolean;
};

const handicapLabel = (h: number): string => (h < 0 ? `+${Math.abs(h)}` : String(h));

/**
 * The tiles under a member's name. Anything a member hasn't shared is left
 * out for other readers, not shown as a dash — an empty tile reads as
 * "hiding something". The owner sees every tile, so they can see what is
 * missing and what others can't see.
 */
export function identityTiles(p: IdentityInput, isMe: boolean): IdentityTile[] {
  const tiles: IdentityTile[] = [];
  if (p.handicap !== null) {
    tiles.push({ key: "handicap", label: "Handicap", value: handicapLabel(p.handicap) });
  } else if (isMe) {
    tiles.push(
      p.privateHandicap !== null
        ? { key: "handicap", label: "Handicap", value: handicapLabel(p.privateHandicap), note: "Only you" }
        : { key: "handicap", label: "Handicap", value: "Add", empty: true },
    );
  }
  if (p.coursesPlayed > 0 || isMe) {
    tiles.push({ key: "courses", label: p.coursesPlayed === 1 ? "Course" : "Courses", value: String(p.coursesPlayed), empty: p.coursesPlayed === 0 });
  }
  if (p.pinpals !== null) tiles.push({ key: "pinpals", label: p.pinpals === 1 ? "PinPal" : "PinPals", value: String(p.pinpals) });
  tiles.push({ key: "posts", label: p.postCount === 1 ? "Post" : "Posts", value: String(p.postCount) });
  return tiles;
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

export type RoundRowInput = {
  id: number;
  created_at: string;
  details: unknown;
  club: { id: number; name: string } | null;
};

export type RoundRow = {
  postId: number;
  /** YYYY-MM-DD: the day played if given, else the day posted. */
  date: string;
  course: string | null;
  clubId: number | null;
  score: number;
  holes: 9 | 18;
  coursePar: number | null;
  vsPar: number | null;
  tee: string | null;
  birdies: number | null;
  achievement: AchievementType | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A round post as a row, or null if it has no score to show. */
export function toRoundRow(row: RoundRowInput): RoundRow | null {
  if (!row.details || typeof row.details !== "object") return null;
  const d = row.details as Record<string, unknown>;
  const score = num(d.score);
  if (score === null) return null;
  const par = num(d.course_par);
  return {
    postId: row.id,
    date: typeof d.played_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.played_on) ? d.played_on : row.created_at.slice(0, 10),
    course: row.club?.name ?? null,
    clubId: row.club?.id ?? null,
    score,
    holes: d.holes === 9 ? 9 : 18,
    coursePar: par,
    vsPar: par === null ? null : score - par,
    tee: typeof d.tee === "string" ? d.tee : null,
    birdies: num(d.birdies),
    achievement: isAchievement(d.achievement) ? d.achievement : null,
  };
}

export type RoundStats = {
  rounds: number;
  /** Lowest full eighteen, and where. */
  best: { score: number; course: string | null } | null;
  /** Mean of full eighteens, one decimal. Null under three rounds — two
   *  rounds is a coincidence, not an average. */
  average: number | null;
  birdies: number;
};

export function roundStats(rows: RoundRow[]): RoundStats {
  const full = rows.filter((r) => r.holes === 18);
  const best = full.reduce<RoundRow | null>((b, r) => (b === null || r.score < b.score ? r : b), null);
  return {
    rounds: rows.length,
    best: best ? { score: best.score, course: best.course } : null,
    average: full.length >= 3 ? Math.round((full.reduce((s, r) => s + r.score, 0) / full.length) * 10) / 10 : null,
    birdies: rows.reduce((s, r) => s + (r.birdies ?? 0), 0),
  };
}

export const vsParLabel = (v: number | null): string | null => (v === null ? null : v === 0 ? "E" : v > 0 ? `+${v}` : String(v));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** { day: "2", month: "Oct" } for a date badge. */
export function dateBadge(iso: string): { day: string; month: string } {
  return { day: String(Number(iso.slice(8, 10))), month: MONTHS[Number(iso.slice(5, 7)) - 1] ?? "" };
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export type AchievementTally = { type: AchievementType; title: string; icon: string; count: number };

/** How many of each achievement, in ACHIEVEMENTS order, earned ones only. */
export function achievementTally(posts: { details: unknown }[]): AchievementTally[] {
  const counts = new Map<AchievementType, number>();
  for (const p of posts) {
    const a = p.details && typeof p.details === "object" ? (p.details as Record<string, unknown>).achievement : undefined;
    if (isAchievement(a)) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  return ACHIEVEMENTS.filter((a) => counts.has(a)).map((a) => ({
    type: a,
    title: ACHIEVEMENT_INFO[a].title,
    icon: ACHIEVEMENT_INFO[a].icon,
    count: counts.get(a)!,
  }));
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export type ProfileCourse = {
  clubId: number;
  name: string;
  place: string | null;
  /** The member's own star rating, if they reviewed it. */
  rating: number | null;
  home: boolean;
};

/** Home course first, then reviewed (best first), then by name. */
export function sortCourses(courses: ProfileCourse[]): ProfileCourse[] {
  return [...courses].sort(
    (a, b) =>
      Number(b.home) - Number(a.home) ||
      (b.rating ?? 0) - (a.rating ?? 0) ||
      a.name.localeCompare(b.name),
  );
}

/** Rows of `size` for a grid, the last one possibly short. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
