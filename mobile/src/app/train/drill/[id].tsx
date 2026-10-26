import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GoldFrame } from "@/components/format-art";
import { TONES } from "@/components/live-scoring-card";
import { TintedHeader } from "@/components/tinted-header";
import { StateMessage } from "@/components/state-message";
import { Card, FOCUS_LOOK, GhostButton, GoldButton, bits } from "@/components/train-bits";
import { drillById, isBetter, scoreLabel, type Drill } from "@/lib/training";
import { useTraining } from "@/lib/training-store";
import { colors, fonts, radii } from "@/lib/theme";

/**
 * One putting drill (Training → Putting Lab → a drill), with a scorer you
 * tap as you go — Holed / Missed, Good / Not, or putts per hole — and your
 * best score kept on the phone. Laid out as the approved Clock drill mock-up.
 */

type Run = { started: number; ended: number | null; streak: number; putts: number; attempts: number; good: number; holes: number[]; results: boolean[] };

const fresh = (): Run => ({ started: Date.now(), ended: null, streak: 0, putts: 0, attempts: 0, good: 0, holes: [], results: [] });

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function finalScore(d: Drill, r: Run): number {
  if (d.scoring.kind === "streak") return r.putts;
  if (d.scoring.kind === "outOf") return r.good;
  return r.holes.reduce((a, b) => a + b, 0);
}

function Ring({ total, done }: { total: number; done: number }) {
  // Balls round the hole, like the clock drill. Done in green, next in gold.
  const size = 240;
  const r = 96;
  return (
    <View style={{ width: size, height: size, alignSelf: "center" }} accessible accessibilityLabel={`${done} of ${total} holed in a row`}>
      <View style={styles.green} />
      <View style={styles.cup} />
      {Array.from({ length: total }, (_, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / total;
        const next = i === done;
        const d = next ? 24 : 18;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              left: size / 2 + r * Math.cos(a) - d / 2,
              top: size / 2 + r * Math.sin(a) - d / 2,
              width: d,
              height: d,
              borderRadius: d / 2,
              backgroundColor: i < done ? colors.green600 : "#fff",
              borderWidth: next ? 3 : 1,
              borderColor: next ? colors.gold400 : "rgba(0,0,0,0.15)",
            }}
          />
        );
      })}
    </View>
  );
}

