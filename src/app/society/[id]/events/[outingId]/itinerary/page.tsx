import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/society-console/forms";
import { buttonClass } from "@/components/society-console/styles";
import { Card, Empty, PageHeader, Pill } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { loadEvent } from "@/lib/society-console/data";
import { loadItinerary } from "@/lib/society-console/events-data";
import {
  bySlot,
  checkOutDate,
  countdownLabel,
  dayHeading,
  dayTab,
  FORMAT_LABELS,
  ITEM_INFO,
  itemKindsFor,
  routeLabel,
  sortItems,
  teeTimeFor,
  tripBadge,
  tripDays,
  tripRangeLabel,
} from "@/lib/society-console/events-trips";
import { clock, irishToday, outingDateLabel } from "@/lib/society-console/outing-rules";
import { consoleHref, positiveInt } from "@/lib/society-console/rules";
import { deleteItem } from "./actions";

/**
 * A trip's itinerary (0126) — the app's itinerary screen for the committee:
 * each day of the trip with its rounds, flights, stays, transfers, meals and
 * notes in time order, and who's on what. Add to any day; change or remove
 * anything.
 */
export default async function ItineraryPage({ params, searchParams }: { params: Promise<{ id: string; outingId: string }>; searchParams: Promise<{ day?: string }> }) {
  const { id, outingId: rawOuting } = await params;
  const { day: rawDay } = await searchParams;
  const ctx = await requireConsole(id, { area: "events", path: `/society/${id}/events/${rawOuting}/itinerary` });
  const g = ctx.society.id;
  const outingId = positiveInt(rawOuting);
  if (!outingId) notFound();
  const page = await loadEvent(ctx.supabase, g, outingId);
  if (!page) notFound();
  const o = page.outing;
  const back = { href: consoleHref(g, `events/${o.id}`), label: o.title };
  if (o.kind === "day" || !o.endsOn) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Itinerary" back={back} />
        <Card>
          <p className="text-sm text-ink-500">Only overnight and abroad trips have an itinerary. Change the event to a trip in Edit to build one.</p>
        </Card>
      </div>
    );
  }

  const items = sortItems(await loadItinerary(ctx.supabase, o.id));
  const days = tripDays(o.playsOn, o.endsOn);
  const editable = o.status === "open";
  const shown = rawDay && days.includes(rawDay) ? rawDay : null;
  const list = shown ? days.filter((d) => d === shown) : days;
  const base = consoleHref(g, `events/${o.id}/itinerary`);
  const today = irishToday();

  return (
    <div>
      <PageHeader
        title="Itinerary"
        description={`${o.title} · ${tripRangeLabel(o.playsOn, o.endsOn)}${o.location ? ` · ${o.location}` : ""}. Everything here is saved as you add it — everyone on the trip sees it.`}
        back={back}
        actions={<Pill tone="navy">{`${tripBadge(o.kind, o.playsOn, o.endsOn)} · ${countdownLabel(o.playsOn, o.endsOn, today)}`}</Pill>}
      />

      {o.status === "cancelled" && <p className="mb-4 text-sm text-red-600 bg-red-100 rounded-xl px-4 py-2.5">This trip was cancelled, so the itinerary can&apos;t be changed.</p>}
      {page.entries.length === 0 && editable && <p className="mb-4 text-sm text-ink-500 bg-cream-100 rounded-xl px-4 py-2.5">Nobody has joined the trip yet. You can add to the days now and put people on rounds, flights and rooms once they&apos;re in.</p>}

      <div className="flex flex-wrap gap-2 mb-5" role="tablist">
        <Link href={base} aria-current={!shown ? "page" : undefined} className={`rounded-xl px-3 py-2 text-sm font-semibold border ${!shown ? "bg-navy-900 text-cream-50 border-navy-900" : "bg-surface border-line hover:bg-cream-100"}`}>
          All days
        </Link>
        {days.map((d) => {
          const tab = dayTab(d);
          const n = items.filter((i) => i.onDate === d).length;
          return (
            <Link
              key={d}
              href={`${base}?day=${d}`}
              aria-current={shown === d ? "page" : undefined}
              className={`rounded-xl px-3 py-1.5 text-center border min-w-[3.5rem] ${shown === d ? "bg-navy-900 text-cream-50 border-navy-900" : "bg-surface border-line hover:bg-cream-100"}`}
            >
              <span className={`block text-[10px] font-bold tracking-[0.1em] ${shown === d ? "text-gold-400" : "text-ink-500"}`}>{tab.week}</span>
              <span className="block font-display font-bold text-lg leading-tight">{tab.day}</span>
              <span className="block text-[10px] text-ink-500">{n ? `${n} item${n === 1 ? "" : "s"}` : "—"}</span>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-5">
        {list.map((d) => {
          const dayItems = items.filter((i) => i.onDate === d);
          return (
            <Card
              key={d}
              title={dayHeading(o.playsOn, d)}
              actions={
                editable ? (
                  <div className="flex flex-wrap gap-1.5">
                    {itemKindsFor(o.kind).map((k) => (
                      <Link key={k} href={`${base}/new?kind=${k}&day=${d}`} className={buttonClass("quiet", "sm")}>
                        + {ITEM_INFO[k].label}
                      </Link>
                    ))}
                  </div>
                ) : undefined
              }
            >
              {dayItems.length === 0 ? (
                <Empty>Nothing on this day yet.</Empty>
              ) : (
                <ul className="grid gap-3">
                  {dayItems.map((i) => {
                    const info = ITEM_INFO[i.kind];
                    const slots = bySlot(i.people);
                    const meta = [
                      i.kind === "round" ? [clock(i.startsAt) ? `First tee ${clock(i.startsAt)}` : null, i.playFormat ? FORMAT_LABELS[i.playFormat] : null, i.teeInterval ? `${i.teeInterval} min apart` : null] : [],
                      i.kind === "flight" || i.kind === "transfer" ? [routeLabel(i.fromPlace, i.toPlace) || null, [clock(i.startsAt), clock(i.endsAt)].filter(Boolean).join(" → ") || null, i.carrier] : [],
                      i.kind === "stay" ? [`${i.nights ?? 1} night${(i.nights ?? 1) === 1 ? "" : "s"}`, `check out ${outingDateLabel(checkOutDate(i.onDate, i.nights))}`] : [],
                      i.kind === "meal" || i.kind === "note" ? [clock(i.startsAt)] : [],
                    ]
                      .flat()
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li key={i.id} className="rounded-xl border border-line p-4" style={{ background: info.tint }}>
                        <div className="flex flex-wrap items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-bold tracking-[0.1em]" style={{ color: info.ink }}>
                              {info.kicker}
                            </div>
                            <div className="font-display font-bold text-lg text-ink-900">{i.title}</div>
                            {meta && <div className="text-sm text-ink-900/80">{meta}</div>}
                            {i.details && <p className="text-sm text-ink-900 mt-1 whitespace-pre-line">{i.details}</p>}
                          </div>
                          {editable && (
                            <div className="flex flex-wrap gap-1.5">
                              <Link href={`${base}/${i.id}`} className={buttonClass("quiet", "sm")}>
                                Edit
                              </Link>
                              <ActionButton action={deleteItem} fields={{ g, outing: o.id, item: i.id }} tone="danger" confirm={`Remove ${i.title}? It comes off the itinerary for everyone.`}>
                                Remove
                              </ActionButton>
                            </div>
                          )}
                        </div>
                        {slots.length > 0 ? (
                          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                            {slots.map(([slot, people]) => (
                              <div key={slot} className="rounded-lg bg-surface/80 px-3 py-2 text-sm">
                                <span className="font-semibold text-ink-900">
                                  {i.kind === "round" ? `Group ${slot}${teeTimeFor(i.startsAt, i.teeInterval, slot) ? ` · ${teeTimeFor(i.startsAt, i.teeInterval, slot)}` : ""}` : `Room ${slot}`}
                                </span>
                                <span className="text-ink-500"> — {people.map((p) => p.name).join(", ")}</span>
                              </div>
                            ))}
                          </div>
                        ) : i.people.length > 0 ? (
                          <p className="mt-2 text-sm text-ink-500">{`On it (${i.people.length}): ${i.people.map((p) => p.name).join(", ")}`}</p>
                        ) : i.kind !== "meal" && i.kind !== "note" ? (
                          <p className="mt-2 text-xs text-ink-500">Nobody put on it yet.</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
