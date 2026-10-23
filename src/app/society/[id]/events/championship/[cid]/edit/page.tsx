import { notFound } from "next/navigation";

import { PageHeader } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { irishToday } from "@/lib/society-console/outing-rules";
import { consoleHref, positiveInt } from "@/lib/society-console/rules";
import ChampionshipForm, { type ChampionshipFormDay } from "../../championship-form";

type DayRow = { id: number; plays_on: string; club_id: number | null; course_name: string | null; first_tee: string | null; championship_format: string | null; match_day_id: number | null; entry_fee_cents: number | null; max_entries: number | null; details: string | null; clubs: { id: number; name: string; country: string | null } | null };

/** Change a championship: days played or started stay as they are. */
export default async function EditChampionshipPage({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  const ctx = await requireConsole(id, { area: "events", path: `/society/${id}/events/championship/${cid}/edit` });
  const g = ctx.society.id;
  const champId = positiveInt(cid);
  if (!champId) notFound();
  const { data: c } = await ctx.supabase.from("group_championships").select("id, title, rule, status, trip_outing_id").eq("id", champId).eq("group_id", g).maybeSingle<{ id: number; title: string; rule: "auto" | "places"; status: string; trip_outing_id: number | null }>();
  if (!c || c.status !== "open" || c.trip_outing_id) notFound();
  const { data: rows } = await ctx.supabase
    .from("society_outings")
    .select("id, plays_on, club_id, course_name, first_tee, championship_format, match_day_id, entry_fee_cents, max_entries, details, clubs(id, name, country)")
    .eq("championship_id", champId)
    .eq("status", "open")
    .order("championship_round")
    .overrideTypes<DayRow[]>();
  const today = irishToday();
  const days: ChampionshipFormDay[] = (rows ?? []).map((r) => ({
    playsOn: r.plays_on,
    club: r.clubs ? { id: r.clubs.id, name: r.clubs.name, country: r.clubs.country } : null,
    courseName: r.course_name ?? "",
    firstTee: r.first_tee ? r.first_tee.slice(0, 5) : "",
    format: r.championship_format ?? "stableford",
    locked: r.match_day_id != null || r.plays_on < today,
  }));
  const first = rows?.[0];
  return (
    <div className="max-w-3xl">
      <PageHeader title={`Edit ${c.title}`} back={{ href: consoleHref(g, `events/championship/${champId}`), label: c.title }} />
      <ChampionshipForm
        groupId={g}
        championshipId={champId}
        initial={{
          title: c.title,
          rule: c.rule,
          fee: first?.entry_fee_cents ? String(first.entry_fee_cents / 100) : "",
          max: first?.max_entries ? String(first.max_entries) : "",
          details: first?.details ?? "",
          days,
        }}
      />
    </div>
  );
}
