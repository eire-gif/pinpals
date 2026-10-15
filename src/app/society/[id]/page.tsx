import Link from "next/link";

import { Card, Empty, PageHeader, Pill, Stat } from "@/components/society-console/ui";
import { buttonClass } from "@/components/society-console/styles";
import { requireConsole } from "@/lib/society-console/access";
import { listEvents, listNotices, loadJoinRequests, loadPaymentClaims, type EventSummary } from "@/lib/society-console/data";
import { feeLabel, irishToday, outingDateLabel } from "@/lib/society-console/outing-rules";
import { consoleHref, euros } from "@/lib/society-console/rules";

/**
 * The console's front page: what needs the committee now (join requests,
 * place requests, offers waiting on an answer, payments members say they've
 * made), the next events, and the latest notices. Each count only for the
 * areas you have; each links to where it's dealt with.
 */
export default async function SocietyOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireConsole(id);
  const { supabase: db, society, areas } = ctx;
  const g = society.id;
  const today = irishToday();
  const has = (a: (typeof areas)[number]) => areas.includes(a);

  const [events, joins, claims, notices] = await Promise.all([
    has("events") || has("money") ? listEvents(db, g, { today, limit: 20 }) : Promise.resolve([] as EventSummary[]),
    has("people") ? loadJoinRequests(db, g) : Promise.resolve([]),
    has("money") ? loadPaymentClaims(db, g) : Promise.resolve([]),
    listNotices(db, g, 3),
  ]);
  const open = events.filter((e) => e.status === "open");
  const placeRequests = open.reduce((n, e) => n + e.requests, 0);
  const waiting = open.reduce((n, e) => n + e.waiting, 0);
  const offered = open.reduce((n, e) => n + e.offered, 0);
  const unpaid = open.reduce((n, e) => n + e.unpaid, 0);

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Everything that needs the committee, in one place."
        actions={
          has("events") ? (
            <Link href={consoleHref(g, "events/new")} className={buttonClass("primary")}>
              + New event
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {has("people") && <Stat label="Join requests" value={joins.length} hint="Golfers asking to join" href={consoleHref(g, "members")} alert={joins.length > 0} />}
        {has("events") && <Stat label="Place requests" value={placeRequests} hint={`${waiting} on waiting lists`} href={consoleHref(g, "events")} alert={placeRequests > 0} />}
        {has("events") && <Stat label="Offers out" value={offered} hint="24 hours to accept" href={consoleHref(g, "events")} />}
        {has("money") && <Stat label="Payments to confirm" value={claims.length} hint="Members say they've paid" href={consoleHref(g, "money")} alert={claims.length > 0} />}
        {has("money") && <Stat label="Entries unpaid" value={unpaid} hint="Across upcoming events" href={consoleHref(g, "money")} />}
        <Stat label="Members" value={society.memberCount} hint={society.privacy === "request" ? "Found by search; ask to join" : "Invite only"} href={has("people") ? consoleHref(g, "members") : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] mt-6">
        <Card
          title="Coming up"
          actions={
            has("events") ? (
              <Link href={consoleHref(g, "events")} className="text-sm font-semibold text-green-700 hover:text-green-600">
                All events →
              </Link>
            ) : undefined
          }
        >
          {open.length === 0 ? (
            <Empty>No events coming up.{has("events") ? " Add the next one with New event." : ""}</Empty>
          ) : (
            <ul className="divide-y divide-line -my-2">
              {open.slice(0, 5).map((e) => (
                <li key={e.id} className="py-3 flex items-center gap-4">
                  <div className="w-14 shrink-0 rounded-xl bg-cream-100 text-center py-1.5">
                    <div className="text-[10px] font-bold uppercase text-ink-500">{outingDateLabel(e.playsOn).split(" ")[0]}</div>
                    <div className="font-display font-bold text-lg leading-none">{Number(e.playsOn.slice(8, 10))}</div>
                    <div className="text-[10px] font-bold uppercase text-ink-500">{outingDateLabel(e.playsOn).split(" ")[2]}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    {has("events") ? (
                      <Link href={consoleHref(g, `events/${e.id}`)} className="font-semibold text-ink-900 hover:text-green-700">
                        {e.title}
                      </Link>
                    ) : (
                      <span className="font-semibold text-ink-900">{e.title}</span>
                    )}
                    <div className="text-xs text-ink-500 truncate">
                      {[e.courseName ?? e.location, feeLabel(e.entryFeeCents), e.maxEntries ? `${e.entered + e.guests}/${e.maxEntries} places` : `${e.entered + e.guests} in`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {e.requests > 0 && <Pill tone="gold">{e.requests} asking</Pill>}
                    {e.waiting > 0 && <Pill>{e.waiting} waiting</Pill>}
                    {e.drawPublishedAt ? <Pill tone="green">Draw out</Pill> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-5 content-start">
          {has("money") && claims.length > 0 && (
            <Card title="Says they've paid" subtitle="Check your account, then confirm">
              <ul className="space-y-2 text-sm">
                {claims.slice(0, 5).map((c) => (
                  <li key={`${c.kind}-${c.outingId}-${c.memberId}-${c.season}`} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">
                      <span className="font-semibold">{c.name}</span> · {c.title}
                    </span>
                    <span className="text-ink-500 shrink-0">{euros(c.amountCents)}</span>
                  </li>
                ))}
              </ul>
              <Link href={consoleHref(g, "money")} className="inline-block mt-3 text-sm font-semibold text-green-700">
                Confirm payments →
              </Link>
            </Card>
          )}
          <Card
            title="Noticeboard"
            actions={
              has("messages") ? (
                <Link href={consoleHref(g, "noticeboard")} className="text-sm font-semibold text-green-700 hover:text-green-600">
                  Post →
                </Link>
              ) : undefined
            }
          >
            {notices.length === 0 ? (
              <Empty>Nothing posted yet.</Empty>
            ) : (
              <ul className="space-y-3">
                {notices.map((n) => (
                  <li key={n.id}>
                    <div className="flex items-center gap-2">
                      {n.pinned && <Pill tone="gold">Pinned</Pill>}
                      <span className="font-semibold text-sm">{n.title}</span>
                    </div>
                    {n.body && <p className="text-xs text-ink-500 line-clamp-2 mt-0.5">{n.body}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
