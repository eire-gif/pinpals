import { useCallback } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";

import { askReportReason, showPostMenu, showSheet } from "@/components/post-card";
import { blockConfirmText, blockMember } from "./blocking";
import { changeAudience, deleteComment, deletePost, report, setLike, type FeedComment, type FeedPost } from "./feed";

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

  const like = useCallback(
    async (post: FeedPost) => {
      const next = !post.likedByMe;
      // Optimistic: a heart that waits for a round trip feels broken, and
      // the worst case is a heart that flips back with a message.
      update(post.id, (p) => ({ ...p, likedByMe: next, likeCount: Math.max(0, p.likeCount + (next ? 1 : -1)) }));
      try {
        const result = await setLike(post.id, next);
        update(post.id, (p) => ({ ...p, likedByMe: result.liked, likeCount: result.likeCount }));
      } catch (err) {
        update(post.id, (p) => ({ ...p, likedByMe: !next, likeCount: Math.max(0, p.likeCount + (next ? -1 : 1)) }));
        Alert.alert("Couldn't save that", err instanceof Error ? err.message : "Please try again.");
      }
    },
    [update]
  );

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

  /** Long-press on a comment. Your own: delete. Someone else's on your
   *  post: delete, report or block. Someone else's elsewhere: report or
   *  block. */
  const commentOptions = useCallback(
    (comment: FeedComment) => {
      const first = comment.author.name.split(" ")[0];
      const items: { label: string; destructive?: boolean; run: () => void }[] = [];
      if (comment.canDelete) items.push({ label: "Delete comment", run: () => removeComment(comment) });
      if (!comment.isMine) {
        items.push({ label: "Report comment", run: () => reportComment(comment) });
        items.push({ label: `Block ${first}`, destructive: true, run: () => block(comment.author.id, comment.author.name) });
      }
      // Your own comment has one option; go straight to its confirm.
      if (comment.isMine) {
        removeComment(comment);
        return;
      }
      showSheet("Comment", items);
    },
    [removeComment, reportComment, block]
  );

  return { like, menu, commentOptions };
}
