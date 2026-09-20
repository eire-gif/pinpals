import { createContext, useContext, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { colors, radii, spacing, type } from "@/lib/theme";

/**
 * The small pieces the post-a-tee-time form is built from.
 *
 * Chips rather than dropdowns throughout. A native picker on iOS is a modal
 * wheel that hides the rest of the form while you use it, and most of these
 * choices have few enough options to show at once — which means a member can
 * see what they have picked without opening anything.
 *
 * "Most" is doing work in that sentence, and it is why Collapsible exists.
 * Three spaces or two visibilities are fine laid out flat. Twenty-nine
 * half-hourly time slots are not: laid flat, and laid flat TWICE for a range,
 * they put fifty-eight buttons between the day and the number of spaces. The
 * open-plan argument inverts once a group stops fitting on the screen — you
 * can no longer see what you picked *or* what else is on offer, and you are
 * scrolling either way.
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

/**
 * A closed row showing what is chosen, which opens to let you change it.
 *
 * `open` is controlled by the parent rather than held here, so that a screen
 * with several of these can guarantee only one is ever open. Two open pickers
 * is the same wall of buttons this component exists to remove.
 */
export function Collapsible({
  label,
  value,
  placeholder,
  disabled = false,
  open,
  onToggle,
  children,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  disabled?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.collapsible}>
      <Pressable
        onPress={disabled ? undefined : onToggle}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled }}
        style={[
          styles.summary,
          open && styles.summaryOpen,
          disabled && styles.summaryOff,
        ]}
      >
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text
          style={[styles.summaryValue, !value && styles.summaryPlaceholder]}
          numberOfLines={1}
        >
          {value ?? placeholder}
        </Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.ink500}
        />
      </Pressable>
      {open && !disabled ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

// ===========================================================================
// The even grid
// ===========================================================================
//
// A wrapping row of pill chips sizes each one to its own text, so "6am",
// "6:30am", "7am" and "7:30am" never line up into columns and the block reads
// as ragged even when every chip in it is correct. For a list of times — where
// every option is the same KIND of thing — equal columns are what make it
// scannable.
//
// The width is measured rather than guessed at with percentages: RN has no
// calc(), and `width: '23%'` plus a gap overflows at some screen widths and
// leaves a gutter at others. COLUMNS chips plus COLUMNS-1 gaps, inside the
// screen's own padding, is exact at every size.
//
// It assumes the grid sits at the screen's horizontal padding with nothing
// inset further — which is why Collapsible's body below adds vertical padding
// only.

const COLUMNS = 4;

const GridChipWidth = createContext(0);

export function GridChipGroup({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const chipWidth = Math.floor(
    (width - spacing.md * 2 - spacing.sm * (COLUMNS - 1)) / COLUMNS
  );

  return (
    <GridChipWidth.Provider value={chipWidth}>
      <View style={styles.group}>{children}</View>
    </GridChipWidth.Provider>
  );
}

export function GridChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const chipWidth = useContext(GridChipWidth);

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        styles.gridChip,
        chipWidth > 0 ? { width: chipWidth } : null,
        selected && styles.chipOn,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text
        style={[
          styles.chipLabel,
          styles.gridChipLabel,
          selected && styles.chipLabelOn,
        ]}
        numberOfLines={1}
        // "10:30am" is the longest label and comes to about 56pt; a column on
        // a 375pt screen gives it 71pt, so this never fires there. It exists
        // for the narrowest phones still in use, where the alternative is an
        // ellipsis in the middle of a time.
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
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

  // A fixed column can't afford spacing.md either side and still fit
  // "11:30am", so a grid chip trades side padding and a point of type size
  // for alignment. 14pt is safe here: the 16pt floor is about TEXT INPUTS,
  // where a smaller size makes iOS zoom the page on focus. A button doesn't
  // take focus that way.
  gridChip: { paddingHorizontal: spacing.xs, alignItems: "center" },
  gridChipLabel: { fontSize: type.small, textAlign: "center" },

  collapsible: { gap: spacing.sm },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  summaryOpen: { borderColor: colors.green700 },
  summaryOff: { opacity: 0.5 },
  summaryLabel: {
    fontSize: type.body,
    fontWeight: "600",
    color: colors.ink900,
  },
  summaryValue: {
    flex: 1,
    textAlign: "right",
    fontSize: type.body,
    fontWeight: "700",
    color: colors.green700,
  },
  summaryPlaceholder: { fontWeight: "400", color: colors.ink500 },

  // Vertical only — see the note above GridChipGroup. Anything inset here
  // makes the measured column width wrong.
  body: { gap: spacing.sm, paddingBottom: spacing.xs },
});
