import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { Avatar } from "@/components/avatar";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { indexLabel } from "@/lib/live-scoring";
import { outingDateLabel } from "@/lib/outing-rules";
import { loadRivalData, type RivalProfile } from "@/lib/rivalries";
import { bestWins, recordLine, rivalries, streak, type RivalRound } from "@/lib/rivalry-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Rivalries: you against one player — this season or all time, your best
 * win and theirs, the current run, and every round against each other.
 */
export default function RivalScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [data, setData] = useState<{ rounds: RivalRound[]; profiles: Map<string, RivalProfile> } | null>(null);
  const [failed, setFailed] = useState(false);
  const [allTime, setAllTime] = useState(false);
  const year = new Date().getFullYear();

  const load = useCallback(async () => {
    if (!me) return;
    try {
      setData(await loadRivalData(me));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [me]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const season = useMemo(() => (data && me ? rivalries(data.rounds, me, year).find((r) => r.key === key) ?? null : null), [data, me, year, key]);
  const ever = useMemo(() => (data && me ? rivalries(data.rounds, me).find((r) => r.key === key) ?? null : null), [data, me, key]);

  if (failed && !data) return <LoadError size="screen" onRetry={() => void load()} what="this rivalry" />;
  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }
  const r = allTime ? ever : (season ?? null);
  if (!ever) return <StateMessage size="screen" icon="flash-outline" title="No rounds against each other yet" />;

  const profile = ever.memberId ? data.profiles.get(ever.memberId) : undefined;
  const first = profile?.firstName ?? ever.name.split(" ")[0];
  const best = r ? bestWins(r) : { mine: null, theirs: null };
  const run = r ? streak(r) : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.cream50 }} contentContainerStyle={{ paddingBottom: spacing.xl }}>
      <Stack.Screen options={{ title: "Head to head" }} />
      <View style={styles.hero}>
        <View style={styles.faces}>
          <View style={styles.face}>
            <Avatar url={null} color={colors.cream50} name="You" size={56} />
            <Text style={styles.faceName}>You</Text>
          </View>
          <View style={{ alignItems: "center" }}>
            <Text style={styles.score}>{r ? `${r.won}–${r.lost}` : "0–0"}</Text>
            <Text style={styles.heroMeta}>{r ? `${r.halved ? `${r.halved} halved · ` : ""}${r.meetings.length} ${r.meetings.length === 1 ? "round" : "rounds"}` : "No rounds this season"}</Text>
          </View>
          <View style={styles.face}>
            <Avatar url={profile?.avatarUrl ?? null} color={profile?.avatarColor ?? null} name={ever.name} size={56} />
            <Text style={styles.faceName}>{first}</Text>
            {profile?.handicap != null ? <Text style={styles.heroMeta}>{`Index ${indexLabel(profile.handicap)}`}</Text> : null}
          </View>
        </View>
        <View style={styles.toggle}>
          <Pressable style={[styles.toggleBtn, !allTime && styles.toggleOn]} onPress={() => setAllTime(false)} accessibilityRole="radio" accessibilityState={{ selected: !allTime }}>
            <Text style={[styles.toggleText, !allTime && styles.toggleTextOn]}>{`${year} season`}</Text>
          </Pressable>
          <Pressable style={[styles.toggleBtn, allTime && styles.toggleOn]} onPress={() => setAllTime(true)} accessibilityRole="radio" accessibilityState={{ selected: allTime }}>
            <Text style={[styles.toggleText, allTime && styles.toggleTextOn]}>{`All time · ${recordLine(ever)}`}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.stats}>
          <Stat label="Your best win" value={best.mine?.margin ?? "—"} sub={best.mine?.courseName ?? ""} />
          <Stat label={`${first}'s best win`} value={best.theirs?.margin ?? "—"} sub={best.theirs?.courseName ?? ""} />
          <Stat
            label="Run"
            value={run ? `${run.outcome === "won" ? "Won" : run.outcome === "lost" ? "Lost" : "Halved"} ${run.count}` : "—"}
            sub={run && run.count > 1 ? "in a row" : ""}
            tone={run?.outcome === "won" ? colors.green700 : run?.outcome === "lost" ? colors.red600 : undefined}
          />
        </View>

        <Text style={styles.section}>EVERY ROUND AGAINST EACH OTHER</Text>
        {r && r.meetings.length > 0 ? (
          <View style={styles.card}>
            {r.meetings.map((m, i) => (
              <Pressable key={`${m.roundId}`} style={[styles.row, i > 0 && styles.rowLine]} onPress={() => router.push({ pathname: "/live/round/[id]", params: { id: String(m.roundId) } })} accessibilityRole="button">
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {m.courseName}
                  </Text>
                  <Text style={styles.meta}>{`${outingDateLabel(m.playedOn)} · ${m.how}`}</Text>
                </View>
                <Text style={[styles.pill, m.outcome === "won" && styles.pillWon, m.outcome === "lost" && styles.pillLost]}>
                  {m.outcome === "halved" ? "Halved" : `${m.outcome === "won" ? "Won" : "Lost"} ${m.margin}`}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.meta}>No rounds against each other this season.</Text>
        )}
        <Text style={styles.meta}>
          Only rounds where you played against each other count — a match, opposite sides of a fourball, or your own balls in the same group, net off your handicaps that day. Rounds as partners don&apos;t.
        </Text>

        <Pressable style={styles.rematch} onPress={() => router.push("/post-tee-time")} accessibilityRole="button">
          <Text style={styles.rematchText}>{`Rematch — post a tee time for ${first}`}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {sub}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  hero: { backgroundColor: colors.navy900, padding: spacing.lg, gap: spacing.md },
  faces: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  face: { alignItems: "center", gap: 6, width: 96 },
  faceName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  score: { fontFamily: fonts.display, fontSize: 40, color: colors.cream50 },
  heroMeta: { fontFamily: fonts.body, fontSize: 12, color: "#c9d1dc" },
  toggle: { flexDirection: "row", backgroundColor: colors.navy800, borderRadius: radii.md, padding: 4, gap: 4 },
  toggleBtn: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 9 },
  toggleOn: { backgroundColor: colors.cream50 },
  toggleText: { fontFamily: fonts.body, fontSize: type.small, color: "#c9d1dc" },
  toggleTextOn: { fontFamily: fonts.bodyBold, color: colors.navy900 },
  body: { padding: spacing.md, gap: spacing.md },
  stats: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, padding: 10, gap: 2 },
  statLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  statValue: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  section: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.8, color: colors.ink500 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: spacing.md, paddingVertical: 11, minHeight: 56 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.cream100 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  pill: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink900, backgroundColor: colors.cream100, borderRadius: radii.sm, paddingHorizontal: 10, paddingVertical: 5, overflow: "hidden" },
  pillWon: { backgroundColor: colors.navy900, color: colors.cream50 },
  pillLost: { backgroundColor: colors.gold400 },
  rematch: { minHeight: 48, borderRadius: radii.md, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  rematchText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
