import { Card, Empty, PageHeader, Table, Td } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { exportLog, listEvents, type EventSummary } from "@/lib/society-console/data";
import { EXPORTS, exportAllowed, exportTitle } from "@/lib/society-console/exports-rules";
import { irishToday, outingDateLabel } from "@/lib/society-console/outing-rules";
import { whenLabel } from "@/lib/society-console/rules";
import { ExportCard } from "./export-card";

/**
 * The society's CSV exports (0144/0145), the app's Export screen: each
 * file the member's areas allow, made on the server with their own client
 * and handed back as a ten-minute link. Every download is logged and shown
 * below to the committee.
 */
export default async function ExportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireConsole(id);
  const { supabase: db, society, areas } = ctx;
  const g = society.id;
  const files = EXPORTS.filter((e) => exportAllowed(e, areas));

  const today = irishToday();
  const runsEvents = areas.includes("events");
  const [upcoming, past, log] = await Promise.all([
    runsEvents ? listEvents(db, g, { today }) : Promise.resolve([] as EventSummary[]),
    runsEvents ? listEvents(db, g, { today, past: true }) : Promise.resolve([] as EventSummary[]),
    exportLog(db, g),
  ]);
  const events = [...upcoming, ...past].filter((o) => o.status === "open").map((o) => ({ id: o.id, label: `${o.title} · ${outingDateLabel(o.playsOn)}` }));

  return (
    <div className="grid gap-6">
      <PageHeader title="Exports" description="Download a spreadsheet. Each file is a CSV that opens in Excel, Numbers or Google Sheets." />

      {files.length === 0 ? (
        <Card>
          <Empty>Exports are for the society&apos;s owner and committee.</Empty>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {files.map((e) => (
            <ExportCard
              key={e.file}
              groupId={g}
              file={e.file}
              title={e.title}
              detail={e.detail}
              who={e.who}
              locked={e.area === "people" || e.area === "money"}
              events={e.needsEvent ? events : undefined}
            />
          ))}
        </div>
      )}

      <p className="rounded-2xl bg-green-100 text-green-800 px-5 py-4 text-sm">Mobile numbers are only in the members list, and only the ones you can already see. Every download is recorded below.</p>

      <Card title="Recent exports">
        {log.length === 0 ? (
          <Empty>No downloads yet.</Empty>
        ) : (
          <Table head={["File", "Rows", "By", "When"]}>
            {log.map((l) => (
              <tr key={l.id}>
                <Td className="font-semibold text-ink-900">{exportTitle(l.file)}</Td>
                <Td>{l.rows}</Td>
                <Td className="text-ink-500">{l.who ?? "—"}</Td>
                <Td className="text-xs text-ink-500 whitespace-nowrap">{whenLabel(l.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
