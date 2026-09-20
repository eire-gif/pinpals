import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import { Collapsible } from "./form-bits";
import { clockLabel, dateToTime, timeToDate } from "@/lib/tee-time-post";
import { colors, radii, spacing, type } from "@/lib/theme";

/**
 * A real clock, for the one field that needs one.
 *
 * The half-hourly slot grid is the right control for a preference — "from
 * about 8am" — and the wrong one for a fact. A booked tee time is 8:10, or
 * 9:42: clubs send fourballs off at seven-to-ten minute intervals, so no
 * half-hourly list can express one. Before this, a host who had actually
 * booked a time either rounded it — telling three other people to be at the
 * first tee twenty minutes late — or gave up and used the range instead,
 * which is the opposite of what the switch above it promises.
 *
 * This is the only native module in the app, and it is here rather than
 * everywhere for that reason: it buys precision where precision is the point,
 * and nowhere else.
 */
export function ExactTimeChoice({
  value,
  onChange,
  open,
  onToggle,
}: {
  value: string | null;
  onChange: (time: string) => void;
  open: boolean;
  onToggle: () => void;
}) {
  // The wheel is edited as a draft and committed on Done. iOS's inline
  // spinner has no notion of confirming — it just reports every nudge — so
  // without this, opening the picker and changing nothing would leave the
  // field empty while a time sat plainly visible on screen.
  const [draft, setDraft] = useState(() => timeToDate(value));

  useEffect(() => {
    if (open) setDraft(timeToDate(value));
  }, [open, value]);

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    if (date) setDraft(date);

    // Android puts this in a modal dialog that reports its own OK and Cancel,
    // so there it is committed on "set" and there is no Done button below.
    if (Platform.OS !== "ios") {
      if (event.type === "set" && date) onChange(dateToTime(date));
      onToggle();
    }
  };

  return (
    <Collapsible
      label="Tee time"
      value={value ? clockLabel(value) : null}
      placeholder="Choose a time"
      open={open}
      onToggle={onToggle}
    >
      <View style={styles.wheel}>
        <DateTimePicker
          value={draft}
          mode="time"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          // Every minute, which is the entire reason this control exists.
          minuteInterval={1}
          onChange={handleChange}
        />
      </View>

      {Platform.OS === "ios" ? (
        <Pressable
          accessibilityRole="button"
          style={styles.done}
          onPress={() => {
            onChange(dateToTime(draft));
            onToggle();
          }}
        >
          <Text style={styles.doneLabel}>Use this time</Text>
        </Pressable>
      ) : null}
    </Collapsible>
  );
}

const styles = StyleSheet.create({
  wheel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  done: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.green100,
  },
  doneLabel: {
    fontSize: type.body,
    fontWeight: "700",
    color: colors.green800,
  },
});
