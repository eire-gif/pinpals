import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Team } from "@/lib/trip-cup-rules";
import { colors, fonts, radii, type } from "@/lib/theme";

/** Ryder Cup mode (0200): each team's colours — navy and gold, as on the canvas. */
export const TEAM_INK: Record<Team, { bg: string; fg: string; panel: string }> = {
  1: { bg: colors.cream50, fg: colors.navy900, panel: colors.navy900 },
  2: { bg: colors.gold400, fg: colors.ink900, panel: colors.gold400 },
};

/** A row of choices, one picked. */
export function Segments({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.segments}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} style={[styles.segment, on && styles.segmentOn]} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segments: { flexDirection: "row", backgroundColor: colors.cream100, borderRadius: radii.md, padding: 4, gap: 4 },
  segment: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 9, paddingHorizontal: 6 },
  segmentOn: { backgroundColor: colors.surface },
  segmentText: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  segmentTextOn: { fontFamily: fonts.bodyBold, color: colors.ink900 },
});
