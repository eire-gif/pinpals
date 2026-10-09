import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { teeColour } from "@/lib/tee-colours";
import { colors, fonts, radii } from "@/lib/theme";

/**
 * A tee to choose, drawn in its marker's colour (tee-colours.ts): a swatch
 * when it isn't chosen, the whole chip in the colour when it is.
 */
export function TeeChip({ name, label, selected, onPress }: { name: string; label?: string; selected: boolean; onPress: () => void }) {
  const c = teeColour(name);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected ? { backgroundColor: c.fill, borderColor: c.border, borderWidth: 2 } : null]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label ?? name} tees`}
    >
      {selected ? (
        <Ionicons name="checkmark" size={16} color={c.text} />
      ) : (
        <View style={[styles.swatch, { backgroundColor: c.fill, borderColor: c.border }]} />
      )}
      <Text style={[styles.label, selected && { color: c.text }]}>{label ?? name}</Text>
    </Pressable>
  );
}

/** A small dot in the tee's colour, for labels. */
export function TeeDot({ name, size = 10 }: { name: string; size?: number }) {
  const c = teeColour(name);
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.fill, borderWidth: 1, borderColor: c.border }} />;
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  swatch: { width: 16, height: 16, borderRadius: 8, borderWidth: 1 },
  label: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
});
