/**
 * Age bands for member profiles. Pure and framework-free — no Supabase, no
 * Next — so the boundary arithmetic below is directly unit-testable, the
 * same split as roles.ts vs authorization.ts and csv.ts vs export.ts.
 *
 * These bands mirror the CASE expression in `public.member_age_bands`
 * (supabase/migrations/0059_member_photos_and_age_bands.sql). That view is
 * what anyone other than the member themselves ever reads; this module
 * exists so a member's own profile page can show them their own band, and
 * so the edit form can preview it, without a round trip. If the bands ever
 * change, both have to change together — there is no way to derive one from
 * the other, and a mismatch would show a member one band while publishing
 * another.
 */

export const AGE_BANDS = ["Under 25", "25–34", "35–44", "45–54", "55–64", "65+"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Exclusive upper bound in whole years for each band except the last. */
const BAND_CEILINGS: readonly { readonly under: number; readonly band: AgeBand }[] = [
  { under: 25, band: "Under 25" },
  { under: 35, band: "25–34" },
  { under: 45, band: "35–44" },
  { under: 55, band: "45–54" },
  { under: 65, band: "55–64" },
];

/**
 * Completed years between two dates. Deliberately calendar-based rather than
 * `(now - dob) / 365.25 days`: someone born on 29 February is 25 on 1 March
 * of a non-leap year, and a milliseconds-divided-by-average-year-length
 * calculation gets that (and every ordinary birthday near a boundary) wrong
 * by a day in one direction or the other.
 */
export function ageInYears(dateOfBirth: Date, asOf: Date = new Date()): number {
  let age = asOf.getFullYear() - dateOfBirth.getFullYear();
  const monthDelta = asOf.getMonth() - dateOfBirth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getDate() < dateOfBirth.getDate())) {
    age -= 1;
  }
  return age;
}

/**
 * `null` for anything that isn't a usable date — an empty string, a garbled
 * value, or a date in the future. A future date is a typo (a 2062 birth
 * year, say), and showing "Under 25" for it would be worse than showing
 * nothing.
 *
 * Accepts a `YYYY-MM-DD` string (what a date input and Postgres both
 * produce) or a Date.
 */
export function ageBandForDate(dateOfBirth: string | Date | null | undefined, asOf: Date = new Date()): AgeBand | null {
  if (!dateOfBirth) return null;

  const dob =
    dateOfBirth instanceof Date
      ? dateOfBirth
      : // Parsed as UTC midnight by the Date constructor for this exact
        // format, which keeps the result stable regardless of the server's
        // own timezone — a date of birth has no time-of-day component and
        // shouldn't shift a day either way.
        new Date(`${dateOfBirth}T00:00:00Z`);

  if (Number.isNaN(dob.getTime())) return null;

  const age = ageInYears(dob, asOf);
  if (age < 0) return null;

  for (const { under, band } of BAND_CEILINGS) {
    if (age < under) return band;
  }
  return "65+";
}

/** What a tile shows when a member hasn't set a date, or has set one but
 * kept it private. Both cases are deliberately indistinguishable to anyone
 * else — see the view's own comment in 0059. */
export const AGE_BAND_NOT_SHARED = "Not shared";
