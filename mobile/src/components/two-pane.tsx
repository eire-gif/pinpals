import type { ReactNode } from "react";
import { View } from "react-native";

import { spacing } from "@/lib/theme";

/**
 * Two columns side by side on a wide screen (an iPad on its side), or the
 * same blocks one after the other everywhere else — `left` first, or `right`
 * first with stackRightFirst — in the order a phone always showed them. See useWideLayout() in lib/content-width.
 */
export function TwoPane({ wide, left, right, leftFlex = 1.15, gap = spacing.lg, inner = spacing.sm, stackRightFirst = false }: { wide: boolean; left: ReactNode; right: ReactNode; leftFlex?: number; gap?: number; inner?: number; stackRightFirst?: boolean }) {
  if (!wide) {
    return (
      <>
        {stackRightFirst ? right : left}
        {stackRightFirst ? left : right}
      </>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap }}>
      <View style={{ flex: leftFlex, minWidth: 0, gap: inner }}>{left}</View>
      <View style={{ flex: 1, minWidth: 0, gap: inner }}>{right}</View>
    </View>
  );
}
