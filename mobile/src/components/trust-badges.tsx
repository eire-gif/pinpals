import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { reliabilityBadge, verifiedLabel, type Reliability, type Tone } from "@/lib/reliability";
import { colors, fonts, radii } from "@/lib/theme";

/**
 * The two trust chips (Oct 2026, 0188): Verified golfer and tee-time
 * reliability. Same look as the website's src/components/trust-badges.tsx.
 */

const TONE: Record<Tone, { bg: string; fg: string }> = {
  good: { bg: colors.green100, fg: colors.green800 },
  neutral: { bg: colors.cream100, fg: colors.ink900 },
  warn: { bg: "#f7edcf", fg: "#6b5212" },
  bad: { bg: colors.red100, fg: colors.red600 },
};

export function VerifiedChip({ club, compact = false, onDark = false }: { club?: string | null; compact?: boolean; onDark?: boolean }) {
  const bg = onDark ? colors.gold400 : colors.navy900;
  const fg = onDark ? colors.navy900 : colors.cream50;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]} accessibilityLabel={verifiedLabel(club)}>
      <Ionicons name="shield-checkmark" size={13} color={onDark ? colors.navy900 : colors.gold400} />
      <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
        {compact ? "Verified" : verifiedLabel(club)}
      </Text>
    </View>
  );
}

export function ReliabilityChip({ reliability }: { reliability: Reliability | null | undefined }) {
  const { label, tone } = reliabilityBadge(reliability);
  const t = TONE[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      <Ionicons name={tone === "bad" ? "alert-circle" : tone === "good" ? "checkmark-circle" : "time-outline"} size={13} color={t.fg} />
      <Text style={[styles.label, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function TrustBadges({
  reliability,
  verified,
  verifiedClub,
  onDark = false,
  compactVerified = false,
  style,
}: {
  reliability: Reliability | null | undefined;
  verified: boolean;
  verifiedClub?: string | null;
  onDark?: boolean;
  compactVerified?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.row, style]}>
      {verified ? <VerifiedChip club={verifiedClub} onDark={onDark} compact={compactVerified} /> : null}
      <ReliabilityChip reliability={reliability} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  label: { fontFamily: fonts.bodyBold, fontSize: 12.5 },
});
