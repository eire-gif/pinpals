"use client";

import Link from "next/link";
import { markNotificationRead } from "./actions";
import { formatDateTime } from "@/lib/admin/format";

/**
 * One row. Deliberately plain, uncontrolled navigation (a `<Link>`, no
 * `router.push`) — clicking an unread row fires markNotificationRead() as a
 * best-effort side effect alongside the navigation Next.js is already about
 * to perform, rather than gating navigation on the mutation completing
 * first. A failed/slow mark-as-read should never make a notification feel
 * unclickable.
 */
export default function NotificationRow({
  id,
  title,
  body,
  href,
  readAt,
  createdAt,
}: {
  id: number;
  title: string;
  body: string;
  href: string;
  readAt: string | null;
  createdAt: string;
}) {
  return (
    <Link
      href={href}
      onClick={() => {
        if (!readAt) void markNotificationRead(id);
      }}
      className={`flex items-start gap-3 px-5 py-4 border-b border-line last:border-0 hover:bg-surface-tint transition ${
        readAt ? "" : "bg-green-100/40"
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full mt-2 shrink-0 ${readAt ? "bg-transparent" : "bg-green-600"}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className={`text-sm ${readAt ? "font-semibold text-ink-900" : "font-bold text-ink-900"}`}>{title}</div>
        <p className="text-sm text-ink-500 mt-0.5">{body}</p>
        <p className="text-xs text-ink-500 mt-1">{formatDateTime(createdAt)}</p>
      </div>
    </Link>
  );
}
