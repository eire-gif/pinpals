import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A date, picked on a scroll wheel in a sheet from the bottom — the partner
 * of TimeSheet (Oct 2026: setting up a group's round days or weeks ahead).
 * Quick picks above the wheel for the usual answers: today, tomorrow, the
 * coming weekend. Android shows its own calendar dialog instead.
 *
 * Dates go in and out as "YYYY-MM-DD" in the phone's own calendar, which for
 * PinPals' golfers is Irish time.
 */
export function DateSheet({
  open,
  title,
  value,
  maxDaysAhead = 730,
  onClose,
  onChange,
}: {
  open: boolean;
  title: string;
  /** YYYY-MM-DD */
  value: string;
  maxDaysAhead?: number;
  onClose: () => void;
  onChange: (iso: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(() => isoToDate(value));
  useEffect(() => {
    if (open) setDraft(isoToDate(value));
  }, [open, value]);

  const today = startOfDay(new Date());
  const max = addDays(today, maxDaysAhead);

  if (Platform.OS !== "ios") {
    return open ? (
      <DateTimePicker
        value={draft}
        mode="date"
        minimumDate={today}
        maximumDate={max}
        onChange={(e: DateTimePickerEvent, d?: Date) => {
          if (e.type === "set" && d) onChange(dateToIso(d));
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
        <View style={styles.quick}>
          {quickDays(today).map((q) => (
            <Pressable
              key={q.label}
              onPress={() => {
                onChange(dateToIso(q.date));
                onClose();
              }}
              style={({ pressed }) => [styles.quickChip, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`${q.label}, ${dayLabel(dateToIso(q.date))}`}
            >
              <Text style={styles.quickDay}>{q.label}</Text>
              <Text style={styles.quickDate}>{shortDate(q.date)}</Text>
            </Pressable>
          ))}
        </View>
        <DateTimePicker
          value={draft}
          mode="date"
          display="spinner"
          minimumDate={today}
          maximumDate={max}
          onChange={(_e, d) => d && setDraft(d)}
          style={styles.wheel}
        />
        <Pressable
          onPress={() => {
            onChange(dateToIso(draft));
            onClose();
          }}
          style={({ pressed }) => [styles.use, pressed && { opacity: 0.9 }]}
          accessibilityRole="button"
        >
          <Text style={styles.useLabel}>Use {dayLabel(dateToIso(draft))}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Dates as the phone's calendar sees them
// ---------------------------------------------------------------------------

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const dateToIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function isoToDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : startOfDay(new Date());
}

const shortDate = (d: Date) => d.toLocaleDateString("en-IE", { day: "numeric", month: "short" });

/** "Today", "Tomorrow", or "Sat 18 Oct" (with the year when it isn't this year's). */
export function dayLabel(iso: string): string {
  const d = isoToDate(iso);
  const today = startOfDay(new Date());
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString("en-IE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** Today, tomorrow, and the coming Saturday and Sunday (skipping any already listed). */
function quickDays(today: Date): { label: string; date: Date }[] {
  const out = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
  ];
  const toSat = (6 - today.getDay() + 7) % 7;
  for (const [label, n] of [["Saturday", toSat], ["Sunday", toSat + 1]] as const) {
    if (n > 1) out.push({ label, date: addDays(today, n) });
  }
  return out;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(14,21,32,0.4)" },
  sheet: { backgroundColor: colors.cream50, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8, paddingHorizontal: spacing.md, gap: spacing.sm },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: 4 },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900, textAlign: "center" },
  quick: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "center" },
  quickChip: { alignItems: "center", paddingVertical: 8, paddingHorizontal: 14, borderRadius: radii.md, backgroundColor: colors.green100 },
  quickDay: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.green800 },
  quickDate: { fontFamily: fonts.body, fontSize: 11.5, color: colors.green800 },
  wheel: { alignSelf: "stretch" },
  use: { minHeight: 50, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  useLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
