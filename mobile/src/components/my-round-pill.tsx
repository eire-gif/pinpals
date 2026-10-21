import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { router, usePathname } from "expo-router";

import { useMyRound } from "@/lib/my-round";
import { myRoundLabel, onMyRoundScreen } from "@/lib/my-round-rules";
import { colors, fonts, radii } from "@/lib/theme";

/**
 * MY ROUND (Oct 2026): "when a live tournament is on it's hard to find where
 * it is on the app". A green pill in the header of every screen while a round
 * you're PLAYING in is live; one tap from anywhere back to your scoring.
 *
 * The pulse is deliberately gentle — "flashes green, not too much": every
 * ~2.4s the green lifts a shade and a soft halo breathes out and fades. No
 * hard on/off. With Reduce Motion on, it stays a solid pill.
 *
 * On that round's own scoring screen it goes still and outlined: you're
 * already there. Not in a live round: it draws nothing at all.
 *
 * `compact` on a busy bar (a screen with its own right-hand buttons): the
 * hole alone, "● H7".
 */

const GREEN = "#128043"; // resting: 5:1 with the white label
const GREEN_LIFT = "#1a9e52"; // the top of each breath
const HALO = "#3ddc78";
const MINT = "#7fe3a6"; // still, outlined, on a dark bar
const PERIOD = 2400;

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

export function MyRoundPill({ onDark = false, compact = false }: { onDark?: boolean; compact?: boolean }) {
  const round = useMyRound();
  const pathname = usePathname();
  const reduce = useReduceMotion();
  const here = !!round && onMyRoundScreen(pathname, round.id);
  const pulsing = !!round && !here && !reduce;

  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!pulsing) {
      t.stopAnimation();
      t.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: PERIOD, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [pulsing, t]);

  if (!round) return null;
  const { text, detail } = myRoundLabel(round, compact);
  const a11y = here
    ? `My round, hole ${round.hole}. You're on your scoring screen.`
    : `My round is live, hole ${round.hole}. Open your scoring.`;

  // One breath per period: lift to 50%, settle by 100%. The halo grows and
  // fades over the first 70%, then rests.
  const lift = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 0] });
  // Wider than tall, so the halo is an even ~6pt ring round a long pill.
  const haloX = t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1.1, 1.1] });
  const haloY = t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1.35, 1.35] });
  const haloOpacity = t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.5, 0, 0] });
  const dot = t.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [1, 0.35, 1, 0.35, 1] });

  const ink = here ? (onDark ? MINT : colors.green700) : colors.cream50;

  return (
    <Pressable
      onPress={() => {
        if (!here) router.push({ pathname: "/live/round/[id]", params: { id: String(round.id) } });
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: here }}
      style={({ pressed }) => [styles.hit, pressed && !here && styles.pressed]}
    >
      <View style={styles.wrap}>
        {pulsing ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.halo, { opacity: haloOpacity, transform: [{ scaleX: haloX }, { scaleY: haloY }] }]}
          />
        ) : null}
        <View
          style={[
            styles.pill,
            compact && styles.pillCompact,
            here
              ? [styles.still, { borderColor: onDark ? MINT : colors.green700 }]
              : [styles.live, { borderColor: onDark ? "rgba(247,243,234,0.6)" : "rgba(247,243,234,0.0)" }],
          ]}
        >
          {pulsing ? <Animated.View pointerEvents="none" style={[styles.lift, { opacity: lift }]} /> : null}
          <Animated.View style={[styles.dot, { backgroundColor: ink, opacity: pulsing ? dot : 1 }]} />
          <Text style={[styles.label, compact && styles.labelCompact, { color: ink }]} numberOfLines={1}>
            {text}
            {detail ? <Text style={styles.detail}>{` · ${detail}`}</Text> : null}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * A header's right side with MY ROUND in front of it: the pill, then the
 * screen's own buttons. With buttons of its own beside it the pill goes
 * compact ("● H7") so both fit. Draws just the screen's buttons when there's
 * no live round.
 */
export function MyRoundRow({ right, onDark = false }: { right?: ReactNode; onDark?: boolean }) {
  const own = right ?? null;
  return (
    <View style={styles.row}>
      <MyRoundPill onDark={onDark} compact={own != null} />
      {own}
    </View>
  );
}

/**
 * For a native-stack screen's options, in place of a bare `headerRight`, so
 * the pill is on every header:
 *
 *   options={{ ...myRoundRight(() => <ShareButton />) }}
 *
 * iOS 26 puts a bare header item in its own round glass bubble, which clips a
 * pill (see header-actions.tsx) — so on iOS the row also goes in as a custom
 * item with that background hidden, as headerButtons() does. The stacks set
 * this as their default, which is why a screen with its own right-hand
 * buttons must come through here (or noMyRound) too: on iOS the default's
 * custom item would otherwise win over a bare headerRight.
 */
type RightOptions = {
  headerRight: () => ReactElement;
  unstable_headerRightItems: (() => { type: "custom"; element: ReactElement; hidesSharedBackground: boolean }[]) | undefined;
};

export function myRoundRight(right?: (() => ReactNode) | null, { onDark = false }: { onDark?: boolean } = {}): RightOptions {
  const row = () => <MyRoundRow right={right ? right() : undefined} onDark={onDark} />;
  return {
    headerRight: row,
    unstable_headerRightItems:
      Platform.OS === "ios" ? () => [{ type: "custom", element: row(), hidesSharedBackground: true }] : undefined,
  };
}

/**
 * Sheets (comments, share, reactions): their own Close or Share and no pill —
 * a sheet is closed with one tap, and the screen under it carries the pill.
 * Clears the stack's default custom item so iOS shows `right` as before.
 */
export function noMyRound(right: () => ReactElement): RightOptions {
  return { headerRight: right, unstable_headerRightItems: undefined };
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  hit: { minHeight: 44, justifyContent: "center" },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  wrap: { justifyContent: "center" },
  halo: {
    ...StyleSheet.absoluteFill,
    borderRadius: radii.pill,
    backgroundColor: HALO,
  },
  pill: {
    height: 36,
    paddingLeft: 11,
    paddingRight: 13,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    overflow: "hidden",
  },
  pillCompact: { paddingLeft: 10, paddingRight: 11, gap: 6 },
  live: {
    backgroundColor: GREEN,
    shadowColor: "#0c2038",
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  still: { backgroundColor: "transparent" },
  lift: { ...StyleSheet.absoluteFill, backgroundColor: GREEN_LIFT },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontFamily: fonts.bodyBold, fontSize: 14, letterSpacing: 0.8 },
  labelCompact: { fontSize: 14, letterSpacing: 0.4 },
  detail: { fontFamily: fonts.bodySemi, letterSpacing: 0.4, opacity: 0.9 },
});
