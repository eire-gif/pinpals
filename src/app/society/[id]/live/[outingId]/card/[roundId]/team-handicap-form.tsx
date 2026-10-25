"use client";

import { ConsoleForm, SubmitButton } from "@/components/society-console/forms";
import { setTeamHandicap } from "../../actions";

/**
 * A team's or pair's handicap set by hand for this game (0189), from the
 * control room — the same call as the app's Edit on the card. Saving the
 * worked-out figure, or "Use the worked-out", puts it back.
 */
export default function TeamHandicapForm({
  groupId,
  outingId,
  roundId,
  current,
  auto,
  pair,
  started,
}: {
  groupId: number;
  outingId: number;
  roundId: number;
  /** As shown: "9", "+2". */
  current: string;
  auto: string;
  pair: boolean;
  /** Scores are in: the players are told, so ask first. */
  started: boolean;
}) {
  const who = pair ? "pair" : "team";
  return (
    <div className="grid gap-3">
      <ConsoleForm
        action={setTeamHandicap}
        className="flex flex-wrap items-end gap-3"
        confirm={started ? `Change the ${who}'s handicap? Scores so far are worked out again on the new figure, and the players are told.` : undefined}
      >
        <input type="hidden" name="g" value={groupId} />
        <input type="hidden" name="outing" value={outingId} />
        <input type="hidden" name="round" value={roundId} />
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-ink-900">{pair ? "Pair" : "Team"} plays off</span>
          <input
            name="handicap"
            defaultValue={current}
            inputMode="text"
            maxLength={3}
            pattern="\+?\d{1,2}"
            title="A whole number, or + for a plus team (+2)"
            className="w-24 rounded-lg border border-line bg-surface-tint px-3 py-2 text-center text-lg font-bold text-navy-900"
          />
        </label>
        <SubmitButton tone="navy" pendingLabel="Saving…">
          Save
        </SubmitButton>
        <span className="text-xs text-ink-500 pb-2">Whole numbers; + for a plus {who} (+2).</span>
      </ConsoleForm>
      {current !== auto ? (
        <ConsoleForm action={setTeamHandicap} confirm={started ? `Put the ${who} back on the worked-out ${auto}? The players are told.` : undefined}>
          <input type="hidden" name="g" value={groupId} />
          <input type="hidden" name="outing" value={outingId} />
          <input type="hidden" name="round" value={roundId} />
          <input type="hidden" name="reset" value="1" />
          <SubmitButton tone="quiet" size="sm" pendingLabel="…">
            Use the worked-out {auto}
          </SubmitButton>
        </ConsoleForm>
      ) : null}
    </div>
  );
}
