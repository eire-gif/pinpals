import { useRef, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Animated,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { STARS_GOLD } from "@/components/stars";
import type { FeedAuthor, FeedClub, FeedComment, FeedPhoto, FeedPost } from "@/lib/feed";
import { POST_VISIBILITY_SHORT, ago, handicapLabel, photoHeight } from "@/lib/feed-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

const LONG_POST = 280;
/** A caption with no photo is the post, so it is set larger. */
const LONG_TEXT_ONLY = 420;

/**
 * One post. Used by the Feed tab, a member's page and the post screen.
 *
 * Every action is handed up rather than performed here, so the screen that
 * owns the list owns the state: a like flips in the list, a deleted post
 * leaves the list, and the card never has to guess which screen it is on.
 *
 * LAYOUT (Oct 2026 feed polish). Read top to bottom the way a golfer tells
 * the story of a round:
 *
 *   who      — face, name, handicap (only if they share it), home club, when
 *   where    — the course, in Playfair, tappable through to its page
 *   the view — photos edge to edge, swiped rather than gridded
 *   reaction — like and comment with their counts, then the caption
 *   talk     — the latest two comments, compact
 *
 * A post with no photos keeps its caption above the course, set larger,
 * because there the words are the post.
 *
 * Nothing here needs a native module, so every change to this file ships
 * as an over-the-air update rather than a TestFlight build.
 */
export function PostCard({
  post,
  width,
  standalone = false,
  onLike,
  onComment,
  onMenu,
  onCommentOptions,
  onReply,
  currentMemberId,
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
  /** Reply to one comment. Without it (the feed list), Reply opens the post
   *  with the reply box ready. */
  onReply?: (comment: FeedComment) => void;
  /** Set on a member's own page: tapping that member's name does nothing
   *  there, rather than stacking a second copy of the page you're on. */
  currentMemberId?: string;
}) {
  const hasPhotos = post.photos.length > 0;
  const limit = hasPhotos ? LONG_POST : LONG_TEXT_ONLY;
  const [expanded, setExpanded] = useState(standalone || post.body.length <= limit);
  const [viewer, setViewer] = useState<number | null>(null);

  const shownComments = post.comments;
  const more = Math.max(0, post.commentCount - shownComments.filter((c) => !c.hidden).length);

  const openMember = (id: string) => {
    if (id === currentMemberId) return;
    router.push({ pathname: "/member/[id]", params: { id } });
  };
  const openPost = () => router.push({ pathname: "/post/[id]", params: { id: String(post.id) } });

  const caption = post.body ? (
    <Text style={[styles.body, !hasPhotos && styles.bodyLarge]}>
      {expanded ? post.body : `${post.body.slice(0, limit).trimEnd()}… `}
      {!expanded && (
        <Text style={styles.more} onPress={() => setExpanded(true)} suppressHighlighting>
          more
        </Text>
      )}
    </Text>
  ) : null;

  return (
    <View style={styles.card}>
      {post.hidden && (
        <Text style={styles.hiddenBanner}>Only you can see this post — it has been hidden by PinPals.</Text>
      )}

      <AuthorHeader
        author={post.author}
        createdAt={post.createdAt}
        visibility={post.visibility}
        onAuthor={() => openMember(post.author.id)}
        onMenu={() => onMenu(post)}
      />

      {!hasPhotos && caption}

      {post.club && <CourseLine club={post.club} />}

      {hasPhotos && <Photos photos={post.photos} width={width} onOpen={setViewer} />}

      <View style={styles.actions}>
        <LikeButton post={post} onPress={() => onLike(post)} />
        <Pressable
          onPress={() => onComment(post)}
          style={styles.action}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={
            post.commentCount > 0
              ? `Comment. ${post.commentCount} ${post.commentCount === 1 ? "comment" : "comments"}`
              : "Comment"
          }
        >
          <Ionicons name="chatbubble-outline" size={22} color={colors.ink900} />
          {post.commentCount > 0 && <Text style={styles.actionCount}>{post.commentCount}</Text>}
        </Pressable>
      </View>

      {hasPhotos && caption}

      {!standalone && more > 0 && (
        <Pressable onPress={openPost} style={styles.viewAll} accessibilityRole="link">
          <Text style={styles.viewAllText}>
            View all {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
          </Text>
        </Pressable>
      )}

      {shownComments.length > 0 && (
        <View style={[styles.comments, standalone && styles.commentsStandalone]}>
          {shownComments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              compact={!standalone}
              onAuthor={() => openMember(c.author.id)}
              onLongPress={onCommentOptions && (() => onCommentOptions(c))}
              onReply={() =>
                onReply
                  ? onReply(c)
                  : router.push({
                      pathname: "/post/[id]",
                      params: { id: String(post.id), focus: "comment", reply: String(c.id), replyName: c.author.name },
                    })
              }
            />
          ))}
        </View>
      )}

      <View style={styles.foot} />

      <PhotoViewer photos={post.photos} index={viewer} onClose={() => setViewer(null)} />
    </View>
  );
}

