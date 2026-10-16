import Link from "next/link";
import { cookies } from "next/headers";
import SignUpForm from "./signup-form";
import { AGE_BLOCK_COOKIE } from "./age-block";
import { UNDER_13_MESSAGE } from "@/lib/junior";

export default async function SignUpPage() {
  // Turned away as under 13 on this device in the last 24 hours (0159).
  const blocked = !!(await cookies()).get(AGE_BLOCK_COOKIE);

  return (
    <div>
      <div className="bg-navy-900 text-white pt-16 pb-14">
        <div className="max-w-6xl mx-auto px-6">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Join Pinpals
          </span>
          <h1 className="font-display font-bold text-4xl md:text-5xl mt-2.5">
            Tell us about your game.
          </h1>
          <p className="text-white/80 mt-3 max-w-[52ch]">
            Your email and a password is all it takes to get started — add your home club and
            handicap right after.
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 -mt-8 pb-20">
        <div className="bg-surface rounded-2xl shadow-lg p-8 md:p-10">
          {blocked ? (
            <p className="text-center text-ink-900 py-4">{UNDER_13_MESSAGE}</p>
          ) : (
            <>
              <SignUpForm />
              <p className="text-sm text-ink-500 text-center mt-5">
                Already on Pinpals?{" "}
                <Link href="/login" className="text-green-700 font-bold">
                  Log in →
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
