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
import { addDays, isTrip, OUTING_KINDS, tripLengthLabel, type OutingKind } from "@/lib/itinerary-rules";
import { closesLabel, irishToday, outingDateLabel, parseFee } from "@/lib/outing-rules";
import { loadClub, loadOuting, saveOuting } from "@/lib/outings";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/** "YYYY-MM-DD" ↔ a Date at local noon (noon: no time zone can tip it into another day). */
const toDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
};
const fromDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** What opens when a trip is chosen — the sections of its itinerary. */
const TRIP_SECTIONS = (kind: OutingKind) => [
  { icon: "location-outline" as const, title: "Location", body: kind === "abroad" ? "Where you're based, e.g. Vale do Lobo, Portugal" : "Where you're based, e.g. Ballybunion, Co. Kerry" },
  { icon: "calendar-outline" as const, title: "Days & dates", body: "A day for each date, from the first day to the last" },
  { icon: "flag-outline" as const, title: "Rounds & tee times", body: "A course each day, groups and start times" },
  { icon: "bed-outline" as const, title: "Accommodation", body: "Hotel, nights, who's in which room" },
  kind === "abroad"
    ? { icon: "airplane-outline" as const, title: "Flights & transfers", body: "Out and back, who's on which flight, the airport bus" }
    : { icon: "bus-outline" as const, title: "Travel", body: "Car-share or coach, where and when to meet" },
  { icon: "document-text-outline" as const, title: "Notes", body: "Dinners, dress code, kitty, what to pack" },
];

/**
 * A new society outing, or (with ?edit=<outingId>) changing one.
 * Captain, secretary or owner only — the database refuses anyone else.
 *
 * First the kind (0126): a day out (0125: one course, one date, a first
 * tee), or an overnight or abroad trip. A trip has a first and last day and
 * a place instead of a course; its rounds, flights, rooms and notes go on
 * its itinerary, which opens straight after it's created.
 */
