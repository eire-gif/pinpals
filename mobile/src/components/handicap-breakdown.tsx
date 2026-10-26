import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { courseHandicap, exactLabel, indexLabel, playingHandicap, teamHandicapLabel } from "@/lib/live-scoring";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * "How it's worked out" (Oct 2026): every step from a handicap index to the
 * figure a player plays off, on one tee — the WHS sum with the real numbers
 * in it. Opened by tapping a plays-off figure on Set up a round, a tee on
 * the handicap calculator, or the course page's handicap card.
 *
 * It recomputes from the same functions the round uses (live-scoring.ts),
 * so what it shows can't drift from what the scorecard plays off.
 */
export type BreakdownTee = {
  /** "Men's White", "Your tees"… */
  name: string;
  courseRating: number | null;
  slope: number | null;
  par: number | null;
  holes: 9 | 18;
};

export function HandicapBreakdownSheet({
  open,
  onClose,
  who,
  index,
  tee,
  allowance,
}: {
  open: boolean;
  onClose: () => void;
  /** "Your handicap", "Aoife B."… */
  who: string;
  index: number | null;
  tee: BreakdownTee | null;
  /** 0.95 for 95%; 1 when there's no allowance to show. */
  allowance: number;
}) {
  const insets = useSafeAreaInsets();
  if (!open || index == null || !tee) return null;
  const ch = courseHandicap(index, { slope: tee.slope, courseRating: tee.courseRating, par: tee.par, holes: tee.holes });
  const plays = playingHandicap(ch, allowance);
  const pct = Math.round(allowance * 100);
  const f3 = (n: number) => (n < 0 ? `− ${Math.abs(n).toFixed(3)}` : n.toFixed(3));
  const diff = tee.courseRating != null && tee.par != null ? Math.round((tee.courseRating - tee.par) * 10) / 10 : 0;
  const slopePart = tee.slope ? (ch.indexUsed * tee.slope) / 113 : 0;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.grabber} />
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>How it&apos;s worked out</Text>
            <Text style={styles.sub}>
              {who} · {tee.name} · {tee.holes} holes
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={colors.ink500} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ gap: spacing.sm }} style={{ maxHeight: 520 }}>
          {tee.holes === 9 ? (
            <View style={styles.card}>
              <Text style={styles.step}>Half your index</Text>
              <Line left={`${indexLabel(index)} ÷ 2, to one decimal`} right={indexLabel(ch.indexUsed)} bold />
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.step}>{tee.holes === 9 ? "9-hole course handicap" : "Course handicap"}</Text>
            {ch.estimated ? (
              <Text style={styles.meta}>No course rating or slope for these tees, so the index is used as it is. Add them from the card for the exact figure.</Text>
            ) : (
              <>
                <Line left={`${indexLabel(ch.indexUsed)} × ${tee.slope} ÷ 113`} right={f3(slopePart)} />
                <Line left={`+ (${tee.courseRating!.toFixed(1)} − ${tee.par})`} right={diff < 0 ? `− ${Math.abs(diff).toFixed(3)}` : `+ ${diff.toFixed(3)}`} />
                <View style={styles.rule} />
                <Line left="Exact" right={f3(ch.exact)} bold />
              </>
            )}
            <View style={styles.result}>
              <Text style={styles.resultLabel}>Course handicap</Text>
              <Text style={styles.resultNumber}>{teamHandicapLabel(ch.courseHandicap)}</Text>
            </View>
          </View>

          {pct !== 100 ? (
            <View style={styles.card}>
              <Text style={styles.step}>Playing handicap ({pct}%)</Text>
              <Line left={`${exactLabel(Math.round(ch.exact * 1000) / 1000)} × ${pct}%`} right={f3(ch.exact * allowance)} />
              <View style={[styles.result, styles.resultGreen]}>
                <Text style={[styles.resultLabel, { color: colors.green800 }]}>Plays off</Text>
                <Text style={[styles.resultNumber, { color: colors.green800 }]}>{teamHandicapLabel(plays)}</Text>
              </View>
            </View>
          ) : null}

          <Text style={styles.meta}>
            The allowance goes on the exact figure and is rounded once, halves up — the R&amp;A and Golf Ireland method (Rules of Handicapping 6.1 and 6.2).
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Line({ left, right, bold = false }: { left: string; right: string; bold?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineText, bold && styles.bold]}>{left}</Text>
      <Text style={[styles.lineText, styles.num, bold && styles.bold]}>{right}</Text>
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
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md, gap: 8 },
  step: { fontFamily: fonts.bodyBold, fontSize: 12.5, letterSpacing: 0.8, textTransform: "uppercase", color: colors.green700 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  lineText: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  num: { fontVariant: ["tabular-nums"] },
  bold: { fontFamily: fonts.bodyBold },
  rule: { height: 1, backgroundColor: colors.line },
  result: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: radii.md, paddingVertical: 4 },
  resultGreen: { backgroundColor: colors.green100, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  resultLabel: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink500 },
  resultNumber: { fontFamily: fonts.display, fontSize: 30, color: colors.navy900 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.ink500 },
});
