import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { formatPriceCents } from "@/lib/format";
import { notifyUser } from "@/lib/notifications-server";
import { getStripeClient } from "@/lib/stripe/client";
import { isSellerPaymentReady, sellerOnboardingStatus } from "@/lib/stripe/connect";
import type { StripeConnectedAccount } from "@/lib/types";

/**
 * Book a pro (0204), the money.
 *
 * A booking holds its time for 15 minutes (pro_book()). The golfer pays on
 * the website's /dashboard/lessons/<id> page, which asks
 * createLessonPaymentIntent() for a PaymentIntent. The price comes from the
 * booking row, never the browser. Separate charges and transfers, like the
 * marketplace (0114): the money lands on PinPals and is held.
 *
 *   - payment_intent.succeeded → confirmLessonPayment() → pro_booking_paid().
 *     If the hold had lapsed and the time went to someone else, the database
 *     cancels it and this refunds in full.
 *   - cancelling (/api/app/lessons/<id>/cancel) → pro_booking_cancel() decides
 *     the refund → refundLesson().
 *   - once a lesson is over (or the golfer cancelled too late for a refund),
 *     releaseDueLessons() transfers the price less PinPals' 10% to the pro.
 *
 * Every Stripe call carries an idempotency key per booking, and every update
 * is guarded on the state it expects, so a webhook redelivery or two sweeps
 * at once move money once.
 */

export const LESSON_METADATA_KEY = "pinpals_lesson_id";

type BookingRow = {
  id: number;
  pro_id: number;
  member_id: string;
  title: string;
  starts_at: string;
  price_cents: number;
  commission_cents: number;
  status: string;
  hold_until: string;
  payment_status: string;
  payment_reference: string | null;
  refund_cents: number;
  refund_status: string | null;
  pros: { member_id: string } | null;
};

const BOOKING_COLUMNS =
  "id, pro_id, member_id, title, starts_at, price_cents, commission_cents, status, hold_until, payment_status, payment_reference, refund_cents, refund_status, pros!inner(member_id)";

async function loadBooking(admin: SupabaseClient, id: number): Promise<BookingRow | null> {
  const { data } = await admin.from("pro_bookings").select(BOOKING_COLUMNS).eq("id", id).maybeSingle<BookingRow>();
  return data ?? null;
}

/** "Tue 3 Nov, 11:30", in Irish time. */
export function lessonWhen(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" }).format(d);
  const time = new Intl.DateTimeFormat("en-IE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Dublin" }).format(d);
  return `${day}, ${time}`;
}

