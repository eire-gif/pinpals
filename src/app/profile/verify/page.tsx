import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { myVerification } from "@/lib/verification/server";
import VerifyForm from "./verify-form";

export const metadata: Metadata = { title: "Get verified · PinPals" };

/** /profile/verify — the Verified golfer check (0188, claude/trust-and-safety.md). */
export default async function VerifyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/profile/verify");

  const [current, { data: profile }, { data: priv }] = await Promise.all([
    myVerification(supabase, user.id),
    supabase.from("profiles").select("home_club, home_club_id").eq("id", user.id).maybeSingle<{ home_club: string | null; home_club_id: number | null }>(),
    supabase.from("member_private").select("gui_membership_number").eq("member_id", user.id).maybeSingle<{ gui_membership_number: string | null }>(),
  ]);

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <Link href="/profile" className="text-sm font-bold text-green-700 hover:text-green-600">
        ← Your profile
      </Link>
      <h1 className="font-display font-bold text-3xl mt-4">Get verified</h1>
      <p className="text-ink-500 mt-2">
        A Verified golfer is a confirmed member of a golf club. The badge shows on your profile, your tee-time requests and
        your marketplace adverts, so hosts and buyers know you&apos;re genuine.
      </p>
      <div className="bg-surface rounded-2xl shadow-lg p-6 mt-8">
        <VerifyForm
          current={current}
          defaultNumber={priv?.gui_membership_number ?? ""}
          defaultClub={profile?.home_club ?? ""}
          defaultClubId={profile?.home_club_id ?? null}
        />
      </div>
    </div>
  );
}
