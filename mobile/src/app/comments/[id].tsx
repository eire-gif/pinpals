import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { KEYBOARD_DISMISS_MODE, KeyboardInset } from "@/components/keyboard";
import { LoadError, StateMessage } from "@/components/state-message";
import { CommentComposer, CommentList, useCommentThread } from "@/components/comment-thread";
import { PostMediaPane } from "@/components/post-media-pane";
import { useAuth } from "@/lib/auth";
import { loadPost, type FeedPost } from "@/lib/feed";
import { supabase } from "@/lib/supabase";
import { colors, spacing } from "@/lib/theme";
import { usePostActions } from "@/lib/use-post-actions";

/**
 * Comments, as a sheet over the feed (phase 5). The feed card stays
 * collapsed — two comments at most — and every way into the conversation
 * (Comment, "View all", "N comments", Reply, Edit) lands here.
 *
 * Presented as a modal (registered in app/_layout.tsx, which is the one
 * place a presentation can be set without crashing iOS). Params:
 *   focus=comment          open with the keyboard up
 *   reply=<id>&replyName=  replying to that comment
 *   edit=<id>              editing that comment of yours
 */
export default function CommentsScreen() {
  const { id, focus, reply, replyName, edit } = useLocalSearchParams<{
    id: string;
    focus?: string;
    reply?: string;
    replyName?: string;
    edit?: string;
  }>();
  const postId = Number(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [post, setPost] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [me, setMe] = useState<{ url: string | null; color: string | null; name: string } | null>(null);
  const scroller = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!userId || !Number.isInteger(postId)) return;
    try {
      setPost(await loadPost(userId, postId));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [userId, postId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    void supabase
      .from("profiles")
      .select("first_name, last_name, avatar_url, avatar_color")
      .eq("id", userId)
      .maybeSingle<{ first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null }>()
      .then(({ data }) => {
        if (data) setMe({ url: data.avatar_url, color: data.avatar_color, name: [data.first_name, data.last_name].filter(Boolean).join(" ") });
      });
  }, [userId]);

  const thread = useCommentThread({
    post,
    viewerId: userId,
    reload: async () => {
      await load();
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 120);
    },
    initialReply: reply && Number.isInteger(Number(reply)) ? { id: Number(reply), name: replyName || "this comment" } : null,
    initialEdit: edit && Number.isInteger(Number(edit)) ? Number(edit) : null,
  });

  useEffect(() => {
    if (!loading && post && (focus === "comment" || reply)) {
      const t = setTimeout(() => thread.input.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [loading, post, focus, reply, thread.input]);

  const actions = usePostActions({
    update: (pid, change) => setPost((p) => (p && p.id === pid ? change(p) : p)),
    remove: () => router.back(),
    reload: load,
    afterBlock: (memberId) => {
      if (post && post.author.id === memberId) {
        router.back();
        return;
      }
      setPost((p) => (p ? { ...p, comments: p.comments.filter((c) => c.author.id !== memberId) } : p));
    },
  });

  const count = post ? post.comments.filter((c) => !c.hidden).length : 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: post ? `Comments (${count})` : "Comments",
          headerRight: () => (
            <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.ink900} />
            </Pressable>
          ),
        }}
      />
      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.green700} />
      ) : failed ? (
        <LoadError
          what="these comments"
          size="screen"
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        />
      ) : !post ? (
        <StateMessage
          size="screen"
          icon="chatbubbles-outline"
          title="These comments aren't available"
          body="The post may have been deleted, or shared only with the author's connections."
        />
      ) : (
        <KeyboardInset style={styles.fill}>
          <PostMediaPane post={post} />
          <ScrollView ref={scroller} style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode={KEYBOARD_DISMISS_MODE}>
            <CommentList
              comments={post.comments}
              onLike={actions.likeComment}
              onReact={actions.reactToComment}
              onReply={thread.startReply}
              onOptions={(c) => actions.commentOptions(c, { onEdit: thread.startEdit })}
            />
          </ScrollView>
          <CommentComposer meAvatar={me} thread={thread} />
        </KeyboardInset>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, paddingBottom: spacing.lg },
});
