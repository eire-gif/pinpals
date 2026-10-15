import { PageHeader } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { lastPaymentDetails } from "@/lib/society-console/data";
import { addDays } from "@/lib/society-console/events-trips";
import { formatIban } from "@/lib/society-console/outing-payments";
import { irishToday } from "@/lib/society-console/outing-rules";
import { consoleHref } from "@/lib/society-console/rules";
import EventForm, { type EventFormValues } from "../event-form";

/** A new day out or trip. Starts with the society's last payment details, as the app does. */
export default async function NewEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireConsole(id, { area: "events", path: `/society/${id}/events/new` });
  const g = ctx.society.id;
  const money = ctx.areas.includes("money");
  const pay = money ? await lastPaymentDetails(ctx.supabase, g) : null;
  const today = irishToday();

  const initial: EventFormValues = {
    kind: "day",
    title: "",
    club: null,
    courseName: "",
    playsOn: addDays(today, 14),
    endsOn: addDays(today, 17),
    location: "",
    firstTee: "",
    fee: "",
    max: "",
    details: "",
    entryMode: "join",
    waitingList: true,
    autoOffer: true,
    guestsAllowed: true,
    guestFee: "",
    closeDays: 0,
    arriveBy: "",
    formatLabel: "",
    dressCode: "",
    meals: "",
    revtag: pay?.payRevtag ? `@${pay.payRevtag}` : "",
    iban: pay?.payIban ? formatIban(pay.payIban) : "",
    accountName: pay?.payAccountName ?? "",
    payCash: pay?.payCash ?? true,
    payNote: pay?.payNote ?? "",
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="New event" description="A day out at one course, or an overnight or abroad trip with an itinerary." back={{ href: consoleHref(g, "events"), label: "Events" }} />
      <EventForm groupId={g} outingId={null} initial={initial} money={money} />
    </div>
  );
}
