import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { formatPriceCents } from "@/lib/format";
import { lessonWhen, refundLesson } from "@/lib/lessons-server";
import { notifyUser } from "@/lib/notifications-server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/app/lessons/[id]/cancel   { reason? }
 *
 * The golfer or the pro cancels a lesson (0204). pro_booking_cancel() runs as
 * the caller, so it checks they're one of the two and decides the refund:
 * all of it when the pro cancels or the golfer is inside the pro's free
 * window, none otherwise. This then makes the refund and tells the other
 * side.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const bookingId = asId((await params).id);
  if (bookingId === null) return badRequest("id must be a positive integer");
  const body = await readJson<{ reason?: unknown }>(request);
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 300) : null;

  const { data, error } = await auth.supabase.rpc("pro_booking_cancel", { p_booking_id: bookingId, p_reason: reason });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    return Response.json({ error: error.message }, { status });
  }
  const row = (data as { refund_cents: number; payment_reference: string | null; other_party: string | null; by_pro: boolean }[] | null)?.[0];
  if (!row || !row.other_party) return Response.json({ refund_cents: 0, refunded: false });

  const admin = createAdminClient();
  const refund = row.refund_cents > 0 ? await refundLesson(admin, bookingId) : "nothing";

  const { data: b } = await admin.from("pro_bookings").select("title, starts_at").eq("id", bookingId).maybeSingle<{ title: string; starts_at: string }>();
  const what = b ? `${b.title}, ${lessonWhen(b.starts_at)}` : "Your lesson";
  await notifyUser(admin, {
    userId: row.other_party,
    type: row.by_pro ? "refund_succeeded" : "seller_action_required",
    title: row.by_pro ? "Your pro cancelled" : "A lesson was cancelled",
    body: row.by_pro
      ? `${what} is off. Your ${formatPriceCents(row.refund_cents)} is on its way back to you.`
      : row.refund_cents > 0
        ? `${what} is off. The golfer cancelled in time for a refund, so the time is free again.`
        : `${what} is off. It was cancelled too late for a refund, so you're still paid.`,
    href: `/lessons/${bookingId}`,
    data: { lessonId: bookingId },
    dedupeKey: `lesson:${bookingId}:cancelled`,
  });

  return Response.json({ refund_cents: row.refund_cents, refunded: refund === "refunded" });
}