export default function DrillScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTraining();
  const drill = drillById(String(id ?? ""));
  const [run, setRun] = useState<Run | null>(null);
  const [now, setNow] = useState(Date.now());
  const [newBest, setNewBest] = useState(false);

  useEffect(() => {
    if (!run || run.ended) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run]);

  if (!drill) {
    return (
      <View style={bits.fill}>
        <Stack.Screen options={{ headerTitle: "Putting Lab", headerBackTitle: "Back" }} />
        <StateMessage size="screen" icon="golf-outline" title="Drill not found" body="It may have been renamed. Every drill is in the Putting Lab." />
      </View>
    );
  }

  const sc = drill.scoring;
  const best = t.bests[drill.id] ?? null;
  const look = FOCUS_LOOK[drill.focus];

  const finish = (r: Run) => {
    const done = { ...r, ended: Date.now() };
    setRun(done);
    const score = finalScore(drill, done);
    const better = isBetter(sc, score, best);
    setNewBest(better);
    if (better) void t.setBest(drill.id, score);
  };

  const tap = (good: boolean) => {
    if (!run || run.ended) return;
    if (sc.kind === "streak") {
      const r = { ...run, putts: run.putts + 1, streak: good ? run.streak + 1 : 0 };
      if (r.streak >= sc.target) finish(r);
      else setRun(r);
    } else if (sc.kind === "outOf") {
      const r = { ...run, attempts: run.attempts + 1, good: run.good + (good ? 1 : 0), results: [...run.results, good] };
      if (r.attempts >= sc.target) finish(r);
      else setRun(r);
    }
  };

  const hole = (putts: number) => {
    if (!run || run.ended || sc.kind !== "strokes") return;
    const r = { ...run, holes: [...run.holes, putts] };
    if (r.holes.length >= sc.target) finish(r);
    else setRun(r);
  };

  const undo = () => {
    if (!run || run.ended) return;
    if (sc.kind === "outOf" && run.results.length) {
      const last = run.results[run.results.length - 1];
      setRun({ ...run, attempts: run.attempts - 1, good: run.good - (last ? 1 : 0), results: run.results.slice(0, -1) });
    } else if (sc.kind === "strokes" && run.holes.length) setRun({ ...run, holes: run.holes.slice(0, -1) });
  };

  const elapsed = run ? (run.ended ?? now) - run.started : 0;

  return (
    <View style={bits.fill}>
      <TintedHeader color={TONES.green.card} title={drill.name} subtitle="Putting Lab" />
      <ScrollView contentContainerStyle={bits.body}>
        <GoldFrame tone="navy">
          <View style={styles.heroTop}>
            <Text style={styles.kicker}>{`${look.label} · ${drill.minutes} MIN${drill.home ? " · AT HOME" : ""}`}</Text>
            {run ? (
              <View style={styles.timer} accessibilityLabel={`Time ${mmss(elapsed)}`}>
                <Ionicons name="timer-outline" size={14} color={colors.gold400} />
                <Text style={styles.timerText}>{mmss(elapsed)}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.name} accessibilityRole="header">
            {drill.name}
          </Text>
          <Text style={styles.intro}>{drill.blurb}</Text>
          {best != null ? <Text style={styles.best}>{`Your best: ${scoreLabel(sc, best)}`}</Text> : null}
        </GoldFrame>

        {!run ? (
          <>
            <Card>
              <Text style={bits.kicker}>SET UP</Text>
              <Text style={bits.text}>{drill.setup}</Text>
              {drill.steps.map((s, i) => (
                <View key={s} style={styles.step}>
                  <View style={styles.num}>
                    <Text style={styles.numText}>{i + 1}</Text>
                  </View>
                  <Text style={[bits.text, { flex: 1 }]}>{s}</Text>
                </View>
              ))}
            </Card>
            <GoldButton label="Start the drill" icon="play" onPress={() => { setNewBest(false); setRun(fresh()); }} hint="Starts the timer and the scorer" />
          </>
        ) : run.ended ? (
          <Card style={styles.result}>
            <Text style={bits.kicker}>{newBest ? "NEW BEST" : "DRILL DONE"}</Text>
            <Text style={styles.resultScore}>{scoreLabel(sc, finalScore(drill, run))}</Text>
            <Text style={bits.muted}>{`In ${mmss(elapsed)}.${best != null && !newBest ? ` Your best is ${scoreLabel(sc, best)}.` : ""}`}</Text>
            <GoldButton label="Go again" icon="refresh" onPress={() => { setNewBest(false); setRun(fresh()); }} />
            <GhostButton label="Done" onPress={() => router.back()} />
          </Card>
        ) : (
          <Card>
            {sc.kind === "streak" ? (
              <>
                {sc.target <= 12 ? <Ring total={sc.target} done={run.streak} /> : null}
                <Text style={styles.status} accessibilityLiveRegion="polite">{`${run.streak} ${sc.unit} · ${run.putts} putts so far`}</Text>
                <Text style={[bits.muted, { textAlign: "center" }]}>{`Hole ${sc.target} in a row. Miss, and you start again.`}</Text>
                <View style={styles.btns}>
                  <Pressable onPress={() => tap(false)} style={({ pressed }) => [styles.miss, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                    <Text style={styles.missText}>Missed</Text>
                  </Pressable>
                  <Pressable onPress={() => tap(true)} style={({ pressed }) => [styles.hit, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                    <Text style={styles.hitText}>Holed it</Text>
                  </Pressable>
                </View>
              </>
            ) : sc.kind === "outOf" ? (
              <>
                <View style={styles.dots} accessible accessibilityLabel={`${run.good} good from ${run.attempts}. ${sc.target - run.attempts} to go.`}>
                  {Array.from({ length: sc.target }, (_, i) => (
                    <View key={i} style={[styles.dot, i < run.results.length && { backgroundColor: run.results[i] ? colors.green600 : colors.red600, borderColor: "transparent" }]} />
                  ))}
                </View>
                <Text style={styles.status} accessibilityLiveRegion="polite">{`${run.good} ${sc.good} · ${run.attempts} of ${sc.target}`}</Text>
                <View style={styles.btns}>
                  <Pressable onPress={() => tap(false)} style={({ pressed }) => [styles.miss, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                    <Text style={styles.missText}>Not this time</Text>
                  </Pressable>
                  <Pressable onPress={() => tap(true)} style={({ pressed }) => [styles.hit, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`Good: ${sc.good}`}>
                    <Text style={styles.hitText}>Good</Text>
                  </Pressable>
                </View>
                {run.results.length > 0 ? (
                  <Pressable onPress={undo} hitSlop={8} style={{ alignSelf: "center" }} accessibilityRole="button">
                    <Text style={styles.undo}>Undo last</Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.status} accessibilityLiveRegion="polite">{`Hole ${run.holes.length + 1} of ${sc.target} · ${run.holes.reduce((a, b) => a + b, 0)} putts so far`}</Text>
                <Text style={[bits.muted, { textAlign: "center" }]}>How many putts on this hole?</Text>
                <View style={styles.btns}>
                  {[1, 2, 3, 4].map((n) => (
                    <Pressable key={n} onPress={() => hole(n)} style={({ pressed }) => [styles.putt, n === 2 && styles.puttPar, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`${n === 4 ? "4 or more" : n} putts`}>
                      <Text style={[styles.puttText, n === 2 && { color: colors.gold400 }]}>{n === 4 ? "4+" : n}</Text>
                    </Pressable>
                  ))}
                </View>
                {run.holes.length > 0 ? (
                  <Pressable onPress={undo} hitSlop={8} style={{ alignSelf: "center" }} accessibilityRole="button">
                    <Text style={styles.undo}>Undo last hole</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </Card>
        )}

        <View style={styles.tip}>
          <Ionicons name="bulb-outline" size={22} color={colors.green700} />
          <Text style={styles.tipText}>{drill.tip}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 2, color: colors.gold400 },
  timer: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(247,243,234,0.12)", borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  timerText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50, fontVariant: ["tabular-nums"] },
  name: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: colors.cream50, marginTop: -6 },
  intro: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.cream100 },
  best: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.gold400 },

  step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  num: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: colors.gold500, alignItems: "center", justifyContent: "center" },
  numText: { fontFamily: fonts.display, fontSize: 14, color: colors.gold500 },

  green: { position: "absolute", left: 0, top: 0, width: 240, height: 240, borderRadius: 120, backgroundColor: "#2f7a3d" },
  cup: { position: "absolute", left: 108, top: 108, width: 24, height: 24, borderRadius: 12, backgroundColor: "#0b1a10", borderWidth: 2, borderColor: "#fff" },

  status: { fontFamily: fonts.display, fontSize: 21, color: colors.navy900, textAlign: "center" },
  btns: { flexDirection: "row", gap: 10 },
  miss: { flex: 1, minHeight: 58, borderRadius: 16, backgroundColor: colors.red100, borderWidth: 1.5, borderColor: "#e2b3aa", alignItems: "center", justifyContent: "center" },
  missText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.red600 },
  hit: { flex: 1.4, minHeight: 58, borderRadius: 16, backgroundColor: colors.green600, alignItems: "center", justifyContent: "center" },
  hitText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
  putt: { flex: 1, minHeight: 58, borderRadius: 16, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  puttPar: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  puttText: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.navy900 },
  undo: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.ink500, textDecorationLine: "underline" },

  dots: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },

  result: { alignItems: "stretch", borderColor: colors.gold500, borderWidth: 1.5 },
  resultScore: { fontFamily: fonts.display, fontSize: 28, color: colors.navy900 },

  tip: { flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: colors.green100, borderWidth: 1, borderColor: colors.green600, borderRadius: 22, padding: 16 },
  tipText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.green800 },
});
