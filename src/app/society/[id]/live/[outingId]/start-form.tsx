"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { ConsoleForm, buttonClass, inputClass } from "@/components/society-console/forms";
import { blankCard, indexLabel, type CardHole } from "@/lib/live-scoring";
import { DAY_FORMATS, cardProblems, planDay, type DayFormat, type DrawnGroup, type PairScoring, type StartMode } from "@/lib/society-console/live-day";
import type { CourseCard } from "@/lib/society-console/live-day-data";
import { startRound } from "./actions";

/**
 * Set up and start the round (Oct 2026): the tees and their card, the
 * format, how the field starts, and whether the leaderboard is secret — with
 * every group's handicaps worked out as you choose, by the same rules the
 * Server Action uses again before anything is written.
 */

const KIND_TONE = {
  individual: { on: "bg-green-700 text-cream-50 border-green-700", off: "bg-green-100 text-ink-900 border-transparent", tag: "INDIVIDUAL" },
  pairs: { on: "bg-gold-600 text-cream-50 border-gold-600", off: "bg-gold-500/15 text-ink-900 border-transparent", tag: "PAIRS" },
  team: { on: "bg-red-600 text-cream-50 border-red-600", off: "bg-red-100 text-ink-900 border-transparent", tag: "TEAM" },
} as const;

const label = "block text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-1";

function bestCard(cards: CourseCard[]): CourseCard | null {
  const full = (c: CourseCard) => c.card.length === c.holes && c.card.every((h) => h.strokeIndex != null);
  return cards.find((c) => c.holes === 18 && full(c)) ?? cards.find(full) ?? cards[0] ?? null;
}

function StartButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} className={`${buttonClass("gold")} w-full !py-4 !text-lg`}>
      {pending ? "Starting the round…" : "Start the round"}
    </button>
  );
}

