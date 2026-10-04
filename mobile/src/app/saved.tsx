import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { PostCard, postCardWidth } from "@/components/post-card";
import { useAuth } from "@/lib/auth";
import { loadSavedPosts, type FeedPost } from "@/lib/feed";
import { colors, fonts, spacing, type } from "@/lib/theme";
import { usePostActions } from "@/lib/use-post-actions";

/**
 * Saved posts (phase 6) — the private bookmarks from Save (0094), most
 * recently saved first. Only the member sees this list; nobody is told
 * their post was saved. Unsaving here takes the post off the list.
 * Reached from the menu and the share sheet.
 */
export default function SavedScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const { width } = useWindowDimensions();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);

  const load = useCallback(async () => {
    if (!userId) return;
    const mine = ++token.current;
    try {
      const page = await loadSavedPosts(userId, null);
      if (mine !== token.current) return;
      setPosts(page.posts);
      setCursor(page.cursor);
      setError(null);
    } catch (err) {
      if (mine === token.current) setError(err instanceof Error ? err.message : "Couldn't load your saved posts.");
    } finally {
      if (mine === token.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Coming back from a post where you unsaved it should drop it here too.
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void load();
    }, [load])
  );

  async function more() {
    if (!userId || !cursor) return;
    const page = await loadSavedPosts(userId, cursor).catch(() => null);
    if (!page) return;
    setPosts((p) => [...p, ...page.posts]);
    setCursor(page.cursor);
  }

  const actions = usePostActions({
    update: (id, change) =>
      setPosts((prev) =>
        prev
          .map((p) => (p.id === id ? change(p) : p))
          // Unsaved here means off the list.
          .filter((p) => p.savedByMe)
      ),
    remove: (id) => setPosts((prev) => prev.filter((p) => p.id !== id)),
    reload: load,
    afterBlock: (memberId) => setPosts((prev) => prev.filter((p) => p.author.id !== memberId)),
  });

  if (loading) return <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.green700} />;

  return (
    <FlatList
      style={styles.fill}
      contentContainerStyle={styles.list}
      data={posts}
      keyExtractor={(p) => String(p.id)}
      ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      onEndReached={more}
      onEndReachedThreshold={0.6}
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
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="bookmark-outline" size={32} color={colors.ink500} />
          <Text style={styles.emptyTitle}>{error ? "Couldn't load them" : "Nothing saved yet"}</Text>
          <Text style={styles.emptyBody}>
            {error ?? "Tap Save on any post to keep it here. Only you can see what you've saved."}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <PostCard
          post={item}
          width={postCardWidth(width)}
          onLike={actions.like}
          onReact={actions.react}
          onShare={actions.share}
          onSave={actions.save}
          onMenu={actions.menu}
          onComment={(p) => router.push({ pathname: "/comments/[id]", params: { id: String(p.id), focus: "comment" } })}
          onCommentOptions={actions.commentOptions}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  list: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  empty: { alignItems: "center", paddingVertical: spacing.xl * 2, gap: spacing.sm },
  emptyTitle: { fontFamily: fonts.display, fontSize: type.title, color: colors.ink900 },
  emptyBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center", maxWidth: 280 },
});
