import { useRef, useState, type ComponentProps } from "react";
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

import { AchievementCard } from "@/components/achievement-card";
import { Avatar } from "@/components/avatar";
import { coursePhoto } from "@/components/course-photos";
import { ReactionDisc, ReactionPicker, ReactionStack } from "@/components/reactions";
import { achievementOf } from "@/lib/achievements";
import type { FeedAuthor, FeedClub, FeedComment, FeedPhoto, FeedPost } from "@/lib/feed";
import { POST_VISIBILITY_SHORT, ago, handicapLabel, photoHeight, previewComments } from "@/lib/feed-rules";
import { mentionSegments } from "@/lib/mentions";
import { detailChips } from "@/lib/post-details";
import { REACTION_INFO, topReactions, type ReactionKey } from "@/lib/reactions";
import { colors, creamAlpha, fonts, navyAlpha, radii, spacing, type } from "@/lib/theme";

const LONG_POST = 280;
/** A caption with no photo is the post, so it is set larger. */
const LONG_TEXT_ONLY = 420;
/** Media sits inset in the card, this far from each edge. */
const MEDIA_INSET = 12;

/**
 * One post. Used by the Feed tab, a member's page and the post screen.
 *
 * Every action is handed up rather than performed here, so the screen that
 * owns the list owns the state: a like flips in the list, a deleted post
 * leaves the list, and the card never has to guess which screen it is on.
 *
 * HIERARCHY (Oct 2026 feed redesign, phase 1), top to bottom:
 *
 *   1. header   — face, name, handicap (if shared), course or home club,
 *                 time, audience, options
 *   2. text
 *   3. media    — inset, rounded, never taller than 4:5; tap for full size
 *   4. golf     — a round, hole or shot's facts as chips (post-details.ts)
 *   5. proof    — the top reactions as discs, the total, comment count
 *   6. actions  — React · Comment · Share · Save, 44pt each. React: tap
 *                 for Great Shot (or to take yours away), long-press to
 *                 choose (phase 4, components/reactions.tsx)
 *   7. comments — at most two, flat, then "View all N comments"; every way
 *                 into the conversation opens the Comments sheet (phase 5).
 *                 On the post screen (standalone) the card shows no thread:
 *                 the screen draws the full one under it
 *
 * Separators are hairlines and whitespace rather than boxes. Nothing here
 * needs a native module, so changes to this file ship over the air.
 */
