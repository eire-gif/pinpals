import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";

import { holeResult } from "@/lib/scorecard-math";
import { colors, fonts } from "@/lib/theme";

/**
 * A score marked up the way a paper card is: a circle for a birdie, two
 * circles for an eagle or better, a square for a bogey, two squares for a
 * double bogey or worse. Par stays plain.
 *
 * Always the GROSS score against the hole's par — never net (Oct 2026: "off
 * the par of the hole, not the score they achieve due to their handicap").
 * A 4 on a par 4 with a shot is still a par here, however good it is in
 * Stableford.
 *
 * `size` is the outer shape; the number scales with it. A pick-up (null)
 * shows "P" unmarked.
 */
export function ScoreMark({
  strokes,
  par,
  size = 24,
  textStyle,
  ghost = false,
}: {
  strokes: number | null;
  par: number;
  size?: number;
  textStyle?: StyleProp<TextStyle>;
  /** A suggested score not yet confirmed: no shape, faint number. */
  ghost?: boolean;
}) {
  const label = strokes == null ? "P" : String(strokes);
  const r = strokes == null || ghost ? null : holeResult(strokes, par);
  const under = r === "birdie" || r === "eagle" || r === "albatross";
  const over = r === "bogey" || r === "double" || r === "worse";
  const twice = r === "eagle" || r === "albatross" || r === "double" || r === "worse";
  const line = size >= 36 ? 2 : 1.5;
  const gap = Math.max(2, Math.round(size * 0.1));
  // The number has to fit inside the inner shape of a double.
  const inner = twice ? size - (line + gap) * 2 : size;
  const fontSize = Math.round(Math.min(size * 0.56, inner * 0.7));
  const text = (
    <Text style={[styles.text, textStyle, { fontSize, lineHeight: Math.round(fontSize * 1.2) }]} allowFontScaling={false}>
      {label}
    </Text>
  );
  if (!under && !over) return <View style={[styles.box, { width: size, height: size }]}>{text}</View>;

  const colour = under ? colors.green700 : colors.red600;
  const shape = (s: number) => ({
    width: s,
    height: s,
    borderWidth: line,
    borderColor: colour,
    borderRadius: under ? s / 2 : Math.max(2, s * 0.12),
  });
  return (
    <View style={[styles.box, shape(size)]} accessibilityLabel={`${label}, ${r}`}>
      {twice ? <View style={[styles.box, shape(inner)]}>{text}</View> : text}
    </View>
  );
}

/** The key, for under a card: one of each shape with its name. */
export function ScoreMarkKey() {
  const items: [string, number][] = [
    ["Eagle+", 2],
    ["Birdie", 3],
    ["Par", 4],
    ["Bogey", 5],
    ["Double+", 6],
  ];
  return (
    <View style={styles.key}>
      {items.map(([name, s]) => (
        <View key={name} style={styles.keyItem}>
          <ScoreMark strokes={s} par={4} size={20} />
          <Text style={styles.keyText}>{name}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
  text: { fontFamily: fonts.bodyBold, color: colors.ink900, textAlign: "center" },
  key: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12 },
  keyItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  keyText: { fontFamily: fonts.body, fontSize: 11.5, color: colors.ink500 },
});
