import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/format";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_STYLES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_STYLES,
  formatDateTime,
} from "@/lib/admin/format";
import StatusBadge from "@/components/admin/status-badge";
import type { Order } from "@/lib/types";
import PayForm from "./pay-form";

/**
 * A member's own view of one order — the buyer/seller-facing counterpart to
 * /admin/orders/[id]. Reads through the regular RLS-scoped client
 * (0019_orders.sql's "Buyers/Sellers can view their own orders" policies),
 * so this can only ever show an order the signed-in member is actually a
 * party to; there is no id-guessing exposure the way an admin surface would
 * have to worry about, because a non-owner's query for this row simply
 * returns nothing.
 */
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = Number(id);
  if (!orderId || Number.isNaN(orderId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/dashboard/orders/${orderId}`);

  const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle<Order>();
  if (!order) notFound();

  const isBuyer = order.buyer_id === user.id;
  const isSeller = order.seller_id === user.id;
  if (!isBuyer && !isSeller) notFound();

  const canPay = isBuyer && order.status !== "cancelled" && order.payment_status !== "paid";

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <Link href="/dashboard/orders" className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← Your orders
      </Link>

      <div className="bg-surface border border-line rounded-2xl shadow-lg p-8 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div className="flex items-center gap-4 min-w-0">
            {order.listing_image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={order.listing_image_url}
                alt=""
                className="w-16 h-16 rounded-lg object-cover border border-line shrink-0"
              />
            )}
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-ink-500 font-semibold">Order #{order.id}</div>
              <h1 className="font-display font-bold text-xl mt-1">{order.listing_title}</h1>
              <p className="text-sm text-ink-500 mt-1">
                {order.listing_category} · {order.listing_condition} · {isBuyer ? "You bought this" : "You sold this"}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <StatusBadge status={order.status} labels={ORDER_STATUS_LABELS} styles={ORDER_STATUS_STYLES} />
            <StatusBadge
              status={order.payment_status}
              labels={PAYMENT_STATUS_LABELS}
              styles={PAYMENT_STATUS_STYLES}
            />
          </div>
        </div>

        <dl className="grid gap-2 text-sm mb-2">
          <Row label="Agreed price" value={formatPrice(order.amount_eur)} />
          <Row label="Platform fee" value={formatPrice(order.platform_fee_eur)} />
          <Row label="Total" value={formatPrice(order.total_eur)} bold />
          {order.refunded_amount_eur != null && <Row label="Refunded" value={formatPrice(order.refunded_amount_eur)} />}
        </dl>
        <p className="text-xs text-ink-500">Placed {formatDateTime(order.created_at)}</p>

        {isBuyer && order.payment_status === "failed" && order.payment_last_error && (
          <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2 mt-4">{order.payment_last_error}</p>
        )}
      </div>

      {canPay && (
        <div className="bg-surface border border-line rounded-2xl shadow-lg p-8">
          <h2 className="font-display font-bold text-lg mb-1">
            {order.payment_status === "failed" ? "Try payment again" : "Complete payment"}
          </h2>
          <p className="text-sm text-ink-500 mb-5">
            Paid securely through Stripe — Pinpals never sees or stores your card details.
          </p>
          <PayForm orderId={order.id} returnPath={`/dashboard/orders/${order.id}`} />
        </div>
      )}

      {isBuyer && order.payment_status === "paid" && (
        <p className="text-sm text-green-700 bg-green-100 rounded-lg px-4 py-3">
          Paid — thanks!
        </p>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-500">{label}</span>
      <span className={`text-ink-900 ${bold ? "font-bold" : ""}`}>{value}</span>
    </div>
  );
}
