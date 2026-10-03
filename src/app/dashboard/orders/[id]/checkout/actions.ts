"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { finishOfferCheckout } from "@/lib/marketplace-operations";
import type { DeliveryOption } from "@/lib/types";

export type CheckoutSubmitState = { error?: string };

/**
 * Submits the accepted-offer checkout page. The order already exists —
 * offer_action() (0048) created it, reserved and priced, when the offer was
 * accepted — so this only records the delivery choice, via
 * finalize_offer_checkout() (0050). Shared with the app's
 * /api/app/orders/[id]/checkout route through finishOfferCheckout()
 * (src/lib/marketplace-operations.ts).
 */
export async function submitOfferCheckout(
  orderId: number,
  deliveryMethod: DeliveryOption,
  addressId: number | null
): Promise<CheckoutSubmitState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const result = await finishOfferCheckout({ userId: user.id, orderId, deliveryMethod, addressId });
  if (!result.ok) return { error: result.message };

  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/orders");
  redirect(`/dashboard/orders/${orderId}`);
}
