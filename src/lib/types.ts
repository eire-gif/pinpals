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

export type Listing = {
  id: number;
  seller_id: string;
  title: string;
  description: string | null;
  price_eur: number;
  category: string;
  condition: string;
  county: string | null;
  image_url: string | null;
  status: string;
  created_at: string;
};

export type OfferStatus = "pending" | "accepted" | "declined";

export type Offer = {
  id: number;
  listing_id: number;
  buyer_id: string;
  amount_eur: number;
  status: OfferStatus;
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
// See supabase/migrations/0019_orders.sql. Created by respondToOffer()'s
// accept branch (src/app/marketplace/[id]/actions.ts), one row per accepted
// offer. listing_title/category/condition/image_url are a SNAPSHOT taken at
// that moment — never re-read from `listings`, so a later listing edit (or
// removal) never rewrites a historical order.

export type OrderStatus = "pending" | "completed" | "cancelled" | "refunded";
export type PaymentStatus = "unpaid" | "pending" | "paid" | "failed" | "refunded";
export type PayoutStatus = "not_started" | "pending" | "paid_out" | "held";

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
  payout_reference: string | null;
  /** Currency Stripe actually reported on the PaymentIntent — a
   * reconciliation check, not multi-currency support (see
   * supabase/migrations/0021_payments.sql). Always "eur" today. */
  currency: string;
  /** Stripe's own decline/failure message from the most recent failed
   * payment attempt, cleared on success. Never a secret or a raw payload. */
  payment_last_error: string | null;
  refund_reason: string | null;
  refunded_amount_eur: number | null;
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
