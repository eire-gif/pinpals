import { useCallback, useState } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { STARS_GOLD, StarRow } from "@/components/stars";
import { useAuth } from "@/lib/auth";
import { countryName, placeLabel } from "@/lib/courses";
import {
  REVIEW_TAGS,
  courseListCounts,
  loadCourse,
  loadCourseReviews,
  myCourseState,
  reportCourseReview,
  setCourse,
  type CourseDetail,
  type CourseReviewRow,
} from "@/lib/onboarding";
import { colors, fonts, radii, spacing } from "@/lib/theme";

const TAG_LABEL = Object.fromEntries(REVIEW_TAGS.map((t) => [t.code, t.label])) as Record<string, string>;

/**
 * A course's own page, native.
 *
 * Replaces opening the club's website page in a web view for the parts that
 * are about the course and the community: the rating, the reviews, who has
 * played it and who wants to, and the two buttons that put it on your lists.
 * The website page is still one tap away for the map, the members list and
 * "set as my home club", which have server logic behind them.
 */
export default function CourseScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const clubId = Number(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [course, setCourseRow] = useState<CourseDetail | null>(null);
  const [reviews, setReviews] = useState<CourseReviewRow[]>([]);
  const [counts, setCounts] = useState({ played: 0, bucket: 0, home: 0 });
  const [mine, setMine] = useState({ played: false, bucket: false });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(clubId)) return;
    const [c, r, n, m] = await Promise.all([
      loadCourse(clubId),
      loadCourseReviews(clubId),
      courseListCounts(clubId),
      userId ? myCourseState(userId, clubId) : Promise.resolve({ played: false, bucket: false }),
    ]);
    setCourseRow(c);
    setReviews(r);
    setCounts(n);
    setMine(m);
    setLoading(false);
    setRefreshing(false);
  }, [clubId, userId]);

  // On focus, so coming back from the review sheet shows the new average.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const toggle = async (kind: "played" | "bucket") => {
    if (!userId) return;
    const on = !mine[kind];
    setMine((s) => ({ ...s, [kind]: on }));
    setCounts((c) => ({ ...c, [kind]: Math.max(0, c[kind] + (on ? 1 : -1)) }));
    try {
      await setCourse(userId, clubId, kind, on);
    } catch {
      void load();
    }
  };

  const report = (review: CourseReviewRow) => {
    const reasons = [
      { label: "Inappropriate", code: "inappropriate_content" },
      { label: "Names or targets someone", code: "harassment" },
      { label: "Spam", code: "spam" },
      { label: "Something else", code: "other" },
    ];
    const send = (code: string) =>
      void reportCourseReview(review.id, code)
        .then(() => Alert.alert("Reported", "Thanks — a moderator will look at it."))
        .catch((e: Error) => Alert.alert("Couldn't report that", e.message));

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: "Report this review", options: [...reasons.map((r) => r.label), "Cancel"], cancelButtonIndex: reasons.length, destructiveButtonIndex: 0 },
        (i) => i < reasons.length && send(reasons[i]!.code)
      );
    } else {
      Alert.alert("Report this review", undefined, [
        ...reasons.map((r) => ({ text: r.label, onPress: () => send(r.code) })),
        { text: "Cancel", style: "cancel" as const },
      ]);
    }
  };

  if (loading) {
    return <ActivityIndicator color={colors.green700} style={styles.spinner} />;
  }
  if (!course) {
    return <Text style={styles.missing}>That course couldn&apos;t be found.</Text>;
  }

  const myReview = reviews.find((r) => r.member_id === userId) ?? null;
  const others = reviews.filter((r) => r !== myReview);
  const avg = course.rating_avg === null || course.rating_avg === undefined ? null : Number(course.rating_avg);
  const count = course.rating_count ?? 0;

  return (
    <>
      <Stack.Screen options={{ title: course.name, headerBackTitle: "Back" }} />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.green700} />}
      >
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>{course.name}</Text>
          <Text style={styles.heroPlace}>{placeLabel(course)}</Text>
        </View>

        <View style={styles.summary}>
          {avg !== null && count > 0 ? (
            <>
              <View style={styles.big}>
                <Text style={styles.bigNumber}>{avg.toFixed(1)}</Text>
                <StarRow value={avg} size={16} />
                <Text style={styles.small}>
                  {count} {count === 1 ? "rating" : "ratings"}
                </Text>
              </View>
              <View style={styles.bars}>
                {[5, 4, 3, 2, 1].map((n) => {
                  const c = course.rating_dist?.[n - 1] ?? 0;
                  return (
                    <View key={n} style={styles.barRow}>
                      <Text style={styles.barLabel}>{n}</Text>
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { width: `${count ? (c / count) * 100 : 0}%` }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          ) : (
            <Text style={styles.unrated}>Nobody has rated {course.name} yet. Played it? Be the first.</Text>
          )}
        </View>

        <View style={styles.actions}>
          <ActionButton
            icon={mine.played ? "checkmark-circle" : "checkmark-circle-outline"}
            label={mine.played ? "Played it" : "I've played it"}
            on={mine.played}
            onPress={() => void toggle("played")}
          />
          <ActionButton
            icon={mine.bucket ? "heart" : "heart-outline"}
            iconColor={colors.red600}
            label="Bucket list"
            on={mine.bucket}
            onPress={() => void toggle("bucket")}
          />
          <Pressable
            style={[styles.action, styles.actionPrimary]}
            onPress={() => router.push({ pathname: "/course/review", params: { id: String(clubId), name: course.name } })}
            accessibilityRole="button"
          >
            <Ionicons name="star" size={20} color={colors.gold400} />
            <Text style={styles.actionPrimaryLabel}>{myReview ? "Edit review" : "Rate & review"}</Text>
          </Pressable>
        </View>

        {/* Google Maps, searched by name rather than dropped as a pin on the
            coordinates: a name search lands on the club's own Google listing,
            with directions, opening hours, photos and Google reviews, where a
            bare pin is just a point in a field. Town and country keep a common
            name ("Woodbrook") from matching the wrong club. Opens the Google
            Maps app when it's installed, the browser otherwise. */}
        <Pressable
          style={({ pressed }) => [styles.maps, pressed && styles.mapsPressed]}
          onPress={() => void Linking.openURL(googleMapsUrl(course))}
          accessibilityRole="link"
          accessibilityLabel={`Open ${course.name} in Google Maps`}
        >
          <View style={styles.mapsIcon}>
            <Ionicons name="map" size={22} color={colors.cream50} />
          </View>
          <View style={styles.mapsText}>
            <Text style={styles.mapsTitle}>Open in Google Maps</Text>
            <Text style={styles.mapsSub}>Directions, photos and Google reviews</Text>
          </View>
          <Ionicons name="open-outline" size={18} color={colors.green700} />
        </Pressable>

        <View style={styles.community}>
          <Ionicons name="people-outline" size={22} color={colors.green700} />
          <Text style={styles.communityText}>
            <Text style={styles.strong}>{counts.played}</Text> {counts.played === 1 ? "member has" : "members have"} played here ·{" "}
            <Text style={styles.strong}>{counts.bucket}</Text> on bucket lists
            {counts.home ? (
              <>
                {" "}· <Text style={styles.strong}>{counts.home}</Text> call it home
              </>
            ) : null}
          </Text>
        </View>

        <Pressable
          style={styles.webLink}
          onPress={() => router.push({ pathname: "/web", params: { path: `/courses/${course.country}/${course.slug}`, title: course.name } })}
          accessibilityRole="button"
        >
          <Text style={styles.webLinkLabel}>Members, map and tee times</Text>
          <Ionicons name="arrow-forward" size={16} color={colors.green700} />
        </Pressable>

        <Text style={styles.sectionTitle}>Reviews</Text>

        {myReview ? <ReviewCard review={myReview} mine /> : null}
        {others.map((r) => (
          <ReviewCard key={r.id} review={r} onReport={() => report(r)} />
        ))}
        {reviews.length === 0 ? (
          <Text style={styles.small}>No written reviews yet.</Text>
        ) : null}
      </ScrollView>
    </>
  );
}

function googleMapsUrl(course: CourseDetail): string {
  const query = [course.name, course.town, countryName(course.country)].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function ActionButton({
  icon,
  iconColor = colors.green700,
  label,
  on,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.action, on && styles.actionOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Ionicons name={icon} size={22} color={iconColor} />
      <Text style={[styles.actionLabel, on && styles.actionLabelOn]}>{label}</Text>
    </Pressable>
  );
}

function ReviewCard({ review, mine = false, onReport }: { review: CourseReviewRow; mine?: boolean; onReport?: () => void }) {
  const name = review.member ? `${review.member.first_name} ${review.member.last_name}` : "A member";
  const when = review.played_month
    ? `played ${new Date(review.played_month).toLocaleDateString("en-IE", { month: "short", year: "numeric" })}`
    : null;

  return (
    <View style={styles.review}>
      <View style={styles.reviewHead}>
        <Avatar url={review.member?.avatar_url} color={review.member?.avatar_color} name={name} size={40} />
        <View style={styles.reviewWho}>
          <Text style={styles.reviewName}>{mine ? "Your review" : name}</Text>
          <Text style={styles.small} numberOfLines={1}>
            {[review.member?.home_club, when].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <StarRow value={review.rating} size={14} />
      </View>
      {review.body ? <Text style={styles.reviewBody}>{review.body}</Text> : null}
      {review.tags.length ? (
        <View style={styles.tags}>
          {review.tags.map((t) => (
            <Text key={t} style={styles.tag}>{TAG_LABEL[t] ?? t}</Text>
          ))}
        </View>
      ) : null}
      {mine && review.hidden_at ? (
        <Text style={styles.hiddenNote}>PinPals has hidden this review, so other members can&apos;t see it.</Text>
      ) : null}
      {onReport ? (
        <Pressable onPress={onReport} hitSlop={10} style={styles.reportHit} accessibilityRole="button">
          <Text style={styles.report}>Report</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { paddingBottom: spacing.xl },
  spinner: { marginTop: spacing.xl },
  missing: { fontFamily: fonts.body, fontSize: 16, color: colors.ink500, padding: spacing.lg },
  hero: { backgroundColor: colors.navy900, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20 },
  heroTitle: { fontFamily: fonts.display, fontSize: 28, lineHeight: 33, color: colors.cream50 },
  heroPlace: { fontFamily: fonts.body, fontSize: 14.5, color: colors.cream100, marginTop: 4 },
  summary: { flexDirection: "row", alignItems: "center", gap: 18, paddingHorizontal: 20, paddingTop: 18 },
  big: { alignItems: "center", gap: 3 },
  bigNumber: { fontFamily: fonts.display, fontSize: 46, lineHeight: 50, color: colors.ink900 },
  bars: { flex: 1, gap: 5 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { width: 10, fontFamily: fonts.body, fontSize: 12.5, color: "#4c5667" },
  barTrack: { flex: 1, height: 7, borderRadius: 4, backgroundColor: colors.cream100, overflow: "hidden" },
  barFill: { height: 7, borderRadius: 4, backgroundColor: STARS_GOLD },
  unrated: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: "#3d4757" },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: "#5b6576" },
  actions: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingTop: 18 },
  action: {
    flex: 1,
    minHeight: 68,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  actionOn: { borderColor: colors.green700, backgroundColor: colors.green100 },
  actionLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink900 },
  actionLabelOn: { color: colors.green800 },
  actionPrimary: { backgroundColor: colors.green700, borderColor: colors.green700 },
  actionPrimaryLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.cream50 },
  maps: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 20,
    marginTop: 14,
    padding: 12,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.green700,
    backgroundColor: colors.surface,
  },
  mapsPressed: { backgroundColor: colors.green100 },
  mapsIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.green700,
  },
  mapsText: { flex: 1, gap: 2 },
  mapsTitle: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.ink900 },
  mapsSub: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  community: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 20,
    marginTop: 16,
    padding: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
  },
  communityText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink900 },
  strong: { fontFamily: fonts.bodyBold },
  webLink: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 48, paddingHorizontal: 20 },
  webLinkLabel: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.green700 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink900, paddingHorizontal: 20, marginTop: 8, marginBottom: 4 },
  review: { marginHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.cream100 },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  reviewWho: { flex: 1 },
  reviewName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  reviewBody: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 22, color: "#1d2633", marginTop: 8 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  tag: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.green800,
    backgroundColor: colors.green100,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: "hidden",
  },
  hiddenNote: { fontFamily: fonts.body, fontSize: 13, color: colors.ink900, backgroundColor: colors.cream100, borderRadius: 8, padding: 10, marginTop: 8 },
  reportHit: { alignSelf: "flex-end", minHeight: 32, justifyContent: "center" },
  report: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, textDecorationLine: "underline" },
});
