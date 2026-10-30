// 0204_book_a_pro.sql — Book a pro.
//
// Cast:
//   seller1  the pro
//   buyer1   books a lesson
//   buyer2   another member
//
// What must hold:
//   - a PGA pro gives a PGA number, anyone else a qualification; a pending pro is seen only by themselves
//   - only an approved pro's lessons can be booked; never by the pro themselves
//   - a time can be held by one member; it then drops out of the free times; the other member can't see whose it is
//   - the golfer and the pro see the booking; nobody else; no direct writes
//   - the money functions are the service's only; the price must match; a lapsed hold that clashes is refunded
//   - cancelling: the pro always refunds in full; the golfer in full inside the free window, nothing after
//   - what's due to the pro is the price less PinPals' 10%, once the lesson is over
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const PRO = USERS.seller1;
const GOLFER = USERS.buyer1;
const OTHER = USERS.buyer2;

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

async function rejects(c: PoolClient, sql: string, params: unknown[], pattern?: RegExp): Promise<void> {
  await c.query("savepoint attempt");
  let message: string | null = null;
  try {
    await c.query(sql, params);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  await c.query("rollback to savepoint attempt");
  if (message == null) throw new Error(`Expected to be rejected: ${sql}`);
  if (pattern && !pattern.test(message)) throw new Error(`Rejected with "${message}", expected ${pattern}`);
}

async function service<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

const APPLY = "select public.pro_apply($1::jsonb) as id";
const pga = (x: object = {}) =>
  JSON.stringify({ kind: "pga", pga_number: "IE-1234", club: "Portmarnock Golf Club", county: "Dublin", bio: "Twenty years teaching.", cancel_policy: "24h", ...x });

/** The pro applies, is approved, offers a 60-minute lesson at €80 and teaches every day, all day. */
async function setUpPro(c: PoolClient, policy = "24h"): Promise<{ pro: string; service: string }> {
  await as(c, PRO);
  const pro = (await c.query<{ id: string }>(APPLY, [pga({ cancel_policy: policy })])).rows[0].id;
  await service(c, () => c.query("update public.pros set status = 'approved' where id = $1", [pro]));
  const svc = (
    await c.query<{ id: string }>("select public.pro_service_save(null, $1::jsonb) as id", [
      JSON.stringify({ kind: "lesson", title: "Lesson", details: "With video", minutes: 60, price_cents: 8000 }),
    ])
  ).rows[0].id;
  const week = Array.from({ length: 7 }, (_, d) => ({ weekday: d, start_min: 0, end_min: 1440 }));
  await c.query("select public.pro_hours_set($1::jsonb)", [JSON.stringify(week)]);
  return { pro, service: svc };
}

/** Free start times, days ahead (Irish date). */
async function slots(c: PoolClient, serviceId: string, daysAhead: number, days = 1): Promise<string[]> {
  const { rows } = await c.query<{ starts_at: Date }>(
    "select starts_at from public.pro_slots($1, ((now() at time zone 'Europe/Dublin')::date + $2::integer), $3)",
    [serviceId, daysAhead, days]
  );
  return rows.map((r) => r.starts_at.toISOString());
}

const BOOK = "select public.pro_book($1, $2::timestamptz, $3::text[], $4) as id";

describe("book a pro", () => {
  it("applying: PGA number or qualification; pending is private; can't be booked", async () => {
    await withRole("authenticated", PRO, async (c) => {
      await as(c, PRO);
      await rejects(c, APPLY, [pga({ pga_number: "" })], /PGA membership number/);
      await rejects(c, APPLY, [pga({ kind: "teaching", qualification: "" })], /qualification/);
      await rejects(c, APPLY, [pga({ cancel_policy: "1h" })], /cancellation terms/);
      await rejects(c, APPLY, [pga({ bio: "x".repeat(501) })], /bio/);
      const id = (await c.query<{ id: string }>(APPLY, [pga()])).rows[0].id;
      const svc = (
        await c.query<{ id: string }>("select public.pro_service_save(null, $1::jsonb) as id", [
          JSON.stringify({ kind: "lesson", title: "Lesson", minutes: 60, price_cents: 8000 }),
        ])
      ).rows[0].id;
      await rejects(c, "select public.pro_service_save(null, $1::jsonb)", [JSON.stringify({ kind: "lesson", title: "Lesson", minutes: 50, price_cents: 8000 })], /15-minute/);
      expect((await c.query("select status from public.pros where id = $1", [id])).rows[0].status).toBe("pending");

      await as(c, OTHER);
      expect((await c.query("select 1 from public.pros where id = $1", [id])).rowCount).toBe(0);
      expect((await c.query("select 1 from public.pro_services where id = $1", [svc])).rowCount).toBe(0);
      await rejects(c, BOOK, [svc, new Date(Date.now() + 3 * 86400e3).toISOString(), [], null], /isn't taking bookings/);

      // A non-PGA teaching pro is welcome too, with their qualification.
      await as(c, GOLFER);
      await c.query(APPLY, [JSON.stringify({ kind: "teaching", qualification: "Level 3 coach, Golf Ireland", club: "Malahide", cancel_policy: "none" })]);
      expect((await c.query("select kind, pga_number from public.pros where member_id = $1", [GOLFER])).rows[0]).toEqual({ kind: "teaching", pga_number: null });
    });
  });

  it("booking: one member per time, never yourself; private to the two of you; no direct writes", async () => {
    await withRole("authenticated", PRO, async (c) => {
      const { pro, service: svc } = await setUpPro(c);
      const free = await slots(c, svc, 3);
      expect(free.length).toBeGreaterThan(10);
      await rejects(c, BOOK, [svc, free[0], [], null], /can't book yourself/);
      await rejects(c, "select public.pro_hours_set($1::jsonb)", [JSON.stringify([{ weekday: 0, start_min: 600, end_min: 590 }])], /don't look right/);

      await as(c, GOLFER);
      await rejects(c, BOOK, [svc, free[0], ["Juggling"], null], /from the list/);
      const booking = (await c.query<{ id: string }>(BOOK, [svc, free[0], ["Driver"], "Slicing it"])).rows[0].id;
      expect((await slots(c, svc, 3))).not.toContain(free[0]);
      const row = (await c.query("select status, price_cents, commission_cents, free_cancel_until from public.pro_bookings where id = $1", [booking])).rows[0];
      expect(row.status).toBe("pending_payment");
      expect(row.price_cents).toBe(8000);
      expect(row.commission_cents).toBe(800);
      expect(new Date(row.free_cancel_until).getTime()).toBe(new Date(free[0]).getTime() - 24 * 3600e3);

      await as(c, OTHER);
      await rejects(c, BOOK, [svc, free[0], [], null], /just gone/);
      expect((await c.query("select 1 from public.pro_bookings where id = $1", [booking])).rowCount).toBe(0);
      await rejects(c, "insert into public.pro_bookings (pro_id, member_id, title, starts_at, ends_at, price_cents, commission_cents, cancel_policy) values ($1, $2, 'x', now(), now() + interval '1 hour', 1, 0, '24h')", [pro, OTHER]);
      await rejects(c, "update public.pros set status = 'approved' where member_id = $1", [OTHER]);

      await as(c, PRO);
      expect((await c.query("select member_id from public.pro_bookings where id = $1", [booking])).rows[0].member_id).toBe(GOLFER);
      await rejects(c, "update public.pro_bookings set payment_status = 'paid' where id = $1", [booking]);
    });
  });

  it("paying: the service's only; the price must match; a lapsed hold that clashes is refunded", async () => {
    await withRole("authenticated", PRO, async (c) => {
      const { service: svc } = await setUpPro(c);
      const [first] = await slots(c, svc, 4);
      await as(c, GOLFER);
      const a = (await c.query<{ id: string }>(BOOK, [svc, first, [], null])).rows[0].id;
      await rejects(c, "select public.pro_booking_paid($1, 'pi_x', 8000)", [a], /permission denied/);
      await rejects(c, "select public.pro_bookings_due()", [], /permission denied/);

      const paid = (sql: string, args: unknown[]) => service(c, async () => (await c.query<{ r: string }>(sql, args)).rows[0].r);
      expect(await paid("select public.pro_booking_paid($1, 'pi_a', 7000) as r", [a])).toBe("mismatch");
      expect(await paid("select public.pro_booking_paid($1, 'pi_a', 8000) as r", [a])).toBe("booked");
      expect(await paid("select public.pro_booking_paid($1, 'pi_a', 8000) as r", [a])).toBe("already");

      // Someone else's hold lapsed; meanwhile the time went to the golfer above.
      await as(c, OTHER);
      const [second] = await slots(c, svc, 5);
      const b = (await c.query<{ id: string }>(BOOK, [svc, second, [], null])).rows[0].id;
      await service(c, () => c.query("update public.pro_bookings set starts_at = $2, ends_at = $3, status = 'expired' where id = $1", [b, first, new Date(new Date(first).getTime() + 3600e3).toISOString()]));
      expect(await paid("select public.pro_booking_paid($1, 'pi_b', 8000) as r", [b])).toBe("clash");
      const clash = await service(c, async () => (await c.query("select status, cancelled_by, refund_cents, refund_status from public.pro_bookings where id = $1", [b])).rows[0]);
      expect(clash).toEqual({ status: "cancelled", cancelled_by: "system", refund_cents: 8000, refund_status: "pending" });
    });
  });

  it("cancelling: pro always refunds; golfer inside the window in full, after it nothing — and the pro is paid", async () => {
    await withRole("authenticated", PRO, async (c) => {
      const { service: svc } = await setUpPro(c, "48h");
      const markPaid = (id: string, pi: string) => service(c, () => c.query("select public.pro_booking_paid($1, $2, 8000)", [id, pi]));
      const CANCEL = "select * from public.pro_booking_cancel($1, $2)";

      // Golfer, a week ahead: inside the 48-hour window.
      const [early] = await slots(c, svc, 7);
      await as(c, GOLFER);
      const e = (await c.query<{ id: string }>(BOOK, [svc, early, [], null])).rows[0].id;
      await markPaid(e, "pi_e");
      await as(c, OTHER);
      await rejects(c, CANCEL, [e, null], /Only the golfer or the pro/);
      await as(c, GOLFER);
      const r1 = (await c.query(CANCEL, [e, "Can't make it"])).rows[0];
      expect(r1).toMatchObject({ refund_cents: 8000, payment_reference: "pi_e", other_party: PRO, by_pro: false });
      await rejects(c, CANCEL, [e, null], /already been cancelled/);

      // Golfer, tomorrow: past the 48-hour window — no refund, payout stays held.
      const [late] = await slots(c, svc, 1);
      const l = (await c.query<{ id: string }>(BOOK, [svc, late, [], null])).rows[0].id;
      await markPaid(l, "pi_l");
      const r2 = (await c.query(CANCEL, [l, null])).rows[0];
      expect(r2.refund_cents).toBe(0);
      expect((await c.query("select payout_status from public.pro_bookings where id = $1", [l])).rows[0].payout_status).toBe("held");

      // The pro cancels: in full, whenever.
      const [another] = await slots(c, svc, 2);
      const p = (await c.query<{ id: string }>(BOOK, [svc, another, [], null])).rows[0].id;
      await markPaid(p, "pi_p");
      await as(c, PRO);
      const r3 = (await c.query(CANCEL, [p, "Course closed"])).rows[0];
      expect(r3).toMatchObject({ refund_cents: 8000, other_party: GOLFER, by_pro: true });

      // Over: the late cancellation is due to the pro, less 10%.
      const due = await service(c, async () => {
        await c.query("update public.pro_bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = $1", [l]);
        return (await c.query("select id, pro_member, payout_cents from public.pro_bookings_due()")).rows;
      });
      expect(due).toContainEqual({ id: l, pro_member: PRO, payout_cents: 7200 });
      expect(due.map((d) => d.id)).not.toContain(e);
      expect(due.map((d) => d.id)).not.toContain(p);
    });
  });

  it("holds nobody paid for expire and free the time", async () => {
    await withRole("authenticated", PRO, async (c) => {
      const { service: svc } = await setUpPro(c);
      const [t] = await slots(c, svc, 6);
      await as(c, GOLFER);
      const id = (await c.query<{ id: string }>(BOOK, [svc, t, [], null])).rows[0].id;
      await service(c, async () => {
        await c.query("update public.pro_bookings set hold_until = now() - interval '1 minute' where id = $1", [id]);
        await c.query("select public.pro_bookings_expire()");
      });
      expect((await c.query("select status from public.pro_bookings where id = $1", [id])).rows[0].status).toBe("expired");
      expect(await slots(c, svc, 6)).toContain(t);
    });
  });
});
