import { supabase } from "./supabase";
import { NO_STAKES, type SideGamesConfig, type SideMode, type SixesMode } from "./side-games";

/**
 * Side games on a live round (0196, claude/side-games.md): reading and
 * writing. The scoring is in side-games.ts; this file only moves rows.
 */

export type SideGamesState = {
  config: SideGamesConfig | null;
  setBy: string | null;
  /** Members who've said "I'm in" to the money games as they stand. */
  agreed: Set<string>;
  /** "from-to" → cents ticked as paid. */
  paid: Map<string, number>;
};

type Row = {
  best_front: boolean;
  best_back: boolean;
  best_overall: boolean;
  sixes: SixesMode | null;
  mode: SideMode;
  stake_front: number;
  stake_back: number;
  stake_overall: number;
  stake_sixes: number;
  set_by: string | null;
};

export const paidKey = (from: number, to: number) => `${from}-${to}`;

export async function loadSideGames(roundId: number): Promise<SideGamesState> {
  const [games, agreements, payments] = await Promise.all([
    supabase
      .from("live_round_side_games")
      .select("best_front, best_back, best_overall, sixes, mode, stake_front, stake_back, stake_overall, stake_sixes, set_by")
      .eq("round_id", roundId)
      .maybeSingle<Row>(),
    supabase.from("live_round_side_game_agreements").select("member_id").eq("round_id", roundId).returns<{ member_id: string }[]>(),
    supabase
      .from("live_round_side_game_payments")
      .select("from_player_id, to_player_id, amount_cents")
      .eq("round_id", roundId)
      .returns<{ from_player_id: number; to_player_id: number; amount_cents: number }[]>(),
  ]);
  if (games.error) throw games.error;
  const r = games.data;
  return {
    config: r
      ? {
          bestFront: r.best_front,
          bestBack: r.best_back,
          bestOverall: r.best_overall,
          sixes: r.sixes,
          mode: r.mode,
          stakes: { front: r.stake_front, back: r.stake_back, overall: r.stake_overall, sixes: r.stake_sixes },
        }
      : null,
    setBy: r?.set_by ?? null,
    agreed: new Set((agreements.data ?? []).map((a) => a.member_id)),
    paid: new Map((payments.data ?? []).map((p) => [paidKey(p.from_player_id, p.to_player_id), p.amount_cents])),
  };
}

/** Save the round's side games (whoever started the round), or null to turn them off. */
export async function saveSideGames(roundId: number, config: SideGamesConfig | null): Promise<void> {
  const stakes = config?.mode === "money" ? config.stakes : NO_STAKES;
  const { error } = await supabase.rpc("live_round_set_side_games", {
    p_round_id: roundId,
    p_games: config
      ? {
          best_front: config.bestFront,
          best_back: config.bestBack,
          best_overall: config.bestOverall,
          sixes: config.sixes,
          mode: config.mode,
          stake_front: stakes.front,
          stake_back: stakes.back,
          stake_overall: stakes.overall,
          stake_sixes: stakes.sixes,
        }
      : null,
  });
  if (error) throw new Error(error.message);
}

export async function agreeToSideGames(roundId: number, agree: boolean): Promise<void> {
  const { error } = await supabase.rpc("live_round_side_games_agree", { p_round_id: roundId, p_agree: agree });
  if (error) throw new Error(error.message);
}

export async function markSidePaid(roundId: number, from: number, to: number, cents: number, paid: boolean): Promise<void> {
  const { error } = await supabase.rpc("live_round_side_game_paid", {
    p_round_id: roundId,
    p_from: from,
    p_to: to,
    p_amount_cents: cents,
    p_paid: paid,
  });
  if (error) throw new Error(error.message);
}
