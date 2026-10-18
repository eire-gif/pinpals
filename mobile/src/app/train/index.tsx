import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GoldFrame } from "@/components/format-art";
import { ScreenHeader } from "@/components/screen-header";
import { LieArtTile } from "@/components/train-art";
import { DrillRow, GoldButton, SectionHead, bits } from "@/components/train-bits";
import { DRILLS, LIES, PLANS, drillById, lieById, nextSession, planById, planSessions, scoreLabel, sessionMinutes } from "@/lib/training";
import { useTraining } from "@/lib/training-store";
import { colors, fonts, radii } from "@/lib/theme";

/**
 * Training (Menu → Play → Training, Oct 2026; claude/training.md): how to
 * play awkward lies, the Putting Lab, practice plans and a warm-up. Laid out
 * as the approved "Train home" mock-up. Everything is on the phone, so it
 * works on the range with no signal.
 */

const FEATURED_LIES = ["uphill", "downhill", "above-feet", "greenside-bunker", "thick-rough", "into-wind"];
const FEATURED_DRILLS = ["clock", "gate", "ladder-lag"];

export default function TrainScreen() {
  const router = useRouter();
  const t = useTraining();

  const plan = t.plan ? planById(t.plan.planId) : undefined;
  const sessions = plan ? planSessions(plan) : [];
  const done = new Set(t.plan?.done ?? []);
  const next = plan ? nextSession(plan, done) : null;
  const today = next != null ? sessions[next] : null;

  return (
    <View style={bits.fill}>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />
      <ScreenHeader scene="ballybunion" title="Training" subtitle="Lies, putting and practice plans" />
      <ScrollView contentContainerStyle={bits.body}>
        {/* Today */}
        <GoldFrame tone="navy">
          {plan && today ? (
            <>
              <Text style={styles.kicker}>{`TODAY'S SESSION · ${sessionMinutes(today.session)} MIN`}</Text>
              <Text style={styles.heroTitle}>{`Week ${today.week + 1} · ${plan.name}`}</Text>
              <Text style={styles.heroSub}>
                {today.session.items.map((i) => ("drill" in i ? drillById(i.drill)?.name : "lie" in i ? lieById(i.lie)?.name : i.task)).join(" → ")}
              </Text>
              <View style={styles.bar} accessibilityLabel={`${done.size} of ${sessions.length} sessions done`}>
                <View style={[styles.barFill, { width: `${Math.round((done.size / sessions.length) * 100)}%` }]} />
              </View>
              <View style={styles.heroFoot}>
                <Text style={styles.heroMeta}>{`${done.size} of ${sessions.length} sessions done`}</Text>
                <Pressable onPress={() => router.push(`/train/plan/${plan.id}`)} style={({ pressed }) => [styles.heroBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                  <Text style={styles.heroBtnText}>Start session</Text>
                </Pressable>
              </View>
            </>
          ) : plan ? (
            <>
              <Text style={styles.kicker}>PLAN FINISHED</Text>
              <Text style={styles.heroTitle}>{`${plan.name} — done`}</Text>
              <Text style={styles.heroSub}>Every session ticked off. Pick another plan below, or keep the drills going.</Text>
            </>
          ) : (
            <>
              <Text style={styles.kicker}>START HERE</Text>
              <Text style={styles.heroTitle}>Practise with a plan</Text>
              <Text style={styles.heroSub}>Short sessions that build on each other. Most golfers drop the most shots on the green, so start with Kill the 3-putt.</Text>
              <View style={styles.heroFoot}>
                <Text style={styles.heroMeta}>4 weeks · 3 × 25 min</Text>
                <Pressable onPress={() => router.push("/train/plan/kill-3-putt")} style={({ pressed }) => [styles.heroBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                  <Text style={styles.heroBtnText}>See the plan</Text>
                </Pressable>
              </View>
            </>
          )}
        </GoldFrame>

        {/* Lies */}
        <SectionHead title="What's your lie?" action={`All ${LIES.length} →`} onAction={() => router.push("/train/lies")} />
        <View style={styles.grid}>
          {FEATURED_LIES.map((id) => lieById(id)!).map((l) => (
            <Pressable
              key={l.id}
              onPress={() => router.push(`/train/lie/${l.id}`)}
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
              accessibilityLabel={l.name}
            >
              <LieArtTile art={l.art} size={84} />
              <Text style={styles.tileText} numberOfLines={1}>
                {l.name.replace(" lie", "")}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Putting */}
        <SectionHead title="Putting Lab" action={`${DRILLS.length} drills →`} onAction={() => router.push("/train/putting")} />
        <View style={bits.group}>
          {FEATURED_DRILLS.map((id, i) => {
            const d = drillById(id)!;
            const b = t.bests[d.id];
            return <DrillRow key={d.id} drill={d} first={i === 0} best={b != null ? scoreLabel(d.scoring, b) : undefined} onPress={() => router.push(`/train/drill/${d.id}`)} />;
          })}
        </View>

        {/* Plans */}
        <SectionHead title="Practice plans" />
        {PLANS.map((p) => {
          const active = t.plan?.planId === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => router.push(`/train/plan/${p.id}`)}
              style={({ pressed }) => [styles.plan, active && styles.planActive, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`${p.name}. ${p.shape}. ${p.blurb}.${active ? " Your current plan." : ""}`}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.planKicker, p.home && { color: colors.green700 }]}>{`${p.shape.toUpperCase()}${p.home ? " · AT HOME" : ""}`}</Text>
                <Text style={styles.planName}>{p.name}</Text>
                <Text style={styles.planBlurb}>{p.blurb}</Text>
              </View>
              {active ? <Text style={styles.current}>Current</Text> : <Ionicons name="chevron-forward" size={16} color={colors.gold500} />}
            </Pressable>
          );
        })}

        {/* Before a round */}
        <SectionHead title="Before your round" />
        <Pressable
          onPress={() => router.push("/train/warm-up")}
          style={({ pressed }) => [styles.warm, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="Pre-round warm-up: 5, 20 or 40 minutes, with your putting routine"
        >
          <View style={styles.warmIcon}>
            <Ionicons name="timer-outline" size={22} color={colors.gold400} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.planName}>Pre-round warm-up</Text>
            <Text style={styles.planBlurb}>5, 20 or 40 minutes, step by step, plus your putting routine</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.gold500} />
        </Pressable>

        <GoldButton label="See your putting stats in My Game" icon="stats-chart-outline" onPress={() => router.push("/my-game")} />

        <Text style={bits.foot}>Standard teaching in plain English. Have a word with your club professional if something doesn't feel right — a lesson beats any guide.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 2, color: colors.gold400 },
  heroTitle: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.cream50, marginTop: -4 },
  heroSub: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.cream100 },
  bar: { height: 6, borderRadius: 3, backgroundColor: "rgba(247,243,234,0.18)", overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.gold400 },
  heroFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  heroMeta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.cream100 },
  heroBtn: { backgroundColor: colors.gold400, borderRadius: radii.pill, paddingHorizontal: 18, minHeight: 44, justifyContent: "center" },
  heroBtnText: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.navy900 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "31.5%", flexGrow: 1, alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 16, backgroundColor: colors.navy900, borderWidth: 1, borderColor: "rgba(211,165,63,0.45)" },
  tileText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50 },

  plan: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  planActive: { borderColor: colors.gold500, borderWidth: 1.5, backgroundColor: colors.surfaceTint },
  planKicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.4, color: "#8a6a1f" },
  planName: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900 },
  planBlurb: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.ink500 },
  current: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.green700, backgroundColor: colors.green100, borderRadius: radii.pill, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 5 },

  warm: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  warmIcon: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
});
