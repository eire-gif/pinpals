import { ImageBackground, StyleSheet, Text, View } from "react-native";

import { colors, fonts, spacing } from "@/lib/theme";

const PHOTO = require("../../assets/images/scenes/coast-aerial.jpg");

/**
 * The photographic header on Groups & societies and My Groups & Societies
 * (Oct 2026 redesign, canvas boards G1/G5): a course photograph under a navy
 * veil, the gold rule and eyebrow, a two-tone Playfair title and one line.
 *
 * Flat veils, not a gradient — a gradient is a native module and a new
 * build for every member (see Home's hero).
 */
export function GroupsHero({
  eyebrow,
  title,
  accent,
  line,
}: {
  eyebrow: string;
  /** First half of the title, in cream. */
  title: string;
  /** Second half, in gold italic. */
  accent: string;
  line?: string | null;
}) {
  return (
    <ImageBackground source={PHOTO} style={styles.hero} imageStyle={styles.image} accessibilityRole="header">
      <View style={styles.veil} />
      <View style={styles.veilLow} />
      <View style={styles.body}>
        <View style={styles.eyebrowRow}>
          <View style={styles.rule} />
          <Text style={styles.eyebrow}>{eyebrow}</Text>
        </View>
        <Text style={styles.title}>
          {title} <Text style={styles.accent}>{accent}</Text>
        </Text>
        {line ? (
          <Text style={styles.line} numberOfLines={2}>
            {line}
          </Text>
        ) : null}
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  hero: { minHeight: 172, justifyContent: "flex-end", backgroundColor: colors.navy900 },
  image: { resizeMode: "cover" },
  veil: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(10,18,34,0.42)" },
  veilLow: { position: "absolute", left: 0, right: 0, bottom: 0, height: "60%", backgroundColor: "rgba(10,18,34,0.38)" },
  body: { paddingHorizontal: spacing.lg, paddingBottom: 18, paddingTop: spacing.lg, gap: 6 },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rule: { width: 22, height: 2, backgroundColor: colors.gold400 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: colors.gold400 },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.cream50 },
  accent: { fontFamily: fonts.displayItalic, color: colors.gold400 },
  line: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: "rgba(247,243,234,0.88)" },
});
