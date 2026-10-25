"use server";

import { after } from "next/server";

import { notifyMatchDayPlayers } from "@/lib/live-match-notifications";
import { parseTeamHandicap, teamHandicapLabel } from "@/lib/live-scoring";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ActionState } from "@/lib/society-console/action-state";
import type { ConsoleContext } from "@/lib/society-console/access";
import { loadEvent } from "@/lib/society-console/data";
import { isDayFormat, parseCard, planDay, type PairScoring, type StartMode } from "@/lib/society-console/live-day";
import { loadDrawnGroups, notDrawn } from "@/lib/society-console/live-day-data";
import { isOutingDay, outingPast } from "@/lib/society-console/outing-rules";
import { parseClock, positiveInt, text } from "@/lib/society-console/rules";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { createAdminClient } from "@/lib/supabase/admin";
import { linkTvCode } from "@/lib/tv-pairing";
import { normaliseTvCode } from "@/lib/tv-token";

/**
 * The Live day's actions (Oct 2026). Each runs through consoleAction (signed
 * in, on the committee, the events area — checked on every call) and then
 * the SAME database functions the app calls, with the member's own client:
 *
 *   startRound   live_fourball_day_create / live_scramble_day_create (0121,
 *                0136, 0173), then set_day_leaderboard_hidden (0174) and
 *                link_outing_match_day (0125) — as the app's "Start the day"
 *   setHidden    set_day_leaderboard_hidden — the event's officers (0174)
 *   connectTv    pairs a clubhouse TV's code to the day, as /api/app/live/tv
 *   fixScores    live_round_set_score — whoever started the day (0104)
 *   setTeamHandicap  live_round_set_team_handicap — the day's organisers (0189)
 *
 * Nothing a browser sends becomes a player, a handicap or a group: the
 * draw and handicaps are read again here and the day is planned in
 * live-day.ts from them.
 */

/** The event, checked to be this society's, and the live day it became. */
async function eventOf(ctx: ConsoleContext, raw: FormDataEntryValue | null) {
  const outing = positiveInt(raw);
  if (!outing) throw new Error("That event wasn't found.");
  let page: Awaited<ReturnType<typeof loadEvent>>;
  try {
    page = await loadEvent(ctx.supabase, ctx.society.id, outing);
  } catch {
    throw new Error("Couldn't load the event. Please try again.");
  }
  if (!page) throw new Error("That event wasn't found.");
  return page;
}

async function dayOf(ctx: ConsoleContext, raw: FormDataEntryValue | null): Promise<number> {
  const page = await eventOf(ctx, raw);
  if (!page.outing.matchDayId) throw new Error("The round hasn't started yet.");
  return page.outing.matchDayId;
}

const num = (form: FormData, name: string): number | null | undefined => {
  const v = text(form, name, 12);
  if (v == null) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};

