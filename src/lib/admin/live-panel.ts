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
