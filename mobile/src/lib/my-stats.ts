import { useEffect, useState } from "react";
import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";

import type { GreenMiss, HoleStat, TeeShot } from "@/lib/hole-stats";
import { isNetworkError } from "@/lib/score-queue-rules";
import { supabase } from "@/lib/supabase";

/**
 * My Game stats (0178): the member's own taps per hole, saved through
 * my_hole_stats_set() and read back under RLS (only ever their own rows).
 *
 * Turned on per phone with "Track my stats" (kept in SecureStore like the
 * other per-phone choices). Off: no stats row anywhere, nothing fetched.
 *
 * No signal: a save that fails for want of a connection is kept — the
 * latest per round or card and hole — on the phone, and sent again every
 * 30 seconds and when the app comes back to the front. A save the database
 * refuses (not your round) is dropped, the way score-queue.ts does it.
 */

// ---------------------------------------------------------------------------
// Track my stats — the opt-in
// ---------------------------------------------------------------------------

const TRACK_KEY = "pp_track_stats";
let tracking: boolean | null = null;
const trackListeners = new Set<(on: boolean) => void>();

export async function loadTracking(): Promise<boolean> {
  if (tracking != null) return tracking;
  const v = await SecureStore.getItemAsync(TRACK_KEY).catch(() => null);
  tracking = v === "1";
  return tracking;
}

export async function setTracking(on: boolean): Promise<void> {
  tracking = on;
  trackListeners.forEach((l) => l(on));
  await SecureStore.setItemAsync(TRACK_KEY, on ? "1" : "0").catch(() => undefined);
}

/** Is "Track my stats" on? Null while it's being read. */
export function useTracking(): [boolean | null, (on: boolean) => void] {
  const [on, setOn] = useState<boolean | null>(tracking);
  useEffect(() => {
    let live = true;
    void loadTracking().then((v) => live && setOn(v));
    const l = (v: boolean) => setOn(v);
    trackListeners.add(l);
    return () => {
      live = false;
      trackListeners.delete(l);
    };
  }, []);
  return [on, (v: boolean) => void setTracking(v)];
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

type Row = {
  live_round_id: number | null;
  scorecard_id: number | null;
  hole: number;
  putts: number | null;
  tee: TeeShot | null;
  green_miss: GreenMiss | null;
  penalties: number | null;
};

const toStat = (r: Row): HoleStat => ({ hole: r.hole, putts: r.putts, tee: r.tee, greenMiss: r.green_miss, penalties: r.penalties });

/** Where a set of stats hangs: a live round, or a saved card. */
export type StatsTarget = { liveRoundId: number } | { scorecardId: number };

const targetKey = (t: StatsTarget) => ("liveRoundId" in t ? `r${t.liveRoundId}` : `c${t.scorecardId}`);

/** My stats on one round or card, by hole (pending saves from this phone included). */
export async function loadStatsFor(target: StatsTarget): Promise<Map<number, HoleStat>> {
  const q = supabase.from("member_hole_stats").select("live_round_id, scorecard_id, hole, putts, tee, green_miss, penalties");
  const { data, error } = await ("liveRoundId" in target ? q.eq("live_round_id", target.liveRoundId) : q.eq("scorecard_id", target.scorecardId));
  if (error) throw error;
  const out = new Map<number, HoleStat>(((data ?? []) as Row[]).map((r) => [r.hole, toStat(r)]));
  for (const p of await pendingStats()) if (targetKey(p.target) === targetKey(target)) out.set(p.stat.hole, p.stat);
  return out;
}

/**
 * Every stat I've kept, for My Game: by live round and by card. A card from
 * a live round finds its taps under the round (scorecards.live_round_id);
 * taps added later in the review are on the card and win, hole by hole.
 */
export async function loadAllMyStats(): Promise<{ byRound: Map<number, Map<number, HoleStat>>; byCard: Map<number, Map<number, HoleStat>> }> {
  const { data, error } = await supabase
    .from("member_hole_stats")
    .select("live_round_id, scorecard_id, hole, putts, tee, green_miss, penalties")
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  const byRound = new Map<number, Map<number, HoleStat>>();
  const byCard = new Map<number, Map<number, HoleStat>>();
  for (const r of (data ?? []) as Row[]) {
    const [map, id] = r.live_round_id != null ? [byRound, r.live_round_id] : [byCard, r.scorecard_id as number];
    if (!map.has(id)) map.set(id, new Map());
    map.get(id)!.set(r.hole, toStat(r));
  }
  return { byRound, byCard };
}

/** One card's stats, hole by hole: the review's taps over the round's. */
export function statsForCard(
  card: { id: number; liveRoundId: number | null },
  all: { byRound: Map<number, Map<number, HoleStat>>; byCard: Map<number, Map<number, HoleStat>> }
): Map<number, HoleStat> {
  const out = new Map(card.liveRoundId != null ? (all.byRound.get(card.liveRoundId) ?? []) : []);
  for (const [hole, s] of all.byCard.get(card.id) ?? []) out.set(hole, s);
  return out;
}

// ---------------------------------------------------------------------------
// Saving, with a queue for no signal
// ---------------------------------------------------------------------------

type Pending = { target: StatsTarget; stat: HoleStat; at: number };

const QUEUE_KEY = "pinpals.pendingStats.v1";
const RETRY_MS = 30_000;
let queue: Pending[] | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

const pendingKey = (p: Pending) => `${targetKey(p.target)}:${p.stat.hole}`;

async function pendingStats(): Promise<Pending[]> {
  if (queue) return queue;
  try {
    const raw = await SecureStore.getItemAsync(QUEUE_KEY);
    queue = raw ? (JSON.parse(raw) as Pending[]) : [];
  } catch {
    queue = [];
  }
  if (queue.length) startRetry();
  return queue;
}

async function persist(): Promise<void> {
  try {
    if (!queue || queue.length === 0) await SecureStore.deleteItemAsync(QUEUE_KEY);
    else await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(queue.slice(-60)));
  } catch {
    // The copy in memory still sends while the app is open.
  }
}

