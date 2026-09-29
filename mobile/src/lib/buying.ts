import { supabase } from "@/lib/supabase";
import { euro, type OrderStatus, type PaymentStatus } from "@/lib/selling";

/**
 * The buyer's half of the marketplace.
 *
 * All reads, all RLS-scoped, and one write: a review, which is an ordinary
 * insert the database already polices. validate_review() (0041) decides
 * whether the order is completed and whether the reviewer was party to it,
 * so there is nothing for an API route to add — unlike an offer or a payment,
 * where the server has to do something the client cannot.
 *
 * Paying, finishing checkout and reporting a problem all open the website
 * inside the app. Payment runs in Stripe's own iframe; reporting writes to
 * `reports` with the admin client. Neither has an app-side version.
 */

const PAGE = 30;

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

export type Purchase = {
  id: number;
  title: string;
  imageUrl: string | null;
  totalEur: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  createdAt: string;
  /** What the buyer has to do next, or null when the ball is not in their
   *  court. Derived exactly as the website's buyerOrderNextAction() does. */
  nextAction: { label: string; path: string; deadlineIso: string | null } | null;
};

type OrderRow = {
  id: number;
  listing_title: string;
  listing_image_url: string | null;
  total_eur: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  created_at: string;
  checkout_completed_at: string | null;
  reservation_expires_at: string | null;
};

const ORDER_COLUMNS =
  "id, listing_title, listing_image_url, total_eur, status, payment_status, created_at, checkout_completed_at, reservation_expires_at";

/**
 * Kept deliberately identical to buyerOrderNextAction() in src/lib/orders.ts.
 *
 * A reservation that has already lapsed gets no action: the deadline has
 * passed, the order is going nowhere, and offering "Complete payment" on it
 * would send the member to a page that refuses them.
 */
function nextActionFor(row: OrderRow): Purchase["nextAction"] {
  if (row.status !== "pending" || row.payment_status === "paid") return null;

  const expiry = row.reservation_expires_at;
  if (expiry !== null && new Date(expiry).getTime() <= Date.now()) return null;

  if (!row.checkout_completed_at) {
    return {
      label: "Finish checkout",
      path: `/dashboard/orders/${row.id}/checkout`,
      deadlineIso: expiry,
    };
  }

  return {
    label: row.payment_status === "failed" ? "Try payment again" : "Complete payment",
    path: `/dashboard/orders/${row.id}`,
    deadlineIso: expiry,
  };
}

export async function listPurchases(userId: string): Promise<Purchase[]> {
  const { data } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("buyer_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE)
    .returns<OrderRow[]>();

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.listing_title,
    imageUrl: row.listing_image_url,
    totalEur: row.total_eur,
    status: row.status,
    paymentStatus: row.payment_status,
    createdAt: row.created_at,
    nextAction: nextActionFor(row),
  }));
}

// ---------------------------------------------------------------------------
// Offers and bids
// ---------------------------------------------------------------------------

export type MyOffer = {
  id: number;
  listingId: number;
  listingTitle: string;
  amountEur: number;
  status: string;
  expiresAt: string;
};

export type MyBid = {
  id: number;
  listingId: number;
  listingTitle: string;
  amountCents: number;
  createdAt: string;
  /** Whether this bid is the one currently winning its auction. */
  leading: boolean;
  auctionStatus: string;
  endsAt: string;
};

