import { ConsoleForm, Field, SubmitButton, Toggle, inputClass } from "@/components/society-console/forms";
import { Card, Empty, PageHeader, Table, Td } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { loadMembers, loadMeritRules, loadSeasonResults } from "@/lib/society-console/data";
import { toMeritDraft } from "@/lib/society-console/merit-form";
import { meritSeason, orderOfMerit, type MeritRules } from "@/lib/society-console/order-of-merit";
import { irishToday, outingDateLabel } from "@/lib/society-console/outing-rules";
import { monthName } from "@/lib/society-console/rules";
import { saveMeritRules } from "./actions";

/**
 * The order of merit (0145), the app's merit screen: points for places and
 * for turning up, from the results published to the society this season.
 * Anyone on the committee sees the table; the owner, captain or secretary
 * changes the rules (save_order_of_merit checks that too).
 */
export default async function MeritPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireConsole(id);
  const { supabase: db, society, runs } = ctx;
  const g = society.id;

  const rules = await loadMeritRules(db, g);
  const season = meritSeason(rules.seasonStartMonth, irishToday());
  // Names as members see them in the society (group_members, which every
  // member may read); the published card's name for anyone who has left.
  const [events, members] = await Promise.all([loadSeasonResults(db, g, season.from, season.to), loadMembers(db, g).catch(() => [])]);
  const rows = orderOfMerit(events, rules, new Map(members.map((m) => [m.id, m.name])));
  const bestOfText = rules.bestOf != null ? `best of ${rules.bestOf}` : "every event counts";

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Order of merit"
        description={`Season ${season.label} · ${events.length} ${events.length === 1 ? "event" : "events"} · ${bestOfText}. Points come from the results published to the society.`}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start">
        <Card title={`Standings · ${season.label}`}>
          {rows.length === 0 ? (
            <Empty>No results yet this season. Results appear here once the organiser publishes them to the society&apos;s page.</Empty>
          ) : (
            <Table head={["#", "Player", "Events", "Wins", "Top 3", "Pts"]}>
              {rows.map((r) => (
                <tr key={r.memberId}>
                  <Td className="font-display font-bold text-lg text-navy-900">{r.positionLabel}</Td>
                  <Td>
                    <details>
                      <summary className="cursor-pointer font-semibold text-ink-900 marker:text-ink-500">{r.name}</summary>
                      <ul className="mt-2 grid gap-1 text-xs min-w-[14rem]">
                        {r.scores.map((s) => (
                          <li key={s.eventId} className={`flex justify-between gap-3 ${s.counted ? "text-ink-900" : "text-ink-500 line-through"}`}>
                            <span>
                              {s.title} · {outingDateLabel(s.playedOn)}
                              {s.place ? ` · placed ${s.place}` : ""}
                            </span>
                            <span className="whitespace-nowrap">
                              {s.points} pts{s.counted ? "" : " (dropped)"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </Td>
                  <Td className="text-center">{r.events}</Td>
                  <Td className="text-center">{r.wins}</Td>
                  <Td className="text-center">{r.podiums}</Td>
                  <Td className="text-right font-bold text-ink-900">{r.points}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        {runs ? <RulesForm groupId={g} rules={rules} /> : <RulesSummary rules={rules} />}
      </div>
    </div>
  );
}

function RulesForm({ groupId, rules }: { groupId: number; rules: MeritRules }) {
  const d = toMeritDraft(rules);
  return (
    <Card title="The rules" subtitle="The owner, captain and secretary can change these.">
      <ConsoleForm action={saveMeritRules} className="grid gap-4">
        <input type="hidden" name="g" value={groupId} />
        <Field label="Points for 1st, 2nd, 3rd…" hint="Separated by commas. Places beyond the list score nothing for the place.">
          <input name="points" defaultValue={d.points} placeholder="25, 20, 16" required className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="For playing" hint="Everyone who returns a card">
            <input name="attendance" inputMode="numeric" defaultValue={d.attendance} placeholder="0" className={inputClass} />
          </Field>
          <Field label="Best of" hint="Blank for every event">
            <input name="bestOf" inputMode="numeric" defaultValue={d.bestOf} placeholder="All" className={inputClass} />
          </Field>
        </div>
        <Toggle name="includeTeam" label="Include team and pairs events" hint="Each player in the team scores the team's points." defaultChecked={d.includeTeam} />
        <Field label="Season starts in">
          <select name="startMonth" defaultValue={d.startMonth} className={inputClass}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i + 1}>
                {monthName(i + 1)}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <SubmitButton>Save the rules</SubmitButton>
        </div>
      </ConsoleForm>
    </Card>
  );
}

function RulesSummary({ rules }: { rules: MeritRules }) {
  return (
    <Card title="The rules" subtitle="Only the owner, captain or secretary can change these.">
      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500">Points for 1st, 2nd, 3rd…</dt>
          <dd className="text-ink-900">{rules.points.join(", ")}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500">For playing</dt>
          <dd className="text-ink-900">{rules.attendancePoints}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500">Best of</dt>
          <dd className="text-ink-900">{rules.bestOf ?? "Every event counts"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500">Team and pairs events</dt>
          <dd className="text-ink-900">{rules.includeTeam ? "Included" : "Not included"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500">Season starts in</dt>
          <dd className="text-ink-900">{monthName(rules.seasonStartMonth)}</dd>
        </div>
      </dl>
    </Card>
  );
}
