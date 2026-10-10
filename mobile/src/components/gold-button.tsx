import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radii, spacing } from "@/lib/theme";

const LIP = "#9c7a2c";

/**
 * The marketplace's money button (Oct 2026 redesign, approved mock-up 3):
 * gold, raised on a darker gold lip, navy label. Buy now, Reserve and pay,
 * Pay now and the handover's Confirm all use it, so every step of buying
 * looks like the same journey.
 */
export function GoldButton({
  label,
  onPress,
  busy,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={style}
    >
      {({ pressed }) => (
        <View style={[styles.lip, pressed && styles.lipPressed, disabled && styles.off]}>
          <View style={styles.face}>
            {busy ? <ActivityIndicator color={colors.navy900} /> : <Text style={styles.label}>{label}</Text>}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lip: { borderRadius: radii.pill, backgroundColor: LIP, paddingBottom: 3 },
  lipPressed: { paddingBottom: 0, marginTop: 3 },
  off: { opacity: 0.45 },
  face: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.gold400,
    paddingHorizontal: spacing.md,
  },
  label: { fontSize: 17, fontWeight: "800", color: colors.navy900 },
});
