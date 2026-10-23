import { PageHeader } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { addDays } from "@/lib/society-console/events-trips";
import { irishToday } from "@/lib/society-console/outing-rules";
import { consoleHref } from "@/lib/society-console/rules";
import ChampionshipForm from "../championship-form";

/** A new multi-day championship (0187). */
export default async function NewChampionshipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireConsole(id, { area: "events", path: `/society/${id}/events/championship/new` });
  const g = ctx.society.id;
  const first = addDays(irishToday(), 14);
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New multi-day championship"
        description="2 to 4 days, a course and format each day, one leaderboard with each player's place up or down on the day before."
        back={{ href: consoleHref(g, "events"), label: "Events" }}
      />
      <ChampionshipForm
        groupId={g}
        championshipId={null}
        initial={{
          title: "",
          rule: "auto",
          fee: "",
          max: "",
          details: "",
          days: [0, 1, 2].map((k) => ({ playsOn: addDays(first, k), club: null, courseName: "", firstTee: "08:30", format: "stableford" })),
        }}
      />
    </div>
  );
}
