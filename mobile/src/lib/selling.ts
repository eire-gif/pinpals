import { getFromSite } from "@/lib/api";
import { supabase } from "@/lib/supabase";

/**
 * The seller's half of the marketplace, read for the app.
 *
 * Everything here goes through the member's own Supabase client, so RLS is
 * what scopes it — the same policies the website's /dashboard/selling reads
 * under. The one exception is the Stripe balance, which is not a row
 * anywhere: it is a live call with the platform's secret key, so it comes
 * from /api/app/payouts/balance instead. That is the whole reason the
 * endpoint exists.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. Nothing here writes. Accepting or
 * countering an offer, publishing a listing, and every step of Stripe
 * onboarding stay on the website, opened inside the app. Those are the
 * places money and money-adjacent state move, and offer_action() (0048) is
 * the one path a seller's response is ever written through — implementing a
 * second one in the app would be two state machines to keep in agreement,
 * for a screen whose job is mostly to tell you what is going on.
 */

// One page is deliberately generous compared with the website's 10: a phone
// scrolls, and a round trip on mobile data costs more than thirty extra rows.
const PAGE = 30;

// ---------------------------------------------------------------------------
// Listings and their performance
// ---------------------------------------------------------------------------

export type ListingPerformance = {
  id: number;
  title: string;
  priceEur: number | null;
  imageUrl: string | null;
  status: string;
  /**
   * How many people have saved this listing, or null if we could not find
   * out. Null is shown as nothing at all rather than as zero — see
   * favouriteCounts() below for why that distinction is load-bearing here.
   */
  favourites: number | null;
  /** Offers still waiting on the seller, or countered and waiting on the
   *  buyer. Anything terminal is not something to act on. */
  activeOffers: number;
  /** Set only for an auction listing. The current bid if there is one, the
   *  starting price if there is not. */
  currentBidCents: number | null;
  auctionStatus: string | null;
  auctionEndsAt: string | null;
};

type ListingRow = {
  id: number;
  title: string;
  price_eur: number | null;
  image_url: string | null;
  status: string;
};

type AuctionRow = {
  listing_id: number;
  starting_price_cents: number;
  winning_bid_id: number | null;
  status: string;
  ends_at: string;
};

export async function listingPerformance(userId: string): Promise<ListingPerformance[]> {
  const { data: listings } = await supabase
    .from("listings")
    .select("id, title, price_eur, image_url, status")
    .eq("seller_id", userId)
    .order("created_at", { ascending: false })
    .limit(PAGE)
    .returns<ListingRow[]>();

  const rows = listings ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);

  const [favouriteCount, offers, auctions] = await Promise.all([
    favouriteCounts(ids),
    supabase
      .from("offers")
      .select("listing_id")
      .in("listing_id", ids)
      .in("status", ["pending", "countered"]),
    supabase
      .from("auctions")
      .select("listing_id, starting_price_cents, winning_bid_id, status, ends_at")
      .in("listing_id", ids)
      .returns<AuctionRow[]>(),
  ]);

  const offerCount = tally(offers.data ?? []);
  const auctionByListing = new Map((auctions.data ?? []).map((a) => [a.listing_id, a]));

  // One query for every winning bid rather than one per auction.
  const winningIds = (auctions.data ?? [])
    .map((a) => a.winning_bid_id)
    .filter((id): id is number => id !== null);

  const bidAmount = new Map<number, number>();
  if (winningIds.length > 0) {
    const { data: bids } = await supabase
      .from("bids")
      .select("id, amount_cents")
      .in("id", winningIds)
      .returns<{ id: number; amount_cents: number }[]>();
    for (const bid of bids ?? []) bidAmount.set(bid.id, bid.amount_cents);
  }

  return rows.map((row) => {
    const auction = auctionByListing.get(row.id) ?? null;
    return {
      id: row.id,
      title: row.title,
      priceEur: row.price_eur,
      imageUrl: row.image_url,
      status: row.status,
      // `?? 0` only when the lookup succeeded: a listing nobody saved is
      // genuinely zero. A failed lookup gives null for every listing, above.
      favourites: favouriteCount === null ? null : favouriteCount.get(row.id) ?? 0,
      activeOffers: offerCount.get(row.id) ?? 0,
      currentBidCents: auction
        ? auction.winning_bid_id !== null
          ? bidAmount.get(auction.winning_bid_id) ?? auction.starting_price_cents
          : auction.starting_price_cents
        : null,
      auctionStatus: auction?.status ?? null,
      auctionEndsAt: auction?.ends_at ?? null,
    };
  });
}

