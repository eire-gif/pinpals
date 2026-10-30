import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Kicker, proStyles } from "@/components/pro-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { euroCents, lessonPhase, lessonWhen, untilText, type LessonPhase } from "@/lib/pro-rules";
import { loadMyLessons, type Lesson } from "@/lib/pros";
import { colors, fonts, spacing } from "@/lib/theme";

const PHASE_LINE: Record<LessonPhase, string> = {
  paying: "Waiting for payment — tap to finish",
  upcoming: "Booked",
  done: "Done",
  cancelled: "Cancelled",
  expired: "Not booked",
};

/** Book a pro (0204): the lessons you've booked — coming up first, then the rest. */
export default function MyLessonsScreen() {
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      setLessons(await loadMyLessons(me));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [me]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!isOn("bookAPro")) return <StateMessage size="screen" icon="school-outline" title="Book a pro is on its way" />;
  if (failed && lessons === null) return <LoadError size="screen" onRetry={() => void load()} what="your lessons" />;
  if (lessons === null) {
    return (
      <View style={[proStyles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  const withPhase = lessons.map((l) => ({ l, phase: lessonPhase(l) })).filter((x) => x.phase !== "expired");
  const soon = withPhase.filter((x) => x.phase === "upcoming" || x.phase === "paying").sort((a, b) => a.l.starts_at.localeCompare(b.l.starts_at));
  const past = withPhase.filter((x) => x.phase === "done" || x.phase === "cancelled");

  const row = ({ l, phase }: { l: Lesson; phase: LessonPhase }, i: number) => (
    <Pressable key={l.id} style={[styles.row, i > 0 && styles.rowLine]} onPress={() => router.push({ pathname: "/lesson/[id]", params: { id: String(l.id) } })} accessibilityRole="button">
      <View style={[styles.dateBox, phase === "upcoming" && { backgroundColor: colors.navy900 }]}>
        <Text style={[styles.dateText, phase === "upcoming" && { color: colors.gold400 }]}>{phase === "upcoming" ? untilText(l.starts_at) : lessonWhen(l.starts_at).split(",")[0]}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title} numberOfLines={1}>{`${l.title} with ${l.proName}`}</Text>
        <Text style={proStyles.hint} numberOfLines={1}>{`${lessonWhen(l.starts_at)} · ${PHASE_LINE[phase]}`}</Text>
      </View>
      <Text style={styles.price}>{euroCents(l.price_cents)}</Text>
    </Pressable>
  );

  return (
    <ScrollView
      style={proStyles.screen}
      contentContainerStyle={proStyles.body}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Stack.Screen options={{ title: "My lessons" }} />
      {withPhase.length === 0 ? (
        <StateMessage icon="school-outline" title="No lessons yet" body="Find a PGA pro, a teaching pro or a club fitter near you and book a time." />
      ) : null}
      {soon.length ? (
        <>
          <Kicker>COMING UP</Kicker>
          <View style={proStyles.card}>{soon.map(row)}</View>
        </>
      ) : null}
      {past.length ? (
        <>
          <Kicker>BEFORE</Kicker>
          <View style={proStyles.card}>{past.map(row)}</View>
        </>
      ) : null}
      <Pressable style={proStyles.primary} onPress={() => router.push("/pros")} accessibilityRole="button">
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Ionicons name="search" size={18} color={colors.gold400} />
          <Text style={proStyles.primaryText}>Find a pro</Text>
        </View>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: spacing.md, paddingVertical: 12, minHeight: 64 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.cream100 },
  dateBox: { minWidth: 72, minHeight: 40, borderRadius: 10, backgroundColor: colors.cream100, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  dateText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink900, textAlign: "center" },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  price: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
});
