"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { biggestMovers, boardOf, leadMargin, ruleLine, type BoardRow, type ChampionshipPayload } from "@/lib/championship";

/**
 * The multi-day leaderboard on the website (0187), as approved on the
 * "PinPals — multi-round leaderboard" canvas: a card per day (course, par,
 * first tee, format, FINAL / LIVE), then the board after the chosen day —
 * position, ▲/▼ against the end of the day before, the total, today, thru,
 * a column per day and the leader, biggest movers and the rule beside it.
 *
 * `refresh` (seconds) re-reads the page's data while a day is live, so it
 * works on a clubhouse TV too (?tv=1 makes the type bigger).
 */

const DAY = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" }).toUpperCase();

function Move({ row }: { row: BoardRow }) {
  if (row.move == null || row.move === 0) return <span className="text-[#7f8da3]" aria-label="no change">–</span>;
  const up = row.move > 0;
  return (
    <span className={`inline-flex items-center gap-1 font-bold ${up ? "text-[#7fdca6]" : "text-[#f79a8b]"}`}>
      <svg width="12" height="10" viewBox="0 0 14 12" aria-hidden="true">
        <path d={up ? "M7 0 L14 12 L0 12 Z" : "M0 0 L14 0 L7 12 Z"} fill={up ? "#5cc98a" : "#f0705e"} />
      </svg>
      {Math.abs(row.move)}
      <span className="sr-only">{up ? "places up" : "places down"}</span>
    </span>
  );
}

