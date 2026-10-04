import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import type { Achievement } from "@/lib/achievements";
import { colors, creamAlpha, fonts, navyAlpha, radii, spacing } from "@/lib/theme";

/**
 * An achievement, presented (Oct 2026 feed redesign, phase 8) — the
 * mockup's "Personal Best" card, for every achievement.
 *
 * Driven entirely by the `Achievement` structure from achievements.ts, so a
 * Hole in One, an Eagle, a Personal Best and Broke 70/80/90/100 are the same
 * component with different words — no screen per achievement. Used in the
 * feed card (in place of the photo strip) and as the composer's preview.
 *
 * The look: a photograph under a navy veil (the member's own photo if the
 * post has one, else the course's), a gold medallion, the title in gold
 * small caps, the score in Playfair at full size, the course, and up to
 * three supporting numbers on frosted tiles — the share card's grammar at
 * phone size. Gold is used as an accent on navy only, where it reads.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabel(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

export function AchievementCard({
  achievement,
  photo,
  width,
  photoCount = 0,
  onPress,
}: {
  achievement: Achievement;
  photo: ImageSourcePropType;
  width: number;
  /** How many photos the post has; shown as a pill when tapping opens them. */
  photoCount?: number;
  onPress?: () => void;
}) {
  const a = achievement;
  const holeLed = a.achievementType === "hole_in_one" || a.achievementType === "eagle";
  // A hole leads with the hole; a round with its score.
  // "78 (+6)" is set as a big 78 with +6 in gold beside it, like Hole 4 · Ace.
  const split = !holeLed && a.score ? /^(\d+) \((.+)\)$/.exec(a.score) : null;
  const hero = holeLed && a.hole !== null ? `Hole ${a.hole}` : (split?.[1] ?? a.score ?? a.achievementTitle);
  const heroSide = holeLed ? a.score : (split?.[2] ?? null);
  const meta = [a.course, holeLed && a.distance !== null ? `${a.distance} yds` : null, holeLed ? a.club : null, dayLabel(a.date)]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <View style={[styles.card, { width, minHeight: Math.round(width * 0.82) }]}>
      <Image source={photo} style={styles.photo} resizeMode="cover" accessibilityIgnoresInvertColors />
      <View style={styles.veil} />
      <View style={styles.veilBottom} />

      <View style={styles.content}>
        <View style={styles.medal} accessibilityElementsHidden>
          <Ionicons name={a.icon as keyof typeof Ionicons.glyphMap} size={22} color={colors.navy900} />
        </View>
        <Text style={styles.kicker}>{a.achievementTitle.toUpperCase()}</Text>
        <View style={styles.heroRow}>
          <Text style={[styles.hero, hero.length > 8 && styles.heroLong]} adjustsFontSizeToFit numberOfLines={1}>
            {hero}
          </Text>
          {heroSide ? <Text style={styles.heroSide}>{heroSide}</Text> : null}
        </View>
        {meta ? (
          <Text style={styles.meta} numberOfLines={2}>
            {meta}
          </Text>
        ) : null}
        <Text style={styles.tagline}>{a.tagline}</Text>

        {a.stats.length > 0 && (
          <View style={styles.stats}>
            {a.stats.map((s) => (
              <View key={s.label} style={styles.stat}>
                <Text style={styles.statValue} numberOfLines={1}>
                  {s.value}
                </Text>
                <Text style={styles.statLabel}>{s.label.toUpperCase()}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {photoCount > 0 && onPress ? (
        <View style={styles.photosPill} pointerEvents="none">
          <Ionicons name="images" size={12} color={colors.cream50} />
          <Text style={styles.photosPillText}>{photoCount}</Text>
        </View>
      ) : null}
    </View>
  );

  const label = `${a.achievementTitle}. ${hero}${heroSide ? `, ${heroSide}` : ""}${meta ? `. ${meta}` : ""}`;
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="imagebutton" accessibilityLabel={`${label}. Open photos`}>
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={label}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.md, overflow: "hidden", backgroundColor: colors.navy900, justifyContent: "center" },
  photo: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  // Two flat veils rather than a gradient (a gradient is a native module and
  // this ships over the air): an even navy, and more of it at the bottom
  // where the tiles sit.
  veil: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: navyAlpha(0.62) },
  veilBottom: { position: "absolute", left: 0, right: 0, bottom: 0, height: "38%", backgroundColor: navyAlpha(0.28) },
  content: { alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.lg },
  medal: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.gold400,
    borderWidth: 3,
    borderColor: creamAlpha(0.9),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm + 2,
  },
  kicker: { fontFamily: fonts.bodySemi, fontSize: 13, letterSpacing: 3, color: colors.gold400 },
  heroRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: 2, maxWidth: "100%" },
  hero: { fontFamily: fonts.display, fontSize: 58, lineHeight: 66, color: colors.cream50 },
  heroLong: { fontSize: 46, lineHeight: 54 },
  heroSide: { fontFamily: fonts.display, fontSize: 26, color: colors.gold400, marginBottom: 10 },
  meta: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.cream50, textAlign: "center", marginTop: 2 },
  tagline: { fontFamily: fonts.body, fontSize: 13, color: creamAlpha(0.8), marginTop: 4, textAlign: "center" },
  stats: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, alignSelf: "stretch", justifyContent: "center" },
  stat: {
    flex: 1,
    maxWidth: 110,
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: creamAlpha(0.12),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: creamAlpha(0.35),
  },
  statValue: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50 },
  statLabel: { fontFamily: fonts.bodySemi, fontSize: 10, letterSpacing: 1.2, color: colors.gold400, marginTop: 2 },
  photosPill: {
    position: "absolute",
    top: spacing.sm + 2,
    right: spacing.sm + 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: navyAlpha(0.7),
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  photosPillText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.cream50 },
});
