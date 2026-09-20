import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, type } from "@/lib/theme";

/**
 * The small pieces the post-a-tee-time form is built from.
 *
 * Chips rather than dropdowns throughout. A native picker on iOS is a modal
 * wheel that hides the rest of the form while you use it, and every one of
 * these choices has few enough options to show at once — which means a member
 * can see what they have picked without opening anything.
 */

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

export function ChipGroup({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      // 44pt is the smallest thing a thumb reliably hits, and this form is
      // used standing on a first tee as often as sitting down.
      style={[styles.chip, selected && styles.chipOn]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelOn]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  title: { fontSize: type.body, fontWeight: "700", color: colors.ink900 },
  hint: { fontSize: type.small, color: colors.ink500, marginTop: -4 },
  group: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  chipLabel: { fontSize: type.body, color: colors.ink900 },
  chipLabelOn: { color: colors.cream50, fontWeight: "700" },
});