export function PostCard({
  post,
  width,
  standalone = false,
  onLike,
  onReact,
  onComment,
  onShare,
  onSave,
  onMenu,
  onCommentOptions,
  currentMemberId,
}: {
  post: FeedPost;
  /** The card's content width (see postCardWidth). */
  width: number;
  standalone?: boolean;
  /** Tap on React: the default reaction, or off. */
  onLike: (post: FeedPost) => void;
  /** A reaction chosen in the picker, or null to take it away. */
  onReact: (post: FeedPost, reaction: ReactionKey | null) => void;
  /** Open the post (or focus its comment box when already open). */
  onComment: (post: FeedPost) => void;
  onShare: (post: FeedPost) => void;
  onSave: (post: FeedPost) => void;
  onMenu: (post: FeedPost) => void;
  /** Long-press on a preview comment: edit, delete, report or block. */
  onCommentOptions?: (comment: FeedComment) => void;
  /** Set on a member's own page: tapping that member's name does nothing
   *  there, rather than stacking a second copy of the page you're on. */
  currentMemberId?: string;
}) {
  const hasPhotos = post.photos.length > 0;
  const limit = hasPhotos ? LONG_POST : LONG_TEXT_ONLY;
  const [expanded, setExpanded] = useState(standalone || post.body.length <= limit);
  const [viewer, setViewer] = useState<number | null>(null);
  const mediaWidth = width - MEDIA_INSET * 2;
  // Phase 8: an achievement post leads with its achievement card, in place
  // of the photo strip and the detail chips (the card carries the numbers;
  // tapping it opens the photos).
  const achievement = achievementOf({
    kind: post.kind,
    details: post.details,
    courseName: post.club?.name ?? null,
    createdAt: post.createdAt,
  });
  const chips = achievement ? [] : detailChips(post);

  // The feed shows two comments at most and never a thread; standalone (the
  // post screen) shows none here — the screen draws the full thread.
  const shownComments = standalone ? [] : previewComments(post.comments, 2);
  const more = post.commentCount > shownComments.filter((c) => !c.hidden).length;

  const openMember = (id: string) => {
    if (id === currentMemberId) return;
    router.push({ pathname: "/member/[id]", params: { id } });
  };
  const openComments = () => router.push({ pathname: "/comments/[id]", params: { id: String(post.id) } });

  return (
    <View style={styles.card}>
      {post.hidden && (
        <Text style={styles.hiddenBanner}>Only you can see this post — it has been hidden by PinPals.</Text>
      )}

      <AuthorHeader
        author={post.author}
        club={post.club}
        createdAt={post.createdAt}
        visibility={post.visibility}
        onAuthor={() => openMember(post.author.id)}
        onMenu={() => onMenu(post)}
      />

      {post.body ? (
        <Text style={[styles.body, !hasPhotos && styles.bodyLarge]}>
          {expanded ? post.body : `${post.body.slice(0, limit).trimEnd()}… `}
          {!expanded && (
            <Text style={styles.more} onPress={() => setExpanded(true)} suppressHighlighting>
              more
            </Text>
          )}
        </Text>
      ) : null}

      {achievement ? (
        <View style={styles.media}>
          <AchievementCard
            achievement={achievement}
            width={mediaWidth}
            photo={
              post.photos[0]?.url
                ? { uri: post.photos[0].url }
                : coursePhoto(post.club?.id ?? null, post.club?.name ?? null)
            }
            photoCount={post.photos.length}
            onPress={hasPhotos ? () => setViewer(0) : undefined}
          />
        </View>
      ) : hasPhotos && (
        <View style={styles.media}>
          <Photos photos={post.photos} width={mediaWidth} onOpen={setViewer} />
        </View>
      )}

      {chips.length > 0 && (
        <View style={styles.chips} accessibilityLabel={chips.join(", ")}>
          {chips.map((chip) => (
            <View key={chip} style={styles.chip}>
              <Text style={styles.chipText}>{chip}</Text>
            </View>
          ))}
        </View>
      )}

      {(post.likeCount > 0 || post.commentCount > 0) && (
        <View style={styles.proof}>
          {post.likeCount > 0 ? (
            <View
              style={styles.proofLeft}
              accessible
              accessibilityLabel={`${post.likeCount} ${post.likeCount === 1 ? "reaction" : "reactions"}: ${topReactions(post.reactionCounts)
                .map((r) => REACTION_INFO[r].label)
                .join(", ")}`}
            >
              <ReactionStack reactions={topReactions(post.reactionCounts)} />
              <Text style={styles.proofText}>{post.likeCount}</Text>
            </View>
          ) : (
            <View />
          )}
          {post.commentCount > 0 && (
            <Text
              style={styles.proofText}
              onPress={standalone ? undefined : openComments}
              accessibilityRole={standalone ? undefined : "link"}
              suppressHighlighting
            >
              {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
            </Text>
          )}
        </View>
      )}

      <View style={styles.actions}>
        <ReactButton post={post} onTap={() => onLike(post)} onReact={(r) => onReact(post, r)} />
        <ActionButton icon="chatbubble-outline" label="Comment" onPress={() => onComment(post)} />
        <ActionButton icon="arrow-redo-outline" label="Share" onPress={() => onShare(post)} />
        <ActionButton
          icon={post.savedByMe ? "bookmark" : "bookmark-outline"}
          label={post.savedByMe ? "Saved" : "Save"}
          active={post.savedByMe}
          activeColor={colors.green700}
          onPress={() => onSave(post)}
          accessibilityLabel={post.savedByMe ? "Remove from saved" : "Save post"}
        />
      </View>

      {!standalone && more && (
        <Pressable onPress={openComments} style={styles.viewAll} accessibilityRole="link">
          <Text style={styles.viewAllText}>
            View all {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
          </Text>
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
              onReply={() =>
                router.push({
                  pathname: "/comments/[id]",
                  params: { id: String(post.id), reply: String(c.id), replyName: c.author.name },
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
 *  stop a sliver short of where they should. */
export function postCardWidth(screenWidth: number): number {
  return screenWidth - spacing.md * 2 - StyleSheet.hairlineWidth * 2;
}

function AuthorHeader({
  author,
  club,
  createdAt,
  visibility,
  onAuthor,
  onMenu,
}: {
  author: FeedAuthor;
  club: FeedClub | null;
  createdAt: string;
  visibility: FeedPost["visibility"];
  onAuthor: () => void;
  onMenu: () => void;
}) {
  const audience = POST_VISIBILITY_SHORT[visibility];
  const openCourse = club
    ? () => router.push({ pathname: "/course/[id]", params: { id: String(club.id) } })
    : undefined;
  // Where the post was played, if it says; otherwise where they're a member.
  const where = club?.name ?? author.homeClub;
  return (
    <View style={styles.header}>
      <Pressable onPress={onAuthor} accessibilityRole="link" accessibilityLabel={author.name} hitSlop={4}>
        <Avatar url={author.avatarUrl} color={author.avatarColor} name={author.name} size={40} />
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
          {where ? (
            <>
              <Text
                style={[styles.meta, club && styles.metaCourse]}
                numberOfLines={1}
                onPress={openCourse}
                accessibilityRole={club ? "link" : undefined}
                accessibilityLabel={club ? `Played at ${club.name}. Open course` : undefined}
                suppressHighlighting
              >
                {where}
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

/**
 * React. Tap: Great Shot, or take your reaction away. Long-press (or the
 * VoiceOver action): the picker, anchored to this button. Shows your
 * reaction in its own colour once you have one.
 */
function ReactButton({
  post,
  onTap,
  onReact,
}: {
  post: FeedPost;
  onTap: () => void;
  onReact: (reaction: ReactionKey | null) => void;
}) {
  const ref = useRef<View>(null);
  const scale = useRef(new Animated.Value(1)).current;
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number } | null>(null);
  const [open, setOpen] = useState(false);
  const mine = post.myReaction;
  const info = mine ? REACTION_INFO[mine] : null;

  const pop = () => {
    scale.setValue(0.7);
    Animated.spring(scale, { toValue: 1, friction: 3, tension: 160, useNativeDriver: true }).start();
  };
  const openPicker = () => {
    ref.current?.measureInWindow((x, y, width) => {
      setAnchor({ x, y, width });
      setOpen(true);
    });
  };

  return (
    <>
      <Pressable
        ref={ref}
        onPress={() => {
          if (!mine) pop();
          onTap();
        }}
        onLongPress={openPicker}
        delayLongPress={280}
        style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        accessibilityRole="button"
        accessibilityState={mine ? { selected: true } : undefined}
        accessibilityLabel={info ? `Your reaction: ${info.label}. Tap to remove` : "React, Great Shot"}
        accessibilityHint="Long-press to choose a reaction"
        accessibilityActions={[{ name: "longpress", label: "Choose a reaction" }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "longpress") openPicker();
        }}
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          {mine ? (
            <ReactionDisc reaction={mine} size={20} />
          ) : (
            <Ionicons name="golf-outline" size={20} color={colors.ink500} />
          )}
        </Animated.View>
        <Text style={[styles.actionLabel, { color: info ? info.color : colors.ink500 }]} numberOfLines={1}>
          {info ? info.label : "React"}
        </Text>
      </Pressable>
      <ReactionPicker
        visible={open}
        anchor={anchor}
        current={mine}
        onClose={() => setOpen(false)}
        onPick={(r) => {
          setOpen(false);
          if (r && r !== mine) pop();
          onReact(r);
        }}
      />
    </>
  );
}

/** One of the other three actions: icon and label, the full quarter of the
 *  row as its tap target (never under 44pt). */
function ActionButton({
  icon,
  label,
  onPress,
  active = false,
  activeColor,
  accessibilityLabel,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  active?: boolean;
  activeColor?: string;
  accessibilityLabel?: string;
}) {
  const color = active && activeColor ? activeColor : colors.ink500;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
      accessibilityRole="button"
      accessibilityState={active ? { selected: true } : undefined}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.actionLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** One comment in the feed's collapsed preview: name and text on one line,
 *  @mentions highlighted, then the time and Reply. The full thread, with
 *  likes and every option, is the Comments sheet (comment-thread.tsx). */
function CommentRow({
  comment,
  onAuthor,
  onLongPress,
  onReply,
}: {
  comment: FeedComment;
  onAuthor: () => void;
  onLongPress?: () => void;
  onReply: () => void;
}) {
  return (
    <Pressable
      onLongPress={onLongPress}
      style={styles.comment}
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
          {mentionSegments(comment.body, comment.mentions).map((seg, i) =>
            seg.mention ? (
              <Text key={i} style={styles.mention}>
                {seg.text}
              </Text>
            ) : (
              <Text key={i}>{seg.text}</Text>
            )
          )}
        </Text>
        {comment.hidden && <Text style={styles.hiddenNote}>Hidden by PinPals — only you can see this.</Text>}
        <View style={styles.commentMetaRow}>
          <Text style={styles.commentMeta}>
            {ago(comment.createdAt)}
            {comment.editedAt ? " · Edited" : ""}
          </Text>
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
          {comment.likeCount > 0 && (
            <Text style={styles.commentMeta}>
              <Ionicons name="heart" size={11} color={colors.red600} /> {comment.likeCount}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The photos: one at its own shape (within 4:5 and 16:9); two or more
 * swiped, all at the first photo's height so the card doesn't jump as you
 * go, with a counter and dots. Courses are landscapes, and a 2×2 grid of
 * thumbnails turned every one of them into a postage stamp. Tap for the
 * full-size viewer.
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
    // A soft lift rather than a box: the card sits on cream, and a 1pt
    // border on every side of every post read as a form, not a feed.
    shadowColor: colors.navy900,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
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

  // 1. Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md - 2,
    paddingBottom: spacing.sm + 2,
  },
  headerText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm - 2 },
  name: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  hcp: {
    backgroundColor: colors.green100,
    borderRadius: radii.pill,
    paddingHorizontal: 7,
    paddingVertical: 1.5,
  },
  hcpText: { fontFamily: fonts.bodySemi, fontSize: 10.5, letterSpacing: 0.3, color: colors.green800 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  meta: { flexShrink: 1, fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  metaCourse: { fontFamily: fonts.bodySemi, color: colors.green700 },
  metaFixed: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  metaDot: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  menu: { padding: spacing.xs, alignSelf: "flex-start" },

  // 2. Text
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink900,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm + 2,
  },
  bodyLarge: { fontSize: 17, lineHeight: 24, paddingBottom: spacing.md - 4 },
  more: { fontFamily: fonts.bodySemi, color: colors.ink500 },

  // 3. Media — inset and rounded
  media: {
    marginHorizontal: MEDIA_INSET,
    borderRadius: radii.md,
    overflow: "hidden",
    backgroundColor: colors.cream100,
  },
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
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: creamAlpha(0.55) },
  dotActive: { backgroundColor: colors.cream50, width: 16 },

  // 4. Golf
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm - 2,
    paddingHorizontal: MEDIA_INSET,
    paddingTop: spacing.sm + 2,
  },
  chip: {
    backgroundColor: colors.surfaceTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
  },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink900 },

  // 5. Proof
  proof: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 4,
  },
  proofLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  proofText: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },

  // 6. Actions
  actions: {
    flexDirection: "row",
    marginHorizontal: spacing.sm,
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: 2,
  },
  action: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    minHeight: 44,
    borderRadius: radii.sm,
  },
  actionPressed: { backgroundColor: colors.surfaceTint },
  actionLabel: { fontFamily: fonts.bodySemi, fontSize: 13 },

  // 7. Comments
  viewAll: { paddingHorizontal: spacing.md, minHeight: 32, justifyContent: "center" },
  viewAllText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.ink500 },
  comments: { paddingHorizontal: spacing.md, gap: spacing.sm + 2, paddingTop: spacing.xs },
  comment: { flexDirection: "row", gap: spacing.sm },
  commentAvatar: { paddingTop: 1 },
  commentBody: { flex: 1, minWidth: 0 },
  commentName: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.ink900 },
  commentText: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ink900 },
  hiddenNote: { fontFamily: fonts.body, fontSize: 11.5, color: colors.ink500, marginTop: 4 },
  commentMetaRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: 2 },
  mention: { fontFamily: fonts.bodySemi, color: colors.green700 },
  commentMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  replyLink: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink500, paddingVertical: 2 },
  foot: { height: spacing.md - 4 },

  viewer: { flex: 1, backgroundColor: navyAlpha(0.97) },
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
