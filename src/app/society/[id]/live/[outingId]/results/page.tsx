import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/society-console/forms";
import { Checks, LiveSteps, Podium, ResultsTable } from "@/components/society-console/live-ui";
import { liveSteps } from "@/lib/society-console/live-steps";
import { buttonClass } from "@/components/society-console/styles";
import { Card, PageHeader, Pill } from "@/components/society-console/ui";
import { DEFAULT_SETTINGS, applyAmendments, type Results } from "@/lib/competition-results";
import { requireConsole } from "@/lib/society-console/access";
import { loadEvent } from "@/lib/society-console/data";
import { loadCertified, loadLiveDay } from "@/lib/society-console/live-day-data";
import { basisLabel, entrantsOf, hasResults, settingsFrom, workOut } from "@/lib/society-console/live-results";
import { outingDateLabel } from "@/lib/society-console/outing-rules";
import { consoleHref, positiveInt, whenLabel } from "@/lib/society-console/rules";
import { withdrawResults } from "./actions";
import ResultsSettingsForm from "./results-settings";

/**
 * Cards in & results (Oct 2026): every card's state (certified, not yet,
 * amended, no return), the podium and full table for each division with the
 * Golf Ireland countback shown, the checks, and — for whoever started the
 * day — the settings, side prizes, amendments and Publish, exactly as the
 * app's results screen. Worked out on the server from the cards in the
 * database, with competition-results.ts.
 */

export const dynamic = "force-dynamic";

