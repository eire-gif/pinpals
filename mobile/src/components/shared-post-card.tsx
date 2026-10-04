import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { loadPost, type FeedPost } from "@/lib/feed";
import { POST_TYPE_INFO, detailChips } from "@/lib/post-details";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * A post shared into a conversation (phase 6), drawn under the message that
 * links it. Read with the viewer's own session, so someone who can't see the
 * post (connections-only, deleted, blocked) gets "isn't available" — the
 * same answer as the post screen, and no hint of whose it was.
 *
 * One read per post id per app session: a thread can show the same link
 * many times, and a chat shouldn't refetch a post every time it scrolls.
 */
const cache = new Map<number, Promise<FeedPost | null>>();

export function SharedPostCard({ postId, viewerId, mine }: { postId: number; viewerId: string; mine: boolean }) {
  const [post, setPost] = useState<FeedPost | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    let request = cache.get(postId);
    if (!request) {
      request = loadPost(viewerId, postId).catch(() => null);
      cache.set(postId, request);
    }
    void request.then((p) => live && setPost(p));
    return () => {
      live = false;
    };
  }, [postId, viewerId]);

  if (post === undefined) return <View style={[styles.card, mine && styles.cardMine, styles.waiting]} />;
  if (post === null) {
    return (
      <View style={[styles.card, mine && styles.cardMine, styles.row]}>
        <Ionicons name="lock-closed-outline" size={16} color={colors.ink500} />
        <Text style={styles.unavailable}>This post isn&apos;t available</Text>
      </View>
    );
  }

  const photo = post.photos.find((p) => p.url)?.url ?? null;
  const chips = detailChips(post).slice(0, 3).join(" · ");
  const icon = POST_TYPE_INFO[post.kind].icon as keyof typeof Ionicons.glyphMap;

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/post/[id]", params: { id: String(post.id) } })}
      style={({ pressed }) => [styles.card, mine && styles.cardMine, styles.row, pressed && { opacity: 0.85 }]}
      accessibilityRole="link"
      accessibilityLabel={`Post by ${post.author.name}${post.club ? ` at ${post.club.name}` : ""}. Open`}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbIcon]}>
          <Ionicons name={icon} size={22} color={colors.cream50} />
        </View>
      )}
      <View style={styles.text}>
        <Text style={styles.author} numberOfLines={1}>
          {post.author.name}
        </Text>
        {post.club ? (
          <Text style={styles.course} numberOfLines={1}>
            {post.club.name}
          </Text>
        ) : null}
        <Text style={styles.line} numberOfLines={2}>
          {chips || post.body || "A post on PinPals"}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.ink500} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.sm,
    minWidth: 230,
  },
  cardMine: { backgroundColor: colors.cream50 },
  waiting: { height: 72 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2 },
  thumb: { width: 56, height: 56, borderRadius: radii.sm, backgroundColor: colors.cream100 },
  thumbIcon: { backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0 },
  author: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  course: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.green700, marginTop: 1 },
  line: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, marginTop: 2 },
  unavailable: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
});
