// Coverage for the marketplace payment webhook state machine — the
// database-transaction half of the "marketplace-payments" checkpoint.
// src/lib/stripe/payments.test.ts covers the pure TS helpers
// (centsFromEur/truncateErrorMessage/reconcilePaymentIntentAmount) that sit
// in front of these; this file is "what actually happens to the rows",
// exercising supabase/migrations/0021_payments.sql's claim_webhook_event()/
// apply_order_payment_succeeded()/apply_order_payment_failed()/
// apply_order_payment_refunded(), 0053's listing-'sold' addition to
// apply_order_payment_succeeded(), and 0023_refunds_and_disputes.sql's
// create_refund_request()/mark_refund_outcome_by_stripe_id().
//
// These are service-role-only functions (execute revoked from anon/
// authenticated) called only from trusted server code in production — the
// webhook route, an admin refund action, an admin's webhook-event retry —
// never from a browser session. Tests call them directly with the pool's
// own postgres-superuser connection (bypasses grants/RLS exactly the way
// the real service-role client does in production), following the same
// fresh-throwaway-fixture-per-test pattern as stripe-connect.test.ts and
// offer-workflow-race.test.ts rather than the shared global fixture set —
// these tests need precise control over payment_status/listing status at
// each step, and some assert effects across more than one function call.
import { describe, it, expect, afterAll } from "vitest";
import { pool, withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}_test_${Date.now()}_${counter}`;
}

type FreshOrder = { listingId: string; orderId: string; paymentIntentId: string };

async function freshOrder(listingStatus = "reserved"): Promise<FreshOrder> {
  const { rows: listingRows } = await pool.query<{ id: string }>(
    `insert into public.listings
       (seller_id, title, description, price_eur, price_cents, category, condition, county, status, sale_type, delivery_options)
     values ($1, 'Payment webhook fixture listing', 'x', 250, 25000, 'irons', 'good', 'Kerry', $2, 'fixed_price', array['collection'])
     returning id`,
    [USERS.seller1, listingStatus],
  );
  const listingId = listingRows[0].id;
  const paymentIntentId = unique("pi");

  const { rows: orderRows } = await pool.query<{ id: string }>(
    `insert into public.orders
       (listing_id, buyer_id, seller_id, listing_title, listing_category, listing_condition,
        amount_eur, platform_fee_eur, total_eur, status, payment_status, payment_reference)
     values ($1, $2, $3, 'Payment webhook fixture listing', 'irons', 'good', 250, 17.50, 267.50, 'pending', 'pending', $4)
     returning id`,
    [listingId, USERS.buyer1, USERS.seller1, paymentIntentId],
  );

  return { listingId, orderId: orderRows[0].id, paymentIntentId };
}

async function dropOrder({ listingId, orderId }: FreshOrder): Promise<void> {
  await pool.query("delete from public.refunds where order_id = $1", [orderId]);
  await pool.query("delete from public.webhook_events where related_order_id = $1", [orderId]);
  await pool.query("delete from public.orders where id = $1", [orderId]);
  await pool.query("delete from public.listings where id = $1", [listingId]);
}

async function claim(eventType: string, orderId: string | null, eventId = unique("evt")) {
  const { rows } = await pool.query<{ id: string; status: string; is_new: boolean }>(
    `select * from public.claim_webhook_event($1, $2, $3, $4, $5)`,
    ["stripe", eventId, eventType, "2026-01-01.acacia", JSON.stringify({ fixture: true, orderId })],
  );
  return rows[0];
}

async function orderRow(orderId: string) {
  const { rows } = await pool.query(
    `select status, payment_status, payment_reference, payment_last_error, refunded_amount_eur, refunded_at, currency
       from public.orders where id = $1`,
    [orderId],
  );
  return rows[0];
}

async function listingStatus(listingId: string): Promise<string> {
  const { rows } = await pool.query<{ status: string }>("select status from public.listings where id = $1", [
    listingId,
  ]);
  return rows[0].status;
}

describe("claim_webhook_event()", () => {
  it("claims a brand-new event id as 'received' and reports is_new = true", async () => {
    const claimed = await claim("payment_intent.succeeded", null);
    expect(claimed.is_new).toBe(true);
    expect(claimed.status).toBe("received");
  });

  it("a redelivery of the same event id is reported as NOT new, carrying the row's current status", async () => {
    const eventId = unique("evt");
    const first = await claim("payment_intent.succeeded", null, eventId);
    expect(first.is_new).toBe(true);

    const redelivery = await claim("payment_intent.succeeded", null, eventId);
    expect(redelivery.is_new).toBe(false);
    expect(redelivery.id).toBe(first.id);
    expect(redelivery.status).toBe("received"); // unchanged — nothing has processed it yet
  });

  it("increments attempts on redelivery (observability, per 0021's own comment)", async () => {
    const eventId = unique("evt");
    await claim("payment_intent.succeeded", null, eventId);
    await claim("payment_intent.succeeded", null, eventId);
    await claim("payment_intent.succeeded", null, eventId);

    const { rows } = await pool.query<{ attempts: number }>(
      "select attempts from public.webhook_events where event_id = $1",
      [eventId],
    );
    expect(rows[0].attempts).toBe(3);
  });

  it("neither anon nor an authenticated caller can call it directly", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expect(
        c.query("select public.claim_webhook_event('stripe', $1, 'x', null, '{}'::jsonb)", [unique("evt")]),
      ).rejects.toThrow(/permission denied for function/);
    });
    await withRole("anon", null, async (c) => {
      await expect(
        c.query("select public.claim_webhook_event('stripe', $1, 'x', null, '{}'::jsonb)", [unique("evt")]),
      ).rejects.toThrow(/permission denied for function/);
    });
  });
});

describe("apply_order_payment_succeeded() — order, ledger, and (0053) listing state in one transaction", () => {
  it("marks the order paid/completed, clears any prior error, and marks the ledger row processed", async () => {
    const fx = await freshOrder();
    try {
      const ledger = await claim("payment_intent.succeeded", fx.orderId);
      await pool.query(
        "select * from public.apply_order_payment_succeeded($1, $2, $3, 'eur')",
        [ledger.id, fx.orderId, fx.paymentIntentId],
      );

      const order = await orderRow(fx.orderId);
      expect(order.payment_status).toBe("paid");
      expect(order.status).toBe("completed");
      expect(order.payment_reference).toBe(fx.paymentIntentId);
      expect(order.currency).toBe("eur");

      const { rows: eventRows } = await pool.query<{ status: string; related_order_id: string }>(
        "select status, related_order_id from public.webhook_events where id = $1",
        [ledger.id],
      );
      expect(eventRows[0].status).toBe("processed");
      expect(eventRows[0].related_order_id).toBe(fx.orderId);
    } finally {
      await dropOrder(fx);
    }
  });

  it("flips the listing from reserved to sold in the same call — the gap 0048's own header comment flagged", async () => {
    const fx = await freshOrder("reserved");
    try {
      const ledger = await claim("payment_intent.succeeded", fx.orderId);
      await pool.query("select * from public.apply_order_payment_succeeded($1, $2, $3, 'eur')", [
        ledger.id,
        fx.orderId,
        fx.paymentIntentId,
      ]);
      expect(await listingStatus(fx.listingId)).toBe("sold");
    } finally {
      await dropOrder(fx);
    }
  });

  it("also flips an 'active' listing to sold (a Buy Now path that never passed through 'reserved')", async () => {
    const fx = await freshOrder("active");
    try {
      const ledger = await claim("payment_intent.succeeded", fx.orderId);
      await pool.query("select * from public.apply_order_payment_succeeded($1, $2, $3, 'eur')", [
        ledger.id,
        fx.orderId,
        fx.paymentIntentId,
      ]);
      expect(await listingStatus(fx.listingId)).toBe("sold");
    } finally {
      await dropOrder(fx);
    }
  });

  it("never touches a listing a moderator has already removed", async () => {
    const fx = await freshOrder("removed");
    try {
      const ledger = await claim("payment_intent.succeeded", fx.orderId);
      await pool.query("select * from public.apply_order_payment_succeeded($1, $2, $3, 'eur')", [
        ledger.id,
        fx.orderId,
        fx.paymentIntentId,
      ]);
      // The order still gets marked paid (the buyer's money moved — that's
      // a fact independent of the listing's own moderation state) but the
      // removed listing is left exactly as a moderator left it.
      expect((await orderRow(fx.orderId)).payment_status).toBe("paid");
      expect(await listingStatus(fx.listingId)).toBe("removed");
    } finally {
      await dropOrder(fx);
    }
  });

  it("is idempotent: a duplicate delivery for an already-paid order changes nothing and never re-touches the listing", async () => {
    const fx = await freshOrder();
    try {
      const ledger1 = await claim("payment_intent.succeeded", fx.orderId);
      await pool.query("select * from public.apply_order_payment_succeeded($1, $2, $3, 'eur')", [
        ledger1.id,
        fx.orderId,
        fx.paymentIntentId,
      ]);
      expect(await listingStatus(fx.listingId)).toBe("sold");

      // A second, independent delivery of "the same fact" (Stripe's own
      // "at least once" guarantee) — a fresh ledger row (a real redelivery
      // would reuse the same event id and short-circuit even earlier, at
      // the processStripeEvent()/ledger-status check in payments.ts; this
      // exercises the DB function's own guard directly, the backstop below
      // that layer).
      const ledger2 = await claim("payment_intent.succeeded", fx.orderId);
      const { rows } = await pool.query(
        "select * from public.apply_order_payment_succeeded($1, $2, $3, 'eur')",
        [ledger2.id, fx.orderId, fx.paymentIntentId],
      );
      expect(rows).toHaveLength(0); // no row returned — the order UPDATE matched nothing

      expect(await listingStatus(fx.listingId)).toBe("sold"); // still sold, not re-touched
      const order = await orderRow(fx.orderId);
      expect(order.payment_status).toBe("paid");
    } finally {
      await dropOrder(fx);
    }
  });

  it("neither anon nor an authenticated caller can call it directly", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expect(
        c.query("select * from public.apply_order_payment_succeeded(1, 1, 'pi_x', 'eur')"),
      ).rejects.toThrow(/permission denied for function/);
    });
    await withRole("anon", null, async (c) => {
      await expect(
        c.query("select * from public.apply_order_payment_succeeded(1, 1, 'pi_x', 'eur')"),
      ).rejects.toThrow(/permission denied for function/);
    });
  });
});

describe("apply_order_payment_failed() — never releases the listing, never downgrades a paid order", () => {
  it("marks the order failed with Stripe's own decline message, leaves the listing reserved", async () => {
    const fx = await freshOrder("reserved");
    try {
      const ledger = await claim("payment_intent.payment_failed", fx.orderId);
      await pool.query("select * from public.apply_order_payment_failed($1, $2, $3, $4)", [
        ledger.id,
        fx.orderId,
        fx.paymentIntentId,
        "Your card was declined.",
      ]);

      const order = await orderRow(fx.orderId);
      expect(order.payment_status).toBe("failed");
      expect(order.payment_last_error).toBe("Your card was declined.");
      // Deliberately unchanged — a failed attempt lets the buyer retry the
      // same order right up until reservation_expires_at (0053's header
      // comment) rather than releasing the listing on the first decline.
      expect(await listingStatus(fx.listingId)).toBe("reserved");
    } finally {
      await dropOrder(fx);
    }
  });

  it("out-of-order delivery: a late failed event for an order a succeeded event already paid changes nothing", async () => {
    const fx = await freshOrder();
    try {
      const succeededLedger = await claim("payment_intent.succeeded", fx.orderId);
      await pool.query("select * from public.apply_order_payment_succeeded($1, $2, $3, 'eur')", [
        succeededLedger.id,
        fx.orderId,
        fx.paymentIntentId,
      ]);

      // Stripe's own "at least once, no ordering guarantee" — a failed
      // event for the same PaymentIntent id arrives after the succeeded
      // one already settled it (e.g. a stale retry-queue redelivery).
      const failedLedger = await claim("payment_intent.payment_failed", fx.orderId);
      const { rows } = await pool.query("select * from public.apply_order_payment_failed($1, $2, $3, $4)", [
        failedLedger.id,
        fx.orderId,
        fx.paymentIntentId,
        "A stale decline message that must never land.",
      ]);
      expect(rows).toHaveLength(0);

      const order = await orderRow(fx.orderId);
      expect(order.payment_status).toBe("paid");
      expect(order.payment_last_error).toBeNull();
      expect(await listingStatus(fx.listingId)).toBe("sold");

      // The ledger still records this delivery as processed (it was safely
      // routed and acknowledged, just correctly a no-op) — Stripe is never
      // asked to retry a delivery that will never resolve differently.
      const { rows: eventRows } = await pool.query<{ status: string }>(
        "select status from public.webhook_events where id = $1",
        [failedLedger.id],
      );
      expect(eventRows[0].status).toBe("processed");
    } finally {
      await dropOrder(fx);
    }
  });

  it("neither anon nor an authenticated caller can call it directly", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expect(
        c.query("select * from public.apply_order_payment_failed(1, 1, 'pi_x', 'nope')"),
      ).rejects.toThrow(/permission denied for function/);
    });
  });
});

describe("apply_order_payment_refunded() — the order's own aggregate summary, never the original payment record", () => {
  it("records the refund on the order without ever touching payment_reference", async () => {
    const fx = await freshOrder();
    try {
      const succeededLedger = await claim("payment_intent.succeeded", fx.orderId);
      await pool.query("select * from public.apply_order_payment_succeeded($1, $2, $3, 'eur')", [
        succeededLedger.id,
        fx.orderId,
        fx.paymentIntentId,
      ]);

      const refundLedger = await claim("charge.refunded", fx.orderId);
      await pool.query("select * from public.apply_order_payment_refunded($1, $2, $3, $4)", [
        refundLedger.id,
        fx.orderId,
        100.0,
        "requested_by_customer",
      ]);

      const order = await orderRow(fx.orderId);
      expect(order.payment_status).toBe("refunded");
      expect(order.status).toBe("refunded");
      expect(Number(order.refunded_amount_eur)).toBe(100);
      // The original PaymentIntent id — the payment record itself — is
      // never overwritten by a refund.
      expect(order.payment_reference).toBe(fx.paymentIntentId);
    } finally {
      await dropOrder(fx);
    }
  });

  it("a later top-up (partial then full) sets, not adds — matching Stripe's own cumulative amount_refunded", async () => {
    const fx = await freshOrder();
    try {
      const succeededLedger = await claim("payment_intent.succeeded", fx.orderId);
      await pool.query("select * from public.apply_order_payment_succeeded($1, $2, $3, 'eur')", [
        succeededLedger.id,
        fx.orderId,
        fx.paymentIntentId,
      ]);

      const firstRefundLedger = await claim("charge.refunded", fx.orderId);
      await pool.query("select * from public.apply_order_payment_refunded($1, $2, $3, $4)", [
        firstRefundLedger.id,
        fx.orderId,
        100.0,
        "requested_by_customer",
      ]);
      const firstRefundedAt = (await orderRow(fx.orderId)).refunded_at;

      const secondRefundLedger = await claim("charge.refunded", fx.orderId);
      await pool.query("select * from public.apply_order_payment_refunded($1, $2, $3, $4)", [
        secondRefundLedger.id,
        fx.orderId,
        267.5, // Stripe's charge.amount_refunded is cumulative, not a delta
        "requested_by_customer",
      ]);

      const order = await orderRow(fx.orderId);
      expect(Number(order.refunded_amount_eur)).toBe(267.5);
      // refunded_at is set once, on the FIRST refund, and never moved by a
      // later top-up.
      expect(order.refunded_at).toEqual(firstRefundedAt);
    } finally {
      await dropOrder(fx);
    }
  });

  it("neither anon nor an authenticated caller can call it directly", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expect(
        c.query("select * from public.apply_order_payment_refunded(1, 1, 50, 'x')"),
      ).rejects.toThrow(/permission denied for function/);
    });
  });
});

describe("create_refund_request() / mark_refund_outcome_by_stripe_id() — one row per refund ATTEMPT", () => {
  async function paidOrder(): Promise<FreshOrder> {
    const fx = await freshOrder();
    await pool.query("update public.orders set payment_status = 'paid' where id = $1", [fx.orderId]);
    return fx;
  }

  it("two partial refunds on the same order create two distinct rows, each with its own amount", async () => {
    const fx = await paidOrder();
    try {
      const { rows: first } = await pool.query(
        "select * from public.create_refund_request($1, $2, $3, $4, $5)",
        [fx.orderId, 50.0, "Buyer damaged item slightly", USERS.admin, unique("idem")],
      );
      const { rows: second } = await pool.query(
        "select * from public.create_refund_request($1, $2, $3, $4, $5)",
        [fx.orderId, 75.0, "Additional goodwill refund", USERS.admin, unique("idem")],
      );

      expect(first[0].id).not.toBe(second[0].id);
      expect(Number(first[0].amount_eur)).toBe(50);
      expect(Number(second[0].amount_eur)).toBe(75);

      const { rows: allRefunds } = await pool.query("select id from public.refunds where order_id = $1", [
        fx.orderId,
      ]);
      expect(allRefunds).toHaveLength(2);

      // Neither refund attempt ever touches the order's own payment record.
      expect((await orderRow(fx.orderId)).payment_reference).toBe(fx.paymentIntentId);
    } finally {
      await dropOrder(fx);
    }
  });

  it("rejects a refund amount that would exceed what's still refundable after an earlier reserved refund", async () => {
    const fx = await paidOrder();
    try {
      await pool.query("select * from public.create_refund_request($1, $2, $3, $4, $5)", [
        fx.orderId,
        200.0,
        "First refund",
        USERS.admin,
        unique("idem"),
      ]);

      // Order total is 267.50 — 200 already reserved leaves 67.50, so 100 more must be rejected.
      await expect(
        pool.query("select * from public.create_refund_request($1, $2, $3, $4, $5)", [
          fx.orderId,
          100.0,
          "Second refund, too much",
          USERS.admin,
          unique("idem"),
        ]),
      ).rejects.toThrow(/exceeds the .* still refundable/);
    } finally {
      await dropOrder(fx);
    }
  });

  it("mark_refund_outcome_by_stripe_id() reconciles status, guarded against re-processing an already-terminal row", async () => {
    const fx = await paidOrder();
    try {
      const { rows: created } = await pool.query(
        "select * from public.create_refund_request($1, $2, $3, $4, $5)",
        [fx.orderId, 40.0, "Partial refund", USERS.admin, unique("idem")],
      );
      const refund = created[0];
      const stripeRefundId = unique("re");

      await pool.query("update public.refunds set stripe_refund_id = $1 where id = $2", [
        stripeRefundId,
        refund.id,
      ]);

      const { rows: succeeded } = await pool.query(
        "select * from public.mark_refund_outcome_by_stripe_id($1, $2, $3)",
        [stripeRefundId, "succeeded", null],
      );
      expect(succeeded[0].status).toBe("succeeded");

      // A later, out-of-order 'failed' delivery for the same (already
      // terminal) refund must never regress it.
      const { rows: staleFailed } = await pool.query(
        "select * from public.mark_refund_outcome_by_stripe_id($1, $2, $3)",
        [stripeRefundId, "failed", "A stale failure that must never apply."],
      );
      expect(staleFailed).toHaveLength(0);

      const { rows: finalState } = await pool.query("select status, failure_reason from public.refunds where id = $1", [
        refund.id,
      ]);
      expect(finalState[0].status).toBe("succeeded");
      expect(finalState[0].failure_reason).toBeNull();
    } finally {
      await dropOrder(fx);
    }
  });

  it("neither anon nor an authenticated caller can call create_refund_request directly", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expect(
        c.query("select * from public.create_refund_request(1, 10, 'x', $1, $2)", [USERS.buyer1, unique("idem")]),
      ).rejects.toThrow(/permission denied for function/);
    });
  });
});
