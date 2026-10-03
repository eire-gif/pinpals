import { postToSite } from "./api";
import { supabase } from "./supabase";

/**
 * Buying in the app: offers, bids, Buy now and choosing delivery.
 *
 * Reads go straight to Postgres under RLS — a buyer sees their own offers,
 * orders and addresses and nobody else's. Every write that moves a listing
 * towards money goes through the website's /api/app routes, which call the
 * same operations as the website's own forms
 * (src/lib/marketplace-operations.ts): offer_action(), validate_bid(),
 * create_purchase_order() and finalize_offer_checkout() decide everything,
 * and the figures shown here are display hints only. A stale screen can
 * only produce a polite refusal, never a wrong price.
 *
 * Addresses are the exception: they are written directly, because the
 * `addresses` policy (0050) lets a member write only their own and nothing
 * follows from saving one.
 *
 * Card payment itself is still Stripe's page on pinpals.ie, opened inside
 * the app — a native card sheet needs Stripe's iOS SDK, which is a new build.
 */

// ---------------------------------------------------------------------------
// Figures — mirrors of src/lib/marketplace.ts and src/lib/orders.ts
// ---------------------------------------------------------------------------

/** platform_fee_rate() (0051). Display only: the order snapshots the real one. */
export const PLATFORM_FEE_RATE = 0.07;
/** DELIVERY_FEE_EUR in src/lib/orders.ts. */
export const DELIVERY_FEE_EUR = 6;
/** prepare_and_validate_offer()'s floor (0048). */
export const MIN_OFFER_EUR = 1;

export type DeliveryMethod = "post" | "collection";

