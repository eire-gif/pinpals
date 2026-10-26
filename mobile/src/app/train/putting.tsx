import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { TONES } from "@/components/live-scoring-card";
import { TintedHeader } from "@/components/tinted-header";
import { Card, Chip, DrillRow, GhostButton, bits } from "@/components/train-bits";
import { DRILLS, DRILL_FOCUS, PUTTING_ROUTINE, scoreLabel, type DrillFocus } from "@/lib/training";
import { useTraining } from "@/lib/training-store";
import { colors, fonts } from "@/lib/theme";

/** Training → Putting Lab: every drill by what it trains, with your best scores. */

type Filter = "all" | DrillFocus | "home";

export default function PuttingLabScreen() {
  const router = useRouter();
  const { bests } = useTraining();
  const [filter, setFilter] = useState<Filter>("all");
  const groups = DRILL_FOCUS.filter((f) => filter === "all" || filter === "home" || f.id === filter);

  return (
    <View style={bits.fill}>
      <TintedHeader color={TONES.green.card} title="Putting Lab" subtitle={`${DRILLS.length} drills · speed, line and pressure`} />
      <ScrollView contentContainerStyle={bits.body}>
        <Card dark>
          <Text style={styles.kicker}>WHERE TO START</Text>
          <Text style={styles.lead}>Most three-putts start with a long first putt left short or run past. Speed first, then line.</Text>
          <GhostButton dark label="Check your putting in My Game" icon="stats-chart-outline" onPress={() => router.push("/my-game")} />
        </Card>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={bits.chips}>
          {([{ id: "all", label: "All" }, ...DRILL_FOCUS, { id: "home", label: "At home" }] as { id: Filter; label: string }[]).map((c) => (
            <Chip key={c.id} label={c.label} on={filter === c.id} onPress={() => setFilter(c.id)} />
          ))}
        </ScrollView>

        {groups.map((g) => {
          const items = DRILLS.filter((d) => d.focus === g.id && (filter !== "home" || d.home));
          if (items.length === 0) return null;
          return (
            <View key={g.id} style={{ gap: 8 }}>
              <Text style={styles.groupLabel} accessibilityRole="header">
                {g.label.toUpperCase()}
              </Text>
              <View style={bits.group}>
                {items.map((d, i) => (
                  <DrillRow
                    key={d.id}
                    drill={d}
                    first={i === 0}
                    best={bests[d.id] != null ? scoreLabel(d.scoring, bests[d.id]) : undefined}
                    onPress={() => router.push(`/train/drill/${d.id}`)}
                  />
                ))}
              </View>
            </View>
          );
        })}

        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Ionicons name="repeat-outline" size={20} color={colors.gold500} />
            <Text style={bits.h2}>Your putting routine</Text>
          </View>
          {PUTTING_ROUTINE.map((r, i) => (
            <View key={r} style={styles.step}>
              <Text style={styles.stepNum}>{i + 1}</Text>
              <Text style={[bits.text, { flex: 1 }]}>{r}</Text>
            </View>
          ))}
          <Text style={bits.muted}>Use the same routine in every drill, so it's automatic when it counts.</Text>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 2, color: colors.gold400 },
  lead: { fontFamily: fonts.display, fontSize: 19, lineHeight: 25, color: colors.cream50 },
  groupLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, color: colors.green700, marginTop: 4 },
  step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stepNum: { width: 24, height: 24, borderRadius: 12, overflow: "hidden", textAlign: "center", lineHeight: 24, backgroundColor: colors.cream100, fontFamily: fonts.bodyBold, fontSize: 12, color: "#8a6a1f" },
});
