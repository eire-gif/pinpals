import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  parseTeamHandicap,
  stepTeamHandicap,
  teamHandicapBreakdown,
  exactLabel,
  teamHandicapLabel,
  TEAM_HANDICAP_MAX,
  type TeamHandicapKind,
} from "@/lib/live-scoring";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Setting a team's handicap by hand for one game (0189) — a scramble team,
 * a foursomes or greensomes pair. Shows how the worked-out figure is made,
 * then a big −/+ (or type it, "+2" for a plus team). Saving the worked-out
 * figure puts it back. Used on Set up a round, the scramble day and the
 * draw before the start, and on the card and the day's board once it's on.
 */
export function TeamHandicapSheet({
  open,
  label,
  kind,
  players,
  auto,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  /** "Team 1", "Aoife & Ruth"… */
  label: string;
  kind: TeamHandicapKind;
  /** First names and course handicaps, for the breakdown. Omit when they aren't all known. */
  players?: { name: string; courseHandicap: number }[];
  /** The worked-out figure. */
  auto: number;
  /** The figure in force now (= auto when not set by hand). */
  value: number;
  onClose: () => void;
  /** The figure chosen; = auto puts it back to the worked-out one. */
  onSave: (handicap: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(teamHandicapLabel(value));
  useEffect(() => {
    if (open) setDraft(teamHandicapLabel(value));
  }, [open, value]);

  const parsed = parseTeamHandicap(draft);
  const current = parsed ?? value;
  const step = (by: 1 | -1) => setDraft(teamHandicapLabel(stepTeamHandicap(current, by)));
  const breakdown = players && players.length > 0 ? teamHandicapBreakdown(kind, players.map((p) => p.courseHandicap)) : null;
  const diff = current - auto;
  const diffText = diff === 0 ? "The worked-out figure" : `${Math.abs(diff)} ${diff < 0 ? "less" : "more"} than worked out`;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{kind === "scramble" ? "Team handicap" : "Pair handicap"}</Text>
              <Text style={styles.sub}>{label} · this game only</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.ink500} />
            </Pressable>
          </View>

          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.label}>Worked out from indexes</Text>
              <Text style={styles.auto}>{teamHandicapLabel(auto)}</Text>
            </View>
            {breakdown
              ? breakdown.rows.map((r, i) => (
                  <View key={i} style={styles.row}>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {players![i].name} · course {exactLabel(r.courseHandicap)} × {r.percent}%
                    </Text>
                    <Text style={styles.rowShare}>{r.share}</Text>
                  </View>
                ))
              : null}
            {breakdown ? <Text style={styles.meta}>{breakdown.rule}</Text> : null}
          </View>

          <Text style={styles.label}>{kind === "scramble" ? "Team plays off" : "Pair plays off"}</Text>
          <View style={styles.stepper}>
            <Pressable onPress={() => step(-1)} style={({ pressed }) => [styles.stepButton, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel="One less">
              <Ionicons name="remove" size={30} color={colors.green700} />
            </Pressable>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              keyboardType="numbers-and-punctuation"
              maxLength={3}
              selectTextOnFocus
              style={[styles.number, parsed == null && styles.numberBad, diff !== 0 && parsed != null && styles.numberSet]}
              accessibilityLabel={`${kind === "scramble" ? "Team" : "Pair"} handicap`}
            />
            <Pressable onPress={() => step(1)} style={({ pressed }) => [styles.stepButton, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel="One more">
              <Ionicons name="add" size={30} color={colors.green700} />
            </Pressable>
          </View>
          <Text style={[styles.meta, { textAlign: "center" }]}>
            {parsed == null ? `A whole number, 0 to ${TEAM_HANDICAP_MAX}, or +1 to +10 for a plus team` : `${diffText} · whole numbers, + for a plus team`}
          </Text>

          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={20} color={colors.green800} />
            <Text style={styles.noteText}>
              Only this game changes. Everyone sees it was set by hand, with the worked-out figure beside it.
            </Text>
          </View>

          <Pressable
            onPress={() => parsed != null && onSave(parsed)}
            disabled={parsed == null}
            style={({ pressed }) => [styles.save, parsed == null && styles.saveOff, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
          >
            <Text style={styles.saveLabel}>
              {parsed == null ? "Enter a handicap" : `${kind === "scramble" ? "Team" : "Pair"} plays off ${teamHandicapLabel(parsed)}`}
            </Text>
          </Pressable>
          {value !== auto ? (
            <Pressable onPress={() => onSave(auto)} style={({ pressed }) => [styles.reset, pressed && { opacity: 0.85 }]} accessibilityRole="button">
              <Text style={styles.resetLabel}>Use the worked-out {teamHandicapLabel(auto)}</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The gold "SET BY HAND" badge (0189), wherever a hand-set team handicap is shown. */
export function SetByHandBadge({ small = false }: { small?: boolean }) {
  return (
    <View style={[styles.badge, small && styles.badgeSmall]}>
      <Ionicons name="pencil" size={small ? 10 : 11} color={colors.navy900} />
      <Text style={[styles.badgeText, small && { fontSize: 9.5 }]}>Set by hand</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(14,21,32,0.4)" },
  sheet: { backgroundColor: colors.cream50, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8, paddingHorizontal: spacing.md, gap: spacing.sm },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: 4 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.navy900 },
  sub: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 4 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.6, textTransform: "uppercase", color: colors.navy900 },
  auto: { fontFamily: fonts.display, fontSize: 24, color: colors.navy900 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.cream100, paddingVertical: 3 },
  rowText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  rowShare: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepButton: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  number: { flex: 1, height: 72, borderRadius: radii.lg, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surface, textAlign: "center", fontFamily: fonts.display, fontSize: 40, color: colors.navy900 },
  numberSet: { borderColor: colors.gold500 },
  numberBad: { borderColor: colors.red600 },
  note: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.green100, borderRadius: radii.md, padding: spacing.sm },
  noteText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.green800 },
  save: { minHeight: 54, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  saveOff: { backgroundColor: colors.ink500 },
  saveLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  reset: { minHeight: 48, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  resetLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.green700 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: colors.gold400, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeSmall: { paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: colors.navy900 },
});