export async function startRound(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events", alerts: false }, async (ctx) => {
    const page = await eventOf(ctx, form.get("outing"));
    const o = page.outing;
    if (o.kind !== "day") throw new Error("A trip's rounds are started from its itinerary, in the app.");
    if (o.status === "cancelled") throw new Error("This event was cancelled.");
    if (o.matchDayId) throw new Error("The round has already started.");
    if (!isOutingDay(o.playsOn)) throw new Error("The round can be started on the day of the event.");
    if (!o.drawPublishedAt) throw new Error("Publish the draw first — the round is played in its tee groups.");

    const format = form.get("format");
    if (!isDayFormat(format)) throw new Error("Choose the format.");
    const pairScoring: PairScoring = form.get("pairScoring") === "stroke" ? "stroke" : "stableford";
    const start: StartMode = form.get("start") === "shotgun" ? "shotgun" : "tees";
    const shotgunTime = start === "shotgun" ? parseClock(text(form, "shotgunTime", 5)) : null;
    if (shotgunTime === undefined || (start === "shotgun" && !shotgunTime)) throw new Error("Give the shotgun's start time, like 09:00.");

    const card = parseCard(form.get("card"));
    if (!card) throw new Error("The card doesn't look right — check every hole has a par.");
    const rating = num(form, "rating");
    const slope = num(form, "slope");
    if (rating === undefined || (rating != null && (rating < 25 || rating > 90))) throw new Error("The course rating doesn't look right (e.g. 72.4).");
    if (slope === undefined || (slope != null && (!Number.isInteger(slope) || slope < 55 || slope > 155))) throw new Error("The slope is a whole number from 55 to 155.");
    const teeName = text(form, "teeName", 40) ?? "Standard";

    let draw: Awaited<ReturnType<typeof loadDrawnGroups>>;
    try {
      draw = await loadDrawnGroups(ctx.supabase, ctx.society.id, page);
    } catch {
      throw new Error("Couldn't load the draw and handicaps. Please try again.");
    }
    const plan = planDay(
      {
        title: o.title,
        courseName: o.courseName ?? "Golf course",
        clubId: o.clubId,
        tee: { teeName, courseRating: rating, slope, par: card.reduce((n, h) => n + h.par, 0), card },
        format,
        pairScoring,
        start,
        shotgunTime,
        notDrawn: notDrawn(page),
      },
      draw
    );
    if (plan.problems.length || !plan.rpc) throw new Error(plan.problems[0] ?? "The round can't start yet.");

    const { data: dayId, error } = await ctx.supabase.rpc(plan.rpc.fn, plan.rpc.args);
    check(error, "Couldn't start the round. Please try again.");
    const id = Number(dayId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Couldn't start the round. Please try again.");

    // As the app: the day is started; these follow and never undo it.
    // Hidden first, before anyone opens the board (as the app), then linked.
    const problems: string[] = [];
    if (form.get("hidden") === "on") {
      const hide = await ctx.supabase.rpc("set_day_leaderboard_hidden", { p_day_id: id, p_hidden: true });
      if (hide.error) problems.push("the leaderboard isn't hidden yet — use Keep it secret in the control room");
    }
    const link = await ctx.supabase.rpc("link_outing_match_day", { p_outing_id: o.id, p_match_day_id: id });
    if (link.error) problems.push("the event couldn't be linked to the round — open the round from the app's Live scoring");
    if (plan.starts && draw.length === plan.starts.length) {
      // Members see their starting hole on the event, as the app publishes it.
      const groups = draw.map((g, i) => ({
        tee_time: shotgunTime ?? g.teeTime,
        ...(plan.starts![i] ? { start_hole: plan.starts![i]!.hole, start_letter: plan.starts![i]!.letter } : {}),
        members: g.players.map((p) => (p.memberId ? p.memberId : { guest: Number(p.key.slice(2)) })),
      }));
      const redraw = await ctx.supabase.rpc("publish_outing_draw", { p_outing_id: o.id, p_groups: groups });
      if (redraw.error) problems.push("the starting holes didn't go on the event — the groups have them in the round");
    }

    after(async () => {
      try {
        await notifyMatchDayPlayers(createAdminClient(), id);
      } catch (err) {
        console.error("[society-live] notify failed", err);
      }
    });

    return problems.length
      ? `The round has started, but ${problems.join("; ")}.`
      : "The round has started. Every player has been told their group, and their scorecard is open in the app.";
  });
}

/**
 * Saves the set-up on the event (0184) so it's ready on the day — any
 * officer, any device. Only the choices are kept; starting checks them all
 * again. A half-typed card is fine to save.
 */
export async function saveSetup(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events", alerts: false }, async (ctx) => {
    const page = await eventOf(ctx, form.get("outing"));
    const o = page.outing;
    if (o.kind !== "day") throw new Error("A trip's rounds are set up on its itinerary.");
    if (o.status === "cancelled") throw new Error("This event was cancelled.");
    if (o.matchDayId) throw new Error("The round has already started.");
    if (outingPast(o.playsOn)) throw new Error("This event has been played.");
    const format = form.get("format");
    const cardId = positiveInt(form.get("cardId"));
    const setup = {
      v: 1,
      cardId,
      teeName: text(form, "teeName", 40) ?? "",
      rating: text(form, "rating", 8) ?? "",
      slope: text(form, "slope", 4) ?? "",
      card: parseCard(form.get("card")),
      format: isDayFormat(format) ? format : "stableford",
      pairScoring: form.get("pairScoring") === "stroke" ? "stroke" : "stableford",
      start: form.get("start") === "shotgun" ? "shotgun" : "tees",
      shotgunTime: parseClock(text(form, "shotgunTime", 5)) ?? null,
      hidden: form.get("hidden") === "on",
    };
    const { error } = await ctx.supabase.rpc("save_outing_live_setup", { p_outing_id: o.id, p_setup: setup });
    check(error, "Couldn't save the set-up.");
    return isOutingDay(o.playsOn) ? "Set-up saved." : "Set-up saved. On the day, open this Live day and press Start the round — everything will be as you left it.";
  });
}

export async function setHidden(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events", alerts: false }, async (ctx) => {
    const day = await dayOf(ctx, form.get("outing"));
    const hidden = form.get("hidden") === "1";
    const { error } = await ctx.supabase.rpc("set_day_leaderboard_hidden", { p_day_id: day, p_hidden: hidden });
    check(error, "Couldn't change the leaderboard.");
    return hidden ? "The leaderboard is secret: players see only their own group until you publish the results." : "Everyone in the day can see the leaderboard.";
  });
}

