import { notFound } from "next/navigation";

import { HoleStrip } from "@/components/society-console/live-ui";
import { Card, PageHeader, Pill } from "@/components/society-console/ui";
import { buildBoard, shotsSoFar, stablefordPoints } from "@/lib/live-scoring";
import { requireConsole } from "@/lib/society-console/access";
import { loadEvent } from "@/lib/society-console/data";
import { controlRoom } from "@/lib/society-console/live-day";
import { loadLiveDay } from "@/lib/society-console/live-day-data";
import { isOutingDay } from "@/lib/society-console/outing-rules";
import { consoleHref, positiveInt } from "@/lib/society-console/rules";
import ScoreEditor from "./score-editor";

/**
 * One group's (or team's) card from the control room: every hole as
 * entered, with shots and points, who's on what, and — for whoever started
 * the day, while it's live — the boxes to correct a score.
 */

export const dynamic = "force-dynamic";

export default async function GroupCardPage({ params }: { params: Promise<{ id: string; outingId: string; roundId: string }> }) {
  const { id, outingId: rawOuting, roundId: rawRound } = await params;
  const ctx = await requireConsole(id, { area: "events", path: `/society/${id}/live/${rawOuting}/card/${rawRound}` });
  const g = ctx.society.id;
  const outingId = positiveInt(rawOuting);
  const roundId = positiveInt(rawRound);
  if (!outingId || !roundId) notFound();
  const page = await loadEvent(ctx.supabase, g, outingId);
  if (!page?.outing.matchDayId) notFound();
  const day = await loadLiveDay(ctx.supabase, page.outing.matchDayId, ctx.user.id);
  const game = day?.games.find((x) => x.round.id === roundId);
  if (!day || !game) notFound();

  const room = controlRoom([game], new Date(), { today: isOutingDay(page.outing.playsOn), kind: day.kind, starts: day.starts });
  const status = room.groups[0];
  const scramble = !!game.round.scramble;
  const ordered = [...game.players].sort((a, b) => a.position - b.position);
  const scoring = scramble ? ordered.slice(0, 1) : ordered;
  const card = [...game.card].sort((a, b) => a.hole - b.hole);
  const onPoints = scramble ? game.round.scramble?.foursomes === "stableford" : game.round.format !== "stroke";
  const handicapOf = (p: (typeof ordered)[number]) => (scramble ? (game.round.scramble?.teamHandicap ?? 0) : p.playingHandicap);
  const board = buildBoard(onPoints ? "stableford" : "stroke", card, scoring.map((p) => ({ id: p.id, name: p.name, playingHandicap: handicapOf(p) })), game.scores);
  const label = scramble ? game.round.scramble?.teamName?.trim() || `Team ${status.number}` : `Group ${status.number}`;
  const canFix = day.mine && game.round.status === "live";
  const nameOf = (p: (typeof ordered)[number]) => (scramble ? ordered.map((x) => x.name.split(" ")[0]).join(" & ") : p.name);

  return (
    <div className="grid gap-5">
      <PageHeader
        back={{ href: consoleHref(g, `live/${outingId}`), label: "Control room" }}
        title={`${label}${status.teeTime ? ` · ${status.teeTime}` : ""}`}
        description={`${ordered.map((p) => p.name).join(", ")}${status.start ? ` · started on ${status.start}` : ""}`}
        actions={
          <>
            {status.state === "done" ? <Pill tone="green">Card in</Pill> : status.state === "waiting" ? <Pill tone="gold">Not started</Pill> : <Pill tone="navy">{`Thru ${status.thru}`}</Pill>}
            {game.round.status === "finished" && <Pill tone="grey">Closed</Pill>}
          </>
        }
      />

      <Card title="The card" subtitle={onPoints ? "Strokes, with Stableford points underneath (net of shots)" : "Strokes, net to par in the total"}>
        <div className="-mx-5 overflow-x-auto">
          <table className="text-sm tabular-nums mx-5 border-collapse">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.06em] text-ink-500">
                <th scope="col" className="text-left pr-3 py-1 font-bold">
                  Hole
                </th>
                {card.map((h) => (
                  <th key={h.hole} scope="col" className="w-10 text-center font-bold text-navy-900">
                    {h.hole}
                  </th>
                ))}
                <th scope="col" className="px-3 text-right font-bold">
                  {onPoints ? "Pts" : "Net"}
                </th>
              </tr>
              <tr className="text-xs text-ink-500">
                <th scope="row" className="text-left pr-3 font-normal">
                  Par · SI
                </th>
                {card.map((h) => (
                  <td key={h.hole} className="text-center">
                    {h.par}
                    <span className="block text-[10px]">{h.strokeIndex ?? "?"}</span>
                  </td>
                ))}
                <td />
              </tr>
            </thead>
            <tbody>
              {scoring.map((p) => {
                const shots = shotsSoFar(handicapOf(p), card);
                const mine = game.scores.get(p.id);
                const row = board.rows.find((r) => r.playerId === p.id);
                return (
                  <tr key={p.id} className="border-t border-line">
                    <th scope="row" className="text-left pr-3 py-2 align-top">
                      <span className="block font-semibold text-ink-900 whitespace-nowrap">{nameOf(p)}</span>
                      <span className="text-xs font-normal text-ink-500">Plays off {handicapOf(p)}</span>
                    </th>
                    {card.map((h) => {
                      const has = mine?.has(h.hole);
                      const s = has ? (mine!.get(h.hole) ?? null) : undefined;
                      const sh = shots.get(h.hole) ?? 0;
                      return (
                        <td key={h.hole} className="text-center py-2 align-top">
                          <span className="block font-bold text-ink-900">{s === undefined ? "·" : s === null ? "P" : s}</span>
                          <span className="block text-[10px] text-ink-500">
                            {sh > 0 ? "•".repeat(Math.min(sh, 3)) : ""}
                            {onPoints && s !== undefined ? ` ${stablefordPoints(s, h.par, sh)}` : ""}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-3 text-right font-extrabold text-navy-900 align-top py-2">{row && row.thru > 0 ? (onPoints ? row.points : row.netToPar === 0 ? "E" : row.netToPar > 0 ? `+${row.netToPar}` : row.netToPar) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-1.5">
          {scoring.map((p) => {
            const key = scramble ? `t${game.round.id}` : `p${p.id}`;
            return room.strips[key] ? (
              <div key={p.id} className="flex items-center gap-3 rounded-xl bg-navy-900 px-3 py-2">
                <span className="w-32 truncate text-xs font-semibold text-cream-50">{nameOf(p)}</span>
                <HoleStrip holes={room.strips[key]} />
              </div>
            ) : null;
          })}
        </div>
        <p className="text-xs text-ink-500 mt-3">• a shot received on the hole · P picked up · · not entered yet</p>
      </Card>

      {canFix ? (
        <Card title="Correct a score" subtitle="For a mis-tap on a phone. Once the results are out, correct them there instead — the change shows as Amended.">
          <ScoreEditor
            groupId={g}
            outingId={outingId}
            roundId={game.round.id}
            holes={card.map((h) => ({ hole: h.hole, par: h.par }))}
            lines={scoring.map((p) => ({ id: p.id, name: nameOf(p), scores: Object.fromEntries([...(game.scores.get(p.id) ?? new Map())]) }))}
          />
        </Card>
      ) : (
        <p className="text-sm text-ink-500">
          {game.round.status === "finished"
            ? "This card is closed. Changes after the results are made as amendments on the results page."
            : `Only ${day.creatorName ?? "whoever started the round"} can correct scores — the players can change their own on their phones.`}
        </p>
      )}
    </div>
  );
}
