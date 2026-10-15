import { notFound } from "next/navigation";

import { Card, PageHeader, Pill } from "@/components/society-console/ui";
import type { Results } from "@/lib/competition-results";
import { requireConsole } from "@/lib/society-console/access";
import { consoleHref, dayLabel, positiveInt, whenLabel } from "@/lib/society-console/rules";

/**
 * One published result in full: the prizes, each division's table with
 * positions, handicaps, countback and amendments, and the rule as members
 * read it — what the public share page shows, read here with the member's
 * own client (0138: members read their society's published results).
 */
export default async function ResultDetailPage({ params }: { params: Promise<{ id: string; matchDayId: string }> }) {
  const { id, matchDayId } = await params;
  const ctx = await requireConsole(id);
  const g = ctx.society.id;
  const dayId = positiveInt(matchDayId);
  if (!dayId) notFound();

  const { data } = await ctx.supabase
    .from("competition_results")
    .select("match_day_id, results, version, published_at, share_token")
    .eq("group_id", g)
    .eq("match_day_id", dayId)
    .eq("status", "published")
    .maybeSingle<{ match_day_id: number; results: Results; version: number; published_at: string; share_token: string | null }>();
  if (!data?.results) notFound();

  const r = data.results;
  const title = r.event?.title || "Competition";
  const unit = r.basis === "stableford" ? "Pts" : "Net";
  const amended = (r.amendments?.length ?? 0) > 0;

  return (
    <div className="grid gap-6">
      <PageHeader
        back={{ href: consoleHref(g, "results"), label: "Results" }}
        title={title}
        description={[r.event?.courseName, r.event?.playedOn ? dayLabel(r.event.playedOn) : null, `published ${whenLabel(data.published_at)}`].filter(Boolean).join(" · ")}
        actions={
          <>
            {data.version > 1 && <Pill tone="gold">Updated</Pill>}
            {amended && <Pill tone="red">Amended</Pill>}
            {data.share_token && (
              <a href={`/results/${data.share_token}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-green-700 hover:text-green-600">
                Share page ↗
              </a>
            )}
          </>
        }
      />

      {(r.prizes ?? []).length > 0 && (
        <Card title="Prizes">
          <ul className="grid gap-2">
            {r.prizes.map((p) => (
              <li key={p.label} className="flex flex-wrap justify-between gap-2 rounded-xl bg-cream-100 px-4 py-3">
                <span className="font-semibold text-ink-900">{p.label}</span>
                <span className="text-sm text-ink-900">{p.winners.map((w) => `${w.name}${w.score ? ` · ${w.score}` : ""}`).join(", ") || "—"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {amended && (
        <section className="grid gap-2 rounded-2xl border border-red-600 bg-red-100 px-5 py-4">
          <h2 className="font-bold text-red-600">Amended by the organiser</h2>
          <p className="text-sm text-ink-500">These results differ from what the players submitted on these cards:</p>
          {r.amendments.map((a) => (
            <div key={a.name} className="text-sm">
              <div className="font-semibold text-ink-900">{a.name}</div>
              {a.lines.map((l, i) => (
                <div key={i} className="text-red-600">
                  {l}
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {(r.divisions ?? []).map((d) => (
        <Card key={d.label} title={d.label} subtitle={d.range ? `Playing handicap ${d.range}` : undefined}>
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-ink-500 border-b border-line">
                  <th scope="col" className="font-bold px-5 py-2">Pos</th>
                  <th scope="col" className="font-bold px-2 py-2">{r.team ? "Entry" : "Player"}</th>
                  <th scope="col" className="font-bold px-2 py-2 text-center">Hcp</th>
                  <th scope="col" className="font-bold px-2 py-2 text-center">{r.holes === 18 ? "B9" : "L6"}</th>
                  <th scope="col" className="font-bold px-5 py-2 text-right">{unit}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.ranking.rows.map((row) => (
                  <tr key={row.key} className={row.position != null && row.position <= 3 ? "bg-gold-400/15" : ""}>
                    <td className="px-5 py-2 font-display text-lg text-navy-900">{row.positionLabel}</td>
                    <td className="px-2 py-2">
                      <div className="font-semibold text-ink-900">
                        {row.name}
                        {row.guest && <span className="ml-2 text-xs font-normal text-ink-500">guest</span>}
                      </div>
                      {row.detail && <div className="text-xs text-ink-500">{row.detail}</div>}
                      {row.note && <div className={`text-xs ${row.wonTie ? "text-green-700 font-semibold" : "text-ink-500"}`}>{row.note}</div>}
                      {row.amended?.length ? <div className="text-xs text-red-600 font-semibold">Amended: {row.amended.join(" · ")}</div> : null}
                    </td>
                    <td className="px-2 py-2 text-center text-ink-500">{row.handicap}</td>
                    <td className="px-2 py-2 text-center text-ink-500">{row.back ?? "–"}</td>
                    <td className="px-5 py-2 text-right font-bold text-ink-900">{row.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {r.rule && <p className="rounded-2xl bg-navy-900 text-cream-100 px-5 py-4 text-sm leading-relaxed">{r.rule}</p>}
    </div>
  );
}