/** The booking a PaymentIntent paid for, if it was one. */
export function lessonIdFrom(paymentIntent: Pick<Stripe.PaymentIntent, "metadata">): number | null {
  const raw = paymentIntent.metadata?.[LESSON_METADATA_KEY];
  const id = raw ? Number(raw) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Is this PaymentIntent a lesson's? Asks Stripe when our row doesn't know yet. */
export async function isLessonPayment(admin: SupabaseClient, paymentIntentId: string): Promise<boolean> {
  const { data } = await admin.from("pro_bookings").select("id").eq("payment_reference", paymentIntentId).maybeSingle();
  if (data) return true;
  try {
    return lessonIdFrom(await getStripeClient().paymentIntents.retrieve(paymentIntentId)) !== null;
  } catch {
    return false;
  }
}

export type LessonCheckout = { clientSecret: string } | { error: string };

export async function createLessonPaymentIntent(admin: SupabaseClient, userId: string, bookingId: number): Promise<LessonCheckout> {
  const booking = await loadBooking(admin, bookingId);
  if (!booking || booking.member_id !== userId) return { error: "Booking not found." };
  if (booking.payment_status === "paid") return { error: "This is already paid." };
  if (booking.status !== "pending_payment") return { error: "This time is no longer held for you. Pick it again in the app." };
  if (new Date(booking.hold_until).getTime() <= Date.now() && booking.payment_status !== "pending") {
    return { error: "Your 15 minutes to pay ran out. Pick the time again in the app." };
  }

  const { data: account } = await admin
    .from("stripe_connected_accounts")
    .select("stripe_account_id, charges_enabled, payouts_enabled, details_submitted, requirements_currently_due, requirements_past_due, disabled_reason")
    .eq("user_id", booking.pros?.member_id ?? "")
    .maybeSingle<
      Pick<
        StripeConnectedAccount,
        "stripe_account_id" | "charges_enabled" | "payouts_enabled" | "details_submitted" | "requirements_currently_due" | "requirements_past_due" | "disabled_reason"
      >
    >();
  if (!account || !isSellerPaymentReady(sellerOnboardingStatus(account))) {
    return { error: "This pro hasn't finished setting up payments yet. Try again soon." };
  }

  const stripe = getStripeClient();
  if (booking.payment_reference) {
    try {
      const existing = await stripe.paymentIntents.retrieve(booking.payment_reference);
      if (existing.status === "succeeded") return { error: "This is already paid." };
      if (existing.client_secret && ["requires_payment_method", "requires_confirmation", "requires_action", "processing"].includes(existing.status)) {
        return { clientSecret: existing.client_secret };
      }
    } catch {
      // Stale id: make a new one below.
    }
  }

  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.create(
      {
        amount: booking.price_cents,
        currency: "eur",
        description: `PinPals: ${booking.title}, ${lessonWhen(booking.starts_at)}`.slice(0, 200),
        transfer_group: `pinpals-lesson-${booking.id}`,
        automatic_payment_methods: { enabled: true },
        metadata: { [LESSON_METADATA_KEY]: String(booking.id), pinpals_pro_account: account.stripe_account_id },
      },
      { idempotencyKey: `pinpals-lesson-${booking.id}-pi` }
    );
  } catch {
    return { error: "Couldn't start the payment just now. Please try again." };
  }

  // Paying can take a minute or two: keep the time held while they do.
  const holdUntil = new Date(Math.max(new Date(booking.hold_until).getTime(), Date.now() + 30 * 60_000)).toISOString();
  const { error } = await admin
    .from("pro_bookings")
    .update({ payment_reference: pi.id, payment_status: "pending", hold_until: holdUntil, updated_at: new Date().toISOString() })
    .eq("id", booking.id)
    .neq("payment_status", "paid");
  if (error || !pi.client_secret) return { error: "Couldn't start the payment just now. Please try again." };
  return { clientSecret: pi.client_secret };
}

/** The webhook: the golfer has paid. Returns a reason when it couldn't be applied. */
export async function confirmLessonPayment(
  admin: SupabaseClient,
  bookingId: number,
  paymentIntent: Pick<Stripe.PaymentIntent, "id" | "amount" | "currency">
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (paymentIntent.currency !== "eur") return { ok: false, reason: `Lesson ${bookingId}: paid in ${paymentIntent.currency}.` };
  const { data, error } = await admin.rpc("pro_booking_paid", {
    p_booking_id: bookingId,
    p_payment_intent: paymentIntent.id,
    p_amount_cents: paymentIntent.amount,
  });
  if (error) throw new Error(`pro_booking_paid(${bookingId}) failed: ${error.message}`);
  const outcome = data as string;
  if (outcome === "missing" || outcome === "mismatch") {
    return { ok: false, reason: `Lesson ${bookingId}: ${outcome} (paid ${paymentIntent.amount}).` };
  }
  if (outcome === "already") return { ok: true };

  const booking = await loadBooking(admin, bookingId);
  if (!booking) return { ok: false, reason: `Lesson ${bookingId} vanished.` };
  const when = lessonWhen(booking.starts_at);

  if (outcome === "clash") {
    await refundLesson(admin, bookingId);
    await notifyUser(admin, {
      userId: booking.member_id,
      type: "refund_succeeded",
      title: "That time went while you were paying",
      body: `Sorry — ${booking.title} at ${when} was taken. Your ${formatPriceCents(booking.price_cents)} is on its way back to you. Pick another time.`,
      href: `/lessons/${bookingId}`,
      data: { lessonId: bookingId },
      dedupeKey: `lesson:${bookingId}:clash`,
    });
    return { ok: true };
  }

  await notifyUser(admin, {
    userId: booking.member_id,
    type: "payment_succeeded",
    title: "You're booked in",
    body: `${booking.title}, ${when}. See you there.`,
    href: `/lessons/${bookingId}`,
    data: { lessonId: bookingId },
    dedupeKey: `lesson:${bookingId}:booked:golfer`,
  });
  if (booking.pros?.member_id) {
    await notifyUser(admin, {
      userId: booking.pros.member_id,
      type: "seller_action_required",
      title: "New booking",
      body: `${booking.title}, ${when}. It's in your diary.`,
      href: `/lessons/${bookingId}`,
      data: { lessonId: bookingId },
      dedupeKey: `lesson:${bookingId}:booked:pro`,
    });
  }
  return { ok: true };
}

