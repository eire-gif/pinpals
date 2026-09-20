/**
 * The website's palette, lifted verbatim from src/app/globals.css so the app
 * and the site are visibly one product. Keep these in sync by hand — a shared
 * package for six colours would cost more than it saves.
 */
export const colors = {
  cream50: "#f7f3ea",
  cream100: "#efe7d6",
  navy900: "#0c2038",
  navy800: "#123058",
  green800: "#173f22",
  green700: "#1f5c2e",
  green600: "#2c7a3d",
  green100: "#e2ede1",
  gold400: "#e8c46b",
  gold500: "#d3a53f",
  // The marketplace accent. ALWAYS paired with ink900 text, never white:
  // white on buy500 is 1.99:1, nowhere near WCAG AA. ink900 is 9.22:1.
  buy500: "#ffa41c",
  buy600: "#fa8900",
  buy700: "#e07d00",
  red600: "#a83a2b",
  red100: "#f6e3de",
  ink900: "#0e1520",
  ink500: "#647082",
  line: "#ddd2b8",
  surface: "#ffffff",
  surfaceTint: "#fbf8f1",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * 16px is a floor, not a preference: iOS zooms the whole page when a control
 * below 16px takes focus. The same trap is already logged against the website
 * in claude/mobile-form-fields-and-select-rendering.md.
 */
export const type = {
  body: 16,
  small: 14,
  label: 13.5,
  title: 22,
  heading: 18,
} as const;

/**
 * The website's two faces, from src/app/globals.css: Playfair Display for
 * display type, Public Sans for everything else. Until now the app used the
 * iOS system font at heavy weights, which looks fine and looks like nothing
 * in particular — this pairing is most of what makes pinpals.ie recognisable.
 *
 * THE ONE THING TO REMEMBER: `fontWeight` is ignored once `fontFamily` is
 * set. @expo-google-fonts registers every weight as its OWN family, so a
 * style saying `fontFamily: fonts.body, fontWeight: "700"` renders regular
 * and looks like a bug in the layout rather than in the style. Pick the
 * family, never the weight. Same for italic — displayItalic is a separate
 * family, not `fontStyle` on display.
 */
export const fonts = {
  display: "PlayfairDisplay_700Bold",
  displayItalic: "PlayfairDisplay_700Bold_Italic",
  body: "PublicSans_400Regular",
  bodySemi: "PublicSans_600SemiBold",
  bodyBold: "PublicSans_700Bold",
} as const;
