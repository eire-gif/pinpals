import "server-only";
import { createAdminClient } from "./supabase/admin";

/**
 * Best-effort: links an existing conversation for this exact
 * (buyer, seller, listing) context to the order that context's purchase
 * just produced — see 0049_marketplace_messaging.sql's own header comment
 * on why this is opportunistic rather than transactional. Called from
 * buyNow() and offerAction()'s accept branch (src/app/marketplace/[id]/
 * actions.ts) right after each successfully creates an order — never
 * blocking, never surfaced to the caller as an error: a missed link only
 * means the thread doesn't show order context yet, not a failed purchase.
 *
 * Deliberately does NOT create a conversation if none exists — buyer and
 * seller may simply have never messaged about this listing (e.g. a straight
 * Buy Now with no prior negotiation), and inventing one on their behalf
 * would be a conversation neither party asked for.
 */
export async function linkConversationToOrder(params: {
  listingId: number;
  buyerId: string;
  sellerId: string;
  orderId: number;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("conversations")
      .update({ order_id: params.orderId })
      .eq("listing_id", params.listingId)
      .is("order_id", null)
      .or(
        `and(user_a_id.eq.${params.buyerId},user_b_id.eq.${params.sellerId}),and(user_a_id.eq.${params.sellerId},user_b_id.eq.${params.buyerId})`
      );
    if (error) {
      console.error(`Failed to link conversation to order ${params.orderId}:`, error.message);
    }
  } catch (err) {
    console.error(`Failed to link conversation to order ${params.orderId}:`, err instanceof Error ? err.message : err);
  }
}
