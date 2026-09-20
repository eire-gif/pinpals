import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { Chip, Collapsible, GridChip, GridChipGroup } from "./form-bits";
import {
  monthBandFor,
  monthBands,
  type DayOption,
} from "@/lib/tee-time-post";
import { spacing } from "@/lib/theme";

/**
 * One date, chosen in two taps.
 *
 * It replaces a flat grid of all forty-two days — six weeks laid out at once,
 * which meant scrolling past the whole of October to reach "how many spaces".
 * That was the longest chip wall on the form, worse than either of the time
 * grids it sat above.
 *
 * Same shape as TimeChoice, deliberately: a closed row saying what is chosen,
 * a band to narrow by, then a short even grid. Two controls that ask the same
 * kind of question should not be answered two different ways.
 *
 * The month band row hides itself when the window falls inside one month,
 * since a single band chip is a label pretending to be a choice.
 */
export function DayChoice({
  days,
  value,
  onChange,
  open,
  onToggle,
}: {
  days: DayOption[];
  value: string | null;
  onChange: (iso: string) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const bands = useMemo(() => monthBands(days), [days]);
  const [band, setBand] = useState(() => monthBandFor(value, bands));

  // Opening lands on the month of the chosen date, not wherever the member
  // was browsing when they last closed it.
  useEffect(() => {
    if (open) setBand(monthBandFor(value, bands));
  }, [open, value, bands]);

  const current = bands.find((b) => b.key === band) ?? bands[0];
  const chosen = days.find((d) => d.iso === value) ?? null;

  return (
    <Collapsible
      label="Day"
      value={chosen?.label ?? null}
      placeholder="Choose a day"
      open={open}
      onToggle={onToggle}
    >
      {bands.length > 1 ? (
        <View style={styles.bands}>
          {bands.map((b) => (
            <Chip
              key={b.key}
              label={b.label}
              selected={band === b.key}
              onPress={() => setBand(b.key)}
            />
          ))}
        </View>
      ) : null}

      <GridChipGroup>
        {current?.days.map((day) => (
          <GridChip
            key={day.iso}
            label={day.short}
            selected={value === day.iso}
            onPress={() => {
              onChange(day.iso);
              onToggle();
            }}
          />
        ))}
      </GridChipGroup>
    </Collapsible>
  );
}

const styles = StyleSheet.create({
  bands: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
