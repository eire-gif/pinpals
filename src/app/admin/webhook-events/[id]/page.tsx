import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { getWebhookEventDetail } from "@/lib/admin/queries";
import { WEBHOOK_EVENT_STATUS_LABELS, WEBHOOK_EVENT_STATUS_STYLES, formatDateTime } from "@/lib/admin/format";
import { formatPrice } from "@/lib/format";
import SimpleActionForm from "@/components/admin/simple-action-form";
import StatusBadge from "@/components/admin/status-badge";
import { retryFailedWebhookEvent } from "./actions";

export default async function AdminWebhookEventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff({ roles: FINANCE_ROLES });
  const { id } = await params;
  const eventRowId = Number(id);
  if (!eventRowId || Number.isNaN(eventRowId)) notFound();

  const detail = await getWebhookEventDetail(eventRowId);
  if (!detail) notFound();

  const { event, relatedOrder, history } = detail;

  return (
    <div>
      <Link href="/admin/webhook-events" className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← All webhook events
      </Link>

      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-500 font-semibold">Webhook event #{event.id}</div>
            <h1 className="font-display font-bold text-2xl mt-1 font-mono">{event.event_type}</h1>
            <p className="text-ink-500 mt-1 text-sm">Received {formatDateTime(event.received_at)}</p>
          </div>
          <StatusBadge status={event.status} labels={WEBHOOK_EVENT_STATUS_LABELS} styles={WEBHOOK_EVENT_STATUS_STYLES} />
        </div>

        <p className="text-xs text-ink-500 mt-4">
          This is Pinpals&apos; own delivery ledger for this Stripe event, not a live Stripe object — see the
          Stripe dashboard for that event&apos;s full history there.
        </p>
      </div>

      <Section title="Details">
        <div className="p-5 grid sm:grid-cols-2 gap-4 text-sm">
          <Row label="Provider event id" value={event.event_id} mono />
          <Row label="API version" value={event.api_version ?? "—"} mono />
          <Row label="Attempts" value={String(event.attempts)} />
          <Row label="Processed" value={event.processed_at ? formatDateTime(event.processed_at) : "Not yet"} />
        </div>
        {event.last_error && (
          <div className="px-5 pb-5">
            <div className="text-xs text-ink-500 mb-1">Last error</div>
            <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3 py-2">{event.last_error}</p>
          </div>
        )}
        {event.status === "failed" && (
          <div className="px-5 pb-5">
            <SimpleActionForm
              action={retryFailedWebhookEvent}
              idField="eventRowId"
              id={event.id}
              submitLabel="Retry"
              pendingLabel="Retrying…"
            />
          </div>
        )}
      </Section>

      {relatedOrder && (
        <Section title="Related order">
          <div className="p-5 flex items-center justify-between gap-4">
            <div>
              <div className="font-semibold text-ink-900">{relatedOrder.listing_title}</div>
              <div className="text-sm text-ink-500">
                {formatPrice(relatedOrder.total_eur)} · {relatedOrder.payment_status}
              </div>
            </div>
            <Link
              href={`/admin/orders/${relatedOrder.id}`}
              className="text-sm font-semibold text-ink-900 hover:underline shrink-0"
            >
              Open order #{relatedOrder.id} →
            </Link>
          </div>
        </Section>
      )}

      <Section title="Retry history">
        {history.length === 0 ? (
          <EmptyRow>No admin-triggered retries recorded yet.</EmptyRow>
        ) : (
          <ul>
            {history.map((entry) => (
              <li key={entry.id} className="px-5 py-3 border-b border-line last:border-0 text-sm">
                <span className="font-mono text-xs text-ink-900">{entry.action}</span>
                <span className="text-ink-500"> · {formatDateTime(entry.created_at)}</span>
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
