import { useCallback, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Stack, router, useFocusEffect, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { useMembership } from "@/lib/membership";
import { listScorecards } from "@/lib/scorecards";
import { statInsights, statsSummary, type GreenMiss, type StatsSummary } from "@/lib/hole-stats";
import { loadAllMyStats, loadGoal, saveGoal, statsForCard, useTracking } from "@/lib/my-stats";
import { BENCHMARK_SOURCE } from "@/lib/benchmarks";
import { areaTrend, defaultGoal, practiceFocus, shotsBreakdown, type AreaTrend, type Breakdown, type Focus } from "@/lib/shots-breakdown";
import type { StatsCard } from "@/lib/hole-stats";
import { supabase } from "@/lib/supabase";
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
 * Stage 2 (0178): members who turn on Track my stats tap their tee shot,
 * putts, missed-green direction and penalties; Your stats below adds them up
 * (lib/hole-stats.ts). Private to the member.
 *
 * Stage 3: against a goal handicap the member picks, Where your shots go
 * estimates the shots a round in approach, short game, putting and
 * penalties (lib/shots-breakdown.ts) from Shot Scope's published averages
 * (lib/benchmarks.ts), names the biggest leak and one thing to practise.
 *
 * Part of the "stats" feature (Stats & insights): free while paid plans are
 * off, Premium when they're on.
 */
export default function MyGameScreen() {
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const { gate } = useMembership();
  const [patterns, setPatterns] = useState<ScoringPatterns | null>(null);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [lastCard, setLastCard] = useState<number | null>(null);
  const [statsCards, setStatsCards] = useState<StatsCard[]>([]);
  const [goal, setGoal] = useState<number | null>(null);
  const [tracking, setTracking] = useTracking();
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      setFailed(false);
      const [cards, mine, savedGoal, own] = await Promise.all([
        listScorecards(me, 50),
        loadAllMyStats().catch(() => null),
        loadGoal(),
        supabase.from("member_private").select("handicap").eq("member_id", me).maybeSingle<{ handicap: number | string | null }>(),
      ]);
      setPatterns(scoringPatterns(cards));
      const withStats: StatsCard[] = mine ? cards.map((c) => ({ ...c, stats: statsForCard(c, mine) })) : [];
      setStatsCards(withStats);
      setStats(mine ? statsSummary(withStats) : null);
      setGoal((g) => g ?? savedGoal ?? defaultGoal(own.data?.handicap != null ? Number(own.data.handicap) : null));
      setLastCard(cards.find((c) => c.teamCard == null && c.holeList.some((h) => h.strokes != null))?.id ?? null);
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
  const breakdown: Breakdown | null = stats && goal != null && stats.holes > 0 ? shotsBreakdown(stats, goal) : null;
  const focus: Focus | null = breakdown && stats ? practiceFocus(breakdown, stats) : null;
  const trend: AreaTrend[] = goal != null && statsCards.length ? areaTrend(statsCards, goal) : [];
  const changeGoal = (g: number) => {
    const next = Math.max(0, Math.min(36, g));
    setGoal(next);
    void saveGoal(next);
  };
  if (p.rounds === 0) {
    return (
      <View style={styles.screen}>
        {header}
        <ScrollView contentContainerStyle={styles.list}>
          <StateMessage
            icon="stats-chart-outline"
            title="Your game, from your scores"
            body="Save a few scorecards — from a live round, or by hand — and My Game shows where your shots go."
          />
          <YourStats stats={stats} tracking={tracking} onTrack={setTracking} onReview={null} />
        </ScrollView>
      </View>
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

        {breakdown?.leak ? (
          <View style={styles.hero}>
            <View style={styles.leakHead}>
              <Text style={styles.kicker}>YOUR BIGGEST LEAK</Text>
              <Text style={styles.readChip}>{breakdown.leak.read === "good" ? "Good read" : "Early read"}</Text>
            </View>
            <Text style={styles.insightLead}>
              {breakdown.leak.label} is costing you about {breakdown.leak.shots} {breakdown.leak.shots === 1 ? "shot" : "shots"} a round
            </Text>
            <Text style={styles.heroBody}>Compared with {breakdown.goalLabel} — an estimate from your stats. {breakdown.leak.detail}.</Text>
            {focus ? <Text style={styles.leakTip}>Practise: {focus.title.toLowerCase()}.</Text> : null}
          </View>
        ) : null}

        <View style={styles.hero}>
          <Text style={styles.kicker}>{breakdown?.leak ? "PATTERNS IN YOUR SCORES" : "WHAT'S COSTING YOU MOST"}</Text>
          {p.insights.length > 0 ? (
            p.insights.map((i, n) => <InsightRow key={n} insight={i} first={n === 0} />)
          ) : (
            <Text style={styles.heroBody}>
              Nothing stands out yet. Keep saving your cards — each one sharpens the picture.
            </Text>
          )}
        </View>

        {breakdown && goal != null && breakdown.areas.length > 0 ? (
          <ShotsCard breakdown={breakdown} goal={goal} onGoal={changeGoal} trend={trend} />
        ) : null}

        {focus ? <FocusCard focus={focus} /> : null}

        <YourStats
          stats={stats}
          tracking={tracking}
          onTrack={setTracking}
          onReview={lastCard != null ? () => router.push({ pathname: "/scorecards/review/[id]", params: { id: String(lastCard) } }) : null}
        />

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

function ShotsCard({ breakdown: b, goal, onGoal, trend }: { breakdown: Breakdown; goal: number; onGoal: (g: number) => void; trend: AreaTrend[] }) {
  const max = Math.max(1, ...b.areas.map((a) => Math.abs(a.shots)));
  return (
    <Section title="Where your shots go">
      <View style={styles.goalRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Your goal handicap</Text>
          <Text style={styles.rowRead}>You&apos;re compared with golfers playing off this.</Text>
        </View>
        <Pressable onPress={() => onGoal(goal - 1)} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Lower goal">
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <Text style={styles.goalValue}>{goal}</Text>
        <Pressable onPress={() => onGoal(goal + 1)} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Higher goal">
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>

      <Text style={styles.note}>Shots a round against {b.goalLabel} · estimated</Text>
      {b.areas.map((a) => {
        const width = `${Math.round((Math.abs(a.shots) / max) * 48)}%` as const;
        const lost = a.shots > 0;
        return (
          <View key={a.area} style={styles.barRow} accessible accessibilityLabel={`${a.label}: ${lost ? `${a.shots} shots lost` : `${Math.abs(a.shots)} shots gained`} a round. ${a.detail}`}>
            <View style={styles.barHead}>
              <Text style={[styles.rowLabel, b.leak?.area === a.area && { fontFamily: fonts.bodyBold }]}>{a.label}</Text>
              <Text style={[styles.barValue, lost ? styles.lost : styles.gained]}>
                {a.shots === 0 ? "level" : lost ? `−${a.shots}` : `+${Math.abs(a.shots)}`}
              </Text>
            </View>
            <View style={styles.barTrack}>
              <View style={styles.barMid} />
              {a.shots !== 0 ? <View style={[styles.bar, lost ? [styles.barLost, { right: "50%", width }] : [styles.barGained, { left: "50%", width }]]} /> : null}
            </View>
            <Text style={styles.rowRead}>
              {a.detail} · {a.read === "good" ? "good read" : "early read"}
            </Text>
          </View>
        );
      })}
      <View style={styles.barLegend}>
        <Text style={styles.legendText}>← Shots lost</Text>
        <Text style={styles.legendText}>Shots gained →</Text>
      </View>
      <View style={styles.totalBox}>
        <Text style={styles.totalText}>
          {b.total > 0
            ? `Altogether about ${b.total} shots a round between you and ${b.goalLabel}.`
            : `You're already level with or ahead of ${b.goalLabel} in these areas — try a lower goal.`}
        </Text>
      </View>
      {b.tee ? (
        <Text style={styles.note}>
          Fairways: you hit {b.tee.yours}%, {b.goalLabel} {b.tee.theirs}%. Fairways barely differ by handicap, so they aren&apos;t counted in shots.
        </Text>
      ) : null}

      {trend.length > 0 ? (
        <View style={{ gap: 6, marginTop: spacing.xs }}>
          <Text style={styles.rowLabel}>Last 5 rounds against the 5 before</Text>
          {trend.map((t) => (
            <View key={t.area} style={styles.trendRow}>
              <Text style={styles.trendLabel}>{t.label}</Text>
              <Text style={[styles.trendValue, t.better > 0.2 ? styles.gained : t.better < -0.2 ? styles.lost : null]}>
                {t.better > 0.2 ? `▲ ${t.better} better` : t.better < -0.2 ? `▼ ${Math.abs(t.better)} worse` : "— about the same"}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={styles.source}>
        Compared with {BENCHMARK_SOURCE.name}&apos;s published averages by handicap{b.bench.clamped ? " (they run from scratch to 25, so the nearest is used)" : ""}. Your par saves are set against their up-and-down rate, which is close but not identical. Length and tee shots aren't counted, so the real gap is usually a little bigger.
      </Text>
    </Section>
  );
}

function FocusCard({ focus: f }: { focus: Focus }) {
  const { now, goal, unit, higherIsBetter, label } = f.target;
  const met = higherIsBetter ? now >= goal : now <= goal;
  const scale = Math.max(now, goal, 1) * 1.15;
  return (
    <View style={styles.focus}>
      <Text style={styles.focusKicker}>YOUR PRACTICE FOCUS</Text>
      <Text style={styles.focusTitle}>{f.title}</Text>
      <Text style={styles.focusDrill}>{f.drill}</Text>
      <View style={styles.focusTarget}>
        <View style={styles.barHead}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.focusNumbers}>
            {now}
            {unit} → target {goal}
            {unit}
          </Text>
        </View>
        <View style={styles.targetTrack}>
          <View style={[styles.targetFill, met && styles.targetMet, { width: `${Math.min(100, (now / scale) * 100)}%` }]} />
          <View style={[styles.targetMark, { left: `${Math.min(100, (goal / scale) * 100)}%` }]} />
        </View>
        <Text style={styles.rowRead}>{met ? "Target reached — nice work. Keep it there, or raise your goal." : "This updates with every round you keep stats for."}</Text>
      </View>
      {f.train ? (
        <Pressable onPress={() => router.push(f.train!.to as Href)} style={({ pressed }) => [styles.reviewButton, pressed && styles.pressed]} accessibilityRole="button">
          <Ionicons name="barbell-outline" size={17} color={colors.green700} />
          <Text style={styles.reviewText}>{f.train.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function YourStats({
  stats,
  tracking,
  onTrack,
  onReview,
}: {
  stats: StatsSummary | null;
  tracking: boolean | null;
  onTrack: (on: boolean) => void;
  onReview: (() => void) | null;
}) {
  if (tracking == null) return null;
  const has = stats != null && stats.holes > 0;
  const toggle = (
    <View style={styles.trackRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowLabel}>Track my stats</Text>
        <Text style={styles.rowRead}>About 4 taps a hole while you play: tee shot, putts, missed green, penalties.</Text>
      </View>
      <Switch value={tracking} onValueChange={onTrack} trackColor={{ true: colors.green600 }} accessibilityLabel="Track my stats" />
    </View>
  );

  if (!tracking && !has) {
    return (
      <Section title="Your stats">
        <Text style={styles.waitText}>
          Turn this on and a small row appears under your score as you play. PinPals works out greens in regulation and par saves for you, and shows where your misses go. Only you see your stats.
        </Text>
        {toggle}
      </Section>
    );
  }

  const tips = stats ? statInsights(stats) : [];
  const missLine = (m: Record<GreenMiss, number>) =>
    (Object.entries(m) as [GreenMiss, number][])
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)} ${v}%`)
      .join(" · ");

  return (
    <Section title="Your stats">
      {!has ? (
        <Text style={styles.waitText}>Tap your stats under your score as you play — or add them to a card afterwards — and they add up here. Only you see them.</Text>
      ) : (
        <>
          <Text style={styles.note}>
            From {stats!.holes} holes on {stats!.rounds} {stats!.rounds === 1 ? "card" : "cards"} · only you see these
          </Text>
          {tips.map((t, i) => (
            <View key={i} style={styles.tip}>
              <Text style={styles.tipText}>{t.text}</Text>
              <Text style={styles.rowRead}>
                {t.read === "good" ? "Good read" : "Early read"} · {t.basis}
              </Text>
            </View>
          ))}
          <Row label="Fairways hit" figure={stats!.tee} show={(v) => `${v.fairwayPct}%`} sub={isMeasured(stats!.tee) ? `Left ${stats!.tee.value.leftPct}% · Right ${stats!.tee.value.rightPct}%` : undefined} unit="drives" />
          <Row label="Greens in regulation" figure={stats!.greens} show={(v) => `${v.perRound} a round`} sub={isMeasured(stats!.greens) ? `${stats!.greens.value.pct}% of holes` : undefined} unit="holes" />
          <Row label="Where you miss greens" figure={stats!.misses} show={() => ""} sub={isMeasured(stats!.misses) ? missLine(stats!.misses.value) : undefined} unit="missed greens" />
          <Row label="Par saved after missing the green" figure={stats!.scrambling} show={(v) => `${v}%`} unit="chances" />
          <Row
            label="Putts a round"
            figure={stats!.putting}
            show={(v) => String(v.perRound)}
            sub={isMeasured(stats!.putting) ? `3-putts ${stats!.putting.value.threePutts} · 1-putts ${stats!.putting.value.onePutts} a round` : undefined}
            unit="holes"
          />
          <Row
            label="First putts holed, by distance"
            figure={stats!.byDistance}
            show={() => ""}
            sub={isMeasured(stats!.byDistance) ? stats!.byDistance.value.map((d) => `${d.label} ${d.holedPct}%`).join(" · ") : undefined}
            unit="putts with a distance"
          />
          <Row label="Penalty shots a round" figure={stats!.penalties} show={(v) => String(v)} unit="holes" />
        </>
      )}
      {has ? (
        <Pressable onPress={() => router.push("/train/putting")} style={({ pressed }) => [styles.reviewButton, pressed && styles.pressed]} accessibilityRole="button">
          <Ionicons name="barbell-outline" size={17} color={colors.green700} />
          <Text style={styles.reviewText}>Practise your putting in Training</Text>
        </Pressable>
      ) : null}
      {onReview && tracking ? (
        <Pressable onPress={onReview} style={({ pressed }) => [styles.reviewButton, pressed && styles.pressed]} accessibilityRole="button">
          <Ionicons name="create-outline" size={17} color={colors.green700} />
          <Text style={styles.reviewText}>Add stats to your last round</Text>
        </Pressable>
      ) : null}
      {toggle}
    </Section>
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
  leakHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  readChip: { fontFamily: fonts.bodySemi, fontSize: 11.5, color: colors.navy900, backgroundColor: colors.green100, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 2, overflow: "hidden" },
  leakTip: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.gold400 },
  goalRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  stepBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  stepText: { fontFamily: fonts.bodySemi, fontSize: 20, color: colors.ink900 },
  goalValue: { fontFamily: fonts.display, fontSize: 24, minWidth: 30, textAlign: "center", color: colors.green700 },
  barRow: { gap: 4 },
  barHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
  barValue: { fontFamily: fonts.bodyBold, fontSize: 15 },
  lost: { color: "#9a4316" },
  gained: { color: colors.navy800 },
  barTrack: { height: 16, borderRadius: 4, backgroundColor: colors.surfaceTint, position: "relative", overflow: "hidden" },
  barMid: { position: "absolute", left: "50%", top: 0, bottom: 0, width: 1.5, backgroundColor: colors.ink900 },
  bar: { position: "absolute", top: 3, bottom: 3 },
  barLost: { backgroundColor: "#b5541c", borderTopLeftRadius: 3, borderBottomLeftRadius: 3 },
  barGained: { backgroundColor: colors.navy800, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  barLegend: { flexDirection: "row", justifyContent: "space-between" },
  totalBox: { padding: spacing.sm + 2, borderRadius: radii.md, backgroundColor: colors.surfaceTint },
  totalText: { fontFamily: fonts.bodySemi, fontSize: 14.5, lineHeight: 20, color: colors.ink900 },
  trendRow: { flexDirection: "row", justifyContent: "space-between" },
  trendLabel: { fontFamily: fonts.body, fontSize: 15, color: colors.ink900 },
  trendValue: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink500 },
  source: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.ink500, marginTop: spacing.xs },
  focus: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.green100 },
  focusKicker: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.4, color: colors.green800 },
  focusTitle: { fontFamily: fonts.display, fontSize: 22, lineHeight: 27, color: colors.ink900 },
  focusDrill: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink900 },
  focusTarget: { gap: 6, padding: spacing.sm + 2, borderRadius: radii.md, backgroundColor: colors.surface },
  focusNumbers: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  targetTrack: { height: 8, borderRadius: 4, backgroundColor: colors.cream100, position: "relative" },
  targetFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4, backgroundColor: "#b5541c" },
  targetMet: { backgroundColor: colors.green600 },
  targetMark: { position: "absolute", top: -4, bottom: -4, width: 2, backgroundColor: colors.ink900 },
  trackRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  tip: { gap: 2, padding: spacing.sm + 2, borderRadius: radii.md, backgroundColor: colors.green100 },
  tipText: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 21, color: colors.ink900 },
  reviewButton: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  reviewText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.green700 },
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
