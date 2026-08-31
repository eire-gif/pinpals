import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { initials } from "@/lib/format";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
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

  const name = profile ? `${profile.first_name} ${profile.last_name}` : "Golfer";

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      {saved && (
        <div className="mb-6 bg-green-100 text-green-800 rounded-xl px-4 py-3 text-sm font-semibold">
          Profile saved.
        </div>
      )}
      <div className="bg-surface rounded-2xl shadow-lg p-8 text-center">
        <div
          className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center text-white font-display font-bold text-2xl"
          style={{ background: profile?.avatar_color ?? "#1f5c2e" }}
        >
          {initials(name)}
        </div>
        <h1 className="font-display font-bold text-2xl">{name}</h1>
        <p className="text-ink-500 mt-1">{user.email}</p>

        <div className="flex flex-wrap justify-center gap-2 mt-4">
          {profile?.home_club && (
            <span className="bg-cream-100 text-ink-900 text-xs font-bold px-3 py-1.5 rounded-full">
              {profile.home_club}
            </span>
          )}
          {profile?.county && (
            <span className="bg-cream-100 text-ink-900 text-xs font-bold px-3 py-1.5 rounded-full">
              {profile.county}
            </span>
          )}
          {profile?.handicap != null && (
            <span className="bg-red-100 text-red-600 text-xs font-bold px-3 py-1.5 rounded-full">
              {profile.handicap} hcp
            </span>
          )}
        </div>

        {profile?.bio && <p className="text-ink-700 mt-5">{profile.bio}</p>}

        {!profile?.home_club && (
          <p className="text-sm text-ink-500 mt-5">
            Add your home club and handicap so other golfers can find you in the directory.
          </p>
        )}

        <Link
          href="/profile/edit"
          className="inline-block mt-6 px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
        >
          Edit profile
        </Link>
      </div>
    </div>
  );
}
