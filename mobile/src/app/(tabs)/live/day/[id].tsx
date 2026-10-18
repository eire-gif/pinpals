import { useCallback, useEffect, useRef, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { DayBoard } from "@/components/day-board";
import { ResultsEntry } from "@/components/results-entry";
import { ScrambleBoard } from "@/components/scramble-board";
import { LoadError, StateMessage } from "@/components/state-message";
import { TwoPane } from "@/components/two-pane";
import { FULL_WIDTH_CONTENT, pageColumn, useWideLayout } from "@/lib/content-width";
import { useAuth } from "@/lib/auth";
import { addToCalendar, offerCalendar } from "@/lib/calendar";
import { todayIso } from "@/lib/tee-times";
import { isOn } from "@/lib/features";
import {
  SIDE_COLORS,
  SIDE_TEXT,
  deleteMatchDay,
  isDayOrganiser,
  loadMatchDay,
  setDayLeaderboardHidden,
  subscribeToMatchDay,
  type Match,
  type MatchDayData,
} from "@/lib/live-match-days";
import { formatInfo, pointsLabel } from "@/lib/live-scoring";
import { dateLabel } from "@/lib/tee-times";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { colors, creamAlpha, fonts, radii, spacing, type } from "@/lib/theme";
import { refreshWidget } from "@/lib/widgets";

/**
 * The match-day board: the team score, then every match with where it
 * stands and how far round it is. Groups go out at different times, so each
 * match shows its own "thru". Updates as any group scores (live-day-<id>).
 *
 * Tapping a match opens its scorecard: your own to score, anyone else's to
 * watch.
 *
 * A SECRET LEADERBOARD (0174): players see their own tee group's card and a
 * note that the results come at the prize-giving; the organiser (and the
 * event's officers) see the whole board, with a button to show it to
 * everyone. The database decides who can read which card.
 */
export default function MatchDayBoard() {
  // created=1: just set up (day/new.tsx) — offer the calendar once.
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const dayId = Number(id);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [data, setData] = useState<MatchDayData | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** I run this day (0174): started it, or an officer of its society event. */
  const [runs, setRuns] = useState(false);
  const [revealing, setRevealing] = useState(false);
  // iPad on its side: the leaderboard on the left, the day beside it (claude/ipad.md).
  const wide = useWideLayout();

  const load = useCallback(async () => {
    try {
      setFailed(false);
      const [d, organiser] = await Promise.all([loadMatchDay(dayId), isDayOrganiser(dayId)]);
      setData(d);
      setRuns(organiser);
      refreshWidget();
    } catch {
      setFailed(true);
    }
  }, [dayId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );
  useEffect(() => subscribeToMatchDay(dayId, () => void load()), [dayId, load]);
  useLiveRefresh(load, !!data && data.matches.some((m) => m.round.status === "live"));
  const offered = useRef(false);
  useEffect(() => {
    if (created && data && !offered.current) {
      offered.current = true;
      offerCalendar("match_day", data.day.id, "Match day set up", "Add your match to your calendar?");
    }
  }, [created, data]);
  const [calBusy, setCalBusy] = useState(false);

  if (!isOn("liveScoring")) return <StateMessage size="screen" icon="podium-outline" title="Live scoring is on its way" />;
  if (failed) return <LoadError size="screen" what="this match day" onRetry={() => void load()} />;
  if (data === undefined) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;
  if (data === null) return <StateMessage size="screen" icon="lock-closed-outline" title="This match day isn't available" body="It may have been removed, or you're not in it." />;

  const { day, matches, totals } = data;
  const scramble = day.kind === "scramble";
  // A society day (0121): tee groups, one individual leaderboard.
  const fourballs = day.kind === "fourballs";
  // A day of foursomes pairs (0136) is a scramble day underneath.
  const pairs = scramble && day.foursomes != null;
  const what = pairs ? (day.greensomes ? "greensomes day" : "foursomes day") : scramble ? "scramble" : fourballs ? "society day" : "match day";
  const allDone = matches.length > 0 && totals.finishedCount === matches.length;
  const anyLive = matches.some((m) => m.round.status === "live" && !m.state?.finished);
  const sideName = (m: Match, n: 1 | 2) =>
    day.teamNames?.[n - 1] ?? m.players.filter((p) => p.side === n).map((p) => p.name.split(" ")[0]).join(" & ");
  const mine = (m: Match) => m.players.some((p) => p.memberId != null && p.memberId === me);
  // Your own match first, then in match order.
  const isOrganiser = me != null && day.createdBy === me;
  // A secret leaderboard (0174): players see their own group only.
  const secretForMe = day.leaderboardHidden && !runs && !isOrganiser;
  const toggleSecret = (hidden: boolean) =>
    Alert.alert(
      hidden ? "Keep the leaderboard secret?" : "Show the leaderboard to everyone?",
      hidden
        ? "Players will see only their own group's card until you show it or publish the results. The TV stays live."
        : "Everyone in the day will see the full leaderboard straight away.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: hidden ? "Keep it secret" : "Show it",
          onPress: async () => {
            setRevealing(true);
            try {
              await setDayLeaderboardHidden(day.id, hidden);
              await load();
            } catch (e) {
              Alert.alert("Couldn't change it", e instanceof Error ? e.message : "Please try again.");
            } finally {
              setRevealing(false);
            }
          },
        },
      ]
    );
  const remove = () =>
    Alert.alert(
      `Delete this ${what}?`,
      scramble
        ? `${matches.length === 1 ? (pairs ? "Its pair" : "Its team") : `All ${matches.length} ${pairs ? "pairs" : "teams"}`} and every score go for everyone in it. This can't be undone.`
        : fourballs
          ? `${matches.length === 1 ? "Its group" : `All ${matches.length} groups`} and every score go for everyone in it. This can't be undone.`
        : `${matches.length === 1 ? "Its match" : `All ${matches.length} matches`} and every score go for everyone in it. This can't be undone.`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMatchDay(day.id);
              router.replace("/live");
            } catch (e) {
              Alert.alert("Couldn't delete it", e instanceof Error ? e.message : "Please try again.");
            }
          },
        },
      ]
    );
  const ordered = [...matches].sort((a, b) => Number(mine(b)) - Number(mine(a)) || (a.round.matchNumber ?? 0) - (b.round.matchNumber ?? 0));

  return (
    <ScrollView
      contentContainerStyle={[styles.page, pageColumn(wide)]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.green700}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Stack.Screen options={{ title: day.title, contentStyle: FULL_WIDTH_CONTENT }} />

      <TwoPane
        wide={wide}
        stackRightFirst
        inner={spacing.md}
        right={
      <>
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <Text style={styles.heroMeta}>
            {day.courseName} · {dateLabel(day.playedOn)}
          </Text>
          {anyLive ? (
            <View style={styles.liveTag}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live</Text>
            </View>
          ) : allDone ? (
            <Text style={styles.heroMeta}>Final</Text>
          ) : null}
        </View>
        <Text style={styles.heroTitle}>{day.title}</Text>
        {fourballs ? (
          <Text style={styles.heroSub}>
            {matches.length} {matches.length === 1 ? "group" : "groups"} · {matches[0]?.round.format === "stroke" ? "Stroke play" : "Stableford"} · {matches.reduce((n, m) => n + m.players.length, 0)} players
          </Text>
        ) : null}

        {day.teamNames ? (
          <>
            {/* The big numbers are where the day stands now: finished matches
                for what they won, live ones as they stand. Waiting for a
                match to finish before anything moves read as broken. */}
            <View
              style={styles.teams}
              accessibilityLabel={`${allDone ? "Final" : "As it stands"}: ${day.teamNames[0]} ${pointsLabel(totals.projected[0])}, ${day.teamNames[1]} ${pointsLabel(totals.projected[1])}`}
            >
              {([0, 1] as const).map((n) => (
                <View key={n} style={[styles.team, { backgroundColor: SIDE_COLORS[n] }, n === 1 && { alignItems: "flex-end" }]}>
                  <Text style={[styles.teamName, { color: SIDE_TEXT[n] }]}>{day.teamNames![n]}</Text>
                  <Text style={[styles.teamPoints, { color: SIDE_TEXT[n] }]}>{pointsLabel(totals.projected[n])}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.heroSub}>
              {allDone
                ? `Final score, ${matches.length} ${matches.length === 1 ? "match" : "matches"}.`
                : `As it stands · ${totals.finishedCount} of ${matches.length} ${matches.length === 1 ? "match" : "matches"} finished` +
                  (totals.finishedCount > 0 ? ` (${pointsLabel(totals.final[0])}–${pointsLabel(totals.final[1])} banked)` : "")}
            </Text>
          </>
        ) : null}
      </View>

      {(isOrganiser || matches.some(mine)) && day.playedOn >= todayIso() ? (
        <Pressable
          onPress={async () => {
            setCalBusy(true);
            await addToCalendar("match_day", day.id);
            setCalBusy(false);
          }}
          disabled={calBusy}
          style={({ pressed }) => [styles.calendar, pressed && { opacity: 0.85 }, calBusy && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          <Ionicons name="calendar-outline" size={18} color={colors.green700} />
          <Text style={styles.calendarLabel}>
            {matches.some(mine) ? (scramble || fourballs ? "Add my tee time to my calendar" : "Add my match to my calendar") : `Add the ${what} to my calendar`}
          </Text>
        </Pressable>
      ) : null}

      {isOn("clubhouseTv") && !secretForMe ? (
        <Pressable
          onPress={() => router.push({ pathname: "/live/tv", params: { day: String(day.id) } })}
          style={({ pressed }) => [styles.calendar, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityHint="Puts this leaderboard on a clubhouse TV"
        >
          <Ionicons name="tv-outline" size={18} color={colors.green700} />
          <Text style={styles.calendarLabel}>Show on TV</Text>
        </Pressable>
      ) : null}

      {day.leaderboardHidden && !secretForMe ? (
        <View style={styles.secret}>
          <Ionicons name="eye-off-outline" size={20} color={colors.navy900} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.secretTitle}>Leaderboard secret</Text>
            <Text style={styles.secretBody}>Only you and the committee can see who&apos;s winning. Players see their own group. The TV is still live.</Text>
            <Pressable onPress={() => toggleSecret(false)} disabled={revealing} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.secretLink}>{revealing ? "…" : "Show it to everyone"}</Text>
            </Pressable>
          </View>
        </View>
      ) : !day.leaderboardHidden && (runs || isOrganiser) && (scramble || fourballs) && !allDone ? (
        <Pressable onPress={() => toggleSecret(true)} disabled={revealing} style={({ pressed }) => [styles.calendar, pressed && { opacity: 0.85 }]} accessibilityRole="button">
          <Ionicons name="eye-off-outline" size={18} color={colors.green700} />
          <Text style={styles.calendarLabel}>Keep the leaderboard secret</Text>
        </Pressable>
      ) : null}

      <ResultsEntry data={data} me={me} />
      </>
        }
        left={
      <>

      {secretForMe ? (
        <View style={styles.secret}>
          <Ionicons name="trophy-outline" size={20} color={colors.navy900} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.secretTitle}>The leaderboard is a secret</Text>
            <Text style={styles.secretBody}>The organiser is keeping who&apos;s winning under wraps until the prize-giving. You&apos;ll see the full results once they&apos;re announced.</Text>
          </View>
        </View>
      ) : null}
      {secretForMe
        ? matches.map((m) => (
            <Pressable
              key={m.round.id}
              onPress={() => router.push({ pathname: "/live/round/[id]", params: { id: String(m.round.id) } })}
              style={({ pressed }) => [styles.match, mine(m) && styles.matchMine, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
            >
              <Text style={styles.matchMeta}>{mine(m) ? (pairs ? "Your pair's card" : scramble ? "Your team's card" : "Your group's card") : pairs ? "Your playing partners' card" : "Card"}</Text>
              <Text style={styles.names}>{m.round.scramble?.teamName ?? m.players.map((p) => p.name.split(" ")[0]).join(" · ")}</Text>
            </Pressable>
          ))
        : null}
      {scramble && !secretForMe ? <ScrambleBoard matches={matches} isMine={mine} /> : null}
      {fourballs && !secretForMe ? <DayBoard matches={matches} me={me} /> : null}

      {(scramble || fourballs ? [] : ordered).map((m) => {
        const st = m.state;
        const done = m.round.status === "finished" || !!st?.finished;
        const status = !st ? "No card yet" : st.leader === 0 ? st.margin : `${sideName(m, st.leader)} ${st.margin}`;
        const sub = !st
          ? "Stroke indexes needed"
          : done
            ? st.leader === 0
              ? "½ each"
              : "1 point"
            : st.holes.length === 0
              ? m.round.teeTime
                ? `Tees off ${m.round.teeTime}`
                : "Not started"
              : st.dormie
                ? `Dormie · thru ${st.holes.length}`
                : `thru ${st.holes.length}`;
        // Scores are in on a hole whose stroke index isn't: say why it's stuck.
        const stuck =
          !done && st?.waitingForIndex != null && m.players.some((p) => m.scores.get(p.id)?.has(st.waitingForIndex!))
            ? `Hole ${st.waitingForIndex} needs its SI`
            : null;
        const pill = !st || st.leader === 0 ? { bg: colors.cream100, fg: colors.ink900 } : { bg: SIDE_COLORS[st.leader - 1], fg: SIDE_TEXT[st.leader - 1] };
        const byHole = new Map((st?.holes ?? []).map((h) => [h.hole, h.result]));
        return (
          <Pressable
            key={m.round.id}
            onPress={() => router.push({ pathname: "/live/round/[id]", params: { id: String(m.round.id) } })}
            style={({ pressed }) => [styles.match, mine(m) && styles.matchMine, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel={`Match ${m.round.matchNumber}, ${formatInfo(m.format).label}: ${sideName(m, 1)} versus ${sideName(m, 2)}. ${status}, ${sub}.`}
          >
            <View style={styles.matchTop}>
              <Text style={styles.matchMeta}>
                Match {m.round.matchNumber} · {formatInfo(m.format).label}
              </Text>
              <Text style={[styles.matchTag, mine(m) ? { color: colors.green700 } : done ? { color: colors.ink500 } : { color: colors.green600 }]}>
                {mine(m) ? "Your match" : done ? "Finished" : st && st.holes.length > 0 ? "Live" : ""}
              </Text>
            </View>
            <View style={styles.matchRow}>
              <View style={styles.sideCol}>
                <View style={[styles.bar, { backgroundColor: SIDE_COLORS[0] }]} />
                <Text style={styles.names}>{m.players.filter((p) => p.side === 1).map((p) => p.name.split(" ")[0]).join(" & ")}</Text>
              </View>
              <View style={styles.statusCol}>
                <Text style={[styles.pill, { backgroundColor: pill.bg, color: pill.fg }]}>{status}</Text>
                <Text style={styles.sub}>{sub}</Text>
                {stuck ? <Text style={[styles.sub, { color: colors.red600 }]}>{stuck}</Text> : null}
              </View>
              <View style={[styles.sideCol, { justifyContent: "flex-end" }]}>
                <Text style={[styles.names, { textAlign: "right" }]}>{m.players.filter((p) => p.side === 2).map((p) => p.name.split(" ")[0]).join(" & ")}</Text>
                <View style={[styles.bar, { backgroundColor: SIDE_COLORS[1] }]} />
              </View>
            </View>
            <View style={styles.strip}>
              {m.card.map((c) => {
                const r = byHole.get(c.hole);
                const bg = r === "won" ? SIDE_COLORS[0] : r === "lost" ? SIDE_COLORS[1] : r === "halved" ? colors.line : colors.cream100;
                return <View key={c.hole} style={[styles.cell, { backgroundColor: bg }]} />;
              })}
            </View>
          </Pressable>
        );
      })}

      {scramble || fourballs ? null : <Text style={styles.footNote}>Each hole is coloured by the side that won it. Tap a match to see or score it.</Text>}
      </>
        }
      />

      {isOrganiser ? (
        <Pressable onPress={remove} style={styles.delete} accessibilityRole="button">
          <Text style={styles.deleteLabel}>{`Delete ${what}`}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  hero: { backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroMeta: { fontFamily: fonts.body, fontSize: 13, color: creamAlpha(0.85) },
  heroTitle: { fontFamily: fonts.display, fontSize: 26, color: colors.cream50 },
  heroSub: { fontFamily: fonts.body, fontSize: 13, color: creamAlpha(0.85), textAlign: "center" },
  liveTag: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green600 },
  liveText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: colors.green100 },
  teams: { flexDirection: "row", gap: spacing.sm },
  team: { flex: 1, borderRadius: radii.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  teamName: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase" },
  teamPoints: { fontFamily: fonts.display, fontSize: 32 },
  match: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  matchMine: { borderWidth: 2, borderColor: colors.green700 },
  matchTop: { flexDirection: "row", justifyContent: "space-between" },
  matchMeta: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink500 },
  matchTag: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" },
  matchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sideCol: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  bar: { width: 4, height: 32, borderRadius: 2 },
  names: { flexShrink: 1, fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  statusCol: { alignItems: "center", minWidth: 96 },
  pill: { fontFamily: fonts.bodyBold, fontSize: 14, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill, overflow: "hidden" },
  sub: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, marginTop: 3 },
  strip: { flexDirection: "row", gap: 2 },
  cell: { flex: 1, height: 6, borderRadius: 3 },
  delete: { minHeight: 48, borderRadius: 999, borderWidth: 1, borderColor: colors.red600, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  deleteLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.red600 },
  calendar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.green700, backgroundColor: colors.surface },
  calendarLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  footNote: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, textAlign: "center" },
  secret: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.cream100, borderRadius: radii.lg, padding: spacing.md },
  secretTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
  secretBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900, lineHeight: 20 },
  secretLink: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700, marginTop: 4 },
});
