import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { LocationStep, GameStep } from "./onboarding-forms";

export const metadata: Metadata = { title: "Welcome to Pinpals" };

type Props = { searchParams: Promise<{ step?: string }> };

const STEPS = [
  { number: 1, label: "Where you play" },
  { number: 2, label: "Your game" },
  { number: 3, label: "Finishing touches" },
] as const;

/**
 * The three steps after email confirmation.
 *
 * ============ Why this exists rather than a longer sign-up form ============
 *
 * Pinpals launches with no members, so the sign-up form's job is to get
 * someone through it. Every optional field on that page is a chance to
 * close the tab, and none of club, county or handicap is needed to create
 * an account — only to be findable afterwards, which is a thing better
 * asked once the account exists and the member has something to lose by
 * abandoning it.
 *
 * ============ Why every step is skippable ============
 *
 * Because a member who skips still has an account, and an account is what
 * lets us ask again. A wizard that traps someone converts worse than one
 * that lets them out, and a profile filled in grudgingly with junk is
 * worse than an empty one in a directory people search by county.
 *
 * Home club and profile photo are deliberately NOT steps here. The club
 * picker is an autocomplete against the course directory and the photo is
 * an upload; both already exist, well built, on /profile/edit, and a
 * second implementation of either would be a second thing to keep correct.
 * Step 3 hands over to that page instead.
 */
export default async function OnboardingPage({ searchParams }: Props) {
  const { step: stepParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/onboarding");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, country, county, handicap, handicap_visible, home_club, avatar_url")
    .eq("id", user.id)
    .maybeSingle<{
      first_name: string;
      country: string | null;
      county: string | null;
      handicap: number | null;
      handicap_visible: boolean | null;
      home_club: string | null;
      avatar_url: string | null;
    }>();

  const parsed = Number.parseInt(stepParam ?? "1", 10);
  const step = parsed >= 1 && parsed <= 3 ? parsed : 1;

  return (
    <div>
      <div className="bg-navy-900 text-white pt-14 pb-12">
        <div className="max-w-lg mx-auto px-6">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Welcome
          </span>
          <h1 className="font-display font-bold text-3xl md:text-4xl mt-2.5">
            {profile?.first_name ? `You're in, ${profile.first_name}.` : "You're in."}
          </h1>
          <p className="text-white/80 mt-3">
            Three quick questions so other golfers can find you. Skip any of them.
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 -mt-6 pb-20">
        <div className="bg-surface rounded-2xl shadow-lg p-7 sm:p-9">
          {/* Progress */}
          <div className="flex items-center gap-2 mb-7">
            {STEPS.map((s) => (
              <div key={s.number} className="flex-1">
                <div
                  className={`h-1.5 rounded-full ${s.number <= step ? "bg-green-700" : "bg-line"}`}
                />
              </div>
            ))}
          </div>
          <p className="text-xs font-bold uppercase tracking-wider text-ink-500 mb-1">
            Step {step} of 3
          </p>
          <h2 className="font-display font-bold text-2xl mb-6">{STEPS[step - 1].label}</h2>

          {step === 1 && (
            <LocationStep
              initialCountry={profile?.country ?? ""}
              initialCounty={profile?.county ?? ""}
            />
          )}

          {step === 2 && (
            <GameStep
              initialHandicap={profile?.handicap != null ? String(profile.handicap) : ""}
              initialVisible={profile?.handicap_visible ?? false}
            />
          )}

          {step === 3 && (
            <div className="flex flex-col gap-5">
              <p className="text-[15px] leading-relaxed text-ink-900/90">
                That&rsquo;s the essentials done. Two things worth adding when you have a minute —
                both make a real difference to how many golfers get in touch:
              </p>

              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-3 bg-cream-50 border border-line rounded-xl p-4">
                  <span aria-hidden className="text-xl leading-none mt-0.5">⛳</span>
                  <div>
                    <p className="font-bold text-sm">
                      {profile?.home_club ? `Home club: ${profile.home_club}` : "Add your home club"}
                    </p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      Members browse by club as much as by county.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 bg-cream-50 border border-line rounded-xl p-4">
                  <span aria-hidden className="text-xl leading-none mt-0.5">📷</span>
                  <div>
                    <p className="font-bold text-sm">
                      {profile?.avatar_url ? "Photo added" : "Add a photo"}
                    </p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      You&rsquo;re asking a stranger to play eighteen holes with you. A face helps.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mt-1">
                {/* ?welcome=1 shows the "Welcome to Pinpals!" banner that
                    /profile/edit has always had. It was orphaned when
                    /auth/confirm started sending new members here instead of
                    straight there; handing the parameter on at this step is
                    what it was written for. */}
                <Link
                  href="/profile/edit?welcome=1"
                  className="px-6 py-3 rounded-full font-bold text-center bg-green-700 text-cream-50 hover:bg-green-600 transition"
                >
                  Finish my profile
                </Link>
                <Link
                  href="/dashboard"
                  className="px-6 py-3 rounded-full font-bold text-center border-[1.5px] border-line hover:border-green-600 transition"
                >
                  Go to my dashboard
                </Link>
              </div>
            </div>
          )}
        </div>

        {step < 3 && (
          <p className="text-sm text-ink-500 text-center mt-5">
            In a hurry?{" "}
            <Link href="/dashboard" className="text-green-700 font-bold">
              Skip all of this
            </Link>{" "}
            — you can fill it in from your profile any time.
          </p>
        )}
      </div>
    </div>
  );
}