export default function StartForm({
  groupId,
  outingId,
  title,
  courseName,
  firstTee,
  today,
  dateLabel,
  cards,
  draw,
  notDrawn,
  links,
}: {
  groupId: number;
  outingId: number;
  title: string;
  courseName: string;
  firstTee: string | null;
  today: boolean;
  dateLabel: string;
  cards: CourseCard[];
  draw: DrawnGroup[];
  notDrawn: string[];
  links: { draw: string; handicaps: string | null; event: string };
}) {
  const initial = bestCard(cards);
  const [cardId, setCardId] = useState<number | "own">(initial?.id ?? "own");
  const [teeName, setTeeName] = useState(initial?.teeName ?? "");
  const [rating, setRating] = useState(initial?.courseRating != null ? String(initial.courseRating) : "");
  const [slope, setSlope] = useState(initial?.slope != null ? String(initial.slope) : "");
  const [card, setCard] = useState<CardHole[]>(initial?.card.length ? initial.card : blankCard(18));
  const [format, setFormat] = useState<DayFormat>("stableford");
  const [pairScoring, setPairScoring] = useState<PairScoring>("stableford");
  const [start, setStart] = useState<StartMode>("tees");
  const [shotgunTime, setShotgunTime] = useState(firstTee ?? "09:00");
  const [hidden, setHidden] = useState(false);
  const [showCard, setShowCard] = useState(!initial || initial.card.some((h) => h.strokeIndex == null));

  const pick = (id: number | "own") => {
    setCardId(id);
    if (id === "own") {
      setTeeName("");
      setRating("");
      setSlope("");
      setCard(blankCard(18));
      setShowCard(true);
      return;
    }
    const c = cards.find((x) => x.id === id);
    if (!c) return;
    setTeeName(c.teeName);
    setRating(c.courseRating != null ? String(c.courseRating) : "");
    setSlope(c.slope != null ? String(c.slope) : "");
    setCard(c.card.length === c.holes ? c.card : blankCard(c.holes));
    if (c.card.some((h) => h.strokeIndex == null)) setShowCard(true);
  };

  const setHole = (hole: number, field: "par" | "strokeIndex", raw: string) => {
    const n = raw === "" ? null : Number(raw);
    setCard((cs) => cs.map((h) => (h.hole !== hole ? h : field === "par" ? { ...h, par: n == null || !Number.isFinite(n) ? h.par : n } : { ...h, strokeIndex: n == null || !Number.isFinite(n) ? null : n })));
  };

  const ratingNum = rating.trim() === "" ? null : Number(rating.replace(",", "."));
  const slopeNum = slope.trim() === "" ? null : Number(slope);
  const plan = useMemo(
    () =>
      planDay(
        {
          title,
          courseName,
          clubId: null,
          tee: {
            teeName: teeName || "Standard",
            courseRating: ratingNum != null && Number.isFinite(ratingNum) ? ratingNum : null,
            slope: slopeNum != null && Number.isFinite(slopeNum) ? slopeNum : null,
            par: card.reduce((n, h) => n + h.par, 0),
            card,
          },
          format,
          pairScoring,
          start,
          shotgunTime: start === "shotgun" ? shotgunTime : null,
          notDrawn,
        },
        draw
      ),
    [title, courseName, teeName, ratingNum, slopeNum, card, format, pairScoring, start, shotgunTime, draw, notDrawn]
  );
  const players = draw.reduce((n, g) => n + g.players.length, 0);
  const estimated = plan.groups.some((g) => g.lines.some((l) => l.estimated));
  const canStart = today && plan.problems.length === 0;
  const par = card.reduce((n, h) => n + h.par, 0);
  const pairs = format === "foursomes" || format === "greensomes";
  const nines = card.length === 18 ? [card.slice(0, 9), card.slice(9, 18)] : [card];

  return (
    <ConsoleForm action={startRound} className="grid gap-5">
      <input type="hidden" name="g" value={groupId} />
      <input type="hidden" name="outing" value={outingId} />
      <input type="hidden" name="card" value={JSON.stringify(card)} />
      <input type="hidden" name="format" value={format} />
      <input type="hidden" name="pairScoring" value={pairScoring} />
      <input type="hidden" name="start" value={start} />

      <div className="flex flex-wrap gap-5 items-start">
        <div className="flex-[999_1_520px] min-w-0 grid gap-5">
          {/* Course and tees */}
          <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display font-bold text-lg text-ink-900">Where you&apos;re playing</h2>
              <span className="text-sm text-ink-500">{courseName}</span>
            </div>
            {cards.length === 0 && (
              <p className="text-sm text-ink-500 rounded-xl bg-cream-100 px-4 py-3">
                No card is on file for this course yet. Type the tees, rating and slope from the scorecard, and each hole&apos;s par and stroke index below.
              </p>
            )}
            <fieldset>
              <legend className={label}>Tees</legend>
              <div className="flex flex-wrap gap-2">
                {cards.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pick(c.id)}
                    aria-pressed={cardId === c.id}
                    className={`text-left rounded-xl border-[1.5px] px-4 py-2.5 min-h-11 ${cardId === c.id ? "border-green-700 bg-green-100/60 ring-2 ring-green-700/15" : "border-line bg-surface hover:bg-cream-100"}`}
                  >
                    <strong className="block text-sm text-ink-900">{c.teeName}</strong>
                    <span className="block text-xs text-ink-500">
                      {[c.parTotal ? `Par ${c.parTotal}` : null, c.courseRating != null ? `CR ${c.courseRating}` : null, c.slope ? `Slope ${c.slope}` : null, c.holes === 9 ? "9 holes" : null].filter(Boolean).join(" · ") || "No rating on file"}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => pick("own")}
                  aria-pressed={cardId === "own"}
                  className={`text-left rounded-xl border-[1.5px] px-4 py-2.5 min-h-11 ${cardId === "own" ? "border-green-700 bg-green-100/60 ring-2 ring-green-700/15" : "border-dashed border-line bg-surface hover:bg-cream-100"}`}
                >
                  <strong className="block text-sm text-ink-900">Type a card</strong>
                  <span className="block text-xs text-ink-500">From the club&apos;s scorecard</span>
                </button>
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className={label}>Tee name</span>
                <input name="teeName" value={teeName} onChange={(e) => setTeeName(e.target.value)} maxLength={40} placeholder="White" className={inputClass} />
              </label>
              <label className="block">
                <span className={label}>Course rating</span>
                <input name="rating" value={rating} onChange={(e) => setRating(e.target.value)} inputMode="decimal" placeholder="72.4" className={inputClass} />
              </label>
              <label className="block">
                <span className={label}>Slope</span>
                <input name="slope" value={slope} onChange={(e) => setSlope(e.target.value)} inputMode="numeric" placeholder="131" className={inputClass} />
              </label>
            </div>
            {estimated && <p className="text-xs text-gold-600 font-semibold">Without a rating and slope, each player plays off their index as it is (marked estimated).</p>}

            <div>
              <button type="button" onClick={() => setShowCard((s) => !s)} className="text-sm font-semibold text-green-700 hover:text-green-600" aria-expanded={showCard}>
                {showCard ? "Hide the card" : `Check the card · par ${par}, ${card.length} holes`}
              </button>
              {showCard && (
                <div className="mt-3 grid gap-3 overflow-x-auto">
                  {nines.map((nine, ni) => (
                    <table key={ni} className="text-sm tabular-nums border-collapse">
                      <tbody>
                        <tr>
                          <th scope="row" className="text-left pr-3 text-[11px] uppercase tracking-[0.06em] text-ink-500 font-bold">
                            Hole
                          </th>
                          {nine.map((h) => (
                            <td key={h.hole} className="text-center font-bold text-navy-900 w-12">
                              {h.hole}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <th scope="row" className="text-left pr-3 text-[11px] uppercase tracking-[0.06em] text-ink-500 font-bold">
                            Par
                          </th>
                          {nine.map((h) => (
                            <td key={h.hole} className="p-0.5">
                              <input
                                aria-label={`Par, hole ${h.hole}`}
                                value={h.par}
                                onChange={(e) => setHole(h.hole, "par", e.target.value)}
                                inputMode="numeric"
                                className="w-11 rounded-md border border-line bg-surface-tint px-1 py-1 text-center"
                              />
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <th scope="row" className="text-left pr-3 text-[11px] uppercase tracking-[0.06em] text-ink-500 font-bold">
                            S.I.
                          </th>
                          {nine.map((h) => (
                            <td key={h.hole} className="p-0.5">
                              <input
                                aria-label={`Stroke index, hole ${h.hole}`}
                                value={h.strokeIndex ?? ""}
                                onChange={(e) => setHole(h.hole, "strokeIndex", e.target.value)}
                                inputMode="numeric"
                                className={`w-11 rounded-md border px-1 py-1 text-center ${h.strokeIndex == null ? "border-red-600 bg-red-100" : "border-line bg-surface-tint"}`}
                              />
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  ))}
                  <p className="text-xs text-ink-500">Changes here are for this round only. Every player is scored on this card.</p>
                </div>
              )}
            </div>
          </section>

          {/* Format */}
          <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display font-bold text-lg text-ink-900">The game</h2>
              <Link href="/formats" target="_blank" className="text-sm font-semibold text-green-700 hover:text-green-600">
                How each format works ↗
              </Link>
            </div>
            <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(170px,1fr))]">
              {DAY_FORMATS.map((f) => {
                const tone = KIND_TONE[f.kind];
                const on = format === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFormat(f.id)}
                    aria-pressed={on}
                    className={`text-left rounded-2xl border-[1.5px] p-3.5 min-h-24 ${on ? `${tone.on} shadow-[0_0_0_3px_rgba(31,92,46,0.15)]` : `${tone.off} hover:brightness-95`}`}
                  >
                    <span className={`block text-[11px] font-bold tracking-[0.1em] ${on ? "opacity-85" : "text-ink-500"}`}>{tone.tag}</span>
                    <strong className="block text-base mt-0.5">{f.label}</strong>
                    <span className={`block text-xs ${on ? "opacity-85" : "text-ink-500"}`}>{f.blurb}</span>
                  </button>
                );
              })}
            </div>
            {pairs && (
              <fieldset>
                <legend className={label}>Pairs are ranked by</legend>
                <div className="flex flex-wrap gap-2">
                  {(["stableford", "stroke"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setPairScoring(s)}
                      aria-pressed={pairScoring === s}
                      className={`rounded-xl border-[1.5px] px-4 py-2.5 text-sm font-semibold ${pairScoring === s ? "border-green-700 bg-green-100/60" : "border-line bg-surface hover:bg-cream-100"}`}
                    >
                      {s === "stableford" ? "Stableford points" : "Net stroke play"}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <p className="text-xs text-ink-500">Ties are split the Golf Ireland way when you publish: back 9, last 6, last 3 and the 18th. Divisions, best gross and side prizes are set on the results.</p>
          </section>

          {/* Start */}
          <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-4">
            <h2 className="font-display font-bold text-lg text-ink-900">How the field starts</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStart("tees")}
                aria-pressed={start === "tees"}
                className={`flex-1 basis-52 text-left rounded-xl border-[1.5px] px-4 py-3 ${start === "tees" ? "border-green-700 bg-green-100/60" : "border-line bg-surface hover:bg-cream-100"}`}
              >
                <strong className="block text-sm">Tee times from the draw</strong>
                <span className="block text-xs text-ink-500">{draw[0]?.teeTime ? `${draw[0].teeTime} onwards, as published` : "As published"}</span>
              </button>
              <button
                type="button"
                onClick={() => setStart("shotgun")}
                aria-pressed={start === "shotgun"}
                className={`flex-1 basis-52 text-left rounded-xl border-[1.5px] px-4 py-3 ${start === "shotgun" ? "border-green-700 bg-green-100/60" : "border-line bg-surface hover:bg-cream-100"}`}
              >
                <strong className="block text-sm">Shotgun start</strong>
                <span className="block text-xs text-ink-500">Every group off at once, a hole each (A and B groups when busy)</span>
              </button>
            </div>
            {start === "shotgun" && (
              <label className="block max-w-48">
                <span className={label}>Shotgun at</span>
                <input name="shotgunTime" value={shotgunTime} onChange={(e) => setShotgunTime(e.target.value)} placeholder="09:00" className={inputClass} />
              </label>
            )}
            <label className="flex items-start gap-3 cursor-pointer rounded-xl bg-cream-100 px-4 py-3">
              <input type="checkbox" name="hidden" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="mt-0.5 h-4 w-4 accent-green-700" />
              <span>
                <span className="block text-sm font-semibold text-ink-900">Keep the leaderboard secret</span>
                <span className="block text-xs text-ink-500">Players see only their own group until you publish the results. You — and the clubhouse TV — see everything.</span>
              </span>
            </label>
          </section>
        </div>

        {/* Summary */}
        <aside className="flex-[1_1_300px] min-w-0 grid gap-4 content-start md:sticky md:top-6">
          <section className="rounded-3xl border-[1.5px] border-gold-500/50 bg-gradient-to-b from-[#17375a] via-navy-900 to-[#12291f] p-5 text-cream-50 grid gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-gold-400">Ready to start</div>
              <div className="font-display font-bold text-2xl mt-1">{DAY_FORMATS.find((f) => f.id === format)?.label}</div>
              <div className="text-sm text-[#c9d3e0]">
                {courseName}
                {teeName ? ` · ${teeName}` : ""} · {card.length} holes
              </div>
            </div>
            <ul className="grid gap-2.5 text-sm">
              <Check ok={cardProblems(card).length === 0}>Course card and stroke indexes</Check>
              <Check ok={draw.length > 0}>{draw.length > 0 ? `${players} players in ${draw.length} groups` : "Draw not published"}</Check>
              <Check ok={!plan.problems.some((p) => p.includes("handicap index"))}>Every handicap in</Check>
              <Check ok={today}>{today ? "It's the day" : `Starts on ${dateLabel}`}</Check>
            </ul>
            {plan.problems.length > 0 && (
              <ul className="grid gap-1.5 rounded-xl bg-red-600/20 px-3 py-2.5 text-xs text-cream-50">
                {plan.problems.slice(0, 6).map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
                {plan.problems.length > 6 && <li>…and {plan.problems.length - 6} more</li>}
              </ul>
            )}
            <StartButton disabled={!canStart} />
            <p className="text-xs text-[#c9d3e0]">
              Opens one live game per group on every player&apos;s phone and tells each of them their group. If someone already opened a game, they&apos;re asked to use this one.
            </p>
          </section>
          <div className="flex flex-wrap gap-2">
            <Link href={links.draw} className={buttonClass("quiet", "sm")}>
              Change the draw
            </Link>
            {links.handicaps && (
              <Link href={links.handicaps} className={buttonClass("quiet", "sm")}>
                Society handicaps
              </Link>
            )}
            <Link href={`${links.event}#guests`} className={buttonClass("quiet", "sm")}>
              Guests
            </Link>
          </div>
        </aside>
      </div>

      {/* The groups, with handicaps */}
      <section className="bg-surface rounded-2xl border border-line shadow-sm p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h2 className="font-display font-bold text-lg text-ink-900">Groups and handicaps</h2>
          <span className="text-xs text-ink-500">
            {format === "stableford" || format === "stroke" ? "Plays off 95% of course handicap" : pairs ? "Each group: seats 1 & 2, seats 3 & 4" : "Each group is one team"}
          </span>
        </div>
        {draw.length === 0 ? (
          <p className="text-sm text-ink-500">
            No draw yet.{" "}
            <Link href={links.draw} className="font-semibold text-green-700">
              Make the draw
            </Link>{" "}
            — the round is played in its tee groups.
          </p>
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
            {plan.groups.map((g, gi) => (
              <div key={g.number} className="rounded-2xl border border-line overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 text-cream-50" style={{ background: GROUP_COLOURS[gi % GROUP_COLOURS.length] }}>
                  <span>
                    <strong className="font-display text-lg">{g.teeTime ?? "—"}</strong>
                    <span className="ml-2 text-xs opacity-85">Group {g.number}</span>
                  </span>
                  {g.start && <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">Hole {g.start}</span>}
                </div>
                <ul className="divide-y divide-line">
                  {g.lines.map((l, i) => (
                    <li key={i} className="px-4 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-ink-900">{l.name}</span>
                        {l.players.length > 0 && (
                          <span className="font-bold text-navy-900" title="Plays off">
                            {l.handicap}
                            {l.estimated ? "*" : ""}
                          </span>
                        )}
                      </div>
                      {l.players.length > 0 && (
                        <div className="text-xs text-ink-500">
                          {l.players.map((p) => `${l.players.length > 1 ? `${p.name.split(" ")[0]} ` : ""}${indexLabel(p.index)} → CH ${p.courseHandicap}${p.guest ? " · guest" : ""}`).join(" · ")}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </ConsoleForm>
  );
}

const GROUP_COLOURS = ["#0c2038", "#123058", "#23508f", "#1f5c2e", "#2c7a3d", "#6b4d0f", "#b6862a", "#a83a2b"];

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className={`h-5 w-5 shrink-0 rounded-full inline-flex items-center justify-center text-[11px] font-extrabold ${ok ? "bg-[#4fc274] text-navy-900" : "bg-gold-400 text-navy-900"}`} aria-hidden="true">
        {ok ? "✓" : "!"}
      </span>
      <span className={ok ? "" : "text-[#c9d3e0]"}>{children}</span>
    </li>
  );
}
