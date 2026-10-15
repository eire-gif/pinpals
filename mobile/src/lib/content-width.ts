import { Dimensions, useWindowDimensions } from "react-native";

import { MAX_CONTENT_WIDTH, colors } from "./theme";

/**
 * The width a screen's content actually has (Oct 2026, iPad): the window on a
 * phone, the centred column (MAX_CONTENT_WIDTH) on an iPad. Use it instead of
 * useWindowDimensions() for anything laid out inside a screen — photo
 * widths, grids, chips — or an iPad draws them wider than the column and they
 * spill off its edges. Full-screen overlays (the photo viewer, the reaction
 * picker, the menu drawer) still measure the window.
 */
export function useContentWidth(): { width: number; height: number } {
  const { width, height } = useWindowDimensions();
  return { width: Math.min(width, MAX_CONTENT_WIDTH), height };
}

/** The same, read once — for sizes worked out when a file loads. */
export function contentWidthNow(): number {
  return Math.min(Dimensions.get("window").width, MAX_CONTENT_WIDTH);
}

/**
 * iPad side by side (Oct 2026, stage 2). A few screens an organiser works
 * from — the society page, an event, the day's leaderboard — show two
 * columns when there's room: an iPad on its side, or two-thirds of one in
 * Split View. Below that (every phone, an iPad upright) they're the usual
 * single column. These screens take the full width from the navigator
 * (FULL_WIDTH_CONTENT) and centre themselves with pageColumn().
 */
export const WIDE_MIN_WIDTH = 900;
export const WIDE_MAX_WIDTH = 1240;

export function useWideLayout(): boolean {
  return useWindowDimensions().width >= WIDE_MIN_WIDTH;
}

/** A screen's own centred column: the usual width, or wider for two columns. */
export function pageColumn(wide: boolean) {
  return { width: "100%", maxWidth: wide ? WIDE_MAX_WIDTH : MAX_CONTENT_WIDTH, alignSelf: "center" } as const;
}

/** contentStyle for a screen that lays itself out (pageColumn) instead of the navigator's column. */
export const FULL_WIDTH_CONTENT = { backgroundColor: colors.cream50 } as const;
