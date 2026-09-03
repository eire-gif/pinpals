import type { StripeConnectedAccount } from "./types";

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function formatPrice(eur: number): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: eur % 1 === 0 ? 0 : 2,
  }).format(eur);
}

/**
 * A human-readable summary of a member's Stripe Connect payout readiness,
 * derived purely from the cached operational flags in
 * stripe_connected_accounts (see supabase/migrations/
 * 0020_stripe_connected_accounts.sql) — never a status Pinpals stores or
 * invents itself, so this function's output is display-only formatting of
 * what Stripe last reported, not a claim of current truth. `null` means no
 * row exists yet (onboarding never started).
 *
 * Lives here rather than src/lib/admin/format.ts because both
 * /dashboard/payouts (a member checking their own status) and
 * /admin/payouts (staff checking a seller's status) need it — everything
 * else in the admin file is admin-console-only vocabulary.
 */
export function sellerAccountStatusLabel(
  account: Pick<
    StripeConnectedAccount,
    "charges_enabled" | "payouts_enabled" | "details_submitted" | "requirements_past_due" | "requirements_currently_due"
  > | null
): string {
  if (!account) return "Not started";
  if (account.requirements_past_due.length > 0) return "Action required — requirements past due";
  if (account.payouts_enabled && account.charges_enabled) return "Payouts enabled";
  if (account.details_submitted) {
    return account.requirements_currently_due.length > 0
      ? "Under review — requirements due"
      : "Under review";
  }
  return "Onboarding incomplete";
}

// Styles keyed to sellerAccountStatusLabel()'s exact return values, meant to
// be used the same way src/lib/admin/format.ts's statusStyle() is (an
// unrecognised value falls back to a neutral style rather than breaking the
// page) even though this helper lives outside that file.
export const SELLER_ACCOUNT_STATUS_STYLES: Record<string, string> = {
  "Not started": "bg-cream-100 text-ink-500",
  "Onboarding incomplete": "bg-cream-100 text-ink-900",
  "Under review": "bg-cream-100 text-ink-900",
  "Under review — requirements due": "bg-gold-500/20 text-gold-700",
  "Action required — requirements past due": "bg-red-100 text-red-600",
  "Payouts enabled": "bg-green-100 text-green-800",
};
