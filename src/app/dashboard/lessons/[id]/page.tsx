import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatPriceCents } from "@/lib/format";
import { lessonWhen } from "@/lib/lessons-server";
import LessonPayForm from "./pay-form";

type Booking = {
  id: number;
  member_id: string;
  title: string;
  starts_at: string;
  price_cents: number;
  cancel_policy: "24h" | "48h" | "none";
  free_cancel_until: string | null;
  status: "pending_payment" | "booked" | "cancelled" | "expired";
  hold_until: string;
  payment_status: "unpaid" | "pending" | "paid";
  refund_cents: number;
  pros: { club: string; profiles: { first_name: string; last_name: string | null } | null } | null;
};

/**
 * Paying for a lesson with a pro (0204). The app opens this in its web view
 * after the golfer picks a time (the time is held for 15 minutes). Stripe's
 * Payment Element takes the card; the webhook confirms the booking.
 */
export default async function LessonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ redirect_status?: string }> }) {
  const { id } = await params;
  const { redirect_status: returned } = await searchParams;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId) || bookingId <= 0) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/dashboard/lessons/${bookingId}`);

  const { data: b } = await supabase
    .from("pro_bookings")
    .select("id, member_id, title, starts_at, price_cents, cancel_policy, free_cancel_until, status, hold_until, payment_status, refund_cents, pros!inner(club, profiles!pros_member_id_fkey(first_name, last_name))")
    .eq("id", bookingId)
    .maybeSingle<Booking>();
  if (!b) notFound();

  const pro = b.pros?.profiles ? `${b.pros.profiles.first_name} ${b.pros.profiles.last_name ?? ""}`.trim() : "your pro";
  const isGolfer = b.member_id === user.id;
  const holdLive = isHoldLive(b);
  const terms =
    b.cancel_policy === "none" || !b.free_cancel_until
      ? `${pro} doesn't give refunds if you cancel. If ${pro} cancels, you get everything back.`
      : `Free to cancel until ${lessonWhen(b.free_cancel_until)}. After that, no refund. If ${pro} cancels, you get everything back.`;

  return (
    <div className="max-w-lg mx-auto px-5 py-10">
      <div className="bg-navy-900 text-cream-50 rounded-2xl p-6 mb-5">
        <div className="text-xs font-bold tracking-widest text-gold-400">{pro.toUpperCase()} · {b.pros?.club?.toUpperCase()}</div>
        <h1 className="font-display font-bold text-3xl mt-2">{b.title}</h1>
        <p className="mt-1 text-cream-100">{lessonWhen(b.starts_at)}</p>
      </div>

      <div className="bg-surface border border-line rounded-2xl p-5 mb-5">
        <div className="flex justify-between items-baseline">
          <span className="text-ink-500">Price</span>
          <span className="font-bold text-2xl">{formatPriceCents(b.price_cents)}</span>
        </div>
        <p className="text-sm text-ink-500 mt-3">{terms}</p>
      </div>

      {b.payment_status === "paid" && b.status === "booked" ? (
        <Done title="You're booked in" body="It's in your lessons in the PinPals app. You can go back to the app now." />
      ) : b.status === "cancelled" ? (
        <Done
          title="This was cancelled"
          body={b.refund_cents > 0 ? `${formatPriceCents(b.refund_cents)} is on its way back to you.` : "Pick another time in the app."}
        />
      ) : returned === "succeeded" || (b.payment_status === "pending" && returned) ? (
        <Done title="Payment received" body="Confirming your booking. It shows in the app in a moment; you can go back now." />
      ) : !isGolfer ? (
        <Done title="Waiting for the golfer to pay" body="It goes in your diary once they do." />
      ) : holdLive ? (
        <div className="bg-surface border border-line rounded-2xl p-5">
          <LessonPayForm bookingId={b.id} label={`Pay ${formatPriceCents(b.price_cents)} and book`} returnPath={`/dashboard/lessons/${b.id}`} />
          <p className="text-xs text-ink-500 mt-3">Paid securely through Stripe. Nothing added on top.</p>
        </div>
      ) : (
        <Done title="Your 15 minutes to pay ran out" body="The time has gone back on the pro's sheet. Pick it again in the app." />
      )}
    </div>
  );
}

/** Is the time still held for the golfer to pay? */
function isHoldLive(b: Pick<Booking, "status" | "hold_until" | "payment_status">): boolean {
  return b.status === "pending_payment" && (new Date(b.hold_until).getTime() > Date.now() || b.payment_status === "pending");
}

function Done({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-green-100 border border-green-100 rounded-2xl p-5">
      <h2 className="font-display font-bold text-xl text-green-800">{title}</h2>
      <p className="text-sm text-ink-900 mt-1">{body}</p>
    </div>
  );
}
