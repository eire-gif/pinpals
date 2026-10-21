"use client";

import { useState } from "react";

import { ConsoleForm, SubmitButton, inputClass } from "@/components/society-console/forms";
import { evenCuts, type Amendment, type ResultsSettings } from "@/lib/competition-results";
import { publishResults, saveResults } from "./actions";

/**
 * The organiser's choices before publishing, as on the app's results
 * screen: ties (random draw or shared), divisions by playing handicap, best
 * gross, guests, side prizes (nearest the pin, longest drive…) and
 * amendments — a hole's score corrected, or a card disqualified, always with
 * a reason members see. Save keeps a draft; Publish saves and publishes.
 */

type Entrant = { key: string; name: string; holes: number[]; scores: Record<number, number | null> };

const label = "block text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-1";
const chip = (on: boolean) => `rounded-xl border-[1.5px] px-3.5 py-2 text-sm font-semibold ${on ? "border-green-700 bg-green-100/70 text-ink-900" : "border-line bg-surface text-ink-900 hover:bg-cream-100"}`;

export default function ResultsSettingsForm({
  groupId,
  outingId,
  initial,
  team,
  handicaps,
  entrants,
  published,
  stops,
}: {
  groupId: number;
  outingId: number;
  initial: ResultsSettings;
  team: boolean;
  handicaps: number[];
  entrants: Entrant[];
  published: boolean;
  stops: string[];
}) {
  const [s, setS] = useState<ResultsSettings>(initial);
  const [divisions, setDivisions] = useState(initial.divisionCuts.length + 1);
  const [draft, setDraft] = useState<{ key: string; hole: string; strokes: string; dq: boolean; reason: string }>({ key: "", hole: "", strokes: "", dq: false, reason: "" });

  const set = <K extends keyof ResultsSettings>(k: K, v: ResultsSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const chooseDivisions = (n: number) => {
    setDivisions(n);
    set("divisionCuts", evenCuts(handicaps, n));
  };
  const nameOf = (key: string) => entrants.find((e) => e.key === key)?.name ?? "A card";
  const picked = entrants.find((e) => e.key === draft.key) ?? null;
  const was = picked && draft.hole ? picked.scores[Number(draft.hole)] : undefined;

  const addAmendment = () => {
    if (!picked || !draft.reason.trim()) return;
    const a: Amendment = draft.dq
      ? { key: picked.key, hole: null, strokes: null, dq: true, reason: draft.reason.trim() }
      : { key: picked.key, hole: Number(draft.hole), strokes: draft.strokes.toUpperCase() === "P" ? null : Number(draft.strokes), dq: false, reason: draft.reason.trim() };
    if (!a.dq && (!a.hole || (a.strokes !== null && !(Number.isInteger(a.strokes) && a.strokes >= 1 && a.strokes <= 20)))) return;
    set("amendments", [...s.amendments.filter((x) => !(x.key === a.key && x.hole === a.hole && x.dq === a.dq)), a]);
    setDraft({ key: "", hole: "", strokes: "", dq: false, reason: "" });
  };
  const draftOk = !!picked && !!draft.reason.trim() && (draft.dq || (!!draft.hole && (draft.strokes.toUpperCase() === "P" || /^\d{1,2}$/.test(draft.strokes))));

  const json = JSON.stringify(s);
  const confirm = [
    ...stops,
    published ? "Everyone in the day is told the results have been updated." : "Every card is closed and everyone in the day is told the results.",
    "Publish now?",
  ].join("\n\n");

  return (
    <div className="grid gap-5">
      <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-5">
        <h2 className="font-display font-bold text-lg text-ink-900">How the results are worked out</h2>
        <fieldset>
          <legend className={label}>Still level after every countback</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chip(s.tieRule === "draw")} aria-pressed={s.tieRule === "draw"} onClick={() => set("tieRule", "draw")}>
              Random draw
            </button>
            <button type="button" className={chip(s.tieRule === "share")} aria-pressed={s.tieRule === "share"} onClick={() => set("tieRule", "share")}>
              Share the place
            </button>
          </div>
        </fieldset>
        {!team && (
          <fieldset>
            <legend className={label}>Divisions, by playing handicap</legend>
            <div className="flex flex-wrap items-center gap-2">
              {[1, 2, 3].map((n) => (
                <button key={n} type="button" className={chip(divisions === n)} aria-pressed={divisions === n} onClick={() => chooseDivisions(n)}>
                  {n === 1 ? "One" : n === 2 ? "Two" : "Three"}
                </button>
              ))}
              {s.divisionCuts.map((c, i) => (
                <label key={i} className="flex items-center gap-1.5 text-sm text-ink-500">
                  Division {i + 2} from
                  <input
                    value={c}
                    inputMode="numeric"
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      set("divisionCuts", s.divisionCuts.map((x, j) => (j === i ? n : x)));
                    }}
                    className={`${inputClass} !w-16 text-center`}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {!team && (
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={s.bestGross} onChange={(e) => set("bestGross", e.target.checked)} className="mt-0.5 h-4 w-4 accent-green-700" />
              <span className="text-sm">
                <strong className="block">Best gross</strong>
                <span className="text-xs text-ink-500">From the cards</span>
              </span>
            </label>
          )}
          {!team && (
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={s.onePrizePerPlayer} onChange={(e) => set("onePrizePerPlayer", e.target.checked)} className="mt-0.5 h-4 w-4 accent-green-700" />
              <span className="text-sm">
                <strong className="block">One prize each</strong>
                <span className="text-xs text-ink-500">Best gross passes down</span>
              </span>
            </label>
          )}
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={s.guestsCanWin} onChange={(e) => set("guestsCanWin", e.target.checked)} className="mt-0.5 h-4 w-4 accent-green-700" />
            <span className="text-sm">
              <strong className="block">Guests can win</strong>
              <span className="text-xs text-ink-500">Otherwise listed, not placed</span>
            </span>
          </label>
        </div>
      </section>

      <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-3">
        <h2 className="font-display font-bold text-lg text-ink-900">Side prizes</h2>
        <p className="text-xs text-ink-500 -mt-2">The ones the cards can&apos;t decide: nearest the pin, longest drive, a twos club.</p>
        {s.extras.map((x, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <input
              aria-label="Prize"
              value={x.label}
              maxLength={60}
              onChange={(e) => set("extras", s.extras.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))}
              placeholder="Nearest the pin, 5th"
              className={`${inputClass} !w-auto flex-1 basis-48`}
            />
            <input
              aria-label="Winner"
              value={x.winner}
              maxLength={80}
              onChange={(e) => set("extras", s.extras.map((y, j) => (j === i ? { ...y, winner: e.target.value } : y)))}
              placeholder="Winner"
              list="entrant-names"
              className={`${inputClass} !w-auto flex-1 basis-48`}
            />
            <button type="button" onClick={() => set("extras", s.extras.filter((_, j) => j !== i))} className="text-sm font-semibold text-red-600 px-2">
              Remove
            </button>
          </div>
        ))}
        <datalist id="entrant-names">
          {entrants.map((e) => (
            <option key={e.key} value={e.name} />
          ))}
        </datalist>
        {s.extras.length < 20 && (
          <button type="button" onClick={() => set("extras", [...s.extras, { label: "", winner: "" }])} className="justify-self-start text-sm font-semibold text-green-700 hover:text-green-600">
            + Add a side prize
          </button>
        )}
      </section>

      <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-3">
        <h2 className="font-display font-bold text-lg text-ink-900">Amendments</h2>
        <p className="text-xs text-ink-500 -mt-2">
          A score signed for wrongly, or a breach of the rules. The players&apos; cards aren&apos;t changed: the result shows <strong className="text-red-600">Amended</strong> with what they submitted, what it became, and why.
        </p>
        {s.amendments.length > 0 && (
          <ul className="grid gap-2">
            {s.amendments.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-100 px-4 py-2.5 text-sm">
                <span>
                  <strong>{nameOf(a.key)}</strong> · {a.dq ? "Disqualified" : `Hole ${a.hole}: ${a.strokes === null ? "picked up" : a.strokes}`} — <span className="text-ink-500">{a.reason}</span>
                </span>
                <button type="button" onClick={() => set("amendments", s.amendments.filter((_, j) => j !== i))} className="text-sm font-semibold text-red-600">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr] items-end">
          <label className="block">
            <span className={label}>Card</span>
            <select value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} className={inputClass}>
              <option value="">Choose…</option>
              {entrants.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>Hole</span>
            <select value={draft.hole} disabled={draft.dq || !picked} onChange={(e) => setDraft({ ...draft, hole: e.target.value })} className={inputClass}>
              <option value="">–</option>
              {(picked?.holes ?? []).map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>Score</span>
            <input value={draft.strokes} disabled={draft.dq} maxLength={2} onChange={(e) => setDraft({ ...draft, strokes: e.target.value })} placeholder="6 or P" className={inputClass} />
          </label>
        </div>
        {picked && draft.hole && !draft.dq && <p className="text-xs text-ink-500">Submitted: {was === undefined ? "no score" : was === null ? "picked up" : was}</p>}
        <label className="block">
          <span className={label}>Reason (members see it)</span>
          <input value={draft.reason} maxLength={200} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} placeholder="Penalty for a lost ball confirmed by the marker" className={inputClass} />
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.dq} onChange={(e) => setDraft({ ...draft, dq: e.target.checked })} className="h-4 w-4 accent-red-600" />
            Disqualify this card instead
          </label>
          <button type="button" onClick={addAmendment} disabled={!draftOk} className="rounded-full bg-navy-900 px-4 py-2 text-xs font-semibold text-cream-50 disabled:opacity-50">
            Add the amendment
          </button>
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-3">
        <ConsoleForm action={saveResults}>
          <input type="hidden" name="g" value={groupId} />
          <input type="hidden" name="outing" value={outingId} />
          <input type="hidden" name="settings" value={json} />
          <SubmitButton tone="quiet">Save and see the results</SubmitButton>
        </ConsoleForm>
        <ConsoleForm action={publishResults} confirm={confirm}>
          <input type="hidden" name="g" value={groupId} />
          <input type="hidden" name="outing" value={outingId} />
          <input type="hidden" name="settings" value={json} />
          <SubmitButton tone="primary" pendingLabel="Publishing…">
            {published ? "Publish the update" : "Publish the results"}
          </SubmitButton>
        </ConsoleForm>
      </div>
      <p className="text-xs text-ink-500 -mt-3">The podium below is worked out from your last saved settings; save to see a change.</p>
    </div>
  );
}
