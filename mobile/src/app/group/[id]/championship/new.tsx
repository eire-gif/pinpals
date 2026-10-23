import { useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CourseSearch } from "@/components/course-search";
import { Section } from "@/components/form-bits";
import { TimeSheet } from "@/components/time-sheet";
import { DAY_FORMATS, canAddUp, dayFormat, resolveRule, ruleLine, type ChampionshipRule, type DayFormat } from "@/lib/championship";
import { championshipProblem, saveChampionship } from "@/lib/championships";
import { placeLabel, type Club } from "@/lib/courses";
import { addDays } from "@/lib/itinerary-rules";
import { irishToday, outingDateLabel, parseFee } from "@/lib/outing-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

const toDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
};
const fromDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Day = { playsOn: string; club: Club | null; firstTee: string; format: DayFormat };

/**
 * A new multi-day championship (0187), as approved on the "PinPals —
 * multi-round leaderboard" canvas: 2, 3 or 4 days, each with its own course,
 * first tee and format (the same every day, or different each day), and a
 * line saying how the days add up — scores added when every day is scored
 * the same way, places points when they mix. Each day becomes an ordinary
 * day out under Events, with its own entries, draw and live day.
 */
export default function NewChampionshipScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(rawId);
  const insets = useSafeAreaInsets();

  const start = addDays(irishToday(), 14);
  const [title, setTitle] = useState("");
  const [days, setDays] = useState<Day[]>(() => [0, 1, 2].map((k) => ({ playsOn: addDays(start, k), club: null, firstTee: "08:30", format: "stableford" })));
  const [sameFormat, setSameFormat] = useState(true);
  const [active, setActive] = useState(0);
  const [placesRule, setPlacesRule] = useState(false);
  const [feeText, setFeeText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [details, setDetails] = useState("");
  const [dateFor, setDateFor] = useState<number | null>(null);
  const [draftDate, setDraftDate] = useState(new Date());
  const [teeFor, setTeeFor] = useState<number | null>(null);
  const [courseFor, setCourseFor] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const setDay = (i: number, d: Partial<Day>) => setDays((cur) => cur.map((x, k) => (k === i ? { ...x, ...d } : x)));
  function setCount(n: number) {
    setDays((cur) => {
      if (n <= cur.length) return cur.slice(0, n);
      const out = [...cur];
      while (out.length < n) {
        const last = out[out.length - 1];
        out.push({ playsOn: addDays(last.playsOn, 1), club: null, firstTee: last.firstTee, format: last.format });
      }
      return out;
    });
    setActive((a) => Math.min(a, n - 1));
  }
  function pickFormat(f: DayFormat) {
    if (sameFormat) setDays((cur) => cur.map((d) => ({ ...d, format: f })));
    else setDay(active, { format: f });
  }
  /** Moving a day's date keeps the days after it in order. */
  function moveDate(i: number, value: string) {
    setDays((cur) => {
      const out = cur.map((d, k) => (k === i ? { ...d, playsOn: value } : d));
      for (let k = i + 1; k < out.length; k++) if (out[k].playsOn <= out[k - 1].playsOn) out[k] = { ...out[k], playsOn: addDays(out[k - 1].playsOn, 1) };
      return out;
    });
  }

  const kinds = days.map((d) => dayFormat(d.format).kind);
  const rule: ChampionshipRule = placesRule ? "places" : "auto";
  const line = ruleLine(resolveRule(rule, kinds), kinds);
  const fee = parseFee(feeText);
  const max = maxText.trim() ? Number(maxText.trim()) : null;
  const input = {
    title,
    rule,
    entryFeeCents: fee ?? null,
    maxEntries: max != null && Number.isInteger(max) ? max : null,
    details,
    days: days.map((d) => ({ playsOn: d.playsOn, clubId: d.club?.id ?? null, courseName: d.club?.name ?? "", firstTee: d.firstTee || null, format: d.format })),
  };
  const problem = championshipProblem(input) ?? (fee === undefined ? "That entry fee doesn't look right." : max != null && (!Number.isInteger(max) || max < 1 || max > 500) ? "Places are between 1 and 500." : null);
  const shownFormat = sameFormat ? days[0].format : days[active].format;

  async function save() {
    if (problem) return;
    setSaving(true);
    try {
      const id = await saveChampionship(groupId, null, input);
      router.replace({ pathname: "/group/[id]/championship/[cid]", params: { id: String(groupId), cid: String(id) } });
    } catch (err) {
      Alert.alert("Couldn't create the championship", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: "Multi-day championship", headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Section title="Event name">
          <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Autumn Classic 2026" placeholderTextColor={colors.ink500} style={styles.input} maxLength={80} accessibilityLabel="Event name" />
        </Section>

        <Section title="How many days?">
          <View style={styles.row} accessibilityRole="radiogroup">
            {[2, 3, 4].map((n) => {
              const on = days.length === n;
              return (
                <Pressable key={n} style={[styles.seg, on && styles.segOn]} onPress={() => setCount(n)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                  <Text style={[styles.segText, on && styles.segTextOn]}>{n} days</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section title="Format">
          <View style={styles.row} accessibilityRole="radiogroup">
            {[true, false].map((same) => {
              const on = sameFormat === same;
              return (
                <Pressable
                  key={String(same)}
                  style={[styles.seg, on && styles.segOn]}
                  onPress={() => {
                    setSameFormat(same);
                    if (same) setDays((cur) => cur.map((d) => ({ ...d, format: cur[0].format })));
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.segText, on && styles.segTextOn]}>{same ? "Same every day" : "Different each day"}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={sameFormat ? "Format for every day" : `Format for day ${active + 1}`}>
            {DAY_FORMATS.map((f) => {
              const on = f.id === shownFormat;
              return (
                <Pressable key={f.id} style={[styles.chip, on && styles.chipOn]} onPress={() => pickFormat(f.id)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>
            {sameFormat ? "Individual, pairs and team formats all run over several days." : `Tap a day below, then pick its format. Now choosing for day ${active + 1}.`}
          </Text>
          <View style={styles.rule} accessibilityRole="summary">
            <Ionicons name="trophy-outline" size={22} color={colors.green700} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.ruleTitle}>{line.title}</Text>
              <Text style={styles.ruleBody}>{line.body}</Text>
            </View>
          </View>
          {canAddUp(kinds) ? (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Use places points instead</Text>
              <Switch value={placesRule} onValueChange={setPlacesRule} trackColor={{ true: colors.green600 }} accessibilityLabel="Use places points instead of adding the scores up" />
            </View>
          ) : null}
        </Section>

        <Section title="A course for each day" hint="Each day becomes its own event under Events, with entries, the draw and the live day.">
          {days.map((d, i) => {
            const on = !sameFormat && i === active;
            return (
              <Pressable key={i} style={[styles.day, on && styles.dayOn]} onPress={() => setActive(i)} accessibilityRole="button" accessibilityLabel={`Day ${i + 1}${on ? ", choosing its format" : ""}`}>
                <View style={styles.dayBadge}>
                  <Text style={styles.dayBadgeSmall}>DAY</Text>
                  <Text style={styles.dayBadgeNum}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Pressable onPress={() => setCourseFor(i)} accessibilityRole="button" accessibilityLabel={`Course for day ${i + 1}, ${d.club?.name ?? "not chosen"}. Change`}>
                    <Text style={[styles.dayCourse, !d.club && styles.dayCourseEmpty]} numberOfLines={1}>
                      {d.club?.name ?? "Choose the course"}
                    </Text>
                    {d.club ? <Text style={styles.meta}>{placeLabel(d.club)}</Text> : null}
                  </Pressable>
                  <View style={styles.dayFacts}>
                    <Pressable
                      onPress={() => {
                        setDraftDate(toDate(d.playsOn));
                        setDateFor(i);
                      }}
                      style={styles.fact}
                      accessibilityRole="button"
                      accessibilityLabel={`Date, ${outingDateLabel(d.playsOn)}. Change`}
                    >
                      <Ionicons name="calendar-outline" size={15} color={colors.navy900} />
                      <Text style={styles.factText}>{outingDateLabel(d.playsOn)}</Text>
                    </Pressable>
                    <Pressable onPress={() => setTeeFor(i)} style={styles.fact} accessibilityRole="button" accessibilityLabel={`First tee, ${d.firstTee || "not set"}. Change`}>
                      <Ionicons name="time-outline" size={15} color={colors.navy900} />
                      <Text style={styles.factText}>{d.firstTee || "First tee"}</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.dayFormat}>{dayFormat(d.format).label}</Text>
                </View>
              </Pressable>
            );
          })}
        </Section>

        <View style={styles.pair}>
          <View style={{ flex: 1 }}>
            <Section title="Entry fee" hint="Optional, in euro.">
              <TextInput value={feeText} onChangeText={setFeeText} placeholder="e.g. 120" placeholderTextColor={colors.ink500} keyboardType="decimal-pad" style={[styles.input, fee === undefined && styles.inputBad]} accessibilityLabel="Entry fee in euro" />
            </Section>
          </View>
          <View style={{ flex: 1 }}>
            <Section title="Places" hint="Optional, each day.">
              <TextInput value={maxText} onChangeText={setMaxText} placeholder="e.g. 40" placeholderTextColor={colors.ink500} keyboardType="number-pad" style={styles.input} accessibilityLabel="Places each day" />
            </Section>
          </View>
        </View>

        <Section title="Details" hint="Optional. Shown on every day.">
          <TextInput value={details} onChangeText={setDetails} placeholder="Prizes for the overall top three and each day's winner" placeholderTextColor={colors.ink500} style={[styles.input, styles.multi]} multiline maxLength={1000} accessibilityLabel="Details" />
        </Section>

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <Pressable style={[styles.cta, (problem || saving) && styles.ctaOff]} onPress={() => void save()} disabled={!!problem || saving} accessibilityRole="button">
          {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.ctaText}>{`Create ${days.length}-day event`}</Text>}
        </Pressable>
        <Text style={styles.foot}>Members join every day in one tap. Arrows on the leaderboard show each player&apos;s place against the day before.</Text>
      </ScrollView>

      <TimeSheet open={teeFor != null} title={`First tee · day ${(teeFor ?? 0) + 1}`} value={teeFor != null ? days[teeFor].firstTee : ""} onClose={() => setTeeFor(null)} onChange={(v) => teeFor != null && setDay(teeFor, { firstTee: v })} />

      <Modal visible={courseFor != null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCourseFor(null)}>
        <View style={[styles.fill, { padding: spacing.md, gap: spacing.md, paddingTop: spacing.lg }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{`Course for day ${(courseFor ?? 0) + 1}`}</Text>
            <Pressable onPress={() => setCourseFor(null)} hitSlop={10} accessibilityRole="button">
              <Text style={styles.change}>Close</Text>
            </Pressable>
          </View>
          <CourseSearch
            placeholder="Search for the course"
            onPick={(c) => {
              if (courseFor != null) setDay(courseFor, { club: c });
              setCourseFor(null);
            }}
          />
        </View>
      </Modal>

      {Platform.OS === "ios" ? (
        <Modal visible={dateFor != null} transparent animationType="slide" onRequestClose={() => setDateFor(null)}>
          <Pressable style={styles.backdrop} onPress={() => setDateFor(null)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <Text style={styles.sheetTitle}>{`Day ${(dateFor ?? 0) + 1}`}</Text>
            <DateTimePicker value={draftDate} mode="date" display="spinner" minimumDate={toDate(irishToday())} maximumDate={toDate(addDays(irishToday(), 730))} onChange={(_e, d) => d && setDraftDate(d)} style={{ alignSelf: "stretch" }} />
            <Pressable
              style={styles.cta}
              onPress={() => {
                if (dateFor != null) moveDate(dateFor, fromDate(draftDate));
                setDateFor(null);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>Done</Text>
            </Pressable>
          </View>
        </Modal>
      ) : dateFor != null ? (
        <DateTimePicker
          value={toDate(days[dateFor].playsOn)}
          mode="date"
          minimumDate={toDate(irishToday())}
          onChange={(e: DateTimePickerEvent, d?: Date) => {
            const which = dateFor;
            setDateFor(null);
            if (e.type === "set" && d) moveDate(which, fromDate(d));
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
  row: { flexDirection: "row", gap: spacing.sm },
  seg: { flex: 1, minHeight: 50, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  segOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  segText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900, textAlign: "center" },
  segTextOn: { color: colors.cream50 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.green700, backgroundColor: colors.green700 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  chipTextOn: { color: colors.cream50 },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  rule: { flexDirection: "row", gap: 12, padding: 14, borderRadius: radii.lg, backgroundColor: colors.green100, borderWidth: 1, borderColor: colors.green600 },
  ruleTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  ruleBody: { fontFamily: fonts.body, fontSize: 14, color: colors.ink900 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  switchLabel: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900, flex: 1 },
  day: { flexDirection: "row", gap: 12, padding: 12, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  dayOn: { borderWidth: 2, borderColor: colors.gold500 },
  dayBadge: { width: 52, height: 52, borderRadius: radii.md, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  dayBadgeSmall: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1, color: colors.navy900 },
  dayBadgeNum: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.navy900, lineHeight: 22 },
  dayCourse: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink900 },
  dayCourseEmpty: { color: colors.green700 },
  dayFacts: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  fact: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 36, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: colors.cream100 },
  factText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.navy900 },
  dayFormat: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.green700 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  pair: { flexDirection: "row", gap: spacing.sm },
  problem: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600, textAlign: "center" },
  cta: { minHeight: 54, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  ctaOff: { opacity: 0.5 },
  ctaText: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.cream50 },
  foot: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(12,32,56,0.35)" },
  sheet: { backgroundColor: colors.cream50, padding: spacing.md, gap: spacing.sm, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontFamily: fonts.bodyBold, fontSize: type.heading, color: colors.ink900, textAlign: "center" },
  change: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
});
