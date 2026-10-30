import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";

import { TONES } from "@/components/live-scoring-card";
import { LoadError, StateMessage } from "@/components/state-message";
import { TintedHeader } from "@/components/tinted-header";
import { loadHoleChampions, netName, type HoleChampion } from "@/lib/course-boards";
import { isOn } from "@/lib/features";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * Hole champions (0197; approved mock-up "Hole champions"): the best net
 * score on each hole of a course this month, and who made it. Ties go to
 * whoever did it first. Holes you own are picked out in gold.
 */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function HoleChampionsScreen() {
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const clubId = Number(params.id);
  const name = params.name ?? "This course";
  const [holes, setHoles] = useState<HoleChampion[] | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setFailed(false);
      const r = await loadHoleChampions(clubId);
      setHoles(r.holes);
      setMonth(r.monthStart);
    } catch {
      setFailed(true);
    }
  }, [clubId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const monthName = month ? MONTHS[Number(month.slice(5, 7)) - 1] : MONTHS[new Date().getMonth()];
  const header = <TintedHeader color={TONES.green.card} title="Hole Champions" subtitle={`${name} · ${monthName}`} />;

  if (!isOn("courseBoards")) {
    return (
      <>
        {header}
        <StateMessage size="screen" icon="flag-outline" title="Hole champions are on their way" />
      </>
    );
  }
  if (failed) {
    return (
      <>
        {header}
        <LoadError size="screen" what="the hole champions" onRetry={() => void load()} />
      </>
    );
  }
  if (!holes) {
    return (
      <>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </>
    );
  }

  const byHole = new Map(holes.map((h) => [h.hole, h]));
  const mine = holes.filter((h) => h.isMe).map((h) => h.hole);
  const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();

  return (
    <>
      {header}
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <View style={styles.ring}>
            <Text style={styles.ringText}>{mine.length}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroEyebrow}>YOU OWN</Text>
            <Text style={styles.heroTitle}>
              {mine.length === 0 ? "No holes yet" : mine.length === 1 ? `Hole ${mine[0]}` : `Holes ${mine.slice(0, -1).join(", ")} and ${mine[mine.length - 1]}`}
            </Text>
            <Text style={styles.heroSub}>
              {mine.length === 0
                ? "Best net score on a hole this month takes it. Ties go to whoever did it first."
                : `Best net score this month. Defend ${mine.length === 1 ? "it" : "them"} before the ${lastDay}${lastDay === 31 ? "st" : "th"}.`}
            </Text>
          </View>
        </View>

        {holes.length === 0 ? (
          <StateMessage icon="flag-outline" title="No champions yet this month" body="Save a scorecard from a round here and you could own a hole or two." />
        ) : (
          <View style={styles.grid}>
            {Array.from({ length: 18 }, (_, i) => i + 1).map((n) => {
              const c = byHole.get(n);
              const kind = c ? netName(c.netToPar) : null;
              return (
                <View
                  key={n}
                  style={[styles.cell, c?.isMe && styles.cellMine]}
                  accessible
                  accessibilityLabel={c ? `Hole ${n}: ${c.isMe ? "you" : c.name}, net ${kind?.toLowerCase()}${c.tied > 1 ? `, ${c.tied} matched it` : ""}` : `Hole ${n}: no champion yet`}
                >
                  <Text style={styles.hole}>{n}</Text>
                  <Text style={styles.who} numberOfLines={1}>
                    {c ? (c.isMe ? "You" : c.name) : "—"}
                  </Text>
                  {c ? (
                    <Text style={[styles.chip, c.netToPar <= -2 ? styles.eagle : c.netToPar === -1 ? styles.birdie : styles.par]}>{kind}</Text>
                  ) : null}
                  {c && c.tied > 1 ? <Text style={styles.tied}>{`+${c.tied - 1} matched`}</Text> : null}
                </View>
              );
            })}
          </View>
        )}
        <Text style={styles.foot}>Net scores from members&apos; saved scorecards. Ties go to whoever did it first.</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: 14 },
  hero: { flexDirection: "row", alignItems: "center", gap: 14, padding: spacing.md, borderRadius: 22, backgroundColor: colors.green800, borderWidth: 2, borderColor: "#c9a24a" },
  ring: { width: 58, height: 58, borderRadius: 29, borderWidth: 3, borderColor: "#e2b85c", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.18)" },
  ringText: { fontFamily: fonts.bodyBold, fontSize: 26, color: colors.gold400 },
  heroEyebrow: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 2, color: colors.gold400 },
  heroTitle: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.cream50, marginTop: 4 },
  heroSub: { fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: "#d6e4da", marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: { width: "31.5%", flexGrow: 1, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1.5, borderColor: "#e6dcc6", paddingVertical: 10, paddingHorizontal: 6, alignItems: "center", gap: 6 },
  cellMine: { backgroundColor: "#fbf3df", borderColor: "#c9a24a", borderWidth: 2 },
  hole: { fontFamily: fonts.bodyBold, fontSize: 22, color: colors.navy900 },
  who: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy900 },
  chip: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill, overflow: "hidden" },
  eagle: { backgroundColor: colors.green800, color: "#fff" },
  birdie: { backgroundColor: "#e3eee6", color: colors.green800 },
  par: { backgroundColor: "#ece4d2", color: colors.ink500 },
  tied: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  foot: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink500, textAlign: "center" },
});
