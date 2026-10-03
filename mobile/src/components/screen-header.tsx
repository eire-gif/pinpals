import { useCallback, useMemo, useRef, useState } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";

import { colors, fonts, spacing, type } from "@/lib/theme";

/**
 * A photograph at the top of a screen, with the screen's name on it.
 *
 * Home already carries the website's hero; this is the same idea at a
 * quarter the height for everywhere else, so moving through the app feels
 * like moving through one place rather than through a settings menu.
 *
 * THE SCRIM IS IN THE JPEG, not here. Nothing on this component darkens the
 * photograph — every file in assets/images/scenes already fades to navy
 * across its bottom half. That is deliberate and is explained at length in
 * tools/prep-scene-images.py; the short version is that a real gradient in
 * React Native means expo-linear-gradient, which is a native module, which
 * means a new TestFlight build instead of an over-the-air update. Baking it
 * in also means the contrast under the title is a measured property of a
 * file we ship rather than a guess about what the photograph is doing
 * underneath the text. tools/check-scene-contrast.py measures it: the worst
 * pixel any title can land on is 6.7:1, against 4.5:1 for WCAG AA.
 *
 * So: if you add a photograph, add it through the script. Dropping a raw
 * JPEG in that folder will look fine on the dark ones and be unreadable on
 * a bright sky.
 *
 * WHERE TO PUT IT. Directly under the navigation bar, above any search box
 * or filter chips, and OUTSIDE the list. Pinned rather than scrolling, and
 * the screen sets `headerTitle: ""` so the name is not printed twice.
 *
 * HEIGHT. A fixed 104pt band, not the full photograph — the full 2.6:1
 * frame came to 122–165pt and members said it took too much of the screen.
 * The photograph is laid at its own 2.6:1 ratio and pinned to the BOTTOM of
 * the band, so the band crops the sky off the top and never the navy fade
 * off the bottom. The title therefore sits on exactly the same part of the
 * JPEG it always did, and tools/check-scene-contrast.py still describes
 * what is on screen.
 *
 * COLLAPSING. Pass the `scrollY` from useCollapsingHeader() and wire its
 * `onScroll` to the list below, and the band shrinks to a 52pt strip as the
 * member scrolls: the subtitle slides out of the bottom, the title drops
 * into its place, the rule fades. Scrolling back to the top restores it.
 * Without `scrollY` the band simply stays at 104pt.
 *
 * Shrinking rather than scrolling away: the band stays outside the list, so
 * a search box or filter strip under it (Marketplace) moves up with it and
 * stays in reach, and the screen's name never leaves the screen.
 */

/** Full band, and the strip it collapses to. */
export const HEADER_EXPANDED = 104;
export const HEADER_COLLAPSED = 52;
const TRAVEL = HEADER_EXPANDED - HEADER_COLLAPSED;
/** How far the text block drops as it collapses: the subtitle's line and
 *  the gap above it, so the title lands where the subtitle was. */
const SUBTITLE_DROP = 18 + 3;

/**
 * The scroll position a collapsing band reads, and the handler that feeds
 * it. Spread `scrollProps` onto the FlatList / ScrollView under the band.
 *
 * Not the native driver: it cannot animate `height`, and a band that only
 * translated would leave a gap above the list. Height on the JS thread is
 * comfortably smooth for a band this small.
 */
export function useCollapsingHeader() {
  const scrollY = useRef(new Animated.Value(0)).current;

  // Only collapse when the list is long enough to stay scrollable once the
  // band has given its height back. On a list that only just overflows,
  // collapsing grows the list's viewport, which takes away the scroll that
  // caused the collapse, which re-opens the band — a flicker loop. So the
  // band stays put unless there is clearly room to spare.
  const [canCollapse, setCanCollapse] = useState(false);
  const sizes = useRef({ content: 0, viewport: 0 });
  const decide = useCallback(() => {
    const { content, viewport } = sizes.current;
    const roomy = viewport > 0 && content - viewport > TRAVEL * 2;
    setCanCollapse(roomy);
    if (!roomy) scrollY.setValue(0);
  }, [scrollY]);

  const scrollProps = useMemo(
    () => ({
      onScroll: Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: false,
      }),
      scrollEventThrottle: 16,
      onContentSizeChange: (_w: number, h: number) => {
        sizes.current.content = h;
        decide();
      },
      // The largest viewport seen is the one with the band collapsed, which
      // is the one that matters for "still scrollable afterwards".
      onLayout: (e: { nativeEvent: { layout: { height: number } } }) => {
        sizes.current.viewport = Math.max(sizes.current.viewport, e.nativeEvent.layout.height);
        decide();
      },
    }),
    [scrollY, decide]
  );
  return { scrollY: canCollapse ? scrollY : undefined, resetY: scrollY, scrollProps };
}

/**
 * Bundled rather than fetched from pinpals.ie, which is how Home's hero
 * works. The hero is one large image that should change when the homepage
 * changes; these are eight small ones that shouldn't, and a header band that
 * arrives a beat after the screen does draws the eye to exactly the wrong
 * thing. Bundled assets ship with `eas update` — only native dependencies
 * force a new build — so these still reach members over the air.
 *
 * require() takes a literal path, so this map cannot be built from a string
 * at runtime. That is the constraint, not a style choice.
 */
