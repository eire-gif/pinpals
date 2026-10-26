import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GoldFrame } from "@/components/format-art";
import { TONES } from "@/components/live-scoring-card";
import { TintedHeader } from "@/components/tinted-header";
import { StateMessage } from "@/components/state-message";
import { GoldButton, bits } from "@/components/train-bits";
import { drillById, lieById, nextSession, planById, planSessions, sessionMinutes, type PlanItem } from "@/lib/training";
import { useTraining } from "@/lib/training-store";
import { colors, fonts, radii } from "@/lib/theme";

/**
 * A practice plan (Training → Practice plans → a plan): weeks of short
 * sessions built from the Putting Lab's drills and the lie guides. Tick a
 * session off when it's done; progress is kept on the phone. One plan at a
 * time — starting another replaces it, after asking.
 */

function itemLabel(i: PlanItem): string {
  if ("drill" in i) return drillById(i.drill)?.name ?? i.drill;
  if ("lie" in i) return `${lieById(i.lie)?.name ?? i.lie} drill`;
  return i.task;
}

export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTraining();
  const plan = planById(String(id ?? ""));

  if (!plan) {
    return (
      <View style={bits.fill}>
        <Stack.Screen options={{ headerTitle: "Training", headerBackTitle: "Back" }} />
        <StateMessage size="screen" icon="calendar-outline" title="Plan not found" body="It may have been renamed. Every plan is listed on Training." />
      </View>
    );
  }

  const active = t.plan?.planId === plan.id;
  const done = new Set(active ? t.plan!.done : []);
  const sessions = planSessions(plan);
  const next = active ? nextSession(plan, done) : null;

  const start = () => {
    if (t.plan && !active) {
      const other = planById(t.plan.planId);
      Alert.alert(`Start ${plan.name}?`, `This replaces ${other?.name ?? "your current plan"} and its progress.`, [
        { text: "Keep my plan", style: "cancel" },
        { text: "Start this one", onPress: () => void t.startPlan(plan.id) },
      ]);
    } else void t.startPlan(plan.id);
  };

  const stop = () =>
    Alert.alert("Stop this plan?", "Your ticked-off sessions will be cleared.", [
      { text: "Keep going", style: "cancel" },
      { text: "Stop the plan", style: "destructive", onPress: () => void t.stopPlan() },
    ]);

  return (
    <View style={bits.fill}>
      <TintedHeader color={TONES.green.card} title={plan.name} subtitle="Practice plan" />
      <ScrollView contentContainerStyle={bits.body}>
        <GoldFrame tone="navy">
          <Text style={styles.kicker}>{plan.shape.toUpperCase()}</Text>
          <Text style={styles.name} accessibilityRole="header">
            {plan.name}
          </Text>
          <Text style={styles.intro}>{`${plan.blurb}. Goal: ${plan.goal.charAt(0).toLowerCase()}${plan.goal.slice(1)}.`}</Text>
          {active ? (
            <>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${Math.round((done.size / sessions.length) * 100)}%` }]} />
              </View>
              <Text style={styles.meta}>{next == null ? "Every session done. Well played." : `${done.size} of ${sessions.length} sessions done`}</Text>
            </>
          ) : null}
        </GoldFrame>

        {!active ? <GoldButton label="Start this plan" icon="flag-outline" onPress={start} hint="Keeps your progress on this phone" /> : null}

        {plan.weeks.map((w, wi) => (
          <View key={wi} style={bits.card}>
            <View style={styles.weekHead}>
              <Text style={styles.week}>{`Week ${wi + 1}`}</Text>
              <Text style={styles.theme}>{w.theme}</Text>
            </View>
            <Text style={styles.target}>{`Target: ${w.target}`}</Text>
            {sessions
              .filter((s) => s.week === wi)
              .map(({ index, session }) => {
                const isDone = done.has(index);
                const isNext = index === next;
                return (
                  <View key={index} style={[styles.session, isNext && styles.sessionNext, isDone && styles.sessionDone]}>
                    <View style={styles.sessionHead}>
                      <Text style={styles.sessionTitle}>{`${index + 1}. ${session.title}`}</Text>
                      <Text style={styles.mins}>{sessionMinutes(session) > 0 ? `${sessionMinutes(session)} min` : "On course"}</Text>
                    </View>
                    {session.items.map((i, k) => {
                      const to = "drill" in i ? `/train/drill/${i.drill}` : "lie" in i ? `/train/lie/${i.lie}` : null;
                      const label = `${itemLabel(i)}${i.minutes ? ` · ${i.minutes} min` : ""}`;
                      return to ? (
                        <Pressable key={k} onPress={() => router.push(to as `/train/drill/${string}`)} style={({ pressed }) => [styles.item, pressed && { opacity: 0.8 }]} accessibilityRole="button">
                          <Ionicons name="play-circle-outline" size={18} color={colors.green700} />
                          <Text style={styles.itemText}>{label}</Text>
                          <Ionicons name="chevron-forward" size={14} color={colors.gold500} />
                        </Pressable>
                      ) : (
                        <View key={k} style={styles.item}>
                          <Ionicons name="golf-outline" size={18} color={colors.green700} />
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={styles.itemText}>{label}</Text>
                            {"detail" in i ? <Text style={bits.muted}>{i.detail}</Text> : null}
                          </View>
                        </View>
                      );
                    })}
                    {active ? (
                      <Pressable
                        onPress={() => void t.toggleSession(index)}
                        style={({ pressed }) => [styles.tick, isDone && styles.tickOn, pressed && { opacity: 0.85 }]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isDone }}
                        accessibilityLabel={`Session ${index + 1} done`}
                      >
                        <Ionicons name={isDone ? "checkmark-circle" : "ellipse-outline"} size={20} color={isDone ? colors.cream50 : colors.navy900} />
                        <Text style={[styles.tickText, isDone && { color: colors.cream50 }]}>{isDone ? "Done" : "Mark as done"}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
          </View>
        ))}

        {active ? (
          <Pressable onPress={stop} hitSlop={8} style={{ alignSelf: "center" }} accessibilityRole="button">
            <Text style={styles.stop}>Stop this plan</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 2, color: colors.gold400 },
  name: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.cream50, marginTop: -6 },
  intro: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.cream100 },
  bar: { height: 6, borderRadius: 3, backgroundColor: "rgba(247,243,234,0.18)", overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.gold400 },
  meta: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.cream100 },

  weekHead: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  week: { fontFamily: fonts.display, fontSize: 21, color: colors.navy900 },
  theme: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green700 },
  target: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: "#7a5a12", backgroundColor: "#f6ecd2", borderRadius: 12, overflow: "hidden", paddingHorizontal: 12, paddingVertical: 8, marginTop: -4 },

  session: { borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 8, backgroundColor: colors.surface },
  sessionNext: { borderColor: colors.gold500, borderWidth: 1.5, backgroundColor: colors.surfaceTint },
  sessionDone: { opacity: 0.75 },
  sessionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  sessionTitle: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy900 },
  mins: { fontFamily: fonts.bodyBold, fontSize: 12, color: "#8a6a1f" },
  item: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36 },
  itemText: { flex: 1, fontFamily: fonts.body, fontSize: 14.5, color: colors.ink900 },
  tick: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.line },
  tickOn: { backgroundColor: colors.green600, borderColor: colors.green600 },
  tickText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy900 },
  stop: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.red600, textDecorationLine: "underline" },
});
