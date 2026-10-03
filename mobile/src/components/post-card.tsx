import { useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import type { FeedComment, FeedPhoto, FeedPost } from "@/lib/feed";
import { POST_VISIBILITY_SHORT, ago, commentLine, likeLine, photoHeight } from "@/lib/feed-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

const LONG_POST = 280;

/**
 * One post. Used by the Feed tab, a member's page and the post screen.
 *
 * Every action is handed up rather than performed here, so the screen that
 * owns the list owns the state: a like flips in the list, a deleted post
 * leaves the list, and the card never has to guess which screen it is on.
 */
export function PostCard({
  post,
  width,
  standalone = false,
  onLike,
  onComment,
  onMenu,
  onCommentOptions,
}: {
  post: FeedPost;
  /** The card's content width, for sizing photos. */
  width: number;
  standalone?: boolean;
  onLike: (post: FeedPost) => void;
  /** Open the post (or focus its comment box when already open). */
  onComment: (post: FeedPost) => void;
  onMenu: (post: FeedPost) => void;
  /** Long-press on a comment: delete, report or block, whichever apply. */
  onCommentOptions?: (comment: FeedComment) => void;
}) {
  const [expanded, setExpanded] = useState(standalone || post.body.length <= LONG_POST);
  const [viewer, setViewer] = useState<number | null>(null);

  const likes = likeLine(post.likeCount, post.likedByMe);
  const comments = commentLine(post.commentCount);
  const shownComments = post.comments;
  const more = Math.max(0, post.commentCount - shownComments.filter((c) => !c.hidden).length);

  const openMember = (id: string) => router.push({ pathname: "/member/[id]", params: { id } });
  const openPost = () => router.push({ pathname: "/post/[id]", params: { id: String(post.id) } });

  return (
    <View style={styles.card}>
      {post.hidden && (
        <Text style={styles.hiddenBanner}>Only you can see this post — it has been hidden by PinPals.</Text>
      )}

      <View style={styles.header}>
        <Pressable onPress={() => openMember(post.author.id)} accessibilityRole="link" accessibilityLabel={post.author.name}>
          <Avatar url={post.author.avatarUrl} color={post.author.avatarColor} name={post.author.name} size={42} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.name} onPress={() => openMember(post.author.id)} numberOfLines={1}>
            {post.author.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {post.club ? (
              <Text style={styles.club}>
                <Ionicons name="flag" size={11} color={colors.green700} /> {post.club.name} ·{" "}
              </Text>
            ) : null}
            {ago(post.createdAt)} · {POST_VISIBILITY_SHORT[post.visibility]}
          </Text>
        </View>
        <Pressable
          onPress={() => onMenu(post)}
          hitSlop={12}
          style={styles.menu}
          accessibilityRole="button"
          accessibilityLabel="Post options"
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.ink500} />
        </Pressable>
      </View>

      {post.body ? (
        <Text style={styles.body}>
          {expanded ? post.body : `${post.body.slice(0, LONG_POST).trimEnd()}… `}
          {!expanded && (
            <Text style={styles.more} onPress={() => setExpanded(true)}>
              See more
            </Text>
          )}
        </Text>
      ) : null}

      {post.photos.length > 0 && <Photos photos={post.photos} width={width} onOpen={setViewer} />}

      {(likes || comments) && (
        <View style={styles.counts}>
          <Text style={styles.countText}>{likes ?? ""}</Text>
          {comments ? (
            <Text style={styles.countText} onPress={standalone ? undefined : openPost}>
              {comments}
            </Text>
          ) : null}
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={() => onLike(post)}
          style={styles.action}
          accessibilityRole="button"
          accessibilityState={{ selected: post.likedByMe }}
          accessibilityLabel={post.likedByMe ? "Unlike" : "Like"}
        >
          <Ionicons
            name={post.likedByMe ? "heart" : "heart-outline"}
            size={22}
            color={post.likedByMe ? colors.red600 : colors.ink500}
          />
          <Text style={[styles.actionLabel, post.likedByMe && { color: colors.red600 }]}>
            {post.likedByMe ? "Liked" : "Like"}
          </Text>
        </Pressable>
        <Pressable onPress={() => onComment(post)} style={styles.action} accessibilityRole="button">
          <Ionicons name="chatbubble-outline" size={20} color={colors.ink500} />
          <Text style={styles.actionLabel}>Comment</Text>
        </Pressable>
      </View>

      {!standalone && more > 0 && (
        <Pressable onPress={openPost} style={styles.viewAll}>
          <Text style={styles.viewAllText}>View all {post.commentCount} comments</Text>
        </Pressable>
      )}

      {shownComments.length > 0 && (
        <View style={styles.comments}>
          {shownComments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              onAuthor={() => openMember(c.author.id)}
              onLongPress={onCommentOptions && (() => onCommentOptions(c))}
            />
          ))}
        </View>
      )}

      <PhotoViewer photos={post.photos} index={viewer} onClose={() => setViewer(null)} />
    </View>
  );
}

