import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { highlightKind, highlightMessage, scorerLabel } from "./live-highlight-rules";
import { notifyFollowersOfHighlight } from "./follow-notifications";
import { notifyUser } from "./notifications-server";

/**
 * "Birdie for Eire!" — a great score, to everyone in the game (Oct 2026).
 *
 * The app asks a few seconds after a score goes in (so a mis-tap that's
 * corrected straight away never alerts anyone); this reads the score as it
 * stands NOW from the database, and only a birdie or better goes out.
 *
 * Who hears: every member in the round — or, for a match day or scramble,
 * every member in every match or team of that day — except whoever made the
 * score and whoever typed it in (both already know), and anyone who has
 * turned "Match notifications" off for this game (0119). The app only: its Inbox
 * and a push to phones — never email, never a browser.
 * One alert per score: the dedupe key carries the round, player, hole and
 * kind, so a retry never buzzes twice and an eagle corrected from a birdie
 * still gets its own.
 */

type RoundRow = {
  id: number;
  course_name: string;
  match_day_id: number | null;
  match_type: "singles" | "fourball" | "foursomes" | "greensomes" | null;
  scramble_size: number | null;
  team_name: string | null;
  team_number: number | null;
};
type PlayerRow = { id: number; round_id: number; member_id: string | null; display_name: string; position: number; side: number | null };

export async function notifyHighlight(
  admin: SupabaseClient,
  input: { roundId: number; playerId: number; hole: number; triggeredBy: string }
): Promise<{ sent: number; kind: string | null }> {
  const [{ data: round }, { data: score }, { data: holeRow }] = await Promise.all([
    admin
      .from("live_rounds")
      .select("id, course_name, match_day_id, match_type, scramble_size, team_name, team_number")
      .eq("id", input.roundId)
      .maybeSingle<RoundRow>(),
    admin
      .from("live_round_scores")
      .select("strokes")
      .eq("round_id", input.roundId)
      .eq("player_id", input.playerId)
      .eq("hole", input.hole)
      .maybeSingle<{ strokes: number | null }>(),
    admin.from("live_round_holes").select("par").eq("round_id", input.roundId).eq("hole", input.hole).maybeSingle<{ par: number }>(),
  ]);
  if (!round || !score || !holeRow) return { sent: 0, kind: null };

  const kind = highlightKind(score.strokes, holeRow.par);
  if (!kind) return { sent: 0, kind: null };

  // Everyone in the game: this round, or every round of its day.
  // A secret leaderboard (0174): only this round's players and the person
  // running the day hear about it — not the rest of the field.
  const roundIds = [round.id];
  let secretOrganiser: string | null = null;
  let secret = false;
  if (round.match_day_id != null) {
    const { data: day } = await admin
      .from("live_match_days")
      .select("created_by, leaderboard_hidden")
      .eq("id", round.match_day_id)
      .maybeSingle<{ created_by: string | null; leaderboard_hidden: boolean | null }>();
    secret = day?.leaderboard_hidden === true;
    secretOrganiser = day?.created_by ?? null;
  }
  if (round.match_day_id != null && !secret) {
    const { data: dayRounds } = await admin.from("live_rounds").select("id").eq("match_day_id", round.match_day_id);
    for (const r of (dayRounds ?? []) as { id: number }[]) if (!roundIds.includes(r.id)) roundIds.push(r.id);
  }
  const { data: players } = await admin
    .from("live_round_players")
    .select("id, round_id, member_id, display_name, position, side")
    .in("round_id", roundIds)
    .overrideTypes<PlayerRow[]>();

  const inRound = (players ?? []).filter((p) => p.round_id === round.id);
  const scorer = inRound.find((p) => p.id === input.playerId);
  if (!scorer) return { sent: 0, kind: null };

  const who = scorerLabel({
    scorer: { name: scorer.display_name, side: scorer.side },
    roundPlayers: inRound.map((p) => ({ name: p.display_name, side: p.side, position: p.position })),
    scramble: round.scramble_size != null ? { teamName: round.team_name, teamNumber: round.team_number } : null,
    oneBallPerSide: round.match_type === "foursomes" || round.match_type === "greensomes",
  });
  // A scramble team's or a pair's score belongs to all of them.
  const makers = new Set(
    (round.scramble_size != null
      ? inRound
      : round.match_type === "foursomes" || round.match_type === "greensomes"
        ? inRound.filter((p) => p.side === scorer.side)
        : [scorer]
    )
      .map((p) => p.member_id)
      .filter((m): m is string => !!m)
  );

  const msg = highlightMessage({ kind, who, hole: input.hole, par: holeRow.par, strokes: score.strokes!, course: round.course_name });
  const href = round.match_day_id != null ? `/live/days/${round.match_day_id}` : `/live/rounds/${round.id}`;

  // "Match notifications" switched off for this game (0119): skip them.
  const gameKey = round.match_day_id != null ? `day:${round.match_day_id}` : `round:${round.id}`;
  const { data: mutes } = await admin.from("live_highlight_mutes").select("member_id").eq("game_key", gameKey).eq("muted", true);
  const muted = new Set(((mutes ?? []) as { member_id: string }[]).map((m) => m.member_id));

  const everyone = (players ?? []).map((p) => p.member_id).filter((m): m is string => !!m);
  if (secret && secretOrganiser) everyone.push(secretOrganiser);
  const recipients = [...new Set(everyone)].filter(
    (m) => !makers.has(m) && m !== input.triggeredBy && !muted.has(m)
  );
  for (const userId of recipients) {
    await notifyUser(admin, {
      userId,
      type: "live_highlight",
      title: msg.title,
      body: msg.body,
      href,
      appOnly: true,
      dedupeKey: `live_highlight:${round.id}:${input.playerId}:${input.hole}:${kind}:${userId}`,
    });
  }
  // Follow my round (0158): PinPals following this ball's card. Anyone
  // already told above (or who made the score) isn't told twice.
  const ballIds = (
    round.scramble_size != null
      ? inRound
      : round.match_type === "foursomes" || round.match_type === "greensomes"
        ? inRound.filter((p) => p.side === scorer.side)
        : [scorer]
  ).map((p) => p.id);
  const teamName = round.scramble_size != null ? (round.team_name ?? `Team ${round.team_number ?? ""}`.trim()) : null;
  const firstOf = (id: number) => (inRound.find((p) => p.id === id)?.display_name ?? "").trim().split(/\s+/)[0] || "your player";
  const followers = await notifyFollowersOfHighlight(admin, {
    roundId: round.id,
    playerIds: ballIds,
    hole: input.hole,
    kind,
    par: holeRow.par,
    strokes: score.strokes!,
    course: round.course_name,
    // Only the player they follow — never their partner's name.
    whoFor: (playerId) => teamName ?? firstOf(playerId),
    // Muted game members stay muted, here too.
    skip: new Set([...recipients, ...makers, ...muted, input.triggeredBy]),
  });
  return { sent: recipients.length + followers, kind };
}
