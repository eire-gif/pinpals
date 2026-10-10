import { createContext, useContext, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { colors, fonts, radii, spacing, type } from "@/lib/theme";

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
  icon,
  children,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  disabled?: boolean;
  open: boolean;
  onToggle: () => void;
  /** An Ionicons name, drawn in a tinted disc at the start of the row. */
  icon?: keyof typeof Ionicons.glyphMap;
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
        {icon ? (
          <View style={[styles.iconDisc, value ? styles.iconDiscOn : null]}>
            <Ionicons name={icon} size={17} color={value ? colors.cream50 : colors.green700} />
          </View>
        ) : null}
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
// Picture tiles
// ===========================================================================

/**
 * A choice shown as a grid of tiles with a picture on each (Oct 2026: the
 * marketplace's categories — "Drivers", "Putters" — read faster as a club
 * than as a word in a dropdown). Three across; the chosen one fills green.
 */
export type Tile = { key: string; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap };

export function TileGrid({
  tiles,
  selected,
  onPick,
  inset = 0,
}: {
  tiles: readonly Tile[];
  selected: string | null;
  onPick: (key: string) => void;
  /** Extra horizontal padding around the grid (inside a card). */
  inset?: number;
}) {
  const { width } = useWindowDimensions();
  const w = Math.floor((width - spacing.md * 2 - inset - spacing.sm * 2) / 3);
  return (
    <View style={styles.group}>
      {tiles.map((t) => {
        const on = t.key === selected;
        return (
          <Pressable
            key={t.key}
            onPress={() => onPick(t.key)}
            style={({ pressed }) => [styles.tile, { width: w }, on && styles.tileOn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
          >
            <View style={[styles.tileDisc, on && styles.tileDiscOn]}>
              <MaterialCommunityIcons name={t.icon} size={24} color={on ? colors.green700 : colors.green700} />
            </View>
            <Text style={[styles.tileLabel, on && styles.tileLabelOn]} numberOfLines={2}>
              {t.label}
            </Text>
            {on ? <Ionicons name="checkmark-circle" size={18} color={colors.gold400} style={styles.tileTick} /> : null}
          </Pressable>
        );
      })}
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
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    shadowColor: colors.navy900,
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  summaryOpen: { borderColor: colors.green700, borderWidth: 1.5 },
  iconDisc: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  iconDiscOn: { backgroundColor: colors.green700 },
  tile: {
    minHeight: 96,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 10,
    gap: 6,
    shadowColor: colors.navy900,
    shadowOpacity: 0.05,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  tileOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  tileDisc: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  tileDiscOn: { backgroundColor: colors.cream50 },
  tileLabel: { fontFamily: fonts.bodySemi, fontSize: 13.5, lineHeight: 17, color: colors.ink900, textAlign: "center" },
  tileLabelOn: { color: colors.cream50 },
  tileTick: { position: "absolute", top: 6, right: 6 },
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