export const DELIVERY_LABELS: Record<DeliveryMethod, string> = {
  collection: "Collect in person",
  post: `Post (+€${DELIVERY_FEE_EUR.toFixed(2)})`,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function checkoutTotal(priceEur: number, method: DeliveryMethod) {
  const fee = round2(priceEur * PLATFORM_FEE_RATE);
  const delivery = method === "post" ? DELIVERY_FEE_EUR : 0;
  return { price: priceEur, fee, delivery, total: round2(priceEur + fee + delivery) };
}

export function offerTotal(amountEur: number) {
  const fee = round2(amountEur * PLATFORM_FEE_RATE);
  return { amount: amountEur, fee, total: round2(amountEur + fee) };
}

/** €12.50, €120 — cents only when there are some. */
export function eur(value: number): string {
  return `€${value.toLocaleString("en-IE", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** What a member typed into an amount box, as euro, or null. Accepts a
 *  comma for the decimal point because Irish keyboards offer one. */
export function parseEuro(text: string): number | null {
  const cleaned = text.replace(/[€\s]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Where the viewer stands with one listing
// ---------------------------------------------------------------------------

export type MyListingOffer = {
  id: number;
  status: "pending" | "countered" | "accepted" | "declined" | "withdrawn" | "expired";
  /** The live figure: the buyer's offer, or the seller's counter. */
  amountEur: number;
  originalAmountEur: number;
  expiresAt: string;
};

export type AuctionState = {
  id: number;
  currentBidCents: number | null;
  minimumNextBidCents: number;
  endsAt: string;
  ended: boolean;
  buyNowCents: number | null;
};

export type PurchaseState = {
  auction: AuctionState | null;
  /** The buyer's most recent offer on this listing, any status. */
  offer: MyListingOffer | null;
  /** An order of the viewer's on this listing still waiting to be
   *  completed — reserved for them, not yet paid. */
  openOrder: { id: number; checkoutDone: boolean; reservationExpiresAt: string | null } | null;
};

export async function loadPurchaseState(
  listingId: number,
  userId: string,
  saleType: string
): Promise<PurchaseState> {
  const auctionSale = saleType === "auction" || saleType === "auction_with_buy_now";

  const [offerResult, orderResult, auction] = await Promise.all([
    supabase
      .from("offers")
      .select("id, status, amount_eur, original_amount_eur, expires_at")
      .eq("listing_id", listingId)
      .eq("buyer_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .overrideTypes<
        {
          id: number;
          status: MyListingOffer["status"];
          amount_eur: number;
          original_amount_eur: number;
          expires_at: string;
        }[]
      >(),
    supabase
      .from("orders")
      .select("id, status, payment_status, checkout_completed_at, reservation_expires_at")
      .eq("listing_id", listingId)
      .eq("buyer_id", userId)
      .eq("status", "pending")
      .neq("payment_status", "paid")
      .order("created_at", { ascending: false })
      .limit(1)
      .overrideTypes<
        {
          id: number;
          status: string;
          payment_status: string;
          checkout_completed_at: string | null;
          reservation_expires_at: string | null;
        }[]
      >(),
    auctionSale ? loadAuction(listingId, saleType) : Promise.resolve(null),
  ]);

  const offer = offerResult.data?.[0];
  const order = orderResult.data?.[0];
  const orderLive =
    order && (!order.reservation_expires_at || new Date(order.reservation_expires_at).getTime() > Date.now());

  return {
    auction,
    offer: offer
      ? {
          id: offer.id,
          status: offer.status,
          amountEur: Number(offer.amount_eur),
          originalAmountEur: Number(offer.original_amount_eur),
          expiresAt: offer.expires_at,
        }
      : null,
    openOrder: orderLive
      ? { id: order.id, checkoutDone: !!order.checkout_completed_at, reservationExpiresAt: order.reservation_expires_at }
      : null,
  };
}

async function loadAuction(listingId: number, saleType: string): Promise<AuctionState | null> {
  const { data: auction } = await supabase
    .from("auctions")
    .select("id, starting_price_cents, min_increment_cents, buy_now_price_cents, ends_at, status")
    .eq("listing_id", listingId)
    .maybeSingle()
    .overrideTypes<{
      id: number;
      starting_price_cents: number;
      min_increment_cents: number;
      buy_now_price_cents: number | null;
      ends_at: string;
      status: string;
    }>();
  if (!auction) return null;

  // auction_bid_history (0045), never `bids`: a third party cannot read
  // `bids`, and the top bid would quietly read as "none".
  const { data: top } = await supabase
    .from("auction_bid_history")
    .select("amount_cents")
    .eq("auction_id", auction.id)
    .order("amount_cents", { ascending: false })
    .limit(1)
    .overrideTypes<{ amount_cents: number }[]>();

  const current = top?.[0]?.amount_cents ?? null;
  const ended =
    auction.status === "ended" || auction.status === "cancelled" || new Date(auction.ends_at).getTime() <= Date.now();

  return {
    id: auction.id,
    currentBidCents: current,
    // nextMinimumBidCents() in src/lib/marketplace.ts.
    minimumNextBidCents: current === null ? auction.starting_price_cents : current + auction.min_increment_cents,
    endsAt: auction.ends_at,
    ended,
    buyNowCents: saleType === "auction_with_buy_now" ? auction.buy_now_price_cents : null,
  };
}

// ---------------------------------------------------------------------------
// Writes, through the site
// ---------------------------------------------------------------------------

export const makeOffer = (listingId: number, amountEur: number) =>
  postToSite<{ ok: true }>(`/api/app/listings/${listingId}/offers`, { amount_eur: amountEur });

export const placeBid = (listingId: number, amountEur: number) =>
  postToSite<{ ok: true }>(`/api/app/listings/${listingId}/bids`, { amount_eur: amountEur });

export type OfferAction = "accept" | "decline" | "counter" | "withdraw";

export const respondToOffer = (offerId: number, action: OfferAction, counterAmountEur?: number) =>
  postToSite<{ listing_id: number; order_id: number | null }>(`/api/app/offers/${offerId}`, {
    action,
    ...(action === "counter" ? { counter_amount_eur: counterAmountEur } : {}),
  });

export const buyNow = (listingId: number, deliveryMethod: DeliveryMethod, addressId: number | null) =>
  postToSite<{ order_id: number }>(`/api/app/listings/${listingId}/buy`, {
    delivery_method: deliveryMethod,
    address_id: addressId,
  });

export const finishOfferCheckout = (orderId: number, deliveryMethod: DeliveryMethod, addressId: number | null) =>
  postToSite<{ order_id: number }>(`/api/app/orders/${orderId}/checkout`, {
    delivery_method: deliveryMethod,
    address_id: addressId,
  });

// ---------------------------------------------------------------------------
// Checkout: what is being bought, and where it is going
// ---------------------------------------------------------------------------

export type CheckoutItem = {
  /** Present when finishing an accepted offer's existing order. */
  orderId: number | null;
  listingId: number;
  title: string;
  imageUrl: string | null;
  sellerName: string;
  priceEur: number;
  deliveryOptions: DeliveryMethod[];
  collectionNotes: string | null;
  reservationExpiresAt: string | null;
};

type ListingRow = {
  id: number;
  title: string;
  image_url: string | null;
  seller_id: string;
  price_eur: number | null;
  sale_type: string;
  status: string;
  delivery_options: string[] | null;
  collection_notes: string | null;
};

const LISTING_COLUMNS = "id, title, image_url, seller_id, price_eur, sale_type, status, delivery_options, collection_notes";

const asMethods = (values: string[] | null): DeliveryMethod[] => {
  const methods = (values ?? []).filter((v): v is DeliveryMethod => v === "post" || v === "collection");
  return methods.length > 0 ? methods : ["collection"];
};

async function sellerName(sellerId: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", sellerId)
    .maybeSingle()
    .overrideTypes<{ first_name: string | null; last_name: string | null }>();
  return [data?.first_name, data?.last_name].filter(Boolean).join(" ") || "A PinPals member";
}

/** Buy now on a listing. Null when it cannot be bought right now. */
export async function loadBuyNowItem(listingId: number): Promise<CheckoutItem | null> {
  const { data: listing } = await supabase
    .from("listings")
    .select(LISTING_COLUMNS)
    .eq("id", listingId)
    .maybeSingle()
    .overrideTypes<ListingRow>();
  if (!listing || listing.status !== "active") return null;

  let priceEur = listing.price_eur;
  if (listing.sale_type === "auction_with_buy_now") {
    const auction = await loadAuction(listingId, listing.sale_type);
    if (!auction || auction.ended || auction.buyNowCents === null) return null;
    priceEur = auction.buyNowCents / 100;
  } else if (listing.sale_type === "auction") {
    return null;
  }
  if (priceEur === null) return null;

  return {
    orderId: null,
    listingId: listing.id,
    title: listing.title,
    imageUrl: listing.image_url,
    sellerName: await sellerName(listing.seller_id),
    priceEur: Number(priceEur),
    deliveryOptions: asMethods(listing.delivery_options),
    collectionNotes: listing.collection_notes,
    reservationExpiresAt: null,
  };
}

/** An accepted offer's order, waiting for the buyer to choose delivery. */
export async function loadOfferOrderItem(orderId: number): Promise<CheckoutItem | null> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, listing_id, amount_eur, status, checkout_completed_at, reservation_expires_at")
    .eq("id", orderId)
    .maybeSingle()
    .overrideTypes<{
      id: number;
      listing_id: number;
      amount_eur: number;
      status: string;
      checkout_completed_at: string | null;
      reservation_expires_at: string | null;
    }>();
  if (!order || order.status !== "pending" || order.checkout_completed_at) return null;

  const { data: listing } = await supabase
    .from("listings")
    .select(LISTING_COLUMNS)
    .eq("id", order.listing_id)
    .maybeSingle()
    .overrideTypes<ListingRow>();
  if (!listing) return null;

  return {
    orderId: order.id,
    listingId: listing.id,
    title: listing.title,
    imageUrl: listing.image_url,
    sellerName: await sellerName(listing.seller_id),
    priceEur: Number(order.amount_eur),
    deliveryOptions: asMethods(listing.delivery_options),
    collectionNotes: listing.collection_notes,
    reservationExpiresAt: order.reservation_expires_at,
  };
}

/** The order an accepted offer created, for the buyer. */
export async function orderForOffer(offerId: number): Promise<number | null> {
  const { data } = await supabase
    .from("orders")
    .select("id")
    .eq("offer_id", offerId)
    .maybeSingle()
    .overrideTypes<{ id: number }>();
  return data?.id ?? null;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export type Address = {
  id: number;
  label: string;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  county: string | null;
  eircode: string | null;
};

/** formatAddress() in src/lib/orders.ts — the same string the order keeps. */
export function addressLine(a: Address): string {
  let out = `${a.recipientName}, ${a.line1}`;
  if (a.line2) out += `, ${a.line2}`;
  out += `, ${a.city}`;
  if (a.county) out += `, ${a.county}`;
  if (a.eircode) out += ` ${a.eircode}`;
  return out;
}

export async function listAddresses(userId: string): Promise<Address[]> {
  const { data } = await supabase
    .from("addresses")
    .select("id, label, recipient_name, line1, line2, city, county, eircode")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .overrideTypes<
      {
        id: number;
        label: string;
        recipient_name: string;
        line1: string;
        line2: string | null;
        city: string;
        county: string | null;
        eircode: string | null;
      }[]
    >();
  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    recipientName: row.recipient_name,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    county: row.county,
    eircode: row.eircode,
  }));
}

/** ADDRESS_FIELD_LIMITS in src/lib/orders.ts, which mirror the CHECKs (0050). */
export const ADDRESS_LIMITS = {
  label: 60,
  recipientName: 120,
  line1: 200,
  line2: 200,
  city: 100,
  county: 100,
  eircode: 20,
} as const;

export type NewAddress = {
  label: string;
  recipientName: string;
  line1: string;
  line2: string;
  city: string;
  county: string;
  eircode: string;
};

/** The same checks createAddress() makes on the website, in the same words. */
export function addressProblem(a: NewAddress): string | null {
  if (!a.label.trim() || a.label.trim().length > ADDRESS_LIMITS.label) return "Give this address a short label.";
  if (!a.recipientName.trim() || a.recipientName.trim().length > ADDRESS_LIMITS.recipientName)
    return "Enter who this delivery is for.";
  if (!a.line1.trim() || a.line1.trim().length > ADDRESS_LIMITS.line1) return "Enter a street address.";
  if (!a.city.trim() || a.city.trim().length > ADDRESS_LIMITS.city) return "Enter a town or city.";
  if (a.line2.trim().length > ADDRESS_LIMITS.line2) return "That address line is too long.";
  if (a.county.trim().length > ADDRESS_LIMITS.county) return "That county is too long.";
  if (a.eircode.trim().length > ADDRESS_LIMITS.eircode) return "That Eircode is too long.";
  return null;
}

export async function addAddress(userId: string, a: NewAddress): Promise<Address> {
  const problem = addressProblem(a);
  if (problem) throw new Error(problem);
  const blank = (v: string) => (v.trim() ? v.trim() : null);
  const { data, error } = await supabase
    .from("addresses")
    .insert({
      user_id: userId,
      label: a.label.trim(),
      recipient_name: a.recipientName.trim(),
      line1: a.line1.trim(),
      line2: blank(a.line2),
      city: a.city.trim(),
      county: blank(a.county),
      eircode: blank(a.eircode),
    })
    .select("id")
    .single()
    .overrideTypes<{ id: number }>();
  if (error || !data) throw new Error("Couldn't save that address — please try again.");
  return {
    id: data.id,
    label: a.label.trim(),
    recipientName: a.recipientName.trim(),
    line1: a.line1.trim(),
    line2: blank(a.line2),
    city: a.city.trim(),
    county: blank(a.county),
    eircode: blank(a.eircode),
  };
}
