import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";

import { CourseSearch } from "@/components/course-search";
import { RateRow } from "@/components/home-social";
import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";
import type { RateableCourse } from "@/lib/course-rating-rules";
import { coursesNear, distanceLabel, type Club } from "@/lib/courses";
import { useCurrentLocation } from "@/lib/location";
import { useAuth } from "@/lib/auth";
import { loadRateable } from "@/lib/home-social";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Rate a course — reached from Home's composer ("Review"), "All my courses"
 * and the latest-reviews strip. Search finds any course in the directory;
 * below it, every course the member has played, unrated first, with the
 * stars they gave. Tapping a star opens the review sheet with it filled in.
 * Re-read on focus, so a rating saved in the sheet shows on return.
 */
export default function RateCourseScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [courses, setCourses] = useState<RateableCourse<Club>[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setCourses(await loadRateable(userId));
    } catch {
      setCourses((c) => c ?? []);
    } finally {
      setRefreshing(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Oct 2026: "Nearby" — the courses around you, to rate without typing a
  // name. Location is asked for only when the button is tapped.
  const location = useCurrentLocation();
  const [near, setNear] = useState<Club[] | null>(null);
  const [nearBusy, setNearBusy] = useState(false);
  const [nearNote, setNearNote] = useState<string | null>(null);
  const findNear = async () => {
    if (near) {
      setNear(null);
      return;
    }
    setNearBusy(true);
    setNearNote(null);
    try {
      const coords = location.state.status === "ready" ? location.state.coords : await location.request();
      if (!coords) {
        setNearNote("PinPals couldn't get your location. You can turn it on in Settings › PinPals › Location, or search above.");
        return;
      }
      const { clubs } = await coursesNear(coords.lat, coords.lng, 40, 15);
      setNear(clubs);
      if (clubs.length === 0) setNearNote("No courses on file within 40 km. Search above to find one.");
    } catch {
      setNearNote("Couldn't load nearby courses. Please try again.");
    } finally {
      setNearBusy(false);
    }
  };
  const myStars = new Map((courses ?? []).map((c) => [c.club.id, c.rating ?? 0]));

  const waiting = courses?.filter((c) => c.rating === null).length ?? 0;

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={KEYBOARD_DISMISS_MODE}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.green700}
        />
      }
    >
      <View style={styles.intro}>
        <Text style={styles.body}>
          Your stars go into the course's rating, shown on its page and on every tee time there.
        </Text>
      </View>

      <CourseSearch
        placeholder="Find any course to rate"
        onPick={(club) =>
          router.push({ pathname: "/course/review", params: { id: String(club.id), name: club.name } })
        }
      />

      <Pressable
        onPress={() => void findNear()}
        style={({ pressed }) => [styles.nearButton, near && styles.nearButtonOn, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: near != null }}
      >
        {nearBusy ? (
          <ActivityIndicator color={colors.navy900} />
        ) : (
          <Ionicons name={near ? "close" : "navigate"} size={18} color={colors.navy900} />
        )}
        <Text style={styles.nearLabel}>{near ? "Hide nearby courses" : "Nearby courses"}</Text>
      </Pressable>
      {nearNote ? <Text style={styles.body}>{nearNote}</Text> : null}
      {near && near.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.heading}>Near you</Text>
          <View style={styles.card}>
            {near.map((club, i) => (
              <RateRow key={club.id} club={club} rating={myStars.get(club.id) ?? 0} first={i === 0} distance={distanceLabel(club.distance_km)} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.heading}>Courses you've played</Text>
        {courses === null ? (
          <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.md }} />
        ) : courses.length === 0 ? (
          <Text style={styles.body}>
            Courses you've ticked as played show here. Search above to rate one now — it's added to your played
            list too.
          </Text>
        ) : (
          <>
            <Text style={styles.body}>
              {waiting === 0
                ? "All rated — thank you. Tap the stars to change one."
                : waiting === 1
                  ? "1 still waiting for your stars."
                  : `${waiting} still waiting for your stars.`}
            </Text>
            <View style={styles.card}>
              {courses.map((c, i) => (
                <RateRow key={c.club.id} club={c.club} rating={c.rating ?? 0} first={i === 0} />
              ))}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  intro: { gap: 4 },
  heading: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900 },
  body: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink500 },
  section: { gap: 8, marginTop: spacing.sm },
  nearButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.gold400,
    borderWidth: 1,
    borderColor: colors.gold500,
  },
  nearButtonOn: { backgroundColor: colors.cream100, borderColor: colors.line },
  nearLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
});
