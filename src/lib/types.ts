export type Profile = {
  id: string;
  first_name: string;
  last_name: string;
  home_club: string | null;
  county: string | null;
  handicap: number | null;
  handicap_visible: boolean;
  bio: string | null;
  avatar_color: string | null;
  gui_membership_number: string | null;
  created_at: string;
};

// ============ LISTINGS ============
// price_eur/category/condition/status were left as plain `string` when this
// type was first written (0003) and stay that way here for the fields that
// predate strict typing elsewhere in this file — narrowing them now would
// touch every existing read site for no behavioural change. The fields added
// by supabase/migrations/0046_listing_creation_workflow.sql (this phase) get
// proper unions from the start, matching how every other newer table in this
// file (Offer, Order, Refund, ...) is typed.

export type ListingStatus =
  | "draft"
  | "pending_review"
  | "active"
  | "reserved"
  | "sold"
  | "expired"
  | "removed";

export type SaleType = "fixed_price" | "offers_allowed" | "auction" | "auction_with_buy_now";

export type DeliveryOption = "post" | "collection";

export type Listing = {
  id: number;
  seller_id: string;
  title: string;
  description: string | null;
  /** Nullable since 0046: an auction-type listing carries no listing-level
   * price at all — its price lives entirely on its `auctions` row (see that
   * migration's header comment). Always non-null for every other sale_type. */
  price_eur: number | null;
  category: string;
  subcategory: string | null;
  condition: string;
  county: string | null;
  image_url: string | null;
  status: ListingStatus;
  sale_type: SaleType;
  /** Integer cents mirror of price_eur, additive since 0046 — kept in sync
   * by the create/edit actions, same nullability rule as price_eur above. */
  price_cents: number | null;
  /** Always 'eur' today (DB-enforced) — carried alongside price_cents so a
   * future non-EUR listing needs no schema change, same pattern as
   * orders.currency/auctions.currency. */
  currency: string;
  delivery_options: DeliveryOption[];
  collection_notes: string | null;
  created_at: string;
  updated_at: string;
};

// listing_images (0036) — a listing's ordered photo gallery. `position`
// controls display order; the lowest position is the cover image. See
// supabase/migrations/0046_listing_creation_workflow.sql's
// enforce_listing_image_limit() trigger for the max-images-per-listing cap
// (mirrored client-side by MAX_LISTING_IMAGES in src/lib/marketplace.ts).
export type ListingImage = {
  id: number;
  listing_id: number;
  image_url: string;
  position: number;
  created_at: string;
};

// ============ AUCTIONS & BIDS ============
// See supabase/migrations/0039_auctions_and_bids.sql (table shape) and
// 0046_listing_creation_workflow.sql (min_increment_cents, edit-lock
// triggers). Status is system-controlled only — see 0039's header comment —
// so there is no seller-facing "set status" action to type against here.

export type AuctionStatus = "scheduled" | "live" | "ended" | "cancelled";

export type Auction = {
  id: number;
  listing_id: number;
  starting_price_cents: number;
  reserve_price_cents: number | null;
  buy_now_price_cents: number | null;
  min_increment_cents: number;
  currency: string;
  starts_at: string;
  ends_at: string;
  status: AuctionStatus;
  winning_bid_id: number | null;
  created_at: string;
  updated_at: string;
};

export type Bid = {
  id: number;
  auction_id: number;
  bidder_id: string;
  amount_cents: number;
  currency: string;
  created_at: string;
};

// See supabase/migrations/0048_marketplace_offer_workflow.sql. Single-round
// negotiation: 'pending' (buyer's ask, awaiting the seller) -> the seller
// accepts/declines/'countered' (awaiting the buyer) -> the buyer
// accepts/declines. 'withdrawn' only ever applies to a 'pending' offer (the
// buyer pulling their own ask before the seller responds); 'expired' covers
// both a lapsed deadline and the listing becoming unavailable out from under
// the offer (see that migration's own header comment on why one status
// covers both).
export type OfferStatus = "pending" | "countered" | "accepted" | "declined" | "withdrawn" | "expired";

