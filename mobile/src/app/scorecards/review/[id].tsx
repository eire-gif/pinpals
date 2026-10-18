import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { StatsTapRow } from "@/components/stats-tap-row";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isEmptyStat, type HoleStat } from "@/lib/hole-stats";
import { loadStatsFor, saveHoleStat } from "@/lib/my-stats";
import { loadScorecard, type Scorecard } from "@/lib/scorecards";
import { colors, creamAlpha, fonts, radii, spacing } from "@/lib/theme";

/**
 * The 60-second review (My Game, 0178): your stats for a saved card, one
 * hole at a time — for the holes you didn't tap while playing, or a card
 * entered by hand. Opens on the first hole with nothing tapped.
 *
 * Taps made during the live round are shown (they're found under the
 * round); a change here is saved on the card and wins over them in My Game.
 */
export default function StatsReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cardId = Number(id);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [card, setCard] = useState<Scorecard | null | undefined>(undefined);
  const [stats, setStats] = useState<Map<number, HoleStat>>(new Map());
  const [at, setAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setFailed(false);
      const c = await loadScorecard(cardId);
      if (!c || c.memberId !== me) {
        setCard(null);
        return;
      }
      const [fromRound, fromCard] = await Promise.all([
        c.liveRoundId != null ? loadStatsFor({ liveRoundId: c.liveRoundId }).catch(() => new Map<number, HoleStat>()) : Promise.resolve(new Map<number, HoleStat>()),
        loadStatsFor({ scorecardId: c.id }),
      ]);
      const merged = new Map(fromRound);
      for (const [h, s] of fromCard) merged.set(h, s);
      setStats(merged);
      setCard(c);
      const played = c.holeList.filter((h) => h.strokes != null);
      setAt((cur) => cur ?? (played.find((h) => isEmptyStat(merged.get(h.hole))) ?? played[0])?.hole ?? null);
    } catch {
      setFailed(true);
    }
  }, [cardId, me]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const header = <Stack.Screen options={{ title: "Your stats", headerBackTitle: "Back" }} />;
  if (failed) return <LoadError size="screen" what="this card" onRetry={() => void load()} />;
  if (card === undefined) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;
  if (card === null || card.teamCard != null) {
    return (
      <>
        {header}
        <StateMessage size="screen" icon="stats-chart-outline" title="Stats go on your own card" body="A pair's or team's card is one ball, so it isn't used for your stats." />
      </>
    );
  }

  const holes = card.holeList.filter((h) => h.strokes != null);
  if (holes.length === 0 || at == null) {
    return (
      <>
        {header}
        <StateMessage size="screen" icon="stats-chart-outline" title="No scores on this card yet" body="Add your scores first; then your stats." />
      </>
    );
  }

  const i = Math.max(0, holes.findIndex((h) => h.hole === at));
  const h = holes[i];
  const value = stats.get(h.hole) ?? { hole: h.hole, putts: null, tee: null, greenMiss: null, penalties: null };
  const done = holes.filter((x) => !isEmptyStat(stats.get(x.hole))).length;
  const last = i === holes.length - 1;

  const change = (next: HoleStat) => {
    setStats((m) => new Map(m).set(h.hole, next));
    void saveHoleStat({ scorecardId: card.id }, next).catch((e: unknown) =>
      Alert.alert("Your stats didn't save", (e as { message?: string })?.message ?? "Please try again.")
    );
  };

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView contentContainerStyle={styles.page}>
        <View style={{ gap: 4 }}>
          <Text style={styles.kicker}>{card.courseName.toUpperCase()}</Text>
          <Text style={styles.title}>Your 60-second stats</Text>
          <Text style={styles.sub}>
            {done} of {holes.length} holes done · only you see these
          </Text>
        </View>

        <View style={styles.progress} accessibilityLabel={`Hole ${i + 1} of ${holes.length}`}>
          {holes.map((x) => (
            <Pressable
              key={x.hole}
              onPress={() => setAt(x.hole)}
              style={[styles.tick, !isEmptyStat(stats.get(x.hole)) && styles.tickDone, x.hole === h.hole && styles.tickNow]}
              accessibilityRole="button"
              accessibilityLabel={`Hole ${x.hole}`}
              hitSlop={{ top: 12, bottom: 12 }}
            />
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.holeHead}>
            <Text style={styles.holeNo}>Hole {h.hole}</Text>
            <Text style={styles.holeMeta}>
              Par {h.par}
              {h.strokeIndex != null ? ` · SI ${h.strokeIndex}` : ""}
            </Text>
          </View>
          <Text style={styles.scored}>You scored {h.strokes}</Text>
          <StatsTapRow par={h.par} strokes={h.strokes} value={value} onChange={change} title="HOLE STATS" note="Tap again to clear" />
        </View>

        <View style={styles.nav}>
          <Pressable
            onPress={() => i > 0 && setAt(holes[i - 1].hole)}
            disabled={i === 0}
            style={({ pressed }) => [styles.back, i === 0 && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
          >
            <Text style={styles.backLabel}>Back</Text>
          </Pressable>
          <Pressable
            onPress={() => (last ? router.back() : setAt(holes[i + 1].hole))}
            style={({ pressed }) => [styles.next, pressed && { opacity: 0.88 }]}
            accessibilityRole="button"
          >
            <Text style={styles.nextLabel}>{last ? "Done" : `Next · hole ${holes[i + 1].hole}`}</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => router.replace("/my-game")} style={styles.link} accessibilityRole="button">
          <Text style={styles.linkText}>See My Game</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy900 },
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.4, color: colors.gold400 },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 33, color: colors.cream50 },
  sub: { fontFamily: fonts.body, fontSize: 14, color: creamAlpha(0.78) },
  progress: { flexDirection: "row", gap: 4 },
  tick: { flex: 1, height: 6, borderRadius: 3, backgroundColor: creamAlpha(0.22) },
  tickDone: { backgroundColor: colors.gold400 },
  tickNow: { backgroundColor: colors.cream50 },
  card: { gap: spacing.sm + 4, padding: spacing.md, borderRadius: radii.lg + 4, backgroundColor: colors.cream50 },
  holeHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  holeNo: { fontFamily: fonts.display, fontSize: 30, color: colors.ink900 },
  holeMeta: { fontFamily: fonts.body, fontSize: 14.5, color: colors.ink500 },
  scored: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink900 },
  nav: { flexDirection: "row", gap: spacing.sm + 2 },
  back: { flex: 1, minHeight: 52, borderRadius: radii.md + 2, borderWidth: 1.5, borderColor: creamAlpha(0.4), alignItems: "center", justifyContent: "center" },
  backLabel: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.cream50 },
  next: { flex: 2, minHeight: 52, borderRadius: radii.md + 2, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  nextLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900 },
  link: { alignSelf: "center", padding: spacing.sm },
  linkText: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: creamAlpha(0.85) },
});