/** The photo width for a card laid in a list with `spacing.md` either side.
 *  The card's border is a hairline, so subtract exactly that, or the photos
 *  stop a sliver short of the card's right edge. */
export function postCardWidth(screenWidth: number): number {
  return screenWidth - spacing.md * 2 - StyleSheet.hairlineWidth * 2;
}

function AuthorHeader({
  author,
  createdAt,
  visibility,
  onAuthor,
  onMenu,
}: {
  author: FeedAuthor;
  createdAt: string;
  visibility: FeedPost["visibility"];
  onAuthor: () => void;
  onMenu: () => void;
}) {
  const audience = POST_VISIBILITY_SHORT[visibility];
  return (
    <View style={styles.header}>
      <Pressable onPress={onAuthor} accessibilityRole="link" accessibilityLabel={author.name}>
        <View style={styles.avatarRing}>
          <Avatar url={author.avatarUrl} color={author.avatarColor} name={author.name} size={42} />
        </View>
      </Pressable>
      <View style={styles.headerText}>
        <View style={styles.nameRow}>
          <Text style={styles.name} onPress={onAuthor} numberOfLines={1}>
            {author.name}
          </Text>
          {author.handicap !== null && (
            <View style={styles.hcp} accessibilityLabel={`Handicap ${author.handicap}`}>
              <Text style={styles.hcpText}>{handicapLabel(author.handicap)}</Text>
            </View>
          )}
        </View>
        <View style={styles.metaRow}>
          {author.homeClub ? (
            <>
              <Text style={styles.meta} numberOfLines={1} ellipsizeMode="tail">
                {author.homeClub}
              </Text>
              <Text style={styles.metaDot}>·</Text>
            </>
          ) : null}
          <Text style={styles.metaFixed}>{ago(createdAt)}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Ionicons
            name={visibility === "connections" ? "people" : "earth"}
            size={12}
            color={colors.ink500}
            accessibilityLabel={`Shared with ${audience}`}
          />
        </View>
      </View>
      <Pressable onPress={onMenu} hitSlop={12} style={styles.menu} accessibilityRole="button" accessibilityLabel="Post options">
        <Ionicons name="ellipsis-horizontal" size={20} color={colors.ink500} />
      </Pressable>
    </View>
  );
}

/** Where it was played: a band between the golfer and the photos, like the
 *  heading on a scorecard. Opens the course's own page. */
function CourseLine({ club }: { club: FeedClub }) {
  const rated = club.ratingCount > 0 && club.ratingAvg !== null;
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/course/[id]", params: { id: String(club.id) } })}
      style={({ pressed }) => [styles.course, pressed && styles.coursePressed]}
      accessibilityRole="link"
      accessibilityLabel={`Played at ${club.name}${club.place ? `, ${club.place}` : ""}. Open course`}
    >
      <View style={styles.courseFlag}>
        <Ionicons name="flag" size={14} color={colors.cream50} />
      </View>
      <View style={styles.courseText}>
        <Text style={styles.courseName} numberOfLines={1}>
          {club.name}
        </Text>
        {(club.place || rated) && (
          <View style={styles.coursePlaceRow}>
            {club.place ? (
              <Text style={styles.coursePlace} numberOfLines={1}>
                {club.place}
              </Text>
            ) : null}
            {rated && (
              <>
                {club.place ? <Text style={styles.metaDot}>·</Text> : null}
                <Ionicons name="star" size={11} color={STARS_GOLD} />
                <Text style={styles.courseRating}>{club.ratingAvg!.toFixed(1)}</Text>
              </>
            )}
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.ink500} />
    </Pressable>
  );
}

/** The heart, with a small bounce when it fills. Animated on the native
 *  driver, so it costs the JS thread nothing mid-scroll. */
