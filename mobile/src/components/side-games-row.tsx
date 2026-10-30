import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import type { CardHole, ScoreSheet } from "@/lib/live-scoring";
import type { LiveRoundPlayer } from "@/lib/live-rounds";
import { euros, type SideGamesConfig } from "@/lib/side-games";
import { sideSummary } from "@/lib/side-games-extra";
import { loadSideGames } from "@/lib/side-games-data";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * "Side games" on the scoring screen (0196, claude/side-games.md): set them
 * up (whoever started the round), or see where they stand and settle up.
 * Re-reads whenever the round's scores change (`scores` is the round's own
 * live sheet, so this follows the board without a second subscription).
 */
export function SideGamesRow({
  roundId,
  live,
  canSetUp,
  me,
  card,
  players,
  scores,
}: {
  roundId: number;
  live: boolean;
  canSetUp: boolean;
  me: string | null;
  card: readonly CardHole[];
  players: readonly LiveRoundPlayer[];
  scores: ScoreSheet;
}) {
  const [config, setConfig] = useState<SideGamesConfig | null | undefined>(undefined);
  const [picks, setPicks] = useState<Map<number, number | null>>(new Map());
  const [agreed, setAgreed] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    loadSideGames(roundId)
      .then((s) => {
        setConfig(s.config);
        setPicks(s.wolfPicks);
        setAgreed(s.agreed);
      })
      .catch(() => setConfig(null));
  }, [roundId]);

  useFocusEffect(load);
  // Scores moved (or someone changed the games): re-read the set-up too.
  useEffect(load, [load, scores]);

  if (config === undefined) return null;
  if (!config && !(live && canSetUp)) return null;

  const ordered = [...players].sort((a, b) => a.position - b.position);
  let sub = "Skins, Wolf, Nassau, Sixes and more, alongside the main game";
  if (config) {
    const summary = sideSummary(config, card, ordered, scores, picks, live);
    const games = summary.games;
    const mine = ordered.find((p) => p.memberId === me);
    const waiting = config.mode === "money" && me != null && mine != null && !agreed.has(me);
    if (waiting) {
      sub = "Tap to say you're in for the money games";
    } else if (config.mode === "money" && mine) {
      const cents = summary.money.get(mine.id) ?? 0;
      sub = cents === 0 ? (live ? "All square so far" : "You finished level") : `${euros(cents, true)}${live ? " if it ended now" : " · tap to settle up"}`;
    } else {
      const leading = games.filter((g) => mine && g.winners.includes(mine.id)).length;
      const count = games.length + (summary.skins ? 1 : 0) + (summary.wolf ? 1 : 0) + (summary.nassau ? 1 : 0);
      sub = leading > 0 ? `You ${live ? "lead" : "won"} ${leading} of ${games.length}` : `${count} game${count === 1 ? "" : "s"} running`;
    }
  }

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/live/side/[id]", params: { id: String(roundId) } })}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}
      accessibilityRole="button"
      accessibilityLabel={`Side games. ${sub}`}
    >
      <View style={styles.icon}>
        <Ionicons name="trophy" size={19} color={colors.gold400} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{config ? "Side games" : "Add side games"}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.gold400} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.green800,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(232,196,107,0.16)", alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  sub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: "#cfe0d4" },
});
