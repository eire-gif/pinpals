import { postToSite } from "@/lib/api";
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
  /** Buyer Protection and the handover (0114). */
  fulfilmentStatus: FulfilmentStatus | null;
  payoutStatus: string;
  meetupAt: string | null;
  meetupPlace: string | null;
  trackingRef: string | null;
  releaseDueAt: string | null;
  releasedAt: string | null;
  /** The buyer's 4-digit code — only ever readable by the buyer (RLS). */
  handoverCode: string | null;
  /** The seller's home club, suggested as the meeting place. */
  sellerClub: string | null;
};

export type FulfilmentStatus = "awaiting_handover" | "awaiting_post" | "posted" | "received" | "completed" | "problem";

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
  fulfilment_status: FulfilmentStatus | null;
  payout_status: string;
  meetup_at: string | null;
  meetup_place: string | null;
  tracking_ref: string | null;
  release_due_at: string | null;
  released_at: string | null;
};

const COLUMNS =
  "id, buyer_id, seller_id, listing_title, listing_category, listing_condition, listing_image_url, amount_eur, platform_fee_eur, total_eur, refunded_amount_eur, status, payment_status, delivery_method, delivery_detail, created_at, checkout_completed_at, reservation_expires_at, fulfilment_status, payout_status, meetup_at, meetup_place, tracking_ref, release_due_at, released_at";

export async function loadOrder(orderId: number): Promise<OrderDetail | null> {
  const { data } = await supabase
    .from("orders")
    .select(COLUMNS)
    .eq("id", orderId)
    .maybeSingle<Row>();

  if (!data) return null;

  const [code, seller] = await Promise.all([
    data.fulfilment_status === "awaiting_handover"
      ? supabase.from("order_handover_codes").select("code").eq("order_id", orderId).maybeSingle<{ code: string }>()
      : Promise.resolve({ data: null }),
    data.fulfilment_status === "awaiting_handover"
      ? supabase.from("profiles").select("home_club").eq("id", data.seller_id).maybeSingle<{ home_club: string | null }>()
      : Promise.resolve({ data: null }),
  ]);

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
    fulfilmentStatus: data.fulfilment_status,
    payoutStatus: data.payout_status,
    meetupAt: data.meetup_at,
    meetupPlace: data.meetup_place,
    trackingRef: data.tracking_ref,
    releaseDueAt: data.release_due_at,
    releasedAt: data.released_at,
    handoverCode: code.data?.code ?? null,
    sellerClub: seller.data?.home_club ?? null,
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

/**
 * A Buyer Protection step (0114), through the site: arrange the meet-up,
 * enter the handover code, mark posted, confirm it arrived, report a
 * problem. The database decides who may take each one.
 */
export type HandoverStep =
  | { step: "meetup"; at: string; place: string }
  | { step: "code"; code: string }
  | { step: "posted"; tracking?: string | null }
  | { step: "received" }
  | { step: "problem"; category?: string; description?: string };

export function handoverStep(orderId: number, body: HandoverStep): Promise<{ ok: boolean; released: boolean }> {
  return postToSite(`/api/app/orders/${orderId}/handover`, body);
}
