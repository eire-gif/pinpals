import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { clockLabel, dateToTime, timeToDate } from "@/lib/tee-time-post";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A tee time, picked on a clock wheel in a sheet from the bottom (Oct 2026:
 * typing "09:20" on the punctuation keyboard was the hard way). Optional
 * quick picks above the wheel — for a match day, the slot after the last
 * group. Android shows its own clock dialog instead.
 */
export function TimeSheet({
  open,
  title,
  value,
  suggestions = [],
  onClose,
  onChange,
}: {
  open: boolean;
  title: string;
  /** HH:MM or "" */
  value: string;
  suggestions?: { label: string; time: string }[];
  onClose: () => void;
  onChange: (time: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(() => timeToDate(value || null, 9));
  useEffect(() => {
    if (open) setDraft(timeToDate(value || null, 9));
  }, [open, value]);

  if (Platform.OS !== "ios") {
    return open ? (
      <DateTimePicker
        value={draft}
        mode="time"
        minuteInterval={1}
        onChange={(e: DateTimePickerEvent, d?: Date) => {
          if (e.type === "set" && d) onChange(dateToTime(d));
          onClose();
        }}
      />
    ) : null;
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>{title}</Text>
        {suggestions.length > 0 ? (
          <View style={styles.quick}>
            {suggestions.map((s) => (
              <Pressable
                key={s.label}
                onPress={() => {
                  onChange(s.time);
                  onClose();
                }}
                style={({ pressed }) => [styles.quickChip, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
              >
                <Text style={styles.quickTime}>{clockLabel(s.time)}</Text>
                <Text style={styles.quickLabel}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <DateTimePicker value={draft} mode="time" display="spinner" minuteInterval={1} onChange={(_e, d) => d && setDraft(d)} style={styles.wheel} />
        <View style={styles.buttons}>
          {value ? (
            <Pressable
              onPress={() => {
                onChange("");
                onClose();
              }}
              style={styles.clear}
              accessibilityRole="button"
            >
              <Text style={styles.clearLabel}>No time</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              onChange(dateToTime(draft));
              onClose();
            }}
            style={({ pressed }) => [styles.use, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
          >
            <Text style={styles.useLabel}>Use {clockLabel(dateToTime(draft))}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(14,21,32,0.4)" },
  sheet: { backgroundColor: colors.cream50, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8, paddingHorizontal: spacing.md, gap: spacing.sm },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: 4 },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900, textAlign: "center" },
  quick: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "center" },
  quickChip: { alignItems: "center", paddingVertical: 8, paddingHorizontal: 14, borderRadius: radii.md, backgroundColor: colors.green100 },
  quickTime: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.green800 },
  quickLabel: { fontFamily: fonts.body, fontSize: 11.5, color: colors.green800 },
  wheel: { alignSelf: "stretch" },
  buttons: { flexDirection: "row", gap: spacing.sm },
  clear: { paddingHorizontal: spacing.lg, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line },
  clearLabel: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink500 },
  use: { flex: 1, minHeight: 50, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  useLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