/**
 * Save counts for the caller's own listings, via listing_favourite_counts()
 * (0085).
 *
 * WHY AN RPC AND NOT A COUNT QUERY. listing_favourites (0037) is readable
 * only by the member who saved the listing — correctly, since a wishlist is
 * private. So counting the table directly returns the seller's own saves and
 * nothing else, which is zero for every real listing. The website's own
 * "hearts" figure has been quietly wrong for exactly this reason since the
 * tab was written; 0085 adds a SECURITY DEFINER aggregate that returns
 * counts without returning who.
 *
 * Returns null, never zero, when the call fails. A member on an app build
 * that reached them before the migration reached production would otherwise
 * be told with total confidence that nobody has saved anything — and a wrong
 * number is worse than no number on the one screen a seller uses to judge
 * whether a listing is working.
 */
async function favouriteCounts(ids: number[]): Promise<Map<number, number> | null> {
  const { data, error } = await supabase.rpc("listing_favourite_counts", {
    p_listing_ids: ids,
  });

  // Cast rather than .returns<>(): the generated Database types predate this
  // function, same as inbox_unread_counts() in inbox.ts.
  const rows = data as { listing_id: number; favourites: number }[] | null;
  if (error || !rows) return null;

  return new Map(rows.map((row) => [row.listing_id, Number(row.favourites)]));
}

