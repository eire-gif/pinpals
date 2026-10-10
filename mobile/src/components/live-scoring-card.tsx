import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { isOn } from "@/lib/features";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * Home's way into live scoring, just below "How was golf today?".
 *
 * One row, not a section: Home already carries a lot, and the job here is to
 * be findable on the day someone's standing on the first tee — not to sell
 * the feature. Renders nothing while the flag is off.
 */
export function LiveScoringCard() {
  if (!isOn("liveScoring")) return null;
  return (
    <Pressable
      onPress={() => router.push("/live")}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
      accessibilityRole="button"
      accessibilityLabel="Live scoring. Score your round with your group and follow the leaderboard."
    >
      <View style={styles.icon}>
        <Ionicons name="podium" size={22} color={colors.gold400} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Live scoring</Text>
        <Text style={styles.body}>Score with your group, watch the leaderboard move</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.cream100} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    marginHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderRadius: radii.lg,
    backgroundColor: colors.navy900,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.navy800,
    alignItems: "center",
    justifyContent: "center",
  },
  // Oct 2026: big enough to spot at a glance on Home — the way into a round
  // on the first tee shouldn't need looking for.
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: colors.cream50 },
  body: { fontFamily: fonts.body, fontSize: 13, color: colors.cream100, marginTop: 2 },
});
