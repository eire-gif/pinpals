import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BackButton, ErrorNote, PrimaryButton, Progress, Sub, Title, joinStyles } from "@/components/join-ui";
import { colors, fonts } from "@/lib/theme";

export const ONBOARDING_STEPS = 5;

/**
 * The chrome every profile-builder step shares: back, Skip, the five-segment
 * bar, a title, a scrolling middle and a Continue button pinned at the bottom.
 *
 * Skip is always there and never asks "are you sure?". A member who skips
 * still has an account — and an account is what lets Home ask again later.
 * A wizard that traps people converts worse than one that lets them out.
 */
export function OnboardingFrame({
  step,
  title,
  sub,
  onBack,
  onSkip,
  onContinue,
  continueLabel = "Continue",
  pending = false,
  error = null,
  scroll = true,
  children,
}: {
  step: number;
  title: string;
  sub: string;
  onBack?: () => void;
  onSkip: () => void;
  onContinue: () => void;
  continueLabel?: string;
  pending?: boolean;
  error?: string | null;
  /** False when the step renders its own list (a FlatList cannot sit in a ScrollView). */
  scroll?: boolean;
  children: ReactNode;
}) {
  const head = (
    <View style={joinStyles.pad}>
      <Progress step={step} of={ONBOARDING_STEPS} />
      <Title>{title}</Title>
      <Sub>{sub}</Sub>
    </View>
  );

  return (
    <SafeAreaView style={styles.fill} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.top}>
          {onBack ? <BackButton onPress={onBack} /> : <View style={styles.spacer} />}
          <Pressable onPress={onSkip} hitSlop={8} accessibilityRole="button" style={styles.skipHit}>
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        </View>

        {scroll ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
            {head}
            <View style={styles.body}>{children}</View>
          </ScrollView>
        ) : (
          <View style={styles.fill}>
            {head}
            <View style={[styles.body, styles.fill]}>{children}</View>
          </View>
        )}

        <View style={joinStyles.footer}>
          <ErrorNote message={error} />
          <PrimaryButton label={continueLabel} onPress={onContinue} pending={pending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** The green tile with a club's initials, used wherever a course has no photo. */
export function CourseTile({ name, size = 46 }: { name: string; size?: number }) {
  const initials = name
    .replace(/\b(golf|club|links|course|resort|the|gc|hotel|&)\b/gi, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || name.slice(0, 2).toUpperCase();
  return (
    <View style={[styles.tile, { width: size, height: size }]}>
      <Text style={styles.tileText}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 8,
    paddingRight: 12,
    paddingTop: 4,
  },
  spacer: { width: 44, height: 44 },
  skipHit: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  skip: { fontFamily: fonts.bodySemi, fontSize: 15, color: "#4c5667" },
  scroll: { paddingBottom: 24 },
  body: { paddingHorizontal: 20, paddingTop: 16 },
  tile: {
    borderRadius: 10,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  tileText: { fontFamily: fonts.display, fontSize: 16, color: colors.gold400 },
});
