// Pure: tested in mixed-tees.test.ts.
//
// Mixed tees (0176): some players in a day off other tees — ladies off the
// reds and men off the whites, say. Each player's course handicap comes from
// their own tee's rating, slope and par; with "Adjust for the different
// tees" on, the World Handicap System (Rule 6.2b) adds the difference in par
// between their tees and the day's. PinPals' course handicap already includes
// course rating minus par, so the par difference is all that's left to even
// up. Everyone is scored on the day's one card.

import { courseHandicap, type CourseHandicap } from "./live-scoring";

export type TeeSet = {
  name: string;
  courseRating: number | null;
  slope: number | null;
  par: number | null;
};

export type PlayerTees = CourseHandicap & {
  /** Their own tees, when not the day's; null on the day's tees. */
  teeName: string | null;
  /** Shots for the difference in par (+ more, − fewer); 0 on the day's tees or with the adjustment off. */
  extra: number;
};

/** A player's course handicap off their tees, and the adjustment for the difference in par. */
export function playerTees(index: number, day: TeeSet, own: TeeSet | null, adjust: boolean): PlayerTees {
  const tees = own ?? day;
  const ch = courseHandicap(index, { slope: tees.slope, courseRating: tees.courseRating, par: tees.par });
  const extra = own && adjust && own.par != null && day.par != null ? own.par - day.par : 0;
  return { ...ch, teeName: own ? own.name : null, extra };
}

/** "+2 for the Red tees", "1 fewer off the Blue tees", or null when there's no difference. */
export function extraLabel(extra: number, teeName: string): string | null {
  if (extra === 0) return null;
  const n = Math.abs(extra);
  return extra > 0 ? `${n} extra ${n === 1 ? "shot" : "shots"} off the ${teeName} tees` : `${n} ${n === 1 ? "shot" : "shots"} fewer off the ${teeName} tees`;
}