/**
 * Refunds what pro_booking_cancel()/pro_booking_paid() decided. Safe to call
 * again: Stripe's idempotency key, and the guard on refund_status.
 */
export async function refundLesson(admin: SupabaseClient, bookingId: number): Promise<"refunded" | "nothing" | "failed"> {
  const booking = await loadBooking(admin, bookingId);
  if (!booking || booking.refund_status !== "pending" || booking.refund_cents <= 0 || !booking.payment_reference) return "nothing";
  try {
    const refund = await getStripeClient().refunds.create(
      { payment_intent: booking.payment_reference, amount: booking.refund_cents, reason: "requested_by_customer", metadata: { [LESSON_METADATA_KEY]: String(bookingId) } },
      { idempotencyKey: `pinpals-lesson-${bookingId}-refund` }
    );
    const failed = refund.status === "failed" || refund.status === "canceled";
    await admin
      .from("pro_bookings")
      .update({ refund_status: failed ? "failed" : "succeeded", refund_reference: refund.id, updated_at: new Date().toISOString() })
      .eq("id", bookingId)
      .eq("refund_status", "pending");
    return failed ? "failed" : "refunded";
  } catch (err) {
    console.error(`refund of lesson ${bookingId} failed:`, err instanceof Error ? err.message : err);
    return "failed";
  }
}

/** Pays the pro for every lesson that's due. Best effort; a failure waits for the next sweep. */
export async function releaseDueLessons(admin: SupabaseClient): Promise<{ released: number; failed: number }> {
  const { data, error } = await admin.rpc("pro_bookings_due");
  if (error) {
    console.error("pro_bookings_due failed:", error.message);
    return { released: 0, failed: 0 };
  }
  let released = 0;
  let failed = 0;
  const stripe = getStripeClient();
  for (const due of (data ?? []) as { id: number; pro_member: string; title: string; starts_at: string; payout_cents: number; payment_reference: string }[]) {
    const { data: account } = await admin
      .from("stripe_connected_accounts")
      .select("stripe_account_id")
      .eq("user_id", due.pro_member)
      .maybeSingle<{ stripe_account_id: string }>();
    if (!account) {
      failed += 1;
      continue;
    }
    let transferId: string;
    try {
      const pi = await stripe.paymentIntents.retrieve(due.payment_reference);
      const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
      const transfer = await stripe.transfers.create(
        {
          amount: due.payout_cents,
          currency: "eur",
          destination: account.stripe_account_id,
          ...(chargeId ? { source_transaction: chargeId } : {}),
          transfer_group: `pinpals-lesson-${due.id}`,
          metadata: { [LESSON_METADATA_KEY]: String(due.id) },
        },
        { idempotencyKey: `pinpals-lesson-${due.id}-release` }
      );
      transferId = transfer.id;
    } catch (err) {
      console.error(`release of lesson ${due.id} failed:`, err instanceof Error ? err.message : err);
      failed += 1;
      continue;
    }
    const { data: updated } = await admin
      .from("pro_bookings")
      .update({ payout_status: "released", payout_reference: transferId, released_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", due.id)
      .eq("payout_status", "held")
      .select("id");
    released += 1;
    if (updated && updated.length > 0) {
      await notifyUser(admin, {
        userId: due.pro_member,
        type: "payment_succeeded",
        title: "You've been paid",
        body: `${formatPriceCents(due.payout_cents)} for ${due.title} on ${lessonWhen(due.starts_at)} is on its way to your bank.`,
        href: "/pros/me",
        data: { lessonId: due.id },
        dedupeKey: `lesson:${due.id}:released`,
      });
    }
  }
  return { released, failed };
}

/** Expire unpaid holds, retry refunds that didn't go through, pay pros what's due. */
export async function sweepLessons(admin: SupabaseClient): Promise<void> {
  const expired = await admin.rpc("pro_bookings_expire");
  if (expired.error) console.error("pro_bookings_expire failed:", expired.error.message);
  const { data: stuck } = await admin
    .from("pro_bookings")
    .select("id")
    .eq("refund_status", "pending")
    .lt("updated_at", new Date(Date.now() - 5 * 60_000).toISOString())
    .limit(50);
  for (const row of (stuck ?? []) as { id: number }[]) await refundLesson(admin, row.id);
  await releaseDueLessons(admin);
}