function tally(rows: { listing_id: number }[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.listing_id, (counts.get(row.listing_id) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Offers and auctions
// ---------------------------------------------------------------------------

export type IncomingOffer = {
  id: number;
  listingId: number;
  listingTitle: string;
  amountEur: number;
  status: "pending" | "countered";
  expiresAt: string;
};

export type LiveAuction = {
  listingId: number;
  listingTitle: string;
  imageUrl: string | null;
  currentBidCents: number;
  hasBid: boolean;
  status: string;
  endsAt: string;
};

type OfferJoin = {
  id: number;
  listing_id: number;
  amount_eur: number;
  status: "pending" | "countered";
  expires_at: string;
  listings: { title: string } | null;
};

type AuctionJoin = AuctionRow & {
  listings: { title: string; image_url: string | null } | null;
};

/**
 * Offers waiting on an answer, soonest deadline first — which is the order
 * they actually need dealing with, since offer_action() refuses a decision
 * once expires_at has passed.
 *
 * `listings!inner(...)` with the seller filter on the joined table is what
 * scopes this to the caller's own listings; RLS on `offers` alone would let
 * a buyer's own offers through too.
 */
export async function incomingOffers(userId: string): Promise<IncomingOffer[]> {
  const { data } = await supabase
    .from("offers")
    .select("id, listing_id, amount_eur, status, expires_at, listings!inner(title, seller_id)")
    .eq("listings.seller_id", userId)
    .in("status", ["pending", "countered"])
    .order("expires_at", { ascending: true })
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

export async function liveAuctions(userId: string): Promise<LiveAuction[]> {
  const { data } = await supabase
    .from("auctions")
    .select(
      "listing_id, starting_price_cents, winning_bid_id, status, ends_at, listings!inner(title, image_url, seller_id)"
    )
    .eq("listings.seller_id", userId)
    .in("status", ["live", "scheduled"])
    .order("ends_at", { ascending: true })
    .limit(PAGE)
    .returns<AuctionJoin[]>();

  const rows = data ?? [];
  const winningIds = rows.map((r) => r.winning_bid_id).filter((id): id is number => id !== null);

  const bidAmount = new Map<number, number>();
  if (winningIds.length > 0) {
    const { data: bids } = await supabase
      .from("bids")
      .select("id, amount_cents")
      .in("id", winningIds)
      .returns<{ id: number; amount_cents: number }[]>();
    for (const bid of bids ?? []) bidAmount.set(bid.id, bid.amount_cents);
  }

  return rows.map((row) => ({
    listingId: row.listing_id,
    listingTitle: row.listings?.title ?? "Listing",
    imageUrl: row.listings?.image_url ?? null,
    currentBidCents:
      row.winning_bid_id !== null
        ? bidAmount.get(row.winning_bid_id) ?? row.starting_price_cents
        : row.starting_price_cents,
    hasBid: row.winning_bid_id !== null,
    status: row.status,
    endsAt: row.ends_at,
  }));
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type SaleOrder = {
  id: number;
  title: string;
  imageUrl: string | null;
  totalEur: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  completedAt: string | null;
  createdAt: string;
  deliveryDetail: string | null;
};

export type OrderStatus = "pending" | "completed" | "cancelled" | "refunded";
export type PaymentStatus = "unpaid" | "pending" | "paid" | "failed" | "refunded";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  pending: "Pending",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};

type OrderRow = {
  id: number;
  listing_title: string;
  listing_image_url: string | null;
  total_eur: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  completed_at: string | null;
  created_at: string;
  delivery_detail: string | null;
};

const ORDER_COLUMNS =
  "id, listing_title, listing_image_url, total_eur, status, payment_status, completed_at, created_at, delivery_detail";

/**
 * Paid sales, oldest first.
 *
 * Note what this is NOT: a shrinking to-do list. There is no fulfilment or
 * shipment column on `orders` at all, so nothing can mark a sale as posted.
 * Every paid sale stays here, and the screen says so rather than implying a
 * queue that empties. The website's own tab carries the same caveat.
 */
export async function ordersNeedingAction(userId: string): Promise<SaleOrder[]> {
  const { data } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("seller_id", userId)
    .eq("status", "completed")
    .eq("payment_status", "paid")
    .order("completed_at", { ascending: true })
    .limit(PAGE)
    .returns<OrderRow[]>();

  return (data ?? []).map(toSaleOrder);
}

/** Every order on one of your listings, however it turned out — cancelled
 *  and refunded included, because a seller checking history wants those. */
export async function salesHistory(userId: string): Promise<SaleOrder[]> {
  const { data } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("seller_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE)
    .returns<OrderRow[]>();

  return (data ?? []).map(toSaleOrder);
}

function toSaleOrder(row: OrderRow): SaleOrder {
  return {
    id: row.id,
    title: row.listing_title,
    imageUrl: row.listing_image_url,
    totalEur: row.total_eur,
    status: row.status,
    paymentStatus: row.payment_status,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    deliveryDetail: row.delivery_detail,
  };
}

// ---------------------------------------------------------------------------
// Balance and payouts
// ---------------------------------------------------------------------------

export type SellerOnboardingStatus =
  | "not_started"
  | "requirements_due"
  | "pending"
  | "enabled"
  | "restricted";

export const ONBOARDING_LABELS: Record<SellerOnboardingStatus, string> = {
  not_started: "Not started",
  requirements_due: "Action needed",
  pending: "Under review",
  enabled: "Ready to sell",
  restricted: "Restricted",
};

export type ConnectedAccount = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsCurrentlyDue: string[];
  requirementsPastDue: string[];
  disabledReason: string | null;
};

/**
 * The same decision the website's sellerOnboardingStatus() makes, in the
 * same order, from the same columns.
 *
 * Duplicated rather than shared because the app cannot import from the Next
 * app's src/, and a six-colour package for one function would cost more than
 * it saves — the same call the theme file makes. If the website's version
 * changes, change this one: a seller told "Ready to sell" by the app and
 * "Action needed" by the site would rightly not trust either.
 */
export function onboardingStatus(account: ConnectedAccount | null): SellerOnboardingStatus {
  if (!account) return "not_started";

  // First and unconditionally. Stripe can leave charges_enabled true on an
  // account it has since restricted, so this cannot be checked later.
  if (account.disabledReason || account.requirementsPastDue.length > 0) return "restricted";
  if (account.requirementsCurrentlyDue.length > 0) return "requirements_due";
  if (account.chargesEnabled && account.payoutsEnabled) return "enabled";
  return account.detailsSubmitted ? "pending" : "not_started";
}

export type PayoutRow = {
  id: number;
  amountEur: number;
  status: "paid" | "pending" | "in_transit" | "canceled" | "failed";
  createdAt: string;
  failureMessage: string | null;
};

export const PAYOUT_STATUS_LABELS: Record<PayoutRow["status"], string> = {
  paid: "Paid",
  pending: "Pending",
  in_transit: "In transit",
  canceled: "Canceled",
  failed: "Failed",
};

export type Balance = { availableEur: number; pendingEur: number };

export type PayoutsView = {
  account: ConnectedAccount | null;
  status: SellerOnboardingStatus;
  payouts: PayoutRow[];
  /** Null when Stripe could not be reached. That is not an error state worth
   *  shouting about — it affects this screen and nothing else — so the
   *  balance box says so and the rest of the screen carries on. */
  balance: Balance | null;
};

type AccountRow = {
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements_currently_due: string[];
  requirements_past_due: string[];
  disabled_reason: string | null;
};

export async function loadPayouts(userId: string): Promise<PayoutsView> {
  const { data: accountRow } = await supabase
    .from("stripe_connected_accounts")
    .select(
      "charges_enabled, payouts_enabled, details_submitted, requirements_currently_due, requirements_past_due, disabled_reason"
    )
    .eq("user_id", userId)
    .maybeSingle<AccountRow>();

  const account: ConnectedAccount | null = accountRow
    ? {
        chargesEnabled: accountRow.charges_enabled,
        payoutsEnabled: accountRow.payouts_enabled,
        detailsSubmitted: accountRow.details_submitted,
        requirementsCurrentlyDue: accountRow.requirements_currently_due ?? [],
        requirementsPastDue: accountRow.requirements_past_due ?? [],
        disabledReason: accountRow.disabled_reason,
      }
    : null;

  // No account means no Stripe call to make and no payouts to find, so this
  // returns without either round trip.
  if (!account) {
    return { account: null, status: "not_started", payouts: [], balance: null };
  }

  const [payoutResult, balance] = await Promise.all([
    supabase
      .from("payouts")
      .select("id, amount_eur, status, stripe_created_at, failure_message")
      .eq("user_id", userId)
      .order("stripe_created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE)
      .returns<
        {
          id: number;
          amount_eur: number;
          status: PayoutRow["status"];
          stripe_created_at: string;
          failure_message: string | null;
        }[]
      >(),
    connectBalance(),
  ]);

  return {
    account,
    status: onboardingStatus(account),
    payouts: (payoutResult.data ?? []).map((row) => ({
      id: row.id,
      amountEur: row.amount_eur,
      status: row.status,
      createdAt: row.stripe_created_at,
      failureMessage: row.failure_message,
    })),
    balance,
  };
}

/** Never throws. The balance is decoration on a screen full of real rows;
 *  taking the screen down because Stripe was slow would be the wrong trade. */
export async function connectBalance(): Promise<Balance | null> {
  try {
    const result = await getFromSite<{ connected: boolean; balance: Balance | null }>(
      "/api/app/payouts/balance"
    );
    return result.balance;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

/** Euros, the way the site prints them. */
export function euro(amount: number): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function cents(value: number): string {
  return euro(value / 100);
}

/** "in 3 days", "in 4 hours", "ended" — enough for a deadline a seller is
 *  scanning, without a date library. */
export function timeRemaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "";
  if (ms <= 0) return "Ended";

  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min left`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? "1 hour left" : `${hours} hours left`;

  const days = Math.round(hours / 24);
  return `${days} days left`;
}

/** A short, unambiguous date. Intl rather than a hand-rolled format so a
 *  phone set to another locale still gets its own conventions. */
export function shortDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Stripe's own dispute vocabulary, as the website prints it. Shown on an
 * order only when there is a dispute at all, which is rare — and when there
 * is, "Won" and "Needs response" are very different news, so this carries
 * the distinction rather than flattening it to "there's a problem".
 */
export const DISPUTE_STATUS_LABELS: Record<string, string> = {
  warning_needs_response: "Needs response",
  warning_under_review: "Under review",
  warning_closed: "Closed",
  needs_response: "Needs response",
  under_review: "Under review",
  won: "Won",
  lost: "Lost",
  charge_refunded: "Charge refunded",
};
