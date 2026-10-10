import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ScreenHeader, useCollapsingHeader } from "@/components/screen-header";
import { LoadError, StateMessage } from "@/components/state-message";
import { TeeDot } from "@/components/tee-chip";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { headline, playedLabel, scorecardTotals, vsParText } from "@/lib/scorecard-math";
import { scorecardStats } from "@/lib/scorecard-stats";
import { listScorecards, type Scorecard } from "@/lib/scorecards";
import { dateBadge } from "@/lib/profile-sections";
import { colors, creamAlpha, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A member's scorecards, newest round first (0110).
 *
 * Yours by default; ?member=<id>&name=<first name> shows someone else's —
 * only the cards their visibility lets you see (RLS decides, not this screen).
 *
 * Oct 2026: dressed like the tee-time screens — a photograph band with the
 * name on it, then the best round in a navy card and the season in tiles
 * (eagles, birdies, pars, par-or-better, putts, best points; scorecard-stats.ts),
 * then the cards themselves.
 */
export default function ScorecardsScreen() {
  const params = useLocalSearchParams<{ member?: string; name?: string }>();
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const memberId = params.member || me;
  const mine = memberId != null && memberId === me;
  const { scrollY, scrollProps } = useCollapsingHeader();

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

  const s = scorecardStats(cards);
  const subtitle =
    cards.length === 0
      ? "Every round, kept"
      : `${cards.length} ${cards.length === 1 ? "card" : "cards"}${s.best ? ` · best ${s.best.strokes}` : ""}`;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerTitle: "" }} />
      <ScreenHeader scene="linksSunset" title={title} subtitle={subtitle} scrollY={scrollY} />
      <FlatList
        {...scrollProps}
        data={cards}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.green700}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: spacing.md, marginBottom: spacing.xs }}>
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
              <>
                <Pressable
                  disabled={!s.best}
                  onPress={() => s.best && router.push({ pathname: "/scorecards/[id]", params: { id: String(s.best.id) } })}
                  style={({ pressed }) => [styles.hero, pressed && styles.pressed]}
                  accessibilityRole={s.best ? "button" : undefined}
                  accessibilityLabel={
                    s.best ? `Best round ${s.best.strokes}, ${vsParText(s.best.vsPar)}, ${s.best.courseName}` : "No full round yet"
                  }
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.kicker}>— BEST ROUND</Text>
                    {s.best ? (
                      <>
                        <View style={styles.bestRow}>
                          <Text style={styles.bestScore}>{s.best.strokes}</Text>
                          <View style={[styles.parPill, (s.best.vsPar ?? 1) <= 0 && styles.parPillUnder]}>
                            <Text style={styles.parPillText}>{vsParText(s.best.vsPar)}</Text>
                          </View>
                        </View>
                        <Text style={styles.bestCourse} numberOfLines={1}>
                          {s.best.courseName}
                        </Text>
                        <Text style={styles.bestDate}>{playedLabel(s.best.playedOn)}</Text>
                      </>
                    ) : (
                      <Text style={styles.heroEmpty}>Finish an 18-hole card to set your best.</Text>
                    )}
                  </View>
                  <View style={styles.heroSide}>
                    <HeroFigure label="Average" value={s.average == null ? "—" : String(s.average)} />
                    <View style={styles.heroRule} />
                    <HeroFigure label="Rounds" value={String(s.rounds)} />
                  </View>
                </Pressable>

                <View style={styles.tiles}>
                  <StatTile icon="star" tint={colors.gold500} label={s.eagles === 1 ? "Eagle" : "Eagles"} value={String(s.eagles)} />
                  <StatTile icon="sparkles" tint={colors.green700} label={s.birdies === 1 ? "Birdie" : "Birdies"} value={String(s.birdies)} />
                  <StatTile icon="flag" tint={colors.navy800} label="Pars" value={String(s.pars)} />
                  <StatTile icon="pie-chart" tint={colors.green600} label="Par or better" value={s.parOrBetterPct == null ? "—" : `${s.parOrBetterPct}%`} />
                  <StatTile icon="golf" tint={colors.navy800} label="Putts a round" value={s.puttsPerRound == null ? "—" : String(s.puttsPerRound)} />
                  <StatTile icon="trophy" tint={colors.gold500} label="Best points" value={s.bestPoints ? String(s.bestPoints.points) : "—"} />
                </View>

                <Text style={styles.sectionTitle}>ALL CARDS</Text>
              </>
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
  const finished = t.complete && t.total.strokes != null;
  const under = t.counts.eagle + t.counts.albatross + t.counts.birdie;
  const sub = [card.holes === 9 ? "9 holes" : "18 holes", card.teeName ? `${card.teeName} tees` : null].filter(Boolean).join(" · ");
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
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.course} numberOfLines={1}>
          {card.courseName}
        </Text>
        <View style={styles.subRow}>
          {card.teeName ? <TeeDot name={card.teeName} size={9} /> : null}
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        </View>
        <View style={styles.chips}>
          {t.points != null ? <MiniChip text={`${t.points} pts`} /> : null}
          {under > 0 ? <MiniChip text={`${under} ${under === 1 ? "birdie" : "birdies"}${t.counts.eagle + t.counts.albatross ? "+" : ""}`} tone="green" /> : null}
          {!finished && t.played > 0 ? <MiniChip text="In progress" tone="gold" /> : null}
        </View>
      </View>
      <View style={styles.scoreCol}>
        <Text style={[styles.score, !finished && styles.scoreThru]}>
          {finished ? t.total.strokes : t.played > 0 ? `Thru ${t.played}` : "—"}
        </Text>
        {t.played > 0 ? (
          <View style={[styles.rel, (t.vsPar ?? 1) <= 0 && styles.relUnder]}>
            <Text style={[styles.relText, (t.vsPar ?? 1) <= 0 && styles.relTextUnder]}>{vsParText(t.vsPar)}</Text>
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

function HeroFigure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroFigure}>
      <Text style={styles.heroValue}>{value}</Text>
      <Text style={styles.heroLabel}>{label}</Text>
    </View>
  );
}

