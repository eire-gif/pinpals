import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { CourseSearch } from "@/components/course-search";
import { RateRow } from "@/components/home-social";
import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";
import type { RateableCourse } from "@/lib/course-rating-rules";
import type { Club } from "@/lib/courses";
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
});
