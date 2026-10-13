import { useCallback, useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { loadGroupResults, type GroupResult } from "@/lib/competition-data";
import { dateLabel } from "@/lib/tee-times";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Past results on a group's page (0138): every competition the organiser
 * published to this group, newest first, for every member — played or not.
 *
 * Folded away by default (Oct 2026): a society that plays every week would
 * otherwise push its members list off the page. The closed row still shows
 * how many there are and who won the latest; tapping opens the three most
 * recent, and "See all results" opens the group's Results screen with the
 * full history.
 */
export function GroupPastResults({ groupId }: { groupId: number }) {
  const [list, setList] = useState<GroupResult[] | null>(null);
  const [open, setOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void loadGroupResults(groupId)
        .then(setList)
        .catch(() => setList([]));
    }, [groupId])
  );

  if (!list || list.length === 0) return null;
  const latest = list[0];
  const latestWinner = latest.winners[0];
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => !o);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={toggle}
        style={({ pressed }) => [styles.head, open && styles.headOpen, pressed && { opacity: 0.9 }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Past results, ${list.length}. ${open ? "Tap to hide" : "Tap to show"}`}
      >
        <View style={styles.headIcon}>
          <Ionicons name="trophy" size={17} color={colors.gold400} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.headTitle}>
            Past results <Text style={styles.headCount}>{`· ${list.length}`}</Text>
          </Text>
          {!open && latestWinner ? (
            <Text style={styles.headSub} numberOfLines={1}>
              {`Latest ${dateLabel(latest.playedOn)}: ${latestWinner.name} · ${latestWinner.score}`}
            </Text>
          ) : (
            <Text style={styles.headSub}>Newest first · tap one for the full results</Text>
          )}
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.navy900} />
      </Pressable>

      {open ? (
        <View style={styles.body}>
          {list.slice(0, 3).map((r) => (
            <ResultCard key={r.dayId} result={r} />
          ))}
          <Pressable
            onPress={() => router.push({ pathname: "/group/[id]/results", params: { id: String(groupId) } })}
            style={({ pressed }) => [styles.all, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
          >
            <Text style={styles.allText}>{list.length > 3 ? `See all ${list.length} results` : "Open the results page"}</Text>
            <Ionicons name="arrow-forward" size={16} color={colors.green700} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** One published competition: title, status, where and when, the winners. */
export function ResultCard({ result: r }: { result: GroupResult }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/live/day/results/[id]", params: { id: String(r.dayId) } })}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={`${r.title}, ${dateLabel(r.playedOn)}. ${r.winners.map((w) => `${w.label}: ${w.name}`).join(", ")}${r.amended ? ". Amended" : ""}`}
    >
      <View style={styles.date}>
        <Text style={styles.dateDay}>{dayOfMonth(r.playedOn)}</Text>
        <Text style={styles.dateMonth}>{monthShort(r.playedOn)}</Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text style={styles.title} numberOfLines={1}>
            {r.title}
          </Text>
          {r.amended ? <Text style={styles.amended}>Amended</Text> : r.updated ? <Text style={styles.updated}>Updated</Text> : null}
        </View>
        {r.courseName ? (
          <Text style={styles.meta} numberOfLines={1}>
            {r.courseName}
          </Text>
        ) : null}
        {r.winners.slice(0, 3).map((w) => (
          <Text key={w.label} style={styles.winner} numberOfLines={1}>
            {r.winners.length > 1 ? `${w.label}: ` : "Winner: "}
            <Text style={{ fontFamily: fonts.bodyBold }}>{w.name}</Text> · {w.score}
          </Text>
        ))}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

function parts(iso: string): Date | null {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function dayOfMonth(iso: string) {
  return parts(iso)?.getDate().toString() ?? "–";
}
function monthShort(iso: string) {
  return parts(iso)?.toLocaleDateString("en-IE", { month: "short" }).toUpperCase() ?? "";
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, padding: spacing.md, minHeight: 64 },
  headOpen: { backgroundColor: colors.surfaceTint, borderBottomWidth: 1, borderBottomColor: colors.line },
  headIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  headTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  headCount: { fontFamily: fonts.bodySemi, color: colors.ink500 },
  headSub: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },

  body: { padding: spacing.sm + 4, gap: spacing.sm },
  all: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  allText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },

  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, padding: spacing.sm + 4 },
  date: { width: 46, paddingVertical: 6, borderRadius: radii.sm, backgroundColor: colors.navy900, alignItems: "center" },
  dateDay: { fontFamily: fonts.display, fontSize: 19, lineHeight: 22, color: colors.cream50 },
  dateMonth: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1, color: colors.gold400 },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body - 0.5, color: colors.ink900, flexShrink: 1 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  winner: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink900 },
  amended: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: colors.cream50, backgroundColor: colors.red600, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
  updated: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: colors.navy900, backgroundColor: colors.gold400, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
});
