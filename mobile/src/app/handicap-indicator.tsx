import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { bestOfLabel, comparedWithOwn, indicatorLabel, INDICATOR_WINDOW } from "@/lib/handicap-indicator";
import { loadMyHandicapIndicator, loadMyIndicatorCards, type HandicapIndicator, type IndicatorCard } from "@/lib/scorecards";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Your handicap indicator (0122): what the World Handicap System would make
 * of your last 20 scorecards, and which of them count. It sits beside the
 * handicap you set yourself and never changes it.
 */
export default function HandicapIndicatorScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [summary, setSummary] = useState<HandicapIndicator | null>(null);
  const [cards, setCards] = useState<IndicatorCard[]>([]);
  const [own, setOwn] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [s, list, me] = await Promise.all([
        loadMyHandicapIndicator(),
        loadMyIndicatorCards(),
        supabase.from("member_private").select("handicap").eq("member_id", userId).maybeSingle<{ handicap: number | null }>(),
      ]);
      setSummary(s);
      setCards(list);
      setOwn(me.data?.handicap != null ? Number(me.data.handicap) : null);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (failed && !summary) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Handicap indicator", headerBackTitle: "Back" }} />
        <LoadError onRetry={() => void load()} what="your indicator" size="screen" />
      </View>
    );
  }
  if (!summary) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Handicap indicator", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  const compare = comparedWithOwn(summary.indicator, own);

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: "Handicap indicator", headerBackTitle: "Back" }} />

      <View style={styles.hero}>
        <Text style={styles.heroLabel}>PINPALS INDICATOR · UNOFFICIAL</Text>
        <Text style={styles.heroValue}>{summary.indicator != null ? indicatorLabel(summary.indicator) : "—"}</Text>
        <Text style={styles.heroRule}>{bestOfLabel(summary.rounds)}</Text>
        {compare ? <Text style={styles.heroCompare}>{compare}</Text> : null}
      </View>

      <View style={styles.note}>
        <Ionicons name="information-circle-outline" size={20} color={colors.navy900} />
        <Text style={styles.noteText}>
          A guide only — not an official Golf Ireland or WHS handicap. Your handicap{own != null ? ` (${indicatorLabel(own)})` : ""} stays exactly as you set it. The captain and secretary of a society you&apos;re in can see this indicator too, to help them set your society handicap.
        </Text>
      </View>

      <Text style={styles.section}>How it&apos;s worked out</Text>
      <Text style={styles.how}>
        The World Handicap System way, from your last {INDICATOR_WINDOW} 18-hole scorecards that have the course rating and slope. Each hole counts no worse than a net double bogey; each card becomes a score differential, and your best ones are averaged. Nine-hole cards don&apos;t count yet.
      </Text>

      {cards.length > 0 ? (
        <>
          <Text style={styles.section}>{`Your cards (${cards.length})`}</Text>
          {cards.map((c) => (
            <Pressable
              key={c.scorecardId}
              style={[styles.row, c.counts && styles.rowCounts]}
              onPress={() => router.push({ pathname: "/scorecards/[id]", params: { id: String(c.scorecardId) } })}
              accessibilityRole="button"
              accessibilityLabel={`${c.courseName}, differential ${c.differential.toFixed(1)}${c.counts ? ", counts" : ""}`}
            >
              <View style={styles.rowBody}>
                <Text style={styles.course} numberOfLines={1}>
                  {c.courseName}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[new Date(`${c.playedOn}T12:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }), c.teeName, `adjusted ${c.adjustedGross}`].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <View style={styles.diff}>
                <Text style={[styles.diffValue, c.counts && styles.diffCounts]}>{c.differential.toFixed(1)}</Text>
                {c.counts ? <Text style={styles.countsTag}>Counts</Text> : null}
              </View>
            </Pressable>
          ))}
        </>
      ) : (
        <Pressable style={styles.cta} onPress={() => router.push("/scorecards/new")} accessibilityRole="button">
          <Ionicons name="add" size={18} color={colors.cream50} />
          <Text style={styles.ctaText}>Add a scorecard</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  hero: { alignItems: "center", gap: 4, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  heroLabel: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, color: colors.gold400 },
  heroValue: { fontFamily: fonts.display, fontSize: 52, color: colors.cream50 },
  heroRule: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.cream100, textAlign: "center" },
  heroCompare: { fontFamily: fonts.body, fontSize: type.small, color: colors.gold400, marginTop: 2 },
  note: { flexDirection: "row", gap: spacing.sm, padding: 12, borderRadius: radii.md, backgroundColor: colors.cream100 },
  noteText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.ink900, lineHeight: 20 },
  section: { fontFamily: fonts.bodyBold, fontSize: type.label, color: colors.ink500, textTransform: "uppercase", letterSpacing: 0.8, marginTop: spacing.md },
  how: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900, lineHeight: 21 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  rowCounts: { borderColor: colors.green600, backgroundColor: colors.green100 },
  rowBody: { flex: 1, gap: 2 },
  course: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  diff: { alignItems: "flex-end" },
  diffValue: { fontFamily: fonts.bodyBold, fontSize: type.heading, color: colors.ink500 },
  diffCounts: { color: colors.green800 },
  countsTag: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.green700 },
  cta: { flexDirection: "row", gap: 6, height: 48, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700, marginTop: spacing.md },
  ctaText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
