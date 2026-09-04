import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { getOrderDetail } from "@/lib/admin/queries";
import {
  DISPUTE_STATUS_LABELS,
  DISPUTE_STATUS_STYLES,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_STYLES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_STYLES,
  PAYOUT_ROW_STATUS_LABELS,
  PAYOUT_STATUS_LABELS,
  PAYOUT_STATUS_STYLES,
  REFUND_STATUS_LABELS,
  REFUND_STATUS_STYLES,
  formatDateTime,
  statusLabel,
} from "@/lib/admin/format";
import { formatPrice } from "@/lib/format";
import { computeRefundableAmountEur, isOrderRefundable, stripeDisputeDashboardUrl } from "@/lib/stripe/refunds";
import { stripePayoutDashboardUrl } from "@/lib/stripe/payouts";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";
import RefundForm from "@/components/admin/refund-form";
import { requestOrderRefund } from "./actions";

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff({ roles: FINANCE_ROLES });
  const { id } = await params;
  const orderId = Number(id);
  if (!orderId || Number.isNaN(orderId)) notFound();

  const detail = await getOrderDetail(orderId);
  if (!detail) notFound();

  const { order, buyer, seller, listing, offer, history, refunds, disputes, payout } = detail;

  const buyerName = buyer ? `${buyer.first_name} ${buyer.last_name}`.trim() : "Unknown buyer";
  const sellerName = seller ? `${seller.first_name} ${seller.last_name}`.trim() : "Unknown seller";

  const refundableEur = computeRefundableAmountEur(order, refunds);
  const canRefund = isOrderRefundable(order) && refundableEur > 0;

  // Every order has a created_at milestone; the other three are mutually
  // exclusive outcomes (an order lands in at most one of completed/
  // cancelled/refunded — `status` says which, these timestamps say when).
  // No mutation this phase ever sets them, so today's rows only ever show
  // "Order placed" — the timeline is built to grow into whichever of the
  // three actually gets recorded once a later phase's actions exist.
  const timeline: { label: string; at: string }[] = [{ label: "Order placed", at: order.created_at }];
  if (order.completed_at) timeline.push({ label: "Completed", at: order.completed_at });
  if (order.cancelled_at) timeline.push({ label: "Cancelled", at: order.cancelled_at });
  if (order.refunded_at) timeline.push({ label: "Refunded", at: order.refunded_at });
  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <div>
      <Link href="/admin/orders" className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← All orders
      </Link>

      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-500 font-semibold">Order #{order.id}</div>
            <h1 className="font-display font-bold text-2xl mt-1">{order.listing_title}</h1>
            <p className="text-ink-500 mt-1">
              {order.listing_category} · {order.listing_condition} · Placed {formatDateTime(order.created_at)}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <StatusBadge status={order.status} labels={ORDER_STATUS_LABELS} styles={ORDER_STATUS_STYLES} />
            <StatusBadge
              status={order.payment_status}
              labels={PAYMENT_STATUS_LABELS}
              styles={PAYMENT_STATUS_STYLES}
            />
            <StatusBadge
              status={order.payout_status}
              labels={PAYOUT_STATUS_LABELS}
              styles={PAYOUT_STATUS_STYLES}
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mt-6">
          <div className="bg-surface-tint border border-line rounded-xl p-4">
            <div className="text-xs uppercase tracking-wide text-ink-500 font-semibold mb-2">Buyer</div>
            {buyer ? (
              <Link href={`/admin/users/${buyer.id}`} className="flex items-center gap-2.5">
                <AdminAvatar name={buyerName} color={buyer.avatar_color} />
                <span className="text-ink-900 font-semibold">{buyerName}</span>
              </Link>
            ) : (
              <span className="text-ink-500">{buyerName}</span>
            )}
          </div>
          <div className="bg-surface-tint border border-line rounded-xl p-4">
            <div className="text-xs uppercase tracking-wide text-ink-500 font-semibold mb-2">Seller</div>
            {seller ? (
              <Link href={`/admin/users/${seller.id}`} className="flex items-center gap-2.5">
                <AdminAvatar name={sellerName} color={seller.avatar_color} />
                <span className="text-ink-900 font-semibold">{sellerName}</span>
              </Link>
            ) : (
              <span className="text-ink-500">{sellerName}</span>
            )}
          </div>
        </div>
      </div>

      <Section title="Timeline">
        <ul>
          {timeline.map((event, i) => (
            <li key={i} className="px-5 py-3 border-b border-line last:border-0 text-sm flex justify-between">
              <span className="text-ink-900 font-semibold">{event.label}</span>
              <span className="text-ink-500">{formatDateTime(event.at)}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Item">
        <div className="p-5 flex items-center gap-4">
          {order.listing_image_url && (
            // A one-off snapshot thumbnail on an internal admin page isn't
            // worth Next/Image's remote-pattern config for.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={order.listing_image_url}
              alt=""
              className="w-16 h-16 rounded-lg object-cover border border-line shrink-0"
            />
          )}
          <div className="min-w-0">
            <div className="font-semibold text-ink-900">{order.listing_title}</div>
            <div className="text-sm text-ink-500">
              {order.listing_category} · {order.listing_condition}
            </div>
            {listing ? (
              <Link href={`/admin/listings/${listing.id}`} className="text-sm text-ink-900 hover:underline mt-1 inline-block">
                Open current listing →
              </Link>
            ) : (
              <p className="text-xs text-ink-500 mt-1">
                Original listing no longer exists — showing the snapshot taken when this order was placed.
              </p>
            )}
          </div>
        </div>
      </Section>

      <Section title="Amount">
        <div className="p-5 grid gap-2 text-sm max-w-sm">
          <Row label="Agreed price" value={formatPrice(order.amount_eur)} />
          <Row label="Platform fee" value={formatPrice(order.platform_fee_eur)} />
          <Row label="Total" value={formatPrice(order.total_eur)} bold />
          {order.refunded_amount_eur != null && (
            <Row label="Refunded" value={formatPrice(order.refunded_amount_eur)} />
          )}
        </div>
        {offer && (
          <div className="px-5 pb-5 text-xs text-ink-500">
            From offer{" "}
            <Link href={`/admin/listings/${offer.listing_id}`} className="text-ink-900 hover:underline">
              #{offer.id}
            </Link>
          </div>
        )}
      </Section>

      {(order.payment_reference || order.payout_reference || order.payment_last_error) && (
        <Section title="Payment & payout references">
          <div className="p-5 grid gap-2 text-sm">
            {/* payment_reference is an opaque Stripe PaymentIntent id, safe
                to show a finance admin — never a secret key. currency/
                payment_last_error come from supabase/migrations/
                0021_payments.sql — currency is Stripe's own
                reconciliation-checked value (see src/lib/stripe/payments.ts's
                reconcilePaymentIntentAmount()), not evidence this app
                supports more than EUR. payout_reference is actually this
                order's Stripe TRANSFER id (see 0024_payouts.sql's comment on
                that column) — it only becomes an actual Payout once Stripe
                sweeps it up, which is what the "Payout" row below traces. */}
            {order.payment_reference && <Row label="Payment reference" value={order.payment_reference} mono />}
            {order.payment_reference && <Row label="Currency" value={order.currency.toUpperCase()} />}
            {order.payout_reference && <Row label="Transfer reference" value={order.payout_reference} mono />}
          </div>
          {payout && (
            <div className="px-5 pb-5">
              <Row
                label="Payout"
                value={`${formatPrice(payout.amount_eur)} · ${statusLabel(PAYOUT_ROW_STATUS_LABELS, payout.status)}`}
              />
              <div className="flex items-center gap-3 mt-1">
                <Link
                  href={`/admin/payouts/ledger/${payout.id}`}
                  className="text-xs text-ink-900 hover:underline inline-block"
                >
                  Open payout detail →
                </Link>
                <a
                  href={stripePayoutDashboardUrl(payout.stripe_account_id, payout.stripe_payout_id, payout.livemode)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-ink-900 hover:underline inline-block"
                >
                  Open in Stripe →
                </a>
              </div>
            </div>
          )}
          {order.payment_last_error && (
            <div className="px-5 pb-5">
              <div className="text-xs text-ink-500 mb-1">Last payment error</div>
              <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3 py-2">{order.payment_last_error}</p>
            </div>
          )}
        </Section>
      )}

      {order.refund_reason && (
        <Section title="Refund">
          <div className="p-5 text-sm text-ink-900 whitespace-pre-wrap">{order.refund_reason}</div>
        </Section>
      )}

      {canRefund && (
        <Section title="Process a refund">
          <div className="p-5">
            <RefundForm orderId={order.id} refundableEur={refundableEur} action={requestOrderRefund} />
          </div>
        </Section>
      )}

      {refunds.length > 0 && (
        <Section title="Refund history">
          <ul>
            {refunds.map((refund) => (
              <li key={refund.id} className="px-5 py-3 border-b border-line last:border-0 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-ink-900 font-semibold">{formatPrice(refund.amount_eur)}</span>
                  <StatusBadge status={refund.status} labels={REFUND_STATUS_LABELS} styles={REFUND_STATUS_STYLES} />
                </div>
                <div className="text-ink-500 mt-1 whitespace-pre-wrap">{refund.reason}</div>
                <div className="text-xs text-ink-500 mt-1">
                  Requested {formatDateTime(refund.created_at)}
                  {refund.stripe_refund_id && <> · <span className="font-mono">{refund.stripe_refund_id}</span></>}
                </div>
                {refund.failure_reason && (
                  <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2 mt-2">{refund.failure_reason}</p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {disputes.length > 0 && (
        <Section title="Disputes">
          <ul>
            {disputes.map((dispute) => (
              <li key={dispute.id} className="px-5 py-3 border-b border-line last:border-0 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-ink-900 font-semibold">{formatPrice(dispute.amount_eur)}</span>
                  <StatusBadge status={dispute.status} labels={DISPUTE_STATUS_LABELS} styles={DISPUTE_STATUS_STYLES} />
                </div>
                <div className="text-xs text-ink-500 mt-1">
                  {dispute.reason && <>{dispute.reason} · </>}
                  Opened {formatDateTime(dispute.created_at)}
                  {dispute.evidence_due_by && <> · Evidence due {formatDateTime(dispute.evidence_due_by)}</>}
                </div>
                <a
                  href={stripeDisputeDashboardUrl(dispute.stripe_dispute_id, dispute.livemode)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-ink-900 hover:underline mt-1 inline-block"
                >
                  Open in Stripe →
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Order history">
        {history.length === 0 ? (
          <EmptyRow>No admin actions recorded against this order yet.</EmptyRow>
        ) : (
          <ul>
            {history.map((entry) => (
              <li key={entry.id} className="px-5 py-3 border-b border-line last:border-0 text-sm">
                <span className="font-mono text-xs text-ink-900">{entry.action}</span>
                <span className="text-ink-500"> · {formatDateTime(entry.created_at)}</span>
                {entry.reason && <div className="text-ink-500 mt-1">{entry.reason}</div>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Row({ label, value, bold, mono }: { label: string; value: string; bold?: boolean; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-500">{label}</span>
      <span className={`text-ink-900 ${bold ? "font-bold" : ""} ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="font-display font-bold text-lg mb-3">{title}</h2>
      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">{children}</div>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="text-center py-10 text-ink-500 text-sm">{children}</div>;
}