export default function ChampionshipBoard({ data, me, tv = false, refresh = 30 }: { data: ChampionshipPayload; me: string | null; tv?: boolean; refresh?: number }) {
  const router = useRouter();
  const scoringRounds = data.scoring.map((d) => d.round);
  const latest = useMemo(() => boardOf(data).through, [data]);
  const [view, setView] = useState<number | null>(null);
  const through = view ?? latest;
  const board = useMemo(() => boardOf(data, through), [data, through]);
  const live = data.scoring.some((d) => d.status === "live");

  useEffect(() => {
    if (!live || refresh <= 0) return;
    const t = setInterval(() => router.refresh(), refresh * 1000);
    return () => clearInterval(t);
  }, [live, refresh, router]);

  const viewed = data.days.find((d) => d.round === scoringRounds[through - 1]);
  const movers = biggestMovers(board);
  const leader = board.rows.find((r) => r.position === 1);
  const line = ruleLine(board.rule, data.scoring.map((d) => d.kind));
  const big = tv ? "text-[1.15em]" : "";
  const cols = `56px 64px minmax(200px,1fr) 84px 76px 56px ${data.scoring.map(() => "60px").join(" ")}`;

  return (
    <div className={`bg-[#0b1b33] text-[#f3eee2] ${tv ? "min-h-screen p-8 text-lg" : "rounded-3xl p-5 sm:p-8"}`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-bold tracking-[0.18em] text-[#e3c06a]">PINPALS · {data.tripOutingId ? "TRIP" : "CHAMPIONSHIP"}</div>
          <h1 className={`font-display font-bold leading-tight mt-1 ${tv ? "text-5xl" : "text-3xl sm:text-4xl"}`}>{data.title}</h1>
          <div className="text-[#b9c3d3] mt-1">
            {data.days.length} rounds · {data.days.length ? `${DAY(data.days[0].playsOn)} – ${DAY(data.days[data.days.length - 1].playsOn)}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {live && (
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#5cc98a]/15 text-[#7fdca6] font-extrabold tracking-[0.12em] text-sm">
              <span className="w-2.5 h-2.5 rounded-full bg-[#5cc98a]" /> LIVE
            </span>
          )}
          {data.status === "cancelled" && <span className="px-4 py-2 rounded-full bg-[#a83a2b] font-bold text-sm">Cancelled</span>}
          <span className="px-4 py-2 rounded-full border border-[#2b4369] text-sm font-semibold text-[#d5dce6]">{line.title.replace("Overall: ", "")}</span>
        </div>
      </div>

      <nav aria-label="Rounds" className="grid gap-3 mt-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
        {data.days.map((d) => {
          const idx = scoringRounds.indexOf(d.round);
          const selected = idx >= 0 && idx + 1 === through;
          const clickable = idx >= 0 && d.status !== "upcoming";
          return (
            <button
              key={d.round}
              type="button"
              disabled={!clickable}
              aria-pressed={selected}
              onClick={() => setView(idx + 1)}
              className={`text-left rounded-2xl p-4 border-2 transition min-h-[112px] ${selected ? "bg-[#1c3760] border-[#e3c06a]" : "bg-[#11284a] border-[#2b4369]"} ${clickable ? "cursor-pointer hover:border-[#e3c06a]" : "cursor-default opacity-90"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-extrabold tracking-[0.14em] text-[#e3c06a]">
                  ROUND {d.round} · {DAY(d.playsOn)}
                </span>
                <span
                  className={`text-[11px] font-extrabold tracking-[0.1em] px-2.5 py-1 rounded-full ${d.status === "live" ? "bg-[#5cc98a] text-[#0b1b33]" : d.status === "final" ? "bg-[#2b4369] text-[#d5dce6]" : "bg-transparent border border-[#2b4369] text-[#b9c3d3]"}`}
                >
                  {d.status === "live" ? "LIVE" : d.status === "final" ? "FINAL" : "TO COME"}
                </span>
              </div>
              <div className="font-display font-bold text-xl mt-2">{d.courseName}</div>
              <div className="text-sm text-[#b9c3d3]">{[d.firstTee ? `first tee ${d.firstTee}` : null].filter(Boolean).join(" · ") || " "}</div>
              <div className="text-sm font-bold text-[#7fdca6] mt-1">
                {d.formatLabel}
                {d.excluded ? " · not on the leaderboard" : ""}
                {d.hidden ? " · leaderboard hidden" : ""}
              </div>
            </button>
          );
        })}
      </nav>

      <div className="flex flex-wrap gap-6 items-start mt-6">
        <section aria-label="Leaderboard" className="flex-[999_1_640px] min-w-0 bg-[#11284a] border border-[#2b4369] rounded-3xl overflow-hidden">
          <div className="flex flex-wrap justify-between items-baseline gap-2 px-5 pt-5 pb-3">
            <h2 className="font-display font-bold text-2xl">
              {board.live ? `Live — Round ${viewed?.round ?? through}` : `After Round ${viewed?.round ?? through}`}
              {viewed ? `, ${viewed.courseName}` : ""}
            </h2>
            <div className="text-sm text-[#b9c3d3]">{through > 1 ? `Arrows compare with the standings after Round ${scoringRounds[through - 2]}` : "Round 1 — no movement yet"}</div>
          </div>
          {board.rows.length === 0 ? (
            <p className="px-5 pb-6 text-[#b9c3d3]">No scores yet. The board fills in as the first cards come in.</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[860px]" role="table">
                <div role="row" className="grid items-center gap-x-2 px-5 h-11 bg-[#0e2240] border-y border-[#2b4369] text-[11px] font-extrabold tracking-[0.12em] text-[#a9b5c8]" style={{ gridTemplateColumns: cols }}>
                  <span role="columnheader">POS</span>
                  <span role="columnheader" className="text-center">
                    MOVE
                  </span>
                  <span role="columnheader">PLAYER</span>
                  <span role="columnheader" className="text-center">
                    {board.unit === "to par" ? "TO PAR" : "PTS"}
                  </span>
                  <span role="columnheader" className="text-center">
                    {board.live ? "TODAY" : `RND ${viewed?.round ?? through}`}
                  </span>
                  <span role="columnheader" className="text-center">
                    THRU
                  </span>
                  {data.scoring.map((s) => (
                    <span key={s.round} role="columnheader" className="text-center">
                      R{s.round}
                      {board.rule === "places" ? ` ${data.days.find((d) => d.round === s.round)?.short ?? ""}` : ""}
                    </span>
                  ))}
                </div>
                {board.rows.map((r, k) => {
                  const mine = !!me && r.memberId === me;
                  return (
                    <div
                      key={r.key}
                      role="row"
                      className={`grid items-center gap-x-2 px-5 min-h-[60px] py-2 border-b border-[#1e3659] ${mine ? "bg-[#24406a] shadow-[inset_4px_0_0_#e3c06a]" : k % 2 ? "bg-[#11284a]" : "bg-[#132c51]"} ${big}`}
                      style={{ gridTemplateColumns: cols }}
                    >
                      <span role="cell" className={`font-extrabold text-lg ${r.position === 1 ? "text-[#e3c06a]" : ""}`}>
                        {r.positionLabel}
                      </span>
                      <span role="cell" className="text-center">
                        <Move row={r} />
                      </span>
                      <span role="cell" className="min-w-0">
                        <span className="block font-semibold text-[17px] truncate">
                          {r.name}
                          {mine && <span className="ml-2 align-[2px] text-[11px] font-extrabold tracking-[0.1em] bg-[#e3c06a] text-[#0b1b33] px-2 py-0.5 rounded-full">YOU</span>}
                        </span>
                        {(r.detail || r.missed.length > 0) && (
                          <span className="block text-sm italic text-[#a9b5c8] truncate">{[r.detail, r.missed.length ? `missed R${r.missed.join(", R")}` : null].filter(Boolean).join(" · ")}</span>
                        )}
                      </span>
                      <span role="cell" className={`text-center font-extrabold text-xl ${r.position === 1 || (board.unit === "to par" && r.total < 0) ? "text-[#7fdca6]" : ""}`}>
                        {r.totalLabel}
                      </span>
                      <span role="cell" className="text-center font-bold text-[#d5dce6]">
                        {r.todayLabel}
                      </span>
                      <span role="cell" className="text-center font-semibold text-[#d5dce6]">
                        {r.thruLabel}
                      </span>
                      {r.cells.map((c, i) => (
                        <span key={i} role="cell" className={`text-center text-[15px] ${c.good ? "text-[#7fdca6]" : c.label === "—" ? "text-[#7f8da3]" : "text-[#d5dce6]"}`} title={board.rule === "places" && c.played ? `${c.scoreLabel} on the day` : undefined}>
                          {c.label}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-1 px-5 py-4 text-sm text-[#a9b5c8] border-t border-[#2b4369]">
            <span>▲ ▼ places gained or lost since the end of the previous round</span>
            <span>{line.body}</span>
            <span className="sm:ml-auto">Scores are provisional until each day&apos;s results are published</span>
          </div>
        </section>

        <aside className="flex-[1_1_260px] min-w-0 grid gap-5">
          {leader && (
            <div className="bg-[#11284a] border border-[#2b4369] rounded-3xl p-5">
              <div className="text-xs font-extrabold tracking-[0.14em] text-[#e3c06a]">LEADER</div>
              <div className="font-display font-bold text-2xl mt-1">{leader.name}</div>
              {leader.detail && <div className="text-[#b9c3d3]">{leader.detail}</div>}
              <div className="flex gap-6 mt-3">
                <div>
                  <div className="text-4xl font-extrabold text-[#7fdca6]">{leader.totalLabel}</div>
                  <div className="text-xs text-[#a9b5c8]">{board.unit}</div>
                </div>
                <div>
                  <div className="text-4xl font-extrabold">{leadMargin(board)}</div>
                  <div className="text-xs text-[#a9b5c8]">{board.unit === "to par" ? "shot lead" : "point lead"}</div>
                </div>
              </div>
            </div>
          )}
          <div className="bg-[#11284a] border border-[#2b4369] rounded-3xl p-5">
            <div className="text-xs font-extrabold tracking-[0.14em] text-[#e3c06a]">{board.live ? "BIGGEST MOVERS TODAY" : `BIGGEST MOVERS · ROUND ${viewed?.round ?? through}`}</div>
            {movers.length === 0 ? (
              <p className="text-[#b9c3d3] mt-3 text-sm">Movement starts after round 1 — every round after that compares each player with where they stood the night before.</p>
            ) : (
              <ul className="mt-3 grid gap-3">
                {movers.map((m) => (
                  <li key={m.key} className="flex items-center justify-between gap-3 pb-3 border-b border-[#2b4369] last:border-0">
                    <span>
                      <span className="block font-semibold">{m.name}</span>
                      <span className="block text-sm text-[#a9b5c8]">
                        now {m.positionLabel} · {m.todayLabel} that round
                      </span>
                    </span>
                    <Move row={m} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
