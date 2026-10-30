import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Kicker, proStyles } from "@/components/pro-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { isOn } from "@/lib/features";
import { FOCUS_OPTIONS, euroCents, groupSlots, lessonWhen, type SlotDay } from "@/lib/pro-rules";
import { holdLesson, lessonPayPath, loadPro, loadSlots, type Pro, type ProService } from "@/lib/pros";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * Book a pro (0204): pick a time, as on the canvas — what to work on, a day
 * (dots for how many times are free), a time, then "Hold it and pay". The
 * time is held for 15 minutes while the golfer pays on the website's page in
 * the app's web view.
 */
export default function BookScreen() {
  const { serviceId: raw } = useLocalSearchParams<{ serviceId: string }>();
  const serviceId = Number(raw);
  const insets = useSafeAreaInsets();
  const [pro, setPro] = useState<Pro | null | undefined>(undefined);
  const [service, setService] = useState<ProService | null>(null);
  const [days, setDays] = useState<SlotDay[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [focus, setFocus] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.from("pro_services").select("pro_id").eq("id", serviceId).maybeSingle();
      const p = data ? await loadPro((data as { pro_id: number }).pro_id) : null;
      setPro(p);
      setService(p?.services.find((s) => s.id === serviceId) ?? null);
      const grouped = groupSlots(await loadSlots(serviceId, 21));
      setDays(grouped);
      setDayKey((k) => (k && grouped.some((d) => d.dayKey === k) ? k : (grouped[0]?.dayKey ?? null)));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [serviceId]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const day = useMemo(() => days?.find((d) => d.dayKey === dayKey) ?? null, [days, dayKey]);

  if (!isOn("bookAPro")) return <StateMessage size="screen" icon="school-outline" title="Book a pro is on its way" />;
  if (failed && pro === undefined) return <LoadError size="screen" onRetry={() => void load()} what="the free times" />;
  if (pro === undefined || days === null) {
    return (
      <View style={[proStyles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }
  if (!pro || !service) return <StateMessage size="screen" icon="school-outline" title="That isn't offered any more" />;

  const toggleFocus = (f: string) => setFocus((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  const focusList = service.kind === "fitting" ? FOCUS_OPTIONS : FOCUS_OPTIONS.filter((f) => f !== "Fitting");

  const hold = async () => {
    if (!slot) return;
    setBusy(true);
    try {
      const id = await holdLesson(service.id, slot, focus, note);
      router.replace({ pathname: "/lesson/[id]", params: { id: String(id) } });
      router.push({ pathname: "/web", params: { path: lessonPayPath(id), title: "Pay for your lesson" } });
    } catch (e) {
      Alert.alert("Couldn't hold that time", e instanceof Error ? e.message : "Please try again.");
      if (e instanceof Error && /just gone/.test(e.message)) {
        setSlot(null);
        void load();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={proStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: "Pick a time" }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 170 }} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Kicker color={colors.gold400}>{`${pro.name.toUpperCase()} · ${service.title.toUpperCase()} · ${service.minutes} MIN`}</Kicker>
          <Text style={styles.heroTitle}>{service.kind === "fitting" ? "What are we fitting?" : "What shall we work on?"}</Text>
          <View style={styles.chips}>
            {focusList.map((f) => {
              const on = focus.includes(f);
              return (
                <Pressable key={f} onPress={() => toggleFocus(f)} style={[styles.focus, on && styles.focusOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[styles.focusText, on && { color: colors.ink900 }]}>{f}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={proStyles.body}>
          {days.length === 0 ? (
            <StateMessage icon="calendar-outline" title="No free times in the next three weeks" body="Check back soon — pros open up their diaries as they go." />
          ) : (
            <>
              <Kicker>DAY</Kicker>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {days.map((d) => {
                  const on = d.dayKey === dayKey;
                  const dots = Math.min(3, Math.ceil(d.times.length / 3));
                  return (
                    <Pressable
                      key={d.dayKey}
                      onPress={() => {
                        setDayKey(d.dayKey);
                        setSlot(null);
                      }}
                      style={[styles.day, on && styles.dayOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${d.dow} ${d.day} ${d.month}, ${d.times.length} times free`}
                    >
                      <Text style={[styles.dow, on && { color: colors.ink900 }]}>{d.dow.toUpperCase()}</Text>
                      <Text style={styles.dayNum}>{d.day}</Text>
                      <Text style={styles.dots}>{"•".repeat(dots)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {day ? (
                <>
                  <Kicker>{`${day.dow.toUpperCase()} ${day.day} ${day.month.toUpperCase()} · ${day.times.length} FREE`}</Kicker>
                  <View style={styles.times}>
                    {day.times.map((t) => {
                      const on = slot === t.iso;
                      return (
                        <Pressable key={t.iso} onPress={() => setSlot(t.iso)} style={[styles.time, on && styles.timeOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                          <Text style={[styles.timeText, on && { color: "#fff" }]}>{t.time}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}

              <View style={{ gap: 6 }}>
                <Text style={proStyles.label}>Anything {pro.name.split(" ")[0]} should know? (optional)</Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  maxLength={300}
                  multiline
                  placeholder="e.g. Slicing the driver lately"
                  placeholderTextColor={colors.ink500}
                  style={[proStyles.input, { minHeight: 70, paddingTop: 12, textAlignVertical: "top" }]}
                />
              </View>
            </>
          )}
        </View>
      </ScrollView>

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.when}>{slot ? lessonWhen(slot) : "Pick a time"}</Text>
            <Text style={[proStyles.hint, { color: "#5a4512" }]}>
              {pro.cancelPolicy === "none" ? "No refunds if you cancel" : `Free to cancel up to ${pro.cancelPolicy === "24h" ? "24" : "48"} hours before`}
            </Text>
          </View>
          <Text style={styles.price}>{euroCents(service.priceCents)}</Text>
        </View>
        <Pressable style={[proStyles.primary, !slot && { opacity: 0.5 }]} onPress={() => void hold()} disabled={!slot || busy} accessibilityRole="button">
          {busy ? (
            <ActivityIndicator color={colors.cream50} />
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="lock-closed" size={16} color={colors.gold400} />
              <Text style={proStyles.primaryText}>Hold it and pay</Text>
            </View>
          )}
        </Pressable>
        <Text style={[proStyles.hint, { textAlign: "center" }]}>We hold the time for 15 minutes while you pay.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.navy900, padding: spacing.md, gap: 10 },
  heroTitle: { fontFamily: fonts.display, fontSize: 24, color: "#fff" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  focus: { minHeight: 38, paddingHorizontal: 13, borderRadius: 19, borderWidth: 1, borderColor: "#3a5579", justifyContent: "center" },
  focusOn: { backgroundColor: colors.gold400, borderColor: colors.gold400 },
  focusText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50 },
  day: { width: 62, minHeight: 76, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", gap: 1 },
  dayOn: { backgroundColor: colors.gold400, borderColor: colors.ink900, borderWidth: 2 },
  dow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.5, color: colors.ink500 },
  dayNum: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.ink900 },
  dots: { fontSize: 12, letterSpacing: 1, color: colors.green700, lineHeight: 14 },
  times: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  time: { width: "31%", minHeight: 50, borderRadius: radii.md, borderWidth: 1, borderColor: "#b7cdb9", backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  timeOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  timeText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.green700 },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.md, gap: 10 },
  when: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  price: { fontFamily: fonts.bodyBold, fontSize: 24, color: colors.ink900 },
});
