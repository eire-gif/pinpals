import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { SIDE_COLORS, SIDE_TEXT, deleteMatchDay, loadMatchDay, subscribeToMatchDay, type Match, type MatchDayData } from "@/lib/live-match-days";
import { formatInfo, pointsLabel } from "@/lib/live-scoring";
import { dateLabel } from "@/lib/tee-times";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { colors, creamAlpha, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The match-day board: the team score, then every match with where it
 * stands and how far round it is. Groups go out at different times, so each
 * match shows its own "thru". Updates as any group scores (live-day-<id>).
 *
 * Tapping a match opens its scorecard: your own to score, anyone else's to
 * watch.
 */
export default function MatchDayBoard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dayId = Number(id);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [data, setData] = useState<MatchDayData | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setFailed(false);
      setData(await loadMatchDay(dayId));
    } catch {
      setFailed(true);
    }
  }, [dayId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );
  useEffect(() => subscribeToMatchDay(dayId, () => void load()), [dayId, load]);
  useLiveRefresh(load, !!data && data.matches.some((m) => m.round.status === "live"));

  if (!isOn("liveScoring")) return <StateMessage size="screen" icon="podium-outline" title="Live scoring is on its way" />;
  if (failed) return <LoadError size="screen" what="this match day" onRetry={() => void load()} />;
  if (data === undefined) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;
  if (data === null) return <StateMessage size="screen" icon="lock-closed-outline" title="This match day isn't available" body="It may have been removed, or you're not in it." />;

  const { day, matches, totals } = data;
  const allDone = matches.length > 0 && totals.finishedCount === matches.length;
  const anyLive = matches.some((m) => m.round.status === "live" && !m.state?.finished);
  const sideName = (m: Match, n: 1 | 2) =>
    day.teamNames?.[n - 1] ?? m.players.filter((p) => p.side === n).map((p) => p.name.split(" ")[0]).join(" & ");
  const mine = (m: Match) => m.players.some((p) => p.memberId != null && p.memberId === me);
  // Your own match first, then in match order.
  const isOrganiser = me != null && day.createdBy === me;
  const remove = () =>
    Alert.alert(
      "Delete this match day?",
      `${matches.length === 1 ? "Its match" : `All ${matches.length} matches`} and every score go for everyone in it. This can't be undone.`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMatchDay(day.id);
              router.replace("/live");
            } catch (e) {
              Alert.alert("Couldn't delete it", e instanceof Error ? e.message : "Please try again.");
            }
          },
        },
      ]
    );
  const ordered = [...matches].sort((a, b) => Number(mine(b)) - Number(mine(a)) || (a.round.matchNumber ?? 0) - (b.round.matchNumber ?? 0));

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
      <Stack.Screen options={{ title: day.title }} />

      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <Text style={styles.heroMeta}>
            {day.courseName} · {dateLabel(day.playedOn)}
          </Text>
          {anyLive ? (
            <View style={styles.liveTag}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live</Text>
            </View>
          ) : allDone ? (
            <Text style={styles.heroMeta}>Final</Text>
          ) : null}
        </View>
        <Text style={styles.heroTitle}>{day.title}</Text>

        {day.teamNames ? (
          <>
            <View style={styles.teams} accessibilityLabel={`${day.teamNames[0]} ${pointsLabel(totals.final[0])}, ${day.teamNames[1]} ${pointsLabel(totals.final[1])}`}>
              {([0, 1] as const).map((n) => (
                <View key={n} style={[styles.team, { backgroundColor: SIDE_COLORS[n] }, n === 1 && { alignItems: "flex-end" }]}>
                  <Text style={[styles.teamName, { color: SIDE_TEXT[n] }]}>{day.teamNames![n]}</Text>
                  <Text style={[styles.teamPoints, { color: SIDE_TEXT[n] }]}>{pointsLabel(totals.final[n])}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.heroSub}>
              {allDone
                ? `Final score, ${matches.length} ${matches.length === 1 ? "match" : "matches"}.`
                : `If every match ended as it stands: ${day.teamNames[0]} ${pointsLabel(totals.projected[0])} – ${day.teamNames[1]} ${pointsLabel(totals.projected[1])}`}
            </Text>
          </>
        ) : null}
      </View>

      {ordered.map((m) => {
        const st = m.state;
        const done = m.round.status === "finished" || !!st?.finished;
        const status = !st ? "No card yet" : st.leader === 0 ? st.margin : `${sideName(m, st.leader)} ${st.margin}`;
        const sub = !st
          ? "Stroke indexes needed"
          : done
            ? st.leader === 0
              ? "½ each"
              : "1 point"
            : st.holes.length === 0
              ? m.round.teeTime
                ? `Tees off ${m.round.teeTime}`
                : "Not started"
              : st.dormie
                ? `Dormie · thru ${st.holes.length}`
                : `thru ${st.holes.length}`;
        // Scores are in on a hole whose stroke index isn't: say why it's stuck.
        const stuck =
          !done && st?.waitingForIndex != null && m.players.some((p) => m.scores.get(p.id)?.has(st.waitingForIndex!))
            ? `Hole ${st.waitingForIndex} needs its SI`
            : null;
        const pill = !st || st.leader === 0 ? { bg: colors.cream100, fg: colors.ink900 } : { bg: SIDE_COLORS[st.leader - 1], fg: SIDE_TEXT[st.leader - 1] };
        const byHole = new Map((st?.holes ?? []).map((h) => [h.hole, h.result]));
        return (
          <Pressable
            key={m.round.id}
            onPress={() => router.push({ pathname: "/live/round/[id]", params: { id: String(m.round.id) } })}
            style={({ pressed }) => [styles.match, mine(m) && styles.matchMine, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel={`Match ${m.round.matchNumber}, ${formatInfo(m.format).label}: ${sideName(m, 1)} versus ${sideName(m, 2)}. ${status}, ${sub}.`}
          >
            <View style={styles.matchTop}>
              <Text style={styles.matchMeta}>
                Match {m.round.matchNumber} · {formatInfo(m.format).label}
              </Text>
              <Text style={[styles.matchTag, mine(m) ? { color: colors.green700 } : done ? { color: colors.ink500 } : { color: colors.green600 }]}>
                {mine(m) ? "Your match" : done ? "Finished" : st && st.holes.length > 0 ? "Live" : ""}
              </Text>
            </View>
            <View style={styles.matchRow}>
              <View style={styles.sideCol}>
                <View style={[styles.bar, { backgroundColor: SIDE_COLORS[0] }]} />
                <Text style={styles.names}>{m.players.filter((p) => p.side === 1).map((p) => p.name.split(" ")[0]).join(" & ")}</Text>
              </View>
              <View style={styles.statusCol}>
                <Text style={[styles.pill, { backgroundColor: pill.bg, color: pill.fg }]}>{status}</Text>
                <Text style={styles.sub}>{sub}</Text>
                {stuck ? <Text style={[styles.sub, { color: colors.red600 }]}>{stuck}</Text> : null}
              </View>
              <View style={[styles.sideCol, { justifyContent: "flex-end" }]}>
                <Text style={[styles.names, { textAlign: "right" }]}>{m.players.filter((p) => p.side === 2).map((p) => p.name.split(" ")[0]).join(" & ")}</Text>
                <View style={[styles.bar, { backgroundColor: SIDE_COLORS[1] }]} />
              </View>
            </View>
            <View style={styles.strip}>
              {m.card.map((c) => {
                const r = byHole.get(c.hole);
                const bg = r === "won" ? SIDE_COLORS[0] : r === "lost" ? SIDE_COLORS[1] : r === "halved" ? colors.line : colors.cream100;
                return <View key={c.hole} style={[styles.cell, { backgroundColor: bg }]} />;
              })}
            </View>
          </Pressable>
        );
      })}

      <Text style={styles.footNote}>Each hole is coloured by the side that won it. Tap a match to see or score it.</Text>

      {isOrganiser ? (
        <Pressable onPress={remove} style={styles.delete} accessibilityRole="button">
          <Text style={styles.deleteLabel}>Delete match day</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  hero: { backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroMeta: { fontFamily: fonts.body, fontSize: 13, color: creamAlpha(0.85) },
  heroTitle: { fontFamily: fonts.display, fontSize: 26, color: colors.cream50 },
  heroSub: { fontFamily: fonts.body, fontSize: 13, color: creamAlpha(0.85), textAlign: "center" },
  liveTag: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green600 },
  liveText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: colors.green100 },
  teams: { flexDirection: "row", gap: spacing.sm },
  team: { flex: 1, borderRadius: radii.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  teamName: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase" },
  teamPoints: { fontFamily: fonts.display, fontSize: 32 },
  match: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  matchMine: { borderWidth: 2, borderColor: colors.green700 },
  matchTop: { flexDirection: "row", justifyContent: "space-between" },
  matchMeta: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink500 },
  matchTag: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" },
  matchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sideCol: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  bar: { width: 4, height: 32, borderRadius: 2 },
  names: { flexShrink: 1, fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  statusCol: { alignItems: "center", minWidth: 96 },
  pill: { fontFamily: fonts.bodyBold, fontSize: 14, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill, overflow: "hidden" },
  sub: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, marginTop: 3 },
  strip: { flexDirection: "row", gap: 2 },
  cell: { flex: 1, height: 6, borderRadius: 3 },
  delete: { minHeight: 48, borderRadius: 999, borderWidth: 1, borderColor: colors.red600, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  deleteLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.red600 },
  footNote: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, textAlign: "center" },
});
