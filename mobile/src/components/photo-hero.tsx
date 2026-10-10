import type { ReactNode } from "react";
import { Animated, Image, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts, spacing } from "@/lib/theme";

/**
 * The Tee Times look, for any screen (Oct 2026): a full-bleed photograph
 * behind the status bar and a see-through navigation bar, the title on it,
 * and whatever `children` is (a control bar, a profile card) overlapping its
 * bottom edge. With `scrollY` from useCollapsingHeader() it shrinks to a
 * title strip as the list scrolls.
 *
 * The screen sets its navigation bar transparent (headerTransparent) so the
 * photograph runs up behind it; this component leaves room for the bar.
 */
export const HERO_NAV_BAR = 44;

export function PhotoHero({
  source,
  title,
  subtitle,
  scrollY,
  overlap = 28,
  titleBlock = 92,
  extra = 0,
  children,
  topRight,
}: {
  source: ImageSourcePropType;
  title: string;
  subtitle?: string;
  scrollY?: Animated.Value;
  /** How far `children` reaches up into the photograph. */
  overlap?: number;
  /** Room for the title and subtitle. */
  titleBlock?: number;
  /** More photograph above the title (a profile shows more of its cover). */
  extra?: number;
  children?: ReactNode;
  /** Drawn over the photograph's top-right corner, under the nav bar. */
  topRight?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const top = insets.top + HERO_NAV_BAR;
  const expanded = top + extra + titleBlock + overlap;
  const collapsed = top + 56 + overlap;
  const travel = expanded - collapsed;
  const height = scrollY
    ? scrollY.interpolate({ inputRange: [0, travel], outputRange: [expanded, collapsed], extrapolate: "clamp" })
    : expanded;
  const fade = scrollY ? scrollY.interpolate({ inputRange: [0, travel * 0.6], outputRange: [1, 0], extrapolate: "clamp" }) : 1;
  const drop = scrollY ? scrollY.interpolate({ inputRange: [0, travel], outputRange: [0, 30], extrapolate: "clamp" }) : 0;

  return (
    <>
      <Animated.View style={[styles.hero, { height }]}>
        <Image source={source} style={[styles.image, { height: expanded + 40 }]} resizeMode="cover" />
        {/* A darker foot under the title: covers are members' own photos,
            and a bright one would swallow white text. */}
        <View style={styles.shade} pointerEvents="none" />
        <Animated.View style={[styles.text, { paddingBottom: overlap + 14, transform: [{ translateY: drop }] }]}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Animated.Text style={[styles.sub, { opacity: fade }]} numberOfLines={1}>
              {subtitle}
            </Animated.Text>
          ) : null}
        </Animated.View>
        {topRight ? <View style={[styles.topRight, { top: top + 6 }]}>{topRight}</View> : null}
      </Animated.View>
      {children ? <View style={{ marginTop: -overlap }}>{children}</View> : null}
    </>
  );
}

const styles = StyleSheet.create({
  hero: { width: "100%", overflow: "hidden", justifyContent: "flex-end", backgroundColor: colors.navy900 },
  image: { position: "absolute", left: 0, right: 0, bottom: 0, width: "100%" },
  shade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "55%", backgroundColor: "rgba(12,32,56,0.28)" },
  text: { paddingHorizontal: spacing.lg },
  title: {
    fontFamily: fonts.display,
    fontSize: 36,
    lineHeight: 42,
    color: "#ffffff",
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 16.5,
    color: "rgba(255,255,255,0.95)",
    marginTop: 2,
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  topRight: { position: "absolute", right: spacing.md },
});
