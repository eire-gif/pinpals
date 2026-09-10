// Coverage for 0050_marketplace_checkout.sql: `addresses` RLS ("the existing
// secure profile pattern" — own-row + staff, member-writable directly, no
// anon access), the order-status transition guard trigger
// (validate_order_status_transition()), and the two checkout transactions
// (create_purchase_order(), finalize_offer_checkout()).
//
// create_purchase_order()/finalize_offer_checkout() both need listings whose
// delivery_options actually includes something (the shared global-setup.ts
// fixture listings default to '{}' — 0046 — since no earlier phase needed a
// deliverable one), so this file follows offer-workflow-race.test.ts's own
// pattern: fresh, throwaway fixtures created directly via `pool.query()`
// (bypassing RLS as the Postgres superuser), cleaned up at the end of each
// test rather than relying on global-setup.ts's shared seed.
import { describe, it, expect, afterAll } from "vitest";
import { pool, withRole, setIdentity, expectRejected, expectZeroRows, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

async function freshListing(
  sellerId: string,
  opts: {
    deliveryOptions?: string[];
    collectionNotes?: string | null;
    priceEur?: number | null;
    saleType?: string;
    status?: string;
  } = {},
): Promise<string> {
  const deliveryOptions = opts.deliveryOptions ?? ["post", "collection"];
  const priceEur = opts.priceEur === undefined ? 200 : opts.priceEur;
  const priceCents = priceEur !== null ? Math.round(priceEur * 100) : null;
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.listings
       (seller_id, title, description, price_eur, price_cents, category, condition, county, status, sale_type,
        delivery_options, collection_notes)
     values ($1, 'Checkout fixture listing', 'x', $2, $3, 'Irons', 'good', 'Kerry', $4, $5, $6, $7)
     returning id`,
    [
      sellerId,
      priceEur,
      priceCents,
      opts.status ?? "active",
      opts.saleType ?? "fixed_price",
      deliveryOptions,
      opts.collectionNotes ?? "Collect from the clubhouse",
    ],
  );
  return rows[0].id;
}

async function dropListing(listingId: string) {
  await pool.query("delete from public.orders where listing_id = $1", [listingId]);
  await pool.query("delete from public.auctions where listing_id = $1", [listingId]);
  await pool.query("delete from public.listings where id = $1", [listingId]);
}

async function freshAddress(userId: string, overrides: Partial<Record<string, string | null>> = {}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.addresses (user_id, label, recipient_name, line1, line2, city, county, eircode, phone)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      userId,
      overrides.label ?? "Home",
      overrides.recipient_name ?? "Brian Buyer",
      overrides.line1 ?? "1 Fairway Drive",
      overrides.line2 ?? null,
      overrides.city ?? "Tralee",
      overrides.county ?? "Kerry",
      overrides.eircode ?? "V92X1Y2",
      overrides.phone ?? null,
    ],
  );
  return rows[0].id;
}

async function dropAddress(addressId: string) {
  await pool.query("delete from public.addresses where id = $1", [addressId]);
}

async function callCreatePurchaseOrder(
  callerId: string | null,
  listingId: string,
  deliveryMethod: string,
  addressId: string | null = null,
  reservationMinutes: number | null = null,
) {
  return pool.query<{ create_purchase_order: string }>(
    "select public.create_purchase_order($1, $2, $3, $4, $5)",
    [callerId, listingId, deliveryMethod, addressId, reservationMinutes],
  );
}

async function callFinalizeOfferCheckout(
  callerId: string | null,
  orderId: string,
  deliveryMethod: string,
  addressId: string | null = null,
) {
  return pool.query<{ finalize_offer_checkout: string }>(
    "select public.finalize_offer_checkout($1, $2, $3, $4)",
    [callerId, orderId, deliveryMethod, addressId],
  );
}

describe("addresses: RLS (\"the existing secure profile pattern\")", () => {
  it("a member can insert their own address", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query(
        `insert into public.addresses (user_id, label, recipient_name, line1, city)
         values ($1, 'Home', 'Brian Buyer', '1 Fairway Drive', 'Tralee') returning id`,
        [USERS.buyer1],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("a member cannot insert an address under someone else's user_id", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.addresses (user_id, label, recipient_name, line1, city)
           values ($1, 'Home', 'Brian Buyer', '1 Fairway Drive', 'Tralee')`,
          [USERS.buyer2],
        ),
        /row-level security/,
      );
    });
  });

  it("anon cannot insert an address at all", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.addresses (user_id, label, recipient_name, line1, city)
           values ($1, 'Home', 'Brian Buyer', '1 Fairway Drive', 'Tralee')`,
          [USERS.buyer1],
        ),
        /permission denied|row-level security/,
      );
    });
  });

  it("a member can read only their own address, not another member's", async () => {
    const addressId = await freshAddress(USERS.buyer1);
    try {
      await withRole("authenticated", USERS.buyer1, async (c) => {
        const r = await c.query("select id from public.addresses where id = $1", [addressId]);
        expect(r.rowCount).toBe(1);
      });
      await withRole("authenticated", USERS.buyer2, async (c) => {
        const r = await c.query("select id from public.addresses where id = $1", [addressId]);
        expectZeroRows(r);
      });
      // addresses' own migration goes further than most tables in this schema
      // and revokes ALL table-level privileges from anon (not just insert/
      // update/delete, the way e.g. stripe_connected_accounts does) — so an
      // anon SELECT here fails outright with "permission denied", it never
      // gets the chance to be silently RLS-filtered to zero rows the way an
      // authenticated non-owner's does above.
      await withRole("anon", null, async (c) => {
        await expectRejected(
          c.query("select id from public.addresses where id = $1", [addressId]),
          /permission denied/,
        );
      });
    } finally {
      await dropAddress(addressId);
    }
  });

  it("staff can read any address, but a disabled staff member cannot", async () => {
    const addressId = await freshAddress(USERS.buyer1);
    try {
      await withRole("authenticated", USERS.moderator, async (c) => {
        const r = await c.query("select id from public.addresses where id = $1", [addressId]);
        expect(r.rowCount).toBe(1);
      });
      await withRole("authenticated", USERS.disabledStaff, async (c) => {
        const r = await c.query("select id from public.addresses where id = $1", [addressId]);
        expectZeroRows(r);
      });
    } finally {
      await dropAddress(addressId);
    }
  });

  it("a member can update their own address, but not another member's", async () => {
    const addressId = await freshAddress(USERS.buyer1);
    try {
      await withRole("authenticated", USERS.buyer1, async (c) => {
        const r = await c.query("update public.addresses set label = 'Work' where id = $1", [addressId]);
        expect(r.rowCount).toBe(1);
      });
      await withRole("authenticated", USERS.buyer2, async (c) => {
        const r = await c.query("update public.addresses set label = 'Hijacked' where id = $1", [addressId]);
        expectZeroRows(r);
      });
      // Staff can read it, but this table's own policies give staff no
      // UPDATE policy at all — table-level UPDATE privilege is still there
      // (only anon's is fully revoked, above), so this is silently matched
      // to zero rows by the USING clause rather than throwing, the same
      // "blocked by USING, not a trigger" shape harness.ts's own comment on
      // expectZeroRows vs expectRejected describes.
      await withRole("authenticated", USERS.admin, async (c) => {
        const r = await c.query("update public.addresses set label = 'Staff-edited' where id = $1", [addressId]);
        expectZeroRows(r);
      });
    } finally {
      await dropAddress(addressId);
    }
  });

  it("a member can delete their own address, but not another member's", async () => {
    const addressId = await freshAddress(USERS.buyer1);
    try {
      await withRole("authenticated", USERS.buyer2, async (c) => {
        const r = await c.query("delete from public.addresses where id = $1", [addressId]);
        expectZeroRows(r);
      });
      await withRole("authenticated", USERS.buyer1, async (c) => {
        const r = await c.query("delete from public.addresses where id = $1", [addressId]);
        expect(r.rowCount).toBe(1);
      });
    } finally {
      await dropAddress(addressId);
    }
  });
});

describe("orders: status transition guard (validate_order_status_transition())", () => {
  it("permits pending -> completed", async () => {
    const listingId = await freshListing(USERS.seller1);
    try {
      await withRole("service_role", null, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `insert into public.orders (
             buyer_id, seller_id, listing_id, listing_title, listing_category, listing_condition,
             amount_eur, platform_fee_eur, total_eur, status
           ) values ($1, $2, $3, 'x', 'Irons', 'good', 100, 7, 107, 'pending')
           returning id`,
          [USERS.buyer1, USERS.seller1, listingId],
        );
        const orderId = rows[0].id;
        const r = await c.query("update public.orders set status = 'completed' where id = $1", [orderId]);
        expect(r.rowCount).toBe(1);
      });
    } finally {
      await dropListing(listingId);
    }
  });

  it("permits pending -> cancelled, and any -> refunded on a fresh order; rejects everything else", async () => {
    // Committed, superuser-bypassing pool.query() calls throughout (not
    // withRole()) — the trigger fires regardless of RLS bypass (a BEFORE
    // trigger isn't a policy), and this test needs the order's state to
    // genuinely persist between one assertion and the next; withRole()
    // always rolls back at the end of its own block, and a failed statement
    // aborts the rest of that same Postgres transaction (see messaging.
    // test.ts's own comment on the identical problem), so a single
    // always-rollback block can't cleanly mix a rejected step with a
    // subsequent one the way this test needs to.
    const listingId = await freshListing(USERS.seller1);
    try {
      const { rows } = await pool.query<{ id: string }>(
        `insert into public.orders (
           buyer_id, seller_id, listing_id, listing_title, listing_category, listing_condition,
           amount_eur, platform_fee_eur, total_eur, status
         ) values ($1, $2, $3, 'x', 'Irons', 'good', 100, 7, 107, 'pending')
         returning id`,
        [USERS.buyer1, USERS.seller1, listingId],
      );
      const orderId = rows[0].id;

      // pending -> cancelled: permitted.
      const cancelled = await pool.query("update public.orders set status = 'cancelled' where id = $1", [orderId]);
      expect(cancelled.rowCount).toBe(1);

      // cancelled -> completed: not in the permitted edge list, rejected.
      await expect(
        pool.query("update public.orders set status = 'completed' where id = $1", [orderId]),
      ).rejects.toThrow(/Invalid order status transition/);

      // any status -> refunded: always permitted, including from 'cancelled'.
      const refunded = await pool.query("update public.orders set status = 'refunded' where id = $1", [orderId]);
      expect(refunded.rowCount).toBe(1);

      // refunded -> anything else: rejected (refunded is terminal here).
      await expect(
        pool.query("update public.orders set status = 'completed' where id = $1", [orderId]),
      ).rejects.toThrow(/Invalid order status transition/);
    } finally {
      // dropListing() deletes by listing_id first, which covers this order
      // too — no separate order cleanup needed.
      await dropListing(listingId);
    }
  });

  it("a same-value status write is a no-op for the trigger (the `when` clause never fires)", async () => {
    const listingId = await freshListing(USERS.seller1);
    try {
      await withRole("service_role", null, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `insert into public.orders (
             buyer_id, seller_id, listing_id, listing_title, listing_category, listing_condition,
             amount_eur, platform_fee_eur, total_eur, status
           ) values ($1, $2, $3, 'x', 'Irons', 'good', 100, 7, 107, 'pending')
           returning id`,
          [USERS.buyer1, USERS.seller1, listingId],
        );
        const orderId = rows[0].id;
        const r = await c.query("update public.orders set status = 'pending' where id = $1", [orderId]);
        expect(r.rowCount).toBe(1);
      });
    } finally {
      await dropListing(listingId);
    }
  });

  it("a write that touches unrelated columns only (e.g. payout_status) never trips the trigger", async () => {
    // Regression guard named directly in 0050's own header comment — must
    // not break the pre-existing "service-role can update payout_status"
    // behaviour orders.test.ts already covers on the shared seed order.
    await withRole("service_role", null, async (c) => {
      const r = await c.query("update public.orders set payout_status = 'held' where id = $1", [ids.orderId]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("staff and the buyer/seller still have no direct write path at all — orders' own table grants, unchanged by this trigger", async () => {
    const listingId = await freshListing(USERS.seller1);
    try {
      const { rows } = await pool.query<{ id: string }>(
        `insert into public.orders (
           buyer_id, seller_id, listing_id, listing_title, listing_category, listing_condition,
           amount_eur, platform_fee_eur, total_eur, status
         ) values ($1, $2, $3, 'x', 'Irons', 'good', 100, 7, 107, 'pending')
         returning id`,
        [USERS.buyer1, USERS.seller1, listingId],
      );
      const orderId = rows[0].id;

      await withRole("authenticated", USERS.buyer1, async (c) => {
        await expectRejected(
          c.query("update public.orders set status = 'cancelled' where id = $1", [orderId]),
          /permission denied/,
        );
      });
      await withRole("authenticated", USERS.admin, async (c) => {
        await expectRejected(
          c.query("update public.orders set status = 'cancelled' where id = $1", [orderId]),
          /permission denied/,
        );
      });
    } finally {
      await dropListing(listingId);
    }
  });
});

describe("create_purchase_order(): the Buy Now checkout transaction", () => {
  it("creates a reserved, checkout-completed order for a collection purchase", async () => {
    const listingId = await freshListing(USERS.seller1, { priceEur: 150, deliveryOptions: ["collection"] });
    try {
      const { rows } = await callCreatePurchaseOrder(USERS.buyer1, listingId, "collection");
      const orderId = rows[0].create_purchase_order;
      expect(orderId).toBeTruthy();

      const { rows: orderRows } = await pool.query(
        `select status, buyer_id, seller_id, amount_eur, platform_fee_eur, delivery_fee_cents, total_eur,
                delivery_method, delivery_detail, checkout_completed_at, reservation_expires_at
           from public.orders where id = $1`,
        [orderId],
      );
      const order = orderRows[0];
      expect(order.status).toBe("pending");
      expect(order.buyer_id).toBe(USERS.buyer1);
      expect(order.seller_id).toBe(USERS.seller1);
      expect(Number(order.amount_eur)).toBe(150);
      expect(Number(order.platform_fee_eur)).toBe(10.5); // 7% of 150
      expect(order.delivery_fee_cents).toBe(0);
      expect(Number(order.total_eur)).toBe(160.5);
      expect(order.delivery_method).toBe("collection");
      expect(order.delivery_detail).toBe("Collect from the clubhouse");
      expect(order.checkout_completed_at).not.toBeNull();
      expect(order.reservation_expires_at).not.toBeNull();

      const { rows: listingRows } = await pool.query("select status from public.listings where id = $1", [listingId]);
      expect(listingRows[0].status).toBe("reserved");
    } finally {
      await dropListing(listingId);
    }
  });

  it("creates a post purchase with the flat delivery fee and a formatted delivery_detail snapshot", async () => {
    const listingId = await freshListing(USERS.seller1, { priceEur: 100, deliveryOptions: ["post"] });
    const addressId = await freshAddress(USERS.buyer1, { line2: "Apt 4", county: "Kerry", eircode: "V92X1Y2" });
    try {
      const { rows } = await callCreatePurchaseOrder(USERS.buyer1, listingId, "post", addressId);
      const orderId = rows[0].create_purchase_order;

      const { rows: orderRows } = await pool.query(
        "select delivery_fee_cents, delivery_detail, total_eur, amount_eur, platform_fee_eur from public.orders where id = $1",
        [orderId],
      );
      const order = orderRows[0];
      expect(order.delivery_fee_cents).toBe(600);
      expect(order.delivery_detail).toBe("Brian Buyer, 1 Fairway Drive, Apt 4, Tralee, Kerry V92X1Y2");
      expect(Number(order.total_eur)).toBe(Number(order.amount_eur) + Number(order.platform_fee_eur) + 6);
    } finally {
      await dropListing(listingId);
      await dropAddress(addressId);
    }
  });

  it("rejects a delivery method the listing doesn't offer", async () => {
    const listingId = await freshListing(USERS.seller1, { deliveryOptions: ["collection"] });
    try {
      await expect(callCreatePurchaseOrder(USERS.buyer1, listingId, "post")).rejects.toThrow(
        /doesn't offer that delivery method/,
      );
    } finally {
      await dropListing(listingId);
    }
  });

  it("rejects 'post' with no address, and 'post' with an address that belongs to someone else", async () => {
    const listingId = await freshListing(USERS.seller1, { deliveryOptions: ["post"] });
    const otherAddressId = await freshAddress(USERS.buyer2);
    try {
      await expect(callCreatePurchaseOrder(USERS.buyer1, listingId, "post", null)).rejects.toThrow(
        /Choose a delivery address/,
      );
      await expect(callCreatePurchaseOrder(USERS.buyer1, listingId, "post", otherAddressId)).rejects.toThrow(
        /Choose a delivery address/,
      );
    } finally {
      await dropListing(listingId);
      await dropAddress(otherAddressId);
    }
  });

  it("rejects self-purchase", async () => {
    const listingId = await freshListing(USERS.seller1, { deliveryOptions: ["collection"] });
    try {
      await expect(callCreatePurchaseOrder(USERS.seller1, listingId, "collection")).rejects.toThrow(
        /can't buy your own listing/,
      );
    } finally {
      await dropListing(listingId);
    }
  });

  it("rejects a listing that isn't active (already reserved)", async () => {
    const listingId = await freshListing(USERS.seller1, { deliveryOptions: ["collection"], status: "reserved" });
    try {
      await expect(callCreatePurchaseOrder(USERS.buyer1, listingId, "collection")).rejects.toThrow(
        /no longer available/,
      );
    } finally {
      await dropListing(listingId);
    }
  });

  // create_purchase_order()'s "This listing doesn't have a Buy Now price"
  // guard (its else-branch v_listing.price_eur is null check) has no
  // reachable test case here: listings_price_required_for_non_auction_check
  // (0046) already guarantees every non-('auction'|'auction_with_buy_now')
  // listing carries a price, so the DB itself can never produce the row this
  // would need — the guard is defense-in-depth against that invariant ever
  // being loosened later, not a currently-exercisable path.

  it("rejects an invalid delivery method string outright", async () => {
    const listingId = await freshListing(USERS.seller1, { deliveryOptions: ["collection", "post"] });
    try {
      await expect(callCreatePurchaseOrder(USERS.buyer1, listingId, "drone_drop")).rejects.toThrow(
        /Choose a valid delivery method/,
      );
    } finally {
      await dropListing(listingId);
    }
  });

  it("rejects an unauthenticated caller (p_caller_id null)", async () => {
    const listingId = await freshListing(USERS.seller1, { deliveryOptions: ["collection"] });
    try {
      await expect(callCreatePurchaseOrder(null, listingId, "collection")).rejects.toThrow(/Not authenticated/);
    } finally {
      await dropListing(listingId);
    }
  });

  it("an auction_with_buy_now purchase claims the buy-now price, ends the auction, and reserves the listing", async () => {
    const listingId = await freshListing(USERS.seller1, {
      deliveryOptions: ["collection"],
      saleType: "auction_with_buy_now",
      priceEur: null,
    });
    const { rows: auctionRows } = await pool.query<{ id: string }>(
      `insert into public.auctions (listing_id, starting_price_cents, buy_now_price_cents, ends_at, status)
       values ($1, 5000, 25000, now() + interval '7 days', 'scheduled')
       returning id`,
      [listingId],
    );
    const auctionId = auctionRows[0].id;
    try {
      const { rows } = await callCreatePurchaseOrder(USERS.buyer1, listingId, "collection");
      const orderId = rows[0].create_purchase_order;

      const { rows: orderRows } = await pool.query("select amount_eur from public.orders where id = $1", [orderId]);
      expect(Number(orderRows[0].amount_eur)).toBe(250);

      const { rows: statusRows } = await pool.query("select status from public.auctions where id = $1", [auctionId]);
      expect(statusRows[0].status).toBe("ended");
    } finally {
      await dropListing(listingId);
    }
  });

  it("rejects Buy It Now on an auction with no buy_now_price_cents set", async () => {
    const listingId = await freshListing(USERS.seller1, {
      deliveryOptions: ["collection"],
      saleType: "auction_with_buy_now",
      priceEur: null,
    });
    await pool.query(
      `insert into public.auctions (listing_id, starting_price_cents, ends_at, status)
       values ($1, 5000, now() + interval '7 days', 'scheduled')`,
      [listingId],
    );
    try {
      await expect(callCreatePurchaseOrder(USERS.buyer1, listingId, "collection")).rejects.toThrow(
        /Buy It Now isn't available/,
      );
    } finally {
      await dropListing(listingId);
    }
  });

  it("neither anon nor an authenticated caller can call create_purchase_order() directly", async () => {
    const listingId = await freshListing(USERS.seller1, { deliveryOptions: ["collection"] });
    try {
      await withRole("authenticated", USERS.buyer1, async (c) => {
        await expect(
          c.query("select public.create_purchase_order($1, $2, $3, $4, $5)", [
            USERS.buyer1,
            listingId,
            "collection",
            null,
            30,
          ]),
        ).rejects.toThrow(/permission denied for function/);
      });
      await withRole("anon", null, async (c) => {
        await expect(
          c.query("select public.create_purchase_order($1, $2, $3, $4, $5)", [
            USERS.buyer1,
            listingId,
            "collection",
            null,
            30,
          ]),
        ).rejects.toThrow(/permission denied for function/);
      });
    } finally {
      await dropListing(listingId);
    }
  });

  it("two concurrent Buy Now attempts on the same listing: exactly one succeeds", async () => {
    const listingId = await freshListing(USERS.seller1, { priceEur: 180, deliveryOptions: ["collection"] });
    try {
      const attempt = (buyerId: string) => callCreatePurchaseOrder(buyerId, listingId, "collection");
      const outcomes = await Promise.allSettled([attempt(USERS.buyer1), attempt(USERS.buyer2)]);

      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failure = outcomes.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(String(failure.reason)).toMatch(/no longer available/);

      const { rows } = await pool.query("select count(*)::int from public.orders where listing_id = $1", [listingId]);
      expect(rows[0].count).toBe(1);
    } finally {
      await dropListing(listingId);
    }
  });
});

describe("finalize_offer_checkout(): delivery choice for an accepted offer", () => {
  async function freshPendingOrder(opts: {
    deliveryMethod?: string;
    listingId?: string | null;
    reservationExpiresAt?: string;
    status?: string;
    paymentStatus?: string;
  } = {}): Promise<{ orderId: string; listingId: string }> {
    const listingId =
      opts.listingId === null ? null : opts.listingId ?? (await freshListing(USERS.seller1, { deliveryOptions: ["post", "collection"] }));
    const { rows } = await pool.query<{ id: string }>(
      `insert into public.orders (
         buyer_id, seller_id, listing_id, listing_title, listing_category, listing_condition,
         amount_eur, platform_fee_eur, total_eur, status, payment_status,
         delivery_method, reservation_expires_at
       ) values ($1, $2, $3, 'x', 'Irons', 'good', 110, 7.7, 117.7, $4, $5, $6, $7)
       returning id`,
      [
        USERS.buyer1,
        USERS.seller1,
        listingId,
        opts.status ?? "pending",
        opts.paymentStatus ?? "unpaid",
        opts.deliveryMethod ?? "collection",
        opts.reservationExpiresAt ?? new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      ],
    );
    return { orderId: rows[0].id, listingId: listingId as string };
  }

  it("finalizes a collection order: sets checkout_completed_at and recomputes total_eur", async () => {
    const { orderId, listingId } = await freshPendingOrder();
    try {
      await callFinalizeOfferCheckout(USERS.buyer1, orderId, "collection");
      const { rows } = await pool.query(
        "select delivery_method, delivery_fee_cents, delivery_detail, total_eur, checkout_completed_at, status from public.orders where id = $1",
        [orderId],
      );
      const order = rows[0];
      expect(order.delivery_method).toBe("collection");
      expect(order.delivery_fee_cents).toBe(0);
      expect(order.delivery_detail).toBe("Collect from the clubhouse");
      expect(Number(order.total_eur)).toBe(117.7);
      expect(order.checkout_completed_at).not.toBeNull();
      // Never touches status — the transition trigger's `when` clause is a
      // no-op here, exactly as 0050's own header comment says.
      expect(order.status).toBe("pending");
    } finally {
      await pool.query("delete from public.orders where id = $1", [orderId]);
      await dropListing(listingId);
    }
  });

  it("finalizes a post order with a saved address, recomputing the delivery fee and total", async () => {
    const { orderId, listingId } = await freshPendingOrder({ deliveryMethod: "collection" });
    const addressId = await freshAddress(USERS.buyer1);
    try {
      await callFinalizeOfferCheckout(USERS.buyer1, orderId, "post", addressId);
      const { rows } = await pool.query(
        "select delivery_fee_cents, delivery_detail, total_eur from public.orders where id = $1",
        [orderId],
      );
      const order = rows[0];
      expect(order.delivery_fee_cents).toBe(600);
      expect(order.delivery_detail).toBe("Brian Buyer, 1 Fairway Drive, Tralee, Kerry V92X1Y2");
      expect(Number(order.total_eur)).toBe(123.7);
    } finally {
      await pool.query("delete from public.orders where id = $1", [orderId]);
      await dropListing(listingId);
      await dropAddress(addressId);
    }
  });

  it("can be called a second time for the same order (buyer changes their mind before paying)", async () => {
    const { orderId, listingId } = await freshPendingOrder();
    const addressId = await freshAddress(USERS.buyer1);
    try {
      await callFinalizeOfferCheckout(USERS.buyer1, orderId, "collection");
      await callFinalizeOfferCheckout(USERS.buyer1, orderId, "post", addressId);
      const { rows } = await pool.query("select delivery_method, delivery_fee_cents from public.orders where id = $1", [
        orderId,
      ]);
      expect(rows[0].delivery_method).toBe("post");
      expect(rows[0].delivery_fee_cents).toBe(600);
    } finally {
      await pool.query("delete from public.orders where id = $1", [orderId]);
      await dropListing(listingId);
      await dropAddress(addressId);
    }
  });

  it("rejects a caller who isn't this order's buyer", async () => {
    const { orderId, listingId } = await freshPendingOrder();
    try {
      await expect(callFinalizeOfferCheckout(USERS.buyer2, orderId, "collection")).rejects.toThrow(/Not authorized/);
    } finally {
      await pool.query("delete from public.orders where id = $1", [orderId]);
      await dropListing(listingId);
    }
  });

  it("rejects an order that is no longer 'pending'", async () => {
    const { orderId, listingId } = await freshPendingOrder({ status: "cancelled" });
    try {
      await expect(callFinalizeOfferCheckout(USERS.buyer1, orderId, "collection")).rejects.toThrow(
        /no longer awaiting checkout/,
      );
    } finally {
      await pool.query("delete from public.orders where id = $1", [orderId]);
      await dropListing(listingId);
    }
  });

  it("rejects an order whose reservation window has lapsed", async () => {
    const { orderId, listingId } = await freshPendingOrder({
      reservationExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    });
    try {
      await expect(callFinalizeOfferCheckout(USERS.buyer1, orderId, "collection")).rejects.toThrow(
        /checkout window has expired/,
      );
    } finally {
      await pool.query("delete from public.orders where id = $1", [orderId]);
      await dropListing(listingId);
    }
  });

  it("rejects an order that has already been paid", async () => {
    const { orderId, listingId } = await freshPendingOrder({ paymentStatus: "paid" });
    try {
      await expect(callFinalizeOfferCheckout(USERS.buyer1, orderId, "collection")).rejects.toThrow(
        /already been paid/,
      );
    } finally {
      await pool.query("delete from public.orders where id = $1", [orderId]);
      await dropListing(listingId);
    }
  });

  it("rejects a delivery method the underlying listing doesn't offer", async () => {
    const { orderId, listingId } = await freshPendingOrder();
    await pool.query("update public.listings set delivery_options = array['collection'] where id = $1", [listingId]);
    try {
      await expect(callFinalizeOfferCheckout(USERS.buyer1, orderId, "post")).rejects.toThrow(
        /doesn't offer that delivery method/,
      );
    } finally {
      await pool.query("delete from public.orders where id = $1", [orderId]);
      await dropListing(listingId);
    }
  });

  it("falls back to allowing any delivery method when the order's listing is gone (on delete set null)", async () => {
    const { orderId } = await freshPendingOrder();
    // listing_id already went to null via the FK's own ON DELETE SET NULL —
    // simulate it directly rather than actually deleting a fresh listing,
    // since this order has no listing row to drop in its own finally either
    // way once this runs.
    await pool.query("update public.orders set listing_id = null where id = $1", [orderId]);
    try {
      await callFinalizeOfferCheckout(USERS.buyer1, orderId, "post", await freshAddress(USERS.buyer1));
      const { rows } = await pool.query("select delivery_method from public.orders where id = $1", [orderId]);
      expect(rows[0].delivery_method).toBe("post");
    } finally {
      await pool.query("delete from public.orders where id = $1", [orderId]);
    }
  });

  it("neither anon nor an authenticated caller can call finalize_offer_checkout() directly", async () => {
    const { orderId, listingId } = await freshPendingOrder();
    try {
      await withRole("authenticated", USERS.buyer1, async (c) => {
        await expect(
          c.query("select public.finalize_offer_checkout($1, $2, $3, $4)", [USERS.buyer1, orderId, "collection", null]),
        ).rejects.toThrow(/permission denied for function/);
      });
      await withRole("anon", null, async (c) => {
        await expect(
          c.query("select public.finalize_offer_checkout($1, $2, $3, $4)", [USERS.buyer1, orderId, "collection", null]),
        ).rejects.toThrow(/permission denied for function/);
      });
    } finally {
      await pool.query("delete from public.orders where id = $1", [orderId]);
      await dropListing(listingId);
    }
  });
});

// Sanity check that setIdentity is still exercised somewhere in this suite
// (unused-import guard) — a second identity legitimately touching the same
// already-open transaction, mirroring how offer-workflow-race.test.ts's own
// two-party scenarios are structured elsewhere in this app.
describe("addresses: a second identity in the same transaction never sees the first's row", () => {
  it("switching identity mid-transaction re-scopes what's visible", async () => {
    const addressId = await freshAddress(USERS.buyer1);
    try {
      await withRole("authenticated", USERS.buyer1, async (c) => {
        const mine = await c.query("select id from public.addresses where id = $1", [addressId]);
        expect(mine.rowCount).toBe(1);

        await setIdentity(c, USERS.buyer2);
        const theirs = await c.query("select id from public.addresses where id = $1", [addressId]);
        expectZeroRows(theirs);
      });
    } finally {
      await dropAddress(addressId);
    }
  });
});
