import type { ReactElement } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { colors, fonts, radii } from "@/lib/theme";

/**
 * The text buttons in a screen's header — Cancel, Post, Save (Oct 2026).
 *
 * Before: bare text, which iOS 26 drops into its own round glass bubble,
 * so "Cancel" was clipped by its circle and a disabled "Post" was grey on
 * grey. Now: a solid green pill for the action that commits, a quiet
 * outlined pill for the one that backs out — the same pair of shapes as
 * the buttons in the body of every screen.
 *
 * The bubble is the shared bar-button background. `headerButtons()` hands
 * the pills to iOS as custom header items with that background hidden
 * (`hidesSharedBackground`, iOS 26+; ignored before), and to Android as
 * the ordinary headerLeft / headerRight.
 */

export function HeaderPill({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  busy = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
}) {
  const primary = variant === "primary";
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy }}
      style={({ pressed }) => [
        styles.pill,
        primary ? styles.primary : styles.secondary,
        primary && disabled && !busy && styles.primaryOff,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={primary ? colors.cream50 : colors.green700} />
      ) : (
        <Text
          style={[styles.label, primary ? styles.primaryLabel : styles.secondaryLabel, primary && disabled && styles.primaryLabelOff]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * "‹ Back" for a screen that is the first in its own stack (Live scoring
 * sits in a stack inside the tabs, so the system draws no back button).
 * Goes back to wherever the member came from, else Home.
 */
export function BackPill() {
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={({ pressed }) => [styles.pill, styles.back, pressed && styles.pressed]}
    >
      <Ionicons name="chevron-back" size={22} color={colors.ink900} style={{ marginLeft: -4 }} />
      <Text style={styles.backLabel}>Back</Text>
    </Pressable>
  );
}

type HeaderOptions = {
  headerLeft?: () => ReactElement;
  headerRight?: () => ReactElement;
  unstable_headerLeftItems?: () => { type: "custom"; element: ReactElement; hidesSharedBackground: boolean }[];
  unstable_headerRightItems?: () => { type: "custom"; element: ReactElement; hidesSharedBackground: boolean }[];
};

/** Spread into a Stack.Screen's options: `options={{ title, ...headerButtons({ left, right }) }}`. */
export function headerButtons({ left, right }: { left?: ReactElement; right?: ReactElement }): HeaderOptions {
  const out: HeaderOptions = {};
  if (left) {
    out.headerLeft = () => left;
    if (Platform.OS === "ios") out.unstable_headerLeftItems = () => [{ type: "custom", element: left, hidesSharedBackground: true }];
  }
  if (right) {
    out.headerRight = () => right;
    if (Platform.OS === "ios") out.unstable_headerRightItems = () => [{ type: "custom", element: right, hidesSharedBackground: true }];
  }
  return out;
}

const styles = StyleSheet.create({
  back: {
    flexDirection: "row",
    gap: 2,
    minWidth: 0,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  backLabel: { fontFamily: fonts.body, fontSize: 17, color: colors.ink900 },
  pill: {
    minHeight: 36,
    minWidth: 76,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: {
    backgroundColor: colors.green700,
    shadowColor: colors.navy900,
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  // Disabled stays a pill, not a ghost: you can see where Post will be,
  // and the darker text keeps "Post" readable (ink500 on cream100 is 4.6:1).
  primaryOff: { backgroundColor: colors.cream100, shadowOpacity: 0, elevation: 0 },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  label: { fontSize: 15, letterSpacing: 0.2 },
  primaryLabel: { fontFamily: fonts.bodyBold, color: colors.cream50 },
  primaryLabelOff: { color: colors.ink500 },
  secondaryLabel: { fontFamily: fonts.bodySemi, color: colors.ink900 },
});
