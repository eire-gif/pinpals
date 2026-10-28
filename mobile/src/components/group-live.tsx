import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ResultsCard } from "@/components/results-card";
import { useAuth } from "@/lib/auth";
import { liveDayOfGroup, loadFeedResults, setCheer, setDayCommentLike, type DayComment, type FeedResult } from "@/lib/social-live";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * The top of a group's page, Facebook-style (Oct 2026, claude/social-live.md):
 * a navy LIVE banner while one of the group's days is being played (Watch
 * opens the full-screen live view), and the latest results from the last two
 * weeks with their Great Shots and comments — the same card as on Social.
 * Nothing at all when there's neither. Members only (the caller checks).
 */
export function GroupLive({
  groupId,
  social,
  me,
}: {
  groupId: number;
  /** Under 18s (0159): the banner, but not the comments card. */
  social: boolean;
  me: { name: string; avatarUrl: string | null; avatarColor: string | null } | null;
}) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [live, setLive] = useState<Awaited<ReturnType<typeof liveDayOfGroup>>>(null);
  const [latest, setLatest] = useState<FeedResult | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      liveDayOfGroup(groupId)
        .then(setLive)
        .catch(() => setLive(null));
      if (social) {
        const since = new Date(Date.now() - 14 * 86400_000).toISOString();
        loadFeedResults(userId, since, null, { groupId, limit: 1 })
          .then((r) => setLatest(r[0] ?? null))
          .catch(() => setLatest(null));
      }
    }, [groupId, userId, social])
  );

  const cheer = (r: FeedResult) => {
    if (!userId) return;
    const on = !r.cheers.mine;
    setLatest({ ...r, cheers: { mine: on, count: Math.max(0, r.cheers.count + (on ? 1 : -1)) } });
    setCheer(r.dayId, userId, on).catch(() => setLatest(r));
  };
  const like = (r: FeedResult, c: DayComment) => {
    if (!userId) return;
    const on = !c.likedByMe;
    setLatest({ ...r, comments: r.comments.map((x) => (x.id === c.id ? { ...x, likedByMe: on, likeCount: Math.max(0, x.likeCount + (on ? 1 : -1)) } : x)) });
    setDayCommentLike(c.id, userId, on).catch(() => setLatest(r));
  };

  if (!live && !latest) return null;
  return (
    <View style={styles.wrap}>
      {live ? (
        <Pressable
          onPress={() => router.push({ pathname: "/social-live/[id]", params: { id: String(live.dayId) } })}
          style={styles.banner}
          accessibilityRole="button"
          accessibilityLabel={`Live now: ${live.title} at ${live.courseName}, ${live.playing} playing. Watch`}
        >
          <View style={styles.pill}>
            <View style={styles.dot} />
            <Text style={styles.pillText}>LIVE</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={1}>
              {live.title} · {live.courseName}
            </Text>
            <Text style={styles.detail} numberOfLines={1}>
              {live.playing} playing · leaderboard and comments
            </Text>
          </View>
          <Text style={styles.watch}>Watch</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.gold400} />
        </Pressable>
      ) : null}
      {latest ? <ResultsCard result={latest} onCheer={cheer} onLikeComment={like} me={me} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md - 4 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    backgroundColor: colors.navy900,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md - 2,
    minHeight: 60,
  },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.red600, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#ffffff" },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.6, color: "#ffffff" },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  detail: { fontFamily: fonts.body, fontSize: 12.5, color: colors.cream100 },
  watch: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold400 },
});
