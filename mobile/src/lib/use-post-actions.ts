import { useCallback } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";

import { askReportReason, showPostMenu, showSheet } from "@/components/post-card";
import { blockConfirmText, blockMember } from "./blocking";
import {
  changeAudience,
  deleteComment,
  deletePost,
  report,
  setCommentReaction,
  setLike,
  setSaved,
  type FeedComment,
  type FeedPost,
} from "./feed";
import { HEART, applyCommentReaction, type CommentEmoji } from "./comment-reactions";
import { DEFAULT_REACTION, applyReaction, type ReactionKey } from "./reactions";
import { supabase } from "./supabase";

/**
 * What every screen that shows posts does with them, in one place: like,
 * the options menu, deleting and reporting. The screen supplies how to
 * update or drop a post in its own list; this supplies the behaviour, so
 * the Feed tab, a member's page and the post screen cannot drift apart.
 */
export function usePostActions(handlers: {
  /** Replace one post in the screen's state. */
  update: (postId: number, change: (post: FeedPost) => FeedPost) => void;
  /** Drop a post from the screen's state. */
  remove: (postId: number) => void;
  /** Re-read after a change the screen cannot patch in place. */
  reload: () => void;
  /** After blocking a member: take everything of theirs off this screen.
   *  The database already hides it; this saves waiting for a reload. */
  afterBlock: (memberId: string) => void;
}) {
  const { update, remove, reload, afterBlock } = handlers;

  /** Apple guideline 1.2: block from the content itself. Asks first,
   *  because the effect reaches well past the post in front of you. */
  const block = useCallback(
    (memberId: string, name: string) => {
      const { title, message } = blockConfirmText(name);
      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await blockMember(memberId);
              afterBlock(memberId);
            } catch (err) {
              Alert.alert("Couldn't block that member", err instanceof Error ? err.message : "Please try again.");
            }
          },
        },
      ]);
    },
    [afterBlock]
  );

  /**
   * Sets the viewer's reaction — or clears it, with null (0096).
   *
   * Optimistic: the button and counts change at once, because a reaction
   * that waits for a round trip feels broken. The server's answer then
   * replaces the guess, so the database stays the source of truth; on a
   * failure the post goes back to exactly what it was, with a message.
   */
  const react = useCallback(
    async (post: FeedPost, reaction: ReactionKey | null) => {
      const before = { myReaction: post.myReaction, likedByMe: post.likedByMe, likeCount: post.likeCount, reactionCounts: post.reactionCounts };
      if (reaction === post.myReaction) return;
      const guess = applyReaction(post.reactionCounts, post.likeCount, post.myReaction, reaction);
      update(post.id, (p) => ({
        ...p,
        myReaction: reaction,
        likedByMe: reaction !== null,
        likeCount: guess.total,
        reactionCounts: guess.counts,
      }));
      try {
        const result = await setLike(post.id, reaction !== null, reaction ?? undefined);
        update(post.id, (p) => ({
          ...p,
          likedByMe: result.liked,
          likeCount: result.likeCount,
          myReaction: result.reaction !== undefined ? result.reaction : p.myReaction,
          reactionCounts: result.reactionCounts ?? p.reactionCounts,
        }));
      } catch (err) {
        update(post.id, (p) => ({ ...p, ...before }));
        Alert.alert("Couldn't save that", err instanceof Error ? err.message : "Please try again.");
      }
    },
    [update]
  );

  /** A single tap on React: the default reaction, or off again if the
   *  viewer has already reacted (with anything). */
  const like = useCallback(
    (post: FeedPost) => react(post, post.myReaction ? null : DEFAULT_REACTION),
    [react]
  );

  /** Save is private and silent, so it is optimistic like the heart and says
   *  nothing on success; the filled bookmark is the confirmation. */
  const save = useCallback(
    async (post: FeedPost) => {
      const next = !post.savedByMe;
      update(post.id, (p) => ({ ...p, savedByMe: next }));
      try {
        const { data } = await supabase.auth.getSession();
        const userId = data.session?.user?.id;
        if (!userId) throw new Error("Please sign in again.");
        await setSaved(post.id, userId, next);
      } catch (err) {
        update(post.id, (p) => ({ ...p, savedByMe: !next }));
        Alert.alert("Couldn't save that", err instanceof Error ? err.message : "Please try again.");
      }
    },
    [update]
  );

  /** Share opens the share sheet (phase 6): inside PinPals by message,
   *  outside with a share card, or save. See app/share/[id].tsx. */
  const share = useCallback((post: FeedPost) => {
    router.push({ pathname: "/share/[id]", params: { id: String(post.id) } });
  }, []);

  const menu = useCallback(
    (post: FeedPost) => {
      showPostMenu(post, {
        onProfile: () => router.push({ pathname: "/member/[id]", params: { id: post.author.id } }),
        onAudience: async () => {
          const visibility = post.visibility === "members" ? "connections" : "members";
          try {
            await changeAudience(post.id, visibility);
            update(post.id, (p) => ({ ...p, visibility }));
          } catch (err) {
            Alert.alert("Couldn't change that", err instanceof Error ? err.message : "Please try again.");
          }
        },
        onDelete: () => {
          Alert.alert("Delete this post?", "Its photos, likes and comments go with it.", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: async () => {
                try {
                  await deletePost(post.id);
                  remove(post.id);
                } catch (err) {
                  Alert.alert("Couldn't delete that", err instanceof Error ? err.message : "Please try again.");
                }
              },
            },
          ]);
        },
        onReport: () =>
          askReportReason(async (category) => {
            try {
              await report("post", post.id, category);
              Alert.alert("Thanks", "The PinPals team will take a look. The member isn't told who reported them.");
            } catch (err) {
              Alert.alert("Couldn't send that", err instanceof Error ? err.message : "Please try again.");
            }
          }),
        onBlock: () => block(post.author.id, post.author.name),
      });
    },
    [update, remove, block]
  );

  const removeComment = useCallback(
    (comment: FeedComment) => {
      Alert.alert("Delete this comment?", undefined, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteComment(comment.postId, comment.id);
              update(comment.postId, (p) => ({
                ...p,
                comments: p.comments.filter((c) => c.id !== comment.id),
                commentCount: comment.hidden ? p.commentCount : Math.max(0, p.commentCount - 1),
              }));
            } catch (err) {
              Alert.alert("Couldn't delete that", err instanceof Error ? err.message : "Please try again.");
              reload();
            }
          },
        },
      ]);
    },
    [update, reload]
  );

  const reportComment = useCallback((comment: FeedComment) => {
    askReportReason(async (category) => {
      try {
        await report("post_comment", comment.id, category);
        Alert.alert("Thanks", "The PinPals team will take a look.");
      } catch (err) {
        Alert.alert("Couldn't send that", err instanceof Error ? err.message : "Please try again.");
      }
    });
  }, []);

  /**
   * A comment's options (the "···" or a long-press). Your own: edit or
   * delete. Someone else's on your post: delete, report or block. Someone
   * else's elsewhere: report or block. A hidden comment of yours can only
   * be deleted — editing must not launder a moderated comment (0097).
   *
   * `onEdit` is what Edit does on this screen; without one (the feed's
   * preview) it opens the comments screen ready to edit.
   */
  const commentOptions = useCallback(
    (comment: FeedComment, opts?: { onEdit?: (comment: FeedComment) => void }) => {
      const first = comment.author.name.split(" ")[0];
      const items: { label: string; destructive?: boolean; run: () => void }[] = [];
      if (comment.isMine && !comment.hidden) {
        const onEdit =
          opts?.onEdit ??
          ((c: FeedComment) =>
            router.push({ pathname: "/comments/[id]", params: { id: String(c.postId), edit: String(c.id) } }));
        items.push({ label: "Edit comment", run: () => onEdit(comment) });
      }
      if (comment.canDelete) items.push({ label: "Delete comment", destructive: comment.isMine, run: () => removeComment(comment) });
      if (!comment.isMine) {
        items.push({ label: "Report comment", run: () => reportComment(comment) });
        items.push({ label: `Block ${first}`, destructive: true, run: () => block(comment.author.id, comment.author.name) });
      }
      showSheet("Comment", items);
    },
    [removeComment, reportComment, block]
  );

  /** A heart on a comment: optimistic, rolled back on failure. */
  /** A comment's emoji (0111): `to` null takes the viewer's away. */
  const reactToComment = useCallback(
    async (comment: FeedComment, to: CommentEmoji | null) => {
      const from = comment.myReaction;
      if (from === to) return;
      const patch = (mine: CommentEmoji | null, was: CommentEmoji | null) =>
        update(comment.postId, (p) => ({
          ...p,
          comments: p.comments.map((c) =>
            c.id === comment.id
              ? {
                  ...c,
                  myReaction: mine,
                  likedByMe: mine !== null,
                  likeCount: Math.max(0, c.likeCount + (mine && !was ? 1 : !mine && was ? -1 : 0)),
                  emojiCounts: applyCommentReaction(c.emojiCounts, was, mine),
                }
              : c
          ),
        }));
      patch(to, from);
      try {
        const { data } = await supabase.auth.getSession();
        const userId = data.session?.user?.id;
        if (!userId) throw new Error("Please sign in again.");
        const result = await setCommentReaction(comment.id, userId, to, from);
        // It had a reaction already (another phone): it was changed, not
        // added, so take back the +1 the screen showed.
        if (result === "already")
          update(comment.postId, (p) => ({
            ...p,
            comments: p.comments.map((c) => (c.id === comment.id ? { ...c, likeCount: Math.max(0, c.likeCount - 1) } : c)),
          }));
      } catch (err) {
        patch(from, to);
        Alert.alert("Couldn't save that", err instanceof Error ? err.message : "Please try again.");
      }
    },
    [update]
  );

  /** "Like": a heart, or off if the viewer has any reaction on it. */
  const likeComment = useCallback(
    (comment: FeedComment) => reactToComment(comment, comment.myReaction ? null : HEART),
    [reactToComment]
  );

  return { like, react, save, share, menu, commentOptions, likeComment, reactToComment };
}
