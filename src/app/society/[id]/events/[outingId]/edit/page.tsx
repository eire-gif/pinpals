import { notFound } from "next/navigation";

import { Card, PageHeader } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { loadEvent } from "@/lib/society-console/data";
import { loadClub } from "@/lib/society-console/events-data";
import { closeDaysFor, feeText } from "@/lib/society-console/events-form";
import { addDays } from "@/lib/society-console/events-trips";
import { formatIban } from "@/lib/society-console/outing-payments";
import { clock } from "@/lib/society-console/outing-rules";
import { consoleHref, positiveInt } from "@/lib/society-console/rules";
import EventForm, { type EventFormValues } from "../../event-form";

export default async function EditEventPage({ params }: { params: Promise<{ id: string; outingId: string }> }) {
  const { id, outingId: rawOuting } = await params;
  const ctx = await requireConsole(id, { area: "events", path: `/society/${id}/events/${rawOuting}/edit` });
  const g = ctx.society.id;
  const outingId = positiveInt(rawOuting);
  if (!outingId) notFound();
  const page = await loadEvent(ctx.supabase, g, outingId);
  if (!page) notFound();
  const o = page.outing;
  const money = ctx.areas.includes("money");
  const back = { href: consoleHref(g, `events/${o.id}`), label: o.title };

  if (o.status === "cancelled" || o.matchDayId != null) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Edit event" back={back} />
        <Card>
          <p className="text-sm text-ink-500">{o.status === "cancelled" ? "This event was cancelled, so it can't be changed." : "The round has started, so the event can't be changed."}</p>
        </Card>
      </div>
    );
  }

  const [club, items] = await Promise.all([
    loadClub(ctx.supabase, o.clubId),
    o.kind !== "day" ? ctx.supabase.from("society_outing_items").select("id", { count: "exact", head: true }).eq("outing_id", o.id) : Promise.resolve({ count: 0 }),
  ]);

  const initial: EventFormValues = {
    kind: o.kind,
    title: o.title,
    club,
    courseName: club ? "" : (o.courseName ?? ""),
    playsOn: o.playsOn,
    endsOn: o.endsOn ?? addDays(o.playsOn, 3),
    location: o.location ?? "",
    firstTee: clock(o.firstTee) ?? "",
    fee: feeText(o.entryFeeCents),
    max: o.maxEntries != null ? String(o.maxEntries) : "",
    details: o.details ?? "",
    entryMode: o.entryMode,
    waitingList: o.waitingList,
    autoOffer: o.autoOffer,
    guestsAllowed: o.guestsAllowed,
    guestFee: feeText(o.guestFeeCents),
    closeDays: closeDaysFor(o.playsOn, o.entriesCloseAt),
    arriveBy: clock(o.arriveBy) ?? "",
    formatLabel: o.formatLabel ?? "",
    dressCode: o.dressCode ?? "",
    meals: o.mealOptions.join(", "),
    revtag: money && o.payRevtag ? `@${o.payRevtag}` : "",
    iban: money && o.payIban ? formatIban(o.payIban) : "",
    accountName: money ? (o.payAccountName ?? "") : "",
    payCash: o.payCash,
    payNote: money ? (o.payNote ?? "") : "",
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title={o.kind === "day" ? "Edit outing" : "Edit trip"} back={back} />
      <EventForm groupId={g} outingId={o.id} initial={initial} money={money} hasItinerary={(items.count ?? 0) > 0} />
    </div>
  );
}
