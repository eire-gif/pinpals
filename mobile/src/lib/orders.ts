import { supabase } from "@/lib/supabase";
import type { OrderStatus, PaymentStatus } from "@/lib/selling";

/**
 * One order, read from either side of it.
 *
 * RLS on `orders` already scopes this to the buyer and the seller, so there
 * is no ownership check here — a member asking for somebody else's order id
 * simply gets nothing back, which is the correct answer and the one the
 * screen shows.
 *
 * Nothing here writes. Paying is a Stripe iframe and reporting a problem
 * inserts into `reports` with the admin client; both open the website inside
 * the app.
 */

export type OrderDetail = {
  id: number;
  buyerId: string;
  sellerId: string;
  title: string;
  category: string | null;
  condition: string | null;
  imageUrl: string | null;
  amountEur: number;
  platformFeeEur: number;
  totalEur: number;
  refundedAmountEur: number | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  deliveryMethod: "collection" | "post" | null;
  deliveryDetail: string | null;
  createdAt: string;
  checkoutCompletedAt: string | null;
  reservationExpiresAt: string | null;
  /**
   * Stripe's own dispute status for this order, or null for the normal case
   * of no dispute at all. Carried through as the raw value rather than
   * reduced to a boolean, because "Won" and "Needs response" are not the same
   * news and the website already labels them separately.
   */
  disputeStatus: string | null;
};

type Row = {
  id: number;
  buyer_id: string;
  seller_id: string;
  listing_title: string;
  listing_category: string | null;
  listing_condition: string | null;
  listing_image_url: string | null;
  amount_eur: number;
  platform_fee_eur: number;
  total_eur: number;
  refunded_amount_eur: number | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
  delivery_method: "collection" | "post" | null;
  delivery_detail: string | null;
  created_at: string;
  checkout_completed_at: string | null;
  reservation_expires_at: string | null;
};

const COLUMNS =
  "id, buyer_id, seller_id, listing_title, listing_category, listing_condition, listing_image_url, amount_eur, platform_fee_eur, total_eur, refunded_amount_eur, status, payment_status, delivery_method, delivery_detail, created_at, checkout_completed_at, reservation_expires_at";

export async function loadOrder(orderId: number): Promise<OrderDetail | null> {
  const { data } = await supabase
    .from("orders")
    .select(COLUMNS)
    .eq("id", orderId)
    .maybeSingle<Row>();

  if (!data) return null;

  return {
    id: data.id,
    buyerId: data.buyer_id,
    sellerId: data.seller_id,
    title: data.listing_title,
    category: data.listing_category,
    condition: data.listing_condition,
    imageUrl: data.listing_image_url,
    amountEur: data.amount_eur,
    platformFeeEur: data.platform_fee_eur,
    totalEur: data.total_eur,
    refundedAmountEur: data.refunded_amount_eur,
    status: data.status,
    paymentStatus: data.payment_status,
    deliveryMethod: data.delivery_method,
    deliveryDetail: data.delivery_detail,
    createdAt: data.created_at,
    checkoutCompletedAt: data.checkout_completed_at,
    reservationExpiresAt: data.reservation_expires_at,
    disputeStatus: data.payment_status === "paid" ? await disputeStatusFor(orderId) : null,
  };
}

/**
 * get_order_dispute_status() (0055) — asked only for a paid order, the same
 * condition the website's own detail page uses.
 *
 * It returns `text`, not a row set: the scalar is the most recent dispute's
 * status, or null when there is none. Failure is treated as null rather than
 * surfaced — this is one badge, and an order page that refused to render
 * because an RPC was slow would be a worse outcome than a missing badge.
 */
async function disputeStatusFor(orderId: number): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_order_dispute_status", {
    p_order_id: orderId,
  });

  if (error) return null;
  return typeof data === "string" && data.length > 0 ? data : null;
}
