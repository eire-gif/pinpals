import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { DateSheet } from "@/components/date-sheet";
import { Kicker, proStyles } from "@/components/pro-bits";
import { StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { entriesCloseAt, irishToday } from "@/lib/outing-rules";
import { WEEKDAYS, clock, lessonWhen, type HoursRow } from "@/lib/pro-rules";
import { addTimeOff, loadMyHours, loadMyPro, loadMyTimeOff, removeTimeOff, setHours } from "@/lib/pros";
import { colors, fonts, radii, spacing } from "@/lib/theme";

type Day = { on: boolean; start: number; end: number };
const STEP = 30;

const nextDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/**
 * Book a pro (0204): the hours a pro teaches, one stretch a day in Irish
 * time, and days off. Golfers only see free times inside these hours, at
 * least two hours ahead, around lessons already booked.
 */
export default function HoursScreen() {
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [proId, setProId] = useState<number | null | undefined>(undefined);
  const [week, setWeek] = useState<Day[]>(() => WEEKDAYS.map((_, i) => ({ on: i < 6, start: 540, end: 1020 })));
  const [off, setOff] = useState<{ id: number; starts_at: string; ends_at: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    const pro = await loadMyPro(me).catch(() => null);
    setProId(pro?.id ?? null);
    if (!pro) return;
    const [rows, timeOff] = await Promise.all([loadMyHours(pro.id), loadMyTimeOff(pro.id)]);
    setOff(timeOff);
    if (!loaded) {
      if (rows.length) {
        setWeek(
          WEEKDAYS.map((_, i) => {
            const day = rows.filter((r) => r.weekday === i).sort((a, b) => a.start_min - b.start_min);
            return day.length ? { on: true, start: day[0].start_min, end: day[day.length - 1].end_min } : { on: false, start: 540, end: 1020 };
          })
        );
      }
      setLoaded(true);
    }
  }, [me, loaded]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (proId === undefined) {
    return (
      <View style={[proStyles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }
  if (proId === null) return <StateMessage size="screen" icon="school-outline" title="Apply to teach first" />;

  const change = (i: number, patch: Partial<Day>) => setWeek((w) => w.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const nudge = (i: number, which: "start" | "end", by: number) => {
    const d = week[i];
    const v = Math.max(0, Math.min(1440, d[which] + by));
    if (which === "start" && v >= d.end - STEP) return;
    if (which === "end" && v <= d.start + STEP) return;
    change(i, { [which]: v });
  };

  const save = async () => {
    setBusy(true);
    try {
      const rows: HoursRow[] = week.flatMap((d, i) => (d.on ? [{ weekday: i, start_min: d.start, end_min: d.end }] : []));
      await setHours(rows);
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save your hours", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const blockDay = async (iso: string) => {
    setPick(false);
    try {
      await addTimeOff(entriesCloseAt(iso).toISOString(), entriesCloseAt(nextDay(iso)).toISOString());
      await load();
    } catch (e) {
      Alert.alert("Couldn't block that day", e instanceof Error ? e.message : "Please try again.");
    }
  };

  return (
    <View style={proStyles.screen}>
      <Stack.Screen options={{ title: "Your hours" }} />
      <ScrollView contentContainerStyle={[proStyles.body, { paddingBottom: 120 }]}>
        <Text style={proStyles.hint}>Golfers see free times every half hour inside these hours, at least two hours ahead.</Text>
        <View style={proStyles.card}>
          {week.map((d, i) => (
            <View key={WEEKDAYS[i]} style={[styles.day, i > 0 && styles.line]}>
              <Text style={styles.dayName}>{WEEKDAYS[i]}</Text>
              {d.on ? (
                <View style={styles.times}>
                  <Stepper label={clock(d.start)} onLess={() => nudge(i, "start", -STEP)} onMore={() => nudge(i, "start", STEP)} name={`${WEEKDAYS[i]} start`} />
                  <Text style={proStyles.hint}>to</Text>
                  <Stepper label={clock(d.end)} onLess={() => nudge(i, "end", -STEP)} onMore={() => nudge(i, "end", STEP)} name={`${WEEKDAYS[i]} end`} />
                </View>
              ) : (
                <Text style={[proStyles.hint, { flex: 1 }]}>Not teaching</Text>
              )}
              <Switch value={d.on} onValueChange={(v) => change(i, { on: v })} trackColor={{ true: colors.green700, false: "#cfc6b4" }} accessibilityLabel={`Teach on ${WEEKDAYS[i]}`} />
            </View>
          ))}
        </View>

        <Kicker>DAYS OFF</Kicker>
        <View style={proStyles.card}>
          {off.length === 0 ? <Text style={[proStyles.hint, { padding: spacing.md }]}>None coming up.</Text> : null}
          {off.map((t, i) => (
            <View key={t.id} style={[styles.day, i > 0 && styles.line]}>
              <Ionicons name="close-circle-outline" size={20} color={colors.ink500} />
              <Text style={[styles.offText, { flex: 1 }]}>{`${lessonWhen(t.starts_at).split(",")[0]}${Date.parse(t.ends_at) - Date.parse(t.starts_at) > 26 * 3600e3 ? ` to ${lessonWhen(new Date(Date.parse(t.ends_at) - 1).toISOString()).split(",")[0]}` : ""}`}</Text>
              <Pressable
                onPress={async () => {
                  await removeTimeOff(t.id).catch(() => undefined);
                  await load();
                }}
                style={styles.undo}
                accessibilityRole="button"
                accessibilityLabel="Remove this day off"
              >
                <Text style={styles.undoText}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>
        <Pressable style={proStyles.secondary} onPress={() => setPick(true)} accessibilityRole="button">
          <Text style={proStyles.secondaryText}>+ Block off a day</Text>
        </Pressable>
        <Text style={proStyles.hint}>Lessons already booked on a day you block stay booked — cancel them from your diary if you need to.</Text>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={proStyles.primary} onPress={() => void save()} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.cream50} /> : <Text style={proStyles.primaryText}>Save hours</Text>}
        </Pressable>
      </View>

      <DateSheet open={pick} title="Block off a day" value={irishToday()} maxDaysAhead={365} onClose={() => setPick(false)} onChange={(iso) => void blockDay(iso)} />
    </View>
  );
}

function Stepper({ label, onLess, onMore, name }: { label: string; onLess: () => void; onMore: () => void; name: string }) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={onLess} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`${name} earlier`}>
        <Ionicons name="remove" size={16} color={colors.green700} />
      </Pressable>
      <Text style={styles.stepText}>{label}</Text>
      <Pressable onPress={onMore} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`${name} later`}>
        <Ionicons name="add" size={16} color={colors.green700} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  day: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.md, paddingVertical: 10, minHeight: 58 },
  line: { borderTopWidth: 1, borderTopColor: colors.cream100 },
  dayName: { width: 38, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  times: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  stepper: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.line, borderRadius: radii.md },
  stepBtn: { width: 34, height: 40, alignItems: "center", justifyContent: "center" },
  stepText: { minWidth: 44, textAlign: "center", fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  offText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  undo: { minHeight: 40, justifyContent: "center", paddingHorizontal: 8 },
  undoText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy800 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.md, paddingBottom: spacing.lg, backgroundColor: colors.cream50, borderTopWidth: 1, borderTopColor: colors.line },
});
