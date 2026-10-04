import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { addComment, editComment, mentionCandidates, type FeedComment, type FeedPost } from "@/lib/feed";
import { MAX_COMMENT_BODY, ago } from "@/lib/feed-rules";
import {
  activeMention,
  insertMention,
  matchMentions,
  mentionIdsInBody,
  mentionSegments,
  type MentionTarget,
} from "@/lib/mentions";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The full comment experience (Oct 2026 feed redesign, phase 5) — used by
 * the Comments sheet (app/comments/[id].tsx) and under a post on the post
 * screen, so the two can't drift apart. The feed card only ever shows a
 * collapsed preview of two.
 *
 *   CommentList      the thread: one level of replies (0092), @mentions as
 *                    links, a heart per comment, Like · Reply · ···
 *   CommentComposer  the box at the bottom: @-suggestions as you type, and a
 *                    banner when replying or editing
 *   useCommentThread the state between them — who you're replying to, what
 *                    you're editing, which mentions you picked — and send
 *
 * Writes go through feed.ts like every other comment write. Edit, delete,
 * report and block are use-post-actions' commentOptions, so the sheet here
 * offers exactly what the feed's long-press does.
 */

type Candidate = MentionTarget & { avatarUrl: string | null; avatarColor: string | null };

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

export function useCommentThread({
  post,
  viewerId,
  reload,
  initialReply,
  initialEdit,
}: {
  post: FeedPost | null;
  viewerId: string | null;
  /** Re-read the post after a write, so ids, mentions and counts are the
   *  database's. */
  reload: () => Promise<void>;
  initialReply?: { id: number; name: string } | null;
  /** A comment id to start editing, e.g. from the feed's long-press. */
  initialEdit?: number | null;
}) {
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: number; name: string } | null>(initialReply ?? null);
  const [editing, setEditing] = useState<FeedComment | null>(null);
  const [chosen, setChosen] = useState<MentionTarget[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const input = useRef<TextInput>(null);

  // Suggestions are worked out once per post; the database re-checks every
  // mention when the comment is saved.
  const postId = post?.id ?? null;
  useEffect(() => {
    if (!post || !viewerId) return;
    let live = true;
    mentionCandidates(viewerId, post)
      .then((list) => live && setCandidates(list))
      .catch(() => {});
    return () => {
      live = false;
    };
    // Keyed on the post's id, not the post: a new comment shouldn't refetch
    // the viewer's connections.
  }, [postId, viewerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = useCallback((comment: FeedComment) => {
    setReplyTo(null);
    setEditing(comment);
    setText(comment.body);
    setCursor(comment.body.length);
    setTimeout(() => input.current?.focus(), 150);
  }, []);

  // Arriving with ?edit=<id>: once the post is loaded, open that comment.
  const editOpened = useRef(false);
  useEffect(() => {
    if (!post || !initialEdit || editOpened.current) return;
    const target = post.comments.find((c) => c.id === initialEdit && c.isMine && !c.hidden);
    if (target) {
      editOpened.current = true;
      startEdit(target);
    }
  }, [post, initialEdit, startEdit]);

  const startReply = useCallback((comment: FeedComment) => {
    setEditing(null);
    setReplyTo({ id: comment.id, name: comment.author.name });
    // Address them: replies read as conversation, and it notifies them even
    // when the reply lands under someone else's comment.
    const tag = `@${comment.author.name} `;
    if (!comment.isMine) {
      setText((t) => (t.startsWith(tag) ? t : tag + t));
      setChosen((c) => [...c, { id: comment.author.id, name: comment.author.name }]);
    }
    setTimeout(() => input.current?.focus(), 150);
  }, []);

  const cancel = useCallback(() => {
    setReplyTo(null);
    setEditing(null);
    setText("");
    setChosen([]);
  }, []);

  const query = activeMention(text, cursor);
  const suggestions = query ? matchMentions(candidates, query.query) : [];

  const pickMention = useCallback(
    (who: MentionTarget) => {
      if (!query) return;
      const next = insertMention(text, query.start, cursor, who.name);
      setText(next.text);
      setCursor(next.cursor);
      setChosen((c) => [...c, { id: who.id, name: who.name }]);
    },
    [query, text, cursor]
  );

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || !post || sending) return;
    setSending(true);
    try {
      if (editing) {
        await editComment(post.id, editing.id, body);
      } else {
        await addComment(post.id, body, replyTo?.id ?? null, mentionIdsInBody(body, chosen));
      }
      cancel();
      await reload();
    } catch (err) {
      Alert.alert(
        editing ? "Couldn't save your edit" : "Couldn't post your comment",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setSending(false);
    }
  }, [text, post, sending, editing, replyTo, chosen, cancel, reload]);

  return {
    input,
    text,
    setText,
    setCursor,
    sending,
    replyTo,
    editing,
    suggestions,
    pickMention,
    startReply,
    startEdit,
    cancel,
    send,
  };
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export function CommentList({
  comments,
  onLike,
  onReply,
  onOptions,
}: {
  comments: FeedComment[];
  onLike: (comment: FeedComment) => void;
  onReply: (comment: FeedComment) => void;
  onOptions: (comment: FeedComment) => void;
}) {
  if (comments.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="chatbubbles-outline" size={28} color={colors.ink500} />
        <Text style={styles.emptyTitle}>No comments yet</Text>
        <Text style={styles.emptyBody}>Start the conversation — ask what club, or just say well played.</Text>
      </View>
    );
  }
  return (
    <View style={styles.list}>
      {comments.map((c) => (
        <CommentItem key={c.id} comment={c} onLike={onLike} onReply={onReply} onOptions={onOptions} />
      ))}
    </View>
  );
}

