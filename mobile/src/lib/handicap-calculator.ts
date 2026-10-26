// Pure: tested in handicap-calculator.test.ts.
//
// The handicap calculator (Menu → Play → Handicap calculator, Oct 2026):
// which of a course's saved cards to list for men or women and 9 or 18
// holes, and each tee's course and playing handicap — from the same
// functions a round plays off (live-scoring.ts), so the calculator and the
// scorecard can never disagree.

import { courseHandicap, playingHandicap, type CourseHandicap } from "./live-scoring";

export type CalcCard = {
  teeName: string;
  holes: 9 | 18;
  courseRating: number | null;
  slope: number | null;
  parTotal: number | null;
};

export type CalcTee = {
  /** "Blue", "Green (Women)"… as on the card. */
  name: string;
  courseRating: number | null;
  slope: number | null;
  par: number | null;
  holes: 9 | 18;
};

export type CalcRow = CalcTee & { course: CourseHandicap; plays: number };

/** The directory names women's ratings "<tee> (Women)" (0177). */
export const isWomensTee = (teeName: string): boolean => /\(women\)\s*$/i.test(teeName);

/** A course's cards for one category and hole count, longest tees (highest rating) first, as Golf Ireland lists them. */
export function teesFor(cards: readonly CalcCard[], who: "men" | "women", holes: 9 | 18): CalcTee[] {
  return cards
    .filter((c) => c.holes === holes && isWomensTee(c.teeName) === (who === "women"))
    .map((c) => ({ name: c.teeName, courseRating: c.courseRating, slope: c.slope, par: c.parTotal, holes: c.holes }))
    .sort((a, b) => (b.courseRating ?? -1) - (a.courseRating ?? -1) || a.name.localeCompare(b.name));
}

/** One tee's figures for an index at an allowance (1 = 100%). */
export function calcRow(index: number, tee: CalcTee, allowance: number): CalcRow {
  const course = courseHandicap(index, { slope: tee.slope, courseRating: tee.courseRating, par: tee.par, holes: tee.holes });
  return { ...tee, course, plays: playingHandicap(course, allowance) };
}

/**
 * Typed-in tees (Enter manually): the numbers if they're plausible for the
 * holes chosen, else what's wrong. 9-hole ratings run about 30–40 and
 * 18-hole ones 60–80 — one in the other's place is the commonest mistake.
 */
export function manualTee(
  holes: 9 | 18,
  text: { slope: string; rating: string; par: string }
): { tee: CalcTee | null; problem: string | null } {
  const num = (t: string) => {
    const s = t.trim().replace(",", ".");
    return s === "" || !/^\d+(\.\d)?$/.test(s) ? null : Number(s);
  };
  const slope = num(text.slope);
  const rating = num(text.rating);
  const par = num(text.par);
  if (text.slope.trim() && (slope == null || !Number.isInteger(slope) || slope < 55 || slope > 155)) return { tee: null, problem: "Slope is a whole number from 55 to 155" };
  if (rating != null && holes === 9 && rating > 50) return { tee: null, problem: "That rating is for 18 holes — use the 9-hole rating off the card" };
  if (rating != null && holes === 18 && rating < 50) return { tee: null, problem: "That looks like a 9-hole rating — pick 9 holes, or use the 18-hole one" };
  if (text.par.trim() && (par == null || !Number.isInteger(par) || par < (holes === 9 ? 27 : 54) || par > (holes === 9 ? 40 : 80)))
    return { tee: null, problem: `Par for ${holes} holes looks wrong` };
  if (slope == null || rating == null || par == null) return { tee: null, problem: null };
  return { tee: { name: "Your tees", courseRating: rating, slope, par, holes }, problem: null };
}
