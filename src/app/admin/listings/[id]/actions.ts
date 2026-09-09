"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import {
  LISTING_REMOVAL_ROLES,
  MODERATION_ROLES,
  checkListingForceRemoval,
  resolveRestoreStatus,
  type ModerationState,
} from "@/lib/admin/moderation";

// "removed" — see supabase/migrations/0011_listings_status_check.sql — is the
// only status these actions ever move a listing to/from. Restricting hide to
// listings that are currently "active" (not "reserved"/"sold", which mean a
// real transaction already happened) and restore to listings that are
// currently "removed" keeps the transition unambiguous rather than
// clobbering a status a completed sale set.
//
// forceRemoveListing() below is the deliberate exception, and the reason
// restore no longer hardcodes "active" — see resolveRestoreStatus().

export async function hideListing(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const listingId = Number(formData.get("listingId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!listingId || Number.isNaN(listingId)) return { error: "Missing listing id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { data: listing } = await admin.from("listings").select("status").eq("id", listingId).maybeSingle();
  if (!listing) return { error: "Listing not found." };
  if (listing.status !== "active") {
    return { error: `Only active listings can be hidden (this one is "${listing.status}").` };
  }

  const { error } = await admin.from("listings").update({ status: "removed" }).eq("id", listingId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "listing.hide",
    targetType: "listing",
    targetId: listingId,
    reason,
    outcome: error ? "failure" : "success",
    // previousStatus/newStatus, not just the error, so the listing detail
    // page's "moderation history" section can show a before → after trail
    // even on the success path, not only when something went wrong.
    metadata: error ? { error: error.message } : { previousStatus: listing.status, newStatus: "removed" },
  });

  if (error) {
    return { error: "Couldn't hide this listing — please try again." };
  }

  revalidatePath(`/admin/listings/${listingId}`);
  revalidatePath("/admin/listings");
  return { success: true };
}

export async function restoreListing(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const listingId = Number(formData.get("listingId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!listingId || Number.isNaN(listingId)) return { error: "Missing listing id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { data: listing } = await admin.from("listings").select("status").eq("id", listingId).maybeSingle();
  if (!listing) return { error: "Listing not found." };
  if (listing.status !== "removed") {
    return { error: `Only hidden listings can be restored (this one is "${listing.status}").` };
  }

  // Where to put it back. Not a constant "active" any more: forceRemoveListing
  // can take a draft or a sold listing down, and restoring either of those to
  // "active" would publish something that was never published or re-list
  // something already paid for. The removal's own audit entry carries the
  // status it came from.
  const { data: lastRemoval } = await admin
    .from("admin_audit_log")
    .select("metadata")
    .eq("target_type", "listing")
    .eq("target_id", String(listingId))
    .in("action", ["listing.hide", "listing.force_remove"])
    .eq("outcome", "success")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ metadata: unknown }>();

  const restoreTo = resolveRestoreStatus(lastRemoval?.metadata);

  const { error } = await admin.from("listings").update({ status: restoreTo }).eq("id", listingId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "listing.restore",
    targetType: "listing",
    targetId: listingId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { previousStatus: listing.status, newStatus: restoreTo },
  });

  if (error) {
    return { error: "Couldn't restore this listing — please try again." };
  }

  revalidatePath(`/admin/listings/${listingId}`);
  revalidatePath("/admin/listings");
  return { success: true };
}

/**
 * Take a listing down from any status — the super-admin override.
 *
 * hideListing() covers the everyday case and refuses anything that isn't
 * currently "active", which leaves five statuses with no takedown at all:
 * draft, pending_review, reserved, sold and expired. Abandoned drafts and
 * junk test rows sit in the first two; a listing that needs pulling after a
 * sale has been agreed sits in the next two. This is the way to reach them.
 *
 * Same destination as hideListing (status = 'removed'), and restore is still
 * the way back, so nothing here is one-way: no row is deleted, and the
 * offers, bids, images, reports and audit history attached to the listing are
 * all left intact. The only difference from hideListing is which statuses it
 * will start from, and who is allowed to press it.
 *
 * Two database-level things happen as a side effect of the status change, both
 * of them desirable and neither of them this action's doing:
 *   - listings_invalidate_offers_on_unavailable (migration 0048) expires every
 *     pending/countered offer and notifies each buyer — but only when the
 *     listing was "active". Removing a draft notifies nobody, correctly.
 *   - listings_validate_status_transition (migration 0045) would reject most
 *     of these transitions for an ordinary seller. It bypasses for the
 *     service-role client this action uses, which is exactly the override
 *     being exercised here.
 */
export async function forceRemoveListing(
  _prev: ModerationState,
  formData: FormData
): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: LISTING_REMOVAL_ROLES });
  const listingId = Number(formData.get("listingId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!listingId || Number.isNaN(listingId)) return { error: "Missing listing id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { data: listing } = await admin
    .from("listings")
    .select("status")
    .eq("id", listingId)
    .maybeSingle<{ status: string }>();
  if (!listing) return { error: "Listing not found." };

  // Re-checked here rather than trusted from the page: the status can have
  // moved between the render and the submit, and a Server Action is a public
  // endpoint regardless of which buttons were drawn.
  const check = checkListingForceRemoval(listing.status);
  if (!check.allowed) return { error: check.reason };

  const { error } = await admin.from("listings").update({ status: "removed" }).eq("id", listingId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "listing.force_remove",
    targetType: "listing",
    targetId: listingId,
    reason,
    outcome: error ? "failure" : "success",
    // previousStatus is what restoreListing() reads back to decide where the
    // listing goes if this is ever undone — see resolveRestoreStatus().
    metadata: error ? { error: error.message } : { previousStatus: listing.status, newStatus: "removed" },
  });

  if (error) {
    return { error: "Couldn't remove this listing — please try again." };
  }

  revalidatePath(`/admin/listings/${listingId}`);
  revalidatePath("/admin/listings");
  revalidatePath("/marketplace");
  return { success: true };
}
