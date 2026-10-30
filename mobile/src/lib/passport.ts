import { supabase } from "./supabase";
import { IRISH_LINKS_TRAIL, matchTrail, stampsFrom, type PassportClub, type Stamp } from "./passport-rules";

export * from "./passport-rules";

/**
 * Course Passport (claude/course-passport.md): loading. Everything here is
 * the member's own rows (scorecards, member_courses) plus the clubs
 * directory, which everyone can read — no migration needed.
 */

const CLUB = "id, name, country, region, latitude, longitude";

export type Passport = {
  stamps: Stamp[];
  bucket: PassportClub[];
  /** Trail entry key → directory club, for the entries found in the directory. */
  trail: Map<string, PassportClub>;
};

export async function loadPassport(userId: string): Promise<Passport> {
  const trailFilter = IRISH_LINKS_TRAIL.map((t) => `name.ilike."*${t.match.replace(/"/g, "")}*"`).join(",");
  const [cards, lists, trailClubs] = await Promise.all([
    supabase
      .from("scorecards")
      .select(`played_on, club:clubs ( ${CLUB} )`)
      .eq("member_id", userId)
      .not("club_id", "is", null)
      .order("played_on", { ascending: false })
      .limit(2000)
      .overrideTypes<{ played_on: string; club: PassportClub | null }[]>(),
    supabase
      .from("member_courses")
      .select(`kind, club:clubs ( ${CLUB} )`)
      .eq("member_id", userId)
      .overrideTypes<{ kind: "played" | "bucket"; club: PassportClub | null }[]>(),
    supabase.from("clubs").select(CLUB).or(trailFilter).limit(200).overrideTypes<PassportClub[]>(),
  ]);
  if (cards.error) throw new Error("Couldn't load your passport.");
  const rounds = (cards.data ?? []).filter((r) => r.club).map((r) => ({ club: r.club!, playedOn: r.played_on }));
  const ticked = (lists.data ?? []).filter((r) => r.kind === "played" && r.club).map((r) => r.club!);
  const bucket = (lists.data ?? []).filter((r) => r.kind === "bucket" && r.club).map((r) => r.club!);
  return {
    stamps: stampsFrom(rounds, ticked),
    bucket,
    trail: matchTrail(IRISH_LINKS_TRAIL, trailClubs.data ?? []),
  };
}
