import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { StripeConnectedAccount } from "@/lib/types";
import ManageOnStripeButton from "./manage-on-stripe-button";

// Seller settings: the one place a member manages their Stripe-connected
// account once it exists — bank details, payout schedule, business/individual
// details. Deliberately just a link out to Stripe's own hosted account
// management (see actions.ts) rather than a Pinpals form for any of it; see
// /dashboard/payouts for starting/resuming onboarding itself, which this page
// links back to for anyone who hasn't gotten that far yet.
export default async function SellerSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/dashboard/payouts/settings");

  const { data: account } = await supabase
    .from("stripe_connected_accounts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle<StripeConnectedAccount>();

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <Link href="/dashboard/payouts" className="text-sm text-green-700 font-bold">
        &larr; Back to seller readiness
      </Link>

      <div className="mb-8 mt-4">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Selling on Pinpals
        </span>
        <h1 className="font-display font-bold text-3xl mt-2.5">Seller settings</h1>
        <p className="text-ink-500 mt-2">
          Bank details, payout schedule, and your business or individual details all live on Stripe&apos;s
          side — Pinpals never collects or stores them. Use the button below to manage them directly.
        </p>
      </div>

      <div className="bg-surface border border-line rounded-2xl shadow-lg p-8">
        {!account ? (
          <>
            <p className="text-sm text-ink-500 mb-6">
              You haven&apos;t set up payouts yet, so there&apos;s nothing to manage here yet.
            </p>
            <Link
              href="/dashboard/payouts"
              className="inline-block px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
            >
              Set up payouts with Stripe
            </Link>
          </>
        ) : !account.details_submitted ? (
          <>
            <p className="text-sm text-ink-500 mb-6">
              Finish onboarding first — once Stripe has your details, you&apos;ll be able to manage your
              bank account and other details here at any time.
            </p>
            <Link
              href="/dashboard/payouts"
              className="inline-block px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
            >
              Continue setup with Stripe
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-500 mb-6">
              This opens Stripe&apos;s own account management, in a new session with Stripe directly.
            </p>
            <ManageOnStripeButton />
          </>
        )}
      </div>
    </div>
  );
}
