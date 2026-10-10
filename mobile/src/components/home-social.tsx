import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { coursePhoto } from "@/components/course-photos";
import { PostCard, postCardWidth } from "@/components/post-card";
import { StarPicker, StarRow } from "@/components/stars";
import { placeLabel, type Club } from "@/lib/courses";
import { monthLabel, reviewerName } from "@/lib/course-rating-rules";
import type { FeedPost } from "@/lib/feed";
import { ago } from "@/lib/feed-rules";
import type { LatestReview, Me } from "@/lib/home-social";
import { RATING_WORDS, REVIEW_TAGS } from "@/lib/onboarding";
import { colors, fonts, navyAlpha, creamAlpha, radii, spacing, type } from "@/lib/theme";
import { usePostActions } from "@/lib/use-post-actions";

/**
 * Home's social sections (Oct 2026, mockup G on the design canvas): a
 * composer under the hero, a strip of the latest photos, the most liked post
 * of the week, the courses waiting for the member's stars, and the latest
 * course reviews. Each one is a way into Social or into a review — Home
 * stays a front door, not a second feed.
 *
 * Every section renders nothing while its data is null (loading or failed)
 * and has a deliberate empty state or none, so a quiet week never leaves a
 * heading over a blank space.
 */

const openComposer = (type?: "photo" | "round") =>
  router.push(type ? { pathname: "/new-post", params: { type } } : "/new-post");

const openReview = (club: { id: number; name: string }, rating?: number) =>
  router.push({
    pathname: "/course/review",
    params: { id: String(club.id), name: club.name, ...(rating ? { rating: String(rating) } : {}) },
  });

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

/** "How was golf today?" — sits over the bottom edge of the hero. */
export function ShareComposer({ me }: { me: Me | null }) {
  const prompt = me?.firstName ? `How was golf today, ${me.firstName}?` : "How was golf today?";
  return (
    <View style={styles.composer}>
      <View style={styles.composerRow}>
        <Avatar url={me?.avatarUrl} color={me?.avatarColor} name={me?.name ?? null} size={40} />
        <Pressable
          style={({ pressed }) => [styles.fakeInput, pressed && styles.fakeInputOn]}
          onPress={() => openComposer()}
          accessibilityRole="button"
          accessibilityLabel="Write a post"
        >
          <Text style={styles.fakeInputText} numberOfLines={1}>
            {prompt}
          </Text>
        </Pressable>
      </View>
      <View style={styles.composerActions}>
        <ComposerAction icon="camera-outline" color={colors.green600} label="Photo" onPress={() => openComposer("photo")} />
        <ComposerAction icon="trophy-outline" color={colors.gold500} label="My round" onPress={() => openComposer("round")} divider />
        <ComposerAction icon="star-outline" color={colors.gold500} label="Review" onPress={() => router.push("/rate-course")} divider />
      </View>
    </View>
  );
}

