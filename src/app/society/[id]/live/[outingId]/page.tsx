import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton, ConsoleForm, SubmitButton } from "@/components/society-console/forms";
import { HoleStrip, LiveStat, LiveSteps, StripLegend, type Step } from "@/components/society-console/live-ui";
import { buttonClass, inputClass } from "@/components/society-console/styles";
import { Card, Empty, PageHeader, Pill } from "@/components/society-console/ui";
import { buildTvPayload, type TvDay } from "@/lib/tv-board";
import { signTvToken } from "@/lib/tv-token";
import { requireConsole } from "@/lib/society-console/access";
import { loadEvent } from "@/lib/society-console/data";
import { controlRoom, ordinal } from "@/lib/society-console/live-day";
import { loadCourseCards, loadDrawnGroups, loadLiveDay, notDrawn, type LiveDay } from "@/lib/society-console/live-day-data";
import { clock, isOutingDay, outingDateLabel, outingPast } from "@/lib/society-console/outing-rules";
import { consoleHref, positiveInt } from "@/lib/society-console/rules";
import { connectTv, setHidden } from "./actions";
import AutoRefresh from "./auto-refresh";
import StartForm from "./start-form";

/**
 * One event's Live day (Oct 2026): before the round, set up and start it
 * (StartForm); once it's started, the control room — the leaderboard with
 * every card's hole-by-hole colours, which hole each group is on, what needs
 * the organiser, the birdie feed, the clubhouse TV and the secret
 * leaderboard switch; then the results. Events area only.
 */

export const dynamic = "force-dynamic";

const GROUP_COLOURS = ["#0c2038", "#123058", "#23508f", "#1f5c2e", "#2c7a3d", "#6b4d0f", "#b6862a", "#a83a2b"];
const colourOf = (n: number) => GROUP_COLOURS[(n - 1 + GROUP_COLOURS.length) % GROUP_COLOURS.length];

export default async function LiveDayPage({ params }: { params: Promise<{ id: string; outingId: string }> }) {
  const { id, outingId: rawOuting } = await params;
  const ctx = await requireConsole(id, { area: "events", path: `/society/${id}/live/${rawOuting}` });
  const g = ctx.society.id;
  const outingId = positiveInt(rawOuting);
  if (!outingId) notFound();
  const page = await loadEvent(ctx.supabase, g, outingId);
  if (!page) notFound();
  const o = page.outing;
  const back = { href: consoleHref(g, "live"), label: "Live day" };
  const eventHref = consoleHref(g, `events/${o.id}`);

  if (o.kind !== "day" || o.status === "cancelled") {
    return (
      <div className="max-w-3xl">
        <PageHeader title={o.title} back={back} />
        <Card>
          <p className="text-sm text-ink-500">
            {o.status === "cancelled" ? "This event was cancelled." : "A trip's rounds are started from its itinerary, in the app. The Live day is for days out."}
          </p>
        </Card>
      </div>
    );
  }

  const day = o.matchDayId ? await loadLiveDay(ctx.supabase, o.matchDayId, ctx.user.id) : null;
  const published = day?.results?.status === "published";
  const steps: Step[] = [
    { label: "Set up", sub: day ? "Done" : "Tees, card, format", state: day ? "done" : "now" },
    { label: "Players & groups", sub: o.drawPublishedAt ? `${page.entries.length + page.guests.length} in the draw` : "Make the draw", state: o.drawPublishedAt ? "done" : "next", href: day ? undefined : consoleHref(g, `events/${o.id}/draw`) },
    { label: "Start", sub: day ? "Started" : "Open scoring", state: day ? "done" : "next" },
    { label: "Live", sub: published ? "Scoring closed" : "Scoreboard", state: published ? "done" : day ? "now" : "next" },
    { label: "Results", sub: published ? "Published" : "Podium & publish", state: published ? "done" : "next", href: day ? consoleHref(g, `live/${o.id}/results`) : undefined },
  ];

  if (!o.matchDayId) {
    const past = outingPast(o.playsOn);
    const [cards, draw] = await Promise.all([loadCourseCards(ctx.supabase, o.clubId), loadDrawnGroups(ctx.supabase, g, page)]);
    return (
      <div>
        <PageHeader
          back={back}
          title={o.title}
          description={`${outingDateLabel(o.playsOn)}${o.courseName ? ` · ${o.courseName}` : ""}${clock(o.firstTee) ? ` · first tee ${clock(o.firstTee)}` : ""}`}
          actions={
            <Link href={eventHref} className={buttonClass("quiet")}>
              The event
            </Link>
          }
        />
        <LiveSteps steps={steps} />
        {past ? (
          <Card>
            <p className="text-sm text-ink-500">This day has been played without a live round on PinPals, so there&apos;s nothing to run here.</p>
          </Card>
        ) : (
          <StartForm
            groupId={g}
            outingId={o.id}
            title={o.title}
            courseName={o.courseName ?? "Golf course"}
            firstTee={clock(o.firstTee)}
            today={isOutingDay(o.playsOn)}
            dateLabel={outingDateLabel(o.playsOn)}
            cards={cards}
            draw={draw}
            notDrawn={notDrawn(page)}
            links={{ draw: consoleHref(g, `events/${o.id}/draw`), handicaps: ctx.areas.includes("handicaps") ? consoleHref(g, "handicaps") : null, event: eventHref }}
          />
        )}
      </div>
    );
  }

  if (!day) {
    return (
      <div className="max-w-3xl">
        <PageHeader title={o.title} back={back} />
        <Card>
          <p className="text-sm text-ink-500">The live round for this event has been removed in the app.</p>
        </Card>
      </div>
    );
  }

  return <ControlRoomView g={g} outingId={o.id} title={o.title} day={day} steps={steps} back={back} eventHref={eventHref} today={isOutingDay(o.playsOn)} />;
}

