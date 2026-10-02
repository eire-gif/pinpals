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
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const postId = Number(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const { width } = useWindowDimensions();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
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
  });

  async function send() {
    const body = comment.trim();
    if (!body || !post || sending) return;
    setSending(true);
    try {
      await addComment(post.id, body);
      setComment("");
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
              onComment={() => input.current?.focus()}
              onDeleteComment={actions.removeComment}
              onReportComment={actions.reportComment}
            />
            {post.comments.length > 0 && (
              <Text style={styles.hint}>Long-press a comment to delete or report it.</Text>
            )}
          </ScrollView>

          <View style={styles.composer}>
            <TextInput
              ref={input}
              value={comment}
              onChangeText={setComment}
              placeholder="Write a comment…"
              placeholderTextColor={colors.ink500}
              multiline
              maxLength={MAX_COMMENT_BODY}
              style={styles.input}
              accessibilityLabel="Write a comment"
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
