import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { withPrivateDetails } from "@/lib/member-private";
import type { Profile } from "@/lib/types";
import EditProfileForm from "./edit-profile-form";
import DateOfBirthCard from "@/components/age/date-of-birth-card";

export default async function EditProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; discard_error?: string }>;
}) {
  const { welcome, discard_error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: shared } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();
  // Their own handicap and membership number — owner-only (0133).
  const profile = await withPrivateDetails(supabase, user.id, shared);

  // Own row only, by that table's RLS — a member can always read their own
  // date of birth even though nobody else can (0059).
  const { data: birthdate } = await supabase
    .from("member_birthdates")
    .select("date_of_birth, age_range_visible")
    .eq("user_id", user.id)
    .maybeSingle<{ date_of_birth: string; age_range_visible: boolean }>();

  const placeholderName = profile?.first_name === "New" && profile?.last_name === "Golfer";

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
      {/* Joined with Apple or Google (0193): no date of birth yet, and the
          account is held until there is one — so it comes first. */}
      {discard_error && (
        <p role="alert" className="mb-4 rounded-xl bg-red-100 text-red-600 text-sm font-semibold px-4 py-3">
          This account can&rsquo;t be removed here. To delete it, use Delete account in your profile.
        </p>
      )}
      {!birthdate && (
        <div className="mb-6">
          <DateOfBirthCard welcome={!!welcome} />
        </div>
      )}
      <div className="bg-surface rounded-2xl shadow-lg p-8">
        <EditProfileForm
          defaultValues={{
            // "New Golfer" is the stand-in for a provider that sent no name
            // (0193) — an empty box to fill beats a name to delete.
            first: placeholderName ? "" : (profile?.first_name ?? ""),
            last: placeholderName ? "" : (profile?.last_name ?? ""),
            club: profile?.home_club ?? "",
            clubId: profile?.home_club_id ?? null,
            // Falls back to Ireland for a member who joined before countries
            // existed and has no club to infer one from. Everyone on the site
            // at that point was Irish, and a preselected country the member
            // can change beats an empty select that blocks the club picker.
            country: profile?.country ?? "ireland",
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
