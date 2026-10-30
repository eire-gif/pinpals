import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { TONES } from "@/components/live-scoring-card";
import { LoadError, StateMessage } from "@/components/state-message";
import { TintedHeader } from "@/components/tinted-header";
import { dayLabel, loadLegend, loadWeekBoard, myLine, scoreFor, weekLabel, type BoardMetric, type Legend, type WeekBoard } from "@/lib/course-boards";
import { isOn } from "@/lib/features";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * A course's leaderboard (0197, claude/course-boards.md; approved mock-up
 * "Course leaderboard — this week"): each member's best round here this
 * week (Monday to Sunday) by Stableford points, net or gross; the Course
 * Legend (most rounds here in 90 days); and the way to Hole champions.
 *
 * Every round here enters by itself — members who'd rather not be on it
 * switch it off in Privacy & security.
 */
const METRICS: { id: BoardMetric; label: string }[] = [
  { id: "stableford", label: "Stableford" },
  { id: "net", label: "Net" },
  { id: "gross", label: "Gross" },
];

export default function CourseBoardScreen() {
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const clubId = Number(params.id);
  const name = params.name ?? "This course";

  const [metric, setMetric] = useState<BoardMetric>("stableford");
  const [board, setBoard] = useState<WeekBoard | null>(null);
  const [legend, setLegend] = useState<Legend | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (m: BoardMetric) => {
      if (!Number.isFinite(clubId)) return;
      try {
        setFailed(false);
        const [b, l] = await Promise.all([loadWeekBoard(clubId, m), loadLegend(clubId).catch(() => null)]);
        setBoard(b);
        setLegend(l);
      } catch {
        setFailed(true);
      }
    },
    [clubId]
  );

  useFocusEffect(
    useCallback(() => {
      void load(metric);
    }, [load, metric])
  );

  const header = <TintedHeader color={TONES.navy.card} title="Leaderboard" subtitle={board ? `This week · ${weekLabel(board.weekStart)}` : "This week"} />;

  if (!isOn("courseBoards")) {
    return (
      <>
        {header}
        <StateMessage size="screen" icon="podium-outline" title="Course leaderboards are on their way" />
      </>
    );
  }
  if (failed) {
    return (
      <>
        {header}
        <LoadError size="screen" what="the leaderboard" onRetry={() => void load(metric)} />
      </>
    );
  }

  const mine = board ? myLine(board.rows, metric) : null;
  const top = board?.rows.filter((r) => r.place <= 50) ?? [];

  return (
    <>
      {header}
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(metric).finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>WEEKLY LEADERBOARD</Text>
          <Text style={styles.heroTitle}>{name}</Text>
          <Text style={styles.heroSub}>
            {board ? `${board.players} golfer${board.players === 1 ? "" : "s"} this week · resets Monday` : "Resets every Monday"}
          </Text>
        </View>

        <View style={styles.segment} accessibilityRole="radiogroup">
          {METRICS.map((m) => {
            const on = m.id === metric;
            return (
              <Pressable
                key={m.id}
                onPress={() => {
                  setMetric(m.id);
                  setBoard(null);
                }}
                style={[styles.segBtn, on && styles.segOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.segText, on && { color: colors.cream50 }]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {!board ? (
          <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.lg }} />
        ) : board.rows.length === 0 ? (
          <StateMessage
            icon="golf-outline"
            title="Nobody's on the board yet this week"
            body="Play here and save your scorecard — every round here goes on the board by itself."
          />
        ) : (
          <View style={styles.list}>
            {top.map((r, i) => {
              const gapBefore = i > 0 && r.isMe && top[i - 1]!.place < r.place - 1 && r.place > 6;
              return (
                <View key={r.memberId}>
                  {gapBefore ? <View style={styles.gap} /> : null}
                  <Pressable
                    onPress={() => !r.isMe && router.push(`/member/${r.memberId}`)}
                    style={[styles.row, i < top.length - 1 && styles.rowLine, r.isMe && styles.rowMe]}
                    accessibilityRole={r.isMe ? undefined : "button"}
                    accessibilityLabel={`${r.place}. ${r.isMe ? "You" : r.name}, ${scoreFor(r, metric)}`}
                  >
                    <Text style={[styles.place, r.place === 1 && { color: "#a8802f" }]}>{r.place}</Text>
                    <Avatar url={r.avatarUrl} color={r.avatarColor} name={r.name} size={42} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{r.isMe ? "You" : r.name}</Text>
                      <Text style={styles.meta}>
                        {r.isMe && mine ? mine : [r.handicap != null ? `HCP ${r.handicap}` : null, dayLabel(r.playedOn)].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    <Text style={styles.score}>{scoreFor(r, metric)}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        {legend ? (
          <View style={styles.legend}>
            <View style={styles.ring}>
              <Ionicons name="ribbon" size={28} color={colors.gold400} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.legendEyebrow}>COURSE LEGEND</Text>
              <Text style={styles.legendName}>{legend.isMe ? "You" : legend.name}</Text>
              <Text style={styles.legendSub}>
                {`${legend.rounds} round${legend.rounds === 1 ? "" : "s"} here in 90 days.`}
                {!legend.isMe ? ` You've played ${legend.myRounds}.` : " Keep it up."}
              </Text>
            </View>
          </View>
        ) : null}

        <Pressable
          onPress={() => router.push({ pathname: "/course/champions/[id]", params: { id: String(clubId), name } })}
          style={({ pressed }) => [styles.link, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
        >
          <Ionicons name="flag" size={26} color={colors.green700} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkTitle}>Hole champions</Text>
            <Text style={styles.linkSub}>Who owns each hole this month</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
        </Pressable>

        <Text style={styles.foot}>Every round played here goes on the board by itself. You can turn that off any time in Privacy & security.</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: 14 },
  hero: { backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md, gap: 4 },
  heroEyebrow: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 2, color: colors.gold400 },
  heroTitle: { fontFamily: fonts.display, fontSize: 26, color: colors.cream50 },
  heroSub: { fontFamily: fonts.body, fontSize: 15, color: "#d9d2c2" },
  segment: { flexDirection: "row", gap: 6, backgroundColor: "#f3ede1", borderRadius: 14, padding: 5, borderWidth: 1.5, borderColor: "#e6dcc6" },
  segBtn: { flex: 1, minHeight: 46, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: colors.navy900 },
  segText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink500 },
  list: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1.5, borderColor: "#e6dcc6", overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 64 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: "#efe7d6" },
  rowMe: { backgroundColor: "#fbf3df" },
  gap: { height: 2, backgroundColor: "#c9a24a" },
  place: { width: 28, textAlign: "center", fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink500 },
  name: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.navy900 },
  meta: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink500, marginTop: 2 },
  score: { fontFamily: fonts.bodyBold, fontSize: 24, color: colors.navy900 },
  legend: { flexDirection: "row", alignItems: "center", gap: 14, padding: spacing.md, borderRadius: 22, backgroundColor: "#5c1f2b", borderWidth: 2, borderColor: "#c9a24a" },
  ring: { width: 58, height: 58, borderRadius: 29, borderWidth: 3, borderColor: "#e2b85c", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.18)" },
  legendEyebrow: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 2, color: colors.gold400 },
  legendName: { fontFamily: fonts.bodyBold, fontSize: 21, color: colors.cream50, marginTop: 4 },
  legendSub: { fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: "#ecd3d6", marginTop: 2 },
  link: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1.5, borderColor: "#e6dcc6", padding: spacing.md },
  linkTitle: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.navy900 },
  linkSub: { fontFamily: fonts.body, fontSize: 15, color: colors.ink500, marginTop: 2 },
  foot: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink500, textAlign: "center" },
});
