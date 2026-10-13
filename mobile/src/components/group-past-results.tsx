import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { SectionTitle } from "@/components/group-bits";
import { loadGroupResults, type GroupResult } from "@/lib/competition-data";
import { dateLabel } from "@/lib/tee-times";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Past results on a group's page (0138): every competition the organiser
 * published to this group, newest first, for every member — played or not.
 * Each shows its winners and whether it was updated or amended; tapping
 * opens the full results with the countbacks.
 */
export function GroupPastResults({ groupId }: { groupId: number }) {
  const [list, setList] = useState<GroupResult[] | null>(null);
  const [all, setAll] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void loadGroupResults(groupId)
        .then(setList)
        .catch(() => setList([]));
    }, [groupId])
  );

  if (!list || list.length === 0) return null;
  const shown = all ? list : list.slice(0, 3);
  return (
    <>
      <SectionTitle>{`Past results (${list.length})`}</SectionTitle>
      {shown.map((r) => (
        <Pressable
          key={r.dayId}
          onPress={() => router.push({ pathname: "/live/day/results/[id]", params: { id: String(r.dayId) } })}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={`${r.title}, ${dateLabel(r.playedOn)}. ${r.winners.map((w) => `${w.label}: ${w.name}`).join(", ")}${r.amended ? ". Amended" : ""}`}
        >
          <View style={styles.trophy}>
            <Ionicons name="trophy" size={18} color={colors.gold400} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Text style={styles.title} numberOfLines={1}>
                {r.title}
              </Text>
              {r.amended ? <Text style={styles.amended}>Amended</Text> : r.updated ? <Text style={styles.updated}>Updated</Text> : null}
            </View>
            <Text style={styles.meta} numberOfLines={1}>
              {[r.courseName, dateLabel(r.playedOn)].filter(Boolean).join(" · ")}
            </Text>
            {r.winners.slice(0, 3).map((w) => (
              <Text key={w.label} style={styles.winner} numberOfLines={1}>
                {r.winners.length > 1 ? `${w.label}: ` : "Winner: "}
                <Text style={{ fontFamily: fonts.bodyBold }}>{w.name}</Text> · {w.score}
              </Text>
            ))}
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
        </Pressable>
      ))}
      {list.length > 3 ? (
        <Pressable onPress={() => setAll((a) => !a)} style={styles.more} accessibilityRole="button">
          <Text style={styles.moreText}>{all ? "Show fewer" : `Show all ${list.length}`}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md },
  trophy: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900, flexShrink: 1 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  winner: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink900 },
  amended: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: colors.cream50, backgroundColor: colors.red600, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
  updated: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: colors.navy900, backgroundColor: colors.gold400, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
  more: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  moreText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
});
