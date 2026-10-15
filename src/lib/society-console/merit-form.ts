/**
 * The order of merit's rules (0145) as the console's form sends them —
 * the app's merit screen's own check (fromDraft), word for word, before
 * save_order_of_merit() checks again.
 *
 * Pure: tested in merit-form.test.ts.
 */

import type { MeritRules } from "./order-of-merit";

export type MeritDraft = { points: string; attendance: string; bestOf: string; includeTeam: boolean; startMonth: string };

export const toMeritDraft = (r: MeritRules): MeritDraft => ({
  points: r.points.join(", "),
  attendance: String(r.attendancePoints),
  bestOf: r.bestOf != null ? String(r.bestOf) : "",
  includeTeam: r.includeTeam,
  startMonth: String(r.seasonStartMonth),
});

/** The rules a draft stands for, or a message saying what's wrong with it. */
export function parseMeritDraft(d: MeritDraft): MeritRules | string {
  const parts = d.points.split(/[,\s]+/).filter(Boolean);
  const points = parts.map(Number);
  if (points.length === 0) return "Give points for at least 1st place.";
  if (points.some((p) => !Number.isInteger(p) || p < 0)) return "Points must be whole numbers, like 25, 20, 16.";
  if (points.length > 20) return "Points for between 1 and 20 places.";
  if (points.some((p) => p > 500)) return "Points are between 0 and 500.";
  const attendance = d.attendance.trim() === "" ? 0 : Number(d.attendance);
  if (!Number.isInteger(attendance) || attendance < 0) return "Attendance points must be a whole number.";
  if (attendance > 50) return "Points for playing are between 0 and 50.";
  const bestOf = d.bestOf.trim() === "" ? null : Number(d.bestOf);
  if (bestOf != null && (!Number.isInteger(bestOf) || bestOf < 1)) return "Best of must be a whole number, or blank for every event.";
  if (bestOf != null && bestOf > 60) return "Best of between 1 and 60 events.";
  const month = Number(d.startMonth);
  if (!Number.isInteger(month) || month < 1 || month > 12) return "Choose the month the season starts.";
  return { points, attendancePoints: attendance, bestOf, includeTeam: d.includeTeam, seasonStartMonth: month };
}