export default function NewOutingScreen() {
  const { id: rawId, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const groupId = Number(rawId);
  const editId = edit ? Number(edit) : null;
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(editId != null);
  const [kind, setKind] = useState<OutingKind>("day");
  const [title, setTitle] = useState("");
  const [club, setClub] = useState<Club | null>(null);
  const [courseName, setCourseName] = useState<string | null>(null);
  const [playsOn, setPlaysOn] = useState(() => addDays(irishToday(), 14));
  const [endsOn, setEndsOn] = useState(() => addDays(irishToday(), 17));
  const [location, setLocation] = useState("");
  const [firstTee, setFirstTee] = useState("");
  const [feeText, setFeeText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [details, setDetails] = useState("");
  const [dateOpen, setDateOpen] = useState<"start" | "end" | null>(null);
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
        setKind(o.kind);
        setTitle(o.title);
        setPlaysOn(o.playsOn);
        if (o.endsOn) setEndsOn(o.endsOn);
        setLocation(o.location ?? "");
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

  const trip = isTrip(kind);
  const fee = parseFee(feeText);
  const max = maxText.trim() === "" ? null : /^\d{1,3}$/.test(maxText.trim()) ? Number(maxText.trim()) : undefined;
  const course = club?.name ?? courseName;

  const problem =
    title.trim() === ""
      ? `Give the ${trip ? "trip" : "outing"} a name`
      : !trip && !course
        ? "Choose the course"
        : playsOn < irishToday()
          ? "Choose a date from today on"
          : trip && endsOn <= playsOn
            ? "The last day is after the first"
            : trip && endsOn > addDays(playsOn, 20)
              ? "A trip is three weeks at most"
              : fee === undefined
                ? "The cost should be an amount, like 60"
                : max === undefined || max === 0
                  ? "Places should be a number"
                  : null;

  async function save() {
    if (problem) return;
    setSaving(true);
    try {
      const id = await saveOuting(groupId, editId, {
        kind,
        title: title.trim(),
        clubId: trip ? null : (club?.id ?? null),
        courseName: trip ? null : course,
        playsOn,
        endsOn: trip ? endsOn : null,
        location: trip ? location.trim() || null : null,
        firstTee: trip ? null : firstTee || null,
        details: details.trim() || null,
        entryFeeCents: fee ?? null,
        maxEntries: max ?? null,
      });
      if (trip && editId == null) {
        // Straight into building the itinerary, with the outing page behind it.
        router.replace({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(groupId), outingId: String(id) } });
        router.push({ pathname: "/group/[id]/itinerary/[outingId]", params: { id: String(groupId), outingId: String(id) } });
      } else {
        router.replace({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(groupId), outingId: String(id) } });
      }
    } catch (err) {
      Alert.alert(`Couldn't save the ${trip ? "trip" : "outing"}`, err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function pickKind(k: OutingKind) {
    setKind(k);
    // Keep a sensible last day when switching to a trip.
    if (isTrip(k) && endsOn <= playsOn) setEndsOn(addDays(playsOn, 3));
  }

  function setDate(which: "start" | "end", value: string) {
    if (which === "start") {
      // Move the last day with the first, keeping the trip's length.
      const days = Math.max(1, Math.round((toDate(endsOn).getTime() - toDate(playsOn).getTime()) / 86_400_000));
      setPlaysOn(value);
      setEndsOn(addDays(value, days));
    } else setEndsOn(value);
  }

  const today = toDate(irishToday());
  const latest = new Date(today);
  latest.setDate(latest.getDate() + 730);
  const pickerMin = dateOpen === "end" ? toDate(addDays(playsOn, 1)) : today;
  const pickerMax = dateOpen === "end" ? toDate(addDays(playsOn, 20)) : latest;
  const noun = trip ? "trip" : "outing";

  if (loading) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Edit event", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: editId ? (trip ? "Edit trip" : "Edit outing") : "New event", headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Section title="Name">
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={trip ? "e.g. Algarve 2027" : "e.g. Captain's Day"}
            placeholderTextColor={colors.ink500}
            style={styles.input}
            maxLength={80}
            accessibilityLabel={`Name of the ${noun}`}
          />
        </Section>

        <Section title="What kind of outing?">
          <View style={styles.kinds} accessibilityRole="radiogroup">
            {OUTING_KINDS.map((k) => {
              const on = kind === k.kind;
              return (
                <Pressable key={k.kind} style={[styles.kind, on && styles.kindOn]} onPress={() => pickKind(k.kind)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.kindTitle}>{k.label}</Text>
                    <Text style={styles.kindBlurb}>{k.blurb}</Text>
                  </View>
                  <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={24} color={on ? colors.navy900 : colors.line} />
                </Pressable>
              );
            })}
          </View>
        </Section>

        <View style={styles.pair}>
          <View style={{ flex: 1 }}>
            <Section title={trip ? "First day" : "Date"}>
              <Pressable
                style={styles.picker}
                onPress={() => {
                  setDraftDate(toDate(playsOn));
                  setDateOpen("start");
                }}
                accessibilityRole="button"
                accessibilityLabel={`${trip ? "First day" : "Date"}, ${outingDateLabel(playsOn)}. Change`}
              >
                <Ionicons name="calendar-outline" size={20} color={colors.navy900} />
                <Text style={styles.pickerText}>{outingDateLabel(playsOn)}</Text>
              </Pressable>
            </Section>
          </View>
          {trip ? (
            <View style={{ flex: 1 }}>
              <Section title="Last day">
                <Pressable
                  style={styles.picker}
                  onPress={() => {
                    setDraftDate(toDate(endsOn));
                    setDateOpen("end");
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Last day, ${outingDateLabel(endsOn)}. Change`}
                >
                  <Ionicons name="calendar-outline" size={20} color={colors.navy900} />
                  <Text style={styles.pickerText}>{outingDateLabel(endsOn)}</Text>
                </Pressable>
              </Section>
            </View>
          ) : null}
        </View>
        <Text style={styles.hint}>{closesLabel(playsOn)}</Text>

        {trip ? (
          <>
            <Section title="Location" hint="Optional. Where you're based.">
              <TextInput
                value={location}
                onChangeText={setLocation}
                placeholder={kind === "abroad" ? "e.g. Vale do Lobo, Portugal" : "e.g. Ballybunion, Co. Kerry"}
                placeholderTextColor={colors.ink500}
                style={styles.input}
                maxLength={120}
                accessibilityLabel="Location"
              />
            </Section>

            <View style={styles.unlocked} accessibilityLabel="The full itinerary">
              <Text style={styles.unlockedKicker}>FULL ITINERARY</Text>
              <Text style={styles.unlockedTitle}>{endsOn > playsOn ? `${tripLengthLabel(playsOn, endsOn)}${kind === "abroad" ? " abroad" : ""}` : "Your trip"}</Text>
              {TRIP_SECTIONS(kind).map((s) => (
                <View key={s.title} style={styles.unlockedRow}>
                  <Ionicons name={s.icon} size={18} color={colors.gold400} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.unlockedRowTitle}>{s.title}</Text>
                    <Text style={styles.unlockedRowBody}>{s.body}</Text>
                  </View>
                </View>
              ))}
              <Text style={styles.unlockedFoot}>{editId ? "Change these on the itinerary." : "You build these day by day as soon as the trip is created."}</Text>
            </View>
          </>
        ) : (
          <>
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
          </>
        )}

        <View style={styles.pair}>
          <View style={{ flex: 1 }}>
            <Section title={trip ? "Cost per person" : "Entry fee"} hint="Optional, in euro.">
              <TextInput
                value={feeText}
                onChangeText={setFeeText}
                placeholder={trip ? "e.g. 650" : "e.g. 60"}
                placeholderTextColor={colors.ink500}
                keyboardType="decimal-pad"
                style={[styles.input, fee === undefined && styles.inputBad]}
                accessibilityLabel={trip ? "Cost per person in euro" : "Entry fee in euro"}
              />
            </Section>
          </View>
          <View style={{ flex: 1 }}>
            <Section title="Places" hint="Optional limit.">
              <TextInput
                value={maxText}
                onChangeText={setMaxText}
                placeholder={trip ? "e.g. 12" : "e.g. 40"}
                placeholderTextColor={colors.ink500}
                keyboardType="number-pad"
                style={[styles.input, max === undefined && styles.inputBad]}
                accessibilityLabel="Number of places"
              />
            </Section>
          </View>
        </View>

        <Section title={trip ? "Trip notes" : "Details"} hint={trip ? "For every day: kitty, dress code, what to pack." : "What the fee covers, dress code, dinner, prizes — anything members should know."}>
          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder={trip ? "Kitty €100 each to the captain by 1 May. Collared shirts. Bring your passport." : "Green fee, soup and sandwich, prizes for the top three"}
            placeholderTextColor={colors.ink500}
            style={[styles.input, styles.multi]}
            multiline
            maxLength={1000}
            accessibilityLabel={trip ? "Trip notes" : "Details"}
          />
        </Section>

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <Pressable style={[styles.cta, (problem || saving) && styles.ctaOff]} onPress={() => void save()} disabled={!!problem || saving} accessibilityRole="button">
          {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.ctaText}>{editId ? "Save changes" : trip ? "Build the itinerary" : "Create the outing"}</Text>}
        </Pressable>
        {!editId ? (
          <Text style={styles.foot}>{trip ? "Members see it under Events and can join it straight away; the itinerary fills in as you add to it." : "It appears under Events for everyone in the society, and they can join it straight away."}</Text>
        ) : null}
      </ScrollView>

      <TimeSheet open={teeOpen} title="First tee" value={firstTee} onClose={() => setTeeOpen(false)} onChange={setFirstTee} />

      {Platform.OS === "ios" ? (
        <Modal visible={dateOpen != null} transparent animationType="slide" onRequestClose={() => setDateOpen(null)}>
          <Pressable style={styles.backdrop} onPress={() => setDateOpen(null)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <Text style={styles.sheetTitle}>{dateOpen === "end" ? "Last day of the trip" : trip ? "First day of the trip" : "Date of the outing"}</Text>
            <DateTimePicker value={draftDate} mode="date" display="spinner" minimumDate={pickerMin} maximumDate={pickerMax} onChange={(_e, d) => d && setDraftDate(d)} style={styles.wheel} />
            <Pressable
              style={styles.cta}
              onPress={() => {
                if (dateOpen) setDate(dateOpen, fromDate(draftDate));
                setDateOpen(null);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>Done</Text>
            </Pressable>
          </View>
        </Modal>
      ) : dateOpen ? (
        <DateTimePicker
          value={toDate(dateOpen === "end" ? endsOn : playsOn)}
          mode="date"
          minimumDate={pickerMin}
          maximumDate={pickerMax}
          onChange={(e: DateTimePickerEvent, d?: Date) => {
            const which = dateOpen;
            setDateOpen(null);
            if (e.type === "set" && d) setDate(which, fromDate(d));
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
  kinds: { gap: spacing.sm },
  kind: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 64, padding: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceTint },
  kindOn: { borderWidth: 2, borderColor: colors.navy900, backgroundColor: colors.surface },
  kindTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  kindBlurb: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  picker: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pickerText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  hint: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, marginTop: -spacing.sm },
  change: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  pair: { flexDirection: "row", gap: spacing.sm },
  unlocked: { gap: 12, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  unlockedKicker: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.4, color: colors.gold400 },
  unlockedTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50, marginTop: -6 },
  unlockedRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  unlockedRowTitle: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.cream50 },
  unlockedRowBody: { fontFamily: fonts.body, fontSize: 13, color: colors.cream100 },
  unlockedFoot: { fontFamily: fonts.body, fontSize: 12.5, color: colors.cream100 },
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
