import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sellerOnboardingStatus, isSellerPaymentReady } from "@/lib/stripe/connect";
import type { StripeConnectedAccount } from "@/lib/types";
import NewListingForm from "./new-listing-form";

export default async function NewListingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Same readiness check actions.ts's createListing() re-does server-side
  // before actually inserting — this one is display-only, so the seller
  // knows what to expect before they fill in the form, not a security
  // boundary in itself.
  const { data: account } = await supabase
    .from("stripe_connected_accounts")
    .select("charges_enabled, payouts_enabled, details_submitted, requirements_currently_due, requirements_past_due, disabled_reason")
    .eq("user_id", user.id)
    .maybeSingle<
      Pick<
        StripeConnectedAccount,
        | "charges_enabled"
        | "payouts_enabled"
        | "details_submitted"
        | "requirements_currently_due"
        | "requirements_past_due"
        | "disabled_reason"
      >
    >();
  const paymentReady = isSellerPaymentReady(sellerOnboardingStatus(account));

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Marketplace
        </span>
        <h1 className="font-display font-bold text-3xl mt-2.5">List an item for sale.</h1>
        <p className="text-ink-500 mt-2">
          {paymentReady
            ? "Add a photo and a few details — your listing goes live on the marketplace right away."
            : "Add a photo and a few details — you can save it now, but it won't go live until you finish seller setup with Stripe."}
        </p>
        {!paymentReady && (
          <p className="text-sm text-ink-500 mt-3 bg-cream-100 rounded-xl px-4 py-3">
            <Link href="/dashboard/payouts" className="font-bold text-green-700">
              Finish seller setup
            </Link>{" "}
            first if you&apos;d like this listing to go live immediately.
          </p>
        )}
      </div>
      <div className="bg-surface rounded-2xl shadow-lg p-8">
        <NewListingForm />
      </div>
    </div>
  );
}
