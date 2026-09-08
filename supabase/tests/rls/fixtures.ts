// Seeds a fixed, deterministic dataset for the RLS test suite: one row (or a
// handful) touching every table this phase's task covers, across every
// status a policy or trigger branches on. Everything is inserted through a
// single `pg` client connected as the Postgres superuser (`postgres`), which
// carries BYPASSRLS — the same reason `service_role` bypasses RLS on the real
// project — so this file never has to fight the very policies it's setting
// up fixtures to test.
//
// IDs are captured via `RETURNING id` rather than assumed from sequence
// position: it's one extra column per insert and it means this file stays
// correct even if someone reorders the inserts below or adds a new one in
// the middle.
import type { Client } from "pg";

export const USERS = {
  seller1: "00000000-0000-0000-0000-000000000001",
  seller2: "00000000-0000-0000-0000-000000000002",
  buyer1: "00000000-0000-0000-0000-000000000003",
  buyer2: "00000000-0000-0000-0000-000000000004",
  moderator: "00000000-0000-0000-0000-000000000005",
  admin: "00000000-0000-0000-0000-000000000006",
  disabledStaff: "00000000-0000-0000-0000-000000000007",
} as const;

// bigint identity columns come back from `pg` as strings (not JS `number`,
// which can't safely hold the full bigint range) — every id here is a string
// for that reason, and every SQL param below passes them straight back as
// strings, which `pg` binds correctly against a bigint column.
export type FixtureIds = {
  listings: Record<
    "active" | "draft" | "reserved" | "sold" | "removed" | "pendingReview" | "expired" | "seller2Active" | "auction",
    string
  >;
  listingImageId: string;
  offers: { pendingOnActive: string; acceptedOnReserved: string };
  orderId: string;
  auctionId: string;
  bids: { buyer1: string; buyer2: string };
  conversationId: string;
  messageId: string;
  notificationId: string;
  staffRoles: { moderator: string; admin: string; disabledStaff: string };
  webhookEventId: string;
  refundId: string;
  disputeId: string;
  payoutId: string;
  reportId: string;
  fraudFlagId: string;
};

