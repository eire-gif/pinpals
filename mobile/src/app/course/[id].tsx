import { useCallback, useState } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { STARS_GOLD, StarRow } from "@/components/stars";
import { TeeTimeCard } from "@/components/tee-time-card";
import { useAuth } from "@/lib/auth";
import { favouriteClubIds, setFavouriteClub } from "@/lib/club-favourites";
import { isOn } from "@/lib/features";
import { mappedHoles } from "@/lib/hole-geo";
import { loadCourseLayouts, type CourseLayout } from "@/lib/hole-maps";
import { countryName, placeLabel } from "@/lib/courses";
import {
  REVIEW_TAGS,
  courseListCounts,
  courseMembers,
  loadCourse,
  loadCourseReviews,
  myCourseState,
  myHomeClub,
  patchProfile,
  reportCourseReview,
  setCourse,
  type CourseDetail,
  type CourseMember,
  type CourseReviewRow,
} from "@/lib/onboarding";
import { confirmedPlayersFor, listInvitesAtClub, type CardPlayer, type Invite } from "@/lib/tee-times";
import { colors, fonts, radii, spacing } from "@/lib/theme";

const TAG_LABEL = Object.fromEntries(REVIEW_TAGS.map((t) => [t.code, t.label])) as Record<string, string>;

/**
 * A course's own page, native.
 *
 * Replaces opening the club's website page in a web view for the parts that
 * are about the course and the community: the rating, the reviews, who has
 * played it and who wants to, the two buttons that put it on your lists, a
 * Google Maps link, the members who play here, the tee times going, and
 * "make this my home club" — all native, so nothing here hands over to the
 * website.
 */
