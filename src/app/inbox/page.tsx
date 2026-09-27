import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loadInbox } from "@/lib/inbox-server";
import { inboxTotal } from "@/lib/inbox";
import InboxList from "./inbox-list";

/**
 * The one place.
 *
 * Until this page existed, a member had to check two: a bell that counted
 * alerts and a Messages link that counted nothing. Both are here now, one
 * list, newest first, with the filters for the times you want only one kind.
 *
 * Server-rendered and RLS-bound — the "own rows only" SELECT policies on
 * `conversations` and `notifications` are the entire access control, so
 * there is no service-role client here and no ownership filter anyone can
 * forget to write.
 */
export default async function InboxPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/inbox");

  const { items, counts, truncated } = await loadInbox(supabase, user.id);
  const total = inboxTotal(counts);

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 md:py-14">
      <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
        <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Inbox
      </span>

      <div className="flex items-end justify-between gap-3 flex-wrap mt-2 mb-8">
        <div>
          <h1 className="font-display font-bold text-3xl md:text-4xl">
            Messages &amp; alerts
          </h1>
          <p className="text-ink-500 mt-1.5 text-sm">
            {total === 0
              ? "You're all caught up."
              : describeUnread(counts.messages, counts.alerts)}
          </p>
        </div>

        <Link
          href="/dashboard/notifications"
          className="text-sm font-semibold text-ink-500 hover:text-ink-900 transition"
        >
          Notification settings
        </Link>
      </div>

      <InboxList items={items} counts={counts} currentUserId={user.id} />

      {truncated && (
        <p className="text-xs text-ink-500 mt-6 text-center">
          Showing your most recent activity. Older items stay in the
          conversation they belong to.
        </p>
      )}
    </div>
  );
}

/**
 * "3 unread messages and 2 alerts" rather than "5 unread".
 *
 * The two mean different things to the person reading them — one is somebody
 * waiting on a reply, the other is the site telling you something — and a
 * single merged number hides which of those is true.
 */
function describeUnread(messages: number, alerts: number): string {
  const parts: string[] = [];
  if (messages > 0) parts.push(`${messages} unread ${messages === 1 ? "message" : "messages"}`);
  if (alerts > 0) parts.push(`${alerts} ${alerts === 1 ? "alert" : "alerts"}`);
  return `${parts.join(" and ")}.`;
}
