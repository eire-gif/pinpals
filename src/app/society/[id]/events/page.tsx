import Link from "next/link";

import { buttonClass } from "@/components/society-console/styles";
import { Card, Empty, PageHeader, Pill, Tabs } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { listEvents } from "@/lib/society-console/data";
import { countdownLabel } from "@/lib/society-console/events-trips";
import { clock, feeLabel, irishToday } from "@/lib/society-console/outing-rules";
import { consoleHref } from "@/lib/society-console/rules";
import { DateBlock, KindBadge, whenText } from "./bits";

/**
 * Events & entries: the society's upcoming events (or, ?past=1, the ones
 * gone by), each with what needs the committee — requests, the waiting
 * list, offers out, unpaid entries, payments to confirm. The same list as
 * the app's Events screen, from the officers' side.
 */
export default async function EventsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ past?: string }> }) {
  const { id } = await params;
  const { past: pastParam } = await searchParams;
  const ctx = await requireConsole(id, { area: "events", path: `/society/${id}/events` });
  const g = ctx.society.id;
  const past = pastParam === "1";
  const today = irishToday();
  const money = ctx.areas.includes("money");

  const [events, upcomingForCount, champsRes] = await Promise.all([
    listEvents(ctx.supabase, g, { today, past }),
    past ? listEvents(ctx.supabase, g, { today }) : Promise.resolve(null),
    ctx.supabase.from("group_championships").select("id, title, status, trip_outing_id").eq("group_id", g).eq("status", "open").order("created_at", { ascending: false }).limit(20),
  ]);
  const championships = (champsRes.data ?? []) as { id: number; title: string; status: string; trip_outing_id: number | null }[];
  const champTitle = new Map(championships.map((c) => [c.id, c.title]));
  const upcoming = upcomingForCount ?? events;
  const needs = upcoming.filter((e) => e.status === "open").reduce((n, e) => n + e.requests + e.offered, 0);

  const base = consoleHref(g, "events");
  return (
    <div>
      <PageHeader
        title="Events & entries"
        description="Day outs and trips: who's in, who's asking, the waiting list, payments and the draw."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={consoleHref(g, "events/championship/new")} className={buttonClass("gold")}>
              + Multi-day championship
            </Link>
            <Link href={consoleHref(g, "events/new")} className={buttonClass("primary")}>
              + New event
            </Link>
          </div>
        }
      />

      <Tabs
        current={past ? `${base}?past=1` : base}
        tabs={[
          { href: base, label: "Upcoming", count: needs },
          { href: `${base}?past=1`, label: "Past" },
        ]}
      />

      {!past && championships.length > 0 && (
        <ul className="grid gap-3 mb-4">
          {championships.map((c) => {
            const daysOf = events.filter((e) => e.championshipId === c.id && e.status === "open");
            return (
              <li key={c.id}>
                <Link href={consoleHref(g, `events/championship/${c.id}`)} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 bg-navy-900 text-cream-50 hover:bg-navy-800 transition">
                  <span>
                    <span className="block text-[11px] font-bold tracking-[0.14em] text-gold-400">{c.trip_outing_id ? "TRIP LEADERBOARD" : `CHAMPIONSHIP · ${daysOf.length} DAYS`}</span>
                    <span className="block font-display font-bold text-lg">{c.title}</span>
                    {daysOf.length > 0 && <span className="block text-sm text-cream-50/75">{daysOf.map((d) => d.courseName).filter(Boolean).join(" → ")}</span>}
                  </span>
                  <span className="text-sm font-semibold text-gold-400">Days & leaderboard →</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {events.length === 0 ? (
        <Card>
          <Empty>{past ? "No past events yet." : "No events coming up. Set up the society's next day out or trip — everyone joins it in the app."}</Empty>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {events.map((e) => {
            const trip = e.kind !== "day" && !!e.endsOn;
            const cancelled = e.status === "cancelled";
            const used = e.entered + e.guests;
            const full = e.maxEntries != null && used >= e.maxEntries;
            const fee = (e.entryFeeCents ?? 0) > 0;
            return (
              <li key={e.id}>
                <Link
                  href={consoleHref(g, `events/${e.id}`)}
                  className="flex gap-4 items-start bg-surface rounded-2xl border border-line shadow-sm p-4 hover:shadow-md transition"
                >
                  <DateBlock date={e.playsOn} trip={trip} cancelled={cancelled} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <KindBadge kind={e.kind} playsOn={e.playsOn} endsOn={e.endsOn} />
                      {cancelled && <Pill tone="red">Cancelled</Pill>}
                      {e.championshipId && e.championshipRound && <Pill tone="navy">{`Day ${e.championshipRound}${champTitle.get(e.championshipId) ? ` · ${champTitle.get(e.championshipId)}` : ""}`}</Pill>}
                      {e.entryMode === "request" && !cancelled && <Pill tone="gold">Request a place</Pill>}
                    </div>
                    <h2 className={`font-display font-bold text-lg text-ink-900 mt-1 ${cancelled ? "line-through text-ink-500" : ""}`}>{e.title}</h2>
                    <p className="text-sm text-ink-500">
                      {[
                        trip ? whenText(e.kind, e.playsOn, e.endsOn) : null,
                        trip ? e.location : e.courseName,
                        !trip && e.firstTee ? `First tee ${clock(e.firstTee)}` : null,
                        trip && !past && !cancelled && e.endsOn ? countdownLabel(e.playsOn, e.endsOn, today) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-ink-900">
                      <span>
                        <strong>{used}</strong>
                        {e.maxEntries ? ` of ${e.maxEntries}` : ""} {trip ? "going" : "in"}
                        {e.guests > 0 ? <span className="text-ink-500"> (incl. {e.guests} guest{e.guests === 1 ? "" : "s"})</span> : null}
                      </span>
                      {e.entryFeeCents != null && <span>{`${trip ? "Cost" : "Entry"} ${feeLabel(e.entryFeeCents)}`}</span>}
                    </div>
                    {!cancelled && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {e.requests > 0 && <Pill tone="navy">{`${e.requests} asking`}</Pill>}
                        {e.waiting > 0 && <Pill tone="gold">{`${e.waiting} waiting`}</Pill>}
                        {e.offered > 0 && <Pill tone="gold">{`${e.offered} offered`}</Pill>}
                        {full && <Pill tone="grey">Full</Pill>}
                        {money && fee && e.unpaid > 0 && <Pill tone="red">{`${e.unpaid} unpaid`}</Pill>}
                        {money && e.claims > 0 && <Pill tone="navy">{`${e.claims} say paid`}</Pill>}
                        {!trip && e.drawPublishedAt && <Pill tone="green">Draw out</Pill>}
                        {e.matchDayId != null && <Pill tone="green">Round started</Pill>}
                      </div>
                    )}
                  </div>
                  <span className="text-ink-500 self-center" aria-hidden>
                    →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
