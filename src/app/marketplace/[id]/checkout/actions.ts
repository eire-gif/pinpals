"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buyNow } from "@/lib/marketplace-operations";
import type { DeliveryOption } from "@/lib/types";

export type CheckoutSubmitState = { error?: string };

/**
 * Submits the Buy Now checkout page: the buyer has chosen a delivery method
 * and, if needed, an address — this is the one call that turns that choice
 * into a reserved order, via create_purchase_order() (0050). The rate limit,
 * the sweep, the RPC and the conversation link are in buyNow()
 * (src/lib/marketplace-operations.ts), which the app's
 * /api/app/listings/[id]/buy route calls too.
 */
export async function submitBuyNowCheckout(
  listingId: number,
  deliveryMethod: DeliveryOption,
  addressId: number | null
): Promise<CheckoutSubmitState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const result = await buyNow({ userId: user.id, listingId, deliveryMethod, addressId });
  if (!result.ok) return { error: result.message };

  revalidatePath(`/marketplace/${listingId}`);
  revalidatePath("/marketplace");
  redirect(`/dashboard/orders/${result.value.orderId}`);
}
