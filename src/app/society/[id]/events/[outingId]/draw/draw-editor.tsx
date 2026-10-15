"use client";

import { useMemo, useState } from "react";

import { ConsoleForm, SubmitButton, buttonClass, inputClass } from "@/components/society-console/forms";
import { drawPayload, publishedGroups, publishedTimes, publishedTiming, type Seat } from "@/lib/society-console/events-draw";
import { draw, honourWishes, indexTotal, swapPlayers, teeGroupSizes, teeTimes, type DrawMode, type DrawWishes, type Seat as Spot } from "@/lib/society-console/group-draw";
import { indexLabel } from "@/lib/society-console/rules";
import { publishDraw } from "./actions";

const GAPS = [8, 9, 10, 12];
const SIZES = [4, 3, 2] as const;
const SIZE_LABEL: Record<(typeof SIZES)[number], string> = { 4: "Fourballs", 3: "Threeballs", 2: "Twoballs" };

type Player = { key: string; name: string; index: number | null; guest: boolean };

/**
 * Makes the draw in the browser with the app's own rules (group-draw.ts),
 * lets the organiser swap any two players or move one into another group,
 * and posts the result to publish_outing_draw. Nothing is saved until
 * "Publish".
 */
export default function DrawEditor({
  groupId,
  outingId,
  seats,
  firstTee: eventFirstTee,
  published,
  wishes: rawWishes,
  indexNote,
}: {
  groupId: number;
  outingId: number;
  seats: Seat[];
  firstTee: string;
  published: boolean;
  wishes: { together: [string, string][]; early: string[]; late: string[]; met: [string, number][] };
  indexNote: string;
}) {
  const players: Player[] = useMemo(() => seats.map((s) => ({ key: s.key, name: s.name, index: s.index, guest: s.guest })), [seats]);
  const wishes: DrawWishes = useMemo(
    () => ({ together: rawWishes.together, early: new Set(rawWishes.early), late: new Set(rawWishes.late), met: new Map(rawWishes.met) }),
    [rawWishes]
  );
  const hasWishes = wishes.together.length > 0 || wishes.early.size > 0 || wishes.late.size > 0 || wishes.met.size > 0;

  const saved = useMemo(() => {
    const byKey = new Map(players.map((p) => [p.key, p]));
    return publishedGroups(seats).map((g) => g.map((s) => byKey.get(s.key)!).filter(Boolean));
  }, [seats, players]);
  const timing = publishedTiming(seats, GAPS);

  const [size, setSize] = useState<2 | 3 | 4>(() => {
    const biggest = Math.max(0, ...saved.map((g) => g.length));
    return biggest === 2 || biggest === 3 ? biggest : 4;
  });
  const [mode, setMode] = useState<DrawMode>("random");
  const [useWishes, setUseWishes] = useState(true);
  const [first, setFirst] = useState(timing.first ?? eventFirstTee);
  const [gap, setGap] = useState(timing.gap ?? 10);
  const [groups, setGroups] = useState<Player[][]>(saved);
  const [times, setTimes] = useState<string[]>(() => (saved.length ? publishedTimes(seats, saved.length) : []));
  const [picked, setPicked] = useState<Spot | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const drawnKeys = new Set(groups.flat().map((p) => p.key));
  const undrawn = players.filter((p) => !drawnKeys.has(p.key));
  const sizes = teeGroupSizes(players.length, size);

  function makeDraw() {
    let next = draw(players, sizes, mode);
    setNote(null);
    if (useWishes && hasWishes) {
      const out = honourWishes(next, wishes, { balanced: mode === "balanced" });
      next = out.groups;
      const bits = [
        out.togetherAsked ? `${out.together} of ${out.togetherAsked} "play with" requests` : null,
        wishes.early.size || wishes.late.size ? "early and late tee requests" : null,
        out.repeats === 0 && wishes.met.size ? "no repeat pairings from recent events" : out.repeats ? `${out.repeats} repeat pairing${out.repeats === 1 ? "" : "s"} couldn't be avoided` : null,
      ].filter(Boolean);
      setNote(bits.length ? `Honoured ${bits.join(" · ")}.` : null);
    }
    setGroups(next);
    setTimes(teeTimes(first, gap, next.length));
    setPicked(null);
    setDirty(true);
  }

  function retime(nextFirst: string, nextGap: number) {
    setFirst(nextFirst);
    setGap(nextGap);
    setTimes(teeTimes(nextFirst, nextGap, groups.length));
    setDirty(true);
  }

  function tap(spot: Spot) {
    if (!picked) {
      setPicked(spot);
      return;
    }
    if (picked.group !== spot.group || picked.position !== spot.position) {
      if (picked.group === -1) {
        // From "not in the draw": takes this seat; the player there goes out.
        const incoming = undrawn[picked.position];
        if (incoming) setGroups((gs) => gs.map((g, gi) => (gi === spot.group ? g.map((p, pi) => (pi === spot.position ? incoming : p)) : g)));
      } else if (spot.group === -1) {
        const incoming = undrawn[spot.position];
        if (incoming) setGroups((gs) => gs.map((g, gi) => (gi === picked.group ? g.map((p, pi) => (pi === picked.position ? incoming : p)) : g)));
      } else setGroups((gs) => swapPlayers(gs, picked, spot));
      setDirty(true);
    }
    setPicked(null);
  }

  /** Moves the picked player into group gi (or a new group at the end). */
  function moveTo(gi: number) {
    if (!picked) return;
    const who = picked.group === -1 ? undrawn[picked.position] : groups[picked.group]?.[picked.position];
    if (!who) return;
    let next = groups.map((g) => g.filter((p) => p.key !== who.key));
    if (gi >= next.length) next = [...next, [who]];
    else next[gi] = [...next[gi], who];
    const kept = next.map((g, i) => ({ g, i })).filter((x) => x.g.length > 0);
    setGroups(kept.map((x) => x.g));
    setTimes((ts) => {
      const mapped = kept.map((x) => ts[x.i] ?? "");
      return mapped.map((t, i) => t || teeTimes(first, gap, kept.length)[i] || "");
    });
    setPicked(null);
    setDirty(true);
  }

  function takeOut() {
    if (!picked || picked.group < 0) return;
    const next = groups.map((g, gi) => (gi === picked.group ? g.filter((_, pi) => pi !== picked.position) : g));
    const kept = next.map((g, i) => ({ g, i })).filter((x) => x.g.length > 0);
    setGroups(kept.map((x) => x.g));
    setTimes((ts) => kept.map((x) => ts[x.i] ?? ""));
    setPicked(null);
    setDirty(true);
  }

  const tooBig = groups.some((g) => g.length > 8);
  const badTime = times.some((t, i) => i < groups.length && t !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t));
  const problem = groups.length === 0 ? "Make the draw" : tooBig ? "A group has 8 players at most" : badTime ? "A tee time doesn't look right" : null;
  const payload = JSON.stringify(drawPayload(groups, times));
  const pickedPlayer = picked ? (picked.group === -1 ? undrawn[picked.position] : groups[picked.group]?.[picked.position]) : null;

  if (players.length === 0) {
    return (
      <div className="bg-surface rounded-2xl border border-line p-5 text-sm text-ink-500">Nobody is in the event yet. Add members or guests on the event page, then come back to draw them.</div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] items-start">
      {/* Settings */}
      <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-4 lg:sticky lg:top-4">
        <div>
          <h2 className="font-display font-bold text-lg text-ink-900">{`${players.length} playing`}</h2>
          <p className="text-xs text-ink-500">{indexNote}</p>
        </div>
        <Choice label="Group size">
          {SIZES.map((n) => (
            <Pill key={n} on={size === n} onClick={() => setSize(n)}>
              {SIZE_LABEL[n]}
            </Pill>
          ))}
        </Choice>
        <p className="text-xs text-ink-500 -mt-2">{sizes.length ? `${sizes.length} group${sizes.length === 1 ? "" : "s"}: ${sizes.join(" · ")}` : ""}</p>
        <Choice label="The draw">
          <Pill on={mode === "random"} onClick={() => setMode("random")}>
            Random
          </Pill>
          <Pill on={mode === "balanced"} onClick={() => setMode("balanced")}>
            Balanced by handicap
          </Pill>
        </Choice>
        {hasWishes && (
          <label className="flex items-start gap-2.5 text-sm text-ink-900 cursor-pointer">
            <input type="checkbox" checked={useWishes} onChange={(e) => setUseWishes(e.target.checked)} className="mt-0.5 h-4 w-4 accent-green-700" />
            Honour playing requests and avoid pairing the same people as recent events
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-1">First tee</span>
            <input type="time" value={first} onChange={(e) => retime(e.target.value, gap)} className={inputClass} />
          </label>
          <div>
            <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-1">Minutes apart</span>
            <div className="flex gap-1">
              {GAPS.map((g) => (
                <button key={g} type="button" onClick={() => retime(first, g)} aria-pressed={gap === g} className={`flex-1 rounded-lg border py-2 text-sm font-semibold ${gap === g ? "bg-navy-900 text-cream-50 border-navy-900" : "border-line bg-surface hover:bg-cream-100"}`}>
                  {g}′
                </button>
              ))}
            </div>
          </div>
        </div>
        <button type="button" onClick={makeDraw} className={buttonClass("navy")}>
          {groups.length ? "Draw again" : "Make the draw"}
        </button>
        {note && <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">{note}</p>}
        <p className="text-xs text-ink-500">
          Balanced deals the best and highest handicaps evenly across groups. Click one player, then another, to swap them.
        </p>
      </section>

      {/* The groups */}
      <div className="grid gap-4">
        {published && !dirty && groups.length > 0 && <p className="text-sm text-green-700 bg-green-100 rounded-xl px-4 py-2.5">This is the published draw. Change it and publish again, or draw afresh.</p>}
        {pickedPlayer && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-navy-900 text-cream-50 px-4 py-2.5 text-sm">
            <span className="flex-1 min-w-[12rem]">
              <strong>{pickedPlayer.name}</strong> picked — click another player to swap, or move them to a group.
            </span>
            {picked && picked.group >= 0 && (
              <button type="button" onClick={takeOut} className="rounded-full px-3 py-1 text-xs font-semibold bg-cream-50/15 hover:bg-cream-50/25">
                Leave out of the draw
              </button>
            )}
            <button type="button" onClick={() => setPicked(null)} className="rounded-full px-3 py-1 text-xs font-semibold bg-cream-50/15 hover:bg-cream-50/25">
              Cancel
            </button>
          </div>
        )}
        {groups.length === 0 ? (
          <div className="bg-surface rounded-2xl border border-dashed border-line p-8 text-center text-sm text-ink-500">Choose the group size and how to draw, then Make the draw.</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((g, gi) => (
              <section key={gi} className="bg-surface rounded-2xl border border-line shadow-sm p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="font-display font-bold text-ink-900">{`Group ${gi + 1}`}</h3>
                  <input
                    type="time"
                    aria-label={`Tee time, group ${gi + 1}`}
                    value={times[gi] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setTimes((ts) => {
                        const next = [...ts];
                        next[gi] = v;
                        return next;
                      });
                      setDirty(true);
                    }}
                    className="rounded-lg border border-line bg-cream-50 px-2 py-1 text-sm"
                  />
                </div>
                <ul className="grid gap-1.5">
                  {g.map((p, pi) => {
                    const on = picked?.group === gi && picked.position === pi;
                    return (
                      <li key={p.key}>
                        <button
                          type="button"
                          onClick={() => tap({ group: gi, position: pi })}
                          aria-pressed={on}
                          className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${on ? "bg-navy-900 text-cream-50" : "bg-cream-50 hover:bg-cream-100 text-ink-900"}`}
                        >
                          <span className="flex-1 min-w-0 truncate font-semibold">
                            {p.name}
                            {p.guest && <span className={`ml-1.5 text-[11px] font-bold uppercase ${on ? "text-gold-400" : "text-gold-600"}`}>Guest</span>}
                            {wishes.early.has(p.key) && <span className="ml-1.5 text-[11px] text-ink-500">early</span>}
                            {wishes.late.has(p.key) && <span className="ml-1.5 text-[11px] text-ink-500">late</span>}
                          </span>
                          <span className={`text-xs ${on ? "text-cream-50/80" : "text-ink-500"}`}>{p.index != null ? indexLabel(p.index) : "no index"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-ink-500">{`Indexes add to ${indexTotal(g)}`}</span>
                  {picked && picked.group !== gi && (
                    <button type="button" onClick={() => moveTo(gi)} className="text-xs font-semibold text-green-700 hover:underline">
                      Move here
                    </button>
                  )}
                </div>
              </section>
            ))}
            {picked && (
              <button type="button" onClick={() => moveTo(groups.length)} className="rounded-2xl border-2 border-dashed border-line p-4 text-sm font-semibold text-green-700 hover:bg-cream-100">
                + Start a new group with them
              </button>
            )}
          </div>
        )}

        {undrawn.length > 0 && groups.length > 0 && (
          <section className="bg-surface rounded-2xl border border-line p-4">
            <h3 className="font-display font-bold text-ink-900 mb-1">{`Not in the draw (${undrawn.length})`}</h3>
            <p className="text-xs text-ink-500 mb-2">Entered since the draw, or left out. Click one, then a player to swap with or a group to move them to.</p>
            <div className="flex flex-wrap gap-1.5">
              {undrawn.map((p, i) => {
                const on = picked?.group === -1 && picked.position === i;
                return (
                  <button key={p.key} type="button" onClick={() => tap({ group: -1, position: i })} aria-pressed={on} className={`rounded-full px-3 py-1.5 text-sm font-semibold border ${on ? "bg-navy-900 text-cream-50 border-navy-900" : "border-line hover:bg-cream-100"}`}>
                    {p.name}
                    {p.guest ? " (guest)" : ""}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <ConsoleForm action={publishDraw} className="bg-surface rounded-2xl border border-line p-4 grid gap-2">
          <input type="hidden" name="g" value={groupId} />
          <input type="hidden" name="outing" value={outingId} />
          <input type="hidden" name="groups" value={payload} />
          {problem && <p className="text-sm text-ink-500">{problem}</p>}
          {!problem && undrawn.length > 0 && <p className="text-sm text-gold-600">{`${undrawn.length} not in a group — they won't have a tee time.`}</p>}
          <div>
            {problem ? (
              <button type="button" disabled className={buttonClass("primary")}>
                {published ? "Publish the new tee times" : "Publish tee times"}
              </button>
            ) : (
              <SubmitButton pendingLabel="Publishing…">{published ? "Publish the new tee times" : "Publish tee times"}</SubmitButton>
            )}
          </div>
          <p className="text-xs text-ink-500">Members see their tee times as soon as you publish. You start the round on the day, in the app.</p>
        </ConsoleForm>
      </div>
    </div>
  );
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-1.5">{label}</span>
      <div className="flex flex-wrap gap-1.5" role="radiogroup">
        {children}
      </div>
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold border ${on ? "bg-navy-900 text-cream-50 border-navy-900" : "border-line bg-surface hover:bg-cream-100"}`}>
      {children}
    </button>
  );
}
