import type { ReactNode, Ref } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The pieces the joining screens and the profile builder are built from.
 *
 * One file so the eight screens a new member walks through look like one
 * journey: same title size, same button, same gap between them. The mockup
 * they follow is the "PinPals Onboarding Flow" canvas.
 */

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.iconButton}
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={6}
    >
      <Ionicons name="chevron-back" size={26} color={colors.ink900} />
    </Pressable>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Sub({ children }: { children: ReactNode }) {
  return <Text style={styles.sub}>{children}</Text>;
}

export function PrimaryButton({
  label,
  onPress,
  pending = false,
  disabled = false,
  tone = "green",
}: {
  label: string;
  onPress: () => void;
  pending?: boolean;
  disabled?: boolean;
  tone?: "green" | "gold" | "outline";
}) {
  const off = disabled || pending;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: pending }}
      style={({ pressed }) => [
        styles.button,
        tone === "green" && styles.buttonGreen,
        tone === "gold" && styles.buttonGold,
        tone === "outline" && styles.buttonOutline,
        off && styles.buttonOff,
        pressed && !off && styles.buttonPressed,
      ]}
    >
      {pending ? (
        <ActivityIndicator color={tone === "green" ? colors.cream50 : colors.ink900} />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            tone === "green" ? styles.labelLight : styles.labelDark,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ref,
  ...input
}: TextInputProps & { label: string; hint?: string; ref?: Ref<TextInput> }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {hint ? <Text style={styles.fieldHint}> · {hint}</Text> : null}
      </Text>
      <TextInput
        ref={ref}
        placeholderTextColor={colors.ink500}
        {...input}
        style={[styles.input, input.style]}
      />
    </View>
  );
}

export function Tick({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={styles.tickRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.box, checked && styles.boxOn]}>
        {checked ? <Ionicons name="checkmark" size={17} color={colors.cream50} /> : null}
      </View>
      <View style={styles.tickText}>{children}</View>
    </Pressable>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.error} accessibilityLiveRegion="polite">
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

/** "Step 2 of 5" with the five-segment bar. */
export function Progress({ step, of }: { step: number; of: number }) {
  return (
    <View>
      <View style={styles.bar}>
        {Array.from({ length: of }, (_, i) => (
          <View key={i} style={[styles.seg, i < step && styles.segOn]} />
        ))}
      </View>
      <Text style={styles.step}>
        Step {step} of {of}
      </Text>
    </View>
  );
}

export const joinStyles = StyleSheet.create({
  /** Gutter used by every joining screen. */
  pad: { paddingHorizontal: 20 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.cream50,
    gap: 10,
  },
  link: { fontFamily: fonts.bodyBold, color: colors.green700, fontSize: type.small },
  body: { fontFamily: fonts.body, color: colors.ink900, fontSize: type.small, lineHeight: 20 },
});

const styles = StyleSheet.create({
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 30,
    lineHeight: 35,
    color: colors.ink900,
    marginTop: 6,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 15.5,
    lineHeight: 23,
    color: "#3d4757",
    marginTop: 8,
  },
  button: {
    minHeight: 52,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  buttonGreen: { backgroundColor: colors.green700 },
  buttonGold: { backgroundColor: colors.gold400 },
  buttonOutline: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: "rgba(247,243,234,0.55)",
  },
  buttonOff: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: type.body },
  labelLight: { color: colors.cream50 },
  labelDark: { color: colors.ink900 },
  field: { gap: 5, flex: 1 },
  fieldLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: "#4c5667" },
  fieldHint: { fontFamily: fonts.body, color: colors.ink500 },
  input: {
    minHeight: 48,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },
  tickRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  box: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: "#9aa3b0",
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  boxOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  tickText: { flex: 1 },
  error: {
    backgroundColor: colors.red100,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: { fontFamily: fonts.body, color: colors.red600, fontSize: type.small },
  bar: { flexDirection: "row", gap: 6 },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line },
  segOn: { backgroundColor: colors.green700 },
  step: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "#4c5667",
    marginTop: 18,
  },
});
