import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import type { Ad } from "@/lib/ads-rules";
import { adsOn, loadCoursePartner, logAdEvent, openAd } from "@/lib/ads";
import { colors, creamAlpha, fonts, radii, spacing } from "@/lib/theme";

/**
 * Course partners (0139): a business sponsoring a course's page and its hole
 * maps. useCoursePartner() is null while loading, on error, with no partner
 * or with ads off — and every piece here then renders nothing.
 */
export function useCoursePartner(clubId: number): Ad | null {
  const [ad, setAd] = useState<Ad | null>(null);
  useEffect(() => {
    if (!adsOn() || !Number.isFinite(clubId)) return;
    let live = true;
    void loadCoursePartner(clubId).then((a) => {
      if (live) setAd(a);
    });
    return () => {
      live = false;
    };
  }, [clubId]);
  return ad;
}

/** The strip under the course page's title. */
export function CoursePartnerStrip({ ad, style }: { ad: Ad | null; style?: StyleProp<ViewStyle> }) {
  useEffect(() => {
    if (ad) logAdEvent(ad.id, "view");
  }, [ad]);
  if (!ad) return null;
  return (
    <Pressable
      onPress={() => void openAd(ad)}
      style={({ pressed }) => [styles.strip, style, pressed && styles.pressed]}
      accessibilityRole="link"
      accessibilityLabel={`Course partner: ${ad.advertiserName}. Opens their website.`}
    >
      {ad.imageWideUrl && ad.displayStyle === "artwork" ? (
        <Image source={{ uri: ad.imageWideUrl }} style={styles.wide} resizeMode="cover" />
      ) : (
        <>
          <Image source={{ uri: ad.imageUrl }} style={styles.logo} resizeMode="contain" />
          <View style={styles.text}>
            <Text style={styles.kicker}>COURSE PARTNER</Text>
            <Text style={styles.name} numberOfLines={1}>
              {ad.advertiserName}
            </Text>
            {ad.displayStyle === "photo_headline" && ad.headline ? (
              <Text style={styles.line} numberOfLines={1}>
                {ad.headline}
              </Text>
            ) : null}
          </View>
          <Ionicons name="open-outline" size={16} color={colors.ink500} />
        </>
      )}
    </Pressable>
  );
}

/**
 * "Yardages brought to you by …" on the hole map. Sits in the map's bottom
 * sheet, in the flow under the numbers — it never covers the map or a
 * yardage.
 */
export function YardagesSponsor({ ad }: { ad: Ad | null }) {
  useEffect(() => {
    if (ad) logAdEvent(ad.id, "view");
  }, [ad]);
  if (!ad) return null;
  return (
    <Pressable
      onPress={() => void openAd(ad)}
      style={styles.pill}
      hitSlop={6}
      accessibilityRole="link"
      accessibilityLabel={`Yardages brought to you by ${ad.advertiserName}. Opens their website.`}
    >
      <Text style={styles.pillText} numberOfLines={1}>
        Yardages brought to you by <Text style={styles.pillName}>{ad.advertiserName}</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.sm + 2,
    minHeight: 56,
    overflow: "hidden",
  },
  pressed: { opacity: 0.85 },
  wide: { flex: 1, aspectRatio: 4, borderRadius: radii.md, marginVertical: -2 },
  logo: { width: 44, height: 44, borderRadius: radii.sm, backgroundColor: colors.cream50 },
  text: { flex: 1, minWidth: 0 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.3, color: colors.gold500 },
  name: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  line: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  pill: { alignSelf: "center", minHeight: 28, justifyContent: "center", paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: creamAlpha(0.1) },
  pillText: { fontFamily: fonts.body, fontSize: 11.5, color: creamAlpha(0.75) },
  pillName: { fontFamily: fonts.bodyBold, color: colors.cream50 },
});