function ComposerAction({
  icon,
  color,
  label,
  onPress,
  divider = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
  divider?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.composerAction, divider && styles.composerDivider, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={styles.composerActionLabel}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Section heading
// ---------------------------------------------------------------------------

function SectionHead({ title, link, onLink }: { title: string; link?: string; onLink?: () => void }) {
  return (
    <View style={styles.head}>
      <Text style={styles.headTitle}>{title}</Text>
      {link && onLink ? (
        <Pressable onPress={onLink} hitSlop={10} style={styles.headLink} accessibilityRole="link">
          <Text style={styles.headLinkText}>{link}</Text>
          <Ionicons name="arrow-forward" size={15} color={colors.green700} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// From the clubhouse
// ---------------------------------------------------------------------------

export function ClubhouseStrip({ posts }: { posts: FeedPost[] | null }) {
  if (posts === null) return null;
  return (
    <View style={styles.section}>
      <SectionHead title="From the clubhouse" link="Open Social" onLink={() => router.push("/feed")} />
      <Text style={styles.sub}>The latest photos from PinPals members.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        <Pressable
          style={({ pressed }) => [styles.tile, styles.addTile, pressed && styles.pressed]}
          onPress={() => openComposer("photo")}
          accessibilityRole="button"
          accessibilityLabel="Add a photo"
        >
          <View style={styles.addCircle}>
            <Ionicons name="camera-outline" size={24} color={colors.cream50} />
          </View>
          <Text style={styles.addTitle}>Add yours</Text>
          <Text style={styles.addBody}>A photo from your last round</Text>
        </Pressable>
        {posts.map((post) => (
          <PhotoTile key={post.id} post={post} />
        ))}
      </ScrollView>
    </View>
  );
}

function PhotoTile({ post }: { post: FeedPost }) {
  const photo = post.photos.find((p) => p.url);
  if (!photo?.url) return null;
  const where = post.club?.name ?? post.author.homeClub;
  return (
    <Pressable
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      onPress={() => router.push({ pathname: "/post/[id]", params: { id: String(post.id) } })}
      accessibilityRole="button"
      accessibilityLabel={`Photo by ${post.author.name}${where ? ` at ${where}` : ""}`}
    >
      <Image source={{ uri: photo.url }} style={styles.tileImage} />
      <View style={styles.tileFace}>
        <Avatar url={post.author.avatarUrl} color={post.author.avatarColor} name={post.author.name} size={30} />
      </View>
      <View style={styles.tileVeil}>
        <Text style={styles.tileName} numberOfLines={1}>
          {post.author.name}
        </Text>
        <Text style={styles.tileMeta} numberOfLines={1}>
          {where ? `${where} · ` : ""}
          {ago(post.createdAt)}
        </Text>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Most liked this week
// ---------------------------------------------------------------------------

/** The week's most-reacted post, as a full card with working actions. */
export function MostLikedThisWeek({ post: initial }: { post: FeedPost | null }) {
  const { width } = useWindowDimensions();
  const [post, setPost] = useState<FeedPost | null>(initial);
  const [seen, setSeen] = useState<FeedPost | null>(initial);
  // A fresh post from Home's reload replaces the local copy.
  if (initial !== seen) {
    setSeen(initial);
    setPost(initial);
  }

  const actions = usePostActions({
    update: (id, change) => setPost((p) => (p && p.id === id ? change(p) : p)),
    remove: () => setPost(null),
    reload: () => undefined,
    afterBlock: () => setPost(null),
  });

  if (!post) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.kicker}>Most liked this week</Text>
      <PostCard
        post={post}
        width={postCardWidth(width)}
        onLike={actions.like}
        onReact={actions.react}
        onShare={actions.share}
        onSave={actions.save}
        onMenu={actions.menu}
        onComment={(p) => router.push({ pathname: "/comments/[id]", params: { id: String(p.id), focus: "comment" } })}
        onCommentOptions={actions.commentOptions}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Rate your courses
// ---------------------------------------------------------------------------

export function RateYourCourses({ clubs }: { clubs: Club[] | null }) {
  if (!clubs || clubs.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHead title="Rate your courses" link="All my courses" onLink={() => router.push("/rate-course")} />
      <Text style={styles.sub}>
        You've played these but haven't rated them. Your stars show on every tee time there.
      </Text>
      <View style={styles.rateCard}>
        {clubs.map((club, i) => (
          <RateRow key={club.id} club={club} first={i === 0} />
        ))}
      </View>
      <Text style={styles.hint}>Tap a star to rate — a comment is optional.</Text>
    </View>
  );
}

/** One course with five stars to tap. Also used by the Rate a course screen. */
export function RateRow({ club, rating = 0, first = false, distance = null }: { club: Club; rating?: number; first?: boolean; distance?: string | null }) {
  const place = [distance, placeLabel(club, true)].filter(Boolean).join(" · ");
  return (
    <View style={[styles.rateRow, !first && styles.rateRowRule]}>
      <Pressable
        onPress={() => router.push({ pathname: "/course/[id]", params: { id: String(club.id) } })}
        accessibilityRole="button"
        accessibilityLabel={`Open ${club.name}`}
      >
        <Image source={coursePhoto(club.id, club.name)} style={styles.rateThumb} />
      </Pressable>
      <View style={styles.rateBody}>
        <Text style={styles.rateName} numberOfLines={1}>
          {club.name}
        </Text>
        {place ? (
          <Text style={styles.ratePlace} numberOfLines={1}>
            {place}
          </Text>
        ) : null}
        <View style={styles.rateStars}>
          <StarPicker value={rating} onChange={(n) => openReview(club, n)} size={26} />
        </View>
        {rating ? <Text style={styles.rateWord}>{RATING_WORDS[rating]} · tap to change</Text> : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Latest course reviews
// ---------------------------------------------------------------------------

const TAG_LABELS = new Map<string, string>(REVIEW_TAGS.map((t) => [t.code, t.label]));

export function LatestReviews({ reviews }: { reviews: LatestReview[] | null }) {
  if (!reviews || reviews.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHead title="Latest course reviews" link="Rate a course" onLink={() => router.push("/rate-course")} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {reviews.map((r) => (
          <Pressable
            key={r.id}
            style={({ pressed }) => [styles.review, pressed && styles.pressed]}
            onPress={() => router.push({ pathname: "/course/[id]", params: { id: String(r.club.id) } })}
            accessibilityRole="button"
            accessibilityLabel={`${r.club.name}, rated ${r.rating} out of 5`}
          >
            <Text style={styles.reviewClub} numberOfLines={1}>
              {r.club.name}
            </Text>
            <View style={styles.reviewStars}>
              <StarRow value={r.rating} size={15} />
              <Text style={styles.reviewWord}>{RATING_WORDS[r.rating]}</Text>
            </View>
            <Text style={styles.reviewBody} numberOfLines={4}>
              “{r.body}”
            </Text>
            {r.tags.length > 0 ? (
              <View style={styles.tags}>
                {r.tags.slice(0, 2).map((t) => (
                  <Text key={t} style={styles.tag}>
                    {TAG_LABELS.get(t) ?? t}
                  </Text>
                ))}
              </View>
            ) : null}
            <Text style={styles.reviewBy} numberOfLines={1}>
              {reviewerName(r.member.firstName, r.member.lastName)}
              {` · ${monthLabel(r.playedMonth) ?? ago(r.createdAt)}`}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },

  composer: {
    marginTop: -22,
    marginHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: colors.navy900,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  composerRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, paddingBottom: 12 },
  fakeInput: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cream50,
  },
  fakeInputOn: { backgroundColor: colors.cream100 },
  fakeInputText: { fontFamily: fonts.body, fontSize: 15, color: colors.ink500 },
  composerActions: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.cream100 },
  composerAction: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  composerDivider: { borderLeftWidth: 1, borderLeftColor: colors.cream100 },
  composerActionLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },

  section: { gap: 6 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink900, flexShrink: 1 },
  headLink: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 },
  headLinkText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  sub: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 19, color: colors.ink500, marginTop: -6 },
  kicker: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#8a6a1f",
  },
  hint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, textAlign: "center", marginTop: 2 },

  // Bleeds to the screen edge so a half-shown tile says "swipe for more".
  rail: { gap: 10, paddingRight: spacing.md, paddingTop: 6 },
  tile: { width: 124, height: 184, borderRadius: 14, overflow: "hidden", backgroundColor: colors.cream100 },
  tileImage: { width: "100%", height: "100%" },
  tileFace: {
    position: "absolute",
    top: 8,
    left: 8,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.gold400,
  },
  tileVeil: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 10, backgroundColor: navyAlpha(0.72) },
  tileName: { fontFamily: fonts.bodyBold, fontSize: 13, color: "#ffffff" },
  tileMeta: { fontFamily: fonts.body, fontSize: 11.5, color: creamAlpha(0.9), marginTop: 2 },
  addTile: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#c9b98f",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 12,
  },
  addCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  addTitle: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  addBody: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, textAlign: "center" },

  rateCard: {
    marginTop: 6,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  rateRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rateRowRule: { borderTopWidth: 1, borderTopColor: colors.cream100 },
  rateThumb: { width: 64, height: 64, borderRadius: radii.md, backgroundColor: colors.cream100 },
  rateBody: { flex: 1, minWidth: 0 },
  rateName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  ratePlace: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, marginTop: 1 },
  rateStars: { marginTop: 4, marginLeft: -2 },
  rateWord: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: "#8a6a1f", marginTop: 2 },

  review: {
    width: 262,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 8,
  },
  reviewClub: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  reviewStars: { flexDirection: "row", alignItems: "center", gap: 8 },
  reviewWord: { fontFamily: fonts.bodyBold, fontSize: 13, color: "#8a6a1f" },
  reviewBody: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink900 },
  tags: { flexDirection: "row", gap: 6 },
  tag: {
    fontFamily: fonts.bodySemi,
    fontSize: 11.5,
    color: colors.green800,
    backgroundColor: colors.green100,
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
    overflow: "hidden",
  },
  reviewBy: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, marginTop: "auto" },
});
