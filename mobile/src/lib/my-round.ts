import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { usePathname } from "expo-router";

import { supabase } from "@/lib/supabase";
import { onMyRoundSignal } from "@/lib/my-round-signal";
import { holeInPlay, isoDay, pickMyRound, type MyRound, type MyRoundCandidate } from "@/lib/my-round-rules";

/**
 * The live round you're playing in, for the MY ROUND pill in every header
 * (Oct 2026). One watcher (<MyRoundWatcher />, mounted once at the root)
 * loads it and publishes here; every pill only reads — the same split as
 * tab-badges.ts, so twenty headers don't mean twenty queries.
 *
 * Refreshed: when the app comes to the front, every minute while it's open,
 * when the member moves to another screen (at most every 20 seconds), and
 * straight away after a round is started, finished or deleted
 * (signalMyRound() in live-rounds.ts, heard here).
 */

let current: MyRound | null = null;
const listeners = new Set<() => void>();
let lastLoad = 0;
let loading: Promise<void> | null = null;
let userId: string | null = null;

function publish(next: MyRound | null) {
  if (next?.id === current?.id && next?.hole === current?.hole) return;
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The round the pill points at, or null (no pill). */
export function useMyRound(): MyRound | null {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

async function load(): Promise<MyRound | null> {
  if (!userId) return null;
  const since = new Date();
  since.setDate(since.getDate() - 1);
  const { data, error } = await supabase
    .from("live_round_players")
    .select("round_id, live_rounds!inner (id, status, played_on, holes, start_hole)")
    .eq("member_id", userId)
    .eq("live_rounds.status", "live")
    .gte("live_rounds.played_on", isoDay(since))
    .overrideTypes<
      { round_id: number; live_rounds: { id: number; status: "live" | "finished"; played_on: string; holes: number; start_hole: number | null } }[]
    >();
  if (error) throw error;

  const candidates: MyRoundCandidate[] = (data ?? []).map((r) => ({
    id: r.live_rounds.id,
    status: r.live_rounds.status,
    playedOn: r.live_rounds.played_on,
    holes: r.live_rounds.holes,
    startHole: r.live_rounds.start_hole,
  }));
  const round = pickMyRound(candidates, new Date());
  if (!round) return null;

  // Any score in the group moves the hole on — whoever is keeping the card.
  const { data: scores } = await supabase
    .from("live_round_scores")
    .select("hole")
    .eq("round_id", round.id)
    .not("strokes", "is", null)
    .overrideTypes<{ hole: number }[]>();
  return { id: round.id, hole: holeInPlay(round.holes, round.startHole, (scores ?? []).map((s) => s.hole)) };
}

/** Load now (or within `minGapMs` of the last load, skip). Never throws. */
export function refreshMyRound(minGapMs = 0): Promise<void> {
  if (loading) return loading;
  if (Date.now() - lastLoad < minGapMs) return Promise.resolve();
  lastLoad = Date.now();
  loading = load()
    .then(publish)
    // A failed check leaves the pill as it was rather than hiding it mid-round.
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Mounted once, in the root layout, while signed in. Draws nothing. */
export function MyRoundWatcher({ memberId }: { memberId: string | null }) {
  const pathname = usePathname();

  useEffect(() => {
    userId = memberId;
    if (!memberId) {
      publish(null);
      return;
    }
    void refreshMyRound();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refreshMyRound(30_000);
    }, 60_000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refreshMyRound(5_000);
    });
    const off = onMyRoundSignal((gap) => void refreshMyRound(gap));
    return () => {
      clearInterval(timer);
      sub.remove();
      off();
    };
  }, [memberId]);

  useEffect(() => {
    if (memberId) void refreshMyRound(20_000);
  }, [pathname, memberId]);

  return null;
}
