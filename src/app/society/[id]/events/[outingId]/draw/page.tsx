import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClass } from "@/components/society-console/forms";
import { Card, PageHeader } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { loadDrawHistory, loadEvent } from "@/lib/society-console/data";
import { loadRoster } from "@/lib/society-console/events-data";
import type { Seat } from "@/lib/society-console/events-draw";
import { outingDateLabel, outingPast } from "@/lib/society-console/outing-rules";
import { consoleHref, positiveInt } from "@/lib/society-console/rules";
import DrawEditor from "./draw-editor";

/**
 * The draw for a day out — the app's draw (From a group, opened on an
 * event): entrants and guests with their indexes, random or balanced,
 * honouring "play with" and early/late requests and spreading out people
 * drawn together at recent events; swap anyone; publish the tee times.
 */
export default async function DrawPage({ params }: { params: Promise<{ id: string; outingId: string }> }) {
  const { id, outingId: rawOuting } = await params;
  const ctx = await requireConsole(id, { area: "events", path: `/society/${id}/events/${rawOuting}/draw` });
  const g = ctx.society.id;
  const outingId = positiveInt(rawOuting);
  if (!outingId) notFound();

  const [page, roster, history] = await Promise.all([loadEvent(ctx.supabase, g, outingId), loadRoster(ctx.supabase, g), loadDrawHistory(ctx.supabase, g, outingId)]);
  if (!page) notFound();
  const o = page.outing;
  const back = { href: consoleHref(g, `events/${o.id}`), label: o.title };

  const blocked =
    o.kind !== "day"
      ? "A trip's groups and tee times are set on each round of its itinerary."
      : o.status === "cancelled"
        ? "This event was cancelled."
        : o.matchDayId != null
          ? "The round has started — the groups are in the round now."
          : outingPast(o.playsOn)
            ? "This event has been played."
            : null;
  if (blocked) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="The draw" back={back} />
        <Card>
          <p className="text-sm text-ink-500 mb-4">{blocked}</p>
          {o.kind !== "day" && o.status === "open" && (
            <Link href={consoleHref(g, `events/${o.id}/itinerary`)} className={buttonClass("navy", "sm")}>
              Open the itinerary
            </Link>
          )}
        </Card>
      </div>
    );
  }

  const indexOf = new Map(roster.map((r) => [r.id, r]));
  const seats: Seat[] = [
    ...page.entries.map((e) => ({ key: `m:${e.memberId}`, name: e.name, index: indexOf.get(e.memberId)?.index ?? null, guest: false, group: e.teeGroup, position: e.teePosition, time: e.teeTime })),
    ...page.guests.map((x) => ({ key: `g:${x.id}`, name: x.name, index: x.handicapIndex, guest: true, group: x.teeGroup, position: x.teePosition, time: x.teeTime })),
  ];
  // What the draw honours (0142): requests from the officers' view of the choices.
  const choices = [...page.choices.entries()];
  const wishes = {
    together: choices.filter(([, c]) => c.playWith).map(([m, c]) => [`m:${m}`, `m:${c.playWith}`] as [string, string]),
    early: choices.filter(([, c]) => c.teePref === "early").map(([m]) => `m:${m}`),
    late: choices.filter(([, c]) => c.teePref === "late").map(([m]) => `m:${m}`),
    met: history,
  };
  const fromSociety = page.entries.filter((e) => indexOf.get(e.memberId)?.fromSociety).length;

  return (
    <div>
      <PageHeader
        title="The draw"
        description={`${o.title} · ${outingDateLabel(o.playsOn)}${o.courseName ? ` · ${o.courseName}` : ""}. Members see their tee times as soon as you publish. You start the round on the day, in the app.`}
        back={back}
      />
      <DrawEditor
        groupId={g}
        outingId={o.id}
        seats={seats}
        firstTee={o.firstTee ? o.firstTee.slice(0, 5) : ""}
        published={o.drawPublishedAt != null}
        wishes={wishes}
        indexNote={`${fromSociety} of ${page.entries.length} play off a society handicap; the rest off their own index where they share it.`}
      />
    </div>
  );
}
