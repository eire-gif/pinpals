// Pure helpers for the Overview's "Live now" panel (0161). No Supabase, no
// Next.js — tested in live-panel.test.ts.

import type { StaffRole } from "./roles";

/** Who sees the live panel. Super admin only, as asked: it shows where
 *  members are in the product right now. Widen here and nowhere else. */
export const LIVE_PANEL_ROLES: readonly StaffRole[] = ["super_admin"];

export function canSeeLivePanel(staff: { role: StaffRole; status: string } | null): boolean {
  return !!staff && staff.status === "active" && LIVE_PANEL_ROLES.includes(staff.role);
}

/** "▲ 3 vs this time yesterday" — the change against the same span of
 *  yesterday, or null when there's nothing to compare. */
export function changeVsYesterday(today: number, yesterday: number | undefined): { dir: "up" | "down" | "same"; text: string } | null {
  if (yesterday == null) return null;
  if (today === yesterday) return { dir: "same", text: "Same as this time yesterday" };
  const diff = today - yesterday;
  if (yesterday === 0) return { dir: "up", text: `+${diff} vs none by now yesterday` };
  const pct = Math.round((diff / yesterday) * 100);
  return { dir: diff > 0 ? "up" : "down", text: `${diff > 0 ? "+" : ""}${pct}% vs this time yesterday` };
}

/** "just now", "4 min ago", "2 h ago". */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const FORMAT_LABELS: Record<string, string> = {
  stableford: "Stableford",
  stroke: "Stroke play",
  matchplay: "Matchplay",
  scramble: "Scramble",
  foursomes: "Foursomes",
  fourball: "Fourball",
};

export function formatLabel(format: string): string {
  return FORMAT_LABELS[format] ?? format.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const FEED_LABELS: Record<string, string> = {
  game_started: "Game started",
  game_finished: "Game finished",
  new_member: "New member",
  tee_time: "Tee time posted",
  listing: "Listing posted",
  group: "Group created",
};

// ---------------------------------------------------------------------------
// The drill-down lists behind the panel's numbers (/admin/activity).
// ---------------------------------------------------------------------------

export const ACTIVITY_KINDS = ["scorecards", "games", "tee_times", "groups", "members", "listings", "posts"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  scorecards: "Scorecards completed",
  games: "Games",
  tee_times: "Tee times posted",
  groups: "Groups created",
  members: "New members",
  listings: "Listings posted",
  posts: "Social posts",
};

export const ACTIVITY_RANGES = ["today", "yesterday", "7d"] as const;
export type ActivityRange = (typeof ACTIVITY_RANGES)[number];

export const ACTIVITY_RANGE_LABELS: Record<ActivityRange, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
};

export function parseActivityKind(raw: string | undefined): ActivityKind {
  return (ACTIVITY_KINDS as readonly string[]).includes(raw ?? "") ? (raw as ActivityKind) : "scorecards";
}

export function parseActivityRange(raw: string | undefined): ActivityRange {
  return (ACTIVITY_RANGES as readonly string[]).includes(raw ?? "") ? (raw as ActivityRange) : "today";
}

/** The link from a panel number to its list. */
export function activityHref(kind: ActivityKind, range: ActivityRange = "today"): string {
  return range === "today" ? `/admin/activity?show=${kind}` : `/admin/activity?show=${kind}&range=${range}`;
}

/** Midnight in Ireland on the day `at` falls on, as a UTC instant. */
export function irishMidnight(at: Date): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offset = wallAsUtc - Math.floor(at.getTime() / 1000) * 1000;
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")) - offset);
}

/** [from, to) for a range, Irish days. */
export function activityWindow(range: ActivityRange, now: Date): { from: Date; to: Date } {
  const today = irishMidnight(now);
  if (range === "yesterday") return { from: irishMidnight(new Date(today.getTime() - 12 * 3600_000)), to: today };
  if (range === "7d") return { from: irishMidnight(new Date(today.getTime() - 6 * 24 * 3600_000 + 12 * 3600_000)), to: now };
  return { from: today, to: now };
}

export type CardHole = { hole: number; par: number; strokes: number | null; putts?: number | null; stroke_index?: number | null };

/** Gross, holes played and score to par over the holes actually played. */
export function cardSummary(holes: CardHole[], size: number): {
  gross: number;
  played: number;
  toPar: number;
  complete: boolean;
  putts: number | null;
} {
  const played = holes.filter((h) => h.strokes != null);
  const gross = played.reduce((s, h) => s + (h.strokes ?? 0), 0);
  const par = played.reduce((s, h) => s + h.par, 0);
  const withPutts = played.filter((h) => h.putts != null);
  return {
    gross,
    played: played.length,
    toPar: gross - par,
    complete: played.length >= size,
    putts: withPutts.length ? withPutts.reduce((s, h) => s + (h.putts ?? 0), 0) : null,
  };
}

/** "+4", "E", "-2". */
export function toParText(n: number): string {
  return n === 0 ? "E" : n > 0 ? `+${n}` : `${n}`;
}
