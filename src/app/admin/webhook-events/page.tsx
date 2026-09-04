import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { listWebhookEvents, listWebhookEventTypes } from "@/lib/admin/queries";
import { WEBHOOK_EVENT_STATUS_LABELS, WEBHOOK_EVENT_STATUS_STYLES, formatDateTime } from "@/lib/admin/format";
import StatusBadge from "@/components/admin/status-badge";

export default async function AdminWebhookEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; page?: string }>;
}) {
  // Same finance gate as /admin/orders and /admin/payouts — payment
  // operations data, same audience.
  await requireStaff({ roles: FINANCE_ROLES });

  const { status = "", type = "", page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const [{ rows: events, total, pageSize }, eventTypes] = await Promise.all([
    listWebhookEvents({ status: status || undefined, eventType: type || undefined }, page),
    listWebhookEventTypes(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(status || type);

  function pageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/admin/webhook-events?${qs}` : "/admin/webhook-events";
  }

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Webhook events</h1>
      <p className="text-ink-500 mb-6">
        {total} Stripe {total === 1 ? "event" : "events"} received. This is Pinpals&apos; own delivery ledger, not
        a live Stripe dashboard — a &quot;Failed&quot; row means this app couldn&apos;t route it to an order (or
        the amounts didn&apos;t reconcile), not that Stripe itself failed.
      </p>

      <form className="flex flex-wrap gap-3 mb-6">
        <select
          name="status"
          defaultValue={status}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">Any status</option>
          {Object.entries(WEBHOOK_EVENT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="type"
          defaultValue={type}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">Any event type</option>
          {eventTypes.map((eventType) => (
            <option key={eventType} value={eventType}>
              {eventType}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition"
        >
          Filter
        </button>
        {hasFilters && (
          <Link
            href="/admin/webhook-events"
            className="px-5 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-line hover:bg-cream-100 transition"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        {events.length === 0 ? (
          <div className="text-center py-16 text-ink-500">No webhook events match that filter.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">Event</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Order</th>
                <th className="px-5 py-3 font-semibold">Received</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
                  <td className="px-5 py-3">
                    <Link href={`/admin/webhook-events/${event.id}`} className="font-mono text-xs text-ink-900 hover:underline">
                      {event.event_type}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge
                      status={event.status}
                      labels={WEBHOOK_EVENT_STATUS_LABELS}
                      styles={WEBHOOK_EVENT_STATUS_STYLES}
                    />
                  </td>
                  <td className="px-5 py-3 text-ink-500">
                    {event.related_order_id ? (
                      <Link href={`/admin/orders/${event.related_order_id}`} className="hover:underline">
                        #{event.related_order_id}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-3 text-ink-500">{formatDateTime(event.received_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 text-sm text-ink-500">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={pageHref(page - 1)}
                className="px-4 py-2 rounded-full border-[1.5px] border-line hover:bg-cream-100 transition"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={pageHref(page + 1)}
                className="px-4 py-2 rounded-full border-[1.5px] border-line hover:bg-cream-100 transition"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
