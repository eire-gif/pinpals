"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getClubById } from "@/lib/courses";
import { isRegionInCountry } from "@/lib/regions";

export type SetHomeClubState = { error?: string; done?: boolean };

/**
 * "Set as my home club", from a course page.
 *
 * The shortest path there has ever been from finding a club to being findable
 * at it — previously this meant going to Edit profile and typing the club's
 * name into a combobox.
 *
 * It writes four columns, and it writes them from the club row rather than
 * from anything the browser sent: only the club's id crosses the wire, and
 * everything else is looked up here. A form field carrying the club's name or
 * country would be a field someone could change.
 */
export async function setHomeClub(
  _prev: SetHomeClubState,
  formData: FormData
): Promise<SetHomeClubState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const clubId = Number.parseInt(String(formData.get("clubId") ?? ""), 10);
  if (!Number.isFinite(clubId)) {
    return { error: "That club doesn't look right." };
  }

  const club = await getClubById(clubId);
  if (!club) {
    return { error: "We couldn't find that club." };
  }

  // The member's own county follows the club's region — but only when the
  // region is one the country actually offers. Imported regions come from
  // OpenStreetMap and are frequently missing; writing a null over a county
  // the member set themselves would be a silent downgrade, so an absent or
  // unrecognised region simply leaves `county` alone.
  const county =
    club.region && isRegionInCountry(club.country, club.region) ? { county: club.region } : {};

  const { error } = await supabase
    .from("profiles")
    .update({
      home_club_id: club.id,
      home_club: club.name,
      country: club.country,
      ...county,
    })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/courses/${club.country}/${club.slug}`);
  revalidatePath("/profile");
  revalidatePath("/community");

  return { done: true };
}
