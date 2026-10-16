import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GoldButton } from "@/components/gold-button";
import { useMembership } from "@/lib/membership";
import { colors, creamAlpha, fonts, navyAlpha, radii, spacing, type } from "@/lib/theme";

/**
 * The sheet a Basic member sees on tapping a locked feature (approved
 * mock-up "App · Locked feature upsell"): what it unlocks, a free-trial
 * button straight to the plans screen with the right plan picked, and
 * "Not now". A screen shows it when useMembership().gate(key) is "locked".
 */

export type UpsellCopy = { title: string; icon: keyof typeof Ionicons.glyphMap; tier: "premium" | "pro"; points: string[] };

export const UPSELL: Record<string, UpsellCopy> = {
  gps_yardages: {
    title: "Unlock GPS yardages",
    icon: "location-outline",
    tier: "premium",
    points: ["Front, middle and back of every green", "Satellite hole maps with shot tracking", "Distance to the green on your lock screen"],
  },
  voice_scoring: { title: "Say your scores", icon: "mic-outline", tier: "premium", points: ["Say everyone's scores in one go", "A mic on the lock-screen card"] },
  stats: { title: "See where shots go", icon: "stats-chart-outline", tier: "premium", points: ["Fairways, greens and putts", "Trends over your last rounds", "Best and worst holes per course"] },
  competitions: {
    title: "Run competitions",
    icon: "trophy-outline",
    tier: "pro",
    points: ["1st, 2nd and 3rd with countbacks", "Matchplay league tables", "Results kept on the society page"],
  },
  clubhouse_tv: { title: "Put it on the big screen", icon: "tv-outline", tier: "pro", points: ["Live leaderboard for the clubhouse TV", "Birdie flashes as they happen"] },
};

export function UpgradeSheet({ feature, onClose }: { feature: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { membership } = useMembership();
  const copy = feature ? UPSELL[feature] : null;
  if (!copy) return null;
  const trial = membership.trialDays[copy.tier];
  const plan = copy.tier === "pro" ? "Pro" : "Premium";

  const go = () => {
    onClose();
    router.push({ pathname: "/membership", params: { plan: copy.tier } });
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]} accessibilityViewIsModal>
        <View style={styles.grip} />
        <View style={styles.head}>
          <View style={styles.badge}>
            <Ionicons name={copy.icon} size={26} color={colors.navy900} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>{plan.toUpperCase()} FEATURE</Text>
            <Text style={styles.title} accessibilityRole="header">
              {copy.title}
            </Text>
          </View>
        </View>
        {copy.points.map((p) => (
          <View key={p} style={styles.point}>
            <Ionicons name="checkmark" size={18} color={colors.gold400} />
            <Text style={styles.pointText}>{p}</Text>
          </View>
        ))}
        <GoldButton label={trial > 0 ? `Try ${plan} free for ${trial} days` : `Get ${plan}`} onPress={go} style={{ marginTop: spacing.sm }} />
        <Text style={styles.fine}>Then {membership.prices[copy.tier].annual} a year · cancel any time</Text>
        <View style={styles.row}>
          <Pressable style={styles.secondary} onPress={go} accessibilityRole="button">
            <Text style={styles.secondaryText}>See all plans</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={onClose} accessibilityRole="button">
            <Text style={[styles.secondaryText, { color: creamAlpha(0.75) }]}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: navyAlpha(0.55) },
  sheet: {
    backgroundColor: colors.navy900,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 12,
    gap: 12,
  },
  grip: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: creamAlpha(0.25) },
  head: { flexDirection: "row", alignItems: "center", gap: 14 },
  badge: { width: 52, height: 52, borderRadius: radii.lg, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.6, color: colors.gold400 },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, color: colors.cream50 },
  point: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  pointText: { flex: 1, fontFamily: fonts.body, fontSize: type.body - 1, lineHeight: 21, color: colors.cream50 },
  fine: { fontFamily: fonts.body, fontSize: 12, textAlign: "center", color: creamAlpha(0.75) },
  row: { flexDirection: "row", gap: 10 },
  secondary: { flex: 1, minHeight: 48, borderRadius: radii.md + 2, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.cream50 },
});
