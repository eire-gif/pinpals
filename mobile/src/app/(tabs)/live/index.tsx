import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GuideLink } from "@/components/guide-bits";
import { LiveRoundHero, LockedStartSheet, OneRoundNotice, type HeroRound } from "@/components/live-round-hero";
import { RaisedCard } from "@/components/live-scoring-card";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { deleteMatchDay, loadMyMatchDays, type MatchDaySummary } from "@/lib/live-match-days";
import { heroSummary } from "@/lib/live-hero";
import { deleteLiveRound, loadLiveRound, loadMyLiveRounds, type LiveRoundData, type LiveRoundSummary } from "@/lib/live-rounds";
import { useMyRound } from "@/lib/my-round";
import { loadFollowing, type FollowingItem } from "@/lib/live-follow";
import { formatInfo } from "@/lib/live-scoring";
import { dateLabel } from "@/lib/tee-times";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Live scoring hub: start a round, or go back to one in play.
 *
 * Rounds in play come first and look different — a round you're halfway
 * through is the only thing on this screen anyone is in a hurry to reach.
 *
 * Oct 2026: the round you're PLAYING in now (the MY ROUND pill's) is pinned
 * above "Start a Round" as its own card, and the three ways to start a game
 * are locked until it's finished or deleted — one live round at a time.
 */
export default function LiveScoringHub() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [rounds, setRounds] = useState<LiveRoundSummary[] | null>(null);
  const [days, setDays] = useState<MatchDaySummary[] | null>(null);
  const [following, setFollowing] = useState<FollowingItem[]>([]);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // The round in play, pinned to the top (live-round-hero.tsx).
  const myRound = useMyRound();
  const myRoundId = myRound?.id ?? null;
  const [hero, setHero] = useState<LiveRoundData | null>(null);
  const [lockSheet, setLockSheet] = useState(false);
  // Cream clock and battery over the navy bar, as on the Marketplace.
  const focused = useIsFocused();

  const load = useCallback(async () => {
    if (!userId || !isOn("liveScoring")) return;
    try {
      setFailed(false);
      const [r, d, h] = await Promise.all([
        loadMyLiveRounds(userId),
        loadMyMatchDays(),
        myRoundId != null ? loadLiveRound(myRoundId).catch(() => null) : Promise.resolve(null),
      ]);
      setRounds(r);
      setDays(d);
      setHero(h && h.round.status === "live" ? h : null);
      // Follow my round (0158): cards PinPals have shared with you. Never
      // holds up the rest of the screen.
      if (isOn("liveFollow")) loadFollowing().then(setFollowing).catch(() => setFollowing([]));
    } catch {
      setFailed(true);
    }
  }, [userId, myRoundId]);

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
            if (kind === "round") setHero((h) => (h?.round.id === id ? null : h));
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

  // The pinned round isn't listed again under "In play".
  const live = (rounds ?? []).filter((r) => r.status === "live" && r.id !== hero?.round.id);
  const locked = hero != null;
  const start = (path: "/live/new" | "/live/day/group" | "/live/day/new") => () => (locked ? setLockSheet(true) : router.push(path));

  const heroRound: HeroRound | null = hero
    ? {
        courseName: hero.round.courseName,
        detail: [
          formatInfo(hero.round.format).label,
          hero.round.teeName ? `${hero.round.teeName} tees` : null,
          `${hero.players.length} ${hero.players.length === 1 ? "player" : "players"}`,
        ]
          .filter(Boolean)
          .join(" · "),
      }
    : null;
  const summary = hero
    ? heroSummary(
        {
          format: hero.round.format,
          matchFormat: hero.round.matchFormat,
          scramble: hero.round.scramble != null,
          startHole: hero.round.start?.hole ?? null,
          card: hero.card,
          players: hero.players,
          scores: hero.scores,
        },
        userId
      )
    : null;
  const heroActions = hero
    ? {
        // The round opens on the first hole still to score, as from the pill.
        onContinue: () => router.push({ pathname: "/live/round/[id]", params: { id: String(hero.round.id) } }),
        // The round screen's own Finish: the holes-missing warning, then the
        // offer to have your card certified — the same as finishing there.
        onFinish: () => router.push({ pathname: "/live/round/[id]", params: { id: String(hero.round.id), finish: "1" } }),
        // Whoever started it (0105); a match in a society day is the organiser's.
        onDelete:
          userId != null && hero.round.createdBy === userId && hero.round.matchDayId == null
            ? () => confirmDelete("round", hero.round.id, hero.round.courseName, true)
            : null,
      }
    : null;
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
      {/* Oct 2026: the photo hero went — "Live Scoring" now sits in the
          navy bar above (see _layout), as the Marketplace does, so the
          three ways in start at the top of the screen. */}
      {focused ? <StatusBar style="light" /> : null}

      {/* Oct 2026 (option A): three ways in, each its own colour so they
          can be told apart at a glance — a round (navy), groups and societies
          (green), match days (claret). */}
      {hero && heroRound && heroActions ? (
        <View style={styles.starts}>
          <LiveRoundHero round={heroRound} summary={summary} {...heroActions} />
          <OneRoundNotice />
        </View>
      ) : null}

      <View style={styles.starts}>
        {locked ? (
          <View style={styles.sectionHead}>
            <View style={styles.sectionRule} />
            <Text style={styles.sectionTitle}>Start your round</Text>
            <Text style={styles.sectionCount}>Locked while you play</Text>
          </View>
        ) : null}
        <RaisedCard
          inset={false}
          marginTop={0}
          icon="flag"
          title="Start a Round"
          subtitle="Stableford, stroke play, foursomes, a match or a scramble"
          locked={locked}
          onPress={start("/live/new")}
        />
        {/* Course Preview (Oct 2026): look round a course hole by hole on
            the satellite map before playing it. Not a round, so it stays
            open while one is in play. */}
        {isOn("shotMaps") ? (
          <RaisedCard
            inset={false}
            marginTop={0}
            tone="teal"
            icon="map"
            kicker="Course preview"
            title="Preview a Course"
            subtitle="Walk every hole on the map before you tee off"
            a11y="Preview a course. Pick a course and it opens on the first hole's satellite map, with the course summary, every hole, and a button to start your round there."
            onPress={() => router.push("/live/preview")}
          />
        ) : null}
        {/* Groups (0121): draw a crew or society into tee groups or teams. */}
        {isOn("groups") ? (
          <RaisedCard
            inset={false}
            marginTop={0}
            tone="green"
            icon="people"
            kicker="Societies & outings"
            title="Groups & Societies"
            subtitle="Draw your buddies or society into groups and teams"
            a11y="Groups and societies. Pick your buddies or society, tick who's playing, and draw them into tee groups or scramble teams at random or balanced by handicap."
            locked={locked}
            onPress={start("/live/day/group")}
          />
        ) : null}
        <RaisedCard
          inset={false}
          marginTop={0}
          tone="claret"
          icon="trophy"
          kicker="Team matches"
          title="Match Day Fun"
          subtitle="Singles, fourballs and foursomes, Ryder Cup style"
          a11y="Match day fun. Several matches at once, singles, fourballs or foursomes, with a team score, Ryder Cup style."
          locked={locked}
          onPress={start("/live/day/new")}
        />
        {isOn("groups") ? <GuideLink id="live" lead="First time?" /> : null}
      </View>

      {following.length > 0 ? <FollowingList items={following} /> : null}

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

      {hero && heroRound && heroActions ? (
        <LockedStartSheet visible={lockSheet} round={heroRound} summary={summary} onClose={() => setLockSheet(false)} {...heroActions} />
      ) : null}
    </ScrollView>
  );
}

