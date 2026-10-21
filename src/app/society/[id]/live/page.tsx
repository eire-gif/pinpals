import Link from "next/link";

import { buttonClass } from "@/components/society-console/styles";
import { Card, Empty, PageHeader, Pill } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { listEvents, type EventSummary } from "@/lib/society-console/data";
import { clock, irishToday, isOutingDay, outingDateLabel } from "@/lib/society-console/outing-rules";
import { consoleHref } from "@/lib/society-console/rules";

/**
 * Live day (Oct 2026): every day out the society is playing or has just
 * played, each opening its own Live day — set up and start the round, the
 * control room while it's played, and the results. Events area only, as
 * the app's "Start a round" for a society.
 */
export default async function LiveDayIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireConsole(id, { area: "events", path: `/society/${id}/live` });
  const g = ctx.society.id;
  const today = irishToday();
  const [upcoming, past] = await Promise.all([listEvents(ctx.supabase, g, { today, limit: 12 }), listEvents(ctx.supabase, g, { today, past: true, limit: 8 })]);
  const days = (list: EventSummary[]) => list.filter((e) => e.kind === "day" && e.status === "open");
  const now = days(upcoming);
  const played = days(past).filter((e) => e.matchDayId != null);

  const status = (e: EventSummary) =>
    e.matchDayId ? (
      <Pill tone="green">Started</Pill>
    ) : isOutingDay(e.playsOn) ? (
      e.drawPublishedAt ? (
        <Pill tone="gold">Ready to start</Pill>
      ) : (
        <Pill tone="red">Draw needed</Pill>
      )
    ) : e.drawPublishedAt ? (
      <Pill tone="green">Draw out</Pill>
    ) : (
      <Pill>No draw yet</Pill>
    );

  const Row = ({ e }: { e: EventSummary }) => (
    <li className="py-3 flex flex-wrap items-center gap-4">
      <div className="w-16 shrink-0 rounded-xl bg-cream-100 text-center py-1.5">
        <div className="text-[10px] font-bold uppercase text-ink-500">{outingDateLabel(e.playsOn).split(" ")[0]}</div>
        <div className="font-display font-bold text-lg leading-none">{Number(e.playsOn.slice(8, 10))}</div>
        <div className="text-[10px] font-bold uppercase text-ink-500">{outingDateLabel(e.playsOn).split(" ")[2]}</div>
      </div>
      <div className="min-w-0 flex-1">
        <Link href={consoleHref(g, `live/${e.id}`)} className="font-semibold text-ink-900 hover:text-green-700">
          {e.title}
        </Link>
        <div className="text-xs text-ink-500 truncate">{[e.courseName, clock(e.firstTee) ? `first tee ${clock(e.firstTee)}` : null, `${e.entered + e.guests} playing`].filter(Boolean).join(" · ")}</div>
      </div>
      {status(e)}
      <Link href={consoleHref(g, `live/${e.id}`)} className={buttonClass(isOutingDay(e.playsOn) || e.matchDayId ? "navy" : "quiet", "sm")}>
        {e.matchDayId ? "Open the live day" : isOutingDay(e.playsOn) ? "Set up & start" : "Get ready"}
      </Link>
    </li>
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Live day"
        description="Run the competition from here on the day: choose the tees and format, start the round on every player's phone, watch the scoreboard, then publish the results."
      />
      <Card title="Today and coming up">
        {now.length === 0 ? (
          <Empty>
            No days out coming up.{" "}
            <Link href={consoleHref(g, "events/new")} className="font-semibold text-green-700">
              Add an event
            </Link>
          </Empty>
        ) : (
          <ul className="divide-y divide-line -my-2">
            {now.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </ul>
        )}
      </Card>
      {played.length > 0 && (
        <Card title="Recently played">
          <ul className="divide-y divide-line -my-2">
            {played.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
