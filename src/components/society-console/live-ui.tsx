import Link from "next/link";
import type { ReactNode } from "react";

import type { Results, ResultRow } from "@/lib/competition-results";
import type { HoleMark } from "@/lib/society-console/live-day";

/**
 * The Live day's pieces (Oct 2026), in the console's colours plus the
 * widget/TV board's navy, gold and live green: the five-step bar, the
 * hole-by-hole strip, and a results view. Presentational only — safe in
 * Server Components.
 */

export type StepState = "done" | "now" | "next";
export type Step = { label: string; sub: string; state: StepState; href?: string };

export function LiveSteps({ steps }: { steps: Step[] }) {
  return (
    <nav aria-label="Live day steps" className="mb-6 rounded-2xl border border-line bg-surface p-1.5 flex flex-wrap gap-1">
      {steps.map((s, i) => {
        const body = (
          <>
            <span
              className={`h-8 w-8 shrink-0 rounded-full inline-flex items-center justify-center text-sm font-extrabold ${
                s.state === "done" ? "bg-green-700 text-cream-50" : s.state === "now" ? "bg-gold-400 text-navy-900" : "border-2 border-line text-ink-500"
              }`}
            >
              {s.state === "done" ? "✓" : i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold">{s.label}</span>
              <span className={`block text-xs truncate ${s.state === "now" ? "text-cream-50/75" : "text-ink-500"}`}>{s.sub}</span>
            </span>
          </>
        );
        const cls = `flex flex-1 basis-36 min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 ${s.state === "now" ? "bg-navy-900 text-cream-50" : "text-ink-900"}`;
        return s.href && s.state !== "now" ? (
          <Link key={s.label} href={s.href} className={`${cls} hover:bg-cream-100`}>
            {body}
          </Link>
        ) : (
          <div key={s.label} className={cls} aria-current={s.state === "now" ? "step" : undefined}>
            {body}
          </div>
        );
      })}
    </nav>
  );
}

const MARK: Record<HoleMark, string> = {
  eagle: "bg-gold-400",
  birdie: "bg-[#4fc274]",
  par: "bg-[#4a6a93]",
  bogey: "bg-[#c98a5e]",
  double: "bg-[#c4473a]",
  pickup: "bg-[#c4473a]/50",
  none: "ring-1 ring-inset ring-[#9fb0c4]/40",
};

const MARK_LABEL: Record<HoleMark, string> = {
  eagle: "eagle or better",
  birdie: "birdie",
  par: "par",
  bogey: "bogey",
  double: "double bogey or worse",
  pickup: "picked up",
  none: "not played yet",
};

/** 18 small cells, one a hole, coloured by how it went net of shots. */
export function HoleStrip({ holes }: { holes: { hole: number; mark: HoleMark }[] }) {
  const said = holes.filter((h) => h.mark !== "none").map((h) => `${h.hole}: ${MARK_LABEL[h.mark]}`);
  return (
    <span className="inline-flex gap-[2px]" role="img" aria-label={said.length ? `Hole by hole — ${said.join(", ")}` : "No holes played yet"}>
      {holes.map((h) => (
        <span key={h.hole} title={`Hole ${h.hole}: ${MARK_LABEL[h.mark]}`} className={`inline-block h-[18px] w-[10px] rounded-[3px] ${MARK[h.mark]}`} />
      ))}
    </span>
  );
}

export function StripLegend() {
  const items: [HoleMark, string][] = [
    ["eagle", "Eagle+"],
    ["birdie", "Birdie"],
    ["par", "Par"],
    ["bogey", "Bogey"],
    ["double", "Double+ / no points"],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#c9d3e0]">
      {items.map(([m, label]) => (
        <span key={m} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3.5 w-[10px] rounded-[3px] ${MARK[m]}`} />
          {label}
        </span>
      ))}
      <span>Net of shots</span>
    </div>
  );
}

/** A tile in the control room's row of totals. */
export function LiveStat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone: "navy" | "green" | "gold" | "blue" | "red" | "grey" }) {
  const bg = { navy: "bg-navy-900", green: "bg-green-700", gold: "bg-gold-600", blue: "bg-[#23508f]", red: "bg-red-600", grey: "bg-ink-500" }[tone];
  return (
    <div className={`rounded-2xl p-4 text-white ${bg}`}>
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] opacity-85">{label}</div>
      <div className="font-display font-bold text-3xl leading-tight mt-0.5">{value}</div>
      {hint && <div className="text-xs opacity-85 mt-0.5">{hint}</div>}
    </div>
  );
}

const PODIUM = ["1st", "2nd", "3rd"];

/** A division's top three as a podium, 2nd · 1st · 3rd. */
export function Podium({ rows, unit }: { rows: ResultRow[]; unit: string }) {
  const top = [1, 2, 3].map((p) => rows.find((r) => r.position === p) ?? null);
  const order = [top[1], top[0], top[2]];
  return (
    <div className="grid grid-cols-3 gap-3 items-end">
      {order.map((r, i) => {
        const place = i === 1 ? 0 : i === 0 ? 1 : 2;
        const style =
          place === 0
            ? "bg-gradient-to-b from-[#17375a] to-navy-900 text-cream-50 border border-gold-500 min-h-52"
            : place === 1
              ? "bg-[#e6e9ee] text-ink-900 min-h-44"
              : "bg-[#f3e2cf] text-ink-900 min-h-36";
        return (
          <div key={place} className={`rounded-2xl p-4 flex flex-col justify-end gap-0.5 ${style}`}>
            <span className={`font-display font-bold ${place === 0 ? "text-4xl text-gold-400" : "text-3xl text-ink-500"}`}>{r ? r.positionLabel.replace(/^(\d+)$/, (_, n) => PODIUM[Number(n) - 1] ?? n) : PODIUM[place]}</span>
            <strong className="text-base sm:text-lg leading-tight">{r ? r.name : "—"}</strong>
            {r && (
              <span className={`text-xs ${place === 0 ? "text-cream-50/80" : "text-ink-500"}`}>
                Plays off {r.handicap}
                {r.note?.startsWith("Won on countback") ? " · won on countback" : ""}
              </span>
            )}
            {r && (
              <span className={`font-display font-bold text-3xl ${place === 0 ? "text-gold-400" : ""}`}>
                {r.score} <span className="font-sans text-sm font-normal opacity-75">{unit}</span>
              </span>
            )}
            {r && r.amended.length > 0 && <span className="text-[11px] font-bold uppercase text-red-600">Amended</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Every row of a ranking, with the countback figure and card status. */
export function ResultsTable({ results, rows, cardHref }: { results: Results; rows: ResultRow[]; cardHref?: (roundId: number) => string }) {
  const unit = results.basis === "stableford" ? "Pts" : "Net";
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-ink-500 border-b border-line">
            <th scope="col" className="font-bold px-5 py-2">
              Pos
            </th>
            <th scope="col" className="font-bold px-2 py-2">
              {results.team ? "Entry" : "Player"}
            </th>
            <th scope="col" className="font-bold px-2 py-2 text-center">
              Hcp
            </th>
            <th scope="col" className="font-bold px-2 py-2 text-center">
              Thru
            </th>
            <th scope="col" className="font-bold px-2 py-2 text-center">
              {results.holes === 18 ? "B9" : "L6"}
            </th>
            <th scope="col" className="font-bold px-2 py-2 text-center">
              Card
            </th>
            <th scope="col" className="font-bold px-5 py-2 text-right">
              {unit}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.key} className={row.position != null && row.position <= 3 ? "bg-gold-400/15" : ""}>
              <td className="px-5 py-2 font-display text-lg text-navy-900">{row.positionLabel}</td>
              <td className="px-2 py-2">
                <div className="font-semibold text-ink-900">
                  {cardHref ? (
                    <Link href={cardHref(row.roundId)} className="hover:text-green-700">
                      {row.name}
                    </Link>
                  ) : (
                    row.name
                  )}
                  {row.guest && <span className="ml-2 text-xs font-normal text-ink-500">guest</span>}
                </div>
                {row.detail && <div className="text-xs text-ink-500">{row.detail}</div>}
                {row.note && <div className={`text-xs ${row.wonTie ? "text-green-700 font-semibold" : "text-ink-500"}`}>{row.note}</div>}
                {row.amended.length > 0 && <div className="text-xs text-red-600 font-semibold">Amended: {row.amended.join(" · ")}</div>}
              </td>
              <td className="px-2 py-2 text-center text-ink-500">{row.handicap}</td>
              <td className="px-2 py-2 text-center text-ink-500">{row.status === "ok" ? (row.thru >= results.holes ? "F" : row.thru) : row.thru}</td>
              <td className="px-2 py-2 text-center text-ink-500">{row.back ?? "–"}</td>
              <td className="px-2 py-2 text-center">
                {row.status === "dq" ? (
                  <span className="text-xs font-bold text-red-600">DQ</span>
                ) : row.status === "nr" ? (
                  <span className="text-xs font-bold text-red-600">NR</span>
                ) : row.status === "out" ? (
                  <span className="text-xs text-ink-500">Not in</span>
                ) : row.certified ? (
                  <span className="text-xs font-bold text-green-700">Certified</span>
                ) : row.certified === false ? (
                  <span className="text-xs font-bold text-gold-600">Not certified</span>
                ) : (
                  <span className="text-xs text-ink-500">—</span>
                )}
              </td>
              <td className="px-5 py-2 text-right font-bold text-ink-900">{row.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The checks before publishing: stop (red), warn (gold), all clear (green). */
export function Checks({ checks }: { checks: Results["checks"] }) {
  return (
    <ul className="grid gap-2">
      {checks.map((c, i) => (
        <li
          key={i}
          className={`rounded-xl px-4 py-3 text-sm ${c.level === "stop" ? "bg-red-100 text-red-600" : c.level === "warn" ? "bg-gold-500/15 text-ink-900" : "bg-green-100 text-green-800"}`}
        >
          {c.text}
        </li>
      ))}
    </ul>
  );
}
