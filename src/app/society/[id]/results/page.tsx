import Link from "next/link";

import { Card, Empty, PageHeader, Pill, Table, Td } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { loadSocietyResults } from "@/lib/society-console/data";
import { consoleHref, dayLabel } from "@/lib/society-console/rules";

/**
 * The society's published results (0137/0138), newest first — the same
 * published copies every member reads on the society's page in the app.
 * Any committee member can open them.
 */
export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireConsole(id);
  const g = ctx.society.id;
  const results = await loadSocietyResults(ctx.supabase, g);

  return (
    <div className="grid gap-6">
      <PageHeader title="Results" description="Results are worked out and published from the app on the day, from the players' certified cards. Every one published to the society is kept here." />

      <Card title={`Published${results.length ? ` · ${results.length}` : ""}`}>
        {results.length === 0 ? (
          <Empty>No results yet. Once an organiser publishes a competition to the society, it&apos;s kept here.</Empty>
        ) : (
          <Table head={["Played", "Competition", "Winners", ""]}>
            {results.map((r) => (
              <tr key={r.matchDayId}>
                <Td className="whitespace-nowrap text-ink-500">{dayLabel(r.playedOn)}</Td>
                <Td>
                  <Link href={consoleHref(g, `results/${r.matchDayId}`)} className="font-semibold text-ink-900 hover:text-green-700">
                    {r.title}
                  </Link>
                  <div className="text-xs text-ink-500 flex flex-wrap items-center gap-2 mt-0.5">
                    {r.courseName}
                    {r.amended && <Pill tone="red">Amended</Pill>}
                  </div>
                </Td>
                <Td>
                  {r.winners.length === 0 ? (
                    <span className="text-ink-500">—</span>
                  ) : (
                    <ol className="text-sm text-ink-900 min-w-[10rem]">
                      {r.winners.map((w, i) => (
                        <li key={i}>
                          <span className="text-ink-500 mr-1.5">{i + 1}.</span>
                          {w}
                        </li>
                      ))}
                    </ol>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-right">
                  <Link href={consoleHref(g, `results/${r.matchDayId}`)} className="text-sm font-semibold text-green-700 hover:text-green-600">
                    Full results
                  </Link>
                  {r.shareToken && (
                    <a href={`/results/${r.shareToken}`} target="_blank" rel="noopener noreferrer" className="block text-xs text-ink-500 hover:text-ink-900 mt-1">
                      Share page ↗
                    </a>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