function openMember(id: string) {
  router.push({ pathname: "/member/[id]", params: { id } });
}

function CommentItem({
  comment,
  onLike,
  onReply,
  onOptions,
}: {
  comment: FeedComment;
  onLike: (comment: FeedComment) => void;
  onReply: (comment: FeedComment) => void;
  onOptions: (comment: FeedComment) => void;
}) {
  const segments = mentionSegments(comment.body, comment.mentions);
  return (
    <Pressable
      onLongPress={() => onOptions(comment)}
      style={[styles.item, comment.depth === 1 && styles.reply]}
      accessibilityHint="Long-press for options"
    >
      <Pressable onPress={() => openMember(comment.author.id)} hitSlop={4} accessibilityRole="link" accessibilityLabel={comment.author.name}>
        <Avatar
          url={comment.author.avatarUrl}
          color={comment.author.avatarColor}
          name={comment.author.name}
          size={comment.depth === 1 ? 28 : 34}
        />
      </Pressable>
      <View style={styles.itemMain}>
        <View style={[styles.bubble, comment.hidden && styles.bubbleHidden]}>
          <Text style={styles.head} numberOfLines={1}>
            <Text style={styles.name} onPress={() => openMember(comment.author.id)}>
              {comment.author.name}
            </Text>
            <Text style={styles.meta}>
              {"  "}
              {ago(comment.createdAt)}
              {comment.editedAt ? " · Edited" : ""}
            </Text>
          </Text>
          <Text style={styles.body}>
            {segments.map((s, i) =>
              s.mention ? (
                <Text key={i} style={styles.mention} onPress={() => openMember(s.mention!.id)} accessibilityRole="link">
                  {s.text}
                </Text>
              ) : (
                <Text key={i}>{s.text}</Text>
              )
            )}
          </Text>
          {comment.hidden && <Text style={styles.hiddenNote}>Hidden by PinPals — only you can see this.</Text>}
        </View>

        <View style={styles.actions}>
          {!comment.hidden && (
            <>
              <Text
                style={[styles.action, comment.likedByMe && styles.actionOn]}
                onPress={() => onLike(comment)}
                accessibilityRole="button"
                accessibilityState={{ selected: comment.likedByMe }}
                accessibilityLabel={comment.likedByMe ? "Unlike comment" : "Like comment"}
                suppressHighlighting
              >
                Like
              </Text>
              <Text
                style={styles.action}
                onPress={() => onReply(comment)}
                accessibilityRole="button"
                accessibilityLabel={`Reply to ${comment.author.name}`}
                suppressHighlighting
              >
                Reply
              </Text>
            </>
          )}
          <Pressable onPress={() => onOptions(comment)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Comment options">
            <Ionicons name="ellipsis-horizontal" size={16} color={colors.ink500} />
          </Pressable>
          {comment.likeCount > 0 && (
            <View style={styles.likes} accessibilityLabel={`${comment.likeCount} ${comment.likeCount === 1 ? "like" : "likes"}`}>
              <Ionicons name="heart" size={13} color={colors.red600} />
              <Text style={styles.likesText}>{comment.likeCount}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

export function CommentComposer({
  meAvatar,
  thread,
}: {
  meAvatar: { url: string | null; color: string | null; name: string } | null;
  thread: ReturnType<typeof useCommentThread>;
}) {
  const { input, text, setText, setCursor, sending, replyTo, editing, suggestions, pickMention, cancel, send } = thread;
  const canSend = text.trim().length > 0 && !sending;

  return (
    <View style={styles.composer}>
      {suggestions.length > 0 && (
        <ScrollView keyboardShouldPersistTaps="always" style={styles.suggestions} contentContainerStyle={{ paddingVertical: 4 }}>
          {(suggestions as Candidate[]).map((s) => (
            <Pressable
              key={s.id}
              onPress={() => pickMention(s)}
              style={({ pressed }) => [styles.suggestion, pressed && styles.suggestionPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${s.name}`}
            >
              <Avatar url={s.avatarUrl} color={s.avatarColor} name={s.name} size={28} />
              <Text style={styles.suggestionName}>{s.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {(replyTo || editing) && (
        <View style={styles.banner}>
          <Ionicons name={editing ? "create-outline" : "return-down-forward"} size={15} color={colors.ink500} />
          <Text style={styles.bannerText} numberOfLines={1}>
            {editing ? "Editing your comment" : `Replying to ${replyTo!.name}`}
          </Text>
          <Text style={styles.bannerCancel} onPress={cancel} accessibilityRole="button" suppressHighlighting>
            Cancel
          </Text>
        </View>
      )}

      <View style={styles.row}>
        {meAvatar ? <Avatar url={meAvatar.url} color={meAvatar.color} name={meAvatar.name} size={32} /> : null}
        <View style={styles.field}>
          <TextInput
            ref={input}
            value={text}
            onChangeText={setText}
            onSelectionChange={(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) =>
              setCursor(e.nativeEvent.selection.end)
            }
            placeholder={editing ? "Edit your comment" : "Add a comment…"}
            placeholderTextColor={colors.ink500}
            multiline
            maxLength={MAX_COMMENT_BODY}
            style={styles.input}
            accessibilityLabel={editing ? "Edit your comment" : "Add a comment"}
          />
          <Pressable
            onPress={() => {
              // An "@" at the cursor opens the suggestions.
              const next = text && !/\s$/.test(text) ? `${text} @` : `${text}@`;
              setText(next);
              setCursor(next.length);
              input.current?.focus();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Mention someone"
          >
            <Ionicons name="at" size={20} color={colors.ink500} />
          </Pressable>
        </View>
        <Pressable
          onPress={send}
          disabled={!canSend}
          style={[styles.send, !canSend && styles.sendDisabled]}
          accessibilityRole="button"
          accessibilityLabel={editing ? "Save edit" : "Post comment"}
        >
          {sending ? (
            <ActivityIndicator color={colors.cream50} size="small" />
          ) : (
            <Ionicons name={editing ? "checkmark" : "arrow-up"} size={20} color={colors.cream50} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  empty: { alignItems: "center", paddingVertical: spacing.xl, gap: spacing.xs },
  emptyTitle: { fontFamily: fonts.display, fontSize: type.heading, color: colors.ink900, marginTop: spacing.xs },
  emptyBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center", maxWidth: 260 },

  item: { flexDirection: "row", gap: spacing.sm + 2 },
  // One level of replies (0092), tucked under the comment they answer.
  reply: { marginLeft: 44 },
  itemMain: { flex: 1, minWidth: 0 },
  bubble: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderTopLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
  },
  bubbleHidden: { backgroundColor: colors.cream100 },
  head: { marginBottom: 2 },
  name: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink900 },
  mention: { fontFamily: fonts.bodySemi, color: colors.green700 },
  hiddenNote: { fontFamily: fonts.body, fontSize: 11.5, color: colors.ink500, marginTop: 4 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md + 2,
    paddingLeft: spacing.sm + 4,
    paddingTop: 4,
    minHeight: 28,
  },
  action: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink500, paddingVertical: 4 },
  actionOn: { color: colors.red600 },
  likes: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 3 },
  likesText: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink500 },

  composer: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm + 2,
  },
  suggestions: { maxHeight: 200, marginBottom: spacing.xs },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
  },
  suggestionPressed: { backgroundColor: colors.surfaceTint },
  suggestionName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  banner: { flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: spacing.sm },
  bannerText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink500 },
  bannerCancel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green700, paddingVertical: 4, paddingLeft: spacing.sm },
  row: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceTint,
    borderRadius: radii.lg + 4,
    borderWidth: 1,
    borderColor: colors.line,
    paddingLeft: spacing.md - 2,
    paddingRight: spacing.sm + 2,
    minHeight: 44,
  },
  // 16pt: iOS zooms the screen when a smaller field takes focus (theme.ts).
  input: { flex: 1, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, maxHeight: 120, paddingVertical: 10 },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { backgroundColor: colors.line },
});
