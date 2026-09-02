import type { InterestStatus, InviteStatus } from "@/lib/types";
import { INTEREST_STATUS_LABELS, INTEREST_STATUS_STYLES, STATUS_LABELS, STATUS_STYLES } from "@/lib/tee-times";

// `Listing["status"]` and `Offer["status"]` aren't strict unions in
// src/lib/types.ts, so these are keyed loosely and `statusLabel`/
// `statusStyle` fall back gracefully for anything unexpected rather than
// throwing — an admin table should never break because a status value it
// doesn't recognise yet showed up.
export const LISTING_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  reserved: "Sale agreed",
  sold: "Sold",
  removed: "Removed by admin",
};

export const LISTING_STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  reserved: "bg-cream-100 text-ink-900",
  sold: "bg-cream-100 text-ink-500",
  removed: "bg-red-100 text-red-600",
};

export const OFFER_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
};

export const OFFER_STATUS_STYLES: Record<string, string> = {
  pending: "bg-cream-100 text-ink-900",
  accepted: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-600",
};

// Re-exported under admin-neutral names so admin pages have one place to
// import every status map from, without caring which ones happen to already
// live in src/lib/tee-times.ts.
export const INVITE_STATUS_LABELS: Record<InviteStatus, string> = STATUS_LABELS;
export const INVITE_STATUS_STYLES: Record<InviteStatus, string> = STATUS_STYLES;
export const INVITE_INTEREST_STATUS_LABELS: Record<InterestStatus, string> = INTEREST_STATUS_LABELS;
export const INVITE_INTEREST_STATUS_STYLES: Record<InterestStatus, string> = INTEREST_STATUS_STYLES;

const FALLBACK_STATUS_STYLE = "bg-cream-100 text-ink-900";

export function statusLabel(map: Record<string, string>, status: string): string {
  return map[status] ?? status;
}

export function statusStyle(map: Record<string, string>, status: string): string {
  return map[status] ?? FALLBACK_STATUS_STYLE;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function personName(person: { first_name: string; last_name: string } | null): string {
  if (!person) return "Unknown member";
  return `${person.first_name} ${person.last_name}`.trim();
}

/**
 * A member's seller status, computed from their own listings — there's no
 * separate seller-onboarding concept yet (no Stripe Connect; see
 * admin-architecture-review.md §8 Phase 5), so this is the honest summary
 * available today: whether they currently have anything for sale, have sold
 * before but nothing active now, or have never listed anything. Pure and
 * DB-free — takes whatever listings the caller already fetched rather than
 * querying anything itself.
 */
export function sellerStatusLabel(listings: { status: string }[]): string {
  if (listings.length === 0) return "Not selling — no listings";
  const activeCount = listings.filter((l) => l.status === "active" || l.status === "reserved").length;
  if (activeCount > 0) {
    return `Active seller — ${activeCount} live ${activeCount === 1 ? "listing" : "listings"}`;
  }
  return "Inactive seller — no active listings";
}
