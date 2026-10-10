"use server";

import { redirect } from "next/navigation";

import { isPromotionKind } from "@/lib/marketplace-growth";
import { startPromotionCheckout } from "@/lib/promotions-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Feature or bump one of your own listings (0115). The listing is re-read
 * under RLS and must be the caller's, active and a member's (not shop
 * stock); the price comes from PROMOTIONS, not the form. Then off to
 * Stripe Checkout — the webhook turns it on once paid.
 */
export async function startPromotionAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const listingId = Number(formData.get("listingId"));
  const kind = formData.get("kind");
  if (!Number.isInteger(listingId) || listingId <= 0 || !isPromotionKind(kind)) redirect("/dashboard/listings");

  const back = `/dashboard/listings/${listingId}/promote`;
  const limit = await checkRateLimit({ action: "promotion", identifier: user.id, maxHits: 10, windowSeconds: 60 * 60 });
  if (!limit.allowed) redirect(`${back}?error=busy`);

  const { data: listing } = await supabase
    .from("listings")
    .select("id, seller_id, title, status, store_id")
    .eq("id", listingId)
    .maybeSingle<{ id: number; seller_id: string; title: string; status: string; store_id: number | null }>();
  if (!listing || listing.seller_id !== user.id) redirect("/dashboard/listings");
  if (listing.status !== "active" || listing.store_id) redirect(`${back}?error=not_active`);

  let url: string;
  try {
    url = await startPromotionCheckout(createAdminClient(), {
      listingId,
      sellerId: user.id,
      kind,
      listingTitle: listing.title,
    });
  } catch (err) {
    console.error("promotion checkout failed:", err instanceof Error ? err.message : err);
    redirect(`${back}?error=stripe`);
  }
  redirect(url);
}
