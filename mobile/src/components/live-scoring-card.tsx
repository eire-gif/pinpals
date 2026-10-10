import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { isOn } from "@/lib/features";
import { colors, spacing } from "@/lib/theme";

/**
 * Home's way into live scoring, just below "How was golf today?".
 *
 * Oct 2026: redrawn as a raised navy-and-gold button so it reads as its own
 * section on Home rather than one row among many. The title is the iPhone's
 * own font (SF Pro Display, via the system font) at heavy weight.
 *
 * The depth is built from plain Views — stacked translucent bands for the
 * light from above and the shade below, a gold lip underneath for the edge —
 * because a real gradient needs a native module, and this has to ship as an
 * over-the-air update. Renders nothing while the flag is off.
 */

const LIP = "#9c7a2c"; // the card's gold edge, seen from below
const GOLD_LIGHT = "#f6dc97";
const GOLD_SHADE = "#c99d3e";
const RAISED = "#18375f";

export function LiveScoringCard() {
  if (!isOn("liveScoring")) return null;
  return (
    <RaisedCard
      title="Live Scoring"
      subtitle="Score with your group, watch the leaderboard move"
      onPress={() => router.push("/live")}
      a11y="Live scoring. Score your round with your group and follow the leaderboard."
    />
  );
}

/**
 * The raised navy-and-gold button itself, shared by Home's Live Scoring and
 * the live hub's "Start a round" / "Start a match day" (Oct 2026: "like the
 * live scoring button"). The disc shows the gold scoreboard by default, or an
 * Ionicon in gold.
 */
export function RaisedCard({
  title,
  subtitle,
  onPress,
  a11y,
  icon,
  marginTop = spacing.md,
  inset = true,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
  a11y?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  marginTop?: number;
  /** Home insets the card from the screen edge; a padded screen doesn't. */
  inset?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? `${title}. ${subtitle}`}
      style={[styles.outer, { marginTop, marginHorizontal: inset ? spacing.md : 0 }]}
    >
      {({ pressed }) => (
        <View style={[styles.lip, pressed && styles.lipPressed]}>
          <View style={styles.card}>
            {/* Light from above, shade below — a few soft bands each. */}
            <View style={styles.sheen} pointerEvents="none" />
            <View style={styles.ring} pointerEvents="none" />
            {[0.12, 0.24, 0.36, 0.48].map((h) => (
              <View key={h} style={[styles.band, { height: `${h * 100}%` }]} pointerEvents="none" />
            ))}
            {[4, 9, 16].map((h) => (
              <View key={h} style={[styles.shade, { height: h }]} pointerEvents="none" />
            ))}
            <View style={styles.topEdge} pointerEvents="none" />

            <View style={[styles.disc, icon ? styles.discIcon : null]}>
              <View style={styles.glare} pointerEvents="none" />
              {icon ? (
                <Ionicons name={icon} size={24} color={colors.gold400} style={styles.iconShadow} />
              ) : (
                <>
                  <Bar height={14} />
                  <Bar height={21} />
                  <Bar height={11} />
                </>
              )}
            </View>

            <View style={styles.middle}>
              <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {title}
              </Text>
              <Text style={styles.body} numberOfLines={2}>
                {subtitle}
              </Text>
            </View>

            <View style={styles.chevron}>
              <Ionicons name="chevron-forward" size={20} color={colors.gold400} />
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** A gold block: lit face, shaded right side, bright top. */
function Bar({ height }: { height: number }) {
  return (
    <View style={[styles.bar, { height }]}>
      <View style={styles.barSide} />
      <View style={styles.barTop} />
    </View>
  );
}

const R = 20;

const styles = StyleSheet.create({
  outer: {
    borderRadius: R,
    shadowColor: colors.navy900,
    shadowOpacity: 0.3,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  // The gold showing beneath the card is what makes it read as raised; a
  // press sinks the card onto it.
  lip: { borderRadius: R, backgroundColor: LIP, paddingBottom: 3 },
  lipPressed: { paddingBottom: 0, marginTop: 3 },
  card: {
    minHeight: 104,
    borderRadius: R,
    borderWidth: 1.5,
    borderColor: colors.gold500,
    backgroundColor: colors.navy900,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: spacing.md,
    paddingRight: 14,
    paddingVertical: 12,
  },
  sheen: {
    position: "absolute",
    left: -42,
    right: -42,
    top: -24,
    height: 150,
    borderRadius: 220,
    backgroundColor: "rgba(24,58,104,0.55)",
  },
  ring: {
    position: "absolute",
    left: -72,
    right: -72,
    top: -40,
    height: 180,
    borderRadius: 250,
    borderWidth: 1,
    borderColor: "rgba(232,196,107,0.16)",
  },
  band: { position: "absolute", left: 0, right: 0, top: 0, backgroundColor: "rgba(247,243,234,0.022)" },
  shade: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.05)" },
  topEdge: { position: "absolute", left: 0, right: 0, top: 0, height: 1.5, backgroundColor: "rgba(247,243,234,0.28)" },

  disc: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1.5,
    borderColor: colors.gold400,
    borderTopColor: GOLD_LIGHT,
    borderBottomColor: "#b8913c",
    backgroundColor: colors.navy800,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 3,
    paddingBottom: 15,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 5 },
  },
  discIcon: { alignItems: "center", paddingBottom: 0 },
  iconShadow: { textShadowColor: "rgba(0,0,0,0.45)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 2 },
  glare: {
    position: "absolute",
    left: 6,
    right: 6,
    top: 3,
    height: "45%",
    borderRadius: 20,
    backgroundColor: "rgba(247,243,234,0.06)",
  },
  bar: {
    width: 9,
    borderRadius: 2.5,
    backgroundColor: colors.gold400,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 2 },
  },
  barSide: { position: "absolute", right: 0, top: 0, bottom: 0, width: "40%", backgroundColor: GOLD_SHADE },
  barTop: { position: "absolute", left: 0, right: 0, top: 0, height: 3, backgroundColor: GOLD_LIGHT },

  middle: { flex: 1, alignItems: "center" },
  // No fontFamily: the system font, which iOS draws as SF Pro Display at
  // this size.
  title: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "800",
    letterSpacing: -0.4,
    color: colors.cream50,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  body: { fontSize: 13.5, lineHeight: 18, color: colors.cream100, opacity: 0.92, textAlign: "center", marginTop: 3 },

  chevron: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: RAISED,
    borderTopWidth: 1,
    borderTopColor: "rgba(247,243,234,0.18)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 3 },
  },
});
