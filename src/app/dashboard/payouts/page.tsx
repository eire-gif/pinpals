import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { StripeConnectedAccount } from "@/lib/types";
import { sellerAccountStatusLabel, SELLER_ACCOUNT_STATUS_STYLES } from "@/lib/format";
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

  // RLS scopes this to the signed-in member's own row — see
  // 0020_stripe_connected_accounts.sql's "Members can view their own
  // connected account" policy. No service-role client needed for this read.
  const { data: account } = await supabase
    .from("stripe_connected_accounts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle<StripeConnectedAccount>();

  const statusLabel = sellerAccountStatusLabel(account);
  const badgeStyle = SELLER_ACCOUNT_STATUS_STYLES[statusLabel] ?? "bg-cream-100 text-ink-900";
  const readyForPayouts = account?.payouts_enabled && account?.charges_enabled;

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Selling on Pinpals
        </span>
        <h1 className="font-display font-bold text-3xl mt-2.5">Get set up to receive payouts.</h1>
        <p className="text-ink-500 mt-2">
          Pinpals uses Stripe to pay sellers — you&apos;ll fill in your details directly with Stripe (including
          any bank details), never in a Pinpals form. This only covers getting your account ready; it
          doesn&apos;t affect your existing listings or offers.
        </p>
      </div>

      <div className="bg-surface border border-line rounded-2xl shadow-lg p-8">
        <div className="flex items-center justify-between gap-3 mb-1">
          <span className="text-xs uppercase tracking-wide text-ink-500 font-semibold">Payout account status</span>
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

            <dl className="grid grid-cols-2 gap-4 text-sm mb-6">
              <Field label="Details submitted" value={account.details_submitted ? "Yes" : "Not yet"} />
              <Field label="Charges enabled" value={account.charges_enabled ? "Yes" : "Not yet"} />
              <Field label="Payouts enabled" value={account.payouts_enabled ? "Yes" : "Not yet"} />
            </dl>

            {account.requirements_currently_due.length > 0 && (
              <p className="text-xs text-ink-500 mb-4">
                Stripe still needs: {account.requirements_currently_due.join(", ")}
              </p>
            )}

            {!readyForPayouts && (
              <StartOnboardingButton label="Resume setup with Stripe" pendingLabel="Opening Stripe…" />
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-ink-500 mb-6">
              You haven&apos;t started payout setup yet — you can still list items and receive offers, but
              you&apos;ll need this before a sale can be paid out to you.
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
