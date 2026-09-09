// Shared shape for every admin moderation Server Action's useActionState
// result (src/app/admin/*/[id]/actions.ts). Kept in one place so the client
// form component (src/components/admin/moderation-form.tsx) can be generic
// over any of them, and so the six actions don't each redeclare an identical
// type.
export type ModerationState = { error?: string; success?: boolean };

// Every moderation action in this slice is gated to the same set of roles:
// `support` is read-only per the role model in admin-architecture-review.md
// §6 ("support — ... no destructive actions"), and `finance` has no reason to
// suspend a user or take down a listing/invite. Exported so each actions.ts
// file (and its tests) use the exact same list rather than three copies that
// could drift.
export const MODERATION_ROLES = ["moderator", "admin", "super_admin"] as const;

// Force-removal is the one listing action that isn't open to MODERATION_ROLES.
// hideListing() only accepts a listing that is currently "active" — the safe,
// everyday takedown. Force-removal deliberately ignores that guard and pulls a
// listing down from ANY state, including "reserved" and "sold", where a real
// transaction is attached. That's a bigger hammer than day-to-day moderation
// needs, so it sits with super_admin alone, the same way report redaction
// (src/app/admin/reports/[id]/actions.ts) and staff management do.
export const LISTING_REMOVAL_ROLES = ["super_admin"] as const;

/** Every value `listings.status` can hold — supabase/migrations/0035, constraint
 * `listings_status_check`. Duplicated from ListingStatus in src/lib/types.ts as
 * a runtime array because this module validates strings that came back from the
 * database, where a type alias buys nothing. */
export const LISTING_STATUSES = [
  "draft",
  "pending_review",
  "active",
  "reserved",
  "sold",
  "expired",
  "removed",
] as const;

export type ListingRemovalCheck =
  | { allowed: false; reason: string }
  | { allowed: true; warning: string | null };

/**
 * Whether a super-admin may force-remove a listing in `status`, and what they
 * should be told before they do.
 *
 * Pure and framework-free — no Supabase, no Next.js — so the decision can be
 * unit-tested directly and so the page and the Server Action reach the same
 * verdict from the same function rather than each re-deriving it. The action
 * is still the enforcement point: the page only uses this to decide what to
 * render.
 *
 * Only "removed" is refused, because the operation would be a no-op. Everything
 * else is permitted by design — the point of this action is to reach the
 * statuses hideListing() can't. "reserved" and "sold" are permitted but warned
 * about: the listing row is what disappears, while the order, its payment and
 * its snapshot columns (orders.listing_title et al, migration 0019) survive
 * untouched, so removing one hides the advert without rewriting sales history.
 */
export function checkListingForceRemoval(status: string): ListingRemovalCheck {
  if (status === "removed") {
    return { allowed: false, reason: "This listing is already removed." };
  }

  if (status === "reserved" || status === "sold") {
    return {
      allowed: true,
      warning:
        status === "sold"
          ? "This listing has sold. Removing it hides the advert; the order, its payment and its record in the ledger are unaffected."
          : "A sale is in progress on this listing. Removing it hides the advert and expires any open offers; the order itself is unaffected.",
    };
  }

  return { allowed: true, warning: null };
}

/**
 * The status a removed listing should go back to when it is restored.
 *
 * Restoring used to be hardcoded to "active", which was correct while
 * hideListing() was the only way in: it refuses anything that isn't already
 * active, so active is where it came from. Force-removal breaks that
 * assumption — a removed *draft* restored to "active" would publish a listing
 * its seller never submitted, and a removed *sold* listing restored to
 * "active" would put a sold item back on the market.
 *
 * So the previous status is read back out of the audit-log entry that recorded
 * the removal (`metadata.previousStatus`, written by both hideListing and
 * forceRemoveListing). The audit log is already this codebase's system of
 * record for listing moderation — migration 0009 makes it append-only, and the
 * detail page's "moderation history" reads the same rows — so no new column is
 * needed to carry it.
 *
 * Falls back to "active" for anything unrecognised: an entry from before this
 * function existed, a hand-written row, or a metadata shape that has drifted.
 * "active" is the safe default there because it is what every pre-existing
 * removal actually came from.
 */
export function resolveRestoreStatus(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "active";

  const previous = (metadata as Record<string, unknown>).previousStatus;
  if (typeof previous !== "string") return "active";

  // "removed" is excluded on purpose: restoring to it would leave the listing
  // exactly where it started and strand it with no way back.
  if (previous === "removed") return "active";

  return (LISTING_STATUSES as readonly string[]).includes(previous) ? previous : "active";
}
