import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ImageBackground, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { RaisedCard } from "@/components/live-scoring-card";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { deleteMatchDay, loadMyMatchDays, type MatchDaySummary } from "@/lib/live-match-days";
import { deleteLiveRound, loadMyLiveRounds, type LiveRoundSummary } from "@/lib/live-rounds";
import { formatInfo } from "@/lib/live-scoring";
import { dateLabel } from "@/lib/tee-times";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

const HERO = require("../../../../assets/images/scenes/links-dusk.jpg");

/**
 * Live scoring hub: start a round, or go back to one in play.
 *
 * Rounds in play come first and look different — a round you're halfway
 * through is the only thing on this screen anyone is in a hurry to reach.
 */
export default function LiveScoringHub() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [rounds, setRounds] = useState<LiveRoundSummary[] | null>(null);
  const [days, setDays] = useState<MatchDaySummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !isOn("liveScoring")) return;
    try {
      setFailed(false);
      const [r, d] = await Promise.all([loadMyLiveRounds(userId), loadMyMatchDays()]);
      setRounds(r);
      setDays(d);
    } catch {
      setFailed(true);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!isOn("liveScoring")) {
    return (
      <StateMessage
        size="screen"
        icon="podium-outline"
        title="Live scoring is on its way"
        body="Score your round with your group and watch the leaderboard move hole by hole."
      />
    );
  }

  /** Owner only (0105 checks too). Gone from the list at once; back if it fails. */
  const confirmDelete = (kind: "round" | "day", id: number, name: string, inPlay: boolean) =>
    Alert.alert(
      kind === "day" ? "Delete this match day?" : "Delete this round?",
      `${name}: the card and every score go for everyone in it${inPlay ? ", even though it's still in play" : ""}. This can't be undone.`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (kind === "day") setDays((d) => (d ?? []).filter((x) => x.id !== id));
            else setRounds((r) => (r ?? []).filter((x) => x.id !== id));
            try {
              if (kind === "day") await deleteMatchDay(id);
              else await deleteLiveRound(id);
            } catch (e) {
              Alert.alert("Couldn't delete it", e instanceof Error ? e.message : "Please try again.");
              void load();
            }
          },
        },
      ]
    );

  const live = (rounds ?? []).filter((r) => r.status === "live");
  const finished = (rounds ?? []).filter((r) => r.status === "finished");

  return (
    <ScrollView
      contentContainerStyle={styles.page}
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
      {/* Oct 2026 (option A): a course photograph behind a short title,
          the same look as Tee Times and Courses. */}
      <ImageBackground source={HERO} style={styles.hero} imageStyle={styles.heroImage}>
        <View style={styles.scrim} />
        <View style={styles.eyebrowRow}>
          <View style={styles.rule} />
          <Text style={styles.eyebrow}>Live scoring</Text>
        </View>
        <Text style={styles.heroTitle} accessibilityRole="header">
          Score it together.
        </Text>
        <Text style={styles.heroBody}>Handicaps in once — shots worked out, leaderboard live.</Text>
      </ImageBackground>

      {/* Oct 2026: the two ways in, as raised cards like Home's Live
          Scoring, so starting a game is the obvious thing on this screen. */}
      <View style={styles.starts}>
        <RaisedCard
          inset={false}
          marginTop={0}
          icon="flag"
          title="Start a Game"
          subtitle="Stableford, stroke play or a match — your group, live"
          onPress={() => router.push("/live/new")}
        />
        <RaisedCard
          inset={false}
          marginTop={0}
          icon="people"
          title="Match Day"
          subtitle="Several matches at once, with a team score"
          a11y="Start a match day. Several matches at once: singles, fourball, foursomes or greensomes, with a team score."
          onPress={() => router.push("/live/day/new")}
        />
      </View>

      {failed ? (
        <LoadError what="your rounds" onRetry={() => void load()} />
      ) : rounds == null ? (
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.lg }} />
      ) : rounds.length === 0 && (days ?? []).length === 0 ? (
        <StateMessage
          icon="golf-outline"
          body="Rounds you score, or are added to by your PinPals, will show here."
        />
      ) : (
        <>
          {(days ?? []).length > 0 ? (
            <DayList days={days!} me={userId} onDelete={(d) => confirmDelete("day", d.id, d.title, d.live)} />
          ) : null}
          {live.length > 0 ? (
            <RoundList title="In play" rounds={live} me={userId} onDelete={(r) => confirmDelete("round", r.id, r.courseName, true)} />
          ) : null}
          {finished.length > 0 ? (
            <RoundList title="Finished" rounds={finished} me={userId} onDelete={(r) => confirmDelete("round", r.id, r.courseName, false)} />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function DayList({ days, me, onDelete }: { days: MatchDaySummary[]; me: string | null; onDelete: (d: MatchDaySummary) => void }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Match days</Text>
      <View style={styles.list}>
        {days.map((d, i) => (
          <Pressable
            key={d.id}
            onPress={() => router.push({ pathname: "/live/day/[id]", params: { id: String(d.id) } })}
            style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`${d.title}, ${d.courseName}, ${d.live ? "in play" : "finished"}`}
          >
            <View style={[styles.dot, d.live ? styles.dotLive : styles.dotDone]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {d.title}
              </Text>
              <Text style={styles.rowMeta}>
                {d.courseName} · {dateLabel(d.playedOn)} · {d.matchCount} {d.matchCount === 1 ? "match" : "matches"}
              </Text>
            </View>
            {me != null && d.createdBy === me ? <DeleteButton label={`Delete ${d.title}`} onPress={() => onDelete(d)} /> : null}
            <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function RoundList({
  title,
  rounds,
  me,
  onDelete,
}: {
  title: string;
  rounds: LiveRoundSummary[];
  me: string | null;
  onDelete: (r: LiveRoundSummary) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.list}>
        {rounds.map((r, i) => (
          <Pressable
            key={r.id}
            onPress={() => router.push({ pathname: "/live/round/[id]", params: { id: String(r.id) } })}
            style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`${r.courseName}, ${formatInfo(r.format).label}, ${r.status === "live" ? "in play" : "finished"}`}
          >
            <View style={[styles.dot, r.status === "live" ? styles.dotLive : styles.dotDone]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {r.courseName}
              </Text>
              <Text style={styles.rowMeta}>
                {formatInfo(r.format).label} · {dateLabel(r.playedOn)} · {r.playerCount}{" "}
                {r.playerCount === 1 ? "player" : "players"}
              </Text>
            </View>
            {me != null && r.createdBy === me ? <DeleteButton label={`Delete the round at ${r.courseName}`} onPress={() => onDelete(r)} /> : null}
            <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Its own press target inside the row, so deleting never opens the round. */
function DeleteButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.trash} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name="trash-outline" size={18} color={colors.ink500} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trash: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  page: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  hero: {
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    marginBottom: -spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: 6,
    backgroundColor: colors.navy900,
  },
  heroImage: { resizeMode: "cover" },
  // Navy over the photo so cream text reads on a bright sky.
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(12,32,56,0.5)" },
  starts: { gap: spacing.md + 2 },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rule: { width: 18, height: 2, backgroundColor: colors.gold400 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.6, textTransform: "uppercase", color: colors.gold400 },
  heroTitle: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: colors.cream50 },
  heroBody: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.cream100 },
  pressed: { opacity: 0.85 },
  section: { gap: spacing.sm },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: colors.ink500 },
  list: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, minHeight: 64 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  rowPressed: { backgroundColor: colors.surfaceTint },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotLive: { backgroundColor: colors.green600 },
  dotDone: { backgroundColor: colors.line },
  rowTitle: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  rowMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 2 },
});
