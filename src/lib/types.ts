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
  refund_reason: string | null;
  refunded_amount_eur: number | null;
  completed_at: string | null;
  cancelled_at: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
};

