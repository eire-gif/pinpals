import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { colors, fonts } from "@/lib/theme";

/**
 * Course ratings, drawn the same way everywhere they appear.
 *
 * STARS_GOLD is darker than the site's gold-400: stars sit on white and on
 * cream, and gold-400 on cream is 1.6:1 — a row of stars nobody can count.
 * This one is decoration-plus-number (the figure always sits beside it), so
 * 3:1 is the bar and it clears it.
 */
export const STARS_GOLD = "#b5841a";
const EMPTY = "#d7cdb5";

/** "★★★★☆ 4.6 (18)" — or nothing, for a course nobody has rated yet. */
export function RatingLine({
  avg,
  count,
  size = 13,
  showCount = true,
}: {
  avg?: number | null;
  count?: number;
  size?: number;
  showCount?: boolean;
}) {
  if (!count || avg === null || avg === undefined) return null;
  const value = Number(avg);
  return (
    <View style={styles.line} accessible accessibilityLabel={`Rated ${value.toFixed(1)} out of 5 from ${count} ${count === 1 ? "rating" : "ratings"}`}>
      <StarRow value={value} size={size} />
      <Text style={[styles.figure, { fontSize: size }]}>
        {value.toFixed(1)}
        {showCount ? <Text style={styles.count}> ({count})</Text> : null}
      </Text>
    </View>
  );
}

/** Five static stars, half-stars rounded to the nearest half. */
export function StarRow({ value, size = 14 }: { value: number; size?: number }) {
  const halves = Math.round(value * 2);
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((n) => {
        const name = halves >= n * 2 ? "star" : halves === n * 2 - 1 ? "star-half" : "star";
        const color = halves >= n * 2 - 1 ? STARS_GOLD : EMPTY;
        return <Ionicons key={n} name={name} size={size} color={color} />;
      })}
    </View>
  );
}

/** Five tappable stars. Each is a 44pt target even when drawn smaller. */
export function StarPicker({
  value,
  onChange,
  size = 26,
}: {
  value: number;
  onChange: (n: number) => void;
  size?: number;
}) {
  return (
    <View style={styles.row} accessibilityRole="adjustable" accessibilityValue={{ min: 0, max: 5, now: value }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          onPress={() => onChange(n)}
          hitSlop={Math.max(0, (44 - size) / 2)}
          style={styles.pick}
          accessibilityRole="button"
          accessibilityLabel={`${n} ${n === 1 ? "star" : "stars"}`}
        >
          <Ionicons name={n <= value ? "star" : "star-outline"} size={size} color={n <= value ? STARS_GOLD : "#b9ae94"} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 1 },
  figure: { fontFamily: fonts.bodySemi, color: colors.ink900 },
  count: { fontFamily: fonts.body, color: colors.ink500 },
  pick: { paddingHorizontal: 2 },
});
