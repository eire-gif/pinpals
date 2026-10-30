import { supabase } from "./supabase";
import { NO_EXTRA, NO_STAKES, type SideGamesConfig, type SideMode, type SixesMode } from "./side-games";

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
  /** Wolf (0201): hole → the Wolf's partner's player id, or null for a Lone Wolf. */
  wolfPicks: Map<number, number | null>;
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
  skins?: "carry" | "void" | null;
  wolf?: boolean;
  nassau?: boolean;
  stake_skins?: number;
  stake_wolf?: number;
  stake_nassau?: number;
};

const COLS = "best_front, best_back, best_overall, sixes, mode, stake_front, stake_back, stake_overall, stake_sixes, set_by";
const COLS_0201 = `${COLS}, skins, wolf, nassau, stake_skins, stake_wolf, stake_nassau`;

/** "column … does not exist": a database without 0201 yet. */
const missingColumn = (e: { code?: string; message: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204" || /does not exist|could not find/i.test(e.message));

export const paidKey = (from: number, to: number) => `${from}-${to}`;

export async function loadSideGames(roundId: number): Promise<SideGamesState> {
  const [first, agreements, payments, picks] = await Promise.all([
    supabase.from("live_round_side_games").select(COLS_0201).eq("round_id", roundId).maybeSingle<Row>(),
    supabase.from("live_round_side_game_agreements").select("member_id").eq("round_id", roundId).returns<{ member_id: string }[]>(),
    supabase
      .from("live_round_side_game_payments")
      .select("from_player_id, to_player_id, amount_cents")
      .eq("round_id", roundId)
      .returns<{ from_player_id: number; to_player_id: number; amount_cents: number }[]>(),
    supabase.from("live_round_wolf_picks").select("hole, partner_player_id").eq("round_id", roundId).returns<{ hole: number; partner_player_id: number | null }[]>(),
  ]);
  // Before 0201 reaches the database, read 0196's columns only.
  const games = missingColumn(first.error)
    ? await supabase.from("live_round_side_games").select(COLS).eq("round_id", roundId).maybeSingle<Row>()
    : first;
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
          extra: {
            skins: r.skins ?? null,
            wolf: !!r.wolf,
            nassau: !!r.nassau,
            stakes: { skins: r.stake_skins ?? 0, wolf: r.stake_wolf ?? 0, nassau: r.stake_nassau ?? 0 },
          },
        }
      : null,
    setBy: r?.set_by ?? null,
    agreed: new Set((agreements.data ?? []).map((a) => a.member_id)),
    paid: new Map((payments.data ?? []).map((p) => [paidKey(p.from_player_id, p.to_player_id), p.amount_cents])),
    wolfPicks: new Map((picks.error ? [] : (picks.data ?? [])).map((p) => [p.hole, p.partner_player_id])),
  };
}

/** Save the round's side games (whoever started the round), or null to turn them off. */
export async function saveSideGames(roundId: number, config: SideGamesConfig | null): Promise<void> {
  const stakes = config?.mode === "money" ? config.stakes : NO_STAKES;
  const x = config?.extra ?? NO_EXTRA;
  const xs = config?.mode === "money" ? x.stakes : NO_EXTRA.stakes;
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
          // Only sent when one of them is on, so a database without 0201 still saves the rest.
          ...(x.skins || x.wolf || x.nassau
            ? { skins: x.skins, wolf: x.wolf, nassau: x.nassau, stake_skins: xs.skins, stake_wolf: xs.wolf, stake_nassau: xs.nassau }
            : {}),
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

/** Wolf (0201): the hole's Wolf takes a partner (their player id), or goes alone (null). */
export async function pickForWolf(roundId: number, hole: number, partner: number | null): Promise<void> {
  const { error } = await supabase.rpc("live_round_wolf_pick", { p_round_id: roundId, p_hole: hole, p_partner: partner });
  if (error) throw new Error(error.message);
}