async function send(target: StatsTarget, s: HoleStat): Promise<void> {
  const { error } = await supabase.rpc("my_hole_stats_set", {
    p_live_round_id: "liveRoundId" in target ? target.liveRoundId : null,
    p_scorecard_id: "scorecardId" in target ? target.scorecardId : null,
    p_hole: s.hole,
    p_putts: s.putts,
    p_tee: s.tee,
    p_green_miss: s.greenMiss,
    p_penalties: s.penalties,
  });
  if (error) throw error;
}

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const q = await pendingStats();
    for (const p of [...q].sort((a, b) => a.at - b.at)) {
      try {
        await send(p.target, p.stat);
      } catch (e) {
        if (isNetworkError(e)) break; // still no signal: try again later
      }
      queue = (queue ?? []).filter((x) => pendingKey(x) !== pendingKey(p) || x.at !== p.at);
    }
    await persist();
    if (!queue || queue.length === 0) stopRetry();
  } finally {
    flushing = false;
  }
}

let appStateHooked = false;
function startRetry(): void {
  if (!timer) timer = setInterval(() => void flush(), RETRY_MS);
  if (!appStateHooked) {
    appStateHooked = true;
    AppState.addEventListener("change", (s) => {
      if (s === "active") void flush();
    });
  }
}

function stopRetry(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Save one hole's stats. Resolves "saved", "queued" (no signal — kept and
 * sent later) or throws if the database refused it.
 */
export async function saveHoleStat(target: StatsTarget, stat: HoleStat): Promise<"saved" | "queued"> {
  const q = await pendingStats();
  // A newer tap replaces anything still waiting for the same hole.
  queue = q.filter((p) => pendingKey(p) !== `${targetKey(target)}:${stat.hole}`);
  try {
    await send(target, stat);
    await persist();
    return "saved";
  } catch (e) {
    if (!isNetworkError(e)) {
      await persist();
      throw e;
    }
    queue.push({ target, stat, at: Date.now() });
    await persist();
    startRetry();
    return "queued";
  }
}
