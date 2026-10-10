import { supabase } from "./supabase";
import type { Club } from "./courses";

/**
 * Favourite clubs (0112): a star on any course; the Courses screen's
 * Favourites tab lists them. Private to the member (RLS). Direct to
 * Supabase — nobody is notified, the policies are the rule.
 */

const CLUB_SELECT = "id, name, slug, country, region, town, latitude, longitude, rating_count, rating_avg";

/** The member's favourite club ids. Empty (not an error) on a database without 0112. */
export async function favouriteClubIds(): Promise<Set<number>> {
  const { data, error } = await supabase.from("club_favourites").select("club_id").overrideTypes<{ club_id: number }[]>();
  if (error) return new Set();
  return new Set((data ?? []).map((r) => Number(r.club_id)));
}

/** The member's favourite clubs, most recently starred first. */
export async function favouriteClubs(): Promise<Club[]> {
  const { data, error } = await supabase
    .from("club_favourites")
    .select(`created_at, club:clubs ( ${CLUB_SELECT} )`)
    .order("created_at", { ascending: false })
    .overrideTypes<{ created_at: string; club: Club | null }[]>();
  if (error) throw error;
  return (data ?? []).map((r) => r.club).filter((c): c is Club => c != null);
}

export async function setFavouriteClub(clubId: number, on: boolean): Promise<void> {
  const { error } = on
    ? await supabase.from("club_favourites").insert({ club_id: clubId })
    : await supabase.from("club_favourites").delete().eq("club_id", clubId);
  // A double tap that inserts twice is still "starred".
  if (error && error.code !== "23505") throw new Error("Couldn't save that. Please try again.");
}
