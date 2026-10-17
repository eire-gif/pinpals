import { supabase } from "@/lib/supabase";

export { assistFor, competitionLine, type Assist, type CompetitionSource } from "@/lib/competition-mode-rules";

/** Competition mode's link to the database. The rules are in competition-mode-rules.ts. */

/**
 * Does this round count as a competition for everyone in it? False on any
 * error, so a phone without 0170 behaves exactly as before — the member
 * can still switch it on themselves.
 */
export async function loadRoundIsCompetition(roundId: number): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("live_round_is_competition", { p_round_id: roundId });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

// Switched on by hand, per round, while the app is open. A round lasts a
// few hours; nobody needs this to survive a restart mid-round more than
// they need it not to linger into tomorrow's casual round.
const manualRounds = new Set<number>();

export function manualCompetition(roundId: number | null): boolean {
  return roundId != null && manualRounds.has(roundId);
}

export function setManualCompetition(roundId: number | null, on: boolean): void {
  if (roundId == null) return;
  if (on) manualRounds.add(roundId);
  else manualRounds.delete(roundId);
}
