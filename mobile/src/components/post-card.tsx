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
import { PostVideo } from "@/components/post-video";
import { RoundCard } from "@/components/round-card";
import { ReactionDisc, ReactionPicker, ReactionStack } from "@/components/reactions";
import { achievementOf } from "@/lib/achievements";
import type { FeedAuthor, FeedClub, FeedComment, FeedPhoto, FeedPost } from "@/lib/feed";
import { POST_VISIBILITY_SHORT, ago, compactCount, handicapLabel, photoHeight } from "@/lib/feed-rules";
import { detailChips, type RoundDetails } from "@/lib/post-details";
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
 *   5. actions  — one condensed row (Oct 2026, after Facebook's): React
 *                 with its count, Comment with its count, Share; on the
 *                 right the top reactions as discs, then Save. React: tap
 *                 for Great Shot (or to take yours away), long-press to
 *                 choose (components/reactions.tsx). The comment count is
 *                 the way into the conversation — the card no longer lists
 *                 comments under itself; the Comments sheet has them all.
 *                 On the post screen (standalone) the screen draws the
 *                 thread under the card
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
  /** Unused since the card stopped previewing comments (Oct 2026); the
   *  Comments sheet has the options. Kept so callers need not change. */
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
  // A round draws as a scorecard (round-card.tsx); holes and shots keep chips.
  const round =
    !achievement && post.kind === "round" && post.details && typeof post.details === "object" && typeof (post.details as RoundDetails).score === "number"
      ? (post.details as RoundDetails)
      : null;
  const chips = achievement || round ? [] : detailChips(post);

  const openMember = (id: string) => {
    if (id === currentMemberId) return;
    router.push({ pathname: "/member/[id]", params: { id } });
  };

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

      {post.video ? (
        <View style={styles.media}>
          <PostVideo video={post.video} club={post.club} width={mediaWidth} />
        </View>
      ) : null}

      {round ? (
        <View style={styles.media}>
          <RoundCard details={round} courseName={post.club?.name ?? null} width={mediaWidth} />
        </View>
      ) : null}

      {chips.length > 0 && (
        <View style={styles.chips} accessibilityLabel={chips.join(", ")}>
          {chips.map((chip) => (
            <View key={chip} style={styles.chip}>
              <Text style={styles.chipText}>{chip}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <ReactButton post={post} onTap={() => onLike(post)} onReact={(r) => onReact(post, r)} />
        <ActionButton
          icon="chatbubble-outline"
          count={post.commentCount}
          onPress={() => onComment(post)}
          accessibilityLabel={
            post.commentCount > 0
              ? `${post.commentCount} ${post.commentCount === 1 ? "comment" : "comments"}. Open comments`
              : "Comment"
          }
        />
        <ActionButton icon="arrow-redo-outline" onPress={() => onShare(post)} accessibilityLabel="Share" />
        <View style={styles.actionsSpacer} />
        {post.likeCount > 0 && (
          <View
            style={styles.topReactions}
            accessible
            accessibilityLabel={`Reactions: ${topReactions(post.reactionCounts)
              .map((r) => REACTION_INFO[r].label)
              .join(", ")}`}
          >
            <ReactionStack reactions={topReactions(post.reactionCounts)} size={20} />
          </View>
        )}
        <ActionButton
          icon={post.savedByMe ? "bookmark" : "bookmark-outline"}
          active={post.savedByMe}
          activeColor={colors.green700}
          onPress={() => onSave(post)}
          accessibilityLabel={post.savedByMe ? "Saved. Remove from saved" : "Save post"}
        />
      </View>

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
        accessibilityLabel={
          (post.likeCount > 0 ? `${post.likeCount} ${post.likeCount === 1 ? "reaction" : "reactions"}. ` : "") +
          (info ? `Your reaction: ${info.label}. Tap to remove` : "React, Great Shot")
        }
        accessibilityHint="Long-press to choose a reaction"
        accessibilityActions={[{ name: "longpress", label: "Choose a reaction" }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "longpress") openPicker();
        }}
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          {mine ? (
            <ReactionDisc reaction={mine} size={22} />
          ) : (
            <Ionicons name="golf-outline" size={22} color={colors.ink500} />
          )}
        </Animated.View>
        {post.likeCount > 0 ? (
          <Text style={[styles.actionCount, { color: info ? info.color : colors.ink500 }]} numberOfLines={1}>
            {compactCount(post.likeCount)}
          </Text>
        ) : null}
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

/** Comment, Share or Save: an icon, and a count beside it when there is
 *  one. The tap target is never under 44pt. */
function ActionButton({
  icon,
  count = 0,
  onPress,
  active = false,
  activeColor,
  accessibilityLabel,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  count?: number;
  onPress: () => void;
  active?: boolean;
  activeColor?: string;
  accessibilityLabel: string;
}) {
  const color = active && activeColor ? activeColor : colors.ink500;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
      accessibilityRole="button"
      accessibilityState={active ? { selected: true } : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons name={icon} size={22} color={color} />
      {count > 0 ? (
        <Text style={[styles.actionCount, { color }]} numberOfLines={1}>
          {compactCount(count)}
        </Text>
      ) : null}
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

  // 5. Actions — one condensed row
  actions: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: spacing.sm,
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: 2,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    justifyContent: "center",
  },
  actionPressed: { backgroundColor: colors.surfaceTint },
  actionCount: { fontFamily: fonts.bodySemi, fontSize: 15 },
  actionsSpacer: { flex: 1 },
  topReactions: { paddingHorizontal: spacing.xs },
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
