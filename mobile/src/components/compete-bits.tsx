import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Chip, type ChipTone } from "@/components/society-bits";
import { outingDateLabel } from "@/lib/outing-rules";
import { STAGE_LABEL, hoursUntilStands, myMatchState, resultLine, type Match } from "@/lib/matchplay";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Pieces the Compete screens share (0148): the pill tabs, a match row and
 * the chip that says where a match stands. One look everywhere, so "Confirm
 * result" is the same amber on the hub, the league and the match.
 */

export function Pills<T extends string>({
  options,
  value,
  onChange,
  label,
  style,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.pills, style]} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            style={[styles.pill, on && styles.pillOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.pillText, on && styles.pillTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Where a match stands, for whoever is looking. */
export function matchChip(m: Match & { arrangedAt?: string | null }, me: string | null): { tone: ChipTone; label: string } | null {
  if (m.status === "void") return { tone: "grey", label: "Void" };
  if (m.status === "disputed") return { tone: "due", label: "With the organiser" };
  if (m.status === "confirmed") return null;
  if (m.status === "reported") {
    if (me && me === m.reportedBy) return { tone: "asked", label: "Waiting for them" };
    if (me && (me === m.playerA || me === m.playerB)) return { tone: "wait", label: "Confirm result" };
    return { tone: "asked", label: `Stands in ${hoursUntilStands(m.standsAt)}h` };
  }
  if (!m.playerA || !m.playerB) return { tone: "grey", label: "Waiting" };
  if (me && (me === m.playerA || me === m.playerB)) {
    return myMatchState(m, me) === "arranged" ? { tone: "ok", label: "Arranged" } : { tone: "navy", label: "Arrange" };
  }
  return m.arrangedAt ? { tone: "ok", label: "Arranged" } : null;
}

/** "Eire M. v Niamh R." with the result or the next thing to do. */
export function MatchRow({
  match,
  nameOf,
  me,
  onPress,
  showStage,
}: {
  match: Match & { arrangedAt?: string | null };
  nameOf: (id: string | null) => string;
  me: string | null;
  onPress: () => void;
  showStage?: boolean;
}) {
  const mine = !!me && (me === match.playerA || me === match.playerB);
  const result = match.status === "confirmed" || match.status === "reported" ? resultLine(match, nameOf) : "";
  const chip = matchChip(match, me);
  const when = match.arrangedAt
    ? new Date(match.arrangedAt).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : match.playBy
      ? `Play by ${outingDateLabel(match.playBy)}`
      : null;
  const meta = [showStage ? (match.stage === "group" ? `Round ${match.roundNo}` : STAGE_LABEL[match.stage]) : null, result || when].filter(Boolean).join(" · ");
  const title = `${nameOf(match.playerA)} v ${nameOf(match.playerB)}`;
  return (
    <Pressable
      style={[styles.match, mine && styles.matchMine]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, meta, chip?.label].filter(Boolean).join(", ")}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.matchTitle} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={styles.matchMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {chip ? <Chip tone={chip.tone}>{chip.label}</Chip> : <Ionicons name="chevron-forward" size={18} color={colors.ink500} />}
    </Pressable>
  );
}

/** A small uppercase heading over a list. */
export function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.section}>{children.toUpperCase()}</Text>;
}

const styles = StyleSheet.create({
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: { minHeight: 40, paddingHorizontal: 14, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  pillOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  pillText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  pillTextOn: { color: colors.cream50 },
  match: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  matchMine: { borderColor: colors.gold500, backgroundColor: colors.surfaceTint },
  matchTitle: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  matchMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  section: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: colors.ink500, marginTop: spacing.sm },
});