export const OFFER_STATUS_LABELS: Record<string, string> = {
  pending: "Waiting on the seller",
  countered: "Countered — your move",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

type OfferJoin = {
  id: number;
  listing_id: number;
  amount_eur: number;
  status: string;
  expires_at: string;
  listings: { title: string } | null;
};

export async function listMyOffers(userId: string): Promise<MyOffer[]> {
  const { data } = await supabase
    .from("offers")
    .select("id, listing_id, amount_eur, status, expires_at, listings (title)")
    .eq("buyer_id", userId)
    .order("created_at", { ascending: false })
    .limit(PAGE)
    .returns<OfferJoin[]>();

  return (data ?? []).map((row) => ({
    id: row.id,
    listingId: row.listing_id,
    listingTitle: row.listings?.title ?? "Listing",
    amountEur: row.amount_eur,
    status: row.status,
    expiresAt: row.expires_at,
  }));
}

type BidJoin = {
  id: number;
  auction_id: number;
  amount_cents: number;
  created_at: string;
  auctions: {
    listing_id: number;
    status: string;
    ends_at: string;
    winning_bid_id: number | null;
    listings: { title: string } | null;
  } | null;
};

/**
 * Your bids, newest first.
 *
 * `leading` compares this bid's id with the auction's winning_bid_id rather
 * than comparing amounts: the auction row is what actually decides, and a
 * higher number that lost a tie-break on time would otherwise be shown as
 * winning.
 */
export async function listMyBids(userId: string): Promise<MyBid[]> {
  const { data } = await supabase
    .from("bids")
    .select(
      "id, auction_id, amount_cents, created_at, auctions (listing_id, status, ends_at, winning_bid_id, listings (title))"
    )
    .eq("bidder_id", userId)
    .order("created_at", { ascending: false })
    .limit(PAGE)
    .returns<BidJoin[]>();

  return (data ?? [])
    .filter((row) => row.auctions !== null)
    .map((row) => ({
      id: row.id,
      listingId: row.auctions!.listing_id,
      listingTitle: row.auctions!.listings?.title ?? "Listing",
      amountCents: row.amount_cents,
      createdAt: row.created_at,
      leading: row.auctions!.winning_bid_id === row.id,
      auctionStatus: row.auctions!.status,
      endsAt: row.auctions!.ends_at,
    }));
}

// ---------------------------------------------------------------------------
// Saved items
// ---------------------------------------------------------------------------

export type SavedItem = {
  listingId: number;
  title: string;
  imageUrl: string | null;
  priceEur: number | null;
  status: string;
};

type FavouriteJoin = {
  listing_id: number;
  listings: {
    title: string;
    image_url: string | null;
    price_eur: number | null;
    status: string;
  } | null;
};

export async function listSaved(userId: string): Promise<SavedItem[]> {
  const { data } = await supabase
    .from("listing_favourites")
    .select("listing_id, listings (title, image_url, price_eur, status)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(PAGE)
    .returns<FavouriteJoin[]>();

  return (data ?? [])
    .filter((row) => row.listings !== null)
    .map((row) => ({
      listingId: row.listing_id,
      title: row.listings!.title,
      imageUrl: row.listings!.image_url,
      priceEur: row.listings!.price_eur,
      status: row.listings!.status,
    }));
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export type Reviewable = {
  orderId: number;
  sellerId: string;
  title: string;
  imageUrl: string | null;
  totalEur: number;
  /** Already left one. The row stays visible so a buyer can see they did it,
   *  rather than the order silently vanishing from the tab. */
  reviewed: boolean;
};

type CompletedRow = {
  id: number;
  seller_id: string;
  listing_title: string;
  listing_image_url: string | null;
  total_eur: number;
};

export async function listReviewable(userId: string): Promise<Reviewable[]> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, seller_id, listing_title, listing_image_url, total_eur")
    .eq("buyer_id", userId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(PAGE)
    .returns<CompletedRow[]>();

  const rows = orders ?? [];
  if (rows.length === 0) return [];

  const { data: reviews } = await supabase
    .from("reviews")
    .select("order_id")
    .eq("reviewer_id", userId)
    .in(
      "order_id",
      rows.map((row) => row.id)
    )
    .returns<{ order_id: number }[]>();

  const reviewed = new Set((reviews ?? []).map((row) => row.order_id));

  return rows.map((row) => ({
    orderId: row.id,
    sellerId: row.seller_id,
    title: row.listing_title,
    imageUrl: row.listing_image_url,
    totalEur: row.total_eur,
    reviewed: reviewed.has(row.id),
  }));
}

/**
 * Leave a review.
 *
 * A plain insert on purpose. validate_review() (0041) is what decides whether
 * the order is completed and whether the reviewer was party to it, and the
 * unique index is what stops a second one — so an API route in front of this
 * would add a second opinion and nothing else. The two checks below exist
 * only so an obvious mistake reads as a sentence instead of a constraint
 * violation.
 *
 * Returns an error string rather than throwing, because every outcome here is
 * something to show the member in place.
 */
export async function submitReview(
  orderId: number,
  revieweeId: string,
  rating: number,
  body: string
): Promise<string | null> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return "Choose a rating between 1 and 5 stars.";
  }
  const trimmed = body.trim();
  if (trimmed.length > 2000) {
    return "Reviews can be at most 2000 characters.";
  }

  const { error } = await supabase.from("reviews").insert({
    order_id: orderId,
    reviewer_id: (await supabase.auth.getUser()).data.user?.id,
    reviewee_id: revieweeId,
    rating,
    body: trimmed || null,
  });

  if (!error) return null;
  if (error.code === "23505") return "You've already reviewed this order.";
  return "Couldn't submit that review. The order has to be completed, and it has to be yours.";
}

// ---------------------------------------------------------------------------

/** "2 days left", "4 hours left", "Expired" — for a reservation or an offer
 *  deadline, where the number of hours is the thing that matters. */
export function deadlineLabel(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "Expired";

  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? "1 hour left" : `${hours} hours left`;
  return `${Math.round(hours / 24)} days left`;
}

export { euro };
