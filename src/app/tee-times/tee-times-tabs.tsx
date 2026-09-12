import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * The tee-times nav.
 *
 * Everything a member does with a tee time after posting one used to live on
 * the dashboard, several sections down, next to their connections and their
 * marketplace orders. That is the wrong place for it: someone thinking about
 * golf goes to Tee times, and the two things they most need to act on —
 * a request waiting on their answer, and a place waiting on their
 * confirmation — were the two things hardest to find.
 *
 * The counts are the point as much as the tabs are. A tab that says
 * "Interested golfers" invites a click once; a tab that says there are two
 * people waiting on you gets clicked every time.
 *
 * Rendered on all three tee-time pages, so the count query runs on each.
 * Both are `head: true` counts against indexed columns — cheaper than the
 * page's own invite list by a wide margin.
 */
export default async function TeeTimesTabs({
  active,
}: {
  active: "browse" | "interested" | "requests";
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [{ count: waitingOnYou }, { count: waitingOnThem }] = await Promise.all([
    // Requests on invites this member hosts. The !inner join is what lets
    // the filter reach through to the invite's owner — same shape the
    // dashboard already uses for this list.
    supabase
      .from("tee_time_interests")
      .select("id, tee_time_invites!inner(member_id)", { count: "exact", head: true })
      .eq("tee_time_invites.member_id", user.id)
      .eq("status", "pending"),
    // Places this member has been offered and not yet answered.
    supabase
      .from("tee_time_interests")
      .select("id", { count: "exact", head: true })
      .eq("member_id", user.id)
      .eq("status", "accepted"),
  ]);

  const tabs = [
    { key: "browse" as const, href: "/tee-times", label: "Browse invites", count: 0 },
    { key: "interested" as const, href: "/tee-times/interested", label: "Interested golfers", count: waitingOnYou ?? 0 },
    { key: "requests" as const, href: "/tee-times/requests", label: "My requests", count: waitingOnThem ?? 0 },
  ];

  return (
    <nav className="border-b border-line bg-surface">
      <div className="max-w-6xl mx-auto px-6">
        {/* Scrolls rather than wraps at phone width: three tabs on two lines
            reads as two separate navs. */}
        <ul className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.key === active;
            return (
              <li key={tab.key} className="shrink-0">
                <Link
                  href={tab.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-2 px-4 py-4 text-sm font-bold border-b-[3px] transition ${
                    isActive
                      ? "border-green-700 text-green-700"
                      : "border-transparent text-ink-500 hover:text-ink-900"
                  }`}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className="bg-gold-500 text-navy-900 text-xs font-bold px-2 py-0.5 rounded-full">
                      {tab.count}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