export type Offer = {
  id: number;
  listing_id: number;
  buyer_id: string;
  /** The amount currently "on the table" — the buyer's original ask until a
   * counter happens, then the counter amount from that point on. See
   * original_amount_eur for the buyer's unchanging initial ask. */
  amount_eur: number;
  /** The buyer's initial ask, set once at creation and never mutated —
   * original_amount_eur/amount_eur only ever differ once status is
   * 'countered' (or something terminal reached from a countered offer). */
  original_amount_eur: number;
  status: OfferStatus;
  /** When the side whose turn it currently is (the seller for 'pending', the
   * buyer for 'countered') needs to act by — offer_action() (the migration
   * above) refuses to act on a 'pending'/'countered' offer past this instant
   * even before expire_stale_offers() has swept its status column to match. */
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type InviteStatus = "open" | "full" | "cancelled" | "completed";

export type TeeTimeInvite = {
  id: number;
  member_id: string;
  club_name: string;
  county: string | null;
  play_date: string;
  time_from: string | null;
  time_to: string | null;
  exact_tee_time: string | null;
  spaces_available: number;
  has_tee_time_booked: boolean;
  handicap_limit: number | null;
  notes: string | null;
  status: InviteStatus;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

// What the browse page shows about the host — never their email or any
// other auth data, just the same public fields the community directory uses.
// handicap only ever renders on a card when handicap_visible is true.
export type InviteHost = Pick<
  Profile,
  "first_name" | "last_name" | "home_club" | "avatar_color" | "handicap" | "handicap_visible"
>;

export type TeeTimeInviteWithHost = TeeTimeInvite & { profiles: InviteHost | null };

// ============ TEE-TIME INTERESTS ("I'm interested") ============

export type InterestStatus = "pending" | "accepted" | "confirmed" | "declined";

export type TeeTimeInterest = {
  id: number;
  invite_id: number;
  member_id: string;
  status: InterestStatus;
  created_at: string;
  updated_at: string;
};

// What a host sees about someone interested in their invite — again, never
// email or any other auth data.
export type InterestApplicant = Pick<
  Profile,
  "first_name" | "home_club" | "handicap" | "handicap_visible" | "avatar_color"
>;

export type InterestWithDetails = TeeTimeInterest & {
  profiles: InterestApplicant | null;
  tee_time_invites: Pick<TeeTimeInvite, "id" | "club_name" | "play_date"> | null;
};

export type MyTeeTimeRequest = TeeTimeInterest & {
  tee_time_invites: Pick<
    TeeTimeInvite,
    | "id"
    | "club_name"
    | "play_date"
    | "time_from"
    | "time_to"
    | "exact_tee_time"
    | "has_tee_time_booked"
    | "status"
  > | null;
};

// What the browse page needs to know about the current member's own
// interest in each invite, so it can swap the button for a status.
export type MyInterest = Pick<TeeTimeInterest, "invite_id" | "status">;

// ============ MEMBER CONNECTIONS ============

export type ConnectionStatus = "pending" | "accepted" | "declined";

export type Connection = {
  id: number;
  requester_id: string;
  recipient_id: string;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
};

export type ConnectionProfile = Pick<
  Profile,
  "id" | "first_name" | "last_name" | "home_club" | "county" | "handicap" | "handicap_visible" | "avatar_color"
>;

export type ConnectionWithProfiles = Connection & {
  requester: ConnectionProfile | null;
  recipient: ConnectionProfile | null;
};

// ============ ORDERS ============
// See supabase/migrations/0019_orders.sql. Created by buyNow() directly, or
// by offer_action()'s (0048_marketplace_offer_workflow.sql) shared accept
// path — called from offerAction() (src/app/marketplace/[id]/actions.ts) —
// one row per completed purchase or accepted offer. listing_title/category/
// condition/image_url are a SNAPSHOT taken at that moment — never re-read
// from `listings`, so a later listing edit (or removal) never rewrites a
// historical order.

export type OrderStatus = "pending" | "completed" | "cancelled" | "refunded";
export type PaymentStatus = "unpaid" | "pending" | "paid" | "failed" | "refunded";
export type PayoutStatus = "not_started" | "pending" | "paid_out" | "held" | "failed";

export type Order = {
  id: number;
  listing_id: number | null;
  offer_id: number | null;
  buyer_id: string;
  seller_id: string;
  listing_title: string;
  listing_category: string;
  listing_condition: string;
  listing_image_url: string | null;
  amount_eur: number;
  platform_fee_eur: number;
  total_eur: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  payout_status: PayoutStatus;
  payment_reference: string | null;
  /** The Stripe Transfer id created alongside this order's destination
   * charge (see supabase/migrations/0024_payouts.sql) — despite the name,
   * NOT a Payout id; a transfer only gets swept into a Payout later, once
   * `payout_id` below is set. */
  payout_reference: string | null;
  /** Which `payouts` row swept this order's transfer into an actual bank
   * deposit, once known. Nullable — a payout routinely aggregates many
   * orders, on Stripe's own schedule, never a fixed 1:1. */
  payout_id: number | null;
  /** Currency Stripe actually reported on the PaymentIntent — a
   * reconciliation check, not multi-currency support (see
   * supabase/migrations/0021_payments.sql). Always "eur" today. */
  currency: string;
  /** Stripe's own decline/failure message from the most recent failed
   * payment attempt, cleared on success. Never a secret or a raw payload. */
  payment_last_error: string | null;
  refund_reason: string | null;
  refunded_amount_eur: number | null;
  /** Set only while status = 'pending' and this order originated from an
   * accepted private offer (see supabase/migrations/0048_marketplace_offer_workflow.sql):
   * the buyer's short checkout window. `release_expired_offer_reservations()`
   * cancels the order and reactivates the listing once this passes without
   * payment. Null for orders that were never offer-reserved, and cleared by
   * nothing else — a paid order simply stops being swept because its status
   * is no longer 'pending'. */
  reservation_expires_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
};

// ============ REFUNDS & DISPUTES ============
// See supabase/migrations/0023_refunds_and_disputes.sql. `refunds` is one
// row per refund ATTEMPT (not per order) — a finance admin's requested
// amount/reason plus Stripe's own refund id and settlement status; the
// pre-existing Order.refund_reason/refunded_amount_eur/refunded_at fields
// above are unrelated and keep being maintained separately by the existing
// charge.refunded webhook path as the order's own aggregate summary.
// `disputes` is a pure read-only projection of Stripe Dispute objects — this
// app never acts on one, only shows it (see
// src/lib/stripe/refunds.ts's stripeDisputeDashboardUrl()).

export type RefundStatus = "pending" | "requires_action" | "succeeded" | "failed" | "canceled";

export type Refund = {
  id: number;
  order_id: number;
  stripe_refund_id: string | null;
  stripe_payment_intent_id: string;
  amount_eur: number;
  currency: string;
  /** The admin's own typed justification — distinct from Stripe's short
   * refund-reason enum threaded into Order.refund_reason. */
  reason: string;
  status: RefundStatus;
  failure_reason: string | null;
  idempotency_key: string;
  requested_by: string;
  created_at: string;
  updated_at: string;
};

export type Dispute = {
  id: number;
  order_id: number | null;
  stripe_dispute_id: string;
  stripe_charge_id: string | null;
  stripe_payment_intent_id: string | null;
  amount_eur: number;
  currency: string;
  reason: string | null;
  /** Stripe's own dispute status string (e.g. needs_response, under_review, won, lost) — shown as-is, not narrowed to a closed union (see the migration's comment on why). */
  status: string;
  evidence_due_by: string | null;
  livemode: boolean;
  created_at: string;
  updated_at: string;
};

// ============ WEBHOOK EVENTS ============
// See supabase/migrations/0021_payments.sql. One row per Stripe webhook
// event this app has ever been delivered, keyed uniquely on
// (provider, event_id) for idempotency. Written only by
// claim_webhook_event()/apply_order_payment_*()/mark_webhook_event_terminal()
// (src/lib/stripe/payments.ts), via the service-role client — never a direct
// insert from application code. `payload` is Stripe's own verified event
// body (signature already checked before it's ever written here) — safe
// operational data (amounts, ids, statuses, at most a card's brand/last4),
// never a secret and never a full card number.

export type WebhookEventStatus = "received" | "processing" | "processed" | "failed" | "ignored";

export type WebhookEvent = {
  id: number;
  provider: "stripe";
  event_id: string;
  event_type: string;
  api_version: string | null;
  status: WebhookEventStatus;
  attempts: number;
  last_error: string | null;
  payload: Record<string, unknown>;
  related_order_id: number | null;
  received_at: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

// ============ STRIPE CONNECTED ACCOUNTS ============
// See supabase/migrations/0020_stripe_connected_accounts.sql. One row per
// Pinpals member who has started (or completed) Stripe Connect Express
// onboarding. Every boolean/array field below is a cached copy of what
// Stripe's Connected Account object reported as of last_synced_at — Stripe
// itself, never this table, is the source of truth. See
// sellerAccountStatusLabel() in src/lib/format.ts for the derived,
// human-readable summary shown in the UI; nothing here is a Pinpals-invented
// status of its own.

export type StripeConnectedAccount = {
  id: number;
  user_id: string;
  stripe_account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  /** Stripe requirement codes (e.g. "individual.verification.document") —
   * never the values submitted for them. */
  requirements_currently_due: string[];
  requirements_past_due: string[];
  disabled_reason: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

// ============ PAYOUTS ============
// See supabase/migrations/0024_payouts.sql. One row per Stripe Payout
// object per connected account — Stripe sweeps a seller's Connect balance
// (built up from the Transfer that lands there automatically alongside
// every destination-charge order, see orders.payout_reference above) into a
// Payout on its own schedule, aggregating many orders' transfers into one
// bank deposit. Written only via the service-role client (the payout.*
// webhook handlers and an admin's "Sync from Stripe" action, both in
// src/lib/stripe/payouts.ts) — Stripe itself, never this table, is the
// source of truth.

export type Payout = {
  id: number;
  user_id: string;
  stripe_account_id: string;
  stripe_payout_id: string;
  amount_eur: number;
  currency: string;
  /** Stripe's own Payout.status values. */
  status: "paid" | "pending" | "in_transit" | "canceled" | "failed";
  failure_code: string | null;
  failure_message: string | null;
  arrival_date: string | null;
  /** "standard" | "instant", Stripe's own values — shown as-is. */
  method: string | null;
  /** "bank_account" | "card", Stripe's own values — shown as-is. */
  type: string | null;
  livemode: boolean;
  stripe_created_at: string;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
};

// ============ MESSAGING ============
// See supabase/migrations/0025_messaging.sql for the full privacy model
// (who may start a conversation, RLS, the admin access model). A
// conversation always has exactly two participants — user_a_id/user_b_id
// carry no "who initiated" meaning the way connections.requester_id/
// recipient_id do, they're just an unordered pair.

export type Conversation = {
  id: number;
  user_a_id: string;
  user_b_id: string;
  last_message_at: string | null;
  created_at: string;
};

export type Message = {
  id: number;
  conversation_id: number;
  sender_id: string;
  body: string;
  created_at: string;
  /** Moderation flag only — see hideMessage()/restoreMessage() in
   * src/app/admin/reports/[id]/actions.ts. `body` above is never rewritten
   * or cleared when a message is hidden; the UI decides whether to render
   * it, based on these three fields. */
  hidden_at: string | null;
  hidden_by: string | null;
  hidden_reason: string | null;
};

// What a conversation list/thread shows about the other participant — same
// public-fields-only shape as InviteHost above, never their email.
export type ConversationParticipant = Pick<
  Profile,
  "id" | "first_name" | "last_name" | "avatar_color"
>;