function LikeButton({ post, onPress }: { post: FeedPost; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const press = () => {
    if (!post.likedByMe) {
      scale.setValue(0.7);
      Animated.spring(scale, { toValue: 1, friction: 3, tension: 160, useNativeDriver: true }).start();
    }
    onPress();
  };
  return (
    <Pressable
      onPress={press}
      style={styles.action}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={{ selected: post.likedByMe }}
      accessibilityLabel={`${post.likedByMe ? "Unlike" : "Like"}${
        post.likeCount > 0 ? `. ${post.likeCount} ${post.likeCount === 1 ? "like" : "likes"}` : ""
      }`}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons
          name={post.likedByMe ? "heart" : "heart-outline"}
          size={24}
          color={post.likedByMe ? colors.red600 : colors.ink900}
        />
      </Animated.View>
      {post.likeCount > 0 && (
        <Text style={[styles.actionCount, post.likedByMe && styles.actionCountLiked]}>{post.likeCount}</Text>
      )}
    </Pressable>
  );
}

function CommentRow({
  comment,
  compact,
  onAuthor,
  onLongPress,
  onReply,
}: {
  comment: FeedComment;
  /** The feed's preview: one line of name-and-text, no bubble. The post
   *  screen keeps the bubble, where a thread is read rather than glanced at. */
  compact: boolean;
  onAuthor: () => void;
  onLongPress?: () => void;
  onReply: () => void;
}) {
  const meta = (
    <View style={[styles.commentMetaRow, compact && styles.commentMetaRowCompact]}>
      <Text style={styles.commentMeta}>{ago(comment.createdAt)}</Text>
      {comment.hidden ? null : (
        <Text
          style={styles.replyLink}
          onPress={onReply}
          accessibilityRole="button"
          accessibilityLabel={`Reply to ${comment.author.name}`}
          suppressHighlighting
        >
          Reply
        </Text>
      )}
    </View>
  );

  if (compact) {
    return (
      <Pressable
        onLongPress={onLongPress}
        style={[styles.comment, comment.depth === 1 && styles.replyCompact]}
        accessibilityHint={onLongPress ? "Long-press for options" : undefined}
      >
        <Pressable onPress={onAuthor} style={styles.commentAvatar}>
          <Avatar url={comment.author.avatarUrl} color={comment.author.avatarColor} name={comment.author.name} size={24} />
        </Pressable>
        <View style={styles.commentBody}>
          <Text style={styles.commentText} numberOfLines={3}>
            <Text style={styles.commentName} onPress={onAuthor}>
              {comment.author.name}
            </Text>{" "}
            {comment.body}
          </Text>
          {comment.hidden && <Text style={styles.hiddenNote}>Hidden by PinPals — only you can see this.</Text>}
          {meta}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onLongPress={onLongPress}
      style={[styles.comment, comment.depth === 1 && styles.reply]}
      accessibilityHint={onLongPress ? "Long-press for options" : undefined}
    >
      <Pressable onPress={onAuthor}>
        <Avatar url={comment.author.avatarUrl} color={comment.author.avatarColor} name={comment.author.name} size={30} />
      </Pressable>
      <View style={styles.commentBody}>
        <View style={[styles.bubble, comment.hidden && styles.bubbleHidden]}>
          <Text style={styles.commentName} onPress={onAuthor}>
            {comment.author.name}
          </Text>
          <Text style={styles.commentText}>{comment.body}</Text>
          {comment.hidden && <Text style={styles.hiddenNote}>Hidden by PinPals — only you can see this.</Text>}
        </View>
        {meta}
      </View>
    </Pressable>
  );
}

/**
 * Photos edge to edge. One at its own shape (within limits); two or more
 * swiped, all at the first photo's height so the card doesn't jump as you
 * go, with a counter and dots. Courses are landscapes, and a 2×2 grid of
 * thumbnails turned every one of them into a postage stamp.
 */
function Photos({ photos, width, onOpen }: { photos: FeedPhoto[]; width: number; onOpen: (i: number) => void }) {
  const [page, setPage] = useState(0);
  const height = photoHeight(width, photos[0]);

  if (photos.length === 1) {
    return (
      <Pressable onPress={() => onOpen(0)} accessibilityRole="imagebutton" accessibilityLabel="Open photo">
        <PhotoImage photo={photos[0]} style={{ width, height }} />
      </Pressable>
    );
  }

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== page) setPage(Math.max(0, Math.min(photos.length - 1, next)));
  };

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        style={{ width, height }}
        // Inside a vertical list: let a mostly-vertical drag scroll the feed.
        directionalLockEnabled
      >
        {photos.map((p, i) => (
          <Pressable
            key={p.path}
            onPress={() => onOpen(i)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Open photo ${i + 1} of ${photos.length}`}
          >
            <PhotoImage photo={p} style={{ width, height }} />
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.counter} pointerEvents="none">
        <Text style={styles.counterText}>
          {page + 1}/{photos.length}
        </Text>
      </View>
      <View style={styles.dots} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        {photos.map((p, i) => (
          <View key={p.path} style={[styles.dot, i === page && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

function PhotoImage({ photo, style }: { photo: FeedPhoto; style: { width: number; height: number } }) {
  if (!photo.url) return <View style={[style, styles.photoMissing]} />;
  return <Image source={{ uri: photo.url }} style={[style, styles.photo]} resizeMode="cover" accessibilityIgnoresInvertColors />;
}

function PhotoViewer({ photos, index, onClose }: { photos: FeedPhoto[]; index: number | null; onClose: () => void }) {
  const { width, height } = Dimensions.get("window");
  const [page, setPage] = useState(0);
  return (
    <Modal
      visible={index !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => setPage(index ?? 0)}
    >
      <View style={styles.viewer}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: (index ?? 0) * width, y: 0 }}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        >
          {photos.map((p) =>
            p.url ? (
              <Image key={p.path} source={{ uri: p.url }} style={{ width, height }} resizeMode="contain" />
            ) : (
              <View key={p.path} style={{ width, height }} />
            )
          )}
        </ScrollView>
        {photos.length > 1 && (
          <Text style={styles.viewerCount} pointerEvents="none">
            {page + 1} of {photos.length}
          </Text>
        )}
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    // A lift rather than a box: the card sits on cream, and a 1pt border on
    // every side of every post read as a form, not a feed.
    shadowColor: colors.navy900,
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  hiddenBanner: {
    backgroundColor: colors.cream100,
    color: colors.ink900,
    fontFamily: fonts.bodySemi,
    fontSize: 12.5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    overflow: "hidden",
  },

  // Who
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md - 2,
    paddingBottom: spacing.sm + 4,
  },
  avatarRing: {
    padding: 2,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.gold400,
  },
  headerText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm - 2 },
  name: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.ink900 },
  hcp: {
    backgroundColor: colors.green100,
    borderRadius: radii.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  hcpText: { fontFamily: fonts.bodySemi, fontSize: 11, letterSpacing: 0.3, color: colors.green800 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  meta: { flexShrink: 1, fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  metaFixed: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  metaDot: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  menu: { padding: spacing.xs, alignSelf: "flex-start", marginTop: 2 },

  // Where
  course: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.surfaceTint,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  coursePressed: { backgroundColor: colors.cream100 },
  courseFlag: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  courseText: { flex: 1, minWidth: 0 },
  courseName: { fontFamily: fonts.display, fontSize: 16, color: colors.ink900 },
  coursePlaceRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  coursePlace: { flexShrink: 1, fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  courseRating: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink900 },

  // The view
  photo: { backgroundColor: colors.cream100 },
  photoMissing: { backgroundColor: colors.cream100 },
  counter: {
    position: "absolute",
    top: spacing.sm + 2,
    right: spacing.sm + 2,
    backgroundColor: "rgba(12,32,56,0.62)",
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  counterText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.cream50, letterSpacing: 0.4 },
  dots: {
    position: "absolute",
    bottom: spacing.sm + 2,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(247,243,234,0.55)" },
  dotActive: { backgroundColor: colors.cream50, width: 16 },

  // Reaction
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.sm,
  },
  actionCount: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: colors.ink900 },
  actionCountLiked: { color: colors.red600 },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink900,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  bodyLarge: { fontSize: 17, lineHeight: 25, paddingTop: 0, paddingBottom: spacing.md - 2 },
  more: { fontFamily: fonts.bodySemi, color: colors.ink500 },

  // Talk
  viewAll: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, minHeight: 28, justifyContent: "center" },
  viewAllText: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  comments: { paddingHorizontal: spacing.md, gap: spacing.sm + 2 },
  commentsStandalone: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  comment: { flexDirection: "row", gap: spacing.sm },
  commentAvatar: { paddingTop: 1 },
  // One level of replies (0092), tucked under the comment they answer.
  reply: { marginLeft: 38 },
  replyCompact: { marginLeft: 32 },
  commentBody: { flex: 1, minWidth: 0 },
  bubble: {
    backgroundColor: colors.surfaceTint,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
  },
  bubbleHidden: { backgroundColor: colors.cream100 },
  commentName: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  commentText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink900 },
  hiddenNote: { fontFamily: fonts.body, fontSize: 11.5, color: colors.ink500, marginTop: 4 },
  commentMetaRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: 3, marginLeft: spacing.sm + 4 },
  commentMetaRowCompact: { marginLeft: 0, marginTop: 2 },
  commentMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  replyLink: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink500, paddingVertical: 2 },
  foot: { height: spacing.md - 2 },

  viewer: { flex: 1, backgroundColor: "rgba(12,32,56,0.97)" },
  viewerClose: { position: "absolute", top: 56, right: spacing.md, padding: spacing.xs },
  viewerCount: {
    position: "absolute",
    top: 62,
    alignSelf: "center",
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.cream50,
  },
});
