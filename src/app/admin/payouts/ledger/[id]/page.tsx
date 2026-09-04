import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { getPayoutDetail } from "@/lib/admin/queries";
import {
  PAYOUT_ROW_STATUS_LABELS,
  PAYOUT_ROW_STATUS_STYLES,
  PAYOUT_STATUS_LABELS,
  PAYOUT_STATUS_STYLES,
  formatDateTime,
} from "@/lib/admin/format";
import { formatPrice } from "@/lib/format";
import { stripePayoutDashboardUrl } from "@/lib/stripe/payouts";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";
import SimpleActionForm from "@/components/admin/simple-action-form";
import { holdPayoutOrders, releasePayoutOrders, syncPayoutFromStripe } from "./actions";

export default async function AdminPayoutLedgerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff({ roles: FINANCE_ROLES });
  const { id } = await params;
  const payoutId = Number(id);
  if (!payoutId || Number.isNaN(payoutId)) notFound();

  const detail = await getPayoutDetail(payoutId);
  if (!detail) notFound();

  const { payout, seller, orders, history } = detail;
  const sellerName = seller ? `${seller.first_name} ${seller.last_name}`.trim() : "Unknown seller";
  const heldCount = orders.filter((o) => o.payout_status === "held").length;
  const paidOutCount = orders.filter((o) => o.payout_status === "paid_out").length;

  return (
    <div>
      <Link href="/admin/payouts/ledger" className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← Payout ledger
      </Link>

      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <AdminAvatar name={sellerName} color={seller?.avatar_color ?? null} size="lg" />
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-500 font-semibold">Payout</div>
              {seller ? (
                <Link href={`/admin/users/${seller.id}`} className="font-display font-bold text-2xl hover:underline">
                  {sellerName}
                </Link>
              ) : (
                <h1 className="font-display font-bold text-2xl">{sellerName}</h1>
              )}
              <p className="text-ink-500 mt-1 font-mono text-xs">{payout.stripe_payout_id}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="font-display font-bold text-2xl">{formatPrice(payout.amount_eur)}</span>
            <StatusBadge status={payout.status} labels={PAYOUT_ROW_STATUS_LABELS} styles={PAYOUT_ROW_STATUS_STYLES} />
          </div>
        </div>

        <p className="text-xs text-ink-500 mt-4">
          Stripe is the source of truth for this figure — this row is Pinpals&apos; own timestamped copy of it.
          Last synced {formatDateTime(payout.last_synced_at)}.
        </p>

        <a
          href={stripePayoutDashboardUrl(payout.stripe_account_id, payout.stripe_payout_id, payout.livemode)}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-ink-900 hover:underline mt-2 inline-block"
        >
          Open in Stripe →
        </a>
      </div>

      <Section title="Payout details">
        <div className="p-5 grid sm:grid-cols-2 gap-4 text-sm">
          <Row label="Arrival date" value={payout.arrival_date ? formatDateTime(payout.arrival_date) : "—"} />
          <Row label="Created" value={formatDateTime(payout.stripe_created_at)} />
          <Row label="Method" value={payout.method ?? "—"} />
          <Row label="Type" value={payout.type ?? "—"} />
          {payout.failure_code && <Row label="Failure code" value={payout.failure_code} mono />}
          {payout.failure_message && <Row label="Failure message" value={payout.failure_message} />}
        </div>
        <div className="px-5 pb-5">
          <SimpleActionForm
            action={syncPayoutFromStripe}
            idField="payoutId"
            id={payoutId}
            submitLabel="Sync from Stripe"
            pendingLabel="Syncing…"
          />
        </div>
      </Section>

      <Section title={`Orders swept into this payout (${orders.length})`}>
        {orders.length === 0 ? (
          <EmptyRow>
            {payout.status === "paid" || payout.status === "failed" || payout.status === "canceled"
              ? "No orders have been reconciled against this payout yet."
              : "This payout hasn't reached a final state yet — reconciliation only runs once Stripe reports it as paid, failed, or canceled."}
          </EmptyRow>
        ) : (
          <>
            <ul>
              {orders.map((order) => (
                <li key={order.id} className="px-5 py-3 border-b border-line last:border-0 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <Link href={`/admin/orders/${order.id}`} className="text-ink-900 font-semibold hover:underline">
                      #{order.id} · {order.listing_title}
                    </Link>
                    <span className="text-ink-900">{formatPrice(order.total_eur)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-ink-500">
                      Platform fee {formatPrice(order.platform_fee_eur)} · Transfer{" "}
                      <span className="font-mono">{order.payout_reference}</span>
                    </span>
                    <StatusBadge
                      status={order.payout_status}
                      labels={PAYOUT_STATUS_LABELS}
                      styles={PAYOUT_STATUS_STYLES}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {(paidOutCount > 0 || heldCount > 0) && (
              <div className="px-5 py-4 flex flex-wrap gap-3 border-t border-line">
                {paidOutCount > 0 && (
                  <SimpleActionForm
                    action={holdPayoutOrders}
                    idField="payoutId"
                    id={payoutId}
                    submitLabel={`Hold ${paidOutCount} paid-out ${paidOutCount === 1 ? "order" : "orders"}`}
                    pendingLabel="Holding…"
                    tone="danger"
                  />
                )}
                {heldCount > 0 && (
                  <SimpleActionForm
                    action={releasePayoutOrders}
                    idField="payoutId"
                    id={payoutId}
                    submitLabel={`Release ${heldCount} held ${heldCount === 1 ? "order" : "orders"}`}
                    pendingLabel="Releasing…"
                  />
                )}
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="History">
        {history.length === 0 ? (
          <EmptyRow>No admin actions recorded against this payout yet.</EmptyRow>
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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`font-semibold text-ink-900 ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
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