export default async function LiveResultsPage({ params }: { params: Promise<{ id: string; outingId: string }> }) {
  const { id, outingId: rawOuting } = await params;
  const ctx = await requireConsole(id, { area: "events", path: `/society/${id}/live/${rawOuting}/results` });
  const g = ctx.society.id;
  const outingId = positiveInt(rawOuting);
  if (!outingId) notFound();
  const page = await loadEvent(ctx.supabase, g, outingId);
  if (!page) notFound();
  const o = page.outing;
  const back = { href: consoleHref(g, `live/${o.id}`), label: "Control room" };
  const stepsFor = (published: boolean) => <LiveSteps steps={liveSteps(g, o, { current: 5, inDraw: page.entries.length + page.guests.length, published })} />;
  if (!o.matchDayId) {
    return (
      <div>
        <PageHeader title="Results" back={back} />
        {stepsFor(false)}
        <Card>
          <p className="text-sm text-ink-500">The round hasn&apos;t started yet. Results are worked out from the live cards once it&apos;s played.</p>
        </Card>
      </div>
    );
  }
  const day = await loadLiveDay(ctx.supabase, o.matchDayId, ctx.user.id);
  if (!day) notFound();
  if (!hasResults(day.kind)) {
    return (
      <div>
        <PageHeader title="Results" back={back} />
        {stepsFor(false)}
        <Card>
          <p className="text-sm text-ink-500">A match day&apos;s result is its team score — it&apos;s on the control room&apos;s board.</p>
        </Card>
      </div>
    );
  }

  const certified = (await loadCertified(ctx.supabase, day.id)) ?? new Map<string, boolean>();
  const isPublished = day.results?.status === "published";
  const settings = day.mine ? settingsFrom(day.results?.settings ?? DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
  const provisional = workOut(day.id, day.kind, day.games, certified, settings);
  // Whoever started the day sees their working; others see what's published, or a provisional view.
  const results: Results = !day.mine && isPublished && day.results?.published ? day.results.published : provisional;
  const submitted = entrantsOf(day.kind, day.games, certified);
  const entrants = applyAmendments(submitted, settings.amendments);
  const statusOf = new Map(results.divisions.flatMap((d) => d.ranking.rows).map((r) => [r.key, r]));
  const unit = results.basis === "stableford" ? "pts" : "net";
  const cardHref = (roundId: number) => consoleHref(g, `live/${o.id}/card/${roundId}`);


  const chip = (key: string) => {
    const r = statusOf.get(key);
    const e = entrants.find((x) => x.key === key);
    if (!r || !e) return { tone: "bg-cream-100 text-ink-500", text: "–" };
    if (r.status === "dq") return { tone: "bg-red-600 text-white", text: "DQ" };
    if (r.status === "nr") return { tone: "bg-red-100 text-red-600", text: "NR" };
    if (r.status === "out") return { tone: "bg-cream-100 text-ink-500", text: `${r.thru}` };
    if ((e.amended?.length ?? 0) > 0) return { tone: "bg-[#dfe6f0] text-navy-800", text: "Am" };
    if (r.certified) return { tone: "bg-green-100 text-green-800", text: "✓" };
    if (r.certified === false) return { tone: "bg-gold-500/20 text-gold-600", text: "…" };
    return { tone: "bg-green-100 text-green-800", text: "In" };
  };
  const counts = {
    certified: entrants.filter((e) => statusOf.get(e.key)?.certified && statusOf.get(e.key)?.status === "ok").length,
    waiting: entrants.filter((e) => statusOf.get(e.key)?.certified === false && statusOf.get(e.key)?.status === "ok").length,
    out: results.counts.out,
    nr: results.counts.nr,
    amended: entrants.filter((e) => (e.amended?.length ?? 0) > 0).length,
  };
  const initials = (name: string) =>
    name
      .split(/[\s&·]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("");

  return (
    <div>
      <PageHeader
        back={back}
        title="Cards in & results"
        description={`${o.title} · ${outingDateLabel(o.playsOn)} · ${day.courseName} · ${basisLabel(day.kind, day.games)}`}
        actions={
          <>
            {isPublished && <Pill tone="green">Published{day.results?.version && day.results.version > 1 ? ` · v${day.results.version}` : ""}</Pill>}
            {isPublished && day.results?.shareToken && (
              <a href={`/results/${day.results.shareToken}`} target="_blank" rel="noopener noreferrer" className={buttonClass("quiet")}>
                Share page ↗
              </a>
            )}
            <Link href={consoleHref(g, `live/${o.id}`)} className={buttonClass("quiet")}>
              Control room
            </Link>
          </>
        }
      />
      {stepsFor(isPublished)}

      <Card
        className="mb-5"
        title="Cards"
        subtitle="Every card from the live round saves itself when the group finishes; a playing partner certifies it with Face ID"
        actions={
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="green">{counts.certified} certified</Pill>
            {counts.waiting > 0 && <Pill tone="gold">{counts.waiting} not certified</Pill>}
            {counts.amended > 0 && <Pill tone="navy">{counts.amended} amended</Pill>}
            {counts.out > 0 && <Pill>{counts.out} not in</Pill>}
            {counts.nr > 0 && <Pill tone="red">{counts.nr} no return</Pill>}
          </div>
        }
      >
        <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(44px,1fr))]">
          {entrants.map((e) => {
            const c = chip(e.key);
            return (
              <Link key={e.key} href={cardHref(e.roundId)} title={`${e.name}: ${c.text === "✓" ? "certified" : c.text === "…" ? "not certified yet" : c.text === "Am" ? "amended" : c.text}`} className={`h-11 rounded-lg grid place-items-center text-center leading-tight ${c.tone}`}>
                <span className="text-[11px] font-extrabold">{initials(e.name)}</span>
                <span className="text-[10px] font-bold -mt-1">{c.text}</span>
              </Link>
            );
          })}
        </div>
        <p className="text-xs text-ink-500 mt-3">✓ certified · … waiting for a partner&apos;s Face ID · Am amended by you · a number: holes in so far · NR no return · DQ disqualified</p>
      </Card>

      {!day.mine && (
        <p className="mb-5 rounded-xl bg-cream-100 px-4 py-3 text-sm text-ink-900">
          {day.creatorName ?? "Whoever started the round"} started this round, so they publish the results{isPublished ? "" : " — this is a provisional view with the standard settings"}.
        </p>
      )}

      <div className="flex flex-wrap gap-5 items-start">
        <div className="flex-[1.6_1_560px] min-w-0 grid gap-5">
          {results.divisions.map((d) => (
            <Card key={d.label} title={d.label} subtitle={d.range ? `Playing handicap ${d.range}` : undefined}>
              <Podium rows={d.ranking.rows} unit={unit} />
              <div className="mt-5">
                <ResultsTable results={results} rows={d.ranking.rows} cardHref={cardHref} />
              </div>
              {d.ranking.ties.length > 0 && (
                <div className="mt-4 grid gap-2">
                  {d.ranking.ties.map((t, i) => (
                    <details key={i} className="rounded-xl bg-cream-100 px-4 py-2.5 text-sm">
                      <summary className="cursor-pointer font-semibold text-ink-900">
                        {t.names.join(", ")} level on {t.total} — {t.resolvedBy === "countback" ? "split on countback" : t.resolvedBy === "draw" ? "level throughout, split by random draw" : "level throughout, place shared"}
                      </summary>
                      <div className="mt-2 -mx-1 overflow-x-auto">
                        <table className="text-xs tabular-nums">
                          <thead>
                            <tr className="text-ink-500">
                              <th scope="col" className="text-left px-1 py-1 font-bold">
                                Step
                              </th>
                              {t.names.map((n) => (
                                <th key={n} scope="col" className="px-2 py-1 font-bold">
                                  {n.split(" ")[0]}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {t.steps.map((st) => (
                              <tr key={st.label} className={st.decided ? "font-bold text-green-700" : ""}>
                                <td className="px-1 py-0.5">{st.label}</td>
                                {st.values.map((v, j) => (
                                  <td key={j} className="px-2 py-0.5 text-center">
                                    {v}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </Card>
          ))}
          {results.prizes.length > 0 && (
            <Card title="Prizes">
              <ul className="grid gap-2">
                {results.prizes.map((p) => (
                  <li key={p.label} className="flex flex-wrap justify-between gap-2 rounded-xl bg-cream-100 px-4 py-3">
                    <span className="font-semibold text-ink-900">{p.label}</span>
                    <span className="text-sm text-ink-900">{p.winners.map((w) => `${w.place ? `${w.place} ` : ""}${w.name}${w.score ? ` · ${w.score}` : ""}${w.amended ? " (amended)" : ""}`).join(", ") || "—"}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <p className="rounded-2xl bg-navy-900 text-cream-100 px-5 py-4 text-sm leading-relaxed">{results.rule}</p>
        </div>

        <aside className="flex-[1_1_340px] min-w-0 grid gap-5 content-start">
          <section className="rounded-3xl border-[1.5px] border-gold-500/50 bg-gradient-to-b from-[#17375a] via-navy-900 to-[#12291f] p-5 text-cream-50 grid gap-3">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-gold-400">{isPublished ? "Published" : "Before you publish"}</div>
            {isPublished && day.results?.publishedAt && <p className="text-sm text-[#c9d3e0]">Published {whenLabel(day.results.publishedAt)} to everyone in the day and the society&apos;s page.</p>}
            <div className="text-ink-900">
              <Checks checks={provisional.checks} />
            </div>
            {day.mine && isPublished && (
              <ActionButton action={withdrawResults} fields={{ g, outing: o.id }} tone="danger" size="md" confirm="Take the results down? Members stop seeing them and the share link stops working. You can publish again.">
                Take the results down
              </ActionButton>
            )}
          </section>
        </aside>
      </div>

      {day.mine && (
        <div className="mt-6">
          <ResultsSettingsForm
            groupId={g}
            outingId={o.id}
            initial={settings}
            team={results.team}
            handicaps={entrants.map((e) => e.handicap)}
            entrants={submitted.map((e) => ({ key: e.key, name: e.name, holes: e.card.map((h) => h.hole).sort((a, b) => a - b), scores: Object.fromEntries(Object.entries(e.scores).map(([k, v]) => [Number(k), v])) }))}
            published={isPublished}
            stops={provisional.checks.filter((c) => c.level === "stop").map((c) => c.text)}
          />
        </div>
      )}
    </div>
  );
}
