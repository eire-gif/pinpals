import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, StripeConnectedAccount } from "@/lib/types";
import {
  initials,
  formatJoinedDate,
  SELLER_ONBOARDING_STATUS_LABELS,
  SELLER_ONBOARDING_STATUS_STYLES,
} from "@/lib/format";
import { sellerOnboardingStatus, isSellerPaymentReady } from "@/lib/stripe/connect";
import { summarizeRatings, computeResponseRate } from "@/lib/marketplace";
// formatDateTime is a pure Intl formatter with no admin-specific behavior —
// reused here rather than duplicated. Everything else in that file is
// admin-console vocabulary this page has no business importing.
import { formatDateTime } from "@/lib/admin/format";
import StartOnboardingButton from "./start-onboarding-button";

export default async function PayoutsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/dashboard/payouts");

  // RLS scopes every one of these to the signed-in member's own rows (or, for
  // reviews, to public data anyway) — no service-role client needed for any
  // read on this page. See 0020_stripe_connected_accounts.sql's "Members can
  // view their own connected account" policy.
  const [{ data: profile }, { data: account }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle<Profile>(),
    supabase
      .from("stripe_connected_accounts")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle<StripeConnectedAccount>(),
  ]);

  const { data: reviewRows } = await supabase
    .from("reviews")
    .select("rating")
    .eq("reviewee_id", user.id)
    .returns<{ rating: number }[]>();
  const ratingSummary = summarizeRatings((reviewRows ?? []).map((r) => r.rating));

  // Response rate is derived from offers on THIS seller's own listings — a
  // seller with no listings yet has never had a chance to respond to
  // anything, so this is skipped rather than treated as a 0% rate.
  const { data: myListings } = await supabase
    .from("listings")
    .select("id")
    .eq("seller_id", user.id)
    .returns<{ id: number }[]>();
  const listingIds = (myListings ?? []).map((l) => l.id);

  let responseRate: number | null = null;
  if (listingIds.length > 0) {
    const { data: offerRows } = await supabase
      .from("offers")
      .select("status")
      .in("listing_id", listingIds)
      .returns<{ status: string }[]>();
    const total = offerRows?.length ?? 0;
    const responded = (offerRows ?? []).filter((o) => o.status !== "pending").length;
    responseRate = computeResponseRate(total, responded);
  }

  const status = sellerOnboardingStatus(account);
  const statusLabel = SELLER_ONBOARDING_STATUS_LABELS[status];
  const badgeStyle = SELLER_ONBOARDING_STATUS_STYLES[status];
  const paymentReady = isSellerPaymentReady(status);

  const name = profile ? `${profile.first_name} ${profile.last_name}` : "Golfer";
  const location = [profile?.home_club, profile?.county].filter(Boolean).join(" · ");

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Selling on Pinpals
        </span>
        <h1 className="font-display font-bold text-3xl mt-2.5">Seller readiness.</h1>
        <p className="text-ink-500 mt-2">
          Everything a buyer sees about you as a seller, plus what Stripe needs before a sale can be paid
          out to you. You&apos;ll fill in your own details — including any bank details — directly with
          Stripe, never in a Pinpals form.
        </p>
      </div>

      {/* Seller profile card */}
      <div className="bg-surface border border-line rounded-2xl shadow-lg p-8 mb-6">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-white font-display font-bold text-lg shrink-0"
            style={{ background: profile?.avatar_color ?? "#1f5c2e" }}
          >
            {initials(name)}
          </div>
          <div>
            <h2 className="font-display font-bold text-xl">{name}</h2>
            {location && <p className="text-sm text-ink-500">{location}</p>}
            {profile?.created_at && (
              <p className="text-xs text-ink-500">{formatJoinedDate(profile.created_at)}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {paymentReady && (
            <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs font-bold px-2.5 py-1 rounded-full">
              <CheckIcon /> Stripe-verified seller
            </span>
          )}
          <span className="bg-cream-100 text-ink-900 text-xs font-bold px-2.5 py-1 rounded-full">
            {ratingSummary ? `★ ${ratingSummary.average} (${ratingSummary.count} review${ratingSummary.count === 1 ? "" : "s"})` : "No reviews yet"}
          </span>
          <span className="bg-cream-100 text-ink-900 text-xs font-bold px-2.5 py-1 rounded-full">
            {responseRate == null ? "No offers yet" : `${responseRate}% response rate`}
          </span>
        </div>
      </div>

      {/* Onboarding status */}
      <div className="bg-surface border border-line rounded-2xl shadow-lg p-8">
        <div className="flex items-center justify-between gap-3 mb-1">
          <span className="text-xs uppercase tracking-wide text-ink-500 font-semibold">Onboarding status</span>
          <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${badgeStyle}`}>
            {statusLabel}
          </span>
        </div>

        {account ? (
          <>
            <p className="text-xs text-ink-500 mb-6">
              {account.last_synced_at
                ? `As reported by Stripe, last checked ${formatDateTime(account.last_synced_at)}.`
                : "Set up has started but Stripe hasn't reported a status yet."}
            </p>

            <dl className="grid grid-cols-3 gap-4 text-sm mb-6">
              <Field label="Identity & details" value={account.details_submitted ? "Submitted" : "Not yet"} />
              <Field label="Payment acceptance" value={account.charges_enabled ? "Enabled" : "Not yet"} />
              <Field label="Payout readiness" value={account.payouts_enabled ? "Enabled" : "Not yet"} />
            </dl>

            {account.requirements_currently_due.length > 0 && (
              <p className="text-xs text-ink-500 mb-4">
                Stripe still needs: {account.requirements_currently_due.join(", ")}
              </p>
            )}
            {account.requirements_past_due.length > 0 && (
              <p className="text-xs text-red-600 mb-4">
                Action required — past due: {account.requirements_past_due.join(", ")}
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              {!paymentReady && (
                <StartOnboardingButton label="Resume setup with Stripe" pendingLabel="Opening Stripe…" />
              )}
              {account.details_submitted && (
                <Link
                  href="/dashboard/payouts/settings"
                  className="px-5 py-3 rounded-full font-bold border-[1.5px] border-line text-ink-900 hover:bg-cream-100 transition"
                >
                  Seller settings
                </Link>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-500 mb-6">
              You haven&apos;t started payout setup yet. You can still save a listing as a draft, but it
              won&apos;t go live on the marketplace until this is done.
            </p>
            <StartOnboardingButton label="Set up payouts with Stripe" pendingLabel="Opening Stripe…" />
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-ink-500">{label}</div>
      <div className="font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
