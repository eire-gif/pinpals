import { useCallback } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";

import { askReportReason, showPostMenu } from "@/components/post-card";
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
}) {
  const { update, remove, reload } = handlers;

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
      });
    },
    [update, remove]
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

  return { like, menu, removeComment, reportComment };
}
