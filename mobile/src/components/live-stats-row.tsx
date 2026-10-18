import { useEffect, useState } from "react";
import { Alert, Text } from "react-native";

import { StatsTapRow } from "@/components/stats-tap-row";
import type { HoleStat } from "@/lib/hole-stats";
import { loadStatsFor, saveHoleStat } from "@/lib/my-stats";
import { colors, fonts } from "@/lib/theme";

/**
 * My Game's taps under your score on the live scoring screen (0178), for
 * members who've turned on Track my stats. Private to you; saved as you
 * tap, and kept on the phone to send later when there's no signal.
 */
export function LiveStatsRow({ roundId, hole, par, strokes }: { roundId: number; hole: number; par: number; strokes: number | null }) {
  const [stats, setStats] = useState<Map<number, HoleStat> | null>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    let live = true;
    void loadStatsFor({ liveRoundId: roundId })
      .then((m) => live && setStats(m))
      .catch(() => live && setStats(new Map()));
    return () => {
      live = false;
    };
  }, [roundId]);

  if (!stats) return null;
  const value = stats.get(hole) ?? { hole, putts: null, tee: null, greenMiss: null, penalties: null };

  const change = (next: HoleStat) => {
    setStats((m) => new Map(m ?? []).set(hole, next));
    void saveHoleStat({ liveRoundId: roundId }, next)
      .then((how) => setWaiting(how === "queued"))
      .catch((e: unknown) => Alert.alert("Your stats didn't save", (e as { message?: string })?.message ?? "Please try again."));
  };

  return (
    <>
      <StatsTapRow par={par} strokes={strokes} value={value} onChange={change} />
      {waiting ? (
        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, marginTop: -4 }}>No signal — your stats are kept on the phone and sent when it's back.</Text>
      ) : null}
    </>
  );
}
