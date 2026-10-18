import { useCallback, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { useMembership } from "@/lib/membership";
import { listScorecards } from "@/lib/scorecards";
import {
  fmtOver,
  heatLevel,
  isMeasured,
  notYetLabel,
  readLabel,
  scoringPatterns,
  type Figure,
  type Insight,
  type ScoringPatterns,
} from "@/lib/scoring-patterns";
import { colors, creamAlpha, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * My Game, stage 1 (claude/my-game-stats.md, Oct 2026): what a member's own
 * scores say about their game — where the shots go by par, hole difficulty,
 * the start and the two nines, doubles and what follows them, and the
 * course they play most, hole by hole. Every number is worked out in
 * lib/scoring-patterns.ts from their last 20 cards, says how much it rests
 * on, and stays hidden until there's enough.
 *
 * Part of the "stats" feature (Stats & insights): free while paid plans are
 * off, Premium when they're on.
 */
export default function MyGameScreen() {
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const { gate } = useMembership();
  const [patterns, setPatterns] = useState<ScoringPatterns | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      setFailed(false);
      const cards = await listScorecards(me, 50);
      setPatterns(scoringPatterns(cards));
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [me]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const access = gate("stats");
  const header = <Stack.Screen options={{ title: "My Game", headerBackTitle: "Back" }} />;
  if (access === "hide") {
    return (
      <>
        {header}
        <StateMessage size="screen" icon="stats-chart-outline" title="My Game isn't available" />
      </>
    );
  }
  if (access === "locked") {
    return (
      <View style={styles.screen}>
        {header}
        <View style={[styles.list, { flex: 1, justifyContent: "center" }]}>
          <View style={styles.hero}>
            <Text style={styles.kicker}>PREMIUM</Text>
            <Text style={styles.heroTitle}>See where your shots really go</Text>
            <Text style={styles.heroBody}>My Game turns your scorecards into the patterns costing you most — by par, by hole, at the course you play most.</Text>
            <Pressable onPress={() => router.push("/membership")} style={({ pressed }) => [styles.upgrade, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={styles.upgradeText}>See Premium</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }
  if (failed) return <LoadError size="screen" what="your game" onRetry={() => void load()} />;
  if (!patterns) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;

  const p = patterns;
  if (p.rounds === 0) {
    return (
      <>
        {header}
        <StateMessage
          size="screen"
          icon="stats-chart-outline"
          title="Your game, from your scores"
          body="Save a few scorecards — from a live round, or by hand — and My Game shows where your shots go."
        />
      </>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView
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
      >
        <Text style={styles.intro}>
          From the scores on your last {p.rounds} {p.rounds === 1 ? "card" : "cards"} ({p.holes} holes).
        </Text>

        <View style={styles.hero}>
          <Text style={styles.kicker}>WHAT'S COSTING YOU MOST</Text>
          {p.insights.length > 0 ? (
            p.insights.map((i, n) => <InsightRow key={n} insight={i} first={n === 0} />)
          ) : (
            <Text style={styles.heroBody}>
              Nothing stands out yet. Keep saving your cards — each one sharpens the picture.
            </Text>
          )}
        </View>

        <Section title="By par">
          <View style={styles.tiles}>
            {p.byPar.map((r) => (
              <Tile key={r.par} label={`Par ${r.par}s`} figure={r.avgOver} unit="holes" />
            ))}
          </View>
          <Text style={styles.note}>Average strokes over par on each hole.</Text>
        </Section>

        <Section title="By hole difficulty">
          {p.byDifficulty.map((d) => (
            <Row key={d.band} label={d.label} figure={d.avgOver} show={(v) => `${fmtOver(v)} a hole`} unit="holes" />
          ))}
        </Section>

        <Section title="How your round goes">
          <Row
            label="First three holes"
            figure={p.start}
            show={(v) => `${fmtOver(v.firstThree)} a hole`}
            sub={isMeasured(p.start) ? `Rest of the round ${fmtOver(p.start.value.rest)} a hole` : undefined}
            unit="rounds"
          />
          <Row label="Front nine / back nine" figure={p.nines} show={(v) => `${v.front} / ${v.back}`} unit="full rounds" />
          <Row label="Doubles or worse" figure={p.doublesPerRound} show={(v) => `${v} a round`} unit="holes" />
          <Row label="Par or better after a double" figure={p.bounceBack} show={(v) => `${v}%`} unit="doubles" />
        </Section>

        {p.course ? (
          <Section title={"holes" in p.course ? `${p.course.courseName}, hole by hole` : "Your course, hole by hole"}>
            {"holes" in p.course ? (
              <>
                <View style={styles.heat}>
                  {p.course.holes.map((h) => {
                    const lvl = heatLevel(h.avgOver);
                    return (
                      <View
                        key={h.hole}
                        style={[styles.heatCell, HEAT[lvl]]}
                        accessible
                        accessibilityLabel={h.avgOver == null ? `Hole ${h.hole}, not enough rounds` : `Hole ${h.hole}, ${fmtOver(h.avgOver)} on average over ${h.plays} rounds`}
                      >
                        <Text style={[styles.heatNo, lvl >= 3 && styles.heatTextDark]}>{h.hole}</Text>
                        <Text style={[styles.heatVal, lvl >= 3 && styles.heatTextDark]}>{h.avgOver == null ? "–" : fmtOver(h.avgOver)}</Text>
                      </View>
                    );
                  })}
                </View>
                <View style={styles.legend}>
                  {([1, 2, 3, 4] as const).map((l, i) => (
                    <View key={l} style={styles.legendItem}>
                      <View style={[styles.legendSwatch, HEAT[l]]} />
                      <Text style={styles.legendText}>{["under +0.5", "+0.5–1", "+1–1.5", "+1.5 or more"][i]}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.note}>
                  {p.course.read === "good" ? "Good read" : "Early read"} · {p.course.rounds} rounds here. A hole needs two rounds to show.
                </Text>
              </>
            ) : (
              <Text style={styles.waitText}>{notYetLabel(p.course)}</Text>
            )}
          </Section>
        ) : null}

        <Text style={styles.footnote}>
          Gross scores against the card&apos;s par. Holes without a score, and team cards (foursomes, greensomes, scramble), aren&apos;t counted.
        </Text>
      </ScrollView>
    </View>
  );
}

function InsightRow({ insight, first }: { insight: Insight; first: boolean }) {
  return (
    <View style={[styles.insight, !first && styles.insightRule]}>
      <Text style={first ? styles.insightLead : styles.insightText}>{insight.text}</Text>
      <Text style={styles.insightBasis}>
        {insight.read === "good" ? "Good read" : "Early read"} · {insight.basis}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Tile({ label, figure, unit }: { label: string; figure: Figure<number>; unit: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={isMeasured(figure) ? `${label}: ${fmtOver(figure.value)} a hole` : `${label}: not enough yet`}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{isMeasured(figure) ? fmtOver(figure.value) : "–"}</Text>
      <Text style={styles.tileRead} numberOfLines={2}>
        {isMeasured(figure) ? readLabel(figure, unit) : notYetLabel(figure)}
      </Text>
    </View>
  );
}

function Row<T>({ label, figure, show, sub, unit }: { label: string; figure: Figure<T>; show: (v: T) => string; sub?: string; unit: string }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowRead}>{isMeasured(figure) ? [sub, readLabel(figure, unit)].filter(Boolean).join(" · ") : notYetLabel(figure)}</Text>
      </View>
      <Text style={[styles.rowValue, !isMeasured(figure) && styles.rowValueWait]}>{isMeasured(figure) ? show(figure.value) : "–"}</Text>
    </View>
  );
}

// Light to dark: the darker, the more a hole costs. Text turns light on the two dark shades.
const HEAT = [
  { backgroundColor: colors.cream100 },
  { backgroundColor: "#f6e3d3" },
  { backgroundColor: "#eebc94" },
  { backgroundColor: "#c96a2e" },
  { backgroundColor: "#8a3a10" },
] as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream50 },
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  intro: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  pressed: { opacity: 0.88 },

  hero: { gap: spacing.sm, padding: spacing.md + 2, borderRadius: radii.lg + 4, backgroundColor: colors.navy900 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, color: colors.gold400 },
  heroTitle: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.cream50 },
  heroBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: creamAlpha(0.85) },
  upgrade: { marginTop: spacing.sm, minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  upgradeText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },

  insight: { gap: 4, paddingVertical: spacing.sm },
  insightRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: creamAlpha(0.25) },
  insightLead: { fontFamily: fonts.display, fontSize: 21, lineHeight: 27, color: colors.cream50 },
  insightText: { fontFamily: fonts.bodySemi, fontSize: 15.5, lineHeight: 22, color: colors.cream50 },
  insightBasis: { fontFamily: fonts.body, fontSize: 12.5, color: creamAlpha(0.7) },

  section: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: type.heading, color: colors.ink900 },
  note: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  footnote: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.ink500, paddingHorizontal: spacing.xs },
  waitText: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },

  tiles: { flexDirection: "row", gap: spacing.sm },
  tile: { flex: 1, gap: 2, padding: spacing.sm + 2, borderRadius: radii.md, backgroundColor: colors.surfaceTint },
  tileLabel: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink500 },
  tileValue: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.ink900 },
  tileRead: { fontFamily: fonts.body, fontSize: 11.5, lineHeight: 15, color: colors.ink500 },

  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rowLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink900 },
  rowRead: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  rowValue: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  rowValueWait: { color: colors.ink500 },

  heat: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  heatCell: { width: "15%", flexGrow: 1, minHeight: 50, borderRadius: radii.sm, alignItems: "center", justifyContent: "center" },
  heatNo: { fontFamily: fonts.body, fontSize: 11, color: colors.ink900, opacity: 0.8 },
  heatVal: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  heatTextDark: { color: colors.surface },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendSwatch: { width: 14, height: 10, borderRadius: 3 },
  legendText: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
});
