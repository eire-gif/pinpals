import { useEffect, useRef } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { HeroSummary } from "@/lib/live-hero";
import { colors, creamAlpha, fonts, navyAlpha, radii, spacing, type } from "@/lib/theme";

/**
 * Live Scoring with a round in play (approved mock-up, Oct 2026): the round
 * you're playing pinned to the top, above "Start your round", so it's plain
 * you're in a live game — carry on, finish it, or (if you started it)
 * delete it. The three ways to start a game are locked until then; tapping
 * one opens <LockedStartSheet />.
 */

export type HeroRound = {
  courseName: string;
  /** "Stableford · Blue tees · 4 players" */
  detail: string;
};

export type HeroActions = {
  onContinue: () => void;
  onFinish: () => void;
  /** Null when it isn't yours to delete (someone else started it, or it's a
   *  match in a society day — the organiser's). */
  onDelete: (() => void) | null;
};

export function LiveRoundHero({ round, summary, ...actions }: { round: HeroRound; summary: HeroSummary | null } & HeroActions) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const next = summary?.next ?? null;
  return (
    <View style={styles.card} accessibilityLabel={`You're in a live round at ${round.courseName}`}>
      <View style={styles.kickerLine}>
        <Animated.View style={[styles.dot, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) }]} />
        <Text style={styles.kicker}>YOU'RE IN A LIVE ROUND</Text>
      </View>

      <View style={{ gap: 4 }}>
        <Text style={styles.course} numberOfLines={2}>
          {round.courseName}
        </Text>
        <Text style={styles.detail}>{round.detail}</Text>
      </View>

      {summary ? (
        <View style={styles.progress}>
          <View style={styles.progressHead}>
            <Text style={styles.thru}>
              {summary.thru === summary.total ? "All holes in" : `Thru ${summary.thru} of ${summary.total}`}
            </Text>
            {next ? <Text style={styles.nextHole}>{`Next: Hole ${next.hole} · Par ${next.par}`}</Text> : null}
          </View>
          <View style={styles.strip} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {summary.holes.map((h) => (
              <View key={h.hole} style={[styles.pip, h.state === "done" ? styles.pipDone : h.state === "next" ? styles.pipNext : null]} />
            ))}
          </View>
          {summary.board?.map((r, i) => (
            <View key={`${r.name}-${i}`} style={[styles.boardRow, r.me && styles.boardRowMe]}>
              <Text style={[styles.boardPos, r.me && styles.gold]}>{r.position}</Text>
              <Text style={[styles.boardName, r.me && styles.bold]} numberOfLines={1}>
                {r.name}
              </Text>
              <Text style={styles.boardValue}>{r.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        onPress={actions.onContinue}
        style={({ pressed }) => [styles.continue, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={next ? `Continue round from hole ${next.hole}` : "Continue round"}
      >
        <Text style={styles.continueText}>{next ? `Continue round · Hole ${next.hole}` : "Continue round"}</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.ink900} />
      </Pressable>

      <View style={styles.pair}>
        <Pressable onPress={actions.onFinish} style={({ pressed }) => [styles.ghost, pressed && styles.pressed]} accessibilityRole="button">
          <Ionicons name="flag-outline" size={18} color={colors.cream50} />
          <Text style={styles.ghostText}>Finish round</Text>
        </Pressable>
        {actions.onDelete ? (
          <Pressable onPress={actions.onDelete} style={({ pressed }) => [styles.ghost, pressed && styles.pressed]} accessibilityRole="button">
            <Ionicons name="trash-outline" size={18} color={colors.cream50} />
            <Text style={styles.ghostText}>Delete round</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** The strip under the hero: why the start buttons are locked. */
export function OneRoundNotice() {
  return (
    <View style={styles.notice}>
      <Ionicons name="lock-closed-outline" size={20} color={colors.navy900} style={{ marginTop: 1 }} />
      <Text style={styles.noticeText}>
        <Text style={styles.bold}>One live round at a time.</Text> Finish or delete the round above to start another.
      </Text>
    </View>
  );
}

/** Tapping a locked start button: the three ways out, plus Not now. */
export function LockedStartSheet({
  visible,
  round,
  summary,
  onClose,
  ...actions
}: { visible: boolean; round: HeroRound; summary: HeroSummary | null; onClose: () => void } & HeroActions) {
  const insets = useSafeAreaInsets();
  const next = summary?.next ?? null;
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]} accessibilityViewIsModal>
        <View style={styles.grip} />
        <View style={styles.kickerLine}>
          <View style={[styles.dot, { backgroundColor: colors.green600 }]} />
          <Text style={[styles.kicker, { color: colors.green700 }]}>ROUND IN PLAY</Text>
        </View>
        <Text style={styles.sheetTitle} accessibilityRole="header">
          You're still in a live round
        </Text>
        <Text style={styles.sheetBody}>
          You can only play one live round at a time. Carry on with it, or finish or delete it before you start a new one.
        </Text>

        <View style={styles.summaryRow}>
          <View style={styles.thruTile}>
            <Text style={styles.thruBig}>{summary ? summary.thru : "–"}</Text>
            <Text style={styles.thruSmall}>THRU</Text>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.summaryCourse} numberOfLines={1}>
              {round.courseName}
            </Text>
            <Text style={styles.summaryDetail} numberOfLines={2}>
              {round.detail}
            </Text>
          </View>
        </View>

        <Pressable onPress={run(actions.onContinue)} style={({ pressed }) => [styles.sheetPrimary, pressed && styles.pressed]} accessibilityRole="button">
          <Text style={styles.sheetPrimaryText}>{next ? `Continue round · Hole ${next.hole}` : "Continue round"}</Text>
        </Pressable>
        <Pressable onPress={run(actions.onFinish)} style={({ pressed }) => [styles.sheetSecondary, pressed && styles.pressed]} accessibilityRole="button">
          <Text style={styles.sheetSecondaryText}>Finish round & save cards</Text>
        </Pressable>
        {actions.onDelete ? (
          <Pressable onPress={run(actions.onDelete)} style={styles.sheetLink} accessibilityRole="button">
            <Text style={[styles.sheetLinkText, { color: colors.red600 }]}>Delete round</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} style={styles.sheetLink} accessibilityRole="button">
          <Text style={styles.sheetLinkText}>Not now</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.green700,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.gold400,
    padding: spacing.md,
    gap: 14,
    shadowColor: colors.navy900,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  kickerLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold400 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 1.4, color: colors.gold400 },
  course: { fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: colors.cream50 },
  detail: { fontFamily: fonts.body, fontSize: 15, color: colors.green100 },
  progress: { backgroundColor: navyAlpha(0.35), borderRadius: 14, padding: 12, gap: 10 },
  progressHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  thru: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.cream50 },
  nextHole: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold400 },
  strip: { flexDirection: "row", gap: 3 },
  pip: { flex: 1, height: 8, borderRadius: 4, backgroundColor: creamAlpha(0.25) },
  pipDone: { backgroundColor: colors.gold400 },
  pipNext: { backgroundColor: colors.cream50 },
  boardRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 6, borderRadius: radii.sm },
  boardRowMe: { backgroundColor: "rgba(232,196,107,0.18)" },
  boardPos: { width: 26, fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.green100 },
  boardName: { flex: 1, fontFamily: fonts.body, fontSize: type.body, color: colors.cream50 },
  boardValue: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  gold: { color: colors.gold400 },
  bold: { fontFamily: fonts.bodyBold },
  continue: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: colors.gold400,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  continueText: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink900 },
  pair: { flexDirection: "row", gap: 10 },
  ghost: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: creamAlpha(0.6),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  ghostText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  pressed: { opacity: 0.85 },
  notice: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  noticeText: { flex: 1, fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink900 },
  backdrop: { flex: 1, backgroundColor: navyAlpha(0.55) },
  sheet: {
    backgroundColor: colors.cream50,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 14,
  },
  grip: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line },
  sheetTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: colors.navy900 },
  sheetBody: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 23, color: colors.ink900 },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: 12,
  },
  thruTile: { width: 52, height: 56, borderRadius: 10, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  thruBig: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.cream50 },
  thruSmall: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1, color: colors.gold400 },
  summaryCourse: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink900 },
  summaryDetail: { fontFamily: fonts.body, fontSize: 14, color: colors.ink500 },
  sheetPrimary: { minHeight: 56, borderRadius: 14, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  sheetPrimaryText: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.cream50 },
  sheetSecondary: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.navy900,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetSecondaryText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900 },
  sheetLink: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  sheetLinkText: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink500 },
});
