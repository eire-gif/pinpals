"use client";

import { useMemo, useState } from "react";

import { ConsoleForm, SubmitButton } from "@/components/society-console/forms";
import { fixScores } from "../../actions";

/**
 * The organiser's corrections to a live card (Oct 2026): type the strokes
 * (blank to clear, "P" for picked up), then save — each change goes through
 * live_round_set_score, the app's own call, so the players' phones show it
 * at once. Only offered to whoever started the day, while it's live.
 */

type Line = { id: number; name: string; scores: Record<number, number | null> };

const show = (v: number | null | undefined) => (v === undefined ? "" : v === null ? "P" : String(v));

export default function ScoreEditor({
  groupId,
  outingId,
  roundId,
  holes,
  lines,
}: {
  groupId: number;
  outingId: number;
  roundId: number;
  holes: { hole: number; par: number }[];
  lines: Line[];
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const l of lines) for (const h of holes) out[`${l.id}:${h.hole}`] = show(l.scores[h.hole]);
    return out;
  });

  const { fixes, bad } = useMemo(() => {
    const fixes: { player: number; hole: number; strokes: number | null; clear?: boolean }[] = [];
    let bad = 0;
    for (const l of lines)
      for (const h of holes) {
        const k = `${l.id}:${h.hole}`;
        const was = show(l.scores[h.hole]);
        const now = (values[k] ?? "").trim().toUpperCase();
        if (now === was) continue;
        if (now === "") fixes.push({ player: l.id, hole: h.hole, strokes: null, clear: true });
        else if (now === "P") fixes.push({ player: l.id, hole: h.hole, strokes: null });
        else if (/^\d{1,2}$/.test(now) && Number(now) >= 1 && Number(now) <= 20) fixes.push({ player: l.id, hole: h.hole, strokes: Number(now) });
        else bad += 1;
      }
    return { fixes, bad };
  }, [values, lines, holes]);

  return (
    <ConsoleForm action={fixScores} className="grid gap-3">
      <input type="hidden" name="g" value={groupId} />
      <input type="hidden" name="outing" value={outingId} />
      <input type="hidden" name="round" value={roundId} />
      <input type="hidden" name="fixes" value={JSON.stringify(fixes)} />
      <div className="-mx-5 overflow-x-auto">
        <table className="text-sm tabular-nums border-collapse mx-5">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.06em] text-ink-500">
              <th scope="col" className="text-left pr-3 py-1 font-bold">
                Hole
              </th>
              {holes.map((h) => (
                <th key={h.hole} scope="col" className="w-11 text-center font-bold text-navy-900">
                  {h.hole}
                  <div className="font-normal text-ink-500 normal-case">p{h.par}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <th scope="row" className="text-left pr-3 py-1 font-semibold text-ink-900 whitespace-nowrap">
                  {l.name}
                </th>
                {holes.map((h) => {
                  const k = `${l.id}:${h.hole}`;
                  const changed = (values[k] ?? "").trim().toUpperCase() !== show(l.scores[h.hole]);
                  return (
                    <td key={h.hole} className="p-0.5">
                      <input
                        aria-label={`${l.name}, hole ${h.hole}`}
                        value={values[k] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                        maxLength={2}
                        className={`w-10 rounded-md border px-1 py-1 text-center ${changed ? "border-gold-500 bg-gold-400/20 font-bold" : "border-line bg-surface-tint"}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton tone="navy" pendingLabel="Saving…">
          {fixes.length ? `Save ${fixes.length} ${fixes.length === 1 ? "change" : "changes"}` : "Save changes"}
        </SubmitButton>
        <span className="text-xs text-ink-500">{bad ? `${bad} ${bad === 1 ? "box doesn't" : "boxes don't"} look like a score — use 1 to 20, P for picked up, or blank.` : "Type a score, P for picked up, or clear the box."}</span>
      </div>
    </ConsoleForm>
  );
}
