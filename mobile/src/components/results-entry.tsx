import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { hasResults, loadResultsState, workOut, type ResultsState } from "@/lib/competition-data";
import { DEFAULT_SETTINGS } from "@/lib/competition-results";
import type { MatchDayData } from "@/lib/live-match-days";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The results card on a society, scramble or foursomes day's board (0137) —
 * mock-up "Day page: cards coming in".
 *
 *   organiser, not published  cards in so far, and "Prepare results"
 *   published                 the winners, and "See the results"
 *   anyone else before then   nothing: results aren't out yet
 */
export function ResultsEntry({ data, me }: { data: MatchDayData; me: string | null }) {
  const [state, setState] = useState<ResultsState | null>(null);
  const dayId = data.day.id;

  useFocusEffect(
    useCallback(() => {
      void loadResultsState(dayId)
        .then(setState)
        .catch(() => setState(null));
    }, [dayId])
  );

  if (!hasResults(data) || !state) return null;
  const isOrganiser = me != null && data.day.createdBy === me;
  const published = state.row?.status === "published" ? state.row.results : null;
  const open = () => router.push({ pathname: "/live/day/results/[id]", params: { id: String(dayId) } });

  if (published) {
    const firsts = published.prizes
      .filter((p) => p.label !== "Best gross" && p.winners.length > 0)
      .slice(0, 3)
      .map((p) => `${published.divisions.length > 1 ? `${p.label}: ` : ""}${p.winners[0].name}`);
    return (
      <Pressable onPress={open} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]} accessibilityRole="button">
        <View style={styles.head}>
          <Ionicons name="trophy" size={20} color={colors.gold400} />
          <Text style={styles.title}>Results</Text>
          <Text style={styles.tag}>
            {(state.row?.version ?? 1) > 1 ? "Updated" : "Final"}
            {(published.amendments?.length ?? 0) > 0 ? " · Amended" : ""}
          </Text>
        </View>
        <Text style={styles.body} numberOfLines={3}>
          Winner{firsts.length > 1 ? "s" : ""}: {firsts.join(" · ")}
        </Text>
        <View style={styles.button}>
          <Text style={styles.buttonText}>See the results</Text>
        </View>
      </Pressable>
    );
  }

  if (!isOrganiser) return null;

  const now = workOut(data, state, state.row?.settings ?? DEFAULT_SETTINGS);
  const total = now.counts.entrants;
  const done = now.counts.complete;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="trophy-outline" size={20} color={colors.gold400} />
        <Text style={styles.title}>Results</Text>
        <Text style={styles.tag}>Organiser</Text>
      </View>
      <View style={styles.countRow}>
        <Text style={styles.body}>Cards in</Text>
        <Text style={styles.count}>
          {done} <Text style={styles.of}>of {total}</Text>
        </Text>
      </View>
      <View style={styles.bar} accessibilityLabel={`${done} of ${total} cards in`}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.body}>
        PinPals works out 1st, 2nd and 3rd with countbacks as cards come in. Check them, then publish to everyone.
      </Text>
      <Pressable onPress={open} style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]} accessibilityRole="button">
        <Text style={styles.buttonText}>Prepare results</Text>
      </Pressable>
      {done < total ? <Text style={styles.small}>You can prepare them now; they stay provisional until you publish.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.navy900, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.gold500, padding: spacing.md, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  tag: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: colors.navy900, backgroundColor: colors.gold400, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill, overflow: "hidden" },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.cream100 },
  countRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  count: { fontFamily: fonts.display, fontSize: 24, color: colors.cream50 },
  of: { fontFamily: fonts.body, fontSize: 14, color: colors.cream100 },
  bar: { height: 8, borderRadius: 4, backgroundColor: "rgba(247,243,234,0.18)", overflow: "hidden" },
  barFill: { height: 8, backgroundColor: colors.gold400 },
  button: { minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
  small: { fontFamily: fonts.body, fontSize: 12, color: colors.cream100, textAlign: "center" },
});
