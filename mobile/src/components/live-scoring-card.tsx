import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { isOn } from "@/lib/features";
import { colors, fonts, spacing } from "@/lib/theme";

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

/**
 * Oct 2026 (option A): the live hub's three ways in each get their own
 * colour, all with the same gold rim, so they can be told apart at a glance —
 * navy for a round, green for groups and societies, claret for match days.
 */
export type RaisedTone = "navy" | "green" | "claret" | "bronze";
/** Exported so the page each Home button opens can wear the same colour (Oct 2026). */
export const TONES: Record<RaisedTone, { card: string; disc: string; chevron: string; sheen: string }> = {
  navy: { card: colors.navy900, disc: colors.navy800, chevron: RAISED, sheen: "rgba(24,58,104,0.55)" },
  green: { card: "#0f3424", disc: "#17482f", chevron: "#1f5a3b", sheen: "rgba(34,92,62,0.55)" },
  claret: { card: "#3a121c", disc: "#55202c", chevron: "#6a2836", sheen: "rgba(112,42,58,0.5)" },
  // Oct 2026: Home's Marketplace button — the same gold rim on a dark bronze.
  bronze: { card: "#3a2a0e", disc: "#54401a", chevron: "#6a5122", sheen: "rgba(122,92,36,0.5)" },
};

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
  tone = "navy",
  kicker,
  wrapTitle = false,
  badge,
  action,
  locked = false,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
  a11y?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  marginTop?: number;
  /** Home insets the card from the screen edge; a padded screen doesn't. */
  inset?: boolean;
  /** The card's colour; navy unless the hub asks for another. */
  tone?: RaisedTone;
  /** A small gold label above the title. */
  kicker?: string;
  /**
   * Keep the title at full size and let a long one wrap onto a second line,
   * rather than shrinking it to fit. Home's four buttons use this so all four
   * titles are the same size (Oct 2026).
   */
  wrapTitle?: boolean;
  /** A small red count over the top-right corner ("2 new"). */
  badge?: string;
  /**
   * A gold pill in place of the chevron ("+ Create") — Oct 2026, the
   * Groups & Societies start buttons, so it's plain they make something new.
   */
  action?: string;
  /**
   * Faded, with a padlock for a chevron: Live Scoring while you're in a
   * live round (Oct 2026). Still pressable — the screen says why it's locked.
   */
  locked?: boolean;
}) {
  const t = TONES[tone];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${a11y ?? `${title}. ${subtitle}`}${locked ? " Locked while your round is live." : ""}`}
      style={[styles.outer, { marginTop, marginHorizontal: inset ? spacing.md : 0 }, locked && styles.locked]}
    >
      {({ pressed }) => (
        <View style={[styles.lip, pressed && styles.lipPressed]}>
          <View style={[styles.card, { backgroundColor: t.card }]}>
            {/* Light from above, shade below — a few soft bands each. */}
            <View style={[styles.sheen, { backgroundColor: t.sheen }]} pointerEvents="none" />
            <View style={styles.ring} pointerEvents="none" />
            {[0.12, 0.24, 0.36, 0.48].map((h) => (
              <View key={h} style={[styles.band, { height: `${h * 100}%` }]} pointerEvents="none" />
            ))}
            {[4, 9, 16].map((h) => (
              <View key={h} style={[styles.shade, { height: h }]} pointerEvents="none" />
            ))}
            <View style={styles.topEdge} pointerEvents="none" />

            <View style={[styles.disc, icon ? styles.discIcon : null, { backgroundColor: t.disc }]}>
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
              {kicker ? (
                <Text style={styles.kicker} numberOfLines={1}>
                  {kicker}
                </Text>
              ) : null}
              {wrapTitle ? (
                <Text style={styles.title} numberOfLines={2}>
                  {title}
                </Text>
              ) : (
                <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {title}
                </Text>
              )}
              <Text style={styles.body} numberOfLines={2}>
                {subtitle}
              </Text>
            </View>

            {locked ? (
              <View style={[styles.chevron, { backgroundColor: t.chevron }]}>
                <Ionicons name="lock-closed" size={18} color={colors.gold400} />
              </View>
            ) : action ? (
              <View style={styles.action}>
                <Ionicons name="add" size={16} color={colors.ink900} />
                <Text style={styles.actionText}>{action}</Text>
              </View>
            ) : (
              <View style={[styles.chevron, { backgroundColor: t.chevron }]}>
                <Ionicons name="chevron-forward" size={20} color={colors.gold400} />
              </View>
            )}
          </View>
          {badge ? (
            <View style={styles.badge} pointerEvents="none">
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
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
  locked: { opacity: 0.5 },
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

  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingLeft: 10,
    paddingRight: 13,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: colors.gold400,
    borderBottomWidth: 2,
    borderBottomColor: "#b8913c",
  },
  // ink900 on gold400 — dark text on the gold, never white.
  actionText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  badge: {
    position: "absolute",
    top: -9,
    right: 14,
    backgroundColor: colors.red600,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderWidth: 2,
    borderColor: colors.cream50,
  },
  badgeText: { fontSize: 11, fontWeight: "800", color: "#ffffff" },
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
  kicker: { fontSize: 10.5, fontWeight: "800", letterSpacing: 1.6, color: colors.gold400, textTransform: "uppercase", marginBottom: 2 },
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
