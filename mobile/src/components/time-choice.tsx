import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Chip, Collapsible, GridChip, GridChipGroup } from "./form-bits";
import {
  TIME_BANDS,
  bandFor,
  bandLabel,
  clockLabel,
  slotsInBand,
} from "@/lib/tee-time-post";
import { colors, radii, spacing, type } from "@/lib/theme";

/**
 * One time, chosen in two taps.
 *
 * It replaces a flat grid of all twenty-nine half-hourly slots. Two of those
 * grids stacked — From and Until — put fifty-eight buttons between "what day"
 * and "how many spaces", which is what the screen looked like before this.
 *
 * Closed, it is a single row that says what is chosen. Open, it asks for the
 * part of the day first and then shows only that band. The band the member
 * already picked is the one that opens, so changing 8am to 9am is two taps
 * and never a hunt.
 */
export function TimeChoice({
  label,
  value,
  onChange,
  open,
  onToggle,
  placeholder,
  disabled = false,
  disabledHint,
  after = null,
  clearable = false,
}: {
  label: string;
  value: string | null;
  onChange: (slot: string | null) => void;
  open: boolean;
  onToggle: () => void;
  placeholder: string;
  disabled?: boolean;
  /** Shown in place of the placeholder when disabled — a greyed row with no
   *  explanation reads as broken rather than as not-yet. */
  disabledHint?: string;
  /** Only offer slots strictly later than this one. */
  after?: string | null;
  clearable?: boolean;
}) {
  const [band, setBand] = useState(() => bandFor(value));

  // Opening should land on the band the member last chose, not wherever they
  // were browsing when they closed it.
  useEffect(() => {
    if (open) setBand(bandFor(value));
  }, [open, value]);

  const slots = slotsInBand(band, after);

  const choose = (slot: string | null) => {
    onChange(slot);
    // Picking closes it. The answer is now visible in the summary row, and
    // leaving it open just puts the next question below a wall of chips.
    onToggle();
  };

  return (
    <Collapsible
      label={label}
      value={value ? clockLabel(value) : null}
      placeholder={disabled ? (disabledHint ?? placeholder) : placeholder}
      disabled={disabled}
      open={open}
      onToggle={onToggle}
    >
      <View style={styles.bands}>
        {TIME_BANDS.map((b) => (
          <Chip
            key={b.key}
            label={b.label}
            selected={band === b.key}
            onPress={() => setBand(b.key)}
          />
        ))}
      </View>

      {slots.length === 0 ? (
        <Text style={styles.none}>
          {after
            ? `Nothing after ${clockLabel(after)} that ${bandLabel(band).toLowerCase()}.`
            : `No times that ${bandLabel(band).toLowerCase()}.`}
        </Text>
      ) : (
        <GridChipGroup>
          {slots.map((slot) => (
            <GridChip
              key={slot}
              label={clockLabel(slot)}
              selected={value === slot}
              onPress={() => choose(slot)}
            />
          ))}
        </GridChipGroup>
      )}

      {clearable && value ? (
        <Pressable
          onPress={() => choose(null)}
          accessibilityRole="button"
          style={styles.clear}
        >
          <Text style={styles.clearLabel}>Clear</Text>
        </Pressable>
      ) : null}
    </Collapsible>
  );
}

const styles = StyleSheet.create({
  bands: { flexDirection: "row", gap: spacing.sm },
  none: { fontSize: type.small, color: colors.ink500 },
  clear: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: radii.pill,
  },
  clearLabel: {
    fontSize: type.small,
    fontWeight: "700",
    color: colors.ink500,
  },
});
