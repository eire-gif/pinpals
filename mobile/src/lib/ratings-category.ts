import { supabase } from "@/lib/supabase";

/**
 * Which course ratings a member plays off (0177): men's, women's, or prefer
 * not to say. Optional. Course ratings are set separately for men and women
 * even off the same tee ("Red" and "Red (Women)"), so with Mixed tees on the
 * draw puts each player on the right card by itself.
 *
 * Kept in its own table that only the member can read; the draw gets a
 * group's men's/women's answers from group_ratings_categories(), and only
 * when the person making the draw can put that group on cards.
 */
export type RatingsCategory = "men" | "women" | "not_said";

export const RATINGS_CHOICES: { value: RatingsCategory; label: string }[] = [
  { value: "men", label: "Men's" },
  { value: "women", label: "Women's" },
  { value: "not_said", label: "Prefer not to say" },
];

export const RATINGS_HINT =
  "Course ratings are set separately for men and women, even off the same tee. This puts you on the right ones when a society day has mixed tees. Only used for the draw — never shown on your profile.";

export async function loadMyRatingsCategory(userId: string): Promise<RatingsCategory | null> {
  const { data, error } = await supabase.from("member_ratings_category").select("category").eq("member_id", userId).maybeSingle<{ category: RatingsCategory }>();
  if (error) return null;
  return data?.category ?? null;
}

/** null clears the answer. */
export async function saveMyRatingsCategory(userId: string, category: RatingsCategory | null): Promise<void> {
  const { error } =
    category == null
      ? await supabase.from("member_ratings_category").delete().eq("member_id", userId)
      : await supabase
          .from("member_ratings_category")
          .upsert({ member_id: userId, category, updated_at: new Date().toISOString() }, { onConflict: "member_id" });
  if (error) throw new Error("Couldn't save that. Please try again.");
}

/** member id → men / women, for a group you can make the draw for. Empty otherwise. */
export async function loadGroupRatings(groupId: number): Promise<Map<string, "men" | "women">> {
  const { data, error } = await supabase.rpc("group_ratings_categories", { p_group_id: groupId });
  const out = new Map<string, "men" | "women">();
  if (error) return out;
  for (const r of (data ?? []) as { member_id: string; category: "men" | "women" }[]) out.set(r.member_id, r.category);
  return out;
}
