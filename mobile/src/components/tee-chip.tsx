import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { teeColour } from "@/lib/tee-colours";
import { colors, fonts, radii } from "@/lib/theme";

/**
 * A tee to choose, drawn as its marker looks on the tee (tee-colours.ts):
 * Blue is a blue button, Red a red one, White a white one with an edge.
 *
 * Every chip is in its colour, chosen or not (Oct 2026 — members asked for
 * the buttons to BE the colours, not carry a dot of them). The chosen one
 * is marked twice, so it never depends on telling two shades apart: a tick,
 * and a navy ring set off from the chip by a cream gap. The others sit a
 * little quieter (no ring, a softer shadow).
 */
export function TeeChip({ name, label, selected, onPress }: { name: string; label?: string; selected: boolean; onPress: () => void }) {
  const c = teeColour(name);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.ring, selected && styles.ringOn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label ?? name} tees`}
    >
      <View style={[styles.chip, { backgroundColor: c.fill, borderColor: c.border }, selected && styles.chipOn]}>
        {selected ? (
          <View style={[styles.tick, { backgroundColor: c.text }]}>
            <Ionicons name="checkmark" size={13} color={c.fill === "#ffffff" ? colors.ink900 : c.fill} />
          </View>
        ) : null}
        <Text style={[styles.label, { color: c.text }]}>{label ?? name}</Text>
      </View>
    </Pressable>
  );
}

/** A small dot in the tee's colour, for labels. */
export function TeeDot({ name, size = 10 }: { name: string; size?: number }) {
  const c = teeColour(name);
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.fill, borderWidth: 1, borderColor: c.border }} />;
}

const styles = StyleSheet.create({
  // The ring is the outer Pressable: transparent until chosen, so chosen and
  // unchosen chips are the same size and nothing shifts when you pick one.
  ring: { borderRadius: radii.pill, borderWidth: 2, borderColor: "transparent", padding: 2 },
  ringOn: { borderColor: colors.navy900 },
  pressed: { opacity: 0.8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  chipOn: { shadowOpacity: 0.18, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  tick: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  label: { fontFamily: fonts.bodyBold, fontSize: 14 },
});
