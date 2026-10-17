import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import type { FeedPost } from "@/lib/feed";
import { ago, photoHeight } from "@/lib/feed-rules";
import { detailChips } from "@/lib/post-details";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * A post shared to someone's feed (0164), drawn inside the sharer's post:
 * the original's author, course, words and first photo, in a bordered card
 * that opens the original. Also the preview in "Share to your feed".
 *
 * `post` was read under the viewer's own RLS; null means it has been
 * deleted, hidden, or is from someone who blocked them — the same "isn't
 * available" as a post shared into a chat, and no hint of whose it was.
 */
export function QuotedPost({ post, width, interactive = true }: { post: FeedPost | null; width: number; interactive?: boolean }) {
  if (!post) {
    return (
      <View style={[styles.card, styles.unavailableRow]}>
        <Ionicons name="lock-closed-outline" size={16} color={colors.ink500} />
        <Text style={styles.unavailable}>This post is no longer available</Text>
      </View>
    );
  }

  const photo = post.photos.find((p) => p.url) ?? null;
  const chips = detailChips(post).slice(0, 3).join(" · ");
  const inner = width - 2;

  const body = (
    <>
      <View style={styles.header}>
        <Avatar url={post.author.avatarUrl} color={post.author.avatarColor} name={post.author.name} size={28} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>
            {post.author.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {post.club ? `${post.club.name} · ` : ""}
            {ago(post.createdAt)}
          </Text>
        </View>
      </View>
      {post.body ? (
        <Text style={styles.text} numberOfLines={4}>
          {post.body}
        </Text>
      ) : null}
      {chips ? <Text style={styles.chips}>{chips}</Text> : null}
      {photo?.url ? (
        <Image
          source={{ uri: photo.url }}
          style={{ width: inner, height: Math.min(photoHeight(inner, photo), inner) }}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </>
  );

  if (!interactive) return <View style={[styles.card, { width }]}>{body}</View>;
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/post/[id]", params: { id: String(post.id) } })}
      style={({ pressed }) => [styles.card, { width }, pressed && { opacity: 0.9 }]}
      accessibilityRole="link"
      accessibilityLabel={`Shared post by ${post.author.name}${post.club ? ` at ${post.club.name}` : ""}. Open`}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm + 2, paddingBottom: spacing.sm },
  name: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, marginTop: 1 },
  text: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 19,
    color: colors.ink900,
    paddingHorizontal: spacing.sm + 2,
    paddingBottom: spacing.sm,
  },
  chips: {
    fontFamily: fonts.bodySemi,
    fontSize: 12.5,
    color: colors.green700,
    paddingHorizontal: spacing.sm + 2,
    paddingBottom: spacing.sm,
  },
  unavailableRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md - 2 },
  unavailable: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
});
