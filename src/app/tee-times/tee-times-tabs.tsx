import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { countNeedsAnswer } from "@/lib/my-rounds-server";

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
 * Oct 2026: two tabs — everyone's rounds, and My rounds (one page for every
 * round you host, play in, asked to join or were offered, which replaced
 * Interested golfers, My requests and Confirmed).
 */
export default async function TeeTimesTabs({
  active,
}: {
  active: "browse" | "mine";
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // One number since Oct 2026: answers this member owes — requests to their
  // rounds and places offered to them — the same rows My rounds puts under
  // "Needs your answer".
  const waiting = await countNeedsAnswer(supabase, user.id);

  const tabs = [
    { key: "browse" as const, href: "/tee-times", label: "Browse tee times", count: 0 },
    { key: "mine" as const, href: "/tee-times/mine", label: "My rounds", count: waiting },
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
