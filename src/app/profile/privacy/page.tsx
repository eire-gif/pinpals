import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { myMobile } from "@/lib/member-phone";
import MobileForm from "./mobile-form";

export const metadata = { title: "Privacy & security · PinPals" };

/**
 * Privacy & security: your verified mobile, a copy of your data, and where
 * to go to delete your account. Sharing a mobile with a group is in the app,
 * where groups live.
 */
export default async function PrivacyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/profile/privacy");

  const mobile = await myMobile(supabase, user.id);

  return (
    <div className="max-w-xl mx-auto px-6 py-16 flex flex-col gap-6">
      <div>
        <Link href="/profile" className="text-sm text-ink-500 hover:text-ink-900">← Back to profile</Link>
        <h1 className="font-display font-bold text-3xl mt-3">Privacy &amp; security</h1>
      </div>

      <section className="bg-surface rounded-2xl shadow-lg p-7 grid gap-4">
        <h2 className="font-display font-bold text-xl">Your mobile</h2>
        {!mobile && (
          <p className="text-sm text-ink-700">
            Add your mobile so the captain or secretary of your society can reach you — only if you choose to share it, group by group, in the app.
          </p>
        )}
        <MobileForm current={mobile?.phone ?? null} />
      </section>

      <section className="bg-surface rounded-2xl shadow-lg p-7 grid gap-3">
        <h2 className="font-display font-bold text-xl">Your data</h2>
        <p className="text-sm text-ink-700">
          A copy of everything PinPals holds about you — profile, posts, messages you sent, listings, orders, rounds, groups — as a file (JSON) you can keep or take elsewhere.
        </p>
        <div>
          <a href="/profile/data/download" className="inline-block px-5 py-3 rounded-full font-bold border-[1.5px] border-green-700 text-green-700 hover:bg-green-50 transition">
            Download my data
          </a>
        </div>
        <p className="text-[13px] text-ink-500">
          Your handicap shows to others only while you switch it on in <Link href="/profile/edit" className="text-green-700 font-bold">Edit profile</Link>; your Golf Ireland number never does. Questions or corrections: privacy@pinpals.ie.
        </p>
      </section>

      <p className="text-center">
        <Link href="/profile/delete" className="text-sm text-ink-500 underline underline-offset-4 hover:text-red-600 transition">
          Delete your account
        </Link>
      </p>
    </div>
  );
}
