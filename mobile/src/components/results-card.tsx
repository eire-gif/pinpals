import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CommentPreview } from "@/components/comment-preview";
import { GroupIcon } from "@/components/group-bits";
import { ago } from "@/lib/feed-rules";
import type { DayComment, FeedResult } from "@/lib/social-live";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * A society's published results in the feed (Oct 2026, claude/social-live.md):
 * the group, a navy podium of the top three, Great Shots and the day's
 * comments (the same thread as the live view) with a heart on each.
 */
export function ResultsCard({
  result: r,
  onCheer,
  onLikeComment,
  me,
}: {
  result: FeedResult;
  onCheer: (r: FeedResult) => void;
  onLikeComment: (r: FeedResult, c: DayComment) => void;
  me: { name: string; avatarUrl: string | null; avatarColor: string | null } | null;
}) {
  const openThread = () => router.push({ pathname: "/social-live/[id]", params: { id: String(r.dayId), focus: "comment" } });
  const openResults = () => router.push({ pathname: "/live/day/results/[id]", params: { id: String(r.dayId) } });
  const byPlace = (n: number) => r.podium.find((p) => p.position === n) ?? null;
  // 2nd, 1st, 3rd — the winner in the middle, on the tallest block.
  const steps = [
    { row: byPlace(2), height: 36, place: "2" },
    { row: byPlace(1), height: 54, place: "1" },
    { row: byPlace(3), height: 26, place: "3" },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Pressable onPress={() => router.push({ pathname: "/group/[id]", params: { id: String(r.groupId) } })} accessibilityRole="link" accessibilityLabel={`Open ${r.groupName}`}>
          <GroupIcon kind="society" size={38} logoUrl={r.logoUrl} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.group} numberOfLines={1}>
            {r.groupName}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            Results · {r.title}
            {r.courseName ? `, ${r.courseName}` : ""} · {ago(r.publishedAt)}
          </Text>
        </View>
      </View>

      <Pressable onPress={openResults} style={styles.podium} accessibilityRole="button" accessibilityLabel={`Results: ${r.podium.map((p) => `${p.place} ${p.name}, ${p.score}`).join("; ")}. Open full results`}>
        <Text style={styles.basis}>{r.basisLabel.toUpperCase()} · {r.entrants} {r.team ? "SIDES" : "PLAYERS"}</Text>
        <View style={styles.steps}>
          {steps.map((s) => (
            <View key={s.place} style={styles.step}>
              {s.place === "1" ? <Ionicons name="trophy-outline" size={18} color={colors.gold400} /> : null}
              <Text style={[styles.stepName, s.place === "1" && styles.winnerName]} numberOfLines={2}>
                {s.row?.name ?? "—"}
              </Text>
              <Text style={[styles.stepScore, s.place === "1" && { color: colors.gold400 }]} numberOfLines={1}>
                {s.row ? `${s.row.score}${s.row.back ? ` · ${s.row.back}` : ""}` : ""}
              </Text>
              <View style={[styles.block, { height: s.height }, s.place === "1" && styles.blockWin]}>
                <Text style={[styles.blockText, s.place === "1" && { color: colors.navy900 }]}>{s.place}</Text>
              </View>
            </View>
          ))}
        </View>
        {r.mine ? (
          <Text style={styles.mine}>
            You: {r.mine.position} of {r.mine.of} · {r.mine.score}
          </Text>
        ) : null}
      </Pressable>

      <View style={styles.actions}>
        <Pressable
          onPress={() => onCheer(r)}
          style={styles.action}
          accessibilityRole="button"
          accessibilityState={{ selected: r.cheers.mine }}
          accessibilityLabel={`Great Shot${r.cheers.count ? `, ${r.cheers.count}` : ""}`}
        >
          <Ionicons name={r.cheers.mine ? "flag" : "flag-outline"} size={22} color={r.cheers.mine ? colors.green700 : colors.ink900} />
          {r.cheers.count > 0 ? <Text style={[styles.actionCount, r.cheers.mine && { color: colors.green700 }]}>{r.cheers.count}</Text> : null}
        </Pressable>
        <Pressable onPress={openThread} style={styles.action} accessibilityRole="button" accessibilityLabel={`Comments${r.commentCount ? `, ${r.commentCount}` : ""}`}>
          <Ionicons name="chatbubble-outline" size={21} color={colors.ink900} />
          {r.commentCount > 0 ? <Text style={styles.actionCount}>{r.commentCount}</Text> : null}
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={openResults} style={styles.action} accessibilityRole="link">
          <Text style={styles.full}>Full results</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.green700} />
        </Pressable>
      </View>

      <CommentPreview
        comments={r.comments.map((c) => ({
          id: c.id,
          name: c.author.name,
          avatarUrl: c.author.avatarUrl,
          avatarColor: c.author.avatarColor,
          body: c.body,
          createdAt: c.createdAt,
          likeCount: c.likeCount,
          liked: c.likedByMe,
        }))}
        total={r.commentCount}
        onLike={(pc) => {
          const c = r.comments.find((x) => x.id === pc.id);
          if (c) onLikeComment(r, c);
        }}
        onOpen={openThread}
        me={me}
      />
      <View style={{ height: spacing.md }} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2, padding: spacing.md - 4 },
  group: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, marginTop: 1 },
  podium: { marginHorizontal: spacing.md - 4, borderRadius: radii.md, backgroundColor: colors.navy900, paddingTop: spacing.sm + 2, paddingHorizontal: spacing.md - 2, overflow: "hidden" },
  basis: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1, color: colors.gold400, textAlign: "center", marginBottom: spacing.xs },
  steps: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  step: { flex: 1, alignItems: "center" },
  stepName: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50, textAlign: "center" },
  winnerName: { fontSize: 14 },
  stepScore: { fontFamily: fonts.body, fontSize: 12, color: colors.cream100, marginBottom: 5 },
  block: { alignSelf: "stretch", backgroundColor: colors.navy800, borderTopLeftRadius: radii.sm, borderTopRightRadius: radii.sm, alignItems: "center", justifyContent: "center" },
  blockWin: { backgroundColor: colors.gold500 },
  blockText: { fontFamily: fonts.display, fontSize: 20, color: colors.cream50 },
  mine: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.cream50, textAlign: "center", paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: "rgba(247,243,234,0.15)" },
  actions: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, paddingTop: 2 },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: spacing.sm },
  actionCount: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  full: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.green700 },
});
