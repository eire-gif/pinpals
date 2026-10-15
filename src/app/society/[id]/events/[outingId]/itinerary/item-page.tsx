import { notFound } from "next/navigation";

import { ActionButton } from "@/components/society-console/forms";
import { Card, PageHeader } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { loadEvent } from "@/lib/society-console/data";
import { loadClub, loadItineraryItem } from "@/lib/society-console/events-data";
import { ITEM_KINDS, placement } from "@/lib/society-console/events-itinerary";
import { ITEM_INFO, itemKindsFor, tripDays, type ItemKind } from "@/lib/society-console/events-trips";
import { clock } from "@/lib/society-console/outing-rules";
import { consoleHref, positiveInt } from "@/lib/society-console/rules";
import { deleteItem } from "./actions";
import ItemForm, { type ItemFormValues } from "./item-form";

/** Add (itemId null, with ?kind&day) or change one thing on a trip's itinerary. */
export default async function ItemPage({ rawId, rawOuting, rawItem, kindParam, dayParam }: { rawId: string; rawOuting: string; rawItem: string | null; kindParam?: string; dayParam?: string }) {
  const ctx = await requireConsole(rawId, { area: "events", path: `/society/${rawId}/events/${rawOuting}/itinerary` });
  const g = ctx.society.id;
  const outingId = positiveInt(rawOuting);
  if (!outingId) notFound();
  const itemId = rawItem ? positiveInt(rawItem) : null;
  if (rawItem && !itemId) notFound();

  const [page, item] = await Promise.all([loadEvent(ctx.supabase, g, outingId), itemId ? loadItineraryItem(ctx.supabase, outingId, itemId) : Promise.resolve(null)]);
  if (!page || (itemId && !item)) notFound();
  const o = page.outing;
  if (o.kind === "day" || !o.endsOn) notFound();
  const back = { href: consoleHref(g, `events/${o.id}/itinerary`), label: "Itinerary" };
  if (o.status !== "open") {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Itinerary" back={back} />
        <Card>
          <p className="text-sm text-ink-500">This trip was cancelled, so the itinerary can&apos;t be changed.</p>
        </Card>
      </div>
    );
  }

  const days = tripDays(o.playsOn, o.endsOn);
  const allowed = itemKindsFor(o.kind);
  const kind: ItemKind = item?.kind ?? ((ITEM_KINDS as string[]).includes(kindParam ?? "") && allowed.includes(kindParam as ItemKind) ? (kindParam as ItemKind) : "note");
  const onDate = item?.onDate ?? (dayParam && days.includes(dayParam) ? dayParam : o.playsOn);
  const entrants = page.entries.map((e) => ({ memberId: e.memberId, name: e.name }));
  const club = item?.clubId ? await loadClub(ctx.supabase, item.clubId) : null;

  // A sensible start for something new (the app's): everyone on the flight or bus; groups of four, rooms of two.
  const initial: ItemFormValues = item
    ? {
        itemId: item.id,
        kind,
        onDate,
        title: item.title,
        club: club ? { id: club.id, name: club.name, country: club.country } : null,
        startsAt: clock(item.startsAt) ?? "",
        endsAt: clock(item.endsAt) ?? "",
        fromPlace: item.fromPlace ?? "",
        toPlace: item.toPlace ?? "",
        carrier: item.carrier ?? "",
        nights: item.nights ?? 1,
        gap: item.teeInterval ?? 10,
        format: item.playFormat,
        details: item.details ?? "",
        seats: item.people.map((p) => [p.memberId, p.slot ?? 0]),
        slotCount: Math.max(1, ...item.people.map((p) => p.slot ?? 1)),
      }
    : {
        itemId: null,
        kind,
        onDate,
        title: "",
        club: null,
        startsAt: "",
        endsAt: "",
        fromPlace: "",
        toPlace: "",
        carrier: "",
        nights: kind === "stay" ? Math.max(1, tripDays(onDate, o.endsOn).length - 1) : 1,
        gap: 10,
        format: kind === "round" ? "stableford" : null,
        details: "",
        seats: placement(kind) === "list" ? entrants.map((e) => [e.memberId, 0]) : [],
        slotCount: kind === "round" ? Math.max(1, Math.ceil(entrants.length / 4)) : kind === "stay" ? Math.max(1, Math.ceil(entrants.length / 2)) : 1,
      };

  const info = ITEM_INFO[kind];
  return (
    <div className="max-w-3xl">
      <PageHeader
        title={item ? `Edit ${info.label.toLowerCase()}` : `Add a ${info.label.toLowerCase()}`}
        description={o.title}
        back={back}
        actions={
          item ? (
            <ActionButton action={deleteItem} fields={{ g, outing: o.id, item: item.id, back: 1 }} tone="danger" size="md" confirm={`Remove ${item.title}? It comes off the itinerary for everyone.`}>
              Remove
            </ActionButton>
          ) : undefined
        }
      />
      <ItemForm groupId={g} outingId={o.id} playsOn={o.playsOn} days={days} entrants={entrants} initial={initial} />
    </div>
  );
}
