import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
 
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";

import { CommentComposer, CommentList, useCommentThread } from "@/components/comment-thread";
import { PostCard, postCardWidth } from "@/components/post-card";
import { KEYBOARD_DISMISS_MODE, KeyboardInset } from "@/components/keyboard";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { loadPost, type FeedPost } from "@/lib/feed";
import { supabase } from "@/lib/supabase";
import { colors, fonts, spacing, type } from "@/lib/theme";
import { usePostActions } from "@/lib/use-post-actions";

/**
 * One post with its whole conversation.
 *
 * Where a like, comment or mention alert lands (alert-routes.ts: /feed/<id>)
 * and where a shared link opens. The thread under the card is the same
 * component as the Comments sheet (components/comment-thread.tsx), so replies,
 * mentions, comment likes and edits behave identically in both. A post that
 * has gone and a post the member may not see look identical here, on purpose.
 */
export default function PostScreen() {
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
  const { width } = useWindowDimensions();

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
    // Blocking the post's author leaves nothing to show; blocking a
    // commenter just takes their comments away.
    afterBlock: (memberId) => {
      if (post && post.author.id === memberId) {
        router.back();
        return;
      }
      setPost((p) => (p ? { ...p, comments: p.comments.filter((c) => c.author.id !== memberId) } : p));
    },
  });

  return (
    <>
      <Stack.Screen options={{ title: "Post", headerBackTitle: "Back" }} />
      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.green700} />
      ) : failed ? (
        <LoadError
          what="this post"
          size="screen"
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        />
      ) : !post ? (
        <StateMessage
          size="screen"
          icon="images-outline"
          title="This post isn't available"
          body="It may have been deleted, or shared only with the author's connections."
        />
      ) : (
        <KeyboardInset style={styles.fill}>
          <ScrollView ref={scroller} style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode={KEYBOARD_DISMISS_MODE}>
            <PostCard
              post={post}
              width={postCardWidth(width)}
              standalone
              onLike={actions.like}
              onReact={actions.react}
              onShare={actions.share}
              onSave={actions.save}
              onMenu={actions.menu}
              onComment={() => {
                // The Comment button is for the post itself.
                thread.cancel();
                thread.input.current?.focus();
              }}
            />
            <Text style={styles.section}>Comments</Text>
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
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  section: { fontFamily: fonts.display, fontSize: type.heading, color: colors.ink900, marginTop: spacing.lg, marginBottom: spacing.md },
});