export default function CourseScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const clubId = Number(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [course, setCourseRow] = useState<CourseDetail | null>(null);
  // Favourite (0112): the star in the header, the same one as in Courses.
  const [favourite, setFavourite] = useState(false);
  useFocusEffect(
    useCallback(() => {
      void favouriteClubIds().then((ids) => setFavourite(ids.has(clubId)));
    }, [clubId])
  );
  const toggleFavourite = async () => {
    const on = !favourite;
    setFavourite(on);
    try {
      await setFavouriteClub(clubId, on);
    } catch {
      setFavourite(!on);
    }
  };
  const [reviews, setReviews] = useState<CourseReviewRow[]>([]);
  const [counts, setCounts] = useState({ played: 0, bucket: 0, home: 0 });
  const [mine, setMine] = useState({ played: false, bucket: false });
  const [members, setMembers] = useState<CourseMember[]>([]);
  const [teeTimes, setTeeTimes] = useState<Invite[]>([]);
  const [teePlayers, setTeePlayers] = useState<Map<number, CardPlayer[]>>(new Map());
  const [homeClubId, setHomeClubId] = useState<number | null>(null);
  const [myCountry, setMyCountry] = useState<string | null>(null);
  const [settingHome, setSettingHome] = useState(false);
  const [layouts, setLayouts] = useState<CourseLayout[]>([]);
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

    // The members and tee times that used to need the website. Loaded after
    // the course itself so the page appears at once and these fill in; a
    // failure here is an empty section, never a broken page.
    try {
      const [people, rounds, home] = await Promise.all([
        courseMembers(clubId),
        listInvitesAtClub(clubId),
        userId ? myHomeClub(userId) : Promise.resolve({ clubId: null, country: null }),
      ]);
      setMembers(people);
      setTeeTimes(rounds);
      setHomeClubId(home.clubId);
      setMyCountry(home.country);
      setTeePlayers(await confirmedPlayersFor(rounds.map((r) => r.id)));
      if (isOn("shotMaps")) setLayouts(await loadCourseLayouts(clubId).catch(() => []));
    } catch {
      // Leave the sections empty.
    }
    setRefreshing(false);
  }, [clubId, userId]);

  // On focus, so coming back from the review sheet shows the new average.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const makeHome = async () => {
    if (!userId || !course) return;
    setSettingHome(true);
    try {
      // Country follows the club, as the website's button does — the profile
      // validator rejects a home club in another country. County follows the
      // club's region when it has one; when it doesn't, the member's own
      // county is kept, unless the country changed and it no longer fits.
      const county = course.region
        ? { county: course.region }
        : myCountry !== course.country
          ? { county: "" }
          : {};
      await patchProfile(userId, { homeClubId: clubId, country: course.country, ...county });
      setHomeClubId(clubId);
      void load();
    } catch (error) {
      Alert.alert("Couldn't set your home club", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSettingHome(false);
    }
  };

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
      <Stack.Screen
        options={{
          title: course.name,
          headerBackTitle: "Back",
          headerRight: () => (
            <Pressable
              onPress={() => void toggleFavourite()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityState={{ selected: favourite }}
              accessibilityLabel={favourite ? "Remove from favourites" : "Add to favourites"}
            >
              <Ionicons name={favourite ? "star" : "star-outline"} size={24} color={favourite ? colors.gold500 : colors.ink900} />
            </Pressable>
          ),
        }}
      />
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

        {/* Hole by hole (0108): satellite maps with GPS yardages. */}
        {isOn("shotMaps") ? (
          <>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Hole by hole</Text>
            </View>
            {layouts.some((l) => mappedHoles(l.points).length > 0) ? (
              layouts.map((l) => {
                const holes = mappedHoles(l.points);
                if (holes.length === 0) return null;
                return (
                  <View key={l.id} style={styles.holeGridWrap}>
                    {layouts.length > 1 ? <Text style={styles.holeGridName}>{l.name}</Text> : null}
                    <View style={styles.holeGrid}>
                      {holes.map((h) => (
                        <Pressable
                          key={h}
                          onPress={() => router.push({ pathname: "/hole-map", params: { clubId: String(clubId), hole: String(h), layoutId: String(l.id) } })}
                          style={({ pressed }) => [styles.holeCell, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`Hole ${h} map`}
                        >
                          <Text style={styles.holeCellText}>{h}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                );
              })
            ) : (
              <Pressable
                onPress={() => router.push({ pathname: "/hole-map", params: { clubId: String(clubId), hole: "1" } })}
                style={({ pressed }) => [styles.holeEmpty, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Ionicons name="map-outline" size={20} color={colors.green700} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.holeEmptyTitle}>Satellite view</Text>
                  <Text style={styles.holeEmptySub}>Hole-by-hole maps for this course are on their way. Measure to anything on the map meanwhile.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
              </Pressable>
            )}
          </>
        ) : null}

        {/* Members here — home club first, then who has played it. */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Members here</Text>
          {members.length > 0 ? <Text style={styles.sectionCount}>{members.length}</Text> : null}
        </View>
        {members.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.memberRow}>
            {members.map((m) => (
              <Pressable
                key={m.id}
                style={({ pressed }) => [styles.memberCard, m.home && styles.memberCardHome, pressed && styles.pressed]}
                onPress={() => router.push(`/member/${m.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`${m.name}${m.home ? ", home club" : ", has played here"}`}
              >
                <Avatar url={m.avatarUrl} color={m.avatarColor} name={m.name} size={52} />
                <Text style={styles.memberName} numberOfLines={2}>{m.id === userId ? "You" : m.name}</Text>
                <View style={[styles.memberTag, m.home ? styles.memberTagHome : styles.memberTagPlayed]}>
                  <Text style={[styles.memberTagText, m.home && styles.memberTagTextHome]}>{m.home ? "Home club" : "Played"}</Text>
                </View>
                {m.handicap !== null ? <Text style={styles.memberHcp}>Hcp {m.handicap}</Text> : null}
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.emptyLine}>No PinPals members have this as their home club or have played it yet.</Text>
        )}
        {userId && homeClubId !== clubId ? (
          <Pressable
            style={({ pressed }) => [styles.homeButton, pressed && styles.pressed, settingHome && styles.disabled]}
            disabled={settingHome}
            onPress={() => void makeHome()}
            accessibilityRole="button"
          >
            {settingHome ? (
              <ActivityIndicator color={colors.green700} />
            ) : (
              <>
                <Ionicons name="home-outline" size={18} color={colors.green700} />
                <Text style={styles.homeButtonLabel}>Make this my home club</Text>
              </>
            )}
          </Pressable>
        ) : userId && homeClubId === clubId ? (
          <View style={styles.homeIs}>
            <Ionicons name="home" size={16} color={colors.green700} />
            <Text style={styles.homeIsText}>This is your home club</Text>
          </View>
        ) : null}

        {/* Tee times here — the same cards as the Tee times tab. */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Tee times here</Text>
          {teeTimes.length > 0 ? <Text style={styles.sectionCount}>{teeTimes.length}</Text> : null}
        </View>
        {teeTimes.length > 0 ? (
          <View style={styles.teeList}>
            {teeTimes.map((invite) => (
              <TeeTimeCard
                key={invite.id}
                invite={invite}
                players={teePlayers.get(invite.id) ?? []}
                me={userId}
                onPress={() => router.push(`/invite/${invite.id}`)}
              />
            ))}
          </View>
        ) : (
          <View style={styles.teeEmpty}>
            <Text style={styles.emptyLine}>No open tee times at {course.name} right now.</Text>
            <Pressable
              style={({ pressed }) => [styles.postButton, pressed && styles.pressed]}
              onPress={() => router.push("/post-tee-time")}
              accessibilityRole="button"
            >
              <Ionicons name="add-circle" size={20} color={colors.cream50} />
              <Text style={styles.postButtonLabel}>Post a tee time</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.sectionTitle}>Reviews</Text>

        {myReview ? <ReviewCard review={myReview} mine /> : null}
        {others.map((r) => (
          <ReviewCard key={r.id} review={r} onReport={() => report(r)} />
        ))}
        {reviews.length === 0 ? (
          <Text style={styles.emptyLine}>No written reviews yet.</Text>
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
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18 },
  sectionCount: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.green800,
    backgroundColor: colors.green100,
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: radii.pill,
    overflow: "hidden",
    marginTop: 6,
  },
  emptyLine: { fontFamily: fonts.body, fontSize: 14, color: colors.ink500, paddingHorizontal: 20, marginTop: 4 },
  memberRow: { paddingHorizontal: 20, gap: 10, paddingVertical: 6 },
  memberCard: {
    width: 104,
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  memberCardHome: { borderColor: colors.gold400, backgroundColor: "#fdf7e7" },
  memberName: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.ink900, textAlign: "center" },
  memberTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill },
  memberTagHome: { backgroundColor: colors.gold400 },
  memberTagPlayed: { backgroundColor: colors.green100 },
  memberTagText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.green800 },
  memberTagTextHome: { color: colors.ink900 },
  memberHcp: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.green700 },
  homeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 20,
    marginTop: 10,
    minHeight: 46,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.green700,
    backgroundColor: colors.surface,
  },
  homeButtonLabel: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.green700 },
  homeIs: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, marginTop: 8 },
  homeIsText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.green700 },
  teeList: { paddingHorizontal: 20, gap: 14, marginTop: 6 },
  teeEmpty: { gap: 10 },
  postButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 20,
    minHeight: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  postButtonLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink900, paddingHorizontal: 20, marginTop: 8, marginBottom: 4 },
  holeGridWrap: { paddingHorizontal: 20, marginTop: 4, gap: 6 },
  holeGridName: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.ink500 },
  holeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  holeCell: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  holeCellText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  holeEmpty: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 20, marginTop: 4, padding: 14, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  holeEmptyTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  holeEmptySub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.ink500, marginTop: 2 },
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
