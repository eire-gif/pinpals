/**
 * Competition mode for the hole map (Phase A, Oct 2026).
 *
 * Rule 4.3 and Model Local Rule G-5: in a competition a distance-measuring
 * device may measure distance, but a player must not use it to work out how
 * wind changes a shot, or to get a club recommendation. The hole map does
 * both ("plays like", the club pill), so in a competition round they go.
 *
 * What stays: plain distances (front, centre, back, hazards, tap-to-measure,
 * arcs at fixed distances or at the player's own club yardages, which are
 * information they had before the round), marking shots, hole tips, and the
 * wind forecast itself — speed and direction, without saying what it does
 * to this shot.
 *
 * A round is a competition when:
 *   - it's part of a society event, or a day with competition results
 *     (live_round_is_competition, 0168) — set for everyone, can't be undone
 *     on the phone; or
 *   - the member switched it on for this round themselves (e.g. they're
 *     scoring their club's medal here). Kept on the phone for the round.
 */
export type CompetitionSource = "society" | "manual" | null;

export type Assist = {
  /** Competition mode is on. */
  on: boolean;
  source: CompetitionSource;
  /** "Plays like" and the wind's effect on the number. */
  playsLike: boolean;
  /** The suggested-club pill. */
  clubSuggestion: boolean;
  /** "Into you, left to right" — the wind worked out for this shot. */
  windOnShot: boolean;
  /** Can the member turn it off on this phone? */
  canSwitchOff: boolean;
};

export function assistFor(fromRound: boolean, manual: boolean): Assist {
  const on = fromRound || manual;
  return {
    on,
    source: fromRound ? "society" : manual ? "manual" : null,
    playsLike: !on,
    clubSuggestion: !on,
    windOnShot: !on,
    canSwitchOff: !fromRound,
  };
}

/** One line under the yardages when it's on. */
export function competitionLine(a: Assist): string | null {
  if (!a.on) return null;
  return a.source === "society"
    ? "Competition round · distances only (Rule 4.3)"
    : "Competition mode · distances only (Rule 4.3)";
}