/** Cards PinPals are sharing with you right now (0158). */
function FollowingList({ items }: { items: FollowingItem[] }) {
  return (
    <Section title="Following" count={items.length}>
      {items.map((f, i) => {
        const c = f.card;
        const live = c.state === "live";
        return (
          <Pressable
            key={f.followId}
            onPress={() => router.push({ pathname: "/live/follow/[id]", params: { id: String(f.followId) } })}
            style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, live && styles.rowLive, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Following ${c.name} at ${c.course}, ${c.summary.big} ${c.summary.unit}, ${c.summary.progress}`}
          >
            <View style={[styles.dateTile, live && styles.dateTileLive, styles.followTile]}>
              <Text style={styles.followBig} numberOfLines={1} adjustsFontSizeToFit>
                {c.summary.big}
              </Text>
              <Text style={styles.dateMonth}>{c.summary.unit || c.valueHeading}</Text>
            </View>
            <View style={styles.rowBody}>
              <View style={styles.titleLine}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {c.name}
                </Text>
                {live ? (
                  <View style={styles.livePill}>
                    <View style={styles.liveDot} />
                    <Text style={styles.livePillText}>Live</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.rowPlace} numberOfLines={1}>
                {c.course}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {[c.summary.progress, c.summary.place].filter(Boolean).join(" · ")}
                {f.sharedBy && f.sharedBy !== c.firstName ? ` · shared by ${f.sharedBy}` : ""}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
          </Pressable>
        );
      })}
    </Section>
  );
}

function DayList({ days, me, onDelete }: { days: MatchDaySummary[]; me: string | null; onDelete: (d: MatchDaySummary) => void }) {
  return (
    <Section title="Society days, matches & scrambles" count={days.length}>
      {days.map((d, i) => (
        <GameRow
          key={d.id}
          first={i === 0}
          date={d.playedOn}
          live={d.live}
          title={d.title}
          place={d.courseName}
          tag={d.foursomes ? (d.greensomes ? "Greensomes" : "Foursomes") : d.kind === "scramble" ? "Scramble" : d.kind === "fourballs" ? "Society day" : "Match day"}
          tagTone={d.kind === "match" ? "navy" : "gold"}
          count={
            d.foursomes
              ? `${d.matchCount} ${d.matchCount === 1 ? "pair" : "pairs"}`
              : d.kind === "scramble"
              ? `${d.matchCount} ${d.matchCount === 1 ? "team" : "teams"}`
              : d.kind === "fourballs"
                ? `${d.matchCount} ${d.matchCount === 1 ? "group" : "groups"}`
                : `${d.matchCount} ${d.matchCount === 1 ? "match" : "matches"}`
          }
          a11y={`${d.title}, ${d.courseName}, ${d.live ? "in play" : "finished"}`}
          onPress={() => router.push({ pathname: "/live/day/[id]", params: { id: String(d.id) } })}
          onDelete={me != null && d.createdBy === me ? { label: `Delete ${d.title}`, run: () => onDelete(d) } : null}
        />
      ))}
    </Section>
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
    <Section title={title} count={rounds.length}>
      {rounds.map((r, i) => (
        <GameRow
          key={r.id}
          first={i === 0}
          date={r.playedOn}
          live={r.status === "live"}
          title={r.courseName}
          tag={formatInfo(r.format).label}
          tagTone="green"
          count={`${r.playerCount} ${r.playerCount === 1 ? "player" : "players"}`}
          a11y={`${r.courseName}, ${formatInfo(r.format).label}, ${r.status === "live" ? "in play" : "finished"}`}
          onPress={() => router.push({ pathname: "/live/round/[id]", params: { id: String(r.id) } })}
          onDelete={me != null && r.createdBy === me ? { label: `Delete the round at ${r.courseName}`, run: () => onDelete(r) } : null}
        />
      ))}
    </Section>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionRule} />
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </View>
      <View style={styles.list}>{children}</View>
    </View>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * One game (Oct 2026 restyle): a calendar tile for the day it was played —
 * navy, or green while it's in play — then the course, a coloured tag for
 * the format and the head count. Live ones also say LIVE in words, so the
 * green is never the only signal.
 */
function GameRow({
  first,
  date,
  live,
  title,
  place,
  tag,
  tagTone,
  count,
  a11y,
  onPress,
  onDelete,
}: {
  first: boolean;
  date: string;
  live: boolean;
  title: string;
  place?: string;
  tag: string;
  tagTone: "green" | "gold" | "navy";
  count: string;
  a11y: string;
  onPress: () => void;
  onDelete: { label: string; run: () => void } | null;
}) {
  const [, m, d] = date.split("-").map(Number);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.rowDivider, live && styles.rowLive, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${a11y}, ${dateLabel(date)}`}
    >
      <View style={[styles.dateTile, live && styles.dateTileLive]}>
        <Text style={styles.dateDay}>{Number.isFinite(d) ? d : "–"}</Text>
        <Text style={styles.dateMonth}>{MONTHS[(m ?? 1) - 1] ?? ""}</Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.titleLine}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          {live ? (
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.livePillText}>Live</Text>
            </View>
          ) : null}
        </View>
        {place ? (
          <Text style={styles.rowPlace} numberOfLines={1}>
            {place}
          </Text>
        ) : null}
        <View style={styles.metaLine}>
          <View style={[styles.tag, TAGS[tagTone].box]}>
            <Text style={[styles.tagText, TAGS[tagTone].text]}>{tag}</Text>
          </View>
          <Ionicons name="people-outline" size={13} color={colors.ink500} />
          <Text style={styles.rowMeta}>{count}</Text>
        </View>
      </View>
      {onDelete ? <DeleteButton label={onDelete.label} onPress={onDelete.run} /> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
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
  trash: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  page: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  starts: { gap: spacing.md + 2 },
  pressed: { opacity: 0.85 },
  section: { gap: spacing.sm },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionRule: { width: 18, height: 2, backgroundColor: colors.gold500 },
  sectionTitle: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: colors.navy900 },
  sectionCount: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink500 },
  list: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 12, minHeight: 76 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  rowLive: { backgroundColor: "#f3f8f2" },
  rowPressed: { backgroundColor: colors.surfaceTint },
  dateTile: {
    width: 48,
    height: 52,
    borderRadius: radii.md,
    backgroundColor: colors.navy900,
    alignItems: "center",
    justifyContent: "center",
  },
  dateTileLive: { backgroundColor: colors.green700 },
  dateDay: { fontFamily: fonts.bodyBold, fontSize: 20, lineHeight: 23, color: colors.cream50 },
  dateMonth: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: colors.gold400 },
  rowBody: { flex: 1, gap: 3 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  rowPlace: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  metaLine: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  tag: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2, marginRight: 4 },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.3 },
  rowMeta: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink500 },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.green600,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.cream50 },
  followTile: { width: 56, paddingHorizontal: 4 },
  followBig: { fontFamily: fonts.bodyBold, fontSize: 18, lineHeight: 22, color: colors.gold400 },
  livePillText: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", color: colors.cream50 },
});

const TAGS = {
  green: StyleSheet.create({ box: { backgroundColor: colors.green100 }, text: { color: colors.green800 } }),
  gold: StyleSheet.create({ box: { backgroundColor: "#f7ecd0" }, text: { color: "#6b4f12" } }),
  navy: StyleSheet.create({ box: { backgroundColor: "#e3e8f0" }, text: { color: colors.navy900 } }),
};
