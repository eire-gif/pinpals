import Link from "next/link";

import { ActionButton, ConsoleForm, SubmitButton, buttonClass, inputClass } from "@/components/society-console/forms";
import { Avatar, Card, Empty, PageHeader, Table, Td } from "@/components/society-console/ui";
import { courseHandicap, playingHandicap } from "@/lib/live-scoring";
import { requireConsole } from "@/lib/society-console/access";
import { loadClubName, loadHandicaps, loadMembers } from "@/lib/society-console/data";
import { loadCourseTees, searchClubs } from "@/lib/society-console/people-data";
import { SOCIETY_ALLOWANCE, matchesSearch, parseCourseNumber } from "@/lib/society-console/people-rules";
import { consoleHref, dayLabel, indexLabel, positiveInt, roleLabel } from "@/lib/society-console/rules";
import { setHandicap } from "./actions";

type Search = { q?: string; course?: string; club?: string; tee?: string; rating?: string; slope?: string; par?: string };

/**
 * Handicaps — the app's handicaps screen: each member's own index, their
 * PinPals indicator (best of their last 20 scorecards) and the index the
 * society plays them off, set here. Pick a course and tees (saved cards,
 * course_cards) or type the rating, slope and par, and each row also shows
 * the course handicap and the 95% playing handicap for that day.
 */
