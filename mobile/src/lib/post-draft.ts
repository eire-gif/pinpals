import { achievementProblem, eligibleAchievements, type AchievementType } from "./achievements";
import {
  cleanDetails,
  detailsProblem,
  type HoleDetails,
  type Lie,
  type PostKind,
  type RoundDetails,
  type ShotDetails,
} from "./post-details";

/**
 * The composer's golf fields as typed — strings, because that is what a
 * TextInput holds — and the one conversion from those strings to the details
 * a post stores. No React, so it runs in vitest (post-draft.test.ts).
 *
 * Blank means "not given": it is dropped, never stored as 0 or "".
 */
export type DetailsDraft = {
  // round
  score: string;
  holes: "18" | "9";
  course_par: string;
  tee: string;
  played_on: string;
  differential: string;
  fairways_hit: string;
  fairways_total: string;
  gir: string;
  putts: string;
  birdies: string;
  front_nine: string;
  back_nine: string;
  longest_drive: string;
  /** The played tee time a recap came from (0099); "" for a plain round. */
  tee_time_id: string;
  best_hole: string;
  best_par: string;
  best_score: string;
  // hole (score/hole/par shared with round's names where they mean the same)
  hole: string;
  par: string;
  yards: string;
  hole_score: string;
  // shot
  shot_number: string;
  club: string;
  distance_yards: string;
  lie: Lie | "";
  result: string;
  /** A claimed achievement (phase 8), "" for none. Only kept while the
   *  numbers support it — see claimableAchievements(). */
  achievement: string;
  /** The card hole by hole from a scorecard (0111), "pars|scores", or "".
   *  Not a field the member edits — scorecard-math.ts roundPostFields fills
   *  it, and it's dropped if the numbers above no longer agree with it. */
  hole_card: string;
};

export function emptyDraft(today: string): DetailsDraft {
  return {
    score: "", holes: "18", course_par: "", tee: "", played_on: today, differential: "",
    fairways_hit: "", fairways_total: "", gir: "", putts: "", birdies: "", front_nine: "", back_nine: "", longest_drive: "", tee_time_id: "", best_hole: "", best_par: "", best_score: "",
    hole: "", par: "", yards: "", hole_score: "",
    shot_number: "", club: "", distance_yards: "", lie: "", result: "", achievement: "", hole_card: "",
  };
}

/** A whole number, a decimal where allowed, or undefined when blank.
 *  Anything else becomes NaN, which cleanDetails drops — the number pad
 *  makes that rare, and the validator still sees what is left. */
function num(text: string): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

/**
 * hole_pars / hole_scores from a draft's hole_card, or nothing when they no
 * longer match the round as the member left it (changed the score, the par
 * or 9/18 after sharing from a scorecard) — the post then just goes without
 * the card rather than being refused.
 */
export function holeCardDetails(
  card: string,
  holes: 9 | 18,
  score: number | undefined,
  coursePar: number | undefined
): { hole_pars: number[]; hole_scores: number[] } | undefined {
  const [p, s] = card.split("|");
  if (!p || !s) return undefined;
  const pars = p.split(",").map(Number);
  const scores = s.split(",").map(Number);
  const ints = (xs: number[], lo: number, hi: number) => xs.every((x) => Number.isInteger(x) && x >= lo && x <= hi);
  if (pars.length !== holes || scores.length !== holes || !ints(pars, 3, 6) || !ints(scores, 1, 15)) return undefined;
  const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  if (score === undefined || total(scores) !== score) return undefined;
  if (coursePar !== undefined && total(pars) !== coursePar) return undefined;
  return { hole_pars: pars, hole_scores: scores };
}

export function draftToDetails(kind: PostKind, d: DetailsDraft): RoundDetails | HoleDetails | ShotDetails | null {
  if (kind === "round") {
    const best =
      d.best_hole.trim() || d.best_score.trim()
        ? { hole: num(d.best_hole), par: num(d.best_par), score: num(d.best_score) }
        : undefined;
    // Both nines and no total: the total is their sum (18 holes only).
    const front = num(d.front_nine);
    const back = d.holes === "9" ? undefined : num(d.back_nine);
    const score =
      num(d.score) ?? (front !== undefined && back !== undefined && !Number.isNaN(front + back) ? front + back : undefined);
    const card = d.hole_card ? holeCardDetails(d.hole_card, d.holes === "9" ? 9 : 18, score, num(d.course_par)) : undefined;
    return cleanDetails({
      score,
      holes: d.holes === "9" ? 9 : undefined,
      course_par: num(d.course_par),
      tee: d.tee,
      played_on: d.played_on,
      differential: num(d.differential),
      fairways_hit: num(d.fairways_hit),
      fairways_total: num(d.fairways_total),
      gir: num(d.gir),
      putts: num(d.putts),
      birdies: num(d.birdies),
      front_nine: num(d.front_nine),
      back_nine: d.holes === "9" ? undefined : num(d.back_nine),
      longest_drive: num(d.longest_drive),
      tee_time_id: num(d.tee_time_id),
      best_hole: best,
      achievement: d.achievement || undefined,
      hole_pars: card?.hole_pars,
      hole_scores: card?.hole_scores,
    }) as unknown as RoundDetails;
  }
  if (kind === "hole") {
    return cleanDetails({
      hole: num(d.hole),
      par: num(d.par),
      yards: num(d.yards),
      score: num(d.hole_score),
      club: d.club,
      achievement: d.achievement || undefined,
    }) as unknown as HoleDetails;
  }
  if (kind === "shot") {
    return cleanDetails({
      hole: num(d.hole),
      shot_number: num(d.shot_number),
      club: d.club,
      distance_yards: num(d.distance_yards),
      lie: d.lie || undefined,
      result: d.result,
    }) as unknown as ShotDetails;
  }
  return null;
}

/** The composer's verdict on its golf fields: null when they're fine. */
export function draftDetailsProblem(kind: PostKind, d: DetailsDraft): string | null {
  if (kind === "general") return null;
  const details = draftToDetails(kind, d);
  return detailsProblem(kind, details) ?? achievementProblem(kind, details);
}

/** The achievements the draft's numbers support right now (without any
 *  claim already made), most remarkable first. */
export function claimableAchievements(kind: PostKind, d: DetailsDraft): AchievementType[] {
  if (kind !== "round" && kind !== "hole") return [];
  return eligibleAchievements(kind, draftToDetails(kind, { ...d, achievement: "" }));
}
