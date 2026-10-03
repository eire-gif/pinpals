/**
 * The Tee times tab's filter sheet, applied to the rounds already loaded.
 * Pure — no Supabase — so it is tested on its own (tee-time-filters.test.ts).
 */

/** Local midnight: `new Date("2026-09-20")` is UTC and lands on the 19th
 *  in Ireland during summer time. */
const localDate = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  return new Date(y, m - 1, d);
};

// ---------------------------------------------------------------------------

export type TeeTimeWhen = "any" | "week" | "weekend";

export type TeeTimeFilters = {
  when: TeeTimeWhen;
  bookedOnly: boolean;
  ladiesOnly: boolean;
  /** Minimum spaces left: 1 shows everything. */
  minSpaces: 1 | 2 | 3;
};

export const DEFAULT_TEE_TIME_FILTERS: TeeTimeFilters = {
  when: "any",
  bookedOnly: false,
  ladiesOnly: false,
  minSpaces: 1,
};

export function activeTeeTimeFilterCount(f: TeeTimeFilters): number {
  return (f.when !== "any" ? 1 : 0) + (f.bookedOnly ? 1 : 0) + (f.ladiesOnly ? 1 : 0) + (f.minSpaces > 1 ? 1 : 0);
}

/** `today` is injectable for tests; local dates, as everywhere in this file. */
export function applyTeeTimeFilters<T extends { play_date: string; has_tee_time_booked: boolean; ladies_only: boolean; spaces_available: number }>(
  invites: T[],
  f: TeeTimeFilters,
  today: Date = new Date()
): T[] {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const weekEnd = new Date(start);
  weekEnd.setDate(start.getDate() + 6);
  // The coming Saturday and Sunday (today included if it is one).
  const toSat = (6 - start.getDay() + 7) % 7;
  const sat = new Date(start);
  sat.setDate(start.getDate() + (start.getDay() === 0 ? -1 : toSat));
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);

  return invites.filter((invite) => {
    const d = localDate(invite.play_date);
    if (f.when === "week" && (d < start || d > weekEnd)) return false;
    if (f.when === "weekend" && (d < sat || d > sun || d < start)) return false;
    if (f.bookedOnly && !invite.has_tee_time_booked) return false;
    if (f.ladiesOnly && !invite.ladies_only) return false;
    if (invite.spaces_available < f.minSpaces) return false;
    return true;
  });
}
