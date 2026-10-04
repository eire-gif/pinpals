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
};

export function emptyDraft(today: string): DetailsDraft {
  return {
    score: "", holes: "18", course_par: "", tee: "", played_on: today, differential: "",
    fairways_hit: "", fairways_total: "", gir: "", putts: "", birdies: "", best_hole: "", best_par: "", best_score: "",
    hole: "", par: "", yards: "", hole_score: "",
    shot_number: "", club: "", distance_yards: "", lie: "", result: "",
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

export function draftToDetails(kind: PostKind, d: DetailsDraft): RoundDetails | HoleDetails | ShotDetails | null {
  if (kind === "round") {
    const best =
      d.best_hole.trim() || d.best_score.trim()
        ? { hole: num(d.best_hole), par: num(d.best_par), score: num(d.best_score) }
        : undefined;
    return cleanDetails({
      score: num(d.score),
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
      best_hole: best,
    }) as unknown as RoundDetails;
  }
  if (kind === "hole") {
    return cleanDetails({
      hole: num(d.hole),
      par: num(d.par),
      yards: num(d.yards),
      score: num(d.hole_score),
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
  return kind === "general" ? null : detailsProblem(kind, draftToDetails(kind, d));
}
