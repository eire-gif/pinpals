import { ImageBackground, StyleSheet, Text, View } from "react-native";

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
 * An earlier cut let it scroll away inside the list on the three screens
 * that had no control strip, to win back its height while you read. That
 * left the app doing two different things on screens that look the same,
 * and it forced those three to keep the navigation bar's own title — so the
 * screen's name appeared twice, once in the bar and once on the
 * photograph. Consistency is worth 130pt. On iOS a large title costs about
 * that much anyway, and this one is a photograph.
 */

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
}: {
  scene: Scene;
  title: string;
  subtitle?: string;
}) {
  return (
    <ImageBackground
      source={SCENES[scene]}
      style={styles.band}
      imageStyle={styles.image}
      // The photograph is decoration. A screen reader announcing "aerial view
      // of a links course" before the heading would be noise, and the heading
      // below already says where you are.
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.body}>
        <View style={styles.rule} />
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
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </ImageBackground>
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
  band: {
    width: "100%",
    aspectRatio: 2.6,
    justifyContent: "flex-end",
    backgroundColor: colors.navy900,
  },
  // navy900 under the photograph, not cream: the bottom of every scene fades
  // to navy, so if a frame lands before the image decodes the band darkens
  // into place instead of flashing pale.
  image: { backgroundColor: colors.navy900 },

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
