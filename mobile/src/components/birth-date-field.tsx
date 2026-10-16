import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { dateToIso, isoToDate } from "@/components/date-sheet";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A date of birth (junior members, 0159): sign-up and the one-off "add your
 * date of birth" screen.
 *
 * DateSheet (date-sheet.tsx) is the app's date picker, but it picks days
 * AHEAD — today, tomorrow, the weekend — and won't go into the past. This is
 * the same wheel-in-a-sheet on iOS and the system calendar on Android, the
 * other way round: up to today, back to 1900, no quick picks.
 *
 * Deliberately neutral. The wheel opens on a date that says nothing about a
 * minimum age, and nothing here mentions one: the server decides.
 */

/** Where the wheel starts when nothing is picked yet. */
const START = "2000-01-01";
const EARLIEST = new Date(1900, 0, 1);

/** "14 June 1979". */
export const birthdayLabel = (iso: string): string =>
  isoToDate(iso).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });

export function BirthDateField({
  value,
  onChange,
  label = "Date of birth",
}: {
  /** YYYY-MM-DD, or "" for none yet. */
  value: string;
  onChange: (iso: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(() => isoToDate(value || START));
  useEffect(() => {
    if (open) setDraft(isoToDate(value || START));
  }, [open, value]);

  const today = new Date();

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.input, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}, ${birthdayLabel(value)}. Change` : `${label}. Choose`}
      >
        <Text style={[styles.value, !value && styles.placeholder]}>{value ? birthdayLabel(value) : "Choose a date"}</Text>
        <Ionicons name="calendar-outline" size={19} color={colors.ink500} />
      </Pressable>

      {Platform.OS !== "ios" ? (
        open ? (
          <DateTimePicker
            value={draft}
            mode="date"
            minimumDate={EARLIEST}
            maximumDate={today}
            onChange={(e: DateTimePickerEvent, d?: Date) => {
              setOpen(false);
              if (e.type === "set" && d) onChange(dateToIso(d));
            }}
          />
        ) : null
      ) : (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.grabber} />
            <Text style={styles.title}>{label}</Text>
            <DateTimePicker
              value={draft}
              mode="date"
              display="spinner"
              minimumDate={EARLIEST}
              maximumDate={today}
              onChange={(_e, d) => d && setDraft(d)}
              style={styles.wheel}
            />
            <Pressable
              onPress={() => {
                onChange(dateToIso(draft));
                setOpen(false);
              }}
              style={({ pressed }) => [styles.use, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
            >
              <Text style={styles.useLabel}>Use {birthdayLabel(dateToIso(draft))}</Text>
            </Pressable>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontFamily: fonts.bodyBold, fontSize: type.label, color: colors.ink900 },
  input: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  value: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  placeholder: { color: colors.ink500 },
  backdrop: { flex: 1, backgroundColor: "rgba(14,21,32,0.4)" },
  sheet: { backgroundColor: colors.cream50, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8, paddingHorizontal: spacing.md, gap: spacing.sm },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: 4 },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900, textAlign: "center" },
  wheel: { alignSelf: "stretch" },
  use: { minHeight: 50, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  useLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