export async function connectTv(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events", alerts: false }, async (ctx) => {
    const day = await dayOf(ctx, form.get("outing"));
    const code = normaliseTvCode(form.get("code"));
    if (!code) throw new Error("TV codes are six letters and numbers, like K7Q4MP.");
    // Only the people who run the day put it on a screen (the TV shows the whole field).
    const { data: organiser } = await ctx.supabase.rpc("live_day_is_organiser", { p_day_id: day });
    if (organiser !== true) throw new Error("Only the people running the day can put it on a TV.");
    const limit = await checkRateLimit({ action: "tv_link_code", identifier: ctx.user.id, maxHits: 20, windowSeconds: 600 });
    if (!limit.allowed) throw new Error("Too many tries. Wait a few minutes.");
    let paired = false;
    try {
      paired = await linkTvCode(createAdminClient(), code, { kind: "day", id: day }, ctx.user.id);
    } catch (err) {
      console.error("[society-live] tv link failed", err);
      throw new Error("Couldn't connect the TV. Try again.");
    }
    if (!paired) throw new Error("That code isn't showing on a TV any more. Check the code on the screen and try again.");
    return "The TV is connected — the leaderboard will appear on it in a few seconds.";
  });
}

type Fix = { player: number; hole: number; strokes: number | null; clear: boolean };

function parseFixes(raw: FormDataEntryValue | null): Fix[] | null {
  if (typeof raw !== "string") return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(v) || v.length > 200) return null;
  const out: Fix[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") return null;
    const { player, hole, strokes, clear } = x as Record<string, unknown>;
    if (!Number.isInteger(player) || (player as number) <= 0 || !Number.isInteger(hole) || (hole as number) < 1 || (hole as number) > 18) return null;
    if (clear === true) {
      out.push({ player: player as number, hole: hole as number, strokes: null, clear: true });
      continue;
    }
    if (strokes !== null && (!Number.isInteger(strokes) || (strokes as number) < 1 || (strokes as number) > 20)) return null;
    out.push({ player: player as number, hole: hole as number, strokes: strokes as number | null, clear: false });
  }
  return out;
}

export async function fixScores(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events", alerts: false }, async (ctx) => {
    const day = await dayOf(ctx, form.get("outing"));
    const round = positiveInt(form.get("round"));
    if (!round) throw new Error("That card wasn't found.");
    const { data: r } = await ctx.supabase.from("live_rounds").select("id, match_day_id").eq("id", round).maybeSingle<{ id: number; match_day_id: number | null }>();
    if (!r || r.match_day_id !== day) throw new Error("That card isn't in this round.");
    const fixes = parseFixes(form.get("fixes"));
    if (!fixes) throw new Error("Those scores don't look right.");
    if (fixes.length === 0) return "Nothing to change.";
    let saved = 0;
    for (const f of fixes) {
      const { error } = await ctx.supabase.rpc("live_round_set_score", { p_round_id: round, p_player_id: f.player, p_hole: f.hole, p_strokes: f.strokes, p_clear: f.clear });
      if (error) {
        const why = error.code === "P0001" || error.code === "42501" ? error.message : "it couldn't be saved";
        throw new Error(saved ? `Saved ${saved} of ${fixes.length}; hole ${f.hole} failed: ${why}.` : `Hole ${f.hole}: ${why}.`);
      }
      saved += 1;
    }
    return `${saved} ${saved === 1 ? "score" : "scores"} saved. The players see the change on their phones.`;
  });
}

/**
 * A team's (or pair's) handicap set by hand for this game (0189), or put
 * back to the worked-out figure ("reset"). The database checks the caller
 * runs the day and keeps the worked-out figure beside it; once scores are
 * in, the team's players are told.
 */
export async function setTeamHandicap(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events", alerts: false }, async (ctx) => {
    const day = await dayOf(ctx, form.get("outing"));
    const round = positiveInt(form.get("round"));
    if (!round) throw new Error("That card wasn't found.");
    const { data: r } = await ctx.supabase
      .from("live_rounds")
      .select("id, match_day_id, team_handicap, team_handicap_auto")
      .eq("id", round)
      .maybeSingle<{ id: number; match_day_id: number | null; team_handicap: number | null; team_handicap_auto: number | null }>();
    if (!r || r.match_day_id !== day) throw new Error("That card isn't in this round.");
    if (r.team_handicap == null) throw new Error("Only a team or pair has a team handicap.");
    const auto = r.team_handicap_auto ?? r.team_handicap;
    const wanted = form.get("reset") ? auto : parseTeamHandicap(text(form, "handicap", 4) ?? "");
    if (wanted == null) throw new Error("A team handicap is a whole number, 0 to 54, or + for a plus team (+2).");
    if (wanted === r.team_handicap) return "No change.";
    const { error } = await ctx.supabase.rpc("live_round_set_team_handicap", { p_round_id: round, p_handicap: wanted });
    if (error) throw new Error(error.code === "42501" || error.code === "22023" ? error.message : "It couldn't be saved. Please try again.");
    return wanted === auto
      ? `Back to the worked-out ${teamHandicapLabel(auto)}.`
      : `Plays off ${teamHandicapLabel(wanted)} — set by hand (worked out ${teamHandicapLabel(auto)}). The players see it on their phones.`;
  });
}