export default async function HandicapsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireConsole(id, { area: "handicaps" });
  const { supabase: db, society, user } = ctx;
  const g = society.id;
  const q = (sp.q ?? "").slice(0, 80);
  const courseQuery = (sp.course ?? "").slice(0, 80);
  const clubId = positiveInt(sp.club ?? "") ?? null;
  const teeId = positiveInt(sp.tee ?? "") ?? null;

  const [members, rows, clubHits, tees, clubName] = await Promise.all([
    loadMembers(db, g),
    loadHandicaps(db, g),
    courseQuery.trim().length >= 2 ? searchClubs(db, courseQuery) : Promise.resolve([]),
    clubId ? loadCourseTees(db, clubId) : Promise.resolve([]),
    clubId ? loadClubName(db, clubId) : Promise.resolve(null),
  ]);

  const tee = teeId ? (tees.find((t) => t.id === teeId) ?? null) : null;
  const rating = tee?.courseRating ?? parseCourseNumber(sp.rating, 25, 85);
  const slopeRaw = tee?.slope ?? parseCourseNumber(sp.slope, 55, 155);
  const slope = slopeRaw != null ? Math.round(slopeRaw) : null;
  const parRaw = tee?.parTotal ?? parseCourseNumber(sp.par, 27, 80);
  const par = parRaw != null ? Math.round(parRaw) : null;
  const hasCourse = clubId != null && par != null && (tee != null || (rating != null && slope != null));

  const all = [...rows.values()];
  const setCount = all.filter((r) => r.societyIndex != null).length;
  const shown = [...members].sort((a, b) => a.name.localeCompare(b.name, "en-IE")).filter((m) => matchesSearch(q, m.name));

  const base = consoleHref(g, "handicaps");
  const href = (over: Partial<Search>) => {
    const next: Search = { q: q || undefined, club: clubId ? String(clubId) : undefined, tee: teeId ? String(teeId) : undefined, ...over };
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) usp.set(k, v);
    const s = usp.toString();
    return s ? `${base}?${s}` : base;
  };
  const homeClubLink = society.clubId && society.clubId !== clubId ? href({ club: String(society.clubId), tee: undefined, course: undefined }) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Handicaps"
        description="Set the index the society plays each member off. Their own handicap and their PinPals indicator — the best of their last 20 scorecards — are beside it to help. Society rounds use what you set here."
      />

      <Card
        title={hasCourse ? `Course handicaps at ${clubName ?? "the course"}${tee ? ` (${tee.teeName})` : ""}` : "Show course handicaps for a course"}
        subtitle={`${setCount} of ${all.length} set by the society.`}
        actions={
          clubId ? (
            <Link href={href({ club: undefined, tee: undefined })} className="text-sm font-semibold text-ink-500 hover:text-ink-900">
              Clear course
            </Link>
          ) : undefined
        }
      >
        {!clubId ? (
          <div className="space-y-3">
            <form action={base} method="get" className="flex flex-wrap gap-2">
              {q && <input type="hidden" name="q" value={q} />}
              <input type="search" name="course" defaultValue={courseQuery} placeholder="Search for the course" aria-label="Search for the course" className={`${inputClass} flex-1 min-w-[180px]`} />
              <button type="submit" className={buttonClass("quiet", "sm")}>
                Search
              </button>
              {homeClubLink && society.clubName && (
                <Link href={homeClubLink} className={buttonClass("quiet", "sm")}>
                  {society.clubName}
                </Link>
              )}
            </form>
            {courseQuery.trim().length >= 2 &&
              (clubHits.length === 0 ? (
                <p className="text-sm text-ink-500">No course matches that.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {clubHits.map((c) => (
                    <li key={c.id}>
                      <Link href={href({ club: String(c.id), tee: undefined })} className="block py-2 hover:bg-cream-100 rounded px-2">
                        <span className="font-semibold text-ink-900">{c.name}</span>
                        {c.place && <span className="text-ink-500"> · {c.place}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        ) : (
          <div className="space-y-3">
            {tees.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {tees.map((t) => (
                  <Link
                    key={t.id}
                    href={href({ tee: String(t.id) })}
                    aria-current={t.id === teeId ? "true" : undefined}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${t.id === teeId ? "bg-navy-900 text-cream-50" : "bg-surface border border-line text-ink-900 hover:bg-cream-100"}`}
                  >
                    {t.teeName}
                    {t.courseRating != null && t.slope != null ? ` · ${t.courseRating}/${t.slope}` : ""}
                  </Link>
                ))}
                <Link
                  href={href({ tee: undefined })}
                  aria-current={!teeId ? "true" : undefined}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${!teeId ? "bg-navy-900 text-cream-50" : "bg-surface border border-line text-ink-900 hover:bg-cream-100"}`}
                >
                  Other tees
                </Link>
              </div>
            ) : (
              <p className="text-sm text-ink-500">No saved cards for this course yet — enter the rating, slope and par from the card.</p>
            )}
            {!tee && (
              <form action={base} method="get" className="flex flex-wrap items-end gap-2">
                {q && <input type="hidden" name="q" value={q} />}
                <input type="hidden" name="club" value={clubId} />
                <label className="text-xs font-bold uppercase tracking-[0.06em] text-ink-500">
                  Rating
                  <input name="rating" inputMode="decimal" defaultValue={sp.rating ?? ""} placeholder="71.2" className={`${inputClass} w-24 mt-1`} />
                </label>
                <label className="text-xs font-bold uppercase tracking-[0.06em] text-ink-500">
                  Slope
                  <input name="slope" inputMode="numeric" defaultValue={sp.slope ?? ""} placeholder="128" className={`${inputClass} w-24 mt-1`} />
                </label>
                <label className="text-xs font-bold uppercase tracking-[0.06em] text-ink-500">
                  Par
                  <input name="par" inputMode="numeric" defaultValue={sp.par ?? ""} placeholder="72" className={`${inputClass} w-20 mt-1`} />
                </label>
                <button type="submit" className={buttonClass("quiet", "sm")}>
                  Show
                </button>
              </form>
            )}
            {!hasCourse && <p className="text-xs text-ink-500">Pick tees, or enter the rating, slope and par, to see course handicaps.</p>}
          </div>
        )}
      </Card>

      <Card>
        <form action={base} method="get" className="flex flex-wrap gap-2 mb-4">
          {clubId && <input type="hidden" name="club" value={clubId} />}
          {teeId && <input type="hidden" name="tee" value={teeId} />}
          <input type="search" name="q" defaultValue={q} placeholder="Search members" aria-label="Search members" className={`${inputClass} max-w-xs`} />
          <button type="submit" className={buttonClass("quiet", "sm")}>
            Search
          </button>
        </form>
        {shown.length === 0 ? (
          <Empty>No one matches that search.</Empty>
        ) : (
          <Table head={["Member", "Own", "PinPals indicator", "Plays off", ...(hasCourse ? ["Course · 95%"] : []), "Set the society's index"]}>
            {shown.map((m) => {
              const h = rows.get(m.id);
              const playsOff = h?.societyIndex ?? h?.ownIndex ?? null;
              const ch = hasCourse && playsOff != null ? courseHandicap(playsOff, { slope, courseRating: rating, par }) : null;
              const start = h?.societyIndex ?? h?.ownIndex ?? null;
              return (
                <tr key={m.id}>
                  <Td>
                    <div className="flex items-center gap-3 min-w-[170px]">
                      <Avatar name={m.name} url={m.avatarUrl} size={32} />
                      <div className="min-w-0">
                        <div className="font-semibold text-ink-900">{m.id === user.id ? `${m.name} (you)` : m.name}</div>
                        {(m.role !== "member" || m.office) && <div className="text-xs text-ink-500">{roleLabel(m.role, m.office)}</div>}
                      </div>
                    </div>
                  </Td>
                  <Td className="tabular-nums whitespace-nowrap">{indexLabel(h?.ownIndex ?? null)}</Td>
                  <Td className="tabular-nums whitespace-nowrap">
                    {indexLabel(h?.indicator ?? null)}{" "}
                    <span className="text-xs text-ink-500">
                      ({h?.rounds ?? 0} {h?.rounds === 1 ? "card" : "cards"})
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <div className={`font-display font-bold text-lg tabular-nums ${h?.societyIndex == null ? "text-ink-500" : "text-ink-900"}`}>{indexLabel(playsOff)}</div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-ink-500">
                      {h?.societyIndex != null ? `Society · ${dayLabel(h.societyIndexSetAt)}` : "Own"}
                    </div>
                  </Td>
                  {hasCourse && (
                    <Td className="tabular-nums whitespace-nowrap">
                      {ch ? (
                        <>
                          {ch.courseHandicap}
                          {ch.estimated ? "*" : ""} · plays {playingHandicap(ch.courseHandicap, SOCIETY_ALLOWANCE)}
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                  )}
                  <Td>
                    <ConsoleForm action={setHandicap} quiet className="flex items-center gap-2 min-w-[200px]">
                      <input type="hidden" name="g" value={g} />
                      <input type="hidden" name="m" value={m.id} />
                      <input
                        name="index"
                        defaultValue={start != null ? indexLabel(start).replace(/\.0$/, "") : ""}
                        placeholder="e.g. 14.2 or +1.5"
                        aria-label={`${m.name}'s society handicap index`}
                        className={`${inputClass} w-28`}
                      />
                      <SubmitButton size="sm" pendingLabel="…">
                        Save
                      </SubmitButton>
                    </ConsoleForm>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {h?.indicator != null && (
                        <ActionButton action={setHandicap} fields={{ g, m: m.id, index: indexLabel(h.indicator) }}>
                          Use indicator {indexLabel(h.indicator)}
                        </ActionButton>
                      )}
                      {h?.ownIndex != null && h.societyIndex !== h.ownIndex && (
                        <ActionButton action={setHandicap} fields={{ g, m: m.id, index: indexLabel(h.ownIndex) }}>
                          Use own {indexLabel(h.ownIndex)}
                        </ActionButton>
                      )}
                      {h?.societyIndex != null && (
                        <ActionButton action={setHandicap} fields={{ g, m: m.id, clear: "1" }} tone="danger">
                          Clear — use their own
                        </ActionButton>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
        {hasCourse && <p className="text-xs text-ink-500 mt-4">* No rating or slope for these tees, so the course handicap is the index rounded.</p>}
      </Card>
    </div>
  );
}
