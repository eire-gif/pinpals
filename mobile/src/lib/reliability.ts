/**
 * Tee-time reliability and the Verified badge, in words (Oct 2026, 0188).
 *
 * The numbers come from member_reliability() in the database: rounds played,
 * no-shows and late cancellations (inside 24 hours) over the last 12 months.
 * This turns them into the short line shown on a request, a profile or a
 * player list. Pure on purpose — no React, no supabase — so the same file is
 * used by the website (src/lib/reliability.ts and mobile/src/lib/reliability.ts are exact copies) and tested in
 * vitest.
 */

export type ReliabilityLevel = "new" | "reliable" | "mostly" | "patchy";

export type Reliability = {
  memberId: string;
  played: number;
  noShows: number;
  lateCancels: number;
  level: ReliabilityLevel;
};

export type ReliabilityRow = {
  member_id: string;
  rounds_played: number;
  no_shows: number;
  late_cancels: number;
  level: string;
};

export type Tone = "good" | "neutral" | "warn" | "bad";

const LEVELS: ReliabilityLevel[] = ["new", "reliable", "mostly", "patchy"];

export function fromRow(row: ReliabilityRow): Reliability {
  return {
    memberId: row.member_id,
    played: Number(row.rounds_played) || 0,
    noShows: Number(row.no_shows) || 0,
    lateCancels: Number(row.late_cancels) || 0,
    level: LEVELS.includes(row.level as ReliabilityLevel) ? (row.level as ReliabilityLevel) : "new",
  };
}

/** Rounds on record: played plus every one that wasn't. */
export function onRecord(r: Reliability): number {
  return r.played + r.noShows + r.lateCancels;
}

/**
 * The badge. Short enough for one line under a name.
 *   Reliable · 18 of 18 rounds
 *   Usually turns up · 15 of 18 rounds
 *   Has missed rounds · 6 of 10 rounds
 *   New to tee times
 */
export function reliabilityBadge(r: Reliability | null | undefined): { label: string; tone: Tone } {
  if (!r || r.level === "new") return { label: "New to tee times", tone: "neutral" };
  const of = `${r.played} of ${onRecord(r)} ${onRecord(r) === 1 ? "round" : "rounds"}`;
  switch (r.level) {
    case "reliable":
      return { label: `Reliable · ${of}`, tone: "good" };
    case "mostly":
      return { label: `Usually turns up · ${of}`, tone: "warn" };
    default:
      return { label: `Has missed rounds · ${of}`, tone: "bad" };
  }
}

/** The member's own fuller line, for their profile. */
export function reliabilityDetail(r: Reliability | null | undefined): string {
  if (!r || onRecord(r) === 0) return "No tee times on record yet. Turn up for rounds you confirm and your record builds from there.";
  const parts = [`${r.played} played`];
  parts.push(`${r.noShows} ${r.noShows === 1 ? "no-show" : "no-shows"}`);
  parts.push(`${r.lateCancels} late ${r.lateCancels === 1 ? "cancellation" : "cancellations"}`);
  return `${parts.join(" · ")} in the last 12 months.`;
}

/** Most reliable first, new members in the middle, patchy last. Stable otherwise. */
export function byReliability<T>(items: T[], of: (item: T) => Reliability | null | undefined): T[] {
  const rank: Record<ReliabilityLevel, number> = { reliable: 0, mostly: 1, new: 2, patchy: 3 };
  return items
    .map((item, i) => ({ item, i, r: rank[of(item)?.level ?? "new"] }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
}

export const VERIFIED_LABEL = "Verified golfer";

/** "Verified golfer · Portmarnock" */
export function verifiedLabel(clubName: string | null | undefined): string {
  return clubName ? `${VERIFIED_LABEL} · ${clubName}` : VERIFIED_LABEL;
}

/** A no-show or late cancellation on one round (tee_time_attendance, 0188). */
export type AttendanceMark = {
  inviteId: number;
  memberId: string;
  outcome: "no_show" | "late_cancel";
  disputed: boolean;
  resolution: "upheld" | "overturned" | null;
};

export type AttendanceRow = {
  invite_id: number;
  member_id: string;
  outcome: string;
  disputed_at: string | null;
  resolution: string | null;
};

export function toMark(row: AttendanceRow): AttendanceMark {
  return {
    inviteId: Number(row.invite_id),
    memberId: row.member_id,
    outcome: row.outcome === "late_cancel" ? "late_cancel" : "no_show",
    disputed: !!row.disputed_at,
    resolution: row.resolution === "upheld" || row.resolution === "overturned" ? row.resolution : null,
  };
}

/** A host can say who turned up for a week after the round (mark_tee_time_no_show). */
export const NO_SHOW_DAYS = 7;

/** `playDate` is "YYYY-MM-DD"; `today` the same, in Irish time. */
export function canStillMark(playDate: string, today: string): boolean {
  const days = (Date.parse(today) - Date.parse(playDate)) / 86400_000;
  return days >= 0 && days <= NO_SHOW_DAYS;
}

/** What the golfer sees on a round they were marked absent from. */
export function noShowLine(mark: AttendanceMark): string {
  if (mark.resolution === "overturned") return "No-show removed after your dispute.";
  if (mark.resolution === "upheld") return "Marked as a no-show. Your dispute wasn't upheld.";
  if (mark.disputed) return "You've disputed the no-show. It doesn't count while it's checked.";
  return "The host marked you as not turning up.";
}

/**
 * Giving back a confirmed place now would be a late cancellation: under 24
 * hours to the tee time (or to 8am, for a round with no time). The database
 * makes the real decision in Irish time; this is only for the warning.
 */
export function isLateNotice(playDate: string, teeTime: string | null, now: Date = new Date()): boolean {
  const starts = Date.parse(`${playDate}T${(teeTime ?? "08:00:00").slice(0, 8).padEnd(8, ":00")}`);
  if (Number.isNaN(starts)) return false;
  const hours = (starts - now.getTime()) / 3600_000;
  return hours < 24;
}

export const LATE_CANCEL_WARNING = "It's less than 24 hours to the tee time, so this goes on your record as a late cancellation.";
