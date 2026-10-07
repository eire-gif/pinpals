import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { loadMyMatchDays, type MatchDaySummary } from "@/lib/live-match-days";
import { loadMyLiveRounds, type LiveRoundSummary } from "@/lib/live-rounds";
import { formatInfo } from "@/lib/live-scoring";
import { dateLabel } from "@/lib/tee-times";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Live scoring hub: start a round, or go back to one in play.
 *
 * Rounds in play come first and look different — a round you're halfway
 * through is the only thing on this screen anyone is in a hurry to reach.
 */
export default function LiveScoringHub() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [rounds, setRounds] = useState<LiveRoundSummary[] | null>(null);
  const [days, setDays] = useState<MatchDaySummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !isOn("liveScoring")) return;
    try {
      setFailed(false);
      const [r, d] = await Promise.all([loadMyLiveRounds(userId), loadMyMatchDays()]);
      setRounds(r);
      setDays(d);
    } catch {
      setFailed(true);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!isOn("liveScoring")) {
    return (
      <StateMessage
        size="screen"
        icon="podium-outline"
        title="Live scoring is on its way"
        body="Score your round with your group and watch the leaderboard move hole by hole."
      />
    );
  }

  const live = (rounds ?? []).filter((r) => r.status === "live");
  const finished = (rounds ?? []).filter((r) => r.status === "finished");

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.green700}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={styles.hero}>
        <View style={styles.eyebrowRow}>
          <View style={styles.rule} />
          <Text style={styles.eyebrow}>Live scoring</Text>
        </View>
        <Text style={styles.heroTitle}>Score it together.</Text>
        <Text style={styles.heroBody}>
          Enter your handicap once. PinPals works out your shots on every hole, and the whole group sees the
          leaderboard move as scores go in.
        </Text>
        <Pressable
          onPress={() => router.push("/live/new")}
          style={({ pressed }) => [styles.start, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Ionicons name="flag" size={18} color={colors.cream50} />
          <Text style={styles.startLabel}>Start a round</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push("/live/day/new")}
          style={({ pressed }) => [styles.startDay, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityHint="Several matches at once, in teams if you like"
        >
          <Ionicons name="people" size={18} color={colors.navy900} />
          <Text style={styles.startDayLabel}>Start a match day</Text>
        </Pressable>
        <Text style={styles.heroHint}>A match day is several matches at once: singles, fourball, foursomes or greensomes, with a team score.</Text>
      </View>

      {failed ? (
        <LoadError what="your rounds" onRetry={() => void load()} />
      ) : rounds == null ? (
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.lg }} />
      ) : rounds.length === 0 && (days ?? []).length === 0 ? (
        <StateMessage
          icon="golf-outline"
          body="Rounds you score, or are added to by your PinPals, will show here."
        />
      ) : (
        <>
          {(days ?? []).length > 0 ? <DayList days={days!} /> : null}
          {live.length > 0 ? <RoundList title="In play" rounds={live} /> : null}
          {finished.length > 0 ? <RoundList title="Finished" rounds={finished} /> : null}
        </>
      )}
    </ScrollView>
  );
}

function DayList({ days }: { days: MatchDaySummary[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Match days</Text>
      <View style={styles.list}>
        {days.map((d, i) => (
          <Pressable
            key={d.id}
            onPress={() => router.push({ pathname: "/live/day/[id]", params: { id: String(d.id) } })}
            style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`${d.title}, ${d.courseName}, ${d.live ? "in play" : "finished"}`}
          >
            <View style={[styles.dot, d.live ? styles.dotLive : styles.dotDone]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {d.title}
              </Text>
              <Text style={styles.rowMeta}>
                {d.courseName} · {dateLabel(d.playedOn)} · {d.matchCount} {d.matchCount === 1 ? "match" : "matches"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function RoundList({ title, rounds }: { title: string; rounds: LiveRoundSummary[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.list}>
        {rounds.map((r, i) => (
          <Pressable
            key={r.id}
            onPress={() => router.push({ pathname: "/live/round/[id]", params: { id: String(r.id) } })}
            style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`${r.courseName}, ${formatInfo(r.format).label}, ${r.status === "live" ? "in play" : "finished"}`}
          >
            <View style={[styles.dot, r.status === "live" ? styles.dotLive : styles.dotDone]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {r.courseName}
              </Text>
              <Text style={styles.rowMeta}>
                {formatInfo(r.format).label} · {dateLabel(r.playedOn)} · {r.playerCount}{" "}
                {r.playerCount === 1 ? "player" : "players"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  hero: {
    backgroundColor: colors.navy900,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rule: { width: 18, height: 2, backgroundColor: colors.gold400 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.6, textTransform: "uppercase", color: colors.gold400 },
  heroTitle: { fontFamily: fonts.display, fontSize: 28, color: colors.cream50 },
  heroBody: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 21, color: colors.cream100 },
  start: {
    marginTop: spacing.sm,
    minHeight: 50,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  startLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  startDay: {
    minHeight: 50,
    borderRadius: radii.pill,
    backgroundColor: colors.gold400,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  startDayLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
  heroHint: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.cream100, textAlign: "center" },
  pressed: { opacity: 0.85 },
  section: { gap: spacing.sm },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: colors.ink500 },
  list: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, minHeight: 64 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  rowPressed: { backgroundColor: colors.surfaceTint },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotLive: { backgroundColor: colors.green600 },
  dotDone: { backgroundColor: colors.line },
  rowTitle: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  rowMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 2 },
});
