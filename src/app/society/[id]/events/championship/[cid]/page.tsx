import Link from "next/link";
import { notFound } from "next/navigation";

import ChampionshipBoard from "@/components/championship-board";
import { ActionButton } from "@/components/society-console/forms";
import { buttonClass } from "@/components/society-console/styles";
import { Card, PageHeader, Pill } from "@/components/society-console/ui";
import { championshipFor } from "@/lib/championship-data";
import { requireConsole } from "@/lib/society-console/access";
import { outingDateLabel } from "@/lib/society-console/outing-rules";
import { consoleHref, positiveInt } from "@/lib/society-console/rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelChampionship } from "../actions";

/**
 * A multi-day championship in society admin (0187): its days — each an
 * ordinary event with its own entries, draw and live day — and the
 * leaderboard as members see it.
 */
export default async function ChampionshipAdminPage({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  const ctx = await requireConsole(id, { area: "events", path: `/society/${id}/events/championship/${cid}` });
  const g = ctx.society.id;
  const champId = positiveInt(cid);
  if (!champId) notFound();
  const data = await championshipFor(ctx.supabase, createAdminClient(), champId, ctx.user.id);
  if (!data || data.groupId !== g) notFound();
  const cancelled = data.status === "cancelled";

  return (
    <div className="grid gap-6">
      <PageHeader
        title={data.title}
        description={`${data.days.length}-day championship. Each day runs like any event — entries, the draw and the live day — and the leaderboard adds them up.`}
        back={{ href: consoleHref(g, "events"), label: "Events" }}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/championships/${champId}`} className={buttonClass("primary")}>
              Open the leaderboard
            </Link>
            {!cancelled && !data.tripOutingId && (
              <Link href={consoleHref(g, `events/championship/${champId}/edit`)} className={buttonClass("quiet")}>
                Edit
              </Link>
            )}
            {!cancelled && !data.tripOutingId && (
              <ActionButton action={cancelChampionship} fields={{ g, championship: champId }} tone="danger" size="md" confirm="Cancel the championship? Every day not yet played is cancelled too.">
                Cancel championship
              </ActionButton>
            )}
          </div>
        }
      />

      <Card title="The days">
        <ul className="grid gap-3">
          {data.days.map((d) => (
            <li key={d.round} className="flex flex-wrap items-center gap-3 justify-between rounded-xl border border-line p-3">
              <div>
                <div className="text-xs font-bold tracking-[0.12em] text-gold-600">DAY {d.round} · {outingDateLabel(d.playsOn).toUpperCase()}</div>
                <div className="font-semibold text-ink-900">{d.courseName}</div>
                <div className="text-sm text-ink-500">{[d.formatLabel, d.firstTee ? `first tee ${d.firstTee}` : null].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={d.status === "live" ? "green" : d.status === "final" ? "grey" : "gold"}>{d.status === "live" ? "Live" : d.status === "final" ? "Final" : "To come"}</Pill>
                {d.outingId && (
                  <>
                    <Link href={consoleHref(g, `events/${d.outingId}`)} className={buttonClass("quiet", "sm")}>
                      Entries & draw
                    </Link>
                    <Link href={consoleHref(g, `live/${d.outingId}`)} className={buttonClass("quiet", "sm")}>
                      Live day
                    </Link>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <ChampionshipBoard data={data} me={ctx.user.id} />
    </div>
  );
}
