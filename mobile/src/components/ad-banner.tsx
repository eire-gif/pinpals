import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useIsFocused } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { adsOf, pickWeighted, type Ad } from "@/lib/ads-rules";
import { adsOn, hideAd, logAdEvent, openAd, useAds, useHiddenAds } from "@/lib/ads";
import { colors, fonts, navyAlpha, radii, spacing } from "@/lib/theme";

/**
 * The slide-up banner (0139): a card that rises from the bottom of a screen
 * (Courses, Marketplace), stays ~8 seconds with a gold bar running down, and
 * slips away. Its X closes it early; tapping it opens the advertiser. Once
 * per screen per app session, so browsing back and forth doesn't keep
 * raising it. Nothing at all when there's no banner advert or ads are off.
 */

const SHOW_MS = 8000;
const shownOn = new Set<string>();

export function AdBanner({ screen, bottom = spacing.sm }: { screen: string; bottom?: number }) {
  const ads = useAds();
  const hidden = useHiddenAds();
  const focused = useIsFocused();
  const ad = useMemo<Ad | null>(() => {
    if (!adsOn() || shownOn.has(screen)) return null;
    return pickWeighted(adsOf(ads, "banner", hidden), Math.random());
    // A fresh pick only when the list itself changes, not on every hide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ads, screen]);

  const [visible, setVisible] = useState(false);
  const rise = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!ad || !focused || shownOn.has(screen)) return;
    shownOn.add(screen);
    setVisible(true);
    logAdEvent(ad.id, "view");
    Animated.timing(rise, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.timing(progress, { toValue: 0, duration: SHOW_MS, easing: Easing.linear, useNativeDriver: false }).start(({ finished }) => {
      if (finished) leave();
    });
    // leave() only touches refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad, focused, screen]);

  function leave() {
    Animated.timing(rise, { toValue: 0, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setVisible(false));
  }

  if (!ad || !visible) return null;
  const wide = ad.imageWideUrl ?? ad.imageUrl;
  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [140, 0] });

  return (
    <Animated.View style={[styles.wrap, { bottom, opacity: rise, transform: [{ translateY }] }]} pointerEvents="box-none">
      <View style={styles.card}>
        <Pressable
          onPress={() => {
            void openAd(ad);
            leave();
          }}
          accessibilityRole="link"
          accessibilityLabel={`Sponsored by ${ad.advertiserName}${ad.headline ? `: ${ad.headline}` : ""}. Opens their website.`}
        >
          {ad.displayStyle === "artwork" ? (
            <View>
              <Image source={{ uri: wide }} style={styles.art} resizeMode="cover" />
              <View style={styles.artPill} pointerEvents="none">
                <Text style={styles.artPillLabel}>SPONSORED</Text>
              </View>
            </View>
          ) : (
            <View style={styles.row}>
              <Image source={{ uri: ad.imageSquareUrl ?? wide }} style={styles.thumb} />
              <View style={styles.text}>
                <Text style={styles.kicker} numberOfLines={1}>
                  SPONSORED · {ad.advertiserName.toUpperCase()}
                </Text>
                <Text style={styles.headline} numberOfLines={2}>
                  {ad.headline ?? ad.advertiserName}
                </Text>
              </View>
              <View style={styles.button}>
                <Text style={styles.buttonLabel} numberOfLines={1}>
                  {ad.buttonText ?? "Open"}
                </Text>
              </View>
            </View>
          )}
        </Pressable>
        <View style={styles.track}>
          <Animated.View style={[styles.bar, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} />
        </View>
        <Pressable
          onPress={() => {
            logAdEvent(ad.id, "dismiss");
            leave();
          }}
          onLongPress={() => {
            void hideAd(ad.id);
            leave();
          }}
          style={styles.close}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close advert"
          accessibilityHint="Press and hold to stop showing this advert"
        >
          <Ionicons name="close" size={16} color={colors.cream50} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: spacing.sm + 2, right: spacing.sm + 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: "hidden",
    shadowColor: colors.navy900,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  art: { width: "100%", aspectRatio: 4, backgroundColor: colors.navy800 },
  artPill: { position: "absolute", left: 8, bottom: 8, backgroundColor: navyAlpha(0.7), borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2 },
  artPillLabel: { fontFamily: fonts.bodyBold, fontSize: 9.5, letterSpacing: 1.3, color: colors.cream50 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2, padding: spacing.sm + 2, paddingRight: 40 },
  thumb: { width: 52, height: 52, borderRadius: radii.md, backgroundColor: colors.cream100 },
  text: { flex: 1, minWidth: 0 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.2, color: colors.gold500 },
  headline: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.ink900, marginTop: 1 },
  button: { backgroundColor: colors.gold400, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 7, maxWidth: 110 },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.navy900 },
  track: { height: 3, backgroundColor: colors.cream100 },
  bar: { height: 3, backgroundColor: colors.gold500 },
  close: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: navyAlpha(0.65),
    alignItems: "center",
    justifyContent: "center",
  },
});
