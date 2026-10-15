import { Dimensions, useWindowDimensions } from "react-native";

import { MAX_CONTENT_WIDTH } from "./theme";

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
