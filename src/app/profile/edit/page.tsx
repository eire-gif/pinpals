import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import EditProfileForm from "./edit-profile-form";

export default async function EditProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { welcome } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  // Own row only, by that table's RLS — a member can always read their own
  // date of birth even though nobody else can (0059).
  const { data: birthdate } = await supabase
    .from("member_birthdates")
    .select("date_of_birth, age_range_visible")
    .eq("user_id", user.id)
    .maybeSingle<{ date_of_birth: string; age_range_visible: boolean }>();

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      {welcome && (
        <div className="mb-6 bg-green-100 text-green-800 rounded-xl px-4 py-3 text-sm font-semibold">
          Welcome to Pinpals! Fill in your home club and handicap so other golfers can find you.
        </div>
      )}
      <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
        <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Your profile
      </span>
      <h1 className="font-display font-bold text-3xl mt-2 mb-7">Set up your game.</h1>
      <div className="bg-surface rounded-2xl shadow-lg p-8">
        <EditProfileForm
          defaultValues={{
            first: profile?.first_name ?? "",
            last: profile?.last_name ?? "",
            club: profile?.home_club ?? "",
            county: profile?.county ?? "",
            handicap: profile?.handicap != null ? String(profile.handicap) : "",
            handicapVisible: profile?.handicap_visible ?? false,
            bio: profile?.bio ?? "",
            guiNumber: profile?.gui_membership_number ?? "",
            avatarUrl: profile?.avatar_url ?? null,
            dob: birthdate?.date_of_birth ?? "",
            ageRangeVisible: birthdate?.age_range_visible ?? false,
          }}
        />
      </div>
    </div>
  );
}
