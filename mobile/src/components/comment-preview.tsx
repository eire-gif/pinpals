import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { ago } from "@/lib/feed-rules";
import { colors, fonts, spacing } from "@/lib/theme";

/**
 * A card's comments, under its buttons (Oct 2026, claude/social-live.md):
 * up to two, each with a heart to like it and its count, Reply, then "View
 * all 12 comments" and an "Add a comment…" line. Used by posts and by
 * society results. Tapping anything but a heart opens the full thread.
 */
export type PreviewComment = {
  id: number;
  name: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  body: string;
  createdAt: string;
  likeCount: number;
  liked: boolean;
};

export function CommentPreview({
  comments,
  total,
  onLike,
  onOpen,
  me,
}: {
  comments: readonly PreviewComment[];
  total: number;
  onLike: (c: PreviewComment) => void;
  /** Opens the thread; `reply` puts the box in focus. */
  onOpen: (reply?: boolean) => void;
  me?: { name: string; avatarUrl: string | null; avatarColor: string | null } | null;
}) {
  return (
    <View style={styles.wrap}>
      {comments.map((c) => (
        <View key={c.id} style={styles.row}>
          <Avatar url={c.avatarUrl} color={c.avatarColor} name={c.name} size={26} />
          <Pressable style={styles.text} onPress={() => onOpen()} accessibilityRole="button" accessibilityLabel={`${c.name}: ${c.body}. Open comments`}>
            <Text style={styles.body} numberOfLines={2}>
              <Text style={styles.name}>{c.name} </Text>
              {c.body}
            </Text>
            <Text style={styles.meta}>
              {ago(c.createdAt)} · <Text style={styles.reply} onPress={() => onOpen(true)} suppressHighlighting>Reply</Text>
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onLike(c)}
            hitSlop={10}
            style={styles.heart}
            accessibilityRole="button"
            accessibilityState={{ selected: c.liked }}
            accessibilityLabel={`${c.liked ? "Liked" : "Like"} ${c.name}'s comment${c.likeCount > 0 ? `, ${c.likeCount} ${c.likeCount === 1 ? "like" : "likes"}` : ""}`}
          >
            <Ionicons name={c.liked ? "heart" : "heart-outline"} size={16} color={c.liked ? colors.red600 : colors.ink500} />
            {c.likeCount > 0 ? <Text style={[styles.count, c.liked && { color: colors.red600 }]}>{c.likeCount}</Text> : null}
          </Pressable>
        </View>
      ))}
      {total > comments.length ? (
        <Pressable onPress={() => onOpen()} accessibilityRole="button" hitSlop={6}>
          <Text style={styles.all}>View all {total} comments</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => onOpen(true)} style={styles.add} accessibilityRole="button" accessibilityLabel="Add a comment">
        <Avatar url={me?.avatarUrl} color={me?.avatarColor} name={me?.name} size={26} />
        <Text style={styles.addText}>Add a comment…</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md - 2, paddingTop: spacing.xs, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  text: { flex: 1 },
  name: { fontFamily: fonts.bodyBold, color: colors.ink900 },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, marginTop: 2 },
  reply: { fontFamily: fonts.bodyBold, color: colors.ink500 },
  heart: { alignItems: "center", minWidth: 28, paddingTop: 2 },
  count: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.ink500 },
  all: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.ink500 },
  add: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 },
  addText: { fontFamily: fonts.body, fontSize: 14, color: colors.ink500 },
});