const SCENES = {
  ballybunion: require("../../assets/images/scenes/ballybunion.jpg"),
  coastAerial: require("../../assets/images/scenes/coast-aerial.jpg"),
  dunesGold: require("../../assets/images/scenes/dunes-gold.jpg"),
  lakeSunset: require("../../assets/images/scenes/lake-sunset.jpg"),
  linksDusk: require("../../assets/images/scenes/links-dusk.jpg"),
  linksSunset: require("../../assets/images/scenes/links-sunset.jpg"),
  oldHead: require("../../assets/images/scenes/old-head.jpg"),
  parkland: require("../../assets/images/scenes/parkland.jpg"),
} as const;

export type Scene = keyof typeof SCENES;

export function ScreenHeader({
  scene,
  title,
  subtitle,
  scrollY,
}: {
  scene: Scene;
  title: string;
  subtitle?: string;
  /** From useCollapsingHeader(). Omit for a band that never collapses. */
  scrollY?: Animated.Value;
}) {
  const range = { inputRange: [0, TRAVEL], extrapolate: "clamp" as const };
  const height = scrollY
    ? scrollY.interpolate({ ...range, outputRange: [HEADER_EXPANDED, HEADER_COLLAPSED] })
    : HEADER_EXPANDED;
  const drop = scrollY
    ? scrollY.interpolate({ ...range, outputRange: [0, subtitle ? SUBTITLE_DROP : 0] })
    : 0;
  const fade = scrollY
    ? scrollY.interpolate({ inputRange: [0, TRAVEL * 0.6], outputRange: [1, 0], extrapolate: "clamp" })
    : 1;

  return (
    <Animated.View
      style={[styles.band, { height }]}
      // The photograph is decoration. A screen reader announcing "aerial view
      // of a links course" before the heading would be noise, and the heading
      // below already says where you are.
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Image source={SCENES[scene]} style={styles.image} />
      <Animated.View style={[styles.body, { transform: [{ translateY: drop }] }]}>
        <Animated.View style={[styles.rule, { opacity: fade }]} />
        {/* One line, always. Two would push the top of the text up onto the
            part of the photograph the scrim has not reached yet, and the
            contrast figures in tools/check-scene-contrast.py are measured
            for a block of exactly this height. Keep titles to two or three
            words; the navigation bar is blank on these screens, so there is
            nothing else competing for the room. */}
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Animated.Text style={[styles.subtitle, { opacity: fade }]} numberOfLines={1}>
            {subtitle}
          </Animated.Text>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // aspectRatio, NOT a fixed height, and it must stay in step with the 2.6:1
  // the images are cut to (tools/prep-scene-images.py). A fixed height would
  // crop the photograph vertically by a different amount on every screen
  // width, which would slide the baked-in scrim up or down behind the title
  // — and the contrast figures that justify cream text on a photograph are
  // measured as fractions of the JPEG's height. Matching the ratio is what
  // makes those fractions mean the same thing on a phone.
  //
  // It works out at about 122pt on the narrowest iPhone and 165pt on the
  // widest: two list rows' worth, which is what a header is worth.
  //
  // The band itself is now a fixed (or collapsing) height that crops the
  // TOP of that frame — see the note at the top of the file. The image
  // keeps aspectRatio 2.6 and is pinned to the bottom, which is the part
  // of this rule that matters.
  band: {
    width: "100%",
    overflow: "hidden",
    justifyContent: "flex-end",
    backgroundColor: colors.navy900,
  },
  // navy900 under the photograph, not cream: the bottom of every scene fades
  // to navy, so if a frame lands before the image decodes the band darkens
  // into place instead of flashing pale.
  image: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    aspectRatio: 2.6,
    backgroundColor: colors.navy900,
  },

  // The whole block is measured, not eyeballed: rule 2 + 4, title 29,
  // gap 3, subtitle 18, inset 12 comes to 68pt, which on the narrowest
  // iPhone starts 44% up a 122pt band. tools/check-scene-contrast.py
  // measures from 42% down, so there is a little slack above the rule and
  // none of the text can drift off the scrim. Grow any of these and run it
  // again.
  body: {
    paddingHorizontal: spacing.md,
    paddingBottom: 12,
    gap: 3,
  },

  // The gold rule from the website's hero, at the width of a short word. It
  // is decoration rather than text, which is just as well — gold on this
  // scrim is 4.5:1, fine for a rule and too close to the line for a label.
  rule: {
    width: 34,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.gold400,
    marginBottom: 4,
  },

  title: {
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 29,
    color: colors.cream50,
  },
  // cream100 at full opacity rather than cream50 at 85%: the two read almost
  // identically against navy, and a solid colour is a contrast figure that
  // can be measured rather than one that depends on what is behind it.
  subtitle: {
    fontFamily: fonts.body,
    fontSize: type.small,
    lineHeight: 18,
    color: colors.cream100,
  },
});