async function insertUser(client: Client, id: string, firstName: string, lastName: string) {
  // Fires the on_auth_user_created trigger (0001_init.sql), which inserts a
  // matching public.profiles row automatically — no separate profiles insert
  // needed here.
  await client.query(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, $2, jsonb_build_object('first_name', $3::text, 'last_name', $4::text))
     on conflict (id) do nothing`,
    [id, `${id}@example.test`, firstName, lastName],
  );
}

export async function seed(client: Client): Promise<FixtureIds> {
  await insertUser(client, USERS.seller1, "Sean", "Seller");
  await insertUser(client, USERS.seller2, "Sinead", "Seller");
  await insertUser(client, USERS.buyer1, "Brian", "Buyer");
  await insertUser(client, USERS.buyer2, "Barry", "Buyer");
  await insertUser(client, USERS.moderator, "Mona", "Moderator");
  await insertUser(client, USERS.admin, "Aoife", "Admin");
  await insertUser(client, USERS.disabledStaff, "Declan", "Disabled");

  // ============ listings (one per status the schema recognises) ============
  // priceEur defaults to a plain 120.00 for every ordinary fixed-price/offers
  // fixture; an auction listing has to pass null explicitly (0046's
  // listings_price_required_for_non_auction_check now rejects an auction row
  // that still carries a listing-level price_eur — its price lives on
  // `auctions` instead, see that migration's header comment).
  const listing = async (
    seller: string,
    title: string,
    status: string,
    saleType: string = "fixed_price",
    priceEur: number | null = 120.0,
  ): Promise<string> => {
    // price_cents (0046) is meant to always mirror price_eur — the real
    // create/edit actions (src/app/marketplace/new/actions.ts) insert both
    // together, never one without the other. Deriving it here the same way
    // (rather than leaving the column at its default null) is what makes
    // marketplace-discovery.test.ts's price-sort fixtures behave like real
    // listings instead of every row looking priceless to a price sort.
    const priceCents = priceEur !== null ? Math.round(priceEur * 100) : null;
    const { rows } = await client.query<{ id: string }>(
      `insert into public.listings
         (seller_id, title, description, price_eur, price_cents, category, condition, county, status, sale_type)
       values ($1, $2, 'Fixture listing', $5, $6, 'irons', 'good', 'Kerry', $3, $4)
       returning id`,
      [seller, title, status, saleType, priceEur, priceCents],
    );
    return rows[0].id;
  };

  const listings: FixtureIds["listings"] = {
    active: await listing(USERS.seller1, "L1 active with a pending offer", "active", "offers_allowed"),
    draft: await listing(USERS.seller1, "L2 draft", "draft"),
    reserved: await listing(USERS.seller1, "L3 reserved (sale in progress)", "reserved"),
    sold: await listing(USERS.seller1, "L4 sold", "sold"),
    removed: await listing(USERS.seller1, "L5 removed", "removed"),
    pendingReview: await listing(USERS.seller1, "L6 pending review", "pending_review"),
    expired: await listing(USERS.seller1, "L7 expired", "expired"),
    seller2Active: await listing(USERS.seller2, "L8 seller2's active listing", "active"),
    auction: await listing(USERS.seller1, "L9 auction listing", "active", "auction", null),
  };

  const { rows: imgRows } = await client.query<{ id: string }>(
    `insert into public.listing_images (listing_id, image_url, position)
     values ($1, 'https://example.test/l1.jpg', 0)
     returning id`,
    [listings.active],
  );
  const listingImageId = imgRows[0].id;

  // ============ offers ============
  // Seeded as the postgres superuser (auth.uid() is null on this
  // connection), which is exactly the "privileged caller" path
  // prepare_and_validate_offer() (0048) bypasses its own validation for —
  // so these can freely set original_amount_eur/expires_at/status directly
  // to represent a known state, the same way the auction fixture below
  // pushes an auction straight to 'ended' via a plain UPDATE.
  const { rows: offerPending } = await client.query<{ id: string }>(
    `insert into public.offers (listing_id, buyer_id, amount_eur, original_amount_eur, status, expires_at)
     values ($1, $2, 100.00, 100.00, 'pending', now() + interval '48 hours')
     returning id`,
    [listings.active, USERS.buyer1],
  );
  const { rows: offerAccepted } = await client.query<{ id: string }>(
    `insert into public.offers (listing_id, buyer_id, amount_eur, original_amount_eur, status, expires_at)
     values ($1, $2, 110.00, 110.00, 'accepted', now() - interval '1 hour')
     returning id`,
    [listings.reserved, USERS.buyer1],
  );
  const offers: FixtureIds["offers"] = {
    pendingOnActive: offerPending[0].id,
    acceptedOnReserved: offerAccepted[0].id,
  };

  // ============ orders (one completed order, tied to the accepted offer) ============
  const { rows: orderRows } = await client.query<{ id: string }>(
    `insert into public.orders (
       listing_id, offer_id, buyer_id, seller_id,
       listing_title, listing_category, listing_condition, listing_image_url,
       amount_eur, platform_fee_eur, total_eur,
       status, payment_status, payout_status,
       payment_reference, payout_reference,
       delivery_method, delivery_fee_cents,
       completed_at
     )
     values (
       $1, $2, $3, $4,
       'L3 reserved (sale in progress)', 'irons', 'good', null,
       110.00, 5.50, 115.50,
       'completed', 'paid', 'paid_out',
       'pi_fixture_1', 'tr_fixture_1',
       'collection', 0,
       now()
     )
     returning id`,
    [listings.reserved, offers.acceptedOnReserved, USERS.buyer1, USERS.seller1],
  );
  const orderId = orderRows[0].id;

  // ============ auction + bids ============
  // ends_at starts in the future so validate_bid()'s BEFORE INSERT trigger
  // (which fires regardless of caller/role — see 0039) accepts these two
  // seed bids; the auction is then pushed into 'ended' via a plain UPDATE
  // (auctions has no update-blocking trigger) so auction_bid_history has a
  // concluded auction to expose.
  const { rows: auctionRows } = await client.query<{ id: string }>(
    `insert into public.auctions (listing_id, starting_price_cents, ends_at, status)
     values ($1, 5000, now() + interval '7 days', 'scheduled')
     returning id`,
    [listings.auction],
  );
  const auctionId = auctionRows[0].id;

  const { rows: bid1Rows } = await client.query<{ id: string }>(
    `insert into public.bids (auction_id, bidder_id, amount_cents)
     values ($1, $2, 5000)
     returning id`,
    [auctionId, USERS.buyer1],
  );
  const { rows: bid2Rows } = await client.query<{ id: string }>(
    `insert into public.bids (auction_id, bidder_id, amount_cents)
     values ($1, $2, 6000)
     returning id`,
    [auctionId, USERS.buyer2],
  );
  const bids: FixtureIds["bids"] = { buyer1: bid1Rows[0].id, buyer2: bid2Rows[0].id };

  await client.query(
    `update public.auctions
       set status = 'ended', starts_at = now() - interval '8 days', ends_at = now() - interval '1 day'
     where id = $1`,
    [auctionId],
  );

  // ============ conversation + message (seller1 <-> buyer1, eligible via the offer above) ============
  const { rows: convRows } = await client.query<{ id: string }>(
    `insert into public.conversations (user_a_id, user_b_id, listing_id)
     values ($1, $2, $3)
     returning id`,
    [USERS.seller1, USERS.buyer1, listings.active],
  );
  const conversationId = convRows[0].id;

  const { rows: msgRows } = await client.query<{ id: string }>(
    `insert into public.messages (conversation_id, sender_id, body)
     values ($1, $2, 'Is this still available?')
     returning id`,
    [conversationId, USERS.buyer1],
  );
  const messageId = msgRows[0].id;

  // ============ notification ============
  const { rows: notifRows } = await client.query<{ id: string }>(
    `insert into public.notifications (user_id, type, title, body, data)
     values ($1, 'offer_received', 'New offer', 'Brian offered EUR 100 on L1', '{}'::jsonb)
     returning id`,
    [USERS.seller1],
  );
  const notificationId = notifRows[0].id;

  // ============ staff_roles ============
  const { rows: modRows } = await client.query<{ id: string }>(
    `insert into public.staff_roles (user_id, role, status) values ($1, 'moderator', 'active') returning id`,
    [USERS.moderator],
  );
  const { rows: adminRows } = await client.query<{ id: string }>(
    `insert into public.staff_roles (user_id, role, status) values ($1, 'admin', 'active') returning id`,
    [USERS.admin],
  );
  const { rows: disabledRows } = await client.query<{ id: string }>(
    `insert into public.staff_roles (user_id, role, status) values ($1, 'moderator', 'disabled') returning id`,
    [USERS.disabledStaff],
  );
  const staffRoles: FixtureIds["staffRoles"] = {
    moderator: modRows[0].id,
    admin: adminRows[0].id,
    disabledStaff: disabledRows[0].id,
  };

  // ============ one seed row each for every server/admin-only table ============
  const { rows: webhookRows } = await client.query<{ id: string }>(
    `insert into public.webhook_events (provider, event_id, event_type, status, payload, related_order_id)
     values ('stripe', 'evt_fixture_1', 'payment_intent.succeeded', 'processed', '{"fixture": true}'::jsonb, $1)
     returning id`,
    [orderId],
  );
  const webhookEventId = webhookRows[0].id;

  const { rows: refundRows } = await client.query<{ id: string }>(
    `insert into public.refunds (
       order_id, stripe_refund_id, stripe_payment_intent_id, amount_eur, reason, status, idempotency_key, requested_by
     )
     values ($1, 're_fixture_1', 'pi_fixture_1', 20.00, 'Fixture refund', 'succeeded', 'idem_fixture_1', $2)
     returning id`,
    [orderId, USERS.admin],
  );
  const refundId = refundRows[0].id;

  const { rows: disputeRows } = await client.query<{ id: string }>(
    `insert into public.disputes (
       order_id, stripe_dispute_id, stripe_charge_id, stripe_payment_intent_id,
       amount_eur, reason, status, livemode
     )
     values ($1, 'dp_fixture_1', 'ch_fixture_1', 'pi_fixture_1', 115.50, 'product_not_received', 'needs_response', false)
     returning id`,
    [orderId],
  );
  const disputeId = disputeRows[0].id;

  const { rows: payoutRows } = await client.query<{ id: string }>(
    `insert into public.payouts (
       user_id, stripe_account_id, stripe_payout_id, amount_eur, status, method, type, livemode, stripe_created_at
     )
     values ($1, 'acct_fixture_1', 'po_fixture_1', 110.00, 'paid', 'standard', 'bank_account', false, now())
     returning id`,
    [USERS.seller1],
  );
  const payoutId = payoutRows[0].id;

  const { rows: reportRows } = await client.query<{ id: string }>(
    `insert into public.reports (reporter_id, target_type, target_id, category, description, status)
     values ($1, 'listing', $2::text, 'fake_listing', 'Fixture report', 'open')
     returning id`,
    [USERS.buyer1, String(listings.removed)],
  );
  const reportId = reportRows[0].id;

  // marketplace-trust-safety (0055) — fraud_flags follows the identical
  // "staff can read, only service-role can write" shape as reports/
  // webhook_events/refunds/disputes/payouts above, so it's seeded the same
  // way for admin-only-tables.test.ts's STAFF_ONLY_TABLES table.
  const { rows: fraudFlagRows } = await client.query<{ id: string }>(
    `insert into public.fraud_flags (target_type, target_id, flag_type, severity, note, status, raised_by)
     values ('user', $1::text, 'suspected_fraud', 'medium', 'Fixture flag', 'open', $2)
     returning id`,
    [USERS.buyer1, USERS.admin],
  );
  const fraudFlagId = fraudFlagRows[0].id;

  return {
    listings,
    listingImageId,
    offers,
    orderId,
    auctionId,
    bids,
    conversationId,
    messageId,
    notificationId,
    staffRoles,
    webhookEventId,
    refundId,
    disputeId,
    payoutId,
    reportId,
    fraudFlagId,
  };
}

export async function truncateAll(client: Client) {
  // CASCADE follows every FK transitively (auth.users -> profiles -> listings
  // /offers/orders/staff_roles/reports/webhook_events/refunds/disputes/
  // payouts/admin_audit_log/conversations/messages/reviews/notifications/
  // auctions/bids/tee_time_invites/connections/support_cases, etc.), so this
  // one statement is a complete, deterministic reset. RESTART IDENTITY isn't
  // load-bearing for correctness (fixtures.ts never assumes a specific id),
  // but it keeps fixture data readable in ad-hoc debugging queries.
  await client.query("truncate table auth.users restart identity cascade");
}