function StatTile({ icon, tint, label, value }: { icon: keyof typeof Ionicons.glyphMap; tint: string; label: string; value: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={[styles.tileIcon, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={15} color={colors.cream50} />
      </View>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function MiniChip({ text, tone = "plain" }: { text: string; tone?: "plain" | "green" | "gold" }) {
  return (
    <View style={[styles.mini, tone === "green" && styles.miniGreen, tone === "gold" && styles.miniGold]}>
      <Text style={[styles.miniText, tone === "green" && styles.miniTextGreen]}>{text}</Text>
    </View>
  );
}

const CARD_SHADOW = {
  shadowColor: colors.navy900,
  shadowOpacity: 0.07,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 3 },
} as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream50 },
  list: { padding: spacing.md, gap: spacing.sm + 2, paddingBottom: spacing.xl },
  newButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 50, borderRadius: radii.pill, backgroundColor: colors.green700 },
  newLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },

  hero: { flexDirection: "row", gap: spacing.md, padding: spacing.md + 2, borderRadius: radii.lg + 4, backgroundColor: colors.navy900, ...CARD_SHADOW },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, color: colors.gold400 },
  bestRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  bestScore: { fontFamily: fonts.display, fontSize: 52, lineHeight: 58, color: colors.gold400 },
  parPill: { borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 2, backgroundColor: creamAlpha(0.16) },
  parPillUnder: { backgroundColor: colors.green600 },
  parPillText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50 },
  bestCourse: { fontFamily: fonts.display, fontSize: 17, color: colors.cream50, marginTop: 2 },
  bestDate: { fontFamily: fonts.body, fontSize: 12.5, color: creamAlpha(0.7), marginTop: 2 },
  heroEmpty: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: creamAlpha(0.85), marginTop: spacing.sm },
  heroSide: { justifyContent: "center", alignItems: "center", paddingLeft: spacing.md, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: creamAlpha(0.25) },
  heroFigure: { alignItems: "center", minWidth: 70 },
  heroValue: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, color: colors.cream50 },
  heroLabel: { fontFamily: fonts.bodySemi, fontSize: 11, letterSpacing: 0.6, color: creamAlpha(0.7), textTransform: "uppercase" },
  heroRule: { width: 34, height: StyleSheet.hairlineWidth, backgroundColor: creamAlpha(0.3), marginVertical: 10 },

  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    width: "31.5%",
    flexGrow: 1,
    alignItems: "flex-start",
    padding: 12,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...CARD_SHADOW,
  },
  tileIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  tileValue: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28, color: colors.ink900 },
  tileLabel: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink500, marginTop: 1 },

  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.6, color: colors.ink500, marginTop: spacing.sm },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...CARD_SHADOW,
  },
  dateBadge: { width: 48, alignItems: "center", paddingVertical: 6, borderRadius: radii.md, backgroundColor: colors.navy900 },
  dateDay: { fontFamily: fonts.display, fontSize: 21, lineHeight: 25, color: colors.cream50 },
  dateMonth: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1, color: colors.gold400 },
  course: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.ink900 },
  subRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sub: { flexShrink: 1, fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  mini: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: colors.cream100 },
  miniGreen: { backgroundColor: colors.green100 },
  miniGold: { backgroundColor: "#f8ecc9" },
  miniText: { fontFamily: fonts.bodySemi, fontSize: 11.5, color: colors.ink900 },
  miniTextGreen: { color: colors.green800 },
  scoreCol: { alignItems: "flex-end", gap: 4 },
  score: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32, color: colors.ink900 },
  scoreThru: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: colors.ink500 },
  rel: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 1, backgroundColor: colors.red100 },
  relUnder: { backgroundColor: colors.green100 },
  relText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.red600 },
  relTextUnder: { color: colors.green700 },
  pressed: { opacity: 0.88 },
});
