import { Card, Empty, PageHeader, Table, Td } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { AUDIENCES, isAudience, listEvents, loadMembershipSettings, sentMessages, type Audience } from "@/lib/society-console/data";
import { irishToday, outingDateLabel } from "@/lib/society-console/outing-rules";
import { positiveInt, whenLabel } from "@/lib/society-console/rules";
import { Compose } from "./compose";

/**
 * Send a message (0144), the app's message screen: pick who gets it
 * (everyone, an event's entrants or waiting list, whoever owes fees or
 * membership, the committee), see how many that is, write it and send. It
 * arrives as an alert members can't turn off; a message to everyone can
 * also go on the noticeboard. ?audience= and ?outing= preselect.
 */

const audienceLabel = (a: Audience) => AUDIENCES.find((x) => x.audience === a)?.label ?? a;

export default async function MessagesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ audience?: string; outing?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireConsole(id, { area: "messages" });
  const { supabase: db, society, areas } = ctx;
  const g = society.id;

  const [membership, events, sent] = await Promise.all([loadMembershipSettings(db, g), listEvents(db, g, { today: irishToday() }), sentMessages(db, g)]);
  const open = events.filter((e) => e.status === "open");

  // As in the app: membership only when it's on. And, as the database
  // allows (society_audience_allowed): money audiences need the money area,
  // the waiting list needs the events area.
  const audiences = AUDIENCES.filter((a) => !a.needsMembership || membership.enabled)
    .filter((a) => (a.audience === "fees_unpaid" || a.audience === "membership_unpaid" ? areas.includes("money") : a.audience === "waiting" ? areas.includes("events") : true))
    .map((a) => ({ audience: a.audience, label: a.label, needsEvent: a.needsEvent }));

  const asked = isAudience(sp.audience) && audiences.some((a) => a.audience === sp.audience) ? sp.audience : "everyone";
  const askedOuting = positiveInt(sp.outing);
  const initialOuting = askedOuting && open.some((e) => e.id === askedOuting) ? askedOuting : null;

  return (
    <div className="grid gap-6">
      <PageHeader title="Send a message" description="A message to some or all of the society. It arrives as an alert in the app." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start">
        <Card title="New message">
          <Compose
            groupId={g}
            audiences={audiences}
            events={open.map((e) => ({ id: e.id, label: [e.title, outingDateLabel(e.playsOn), `${e.entered + e.guests} in`].join(" · ") }))}
            initialAudience={asked}
            initialOuting={initialOuting}
          />
        </Card>

        <Card title="Sent recently">
          {sent.length === 0 ? (
            <Empty>No messages sent yet.</Empty>
          ) : (
            <Table head={["Message", "To", "Sent"]}>
              {sent.map((m) => (
                <tr key={m.id}>
                  <Td className="font-semibold text-ink-900">{m.title}</Td>
                  <Td className="text-ink-500">
                    {audienceLabel(m.audience)}
                    <div className="text-xs">
                      {m.recipients} {m.recipients === 1 ? "member" : "members"}
                    </div>
                  </Td>
                  <Td className="text-xs text-ink-500 whitespace-nowrap">{whenLabel(m.sentAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