function ControlRoomView({
  g,
  outingId,
  title,
  day,
  steps,
  back,
  eventHref,
  today,
}: {
  g: number;
  outingId: number;
  title: string;
  day: LiveDay;
  steps: Step[];
  back: { href: string; label: string };
  eventHref: string;
  today: boolean;
}) {
  const now = new Date();
  const published = day.results?.status === "published";
  const tvDay: TvDay = { id: day.id, title: day.title, teamNames: null, kind: day.kind };
  const board = buildTvPayload({ day: tvDay, games: day.games, published, now });
  const room = controlRoom(day.games, now, { today, kind: day.kind, starts: day.starts });
  const live = day.games.some((x) => x.round.status === "live");
  const tvUrl = `/tv/s/${signTvToken({ kind: "day", id: day.id }).token}`;
  const base = { g, outing: outingId };
  const pct = room.totals.holesTotal ? Math.round((room.totals.holesScored / room.totals.holesTotal) * 100) : 0;
  const cardHref = (roundId: number) => consoleHref(g, `live/${outingId}/card/${roundId}`);
  const groupOfRow = new Map<string, number>();
  for (const x of day.games) {
    const n = x.round.matchNumber ?? x.round.scramble?.teamNumber ?? 0;
    if (x.round.scramble) groupOfRow.set(`t${x.round.id}`, n);
    for (const p of x.players) groupOfRow.set(`p${p.id}`, n);
  }
  const roundOfRow = new Map<string, number>();
  for (const x of day.games) {
    roundOfRow.set(`t${x.round.id}`, x.round.id);
    for (const p of x.players) roundOfRow.set(`p${p.id}`, x.round.id);
  }
  const holes = day.games[0]?.card.map((h) => h.hole).sort((a, b) => a - b) ?? [];

  return (
    <div>
      <PageHeader
        back={back}
        title="Live control room"
        description={`${title} · ${day.courseName}${day.teeName ? ` · ${day.teeName}` : ""} · ${board.subtitle}`}
        actions={
          <>
            <a href={tvUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("quiet")}>
              Open the TV board ↗
            </a>
            <Link href={eventHref} className={buttonClass("quiet")}>
              The event
            </Link>
            <Link href={consoleHref(g, `live/${outingId}/results`)} className={buttonClass("gold")}>
              {published ? "The results" : "Cards in & results →"}
            </Link>
          </>
        }
      />
      <LiveSteps steps={steps} />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {published ? (
            <Pill tone="navy">Results published</Pill>
          ) : live ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-[#d6f0dd] px-3 py-1 text-xs font-extrabold tracking-[0.12em] text-green-800">
              <span className="h-2 w-2 rounded-full bg-[#2fae5a] animate-pulse" aria-hidden="true" />
              LIVE
            </span>
          ) : (
            <Pill tone="green">All cards in</Pill>
          )}
          {day.hidden && <Pill tone="gold">Secret leaderboard</Pill>}
          {!day.mine && <span className="text-xs text-ink-500">Started by {day.creatorName ?? "another organiser"} — only they can correct scores and publish the results.</span>}
        </div>
        {!published && <AutoRefresh updatedAt={now.toISOString()} />}
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-5 mb-5">
        <LiveStat tone="navy" label="On the course" value={room.totals.groupsOut} hint={`${room.groups.length} ${day.kind === "scramble" ? "teams" : "groups"} · ${room.totals.groupsWaiting} still to start`} />
        <LiveStat tone="green" label="Holes scored" value={`${pct}%`} hint={`${room.totals.holesScored} of ${room.totals.holesTotal}`} />
        <LiveStat tone="gold" label="Birdies or better" value={board.highlights.length} hint={board.highlights[0] ? `Latest: ${board.highlights[0].who.split(" ")[0]}, ${ordinal(board.highlights[0].hole)}` : "None yet"} />
        <LiveStat tone="blue" label="Finished" value={`${room.totals.groupsDone} / ${room.groups.length}`} hint={day.kind === "scramble" ? "teams in" : "groups in"} />
        <LiveStat tone={room.attention.length ? "red" : "grey"} label="Needs you" value={room.attention.length} hint={room.attention.length ? "See the list" : "All quiet"} />
      </div>

      <div className="flex flex-wrap gap-5 items-start">
        {/* The leaderboard */}
        <section className="flex-[1.6_1_560px] min-w-0 rounded-3xl border-[1.5px] border-gold-500/50 bg-gradient-to-b from-[#17375a] via-navy-900 to-[#12291f] p-5 text-cream-50 tabular-nums">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-gold-400">
            Leaderboard · {board.scoreHeading === "PTS" ? "Stableford points" : "Net to par"}
          </div>
          <div className="font-display font-bold text-2xl mt-1">{day.title}</div>
          {board.kind === "matches" ? (
            <ul className="mt-4 divide-y divide-white/10">
              {board.matches.map((m) => (
                <li key={m.key} className="py-2.5 flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-bold text-gold-400 w-10">{m.label}</span>
                  <span className="flex-1 min-w-0">
                    {m.left} <span className="text-[#9fb0c4]">v</span> {m.right}
                  </span>
                  <span className="font-bold">{m.status}</span>
                  <span className="text-[#9fb0c4] text-xs">{m.thru}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-4 -mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-bold tracking-[0.1em] text-[#9fb0c4] border-b border-white/15">
                    <th scope="col" className="px-5 py-2">
                      POS
                    </th>
                    <th scope="col" className="px-2 py-2">
                      {board.kind === "teams" ? "TEAM" : "PLAYER"}
                    </th>
                    <th scope="col" className="px-2 py-2">
                      HC
                    </th>
                    <th scope="col" className="px-2 py-2">
                      HOLE BY HOLE
                    </th>
                    <th scope="col" className="px-2 py-2">
                      ON
                    </th>
                    <th scope="col" className="px-5 py-2 text-right">
                      {board.scoreHeading}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((r, i) => {
                    const fresh = board.highlights.some((h) => h.rowKey === r.key && now.getTime() - new Date(h.at).getTime() < 10 * 60 * 1000);
                    const round = roundOfRow.get(r.key);
                    return (
                      <tr key={r.key} className={`border-b border-white/10 ${fresh ? "bg-[#4fc274]/15" : ""}`}>
                        <td className={`px-5 py-2 font-extrabold ${i === 0 && r.started ? "text-gold-400" : "text-gold-400/90"}`}>{r.pos || "–"}</td>
                        <td className="px-2 py-2">
                          {round ? (
                            <Link href={cardHref(round)} className="font-bold hover:text-gold-400">
                              {r.name}
                            </Link>
                          ) : (
                            <strong>{r.name}</strong>
                          )}
                          <div className="text-xs text-[#9fb0c4]">{[groupOfRow.get(r.key) ? `${day.kind === "scramble" ? "Team" : "Group"} ${groupOfRow.get(r.key)}` : null, r.sub].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td className="px-2 py-2 text-[#c9d3e0]">{r.hcp}</td>
                        <td className="px-2 py-2">{room.strips[r.key] ? <HoleStrip holes={room.strips[r.key]} /> : null}</td>
                        <td className="px-2 py-2 font-bold text-[#c9d3e0]">{r.on}</td>
                        <td className={`px-5 py-2 text-right text-xl font-extrabold ${i === 0 && r.started ? "text-gold-400" : ""}`}>{r.score}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <StripLegend />
            <span className="text-xs text-[#9fb0c4]">{board.note}</span>
          </div>
        </section>

        {/* The course and what needs you */}
        <aside className="flex-[1_1_320px] min-w-0 grid gap-5">
          {holes.length > 0 && (
            <Card title="On the course" subtitle="Which group is on each hole now">
              <div className="grid grid-cols-6 gap-1.5">
                {holes.map((h) => {
                  const here = room.onHole[h] ?? [];
                  return (
                    <div key={h} className={`rounded-xl p-1.5 min-h-16 flex flex-col justify-between border ${here.length ? "bg-surface border-navy-800" : "bg-cream-100 border-line"}`}>
                      <span className={`text-[11px] font-extrabold ${here.length ? "text-ink-900" : "text-ink-500"}`}>{h}</span>
                      <span className="flex flex-wrap gap-0.5">
                        {here.map((n) => (
                          <span key={n} className="inline-flex min-w-6 h-5 items-center justify-center rounded-md px-1 text-[11px] font-extrabold text-white" style={{ background: colourOf(n) }}>
                            {day.kind === "scramble" ? "T" : "G"}
                            {n}
                          </span>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card title="Needs you" subtitle={room.attention.length ? undefined : "Nothing waiting — groups quiet for 25 minutes, late starts and odd scores show here."}>
            {room.attention.length === 0 ? (
              <p className="text-sm text-green-700 font-semibold">All quiet on the course.</p>
            ) : (
              <ul className="divide-y divide-line -my-2">
                {room.attention.slice(0, 8).map((a) => (
                  <li key={a.key} className="py-3">
                    <div className={`text-sm font-semibold ${a.level === "stop" ? "text-red-600" : "text-ink-900"}`}>{a.title}</div>
                    <div className="text-xs text-ink-500">{a.detail}</div>
                    {a.roundId && (
                      <Link href={cardHref(a.roundId)} className="inline-block mt-1.5 text-xs font-semibold text-green-700 hover:text-green-600">
                        {day.mine && !published ? "Open the card to check or correct →" : "Open the card →"}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      <div className="flex flex-wrap gap-5 items-start mt-5">
        <Card className="flex-[1.6_1_560px] min-w-0" title={day.kind === "scramble" ? "Teams" : "Groups"} subtitle="Open one to see its card hole by hole">
          {room.groups.length === 0 ? (
            <Empty>No groups in this round.</Empty>
          ) : (
            <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
              {room.groups.map((x) => (
                <Link key={x.roundId} href={cardHref(x.roundId)} className="rounded-2xl border border-line bg-surface-tint p-3.5 grid gap-2 hover:shadow-md transition">
                  <span className="flex items-center justify-between gap-2">
                    <span className="inline-flex h-6 min-w-8 items-center justify-center rounded-lg px-1.5 text-xs font-extrabold text-white" style={{ background: colourOf(x.number) }}>
                      {day.kind === "scramble" ? x.label : `G${x.number}`}
                    </span>
                    {x.state === "done" ? (
                      <Pill tone="green">In</Pill>
                    ) : x.state === "waiting" ? (
                      <Pill tone="gold">{x.teeTime ? `Tee ${x.teeTime}` : "Not started"}</Pill>
                    ) : x.quietFor != null && x.quietFor >= 25 ? (
                      <Pill tone="red">Quiet {x.quietFor} min</Pill>
                    ) : (
                      <Pill tone="navy">On the {/^\d+$/.test(x.on) ? ordinal(Number(x.on)) : x.on}</Pill>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="flex-1 h-2 rounded-full bg-cream-100 overflow-hidden">
                      <span className="block h-2" style={{ width: `${Math.round((x.thru / Math.max(1, x.holes)) * 100)}%`, background: colourOf(x.number) }} />
                    </span>
                    <strong className="text-xs text-ink-900">{x.thru >= x.holes ? "In" : `Thru ${x.thru}`}</strong>
                  </span>
                  <span className="text-xs text-ink-500">
                    {x.names}
                    {x.start ? ` · starts on ${x.start}` : ""}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <div className="flex-[1_1_320px] min-w-0 grid gap-5">
          <Card title="Live feed" subtitle="Birdies or better — the TV flashes them too">
            {board.highlights.length === 0 ? (
              <Empty>No birdies yet.</Empty>
            ) : (
              <ul className="divide-y divide-line -my-2">
                {board.highlights.slice(0, 8).map((h) => (
                  <li key={h.id} className="py-2.5 flex items-start gap-3">
                    <span
                      className={`h-9 w-9 shrink-0 rounded-xl inline-flex items-center justify-center text-xs font-extrabold ${h.kind === "birdie" ? "bg-[#4fc274] text-navy-900" : "bg-gold-400 text-navy-900"}`}
                      aria-hidden="true"
                    >
                      {h.kind === "birdie" ? "B" : h.kind === "eagle" ? "E" : h.kind === "albatross" ? "A" : "1"}
                    </span>
                    <span className="min-w-0">
                      <strong className="block text-sm text-ink-900">
                        {h.who}: {h.headline.replace("!", "").toLowerCase()} on the {ordinal(h.hole)}
                      </strong>
                      <span className="text-xs text-ink-500">
                        {h.strokes} on a par {h.par}
                        {h.points ? ` · ${h.points} pts` : ""}
                        {h.now ? ` · now ${h.now}` : ""} · {new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit" }).format(new Date(h.at))}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="On the day">
            <div className="grid gap-4">
              <div>
                <div className="text-sm font-semibold text-ink-900">Secret leaderboard</div>
                <p className="text-xs text-ink-500 mb-2">
                  {day.hidden ? "Players see only their own group. It's revealed when you publish the results." : "Everyone in the day can see the full leaderboard on their phone."}
                </p>
                {!published && (
                  <ActionButton action={setHidden} fields={{ ...base, hidden: day.hidden ? "0" : "1" }} tone={day.hidden ? "primary" : "quiet"}>
                    {day.hidden ? "Show it to everyone" : "Keep it secret"}
                  </ActionButton>
                )}
              </div>
              <div>
                <div className="text-sm font-semibold text-ink-900">Clubhouse TV</div>
                <p className="text-xs text-ink-500 mb-2">
                  Open <strong>pinpals.ie/tv</strong> on the TV and type the code it shows, or open the board on a laptop plugged into it.
                </p>
                <ConsoleForm action={connectTv} className="flex flex-wrap gap-2">
                  <input type="hidden" name="g" value={g} />
                  <input type="hidden" name="outing" value={outingId} />
                  <label className="sr-only" htmlFor="tv-code">
                    TV code
                  </label>
                  <input id="tv-code" name="code" placeholder="K7Q4MP" maxLength={8} autoComplete="off" className={`${inputClass} !w-32 uppercase tracking-[0.2em]`} />
                  <SubmitButton tone="navy" size="sm" pendingLabel="Connecting…">
                    Connect the TV
                  </SubmitButton>
                </ConsoleForm>
              </div>
              <Link href={consoleHref(g, "messages")} className="text-sm font-semibold text-green-700 hover:text-green-600">
                Message the players →
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