function CommentRow({
  comment,
  onAuthor,
  onLongPress,
}: {
  comment: FeedComment;
  onAuthor: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onLongPress={onLongPress}
      style={styles.comment}
      accessibilityHint={onLongPress ? "Long-press for options" : undefined}
    >
      <Pressable onPress={onAuthor}>
        <Avatar url={comment.author.avatarUrl} color={comment.author.avatarColor} name={comment.author.name} size={28} />
      </Pressable>
      <View style={styles.commentBody}>
        <View style={[styles.bubble, comment.hidden && styles.bubbleHidden]}>
          <Text style={styles.commentName} onPress={onAuthor}>
            {comment.author.name}
          </Text>
          <Text style={styles.commentText}>{comment.body}</Text>
          {comment.hidden && <Text style={styles.hiddenNote}>Hidden by PinPals — only you can see this.</Text>}
        </View>
        <Text style={styles.commentMeta}>{ago(comment.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

/** One photo at its own shape (within limits); two or more as a grid of
 *  squares, at most four, with "+N" on the last. */
function Photos({ photos, width, onOpen }: { photos: FeedPhoto[]; width: number; onOpen: (i: number) => void }) {
  if (photos.length === 1) {
    const p = photos[0];
    return (
      <Pressable onPress={() => onOpen(0)} accessibilityRole="imagebutton" accessibilityLabel="Open photo">
        <PhotoImage photo={p} style={{ width, height: photoHeight(width, p) }} />
      </Pressable>
    );
  }

  const tiles = photos.slice(0, 4);
  const extra = photos.length - tiles.length;
  const gap = 2;
  const size = (width - gap) / 2;

  return (
    <View style={[styles.grid, { width, gap }]}>
      {tiles.map((p, i) => (
        <Pressable
          key={p.path}
          onPress={() => onOpen(i)}
          accessibilityRole="imagebutton"
          accessibilityLabel={`Open photo ${i + 1} of ${photos.length}`}
        >
          <PhotoImage photo={p} style={{ width: photos.length === 3 && i === 0 ? width : size, height: size }} />
          {extra > 0 && i === tiles.length - 1 && (
            <View style={styles.extra}>
              <Text style={styles.extraText}>+{extra}</Text>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

function PhotoImage({ photo, style }: { photo: FeedPhoto; style: { width: number; height: number } }) {
  if (!photo.url) return <View style={[style, styles.photoMissing]} />;
  return <Image source={{ uri: photo.url }} style={[style, styles.photo]} resizeMode="cover" accessibilityIgnoresInvertColors />;
}

function PhotoViewer({ photos, index, onClose }: { photos: FeedPhoto[]; index: number | null; onClose: () => void }) {
  const { width, height } = Dimensions.get("window");
  return (
    <Modal visible={index !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.viewer}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: (index ?? 0) * width, y: 0 }}
        >
          {photos.map((p) =>
            p.url ? (
              <Image key={p.path} source={{ uri: p.url }} style={{ width, height }} resizeMode="contain" />
            ) : (
              <View key={p.path} style={{ width, height }} />
            )
          )}
        </ScrollView>
        <Pressable onPress={onClose} style={styles.viewerClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={28} color={colors.cream50} />
        </Pressable>
      </View>
    </Modal>
  );
}

/**
 * The options for a post, as the platform's own action sheet. Shared by
 * every screen that shows posts so they all offer the same things.
 */
export function showPostMenu(
  post: FeedPost,
  handlers: { onDelete: () => void; onAudience: () => void; onReport: () => void; onProfile: () => void; onBlock: () => void }
) {
  const first = post.author.name.split(" ")[0];
  const items: { label: string; destructive?: boolean; run: () => void }[] = post.isMine
    ? [
        { label: post.visibility === "members" ? "Show to connections only" : "Show to all members", run: handlers.onAudience },
        { label: "Delete post", destructive: true, run: handlers.onDelete },
      ]
    : [
        { label: `View ${first}'s profile`, run: handlers.onProfile },
        { label: "Report post", run: handlers.onReport },
        // Apple guideline 1.2: a member must be able to block someone from
        // the content itself, not only from a conversation.
        { label: `Block ${first}`, destructive: true, run: handlers.onBlock },
      ];
  showSheet("Post", items);
}

/** The platform's own options sheet: an action sheet on iOS, an alert with
 *  buttons on Android. Shared by the post and comment menus. */
export function showSheet(title: string, items: { label: string; destructive?: boolean; run: () => void }[]) {
  if (Platform.OS === "ios") {
    const destructive = items.findIndex((item) => item.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...items.map((item) => item.label), "Cancel"],
        cancelButtonIndex: items.length,
        destructiveButtonIndex: destructive >= 0 ? destructive : undefined,
      },
      (i) => {
        if (i < items.length) items[i].run();
      }
    );
  } else {
    Alert.alert(title, undefined, [
      ...items.map((item) => ({
        text: item.label,
        style: (item.destructive ? "destructive" : "default") as "destructive" | "default",
        onPress: item.run,
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }
}

/** The report reasons, as a sheet, for a post or a comment. */
export function askReportReason(onPick: (category: string) => void) {
  const reasons = [
    ["inappropriate_content", "Inappropriate content"],
    ["harassment", "Harassment or bullying"],
    ["spam", "Spam"],
    ["scam_fraud", "Scam or fraud"],
    ["other", "Something else"],
  ] as const;
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: "Why are you reporting this?", options: [...reasons.map((r) => r[1]), "Cancel"], cancelButtonIndex: reasons.length },
      (i) => {
        if (i < reasons.length) onPick(reasons[i][0]);
      }
    );
  } else {
    Alert.alert(
      "Why are you reporting this?",
      undefined,
      [...reasons.map(([value, label]) => ({ text: label, onPress: () => onPick(value) })), { text: "Cancel", style: "cancel" as const }]
    );
  }
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  hiddenBanner: {
    backgroundColor: colors.cream100,
    color: colors.ink900,
    fontFamily: fonts.bodySemi,
    fontSize: 12.5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  headerText: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, marginTop: 1 },
  club: { fontFamily: fonts.bodySemi, color: colors.green700 },
  menu: { padding: spacing.xs },
  body: {
    fontFamily: fonts.body,
    fontSize: 15.5,
    lineHeight: 22,
    color: colors.ink900,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.sm + 2,
  },
  more: { fontFamily: fonts.bodySemi, color: colors.ink500 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  photo: { backgroundColor: colors.cream100 },
  photoMissing: { backgroundColor: colors.cream100 },
  extra: {
    position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: "rgba(12,32,56,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  extraText: { fontFamily: fonts.display, fontSize: 30, color: colors.cream50 },
  counts: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
  },
  countText: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  actions: {
    flexDirection: "row",
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  action: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.sm + 4,
    minHeight: 44,
  },
  actionLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink500 },
  viewAll: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  viewAllText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500 },
  comments: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm + 2 },
  comment: { flexDirection: "row", gap: spacing.sm },
  commentBody: { flex: 1, minWidth: 0 },
  bubble: {
    backgroundColor: colors.surfaceTint,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
  },
  bubbleHidden: { backgroundColor: colors.cream100 },
  commentName: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.ink900 },
  commentText: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 20, color: colors.ink900 },
  hiddenNote: { fontFamily: fonts.body, fontSize: 11.5, color: colors.ink500, marginTop: 4 },
  commentMeta: { fontFamily: fonts.body, fontSize: 11.5, color: colors.ink500, marginTop: 3, marginLeft: spacing.sm + 4 },
  viewer: { flex: 1, backgroundColor: "rgba(12,32,56,0.97)" },
  viewerClose: { position: "absolute", top: 56, right: spacing.md, padding: spacing.xs },
});
