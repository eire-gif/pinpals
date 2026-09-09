import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Notification } from "@/lib/types";
import { notificationHref } from "@/lib/notifications";
import MarketplaceEmptyState from "@/components/marketplace/empty-state";
import Pagination from "@/components/dashboard/pagination";
import NotificationRow from "./notification-row";
import { markAllNotificationsRead } from "./actions";

const PAGE_SIZE = 20;

/**
 * The in-app notification list — every event notify_user() has ever fired
 * for the signed-in member, most recent first, paginated the same
 * `.range()` + `count: "exact"` way as every other member-facing list in
 * this app (see sales-history-tab.tsx). RLS's own "own rows only" SELECT
 * policy on `notifications` (0042) is the entire access control here — no
 * service-role client needed for a read that's already scoped to the
 * caller.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/notifications");

  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  const [{ data: notifications, count }, { count: unreadCount }] = await Promise.all([
    supabase
      .from("notifications")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(rangeFrom, rangeTo)
      .returns<Notification[]>(),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
  ]);

  const rows = notifications ?? [];

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl">Notifications</h1>
          <p className="text-ink-500 mt-1">
            {unreadCount ? `${unreadCount} unread` : "You're all caught up."}
          </p>
        </div>
        <Link
          href="/dashboard/notifications"
          className="text-sm font-semibold text-ink-500 hover:text-ink-900 transition"
        >
          Notification settings
        </Link>
      </div>

      {(unreadCount ?? 0) > 0 && (
        <form action={markAllNotificationsRead} className="mb-4">
          <button
            type="submit"
            className="text-sm font-bold text-green-700 hover:text-green-600 transition"
          >
            Mark all as read
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <MarketplaceEmptyState
          title="No notifications yet"
          description="Offers, messages, auction activity and order updates will show up here."
        />
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
          {rows.map((n) => (
            <NotificationRow
              key={n.id}
              id={n.id}
              title={n.title}
              body={n.body}
              href={notificationHref(n.data)}
              readAt={n.read_at}
              createdAt={n.created_at}
            />
          ))}
        </div>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefForPage={(p) => `/notifications?page=${p}`}
      />
    </div>
  );
}
