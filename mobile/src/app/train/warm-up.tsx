import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GoldFrame } from "@/components/format-art";
import { ScreenHeader } from "@/components/screen-header";
import { Card, Chip, bits } from "@/components/train-bits";
import { PUTTING_ROUTINE, WARM_UPS, WINDY_EXTRA, type WarmUpLength } from "@/lib/training";
import { colors, fonts } from "@/lib/theme";

/** Training → Pre-round warm-up: 5, 20 or 40 minutes, then your putting routine. */

const LENGTHS: WarmUpLength[] = ["carPark", "standard", "full"];

export default function WarmUpScreen() {
  const [length, setLength] = useState<WarmUpLength>("standard");
  const w = WARM_UPS[length];

  return (
    <View style={bits.fill}>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Training" }} />
      <ScreenHeader scene="linksSunset" title="Pre-round warm-up" subtitle="Before you head to the first tee" />
      <ScrollView contentContainerStyle={bits.body}>
        <View style={styles.lengths} accessibilityRole="radiogroup" accessibilityLabel="How long you have">
          {LENGTHS.map((l) => (
            <Chip key={l} label={`${WARM_UPS[l].label} · ${WARM_UPS[l].minutes} min`} on={length === l} onPress={() => setLength(l)} />
          ))}
        </View>

        <GoldFrame tone="navy">
          <Text style={styles.kicker}>{`${w.label.toUpperCase()} · ${w.minutes} MINUTES`}</Text>
          {w.steps.map((s, i) => (
            <View key={s.title} style={styles.step}>
              <View style={styles.dot} />
              <View style={{ flex: 1, gap: 3 }}>
                <View style={styles.stepHead}>
                  <Text style={styles.stepTitle}>{s.title}</Text>
                  <Text style={styles.stepMins}>{`${s.minutes} min`}</Text>
                </View>
                <Text style={styles.stepBody}>{s.body}</Text>
                {i === w.steps.length - 1 ? null : <View style={styles.rule} />}
              </View>
            </View>
          ))}
        </GoldFrame>

        <View style={styles.wind}>
          <Ionicons name="flag-outline" size={20} color={colors.navy800} />
          <Text style={styles.windText}>{WINDY_EXTRA}</Text>
        </View>

        <Card>
          <Text style={bits.h2}>Your putting routine</Text>
          {PUTTING_ROUTINE.map((r, i) => (
            <View key={r} style={styles.routine}>
              <Text style={styles.routineNum}>{i + 1}</Text>
              <Text style={[bits.text, { flex: 1 }]}>{r}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  lengths: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 2, color: colors.gold400 },
  step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: colors.gold400, marginTop: 4 },
  stepHead: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  stepTitle: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.cream50 },
  stepMins: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.gold400 },
  stepBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.cream100 },
  rule: { height: 1, backgroundColor: "rgba(211,165,63,0.25)", marginTop: 10 },
  wind: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "#e3ebf5", borderRadius: 16, padding: 14 },
  windText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.navy900 },
  routine: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  routineNum: { width: 24, height: 24, borderRadius: 12, overflow: "hidden", textAlign: "center", lineHeight: 24, backgroundColor: colors.cream100, fontFamily: fonts.bodyBold, fontSize: 12, color: "#8a6a1f" },
});
