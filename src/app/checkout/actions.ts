"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { ADDRESS_FIELD_LIMITS } from "@/lib/orders";

// Shared between the two checkout pages (marketplace/[id]/checkout and
// dashboard/orders/[id]/checkout) — a buyer picking a delivery address needs
// the exact same "add a new one inline" capability regardless of which
// purchase flow got them there, so this lives in its own namespace rather
// than being duplicated under either page.

export type AddressFormState = { error?: string; success?: boolean };

// By user id — a genuine buyer adds a handful of addresses ever, not dozens
// per session; sized to blunt a scripted insert-spam loop, same shape as
// every other per-user write limit in this app (e.g. CREATE_OFFER_MAX_ATTEMPTS).
const CREATE_ADDRESS_MAX_ATTEMPTS = 20;
const CREATE_ADDRESS_WINDOW_SECONDS = 60 * 60;

function trimmedOrNull(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Inserts a new saved address for the signed-in caller — a plain
 * authenticated insert, since `addresses`' own RLS (0050) already permits a
 * member to write only their own row (`with check (auth.uid() = user_id)`),
 * the same shape `profiles`' own insert/update/delete policies use. No
 * service-role client needed anywhere in this file: unlike orders (fully
 * locked down, every write behind a checked SECURITY DEFINER function), an
 * address is ordinary, non-financial data a member manages directly.
 */
export async function createAddress(_prev: AddressFormState, formData: FormData): Promise<AddressFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rateLimit = await checkRateLimit({
    action: "create-address",
    identifier: user.id,
    maxHits: CREATE_ADDRESS_MAX_ATTEMPTS,
    windowSeconds: CREATE_ADDRESS_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const label = trimmedOrNull(formData.get("label"));
  const recipientName = trimmedOrNull(formData.get("recipientName"));
  const line1 = trimmedOrNull(formData.get("line1"));
  const line2 = trimmedOrNull(formData.get("line2"));
  const city = trimmedOrNull(formData.get("city"));
  const county = trimmedOrNull(formData.get("county"));
  const eircode = trimmedOrNull(formData.get("eircode"));
  const phone = trimmedOrNull(formData.get("phone"));

  if (!label || label.length > ADDRESS_FIELD_LIMITS.label) return { error: "Give this address a short label." };
  if (!recipientName || recipientName.length > ADDRESS_FIELD_LIMITS.recipientName) {
    return { error: "Enter who this delivery is for." };
  }
  if (!line1 || line1.length > ADDRESS_FIELD_LIMITS.line1) return { error: "Enter a street address." };
  if (!city || city.length > ADDRESS_FIELD_LIMITS.city) return { error: "Enter a town or city." };
  if (line2 && line2.length > ADDRESS_FIELD_LIMITS.line2) return { error: "That address line is too long." };
  if (county && county.length > ADDRESS_FIELD_LIMITS.county) return { error: "That county is too long." };
  if (eircode && eircode.length > ADDRESS_FIELD_LIMITS.eircode) return { error: "That Eircode is too long." };
  if (phone && phone.length > ADDRESS_FIELD_LIMITS.phone) return { error: "That phone number is too long." };

  const { error } = await supabase.from("addresses").insert({
    user_id: user.id,
    label,
    recipient_name: recipientName,
    line1,
    line2,
    city,
    county,
    eircode,
    phone,
  });

  if (error) return { error: "Couldn't save that address — please try again." };

  revalidatePath("/marketplace", "layout");
  revalidatePath("/dashboard/orders", "layout");
  return { success: true };
}

/**
 * Deletes one of the caller's own saved addresses. `addresses`' own DELETE
 * policy (0050) already scopes this to `auth.uid() = user_id` — a mismatched
 * id (someone else's address, or one that doesn't exist) simply deletes
 * zero rows rather than erroring, so this never needs an explicit ownership
 * re-check the way a privileged/service-role write would.
 */
export async function deleteAddress(addressId: number): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("addresses").delete().eq("id", addressId);
  if (error) return { error: "Couldn't remove that address — please try again." };

  revalidatePath("/marketplace", "layout");
  revalidatePath("/dashboard/orders", "layout");
  return {};
}
