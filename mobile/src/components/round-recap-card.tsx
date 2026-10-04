import { Image, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import type { RoundDetails } from "@/lib/post-details";
import { bestHoleLine, recapStats } from "@/lib/round-recap";
import { colors, creamAlpha, fonts, navyAlpha, radii, spacing } from "@/lib/theme";

/**
 * The Round Recap card (phase 7) — the mockup's "Share Your Round" panel.
 *
 * Reusable: the composer shows it live as the member fills in their round,
 * and anything else that wants to present a round (a profile's Rounds tab,
 * an achievement post) can draw the same card from the same details. It
 * draws whatever is filled in and a quiet dash for the rest, so an empty
 * recap reads as "add your numbers", not as a round of zeros.
 *
 * The picture is the member's first chosen photo if there is one, otherwise
 * the course's PinPals photograph. There is no course map: nothing in
 * PinPals has hole geometry yet.
 */
export function RoundRecapCard({
  course,
  subtitle,
  details,
  photo,
}: {
  course: string;
  subtitle: string;
  details: Partial<RoundDetails>;
  /** A photo the member picked, or the course photograph. */
  photo: ImageSourcePropType;
}) {
  const stats = recapStats(details);
  const best = bestHoleLine(details);
  const [score, ...rest] = stats;

  return (
    <View style={styles.card} accessible accessibilityLabel={`Round recap: ${course}. ${subtitle}`}>
      <View style={styles.hero}>
        <Image source={photo} style={styles.heroImage} resizeMode="cover" accessibilityIgnoresInvertColors />
        <View style={styles.heroShade} />
        <View style={styles.heroText}>
          <Text style={styles.kicker}>ROUND RECAP</Text>
          <Text style={styles.course} numberOfLines={2}>
            {course}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.scoreRow}>
          <View style={styles.scoreBlock}>
            <Text style={styles.scoreLabel}>{score.label.toUpperCase()}</Text>
            <View style={styles.scoreLine}>
              <Text style={[styles.score, score.value === null && styles.empty]}>{score.value ?? "—"}</Text>
              {score.accent ? <Text style={styles.scoreAccent}>{score.accent}</Text> : null}
            </View>
          </View>
          {rest.slice(0, 2).map((s) => (
            <Tile key={s.label} label={s.label} value={s.value} inRow />
          ))}
        </View>
        <View style={styles.grid}>
          {rest.slice(2).map((s) => (
            <Tile key={s.label} label={s.label} value={s.value} />
          ))}
        </View>

        <View style={styles.best}>
          <View style={styles.bestIcon}>
            <Ionicons name="flag" size={14} color={colors.cream50} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bestLabel}>BEST HOLE</Text>
            <Text style={[styles.bestValue, !best && styles.bestEmpty]}>{best ?? "Add your best hole"}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function Tile({ label, value, inRow = false }: { label: string; value: string | null; inRow?: boolean }) {
  return (
    <View style={[styles.tile, inRow && styles.tileInRow]}>
      <Text style={[styles.tileValue, value === null && styles.empty]} numberOfLines={1}>
        {value ?? "—"}
      </Text>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: "hidden",
  },
  hero: { height: 150, justifyContent: "flex-end" },
  heroImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  // A flat navy veil rather than a gradient: a real gradient is a native
  // module (expo-linear-gradient), and this card ships over the air.
  heroShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: navyAlpha(0.48) },
  heroText: { padding: spacing.md - 2 },
  kicker: { fontFamily: fonts.bodySemi, fontSize: 11, letterSpacing: 1.6, color: colors.gold400 },
  course: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50, marginTop: 2 },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: creamAlpha(0.88), marginTop: 2 },

  body: { padding: spacing.md - 2, gap: spacing.sm + 2 },
  scoreRow: { flexDirection: "row", gap: spacing.sm },
  scoreBlock: {
    flex: 1.5,
    backgroundColor: colors.green100,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    justifyContent: "center",
  },
  scoreLabel: { fontFamily: fonts.bodySemi, fontSize: 10.5, letterSpacing: 0.8, color: colors.green800 },
  scoreLine: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  score: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: colors.ink900 },
  scoreAccent: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.green700, marginBottom: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: "30%",
    backgroundColor: colors.surfaceTint,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  // Beside the score: share the row by flex, not by the grid's 30% basis.
  tileInRow: { flexBasis: 0, flexGrow: 1 },
  tileValue: { fontFamily: fonts.display, fontSize: 22, color: colors.ink900 },
  tileLabel: { fontFamily: fonts.bodySemi, fontSize: 10.5, letterSpacing: 0.8, color: colors.ink500, marginTop: 2 },
  empty: { color: colors.line },
  best: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    backgroundColor: colors.surfaceTint,
    borderRadius: radii.md,
    padding: spacing.sm + 2,
  },
  bestIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.red600, alignItems: "center", justifyContent: "center" },
  bestLabel: { fontFamily: fonts.bodySemi, fontSize: 10.5, letterSpacing: 1, color: colors.ink500 },
  bestValue: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900, marginTop: 1 },
  bestEmpty: { fontFamily: fonts.body, color: colors.ink500 },
});
