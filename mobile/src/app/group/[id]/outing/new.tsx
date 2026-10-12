import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CourseSearch } from "@/components/course-search";
import { Section } from "@/components/form-bits";
import { TimeSheet } from "@/components/time-sheet";
import { placeLabel, type Club } from "@/lib/courses";
import { closesLabel, irishToday, outingDateLabel, parseFee } from "@/lib/outing-rules";
import { loadClub, loadOuting, saveOuting } from "@/lib/outings";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/** "YYYY-MM-DD" ↔ a Date at local noon (noon: no time zone can tip it into another day). */
const toDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
};
const fromDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * A new society outing, or (with ?edit=<outingId>) changing one (0125).
 * Captain, secretary or owner only — the database refuses anyone else.
 *
 * The date is picked on a scroll wheel; the first tee on the clock wheel the
 * tee-time screens use. Entries then stay open until midnight at the start
 * of the day, which the form spells out.
 */
export default function NewOutingScreen() {
  const { id: rawId, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const groupId = Number(rawId);
  const editId = edit ? Number(edit) : null;
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(editId != null);
  const [title, setTitle] = useState("");
  const [club, setClub] = useState<Club | null>(null);
  const [courseName, setCourseName] = useState<string | null>(null);
  const [playsOn, setPlaysOn] = useState(() => {
    const d = toDate(irishToday());
    d.setDate(d.getDate() + 14);
    return fromDate(d);
  });
  const [firstTee, setFirstTee] = useState("");
  const [feeText, setFeeText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [details, setDetails] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(() => toDate(playsOn));
  const [teeOpen, setTeeOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editId == null) return;
    void (async () => {
      try {
        const page = await loadOuting(editId);
        if (!page) return;
        const o = page.outing;
        setTitle(o.title);
        setPlaysOn(o.playsOn);
        setFirstTee(o.firstTee ? o.firstTee.slice(0, 5) : "");
        setFeeText(o.entryFeeCents != null ? (o.entryFeeCents / 100).toFixed(o.entryFeeCents % 100 ? 2 : 0) : "");
        setMaxText(o.maxEntries != null ? String(o.maxEntries) : "");
        setDetails(o.details ?? "");
        setCourseName(o.courseName);
        if (o.clubId) setClub(await loadClub(o.clubId));
      } finally {
        setLoading(false);
      }
    })();
  }, [editId]);

  const fee = parseFee(feeText);
  const max = maxText.trim() === "" ? null : /^\d{1,3}$/.test(maxText.trim()) ? Number(maxText.trim()) : undefined;
  const course = club?.name ?? courseName;

  const problem =
    title.trim() === ""
      ? "Give the outing a name"
      : !course
        ? "Choose the course"
        : playsOn < irishToday()
          ? "Choose a date from today on"
          : fee === undefined
            ? "The entry fee should be an amount, like 60"
            : max === undefined || max === 0
              ? "Places should be a number"
              : null;

  async function save() {
    if (problem || !course) return;
    setSaving(true);
    try {
      const id = await saveOuting(groupId, editId, {
        title: title.trim(),
        clubId: club?.id ?? null,
        courseName: course,
        playsOn,
        firstTee: firstTee || null,
        details: details.trim() || null,
        entryFeeCents: fee ?? null,
        maxEntries: max ?? null,
      });
      router.replace({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(groupId), outingId: String(id) } });
    } catch (err) {
      Alert.alert("Couldn't save the outing", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const today = toDate(irishToday());
  const latest = new Date(today);
  latest.setDate(latest.getDate() + 730);

  if (loading) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Edit outing", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: editId ? "Edit outing" : "New outing", headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Section title="Name">
          <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Captain's Day" placeholderTextColor={colors.ink500} style={styles.input} maxLength={80} accessibilityLabel="Name of the outing" />
        </Section>

        <Section title="Date" hint={closesLabel(playsOn)}>
          <Pressable
            style={styles.picker}
            onPress={() => {
              setDraftDate(toDate(playsOn));
              setDateOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Date, ${outingDateLabel(playsOn)}. Change`}
          >
            <Ionicons name="calendar-outline" size={20} color={colors.navy900} />
            <Text style={styles.pickerText}>{outingDateLabel(playsOn)}</Text>
            <Text style={styles.change}>Change</Text>
          </Pressable>
        </Section>

        <Section title="Course">
          {course ? (
            <View style={styles.picker}>
              <Ionicons name="flag-outline" size={20} color={colors.navy900} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerText}>{course}</Text>
                {club ? <Text style={styles.meta}>{placeLabel(club)}</Text> : null}
              </View>
              <Pressable
                onPress={() => {
                  setClub(null);
                  setCourseName(null);
                }}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={styles.change}>Change</Text>
              </Pressable>
            </View>
          ) : (
            <CourseSearch placeholder="Search for the course" onPick={setClub} />
          )}
        </Section>

        <Section title="First tee" hint="Optional. The draw spaces the groups from here.">
          <Pressable style={styles.picker} onPress={() => setTeeOpen(true)} accessibilityRole="button" accessibilityLabel={`First tee, ${firstTee || "not set"}. Change`}>
            <Ionicons name="time-outline" size={20} color={colors.navy900} />
            <Text style={styles.pickerText}>{firstTee || "Not set"}</Text>
            <Text style={styles.change}>{firstTee ? "Change" : "Set"}</Text>
          </Pressable>
        </Section>

        <View style={styles.pair}>
          <View style={{ flex: 1 }}>
            <Section title="Entry fee" hint="Optional, in euro.">
              <TextInput
                value={feeText}
                onChangeText={setFeeText}
                placeholder="e.g. 60"
                placeholderTextColor={colors.ink500}
                keyboardType="decimal-pad"
                style={[styles.input, fee === undefined && styles.inputBad]}
                accessibilityLabel="Entry fee in euro"
              />
            </Section>
          </View>
          <View style={{ flex: 1 }}>
            <Section title="Places" hint="Optional limit.">
              <TextInput
                value={maxText}
                onChangeText={setMaxText}
                placeholder="e.g. 40"
                placeholderTextColor={colors.ink500}
                keyboardType="number-pad"
                style={[styles.input, max === undefined && styles.inputBad]}
                accessibilityLabel="Number of places"
              />
            </Section>
          </View>
        </View>

        <Section title="Details" hint="What the fee covers, dress code, dinner, prizes — anything members should know.">
          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder="Green fee, soup and sandwich, prizes for the top three"
            placeholderTextColor={colors.ink500}
            style={[styles.input, styles.multi]}
            multiline
            maxLength={1000}
            accessibilityLabel="Details"
          />
        </Section>

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <Pressable style={[styles.cta, (problem || saving) && styles.ctaOff]} onPress={() => void save()} disabled={!!problem || saving} accessibilityRole="button">
          {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.ctaText}>{editId ? "Save changes" : "Create the outing"}</Text>}
        </Pressable>
        {!editId ? <Text style={styles.foot}>It appears under Events for everyone in the society, and they can join it straight away.</Text> : null}
      </ScrollView>

      <TimeSheet open={teeOpen} title="First tee" value={firstTee} onClose={() => setTeeOpen(false)} onChange={setFirstTee} />

      {Platform.OS === "ios" ? (
        <Modal visible={dateOpen} transparent animationType="slide" onRequestClose={() => setDateOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setDateOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <Text style={styles.sheetTitle}>Date of the outing</Text>
            <DateTimePicker value={draftDate} mode="date" display="spinner" minimumDate={today} maximumDate={latest} onChange={(_e, d) => d && setDraftDate(d)} style={styles.wheel} />
            <Pressable
              style={styles.cta}
              onPress={() => {
                setPlaysOn(fromDate(draftDate));
                setDateOpen(false);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>Done</Text>
            </Pressable>
          </View>
        </Modal>
      ) : dateOpen ? (
        <DateTimePicker
          value={toDate(playsOn)}
          mode="date"
          minimumDate={today}
          maximumDate={latest}
          onChange={(e: DateTimePickerEvent, d?: Date) => {
            setDateOpen(false);
            if (e.type === "set" && d) setPlaysOn(fromDate(d));
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  inputBad: { borderColor: colors.red600 },
  multi: { minHeight: 96, paddingTop: 12, textAlignVertical: "top" },
  picker: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pickerText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  change: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  pair: { flexDirection: "row", gap: spacing.sm },
  problem: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600, textAlign: "center" },
  cta: { minHeight: 52, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  ctaOff: { opacity: 0.5 },
  ctaText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  foot: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(12,32,56,0.35)" },
  sheet: { backgroundColor: colors.cream50, padding: spacing.md, gap: spacing.sm, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
  sheetTitle: { fontFamily: fonts.bodyBold, fontSize: type.heading, color: colors.ink900, textAlign: "center" },
  wheel: { alignSelf: "stretch" },
});
