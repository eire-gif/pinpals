import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { headline, scorecardTotals, vsParText } from "@/lib/scorecard-math";
import { listScorecards, type Scorecard } from "@/lib/scorecards";
import { dateBadge } from "@/lib/profile-sections";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A member's scorecards, newest round first (0110).
 *
 * Yours by default; ?member=<id>&name=<first name> shows someone else's —
 * only the cards their visibility lets you see (RLS decides, not this screen).
 */
export default function ScorecardsScreen() {
  const params = useLocalSearchParams<{ member?: string; name?: string }>();
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const memberId = params.member || me;
  const mine = memberId != null && memberId === me;

  const [cards, setCards] = useState<Scorecard[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!memberId) return;
    try {
      setFailed(false);
      setCards(await listScorecards(memberId));
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [memberId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const title = mine ? "My scorecards" : `${params.name ?? "Their"} scorecards`;
  if (!isOn("scorecards")) return <StateMessage size="screen" icon="document-text-outline" title="Scorecards are on their way" />;
  if (failed) return <LoadError size="screen" what="scorecards" onRetry={() => void load()} />;
  if (cards === undefined) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;

  // Best and average over complete 18-hole cards: the numbers golfers compare.
  const full = cards.map((c) => ({ c, t: scorecardTotals(c.holeList, c.playingHandicap) })).filter((x) => x.c.holes === 18 && x.t.complete);
  const best = full.reduce<number | null>((b, x) => (x.t.total.strokes != null && (b == null || x.t.total.strokes < b) ? x.t.total.strokes : b), null);
  const avg = full.length >= 3 ? Math.round((full.reduce((s, x) => s + (x.t.total.strokes ?? 0), 0) / full.length) * 10) / 10 : null;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title }} />
      <FlatList
        data={cards}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.green700} />}
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            {mine ? (
              <Pressable
                onPress={() => router.push("/scorecards/new")}
                style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Ionicons name="add" size={20} color={colors.cream50} />
                <Text style={styles.newLabel}>New scorecard</Text>
              </Pressable>
            ) : null}
            {cards.length > 0 ? (
              <View style={styles.stats}>
                <Stat label="Cards" value={String(cards.length)} />
                <Stat label="Best 18" value={best == null ? "—" : String(best)} />
                <Stat label="Average" value={avg == null ? "—" : String(avg)} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <StateMessage
            icon="document-text-outline"
            title={mine ? "No scorecards yet" : "Nothing to show"}
            body={
              mine
                ? "Save your card from a live round, or make one from any course's scorecard. It's kept here, and you can share it."
                : `${params.name ?? "This member"} hasn't shared a scorecard you can see.`
            }
          />
        }
        renderItem={({ item }) => <CardRow card={item} />}
      />
    </View>
  );
}

function CardRow({ card }: { card: Scorecard }) {
  const t = scorecardTotals(card.holeList, card.playingHandicap);
  const d = dateBadge(card.playedOn);
  const sub = [card.holes === 9 ? "9 holes" : "18 holes", card.teeName ? `${card.teeName} tees` : null, t.points != null ? `${t.points} pts` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/scorecards/[id]", params: { id: String(card.id) } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${card.courseName}, ${d.day} ${d.month}. ${headline(t)}`}
    >
      <View style={styles.dateBadge}>
        <Text style={styles.dateDay}>{d.day}</Text>
        <Text style={styles.dateMonth}>{d.month.toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.course} numberOfLines={1}>
          {card.courseName}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={styles.score}>{t.complete && t.total.strokes != null ? t.total.strokes : t.played > 0 ? `${t.played}/${card.holes}` : "—"}</Text>
        {t.played > 0 ? <Text style={[styles.rel, (t.vsPar ?? 1) <= 0 && styles.relUnder]}>{vsParText(t.vsPar)}</Text> : null}
      </View>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream50 },
  list: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  newButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.green700 },
  newLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  stats: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, alignItems: "center", paddingVertical: spacing.sm + 2, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  statValue: { fontFamily: fonts.display, fontSize: 24, color: colors.ink900 },
  statLabel: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink500 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  dateBadge: { width: 46, alignItems: "center", paddingVertical: 4, borderRadius: radii.sm, backgroundColor: colors.navy900 },
  dateDay: { fontFamily: fonts.display, fontSize: 20, lineHeight: 24, color: colors.cream50 },
  dateMonth: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1, color: colors.gold400 },
  course: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.ink900 },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 2 },
  score: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, color: colors.ink900 },
  rel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.red600 },
  relUnder: { color: colors.green700 },
  pressed: { opacity: 0.85 },
});
