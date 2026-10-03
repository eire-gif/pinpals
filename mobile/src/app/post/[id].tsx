import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { PostCard } from "@/components/post-card";
import { useAuth } from "@/lib/auth";
import { addComment, loadPost, type FeedPost } from "@/lib/feed";
import { MAX_COMMENT_BODY } from "@/lib/feed-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { usePostActions } from "@/lib/use-post-actions";

/**
 * One post with every comment, and a box to add one.
 *
 * Where a like or comment alert lands (see alert-routes.ts: /feed/<id>),
 * and where "View all N comments" goes. A post that has gone and a post the
 * member may not see look identical here, on purpose.
 */
export default function PostScreen() {
  const { id, focus, reply, replyName } = useLocalSearchParams<{
    id: string;
    focus?: string;
    reply?: string;
    replyName?: string;
  }>();
  const postId = Number(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const { width } = useWindowDimensions();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  // Replying to one comment rather than the post (0092). Arrives from the
  // feed's Reply link; set by this screen's own.
  const [replyTo, setReplyTo] = useState<{ id: number; name: string } | null>(
    reply && Number.isInteger(Number(reply)) ? { id: Number(reply), name: replyName || "this comment" } : null
  );
  const input = useRef<TextInput>(null);
  const scroller = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!userId || !Number.isInteger(postId)) return;
    try {
      setPost(await loadPost(userId, postId));
    } finally {
      setLoading(false);
    }
  }, [userId, postId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading && post && focus === "comment") {
      const t = setTimeout(() => input.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [loading, post, focus]);

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

  async function send() {
    const body = comment.trim();
    if (!body || !post || sending) return;
    setSending(true);
    try {
      await addComment(post.id, body, replyTo?.id ?? null);
      setComment("");
      setReplyTo(null);
      await load();
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 100);
    } catch (err) {
      Alert.alert("Couldn't post your comment", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Post", headerBackTitle: "Back" }} />
      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.green700} />
      ) : !post ? (
        <View style={styles.gone}>
          <Ionicons name="images-outline" size={36} color={colors.ink500} />
          <Text style={styles.goneTitle}>This post isn&apos;t available</Text>
          <Text style={styles.goneBody}>It may have been deleted, or shared only with the author&apos;s connections.</Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
        >
          <ScrollView ref={scroller} style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <PostCard
              post={post}
              width={width - spacing.md * 2 - 2}
              standalone
              onLike={actions.like}
              onMenu={actions.menu}
              onComment={() => {
                // The Comment button is for the post itself.
                setReplyTo(null);
                input.current?.focus();
              }}
              onCommentOptions={actions.commentOptions}
              onReply={(c) => {
                setReplyTo({ id: c.id, name: c.author.name });
                input.current?.focus();
              }}
            />
            {post.comments.length > 0 && (
              <Text style={styles.hint}>Tap Reply to answer a comment. Long-press to delete, report or block.</Text>
            )}
          </ScrollView>

          {replyTo ? (
            <View style={styles.replying}>
              <Text style={styles.replyingText} numberOfLines={1}>
                Replying to <Text style={styles.replyingName}>{replyTo.name}</Text>
              </Text>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel reply">
                <Ionicons name="close-circle" size={20} color={colors.ink500} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.composer}>
            <TextInput
              ref={input}
              value={comment}
              onChangeText={setComment}
              placeholder={replyTo ? `Reply to ${replyTo.name.split(" ")[0]}…` : "Write a comment…"}
              placeholderTextColor={colors.ink500}
              multiline
              maxLength={MAX_COMMENT_BODY}
              style={styles.input}
              accessibilityLabel={replyTo ? `Reply to ${replyTo.name}` : "Write a comment"}
            />
            <Pressable
              onPress={send}
              disabled={sending || comment.trim().length === 0}
              style={[styles.send, (sending || comment.trim().length === 0) && styles.sendDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Post comment"
            >
              {sending ? <ActivityIndicator color={colors.cream50} /> : <Ionicons name="arrow-up" size={20} color={colors.cream50} />}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, textAlign: "center", marginTop: spacing.md },
  replying: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.cream50,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  replyingText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  replyingName: { fontFamily: fonts.bodyBold, color: colors.ink900 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    backgroundColor: colors.cream50,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.sm + 2,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.4 },
  gone: { alignItems: "center", padding: spacing.xl, gap: spacing.sm },
  goneTitle: { fontFamily: fonts.display, fontSize: type.title, color: colors.ink900, textAlign: "center" },
  goneBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center" },
});
