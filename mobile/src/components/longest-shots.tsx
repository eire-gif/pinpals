import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CLUBS, clubInfo } from "@/lib/bag";
import { loadLongestShots, type LongestShot } from "@/lib/hole-extras";
import { METRES_PER_YARD } from "@/lib/hole-geo";
import { colors, fonts, radii, spacing } from "@/lib/theme";

const order = (k: string) => {
  const i = CLUBS.findIndex((c) => c.key === k);
  return i < 0 ? 99 : i;
};

const shortDate = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }) : null);

/**
 * Longest shots (Oct 2026, 0154): the member's longest shot with each club —
 * from the shots they marked on the hole map and tagged with a club. For one
 * round (under its scorecard) or ever (My bag). Shows nothing when there are
 * none for a round; for "ever" it says how to get some.
 */
export function LongestShots({ roundId = null }: { roundId?: number | null }) {
  const [rows, setRows] = useState<LongestShot[] | null>(null);
  useFocusEffect(
    useCallback(() => {
      let on = true;
      void loadLongestShots(roundId)
        .then((r) => on && setRows(r.sort((a, b) => order(a.club) - order(b.club))))
        .catch(() => on && setRows([]));
      return () => {
        on = false;
      };
    }, [roundId])
  );

  if (rows === null) return null;
  if (rows.length === 0 && roundId != null) return null;
  const ever = roundId == null;

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Ionicons name="trophy" size={14} color={colors.gold500} />
        <Text style={styles.head}>{ever ? "My longest shots" : "Longest shots this round"}</Text>
      </View>
      {rows.length === 0 ? (
        <Text style={styles.hint}>On the hole map, mark where your ball finishes and tap the club you hit. Your longest with each club shows here.</Text>
      ) : (
        rows.map((r) => {
          const where = ever ? [r.courseName, shortDate(r.playedOn)].filter(Boolean).join(" · ") : `Hole ${r.hole}`;
          return (
            <View key={r.club} style={styles.row}>
              <Text style={styles.club}>{clubInfo(r.club).name}</Text>
              <View style={styles.right}>
                <Text style={styles.dist}>
                  {Math.round(r.distanceM / METRES_PER_YARD)}
                  <Text style={styles.unit}> yds</Text>
                </Text>
                {where ? <Text style={styles.where}>{where}</Text> : null}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.sm },
  headRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  head: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: colors.green700 },
  hint: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink500 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.cream100 },
  club: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 16, color: colors.navy900 },
  right: { alignItems: "flex-end" },
  dist: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  unit: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink500 },
  where: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
});
