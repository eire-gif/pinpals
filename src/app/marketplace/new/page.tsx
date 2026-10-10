import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sellerOnboardingStatus, isSellerPaymentReady } from "@/lib/stripe/connect";
import type { StripeConnectedAccount } from "@/lib/types";
import NewListingForm from "./new-listing-form";

export default async function NewListingPage({ searchParams }: { searchParams: Promise<{ shop?: string }> }) {
  const { shop: asShop } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Carries the destination through login, so "List an item" from the
  // homepage or the nav doesn't dead-end on the dashboard.
  if (!user) redirect("/login?next=/marketplace/new");

  // Display-only, same as before — createListing() (./actions.ts) always
  // saves as a draft now regardless of payment readiness (publishing is
  // exclusively ../[id]/actions.ts's publishListing(), which does its own
  // authoritative re-check), so this is purely "does the seller need a
  // heads-up before they start filling in the form", not a gate on the
  // form itself.
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

  // ?shop=1 from the pro shop page: list new stock as the shop (0115).
  const { data: shop } = asShop
    ? await supabase
        .from("stores")
        .select("id, name")
        .eq("owner_id", user.id)
        .eq("status", "active")
        .maybeSingle<{ id: number; name: string }>()
    : { data: null };

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Marketplace
        </span>
        <h1 className="font-display font-bold text-3xl mt-2.5">{shop ? "List new stock." : "List an item for sale."}</h1>
        <p className="text-ink-500 mt-2">
          Add your photos and details, then save it as a draft — you&apos;ll get a chance to preview it and confirm
          before it goes live on the marketplace.
        </p>
        {!paymentReady && (
          <p className="text-sm text-ink-500 mt-3 bg-cream-100 rounded-xl px-4 py-3">
            <Link href="/dashboard/payouts" className="font-bold text-green-700">
              Finish seller setup
            </Link>{" "}
            with Stripe before you publish it — you can still put a draft together now.
          </p>
        )}
      </div>
      <div className="bg-surface rounded-2xl shadow-lg p-5 sm:p-8">
        <NewListingForm shop={shop} />
      </div>
    </div>
  );
}
