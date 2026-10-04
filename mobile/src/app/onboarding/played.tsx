import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CourseSearch } from "@/components/course-search";
import { CourseTile, OnboardingFrame } from "@/components/onboarding-frame";
import { StarPicker } from "@/components/stars";
import { useAuth } from "@/lib/auth";
import { coursesNear, placeLabel, type Club } from "@/lib/courses";
import {
  FEATURED_CLUB_IDS,
  RATING_WORDS,
  clubsById,
  deleteReview,
  loadMyCourses,
  saveReview,
  setCourse,
} from "@/lib/onboarding";
import { loadMyProfile } from "@/lib/profile";
import { colors, fonts, radii } from "@/lib/theme";

/**
 * Step 3 — Courses you've played.
 *
 * Tick a course; optionally tap the stars. That one tap is a rating, written
 * as a course review with no comment — which is how the directory has ratings
 * on day one instead of waiting for people to go looking for a review form.
 *
 * Writes happen on every tap, not on Continue. A member who ticks six courses
 * and then closes the app has still told us about six courses.
 *
 * What's offered, in order: their home club, clubs within 30 km of it, then
 * the courses most Irish golfers have either played or want to. The search
 * box covers everything else.
 */
export default function PlayedStep() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [clubs, setClubs] = useState<Club[]>([]);
  const [played, setPlayed] = useState<Set<number>>(new Set());
  const [ratings, setRatings] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    void (async () => {
      const [profile, mine, featured] = await Promise.all([
        loadMyProfile(userId),
        loadMyCourses(userId),
        clubsById(FEATURED_CLUB_IDS),
      ]);

      let local: Club[] = [];
      if (profile?.homeClubId) {
        const [home] = await clubsById([profile.homeClubId]);
        if (home) {
          local = [home];
          if (home.latitude !== null && home.longitude !== null) {
            const near = await coursesNear(home.latitude, home.longitude, 30, 7).catch(() => ({ clubs: [] as Club[] }));
            local = [home, ...near.clubs.filter((c) => c.id !== home.id).slice(0, 6)];
          }
        }
      }
      // Anything they've already ticked (on the website, or before going back)
      // stays visible even if it is in neither list.
      const known = new Set([...local, ...featured].map((c) => c.id));
      const extra = await clubsById([...mine.played].filter((id) => !known.has(id)));

      const seen = new Set<number>();
      setClubs([...extra, ...local, ...featured].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))));
      setPlayed(mine.played);
      setRatings(mine.ratings);
      setLoading(false);
    })();
  }, [userId]);

  const toggle = async (club: Club) => {
    if (!userId) return;
    const on = !played.has(club.id);
    setPlayed((s) => {
      const n = new Set(s);
      if (on) n.add(club.id);
      else n.delete(club.id);
      return n;
    });
    setError(null);
    try {
      await setCourse(userId, club.id, "played", on);
      // Un-ticking a course they had rated takes the rating with it — a
      // rating of a course you say you haven't played is not one to count.
      if (!on && ratings.has(club.id)) {
        await deleteReview(userId, club.id);
        setRatings((m) => {
          const n = new Map(m);
          n.delete(club.id);
          return n;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that.");
    }
  };

  const rate = async (club: Club, rating: number) => {
    if (!userId) return;
    setRatings((m) => new Map(m).set(club.id, rating));
    setPlayed((s) => new Set(s).add(club.id));
    setError(null);
    try {
      await saveReview(userId, club.id, { rating });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your rating.");
    }
  };

  const add = (club: Club) => {
    setClubs((list) => [club, ...list.filter((c) => c.id !== club.id)]);
    if (!played.has(club.id)) void toggle(club);
  };

  return (
    <OnboardingFrame
      step={3}
      title="Courses you've played"
      sub="Tick the ones you've played. Tap the stars to rate them — it helps other golfers choose."
      onBack={() => router.back()}
      onSkip={() => router.push("/onboarding/bucket")}
      onContinue={() => router.push("/onboarding/bucket")}
      error={error}
    >
      <View style={styles.searchRow}>
        <View style={styles.flex}>
          <CourseSearch placeholder="Search any course" onPick={add} />
        </View>
      </View>
      <Text style={styles.count}>
        {played.size} played{ratings.size ? ` · ${ratings.size} rated` : ""}
      </Text>

      {loading ? <ActivityIndicator color={colors.green700} style={styles.spinner} /> : null}

      <View style={styles.list}>
        {clubs.map((club) => {
          const on = played.has(club.id);
          const rating = ratings.get(club.id) ?? 0;
          return (
            <View key={club.id} style={[styles.card, on && styles.cardOn]}>
              <View style={styles.row}>
                <CourseTile name={club.name} size={44} />
                <View style={styles.text}>
                  <Text style={styles.name} numberOfLines={2}>{club.name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{placeLabel(club)}</Text>
                </View>
                <Pressable
                  onPress={() => void toggle(club)}
                  style={[styles.tick, on && styles.tickOn]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`Played ${club.name}`}
                >
                  <Ionicons name="checkmark" size={22} color={on ? colors.cream50 : "#9aa3b0"} />
                </Pressable>
              </View>
              {on ? (
                <View style={styles.stars}>
                  <StarPicker value={rating} onChange={(n) => void rate(club, n)} size={26} />
                  <Text style={styles.word}>{rating ? RATING_WORDS[rating] : "Tap to rate (optional)"}</Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  count: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.green700, marginTop: 10 },
  spinner: { marginTop: 16 },
  list: { gap: 8, marginTop: 10 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 10,
  },
  cardOn: { borderColor: colors.green700 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  text: { flex: 1 },
  name: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: "#5b6576", marginTop: 2 },
  tick: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: "#9aa3b0",
    alignItems: "center",
    justifyContent: "center",
  },
  tickOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  stars: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, marginLeft: 54 },
  word: { fontFamily: fonts.body, fontSize: 13, color: "#5b6576" },
});
