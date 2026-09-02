"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { MODERATION_ROLES, type ModerationState } from "@/lib/admin/moderation";

// "removed" — see supabase/migrations/0011_listings_status_check.sql — is the
// only status these two actions ever move a listing to/from. Restricting
// hide to listings that are currently "active" (not "reserved"/"sold", which
// mean a real transaction already happened) and restore to listings that are
// currently "removed" keeps the transition unambiguous rather than
// clobbering a status a completed sale set.

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
    metadata: error ? { error: error.message } : undefined,
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

  const { error } = await admin.from("listings").update({ status: "active" }).eq("id", listingId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "listing.restore",
    targetType: "listing",
    targetId: listingId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : undefined,
  });

  if (error) {
    return { error: "Couldn't restore this listing — please try again." };
  }

  revalidatePath(`/admin/listings/${listingId}`);
  revalidatePath("/admin/listings");
  return { success: true };
}
